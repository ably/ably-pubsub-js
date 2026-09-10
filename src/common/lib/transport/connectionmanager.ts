import { actions } from '../types/protocolmessagecommon';
import ProtocolMessage, {
  stringify as stringifyProtocolMessage,
  fromValues as protocolMessageFromValues,
} from 'common/lib/types/protocolmessage';
import * as Utils from 'common/lib/util/utils';
import Protocol, { PendingMessage, PublishCallback } from './protocol';
import Defaults, { getAgentString } from 'common/lib/util/defaults';
import Platform, { TransportImplementations } from 'common/platform';
import EventEmitter from '../util/eventemitter';
import MessageQueue from './messagequeue';
import Logger from '../util/logger';
import ConnectionStateChange from 'common/lib/client/connectionstatechange';
import ConnectionErrors, { isRetriable } from './connectionerrors';
import ErrorInfo, { IPartialErrorInfo, PartialErrorInfo } from 'common/lib/types/errorinfo';
import Auth from 'common/lib/client/auth';
import Transport, { TransportCtor } from './transport';
import * as API from '../../../../ably';
import HttpStatusCodes from 'common/constants/HttpStatusCodes';
import BaseRealtime from '../client/baserealtime';
import { NormalisedClientOptions } from 'common/types/ClientOptions';
import TransportName, { TransportNames } from 'common/constants/TransportName';

let globalObject = typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : self;

const haveWebStorage = () => typeof Platform.WebStorage !== 'undefined' && Platform.WebStorage?.localSupported;
const haveSessionStorage = () => typeof Platform.WebStorage !== 'undefined' && Platform.WebStorage?.sessionSupported;
const noop = function () {};
const transportPreferenceName = 'ably-transport-preference';

type RecoveryContext = {
  connectionKey: string;
  msgSerial: number;
  channelSerials: { [name: string]: string };
};

function decodeRecoveryKey(recoveryKey: NormalisedClientOptions['recover']): RecoveryContext | null {
  try {
    return JSON.parse(recoveryKey as string);
  } catch (e) {
    return null;
  }
}

export class TransportParams {
  options: NormalisedClientOptions;
  host: string | null;
  mode: string;
  format?: Utils.Format;
  connectionKey?: string;
  stream?: any;
  heartbeats?: boolean;

  constructor(options: NormalisedClientOptions, host: string | null, mode: string, connectionKey?: string) {
    this.options = options;
    this.host = host;
    this.mode = mode;
    this.connectionKey = connectionKey;
    this.format = options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json;
  }

  getConnectParams(authParams: Record<string, unknown>): Record<string, string> {
    const params = authParams ? Utils.copy(authParams) : {};
    const options = this.options;
    switch (this.mode) {
      case 'resume':
        params.resume = this.connectionKey as string;
        break;
      case 'recover': {
        const recoveryContext = decodeRecoveryKey(options.recover);
        if (recoveryContext) {
          params.recover = recoveryContext.connectionKey;
        }
        break;
      }
      default:
    }
    if (options.clientId !== undefined) {
      params.clientId = options.clientId;
    }
    if (options.echoMessages === false) {
      params.echo = 'false';
    }
    if (this.format !== undefined) {
      params.format = this.format;
    }
    if (this.stream !== undefined) {
      params.stream = this.stream;
    }
    if (this.heartbeats !== undefined) {
      params.heartbeats = this.heartbeats;
    }
    params.v = Defaults.protocolVersion;
    params.agent = getAgentString(this.options);
    if (options.transportParams !== undefined) {
      Utils.mixin(params, options.transportParams);
    }
    return params as Record<string, string>;
  }

  toString(): string {
    let result = '[mode=' + this.mode;
    if (this.host) {
      result += ',host=' + this.host;
    }
    if (this.connectionKey) {
      result += ',connectionKey=' + this.connectionKey;
    }
    if (this.format) {
      result += ',format=' + this.format;
    }
    result += ']';

    return result;
  }
}

type ConnectionState = {
  state: string;
  terminal?: boolean;
  queueEvents?: boolean;
  sendEvents?: boolean;
  failState?: string;
  retryDelay?: number;
  retryImmediately?: boolean;
  error?: IPartialErrorInfo;
};

class ConnectionManager extends EventEmitter {
  supportedTransports: Partial<Record<TransportName, TransportCtor>> = {};
  realtime: BaseRealtime;
  options: NormalisedClientOptions;
  states: Record<string, ConnectionState>;
  state: ConnectionState;
  errorReason: IPartialErrorInfo | null;
  queuedMessages: MessageQueue;
  msgSerial: number;
  connectionDetails?: Record<string, any>;
  connectionId?: string;
  connectionKey?: string;
  connectionStateTtl: number;
  maxIdleInterval: number | null;
  transports: TransportName[];
  baseTransport?: TransportName;
  webSocketTransportAvailable?: true;
  transportPreference: string | null;
  domains: string[];
  activeProtocol: null | Protocol;
  pendingTransport?: Transport;
  proposedTransport?: Transport;
  host: string | null;
  lastAutoReconnectAttempt: number | null;
  forceFallbackHost: boolean;
  transitionTimer?: number | NodeJS.Timeout | null;
  suspendTimer?: number | NodeJS.Timeout | null;
  retryTimer?: number | NodeJS.Timeout | null;
  disconnectedRetryCount: number = 0;
  pendingChannelMessagesState: {
    // Whether a message is currently being processed
    isProcessing: boolean;
    // The messages remaining to be processed (excluding any message currently being processed)
    queue: { message: ProtocolMessage; transport: Transport }[];
  } = { isProcessing: false, queue: [] };
  webSocketSlowTimer: NodeJS.Timeout | null;
  wsCheckResult: boolean | null;
  wsCheckPromise: Promise<boolean> | null;
  webSocketGiveUpTimer: NodeJS.Timeout | null;
  abandonedWebSocket: boolean;
  connectCounter: number;

  constructor(realtime: BaseRealtime, options: NormalisedClientOptions) {
    super(realtime.logger);
    this.realtime = realtime;
    this.initTransports();
    this.options = options;
    const timeouts = options.timeouts;
    /* connectingTimeout: leave webSocketConnectTimeout (~6s) to try the
     * websocket transport, then realtimeRequestTimeout (~10s) to establish
     * the base transport in case that fails */
    const connectingTimeout = timeouts.webSocketConnectTimeout + timeouts.realtimeRequestTimeout;
    this.states = {
      initialized: {
        state: 'initialized',
        terminal: false,
        queueEvents: true,
        sendEvents: false,
        failState: 'disconnected',
      },
      connecting: {
        state: 'connecting',
        terminal: false,
        queueEvents: true,
        sendEvents: false,
        retryDelay: connectingTimeout,
        failState: 'disconnected',
      },
      connected: {
        state: 'connected',
        terminal: false,
        queueEvents: false,
        sendEvents: true,
        failState: 'disconnected',
      },
      disconnected: {
        state: 'disconnected',
        terminal: false,
        queueEvents: true,
        sendEvents: false,
        retryDelay: timeouts.disconnectedRetryTimeout,
        failState: 'disconnected',
      },
      suspended: {
        state: 'suspended',
        terminal: false,
        queueEvents: false,
        sendEvents: false,
        retryDelay: timeouts.suspendedRetryTimeout,
        failState: 'suspended',
      },
      closing: {
        state: 'closing',
        terminal: false,
        queueEvents: false,
        sendEvents: false,
        retryDelay: timeouts.realtimeRequestTimeout,
        failState: 'closed',
      },
      closed: { state: 'closed', terminal: true, queueEvents: false, sendEvents: false, failState: 'closed' },
      failed: { state: 'failed', terminal: true, queueEvents: false, sendEvents: false, failState: 'failed' },
    };
    this.state = this.states.initialized;
    this.errorReason = null;

    this.queuedMessages = new MessageQueue(this.logger);
    this.msgSerial = 0;
    this.connectionDetails = undefined;
    this.connectionId = undefined;
    this.connectionKey = undefined;
    this.connectionStateTtl = timeouts.connectionStateTtl;
    this.maxIdleInterval = null;

    this.transports = Utils.intersect(options.transports || Defaults.defaultTransports, this.supportedTransports);
    this.transportPreference = null;

    if (this.transports.includes(TransportNames.WebSocket)) {
      this.webSocketTransportAvailable = true;
    }
    if (this.transports.includes(TransportNames.XhrPolling)) {
      this.baseTransport = TransportNames.XhrPolling;
    } else if (this.transports.includes(TransportNames.Comet)) {
      this.baseTransport = TransportNames.Comet;
    }

    this.domains = Defaults.getHosts(options);
    this.activeProtocol = null;
    this.host = null;
    this.lastAutoReconnectAttempt = null;
    this.forceFallbackHost = false;
    this.connectCounter = 0;
    this.wsCheckResult = null;
    this.wsCheckPromise = null;
    this.webSocketSlowTimer = null;
    this.webSocketGiveUpTimer = null;
    this.abandonedWebSocket = false;

    Logger.logAction(this.logger, Logger.LOG_MINOR, 'Realtime.ConnectionManager()', 'started');
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'Realtime.ConnectionManager()',
      'requested transports = [' + (options.transports || Defaults.defaultTransports) + ']',
    );
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'Realtime.ConnectionManager()',
      'available transports = [' + this.transports + ']',
    );
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'Realtime.ConnectionManager()',
      'http domains = [' + this.domains + ']',
    );

    if (!this.transports.length) {
      const msg = 'no requested transports available';
      Logger.logAction(this.logger, Logger.LOG_ERROR, 'realtime.ConnectionManager()', msg);
      throw new Error(msg);
    }

    const addEventListener = Platform.Config.addEventListener;
    if (addEventListener) {
      /* intercept close event in browser to persist connection id if requested */
      if (haveSessionStorage() && typeof options.recover === 'function') {
        addEventListener('beforeunload', this.persistConnection.bind(this));
      }

      if (options.closeOnUnload === true) {
        addEventListener('beforeunload', () => {
          Logger.logAction(
            this.logger,
            Logger.LOG_MAJOR,
            'Realtime.ConnectionManager()',
            'beforeunload event has triggered the connection to close as closeOnUnload is true',
          );
          this.requestState({ state: 'closing' });
        });
      }

      /* Listen for online and offline events */
      addEventListener('online', () => {
        if (this.state == this.states.disconnected || this.state == this.states.suspended) {
          Logger.logAction(
            this.logger,
            Logger.LOG_MINOR,
            'ConnectionManager caught browser ‘online’ event',
            'reattempting connection',
          );
          this.requestState({ state: 'connecting' });
        } else if (this.state == this.states.connecting) {
          // RTN20c: if 'online' event recieved while CONNECTING, abandon connection attempt and retry
          this.pendingTransport?.off();
          this.disconnectAllTransports();

          this.startConnect();
        }
      });

      addEventListener('offline', () => {
        if (this.state == this.states.connected) {
          Logger.logAction(
            this.logger,
            Logger.LOG_MINOR,
            'ConnectionManager caught browser ‘offline’ event',
            'disconnecting active transport',
          );
          // Not sufficient to just go to the 'disconnected' state, want to
          // force all transports to reattempt the connection. Will immediately
          // retry.
          this.disconnectAllTransports();
        }
      });
    }
  }

  /*********************
   * transport management
   *********************/

  // Used by tests
  static supportedTransports(additionalImplementations: TransportImplementations) {
    const storage: TransportStorage = { supportedTransports: {} };
    this.initTransports(additionalImplementations, storage);
    return storage.supportedTransports;
  }

  private static initTransports(additionalImplementations: TransportImplementations, storage: TransportStorage) {
    const implementations = { ...Platform.Transports.bundledImplementations, ...additionalImplementations };

    [TransportNames.WebSocket, ...Platform.Transports.order].forEach((transportName) => {
      const transport = implementations[transportName];
      if (transport && transport.isAvailable()) {
        storage.supportedTransports[transportName] = transport;
      }
    });
  }

  initTransports() {
    ConnectionManager.initTransports(this.realtime._additionalTransportImplementations, this);
  }

  createTransportParams(host: string | null, mode: string): TransportParams {
    return new TransportParams(this.options, host, mode, this.connectionKey);
  }

  getTransportParams(callback: Function): void {
    const decideMode = (modeCb: Function) => {
      if (this.connectionKey) {
        modeCb('resume');
        return;
      }

      if (typeof this.options.recover === 'string') {
        modeCb('recover');
        return;
      }

      const recoverFn = this.options.recover,
        lastSessionData = this.getSessionRecoverData(),
        sessionRecoveryName = this.sessionRecoveryName();
      if (lastSessionData && typeof recoverFn === 'function') {
        Logger.logAction(
          this.logger,
          Logger.LOG_MINOR,
          'ConnectionManager.getTransportParams()',
          'Calling clientOptions-provided recover function with last session data (recovery scope: ' +
            sessionRecoveryName +
            ')',
        );
        recoverFn(lastSessionData, (shouldRecover?: boolean) => {
          if (shouldRecover) {
            this.options.recover = lastSessionData.recoveryKey;
            modeCb('recover');
          } else {
            modeCb('clean');
          }
        });
        return;
      }
      modeCb('clean');
    };

    decideMode((mode: string) => {
      const transportParams = this.createTransportParams(null, mode);
      if (mode === 'recover') {
        Logger.logAction(
          this.logger,
          Logger.LOG_MINOR,
          'ConnectionManager.getTransportParams()',
          'Transport recovery mode = recover; recoveryKey = ' + this.options.recover,
        );
        const recoveryContext = decodeRecoveryKey(this.options.recover);
        if (recoveryContext) {
          this.msgSerial = recoveryContext.msgSerial;
        }
      } else {
        Logger.logAction(
          this.logger,
          Logger.LOG_MINOR,
          'ConnectionManager.getTransportParams()',
          'Transport params = ' + transportParams.toString(),
        );
      }
      callback(transportParams);
    });
  }

  /**
   * Attempt to connect using a given transport
   * @param transportParams
   * @param candidate, the transport to try
   * @param callback
   */
  tryATransport(transportParams: TransportParams, candidate: TransportName, callback: Function): void {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'ConnectionManager.tryATransport()', 'trying ' + candidate);

    this.proposedTransport = Transport.tryConnect(
      this.supportedTransports[candidate]!,
      this,
      this.realtime.auth,
      transportParams,
      (wrappedErr: { error: ErrorInfo; event: string } | null, transport?: Transport) => {
        const state = this.state;
        if (state == this.states.closing || state == this.states.closed || state == this.states.failed) {
          if (transport) {
            Logger.logAction(
              this.logger,
              Logger.LOG_MINOR,
              'ConnectionManager.tryATransport()',
              'connection ' + state.state + ' while we were attempting the transport; closing ' + transport,
            );
            transport.close();
          }
          callback(true);
          return;
        }

        if (wrappedErr) {
          Logger.logAction(
            this.logger,
            Logger.LOG_MINOR,
            'ConnectionManager.tryATransport()',
            'transport ' + candidate + ' ' + wrappedErr.event + ', err: ' + wrappedErr.error.toString(),
          );

          /* Comet transport onconnect token errors can be dealt with here.
           * Websocket ones only happen after the transport claims to be viable,
           * so are dealt with as non-onconnect token errors */
          if (
            Auth.isTokenErr(wrappedErr.error) &&
            !(this.errorReason && Auth.isTokenErr(this.errorReason as ErrorInfo))
          ) {
            this.errorReason = wrappedErr.error;
            /* re-get a token and try again */
            Utils.whenPromiseSettles(this.realtime.auth._forceNewToken(null, null), (err: ErrorInfo | null) => {
              if (err) {
                this.actOnErrorFromAuthorize(err);
                return;
              }
              this.tryATransport(transportParams, candidate, callback);
            });
          } else if (wrappedErr.event === 'failed') {
            /* Error that's fatal to the connection */
            this.notifyState({ state: 'failed', error: wrappedErr.error });
            callback(true);
          } else if (wrappedErr.event === 'disconnected') {
            if (!isRetriable(wrappedErr.error)) {
              /* Error received from the server that does not call for trying a fallback host, eg a rate limit */
              this.notifyState({ state: this.states.connecting.failState as string, error: wrappedErr.error });
              callback(true);
            } else {
              /* Error with that transport only; continue trying other fallback hosts */
              callback(false);
            }
          }
          return;
        }

        Logger.logAction(
          this.logger,
          Logger.LOG_MICRO,
          'ConnectionManager.tryATransport()',
          'viable transport ' + candidate + '; setting pending',
        );
        this.setTransportPending(transport as Transport, transportParams);
        callback(null, transport);
      },
    );
  }

  /**
   * Called when a transport is indicated to be viable, and the ConnectionManager
   * expects to activate this transport as soon as it is connected.
   * @param transport
   * @param transportParams
   */
  setTransportPending(transport: Transport, transportParams: TransportParams): void {
    const mode = transportParams.mode;
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.setTransportPending()',
      'transport = ' + transport + '; mode = ' + mode,
    );

    this.pendingTransport = transport;

    this.cancelWebSocketSlowTimer();
    this.cancelWebSocketGiveUpTimer();

    transport.once('connected', (error: ErrorInfo, connectionId: string, connectionDetails: Record<string, any>) => {
      this.activateTransport(error, transport, connectionId, connectionDetails);

      if (mode === 'recover' && this.options.recover) {
        /* After a successful recovery, we unpersist, as a recovery key cannot
         * be used more than once */
        delete this.options.recover;
        this.unpersistConnection();
      }
    });

    const self = this;
    transport.on(['disconnected', 'closed', 'failed'], function (this: { event: string }, error: ErrorInfo) {
      self.deactivateTransport(transport, this.event, error);
    });

    this.emit('transport.pending', transport);
  }

  /**
   * Called when a transport is connected, and the connectionmanager decides that
   * it will now be the active transport. Returns whether or not it activated
   * the transport (if the connection is closing/closed it will choose not to).
   * @param transport the transport instance
   * @param connectionId the id of the new active connection
   * @param connectionDetails the details of the new active connection
   */
  activateTransport(
    error: ErrorInfo,
    transport: Transport,
    connectionId: string,
    connectionDetails: Record<string, any>,
  ): boolean {
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.activateTransport()',
      'transport = ' + transport,
    );
    if (error) {
      Logger.logAction(this.logger, Logger.LOG_ERROR, 'ConnectionManager.activateTransport()', 'error = ' + error);
    }
    if (connectionId) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MICRO,
        'ConnectionManager.activateTransport()',
        'connectionId =  ' + connectionId,
      );
    }
    if (connectionDetails) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MICRO,
        'ConnectionManager.activateTransport()',
        'connectionDetails =  ' + JSON.stringify(connectionDetails),
      );
    }

    this.persistTransportPreference(transport);

    /* if the connectionmanager moved to the closing/closed state before this
     * connection event, then we won't activate this transport */
    const existingState = this.state,
      connectedState = this.states.connected.state;
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.activateTransport()',
      'current state = ' + existingState.state,
    );
    if (
      existingState.state == this.states.closing.state ||
      existingState.state == this.states.closed.state ||
      existingState.state == this.states.failed.state
    ) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'ConnectionManager.activateTransport()',
        'Disconnecting transport and abandoning',
      );
      transport.disconnect();
      return false;
    }

    delete this.pendingTransport;

    /* if the transport is not connected then don't activate it */
    if (!transport.isConnected) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'ConnectionManager.activateTransport()',
        'Declining to activate transport ' + transport + ' since it appears to no longer be connected',
      );
      return false;
    }

    /* the given transport is connected; this will immediately
     * take over as the active transport */
    const existingActiveProtocol = this.activeProtocol;
    this.activeProtocol = new Protocol(transport);
    this.host = transport.params.host;

    const connectionKey = connectionDetails.connectionKey;
    if (connectionKey && this.connectionKey != connectionKey) {
      this.setConnection(connectionId, connectionDetails, !!error);
    }

    /* Rebroadcast any new connectionDetails from the active transport, which
     * can come at any time (eg following a reauth), and emit an RTN24 UPDATE
     * event. (Listener added on nextTick because we're in a transport.on('connected')
     * callback at the moment; if we add it now we'll be adding it to the end
     * of the listeners array and it'll be called immediately) */
    this.onConnectionDetailsUpdate(connectionDetails, transport);
    Platform.Config.nextTick(() => {
      transport.on(
        'connected',
        (connectedErr: ErrorInfo, _connectionId: string, connectionDetails: Record<string, any>) => {
          this.onConnectionDetailsUpdate(connectionDetails, transport);
          this.emit('update', new ConnectionStateChange(connectedState, connectedState, null, connectedErr));
        },
      );
    });

    /* If previously not connected, notify the state change (including any
     * error). */
    if (existingState.state === this.states.connected.state) {
      if (error) {
        this.errorReason = this.realtime.connection.errorReason = error;
        this.emit('update', new ConnectionStateChange(connectedState, connectedState, null, error));
      }
    } else {
      this.notifyState({ state: 'connected', error: error });
      this.errorReason = this.realtime.connection.errorReason = error || null;
    }

    /* Send after the connection state update, as Channels hooks into this to
     * resend attaches on a new transport if necessary */
    this.emit('transport.active', transport);

    /* Gracefully terminate existing protocol */
    if (existingActiveProtocol) {
      if (existingActiveProtocol.messageQueue.count() > 0) {
        /* We could just requeue pending messages on the new transport, but
         * actually this should never happen: transports should only take over
         * from other active transports when upgrading, and upgrading waits for
         * the old transport to be idle. So log an error. */
        Logger.logAction(
          this.logger,
          Logger.LOG_ERROR,
          'ConnectionManager.activateTransport()',
          'Previous active protocol (for transport ' +
            existingActiveProtocol.transport.shortName +
            ', new one is ' +
            transport.shortName +
            ') finishing with ' +
            existingActiveProtocol.messageQueue.count() +
            ' messages still pending',
        );
      }
      if (existingActiveProtocol.transport === transport) {
        const msg =
          'Assumption violated: activating a transport that was also the transport for the previous active protocol; transport = ' +
          transport.shortName +
          '; stack = ' +
          new Error().stack;
        Logger.logAction(this.logger, Logger.LOG_ERROR, 'ConnectionManager.activateTransport()', msg);
      } else {
        existingActiveProtocol.finish();
      }
    }

    return true;
  }

  /**
   * Called when a transport is no longer the active transport. This can occur
   * in any transport connection state.
   * @param transport
   */
  deactivateTransport(transport: Transport, state: string, error: ErrorInfo): void {
    const currentProtocol = this.activeProtocol,
      wasActive = currentProtocol && currentProtocol.getTransport() === transport,
      wasPending = transport === this.pendingTransport,
      noTransportsScheduledForActivation = this.noTransportsScheduledForActivation();

    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.deactivateTransport()',
      'transport = ' + transport,
    );
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.deactivateTransport()',
      'state = ' +
        state +
        (wasActive ? '; was active' : wasPending ? '; was pending' : '') +
        (noTransportsScheduledForActivation ? '' : '; another transport is scheduled for activation'),
    );
    if (error && error.message)
      Logger.logAction(
        this.logger,
        Logger.LOG_MICRO,
        'ConnectionManager.deactivateTransport()',
        'reason =  ' + error.message,
      );

    if (wasActive) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MICRO,
        'ConnectionManager.deactivateTransport()',
        'Getting, clearing, and requeuing ' +
          (this.activeProtocol as Protocol).messageQueue.count() +
          ' pending messages',
      );
      this.queuePendingMessages((currentProtocol as Protocol).getPendingMessages());
      /* Clear any messages we requeue to allow the protocol to become idle.*/
      (currentProtocol as Protocol).clearPendingMessages();
      this.activeProtocol = this.host = null;
    }

    this.emit('transport.inactive', transport);

    /* this transport state change is a state change for the connectionmanager if
     * - the transport was the active transport and there are no transports
     *   which are connected and scheduled for activation, just waiting for the
     *   active transport to finish what its doing; or
     * - the transport was the active transport and the error was fatal (so
     *   unhealable by another transport); or
     * - there is no active transport, and this is the last remaining
     *   pending transport (so we were in the connecting state)
     */
    if (
      (wasActive && noTransportsScheduledForActivation) ||
      (wasActive && state === 'failed') ||
      state === 'closed' ||
      (currentProtocol === null && wasPending)
    ) {
      /* If we're disconnected with a 5xx we need to try fallback hosts
       * (RTN14d), but (a) due to how the upgrade sequence works, the
       * host/transport selection sequence only cares about getting to
       * `preconnect` (eg establishing a websocket) getting a `disconnected`
       * protocol message afterwards is too late; and (b) host retry only
       * applies to connectBase unless the stored preference transport doesn't
       * work. We solve this by unpersisting the transport preference and
       * setting an instance variable to force fallback hosts to be used (if
       * any) here. Bit of a kludge, but no real better alternatives without
       * rewriting the entire thing */
      if (state === 'disconnected' && error && (error.statusCode as number) > 500 && this.domains.length > 1) {
        this.unpersistTransportPreference();
        this.forceFallbackHost = true;
        /* and try to connect again to try a fallback host without waiting for the usual 15s disconnectedRetryTimeout */
        this.notifyState({ state: state, error: error, retryImmediately: true });
        return;
      }

      /* TODO remove below line once realtime sends token errors as DISCONNECTEDs */
      const newConnectionState = state === 'failed' && Auth.isTokenErr(error) ? 'disconnected' : state;
      this.notifyState({ state: newConnectionState, error: error });
      return;
    }
  }

  /* Helper that returns true if there are no transports which are pending,
   * have been connected, and are just waiting for onceNoPending to fire before
   * being activated */
  noTransportsScheduledForActivation(): boolean {
    return !this.pendingTransport || !this.pendingTransport.isConnected;
  }

  setConnection(connectionId: string, connectionDetails: Record<string, any>, hasConnectionError?: boolean): void {
    /* if connectionKey changes but connectionId stays the same, then just a
     * transport change on the same connection. If connectionId changes, we're
     * on a new connection, with implications for msgSerial and channel state */
    /* If no previous connectionId, don't reset the msgSerial as it may have
     * been set by recover data (unless the recover failed) */
    const prevConnId = this.connectionId,
      connIdChanged = prevConnId && prevConnId !== connectionId,
      recoverFailure = !prevConnId && hasConnectionError;
    if (connIdChanged || recoverFailure) {
      Logger.logAction(this.logger, Logger.LOG_MINOR, 'ConnectionManager.setConnection()', 'Resetting msgSerial');
      this.msgSerial = 0;
      // RTN19a2: In the event of a new connectionId, previous msgSerials are
      // meaningless.
      this.queuedMessages.resetSendAttempted();
    }
    if (this.connectionId !== connectionId) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'ConnectionManager.setConnection()',
        'New connectionId; reattaching any attached channels',
      );
    }
    this.realtime.connection.id = this.connectionId = connectionId;
    this.realtime.connection.key = this.connectionKey = connectionDetails.connectionKey;
  }

  clearConnection(): void {
    this.realtime.connection.id = this.connectionId = undefined;
    this.realtime.connection.key = this.connectionKey = undefined;
    this.msgSerial = 0;
    // RTN19a2: On a new connection, previous msgSerials are meaningless.
    // Reset sendAttempted so queued messages get new serials.
    this.queuedMessages.resetSendAttempted();
    this.unpersistConnection();
  }

  createRecoveryKey(): string | null {
    // RTN16g2.
    if (!this.connectionKey) {
      return null;
    }

    return JSON.stringify({
      connectionKey: this.connectionKey,
      msgSerial: this.msgSerial,
      channelSerials: this.realtime.channels.channelSerials(),
    });
  }

  /**
   * Called when the connectionmanager wants to persist transport
   * state for later recovery. Only applicable in the browser context.
   */
  persistConnection(): void {
    if (haveSessionStorage()) {
      const recoveryKey = this.createRecoveryKey();
      if (recoveryKey) {
        this.setSessionRecoverData({
          recoveryKey: recoveryKey,
          disconnectedAt: Platform.Config.now(),
          location: globalObject.location,
          clientId: this.realtime.auth.clientId,
        });
      }
    }
  }

  /**
   * Called when the connectionmanager wants to persist transport
   * state for later recovery. Only applicable in the browser context.
   */
  unpersistConnection(): void {
    this.clearSessionRecoverData();
  }

  getActiveTransportFormat(): Utils.Format | undefined {
    return this.activeProtocol?.getTransport().format;
  }

  /*********************
   * state management
   *********************/

  getError(): IPartialErrorInfo | string {
    if (this.errorReason) {
      // create new PartialErrorInfo so it has the correct stack trace
      // which points to the place which caused us to return this error.
      const newError = PartialErrorInfo.fromValues(this.errorReason);
      newError.cause = this.errorReason;
      return newError;
    }

    return this.getStateError();
  }

  getStateError(): ErrorInfo {
    return (ConnectionErrors as Record<string, () => ErrorInfo>)[this.state.state]?.();
  }

  activeState(): boolean | void {
    return this.state.queueEvents || this.state.sendEvents;
  }

  enactStateChange(stateChange: ConnectionStateChange): void {
    const action = 'Connection state';
    const message = stateChange.current + (stateChange.reason ? '; reason: ' + stateChange.reason : '');
    if (stateChange.current === 'failed') {
      Logger.logAction(this.logger, Logger.LOG_ERROR, action, message);
    } else {
      Logger.logAction(this.logger, Logger.LOG_MAJOR, action, message);
    }
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.enactStateChange',
      'setting new state: ' +
        stateChange.current +
        '; reason = ' +
        (stateChange.reason && (stateChange.reason as ErrorInfo).message),
    );
    const newState = (this.state = this.states[stateChange.current as string]);
    if (stateChange.reason) {
      this.errorReason = stateChange.reason;
      // TODO remove this type assertion after fixing https://github.com/ably/ably-js/issues/1405
      this.realtime.connection.errorReason = stateChange.reason as ErrorInfo;
    }
    if (newState.terminal) {
      // RTN8d, RTN9d: connectionId and connectionKey are only cleared in the
      // terminal states. In particular, they are retained in the suspended
      // state: since RTN14h/spec-6.1.0 the client always attempts to resume on
      // reconnecting and lets the server decide whether continuity is possible.
      this.clearConnection();
    }
    this.emit('connectionstate', stateChange);
  }

  /****************************************
   * ConnectionManager connection lifecycle
   ****************************************/

  startTransitionTimer(transitionState: ConnectionState): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.startTransitionTimer()',
      'transitionState: ' + transitionState.state,
    );

    if (this.transitionTimer) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'ConnectionManager.startTransitionTimer()',
        'clearing already-running timer',
      );
      Platform.Config.clearTimeout(this.transitionTimer as unknown as ReturnType<typeof setTimeout>);
    }

    this.transitionTimer = Platform.Config.setTimeout(() => {
      if (this.transitionTimer) {
        this.transitionTimer = null;
        Logger.logAction(
          this.logger,
          Logger.LOG_MINOR,
          'ConnectionManager ' + transitionState.state + ' timer expired',
          'requesting new state: ' + transitionState.failState,
        );
        this.notifyState({ state: transitionState.failState as string });
      }
    }, transitionState.retryDelay);
  }

  cancelTransitionTimer(): void {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'ConnectionManager.cancelTransitionTimer()', '');
    if (this.transitionTimer) {
      Platform.Config.clearTimeout(this.transitionTimer as unknown as ReturnType<typeof setTimeout>);
      this.transitionTimer = null;
    }
  }

  startSuspendTimer(): void {
    if (this.suspendTimer) return;
    this.suspendTimer = Platform.Config.setTimeout(() => {
      if (this.suspendTimer) {
        this.suspendTimer = null;
        Logger.logAction(
          this.logger,
          Logger.LOG_MINOR,
          'ConnectionManager suspend timer expired',
          'requesting new state: suspended',
        );
        this.states.connecting.failState = 'suspended';
        this.notifyState({ state: 'suspended' });
      }
    }, this.connectionStateTtl);
  }

  checkSuspendTimer(state: string): void {
    if (state !== 'disconnected' && state !== 'suspended' && state !== 'connecting') this.cancelSuspendTimer();
  }

  cancelSuspendTimer(): void {
    this.states.connecting.failState = 'disconnected';
    if (this.suspendTimer) {
      Platform.Config.clearTimeout(this.suspendTimer as unknown as ReturnType<typeof setTimeout>);
      this.suspendTimer = null;
    }
  }

  startRetryTimer(interval: number): void {
    this.retryTimer = Platform.Config.setTimeout(() => {
      Logger.logAction(this.logger, Logger.LOG_MINOR, 'ConnectionManager retry timer expired', 'retrying');
      this.retryTimer = null;
      this.requestState({ state: 'connecting' });
    }, interval);
  }

  cancelRetryTimer(): void {
    if (this.retryTimer) {
      Platform.Config.clearTimeout(this.retryTimer as unknown as ReturnType<typeof setTimeout>);
      this.retryTimer = null;
    }
  }

  startWebSocketSlowTimer() {
    this.webSocketSlowTimer = Platform.Config.setTimeout(() => {
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'ConnectionManager WebSocket slow timer',
        'checking connectivity',
      );
      this.checkWsConnectivityOnce().then((wsAvailable) => {
        /* The log level has to be a literal Logger.LOG_* for the stripLogs
         * build plugin to be able to decide whether to strip the call */
        if (wsAvailable) {
          Logger.logAction(
            this.logger,
            Logger.LOG_MINOR,
            'ConnectionManager WebSocket slow timer',
            'ws connectivity check succeeded',
          );
        } else {
          Logger.logAction(
            this.logger,
            Logger.LOG_MAJOR,
            'ConnectionManager WebSocket slow timer',
            'ws connectivity check failed',
          );
        }
      });
      if (this.realtime.http.checkConnectivity) {
        Utils.whenPromiseSettles(this.realtime.http.checkConnectivity(), (err, connectivity) => {
          if (err || !connectivity) {
            Logger.logAction(
              this.logger,
              Logger.LOG_MAJOR,
              'ConnectionManager WebSocket slow timer',
              'http connectivity check failed',
            );
            this.cancelWebSocketGiveUpTimer();
            this.notifyState({
              state: 'disconnected',
              error: new ErrorInfo('Unable to connect (network unreachable)', 80003, 404),
            });
          } else {
            Logger.logAction(
              this.logger,
              Logger.LOG_MINOR,
              'ConnectionManager WebSocket slow timer',
              'http connectivity check succeeded',
            );
          }
        });
      }
    }, this.options.timeouts.webSocketSlowTimeout);
  }

  cancelWebSocketSlowTimer() {
    if (this.webSocketSlowTimer) {
      Platform.Config.clearTimeout(this.webSocketSlowTimer);
      this.webSocketSlowTimer = null;
    }
  }

  startWebSocketGiveUpTimer(transportParams: TransportParams) {
    this.webSocketGiveUpTimer = Platform.Config.setTimeout(() => {
      if (!this.wsCheckResult) {
        if (this.baseTransport) {
          Logger.logAction(
            this.logger,
            Logger.LOG_MINOR,
            'ConnectionManager WebSocket give up timer',
            'websocket connection took more than ' + this.options.timeouts.webSocketConnectTimeout + 'ms',
          );
          this.abandonWebSocketForBaseTransport(transportParams);
        } else {
          // if we don't have a base transport to fallback to, just let the websocket connection attempt time out
          Logger.logAction(
            this.logger,
            Logger.LOG_MAJOR,
            'ConnectionManager WebSocket give up timer',
            'websocket connectivity appears to be unavailable but no other transports to try',
          );
        }
      }
    }, this.options.timeouts.webSocketConnectTimeout);
  }

  cancelWebSocketGiveUpTimer() {
    if (this.webSocketGiveUpTimer) {
      Platform.Config.clearTimeout(this.webSocketGiveUpTimer);
      this.webSocketGiveUpTimer = null;
    }
  }

  notifyState(indicated: ConnectionState): void {
    const state = indicated.state;

    /* We retry immediately if:
     * - something disconnects us while we're connected, or
     * - a viable (but not yet active) transport fails due to a token error (so
     *   this.errorReason will be set, and startConnect will do a forced
     *   authorize). If this.errorReason is already set (to a token error),
     *   then there has been at least one previous attempt to connect that also
     *   failed for a token error, so by RTN14b we go to DISCONNECTED and wait
     *   before trying again */
    const retryImmediately =
      state === 'disconnected' &&
      (this.state === this.states.connected ||
        indicated.retryImmediately ||
        (this.state === this.states.connecting &&
          indicated.error &&
          Auth.isTokenErr(indicated.error) &&
          !(this.errorReason && Auth.isTokenErr(this.errorReason as ErrorInfo))));

    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.notifyState()',
      'new state: ' + state + (retryImmediately ? '; will retry connection immediately' : ''),
    );
    /* do nothing if we're already in the indicated state */
    if (state == this.state.state) return;

    /* kill timers (possibly excepting suspend timer depending on the notified
     * state), as these are superseded by this notification */
    this.cancelTransitionTimer();
    this.cancelRetryTimer();
    this.cancelWebSocketSlowTimer();
    this.cancelWebSocketGiveUpTimer();
    this.checkSuspendTimer(indicated.state);

    if (state === 'suspended' || state === 'connected') {
      this.disconnectedRetryCount = 0;
    }

    /* do nothing if we're unable to move from the current state */
    if (this.state.terminal) return;

    /* process new state */
    const newState = this.states[indicated.state];

    let retryDelay = newState.retryDelay;
    if (newState.state === 'disconnected') {
      this.disconnectedRetryCount++;
      retryDelay = Utils.getRetryTime(newState.retryDelay as number, this.disconnectedRetryCount);
    }

    const change = new ConnectionStateChange(
      this.state.state,
      newState.state,
      retryDelay,
      indicated.error || (ConnectionErrors as Partial<Record<string, () => ErrorInfo>>)[newState.state]?.(),
    );

    if (retryImmediately) {
      const autoReconnect = () => {
        if (this.state === this.states.disconnected) {
          this.lastAutoReconnectAttempt = Platform.Config.now();
          this.requestState({ state: 'connecting' });
        }
      };
      const sinceLast = this.lastAutoReconnectAttempt && Platform.Config.now() - this.lastAutoReconnectAttempt + 1;
      if (sinceLast && sinceLast < 1000) {
        Logger.logAction(
          this.logger,
          Logger.LOG_MICRO,
          'ConnectionManager.notifyState()',
          'Last reconnect attempt was only ' +
            sinceLast +
            'ms ago, waiting another ' +
            (1000 - sinceLast) +
            'ms before trying again',
        );
        Platform.Config.setTimeout(autoReconnect, 1000 - sinceLast);
      } else {
        Platform.Config.nextTick(autoReconnect);
      }
    } else if (state === 'disconnected' || state === 'suspended') {
      this.startRetryTimer(retryDelay as number);
    }

    /* If going into disconnect/suspended (and not retrying immediately), or a
     * terminal state, ensure there are no orphaned transports hanging around. */
    if ((state === 'disconnected' && !retryImmediately) || state === 'suspended' || newState.terminal) {
      /* Wait till the next tick so the connection state change is enacted,
       * so aborting transports doesn't trigger redundant state changes */
      Platform.Config.nextTick(() => {
        this.disconnectAllTransports();
      });
    }

    if (state == 'connected' && !this.activeProtocol) {
      Logger.logAction(
        this.logger,
        Logger.LOG_ERROR,
        'ConnectionManager.notifyState()',
        'Broken invariant: attempted to go into connected state, but there is no active protocol',
      );
    }

    /* implement the change and notify */
    this.enactStateChange(change);
    if (this.state.sendEvents) {
      this.queuedPresenceToChannelQueues(); // RTL3d
      this.sendQueuedMessages();
    } else if (!this.state.queueEvents) {
      this.realtime.channels.propagateConnectionInterruption(state, change.reason);
      this.failQueuedMessages(change.reason as ErrorInfo); // RTN7c
    }
  }

  requestState(request: any): void {
    const state = request.state;
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.requestState()',
      'requested state: ' + state + '; current state: ' + this.state.state,
    );
    if (state == this.state.state) return; /* silently do nothing */

    /* kill running timers, as this request supersedes them */
    this.cancelWebSocketSlowTimer();
    this.cancelWebSocketGiveUpTimer();
    this.cancelTransitionTimer();
    this.cancelRetryTimer();
    /* for suspend timer check rather than cancel -- eg requesting a connecting
     * state should not reset the suspend timer */
    this.checkSuspendTimer(state);

    if (state == 'connecting' && this.state.state == 'connected') return;
    if (state == 'closing' && this.state.state == 'closed') return;

    const newState = this.states[state],
      change = new ConnectionStateChange(
        this.state.state,
        newState.state,
        null,
        request.error || (ConnectionErrors as Partial<Record<string, () => ErrorInfo>>)[newState.state]?.(),
      );

    this.enactStateChange(change);

    if (state == 'connecting') {
      Platform.Config.nextTick(() => {
        this.startConnect();
      });
    }
    if (state == 'closing') {
      this.closeImpl();
    }
  }

  startConnect(): void {
    if (this.state !== this.states.connecting) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'ConnectionManager.startConnect()',
        'Must be in connecting state to connect, but was ' + this.state.state,
      );
      return;
    }

    const auth = this.realtime.auth;

    /* The point of the connectCounter mechanism is to ensure that the
     * connection procedure can be cancelled. We want disconnectAllTransports
     * to be able to stop any in-progress connection, even before it gets to
     * the stage of having a pending (or even a proposed) transport that it can
     * dispose() of. So we check that it's still current after any async stage,
     * up until the stage that is synchronous with instantiating a transport */
    const connectCount = ++this.connectCounter;

    const connect = () => {
      this.getTransportParams((transportParams: TransportParams) => {
        if (transportParams.mode === 'recover' && transportParams.options.recover) {
          const recoveryContext = decodeRecoveryKey(transportParams.options.recover);
          if (recoveryContext) {
            this.realtime.channels.recoverChannels(recoveryContext.channelSerials);
          }
        }

        if (connectCount !== this.connectCounter) {
          return;
        }
        this.connectImpl(transportParams, connectCount);
      });
    };

    Logger.logAction(this.logger, Logger.LOG_MINOR, 'ConnectionManager.startConnect()', 'starting connection');
    this.startSuspendTimer();
    this.startTransitionTimer(this.states.connecting);

    if (auth.method === 'basic') {
      connect();
    } else {
      const authCb = (err: ErrorInfo | null) => {
        if (connectCount !== this.connectCounter) {
          return;
        }
        if (err) {
          this.actOnErrorFromAuthorize(err);
        } else {
          connect();
        }
      };
      if (this.errorReason && Auth.isTokenErr(this.errorReason as ErrorInfo)) {
        /* Force a refetch of a new token */
        Utils.whenPromiseSettles(auth._forceNewToken(null, null), authCb);
      } else {
        Utils.whenPromiseSettles(auth._ensureValidAuthCredentials(false), authCb);
      }
    }
  }

  /*
   * there are, at most, two transports available with which a connection may
   * be attempted: web_socket and/or a base transport (xhr_polling in browsers,
   * comet in nodejs). web_socket is always preferred, and the base transport is
   * only used in case web_socket connectivity appears to be unavailable.
   *
   * connectImpl begins the transport selection process by checking which transports
   * are available, and if there is a cached preference. It then defers to the
   * transport-specific connect methods: connectWs and connectBase.
   *
   * It is also responsible for invalidating the cache in the case that a base
   * transport preference is stored but web socket connectivity is now available.
   *
   * handling of the case where we need to failover from web_socket to the base
   * transport is implemented in the connectWs method.
   */
  connectImpl(transportParams: TransportParams, connectCount: number): void {
    const state = this.state.state;
    if (state !== this.states.connecting.state) {
      /* Only keep trying as long as in the 'connecting' state (or 'connected'
       * for upgrading). Any operation can put us into 'disconnected' to cancel
       * connection attempts and wait before retrying, or 'failed' to fail. */
      Logger.logAction(
        this.logger,

        Logger.LOG_MINOR,
        'ConnectionManager.connectImpl()',
        'Must be in connecting state to connect, but was ' + state,
      );
      return;
    }

    const transportPreference = this.getTransportPreference();

    // If transport preference is for a non-ws transport but websocket is now available, unpersist the preference for next time
    if (transportPreference && transportPreference === this.baseTransport && this.webSocketTransportAvailable) {
      this.checkWsConnectivity()
        .then(() => {
          this.unpersistTransportPreference();
          if (this.state === this.states.connecting) {
            Logger.logAction(
              this.logger,

              Logger.LOG_MINOR,
              'ConnectionManager.connectImpl():',
              'web socket connectivity available, cancelling connection attempt with ' + this.baseTransport,
            );
            this.disconnectAllTransports();
            this.connectWs(transportParams, ++this.connectCounter);
          }
        })
        .catch(noop);
    }

    if (
      (transportPreference && transportPreference === this.baseTransport) ||
      (this.baseTransport && !this.webSocketTransportAvailable)
    ) {
      this.connectBase(transportParams, connectCount);
    } else {
      this.connectWs(transportParams, connectCount);
    }
  }

  /*
   * connectWs starts two timers to monitor the success of a web_socket connection attempt:
   * - webSocketSlowTimer: if this timer fires before the connection succeeds,
   *   cm will simultaneously check websocket and http/xhr connectivity. if the http
   *   connectivity check fails, we give up the connection sequence entirely and
   *   transition to disconnected. if the websocket connectivity check fails then
   *   we assume no ws connectivity and failover to base transport. in the case that
   *   the checks succeed, we continue with websocket and wait for it to try fallback hosts
   *   and, if unsuccessful, ultimately transition to disconnected.
   * - webSocketGiveUpTimer: if this timer fires, and the preceding websocket
   *   connectivity check is still pending then we assume that there is an issue
   *   with the transport and fallback to base transport.
   */
  connectWs(transportParams: TransportParams, connectCount: number) {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'ConnectionManager.connectWs()');
    this.wsCheckResult = null;
    this.wsCheckPromise = null;
    this.abandonedWebSocket = false;
    this.startWebSocketSlowTimer();
    this.startWebSocketGiveUpTimer(transportParams);

    this.tryTransportWithFallbacks('web_socket', transportParams, true, connectCount, () => {
      return this.wsCheckResult !== false && !this.abandonedWebSocket;
    });
  }

  connectBase(transportParams: TransportParams, connectCount: number) {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'ConnectionManager.connectBase()');
    if (this.baseTransport) {
      this.tryTransportWithFallbacks(this.baseTransport, transportParams, false, connectCount, () => true);
    } else {
      this.notifyState({
        state: 'disconnected',
        error: new ErrorInfo('No transports left to try', 80000, 404),
      });
    }
  }

  /* Abandon the websocket transport and connect on the base transport instead. */
  abandonWebSocketForBaseTransport(transportParams: TransportParams): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'ConnectionManager.abandonWebSocketForBaseTransport()',
      'websocket connectivity appears to be unavailable; trying base transport',
    );
    this.abandonedWebSocket = true;
    this.cancelWebSocketSlowTimer();
    this.cancelWebSocketGiveUpTimer();
    this.proposedTransport?.dispose();
    this.pendingTransport?.dispose();
    this.connectBase(transportParams, ++this.connectCounter);
  }

  /*
   * Called when a websocket attempt has failed on every candidate host without
   * becoming viable. The webSocketGiveUpTimer only covers websocket attempts
   * that are *slow*; a network that rejects the upgrade outright fails every
   * host in milliseconds, and notifying `disconnected` cancels that timer. So
   * find out whether websockets work on this network at all before giving up.
   *
   * Returns whether it has taken over the connection attempt.
   */
  checkWsAvailabilityBeforeGivingUp(
    transportParams: TransportParams,
    connectCount: number,
    giveUp: (err: IPartialErrorInfo) => void,
  ): boolean {
    if (!this.baseTransport || this.abandonedWebSocket) {
      return false;
    }

    if (this.wsCheckResult) {
      /* Websockets work here, so the hosts are at fault rather than the
       * transport — same condition the give-up timer applies */
      return false;
    }

    this.checkWsConnectivityOnce().then((wsAvailable) => {
      if (connectCount !== this.connectCounter || this.abandonedWebSocket || this.state !== this.states.connecting) {
        /* Superseded, most likely by the give-up timer */
        return;
      }
      if (wsAvailable) {
        giveUp(new ErrorInfo('Unable to connect (and no more fallback hosts to try)', 80003, 404));
      } else {
        this.abandonWebSocketForBaseTransport(transportParams);
      }
    });

    /* If the check itself hangs, as on a network that silently drops
     * handshakes, the still-running give-up timer is what moves us on */
    return true;
  }

  /*
   * Runs the websocket connectivity check, at most once per websocket connection
   * attempt, recording the outcome in wsCheckResult. Never rejects; resolves to
   * whether websocket connectivity appears to be available.
   */
  checkWsConnectivityOnce(): Promise<boolean> {
    if (!this.wsCheckPromise) {
      this.wsCheckPromise = this.checkWsConnectivity().then(
        () => {
          this.wsCheckResult = true;
          return true;
        },
        () => {
          this.wsCheckResult = false;
          return false;
        },
      );
    }
    return this.wsCheckPromise;
  }

  tryTransportWithFallbacks(
    transportName: TransportName,
    transportParams: TransportParams,
    ws: boolean,
    connectCount: number,
    shouldContinue: () => boolean,
  ): void {
    Logger.logAction(
      this.logger,

      Logger.LOG_MICRO,
      'ConnectionManager.tryTransportWithFallbacks()',
      transportName,
    );
    const giveUp = (err: IPartialErrorInfo) => {
      this.notifyState({ state: this.states.connecting.failState as string, error: err });
    };

    const candidateHosts = this.domains.slice();

    const hostAttemptCb = (fatal: boolean, transport: Transport) => {
      if (connectCount !== this.connectCounter) {
        return;
      }
      if (!shouldContinue()) {
        if (transport) {
          transport.dispose();
        }
        return;
      }
      if (!transport && !fatal) {
        tryFallbackHosts();
      }
    };

    /* first try to establish a connection with the priority host with http transport */
    const host = candidateHosts.shift();
    if (!host) {
      giveUp(new ErrorInfo('Unable to connect (no available host)', 80003, 404));
      return;
    }
    transportParams.host = host;

    /* this is what we'll be doing if the attempt for the main host fails */
    const tryFallbackHosts = () => {
      /* if there aren't any fallback hosts, fail */
      if (!candidateHosts.length) {
        /* ...unless this was websocket, where the base transport may still work */
        if (ws && this.checkWsAvailabilityBeforeGivingUp(transportParams, connectCount, giveUp)) {
          return;
        }
        giveUp(new ErrorInfo('Unable to connect (and no more fallback hosts to try)', 80003, 404));
        return;
      }
      /* before trying any fallback (or any remaining fallback) we decide if
       * there is a problem with the ably host, or there is a general connectivity
       * problem */
      if (!this.realtime.http.checkConnectivity) {
        giveUp(new PartialErrorInfo('Internal error: Http.checkConnectivity not set', null, 500));
        return;
      }
      Utils.whenPromiseSettles(
        this.realtime.http.checkConnectivity(),
        (err?: ErrorInfo | null, connectivity?: boolean) => {
          if (connectCount !== this.connectCounter) {
            return;
          }
          if (!shouldContinue()) {
            return;
          }
          /* we know err won't happen but handle it here anyway */
          if (err) {
            giveUp(err);
            return;
          }
          if (!connectivity) {
            /* the internet isn't reachable, so don't try the fallback hosts */
            giveUp(new ErrorInfo('Unable to connect (network unreachable)', 80003, 404));
            return;
          }
          /* the network is there, so there's a problem with the main host, or
           * its dns. Try the fallback hosts. We could try them simultaneously but
           * that would potentially cause a huge spike in load on the load balancer */
          transportParams.host = Utils.arrPopRandomElement(candidateHosts);
          this.tryATransport(transportParams, transportName, hostAttemptCb);
        },
      );
    };

    if (this.forceFallbackHost && candidateHosts.length) {
      this.forceFallbackHost = false;
      tryFallbackHosts();
      return;
    }

    this.tryATransport(transportParams, transportName, hostAttemptCb);
  }

  closeImpl(): void {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'ConnectionManager.closeImpl()', 'closing connection');
    this.cancelSuspendTimer();
    this.startTransitionTimer(this.states.closing);

    if (this.pendingTransport) {
      Logger.logAction(
        this.logger,

        Logger.LOG_MICRO,
        'ConnectionManager.closeImpl()',
        'Closing pending transport: ' + this.pendingTransport,
      );
      this.pendingTransport.close();
    }

    if (this.activeProtocol) {
      Logger.logAction(
        this.logger,

        Logger.LOG_MICRO,
        'ConnectionManager.closeImpl()',
        'Closing active transport: ' + this.activeProtocol.getTransport(),
      );
      this.activeProtocol.getTransport().close();
    }

    /* If there was an active transport, this will probably be
     * preempted by the notifyState call in deactivateTransport */
    this.notifyState({ state: 'closed' });
  }

  onAuthUpdated(tokenDetails: API.TokenDetails, callback: Function): void {
    switch (this.state.state) {
      case 'connected': {
        Logger.logAction(
          this.logger,

          Logger.LOG_MICRO,
          'ConnectionManager.onAuthUpdated()',
          'Sending AUTH message on active transport',
        );

        /* Do any transport-specific new-token action */
        const activeTransport = this.activeProtocol?.getTransport();
        if (activeTransport && activeTransport.onAuthUpdated) {
          activeTransport.onAuthUpdated(tokenDetails);
        }

        const authMsg = protocolMessageFromValues({
          action: actions.AUTH,
          auth: {
            accessToken: tokenDetails.token,
          },
        });
        this.send(authMsg);

        /* The answer will come back as either a connectiondetails event
         * (realtime sends a CONNECTED to acknowledge the reauth) or a
         * statechange to failed */
        const successListener = () => {
          this.off(failureListener);
          callback(null, tokenDetails);
        };
        const failureListener = (stateChange: ConnectionStateChange) => {
          if (stateChange.current === 'failed') {
            this.off(successListener);
            this.off(failureListener);
            callback(stateChange.reason || this.getStateError());
          }
        };
        this.once('connectiondetails', successListener);
        this.on('connectionstate', failureListener);
        break;
      }

      case 'connecting':
        Logger.logAction(
          this.logger,

          Logger.LOG_MICRO,
          'ConnectionManager.onAuthUpdated()',
          'Aborting current connection attempts in order to start again with the new auth details',
        );
        this.disconnectAllTransports();
      /* fallthrough to add statechange listener */

      default: {
        Logger.logAction(
          this.logger,

          Logger.LOG_MICRO,
          'ConnectionManager.onAuthUpdated()',
          'Connection state is ' + this.state.state + '; waiting until either connected or failed',
        );
        const listener = (stateChange: ConnectionStateChange) => {
          switch (stateChange.current) {
            case 'connected':
              this.off(listener);
              callback(null, tokenDetails);
              break;
            case 'failed':
            case 'closed':
            case 'suspended':
              this.off(listener);
              callback(stateChange.reason || this.getStateError());
              break;
            default:
              /* ignore till we get either connected or failed */
              break;
          }
        };
        this.on('connectionstate', listener);
        if (this.state.state === 'connecting') {
          /* can happen if in the connecting state but no transport was pending
           * yet, so disconnectAllTransports did not trigger a disconnected state */
          this.startConnect();
        } else {
          this.requestState({ state: 'connecting' });
        }
      }
    }
  }

  disconnectAllTransports(): void {
    Logger.logAction(
      this.logger,

      Logger.LOG_MINOR,
      'ConnectionManager.disconnectAllTransports()',
      'Disconnecting all transports',
    );

    /* This will prevent any connection procedure in an async part of one of its early stages from continuing */
    this.connectCounter++;

    if (this.pendingTransport) {
      Logger.logAction(
        this.logger,

        Logger.LOG_MICRO,
        'ConnectionManager.disconnectAllTransports()',
        'Disconnecting pending transport: ' + this.pendingTransport,
      );
      this.pendingTransport.disconnect();
    }
    delete this.pendingTransport;

    if (this.proposedTransport) {
      Logger.logAction(
        this.logger,

        Logger.LOG_MICRO,
        'ConnectionManager.disconnectAllTransports()',
        'Disconnecting proposed transport: ' + this.pendingTransport,
      );
      this.proposedTransport.disconnect();
    }
    delete this.pendingTransport;

    if (this.activeProtocol) {
      Logger.logAction(
        this.logger,

        Logger.LOG_MICRO,
        'ConnectionManager.disconnectAllTransports()',
        'Disconnecting active transport: ' + this.activeProtocol.getTransport(),
      );
      this.activeProtocol.getTransport().disconnect();
    }
    /* No need to notify state disconnected; disconnecting the active transport
     * will have that effect */
  }

  /******************
   * event queueing
   ******************/

  send(msg: ProtocolMessage, queueEvent?: boolean, callback?: PublishCallback): void {
    callback = callback || noop;
    const state = this.state;

    if (state.sendEvents) {
      Logger.logAction(this.logger, Logger.LOG_MICRO, 'ConnectionManager.send()', 'sending event');
      this.sendImpl(new PendingMessage(msg, callback));
      return;
    }
    const shouldQueue = queueEvent && state.queueEvents;
    if (!shouldQueue) {
      const err = 'rejecting event, queueEvent was ' + queueEvent + ', state was ' + state.state;
      Logger.logAction(this.logger, Logger.LOG_MICRO, 'ConnectionManager.send()', err);
      callback(this.errorReason || new ErrorInfo(err, 90000, 400));
      return;
    }
    if (this.logger.shouldLog(Logger.LOG_MICRO)) {
      Logger.logAction(
        this.logger,

        Logger.LOG_MICRO,
        'ConnectionManager.send()',
        'queueing msg; ' +
          stringifyProtocolMessage(
            msg,
            this.realtime._RealtimePresence,
            this.realtime._Annotations,
            this.realtime._liveObjectsPlugin,
          ),
      );
    }
    this.queue(msg, callback);
  }

  sendImpl(pendingMessage: PendingMessage): void {
    const msg = pendingMessage.message;
    /* If have already attempted to send this, resend with the same msgSerial,
     * so Ably can dedup if the previous send succeeded */
    if (pendingMessage.ackRequired && !pendingMessage.sendAttempted) {
      msg.msgSerial = this.msgSerial++;
    }
    try {
      (this.activeProtocol as Protocol).send(pendingMessage);
    } catch (e) {
      Logger.logAction(
        this.logger,

        Logger.LOG_ERROR,
        'ConnectionManager.sendImpl()',
        'Unexpected exception in transport.send(): ' + (e as Error).stack,
      );
    }
  }

  queue(msg: ProtocolMessage, callback: PublishCallback): void {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'ConnectionManager.queue()', 'queueing event');
    this.queuedMessages.push(new PendingMessage(msg, callback));
  }

  /* RTL3d: queued presence messages must wait for their channel to (re-)attach
   * before being sent, so move them from the connection-wide queue onto the
   * relevant channel's presence queue (sent on attach, RTP5b) rather than
   * flushing them immediately on connect. Messages for channels that will not
   * re-attach are left on the queue for sendQueuedMessages to handle. */
  queuedPresenceToChannelQueues(): void {
    this.queuedMessages.messages = this.queuedMessages.messages.filter((pendingMessage) => {
      if (pendingMessage.message.action !== actions.PRESENCE) {
        return true;
      }
      const channelName = pendingMessage.message.channel;
      const channel = channelName ? this.realtime.channels.all[channelName] : undefined;
      return !(channel && channel.requeuePresenceFromConnectionQueue(pendingMessage));
    });
  }

  sendQueuedMessages(): void {
    Logger.logAction(
      this.logger,

      Logger.LOG_MICRO,
      'ConnectionManager.sendQueuedMessages()',
      'sending ' + this.queuedMessages.count() + ' queued messages',
    );
    let pendingMessage;
    while ((pendingMessage = this.queuedMessages.shift())) this.sendImpl(pendingMessage);
  }

  queuePendingMessages(pendingMessages: Array<PendingMessage>): void {
    if (pendingMessages && pendingMessages.length) {
      Logger.logAction(
        this.logger,

        Logger.LOG_MICRO,
        'ConnectionManager.queuePendingMessages()',
        'queueing ' + pendingMessages.length + ' pending messages',
      );
      this.queuedMessages.prepend(pendingMessages);
    }
  }

  failQueuedMessages(err: ErrorInfo): void {
    const numQueued = this.queuedMessages.count();
    if (numQueued > 0) {
      Logger.logAction(
        this.logger,

        Logger.LOG_ERROR,
        'ConnectionManager.failQueuedMessages()',
        'failing ' + numQueued + ' queued messages, err = ' + Utils.inspectError(err),
      );
      this.queuedMessages.completeAllMessages(err);
    }
  }

  onChannelMessage(message: ProtocolMessage, transport: Transport): void {
    this.pendingChannelMessagesState.queue.push({ message, transport });

    if (!this.pendingChannelMessagesState.isProcessing) {
      this.processNextPendingChannelMessage();
    }
  }

  private processNextPendingChannelMessage() {
    if (this.pendingChannelMessagesState.queue.length > 0) {
      this.pendingChannelMessagesState.isProcessing = true;

      const pendingChannelMessage = this.pendingChannelMessagesState.queue.shift()!;
      this.processChannelMessage(pendingChannelMessage.message)
        .catch((err) => {
          Logger.logAction(
            this.logger,

            Logger.LOG_ERROR,
            'ConnectionManager.processNextPendingChannelMessage() received error ',
            err,
          );
        })
        .finally(() => {
          this.pendingChannelMessagesState.isProcessing = false;
          this.processNextPendingChannelMessage();
        });
    }
  }

  private async processChannelMessage(message: ProtocolMessage) {
    await this.realtime.channels.processChannelMessage(message);
  }

  async ping(): Promise<number> {
    if (this.state.state !== 'connected') {
      throw new ErrorInfo({
        message: 'Unable to ping service: not connected',
        code: 40000,
        statusCode: 400,
        remediation:
          'Wait for connection.state to be "connected" before calling ping(). Use await connection.whenState("connected") or connection.once("connected", …). From the "closed" or "failed" state, or "initialized" with autoConnect disabled, the SDK does not connect automatically, so call connection.connect() first.',
      });
    }

    const transport = this.activeProtocol?.getTransport();
    if (!transport) {
      throw this.getStateError();
    }

    Logger.logAction(this.logger, Logger.LOG_MINOR, 'ConnectionManager.ping()', 'transport = ' + transport);

    const pingStart = Platform.Config.now();
    const id = Utils.cheapRandStr();

    return Utils.withTimeoutAsync<number>(
      new Promise((resolve) => {
        const onHeartbeat = (responseId: string) => {
          if (responseId === id) {
            transport.off('heartbeat', onHeartbeat);
            resolve(Platform.Config.now() - pingStart);
          }
        };
        transport.on('heartbeat', onHeartbeat);
        transport.ping(id);
      }),
      this.options.timeouts.realtimeRequestTimeout,
      'Timeout waiting for heartbeat response',
    );
  }

  abort(error: ErrorInfo): void {
    (this.activeProtocol as Protocol).getTransport().fail(error);
  }

  getTransportPreference(): TransportName {
    return this.transportPreference || (haveWebStorage() && Platform.WebStorage?.get?.(transportPreferenceName));
  }

  persistTransportPreference(transport: Transport): void {
    this.transportPreference = transport.shortName;
    if (haveWebStorage()) {
      Platform.WebStorage?.set?.(transportPreferenceName, transport.shortName);
    }
  }

  unpersistTransportPreference(): void {
    this.transportPreference = null;
    if (haveWebStorage()) {
      Platform.WebStorage?.remove?.(transportPreferenceName);
    }
  }

  /* This method is only used during connection attempts, so implements RSA4c1, RSA4c2,
   * and RSA4d. It is generally not invoked for serverside-triggered reauths or manual
   * reauths, so RSA4c3 does not apply, except (per per RSA4d1) in the case that the auth
   * server returns 403. */
  actOnErrorFromAuthorize(err: ErrorInfo): void {
    if (err.code === 40171) {
      /* No way to reauth */
      this.notifyState({ state: 'failed', error: err });
    } else if (err.code === 40102) {
      this.notifyState({ state: 'failed', error: err });
    } else if (err.statusCode === HttpStatusCodes.Forbidden) {
      const msg = 'Client configured authentication provider returned 403, failing the connection';
      Logger.logAction(this.logger, Logger.LOG_ERROR, 'ConnectionManager.actOnErrorFromAuthorize()', msg);
      const wrapped = new ErrorInfo({
        message: msg,
        code: 80019,
        statusCode: 403,
        cause: err,
        remediation:
          'Inspect cause for the underlying error, then fix your authUrl/authCallback so it does not respond 403 for a valid client.',
      });
      this.notifyState({ state: 'failed', error: wrapped });
    } else {
      const msg = 'Client configured authentication provider request failed';
      Logger.logAction(this.logger, Logger.LOG_MINOR, 'ConnectionManager.actOnErrorFromAuthorize', msg);
      const wrapped = new ErrorInfo({
        message: msg,
        code: 80019,
        statusCode: 401,
        cause: err,
        remediation:
          'Check network connectivity to your authUrl/authCallback endpoint and that it returns a valid token shape. Inspect cause for the underlying error.',
      });
      this.notifyState({ state: this.state.failState as string, error: wrapped });
    }
  }

  onConnectionDetailsUpdate(connectionDetails: Record<string, any>, transport: Transport): void {
    if (!connectionDetails) {
      return;
    }
    this.connectionDetails = connectionDetails;
    if (connectionDetails.maxMessageSize) {
      this.options.maxMessageSize = connectionDetails.maxMessageSize;
    }
    const clientId = connectionDetails.clientId;
    if (clientId) {
      const err = this.realtime.auth._uncheckedSetClientId(clientId);
      if (err) {
        Logger.logAction(this.logger, Logger.LOG_ERROR, 'ConnectionManager.onConnectionDetailsUpdate()', err.message);
        /* Errors setting the clientId are fatal to the connection */
        transport.fail(err);
        return;
      }
    }
    const connectionStateTtl = connectionDetails.connectionStateTtl;
    if (connectionStateTtl) {
      this.connectionStateTtl = connectionStateTtl;
    }
    this.maxIdleInterval = connectionDetails.maxIdleInterval;
    this.emit('connectiondetails', connectionDetails);
  }

  checkWsConnectivity() {
    const wsConnectivityCheckUrl = this.options.wsConnectivityCheckUrl || Defaults.wsConnectivityCheckUrl;
    const ws = new Platform.Config.WebSocket(wsConnectivityCheckUrl);
    return new Promise<void>((resolve, reject) => {
      let finished = false;
      ws.onopen = () => {
        if (!finished) {
          finished = true;
          resolve();
          ws.close();
        }
      };

      ws.onclose = ws.onerror = () => {
        if (!finished) {
          finished = true;
          reject();
        }
      };
    });
  }

  sessionRecoveryName() {
    return this.options.recoveryKeyStorageName || 'ably-connection-recovery';
  }

  getSessionRecoverData() {
    return haveSessionStorage() && Platform.WebStorage?.getSession?.(this.sessionRecoveryName());
  }
  setSessionRecoverData(value: any) {
    return haveSessionStorage() && Platform.WebStorage?.setSession?.(this.sessionRecoveryName(), value);
  }
  clearSessionRecoverData() {
    return haveSessionStorage() && Platform.WebStorage?.removeSession?.(this.sessionRecoveryName());
  }
}

export default ConnectionManager;

export interface TransportStorage {
  supportedTransports: Partial<Record<TransportName, TransportCtor>>;
}
