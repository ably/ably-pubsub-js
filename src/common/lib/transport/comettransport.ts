import * as Utils from '../util/utils';
import { actions } from '../types/protocolmessagecommon';
import ProtocolMessage, {
  fromValues as protocolMessageFromValues,
  fromDeserialized as protocolMessageFromDeserialized,
} from '../types/protocolmessage';
import Transport from './transport';
import Logger from '../util/logger';
import Defaults, { formatHostForUri } from '../util/defaults';
import ConnectionErrors from './connectionerrors';
import Auth from '../client/auth';
import ErrorInfo from '../types/errorinfo';
import IXHRRequest from '../../types/IXHRRequest';
import * as API from '../../../../ably';
import ConnectionManager, { TransportParams } from './connectionmanager';
import XHRStates from '../../constants/XHRStates';
import Platform from 'common/platform';

/* TODO: can remove once realtime sends protocol message responses for comet errors */
function shouldBeErrorAction(err: ErrorInfo) {
  const UNRESOLVABLE_ERROR_CODES = [80015, 80017, 80030];
  if (err.code) {
    if (Auth.isTokenErr(err)) return false;
    if (UNRESOLVABLE_ERROR_CODES.includes(err.code)) return true;
    return err.code >= 40000 && err.code < 50000;
  } else {
    /* Likely a network or transport error of some kind. Certainly not fatal to the connection */
    return false;
  }
}

function protocolMessageFromRawError(err: ErrorInfo) {
  /* err will be either a legacy (non-protocolmessage) comet error response
   * (which will have an err.code), or a xhr/network error (which won't). */
  if (shouldBeErrorAction(err)) {
    return [protocolMessageFromValues({ action: actions.ERROR, error: err })];
  } else {
    return [protocolMessageFromValues({ action: actions.DISCONNECTED, error: err })];
  }
}

/*
 * A base comet transport class
 */
abstract class CometTransport extends Transport {
  stream: string | boolean;
  sendRequest: IXHRRequest | null;
  recvRequest: null | IXHRRequest;
  pendingCallback: null;
  pendingItems: null | Array<ProtocolMessage>;
  baseUri?: string;
  authParams?: Record<string, any>;
  closeUri?: string;
  disconnectUri?: string;
  sendUri?: string;
  recvUri?: string;

  constructor(connectionManager: ConnectionManager, auth: Auth, params: TransportParams) {
    super(connectionManager, auth, params, /* binary not supported for comet so force JSON protocol */ true);
    this.stream = 'stream' in params ? params.stream : true;
    this.sendRequest = null;
    this.recvRequest = null;
    this.pendingCallback = null;
    this.pendingItems = null;
  }

  abstract createRequest(
    uri: string,
    headers: Record<string, string> | null,
    params?: Record<string, unknown> | null,
    body?: unknown,
    requestMode?: number,
  ): IXHRRequest;

  connect(): void {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'CometTransport.connect()', 'starting');
    Transport.prototype.connect.call(this);
    const params = this.params;
    const options = params.options;
    const host = params.host || options.primaryDomain;
    const port = Defaults.getPort(options);
    const cometScheme = options.tls ? 'https://' : 'http://';

    this.baseUri = cometScheme + formatHostForUri(host) + ':' + port + '/comet/';
    const connectUri = this.baseUri + 'connect';
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'CometTransport.connect()', 'uri: ' + connectUri);
    Utils.whenPromiseSettles(this.auth.getAuthParams(), (err: Error | null, authParams?: Record<string, any>) => {
      if (err) {
        this.disconnect(err);
        return;
      }
      if (this.isDisposed) {
        return;
      }
      this.authParams = authParams;
      const connectParams = this.params.getConnectParams(authParams!);
      if ('stream' in connectParams) this.stream = connectParams.stream;
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'CometTransport.connect()',
        'connectParams:' + Utils.toQueryString(connectParams),
      );

      /* this will be the 'recvRequest' so this connection can stream messages */
      let preconnected = false;
      const connectRequest = (this.recvRequest = this.createRequest(
        connectUri,
        null,
        connectParams,
        null,
        this.stream ? XHRStates.REQ_RECV_STREAM : XHRStates.REQ_RECV,
      ));

      connectRequest.on('data', (data: any) => {
        if (!this.recvRequest) {
          /* the transport was disposed before we connected */
          return;
        }
        if (!preconnected) {
          preconnected = true;
          this.emit('preconnect');
        }
        this.onData(data);
      });
      connectRequest.on('complete', (err: ErrorInfo) => {
        if (!this.recvRequest) {
          /* the transport was disposed before we connected */
          err = err || new ErrorInfo('Request cancelled', 80003, 400);
        }
        this.recvRequest = null;
        /* Connect request may complete without a emitting 'data' event since that is not
         * emitted for e.g. a non-streamed error response. Still implies preconnect. */
        if (!preconnected && !err) {
          preconnected = true;
          this.emit('preconnect');
        }
        this.onActivity();
        if (err) {
          if (err.code) {
            /* A protocol error received from realtime. TODO: once realtime
             * consistendly sends errors wrapped in protocol messages, should be
             * able to remove this */
            this.onData(protocolMessageFromRawError(err));
          } else {
            /* A network/xhr error. Don't bother wrapping in a protocol message,
             * just disconnect the transport */
            this.disconnect(err);
          }
          return;
        }
        Platform.Config.nextTick(() => {
          this.recv();
        });
      });
      connectRequest.exec();
    });
  }

  requestClose(): void {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'CometTransport.requestClose()');
    this._requestCloseOrDisconnect(true);
  }

  requestDisconnect(): void {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'CometTransport.requestDisconnect()');
    this._requestCloseOrDisconnect(false);
  }

  _requestCloseOrDisconnect(closing: boolean): void {
    const closeOrDisconnectUri = closing ? this.closeUri : this.disconnectUri;
    if (closeOrDisconnectUri) {
      const request = this.createRequest(closeOrDisconnectUri, null, this.authParams, null, XHRStates.REQ_SEND);

      request.on('complete', (err: ErrorInfo) => {
        if (err) {
          Logger.logAction(
            this.logger,
            Logger.LOG_ERROR,
            'CometTransport.request' + (closing ? 'Close()' : 'Disconnect()'),
            'request returned err = ' + Utils.inspectError(err),
          );
          this.finish('disconnected', err);
        }
      });
      request.exec();
    }
  }

  dispose(): void {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'CometTransport.dispose()', '');
    if (!this.isDisposed) {
      this.isDisposed = true;
      if (this.recvRequest) {
        Logger.logAction(this.logger, Logger.LOG_MINOR, 'CometTransport.dispose()', 'aborting recv request');
        this.recvRequest.abort();
        this.recvRequest = null;
      }
      /* In almost all cases the transport will be finished before it's
       * disposed. Finish here just to make sure. */
      this.finish('disconnected', ConnectionErrors.disconnected());
      Platform.Config.nextTick(() => {
        this.emit('disposed');
      });
    }
  }

  onConnect(message: ProtocolMessage): void {
    /* if this transport has been disposed whilst awaiting connection, do nothing */
    if (this.isDisposed) {
      return;
    }

    /* the connectionKey in a comet connected response is really
     * <instId>-<connectionKey> */
    const connectionStr = message.connectionDetails?.connectionKey;
    Transport.prototype.onConnect.call(this, message);

    const baseConnectionUri = (this.baseUri as string) + connectionStr;
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'CometTransport.onConnect()', 'baseUri = ' + baseConnectionUri);
    this.sendUri = baseConnectionUri + '/send';
    this.recvUri = baseConnectionUri + '/recv';
    this.closeUri = baseConnectionUri + '/close';
    this.disconnectUri = baseConnectionUri + '/disconnect';
  }

  send(message: ProtocolMessage): void {
    if (this.sendRequest) {
      /* there is a pending send, so queue this message */
      this.pendingItems = this.pendingItems || [];
      this.pendingItems.push(message);
      return;
    }
    /* send this, plus any pending, now */
    const pendingItems = this.pendingItems || [];
    pendingItems.push(message);
    this.pendingItems = null;

    this.sendItems(pendingItems);
  }

  sendAnyPending(): void {
    const pendingItems = this.pendingItems;

    if (!pendingItems) {
      return;
    }

    this.pendingItems = null;
    this.sendItems(pendingItems);
  }

  sendItems(items: Array<ProtocolMessage>): void {
    const sendRequest = (this.sendRequest = this.createRequest(
      this.sendUri as string,
      null,
      this.authParams,
      this.encodeRequest(items),
      XHRStates.REQ_SEND,
    ));

    sendRequest.on('complete', (err: ErrorInfo, data: string) => {
      if (err)
        Logger.logAction(
          this.logger,
          Logger.LOG_ERROR,
          'CometTransport.sendItems()',
          'on complete: err = ' + Utils.inspectError(err),
        );
      this.sendRequest = null;

      /* the result of the request, even if a nack, is usually a protocol response
       * contained in the data. An err is anomolous, and indicates some issue with the
       * network,transport, or connection */
      if (err) {
        if (err.code) {
          /* A protocol error received from realtime. TODO: once realtime
           * consistendly sends errors wrapped in protocol messages, should be
           * able to remove this */
          this.onData(protocolMessageFromRawError(err));
        } else {
          /* A network/xhr error. Don't bother wrapping in a protocol message,
           * just disconnect the transport */
          this.disconnect(err);
        }
        return;
      }

      if (data) {
        this.onData(data);
      }

      if (this.pendingItems) {
        Platform.Config.nextTick(() => {
          /* If there's a new send request by now, any pending items will have
           * been picked up by that; any new ones added since then will be
           * picked up after that one completes */
          if (!this.sendRequest) {
            this.sendAnyPending();
          }
        });
      }
    });
    sendRequest.exec();
  }

  recv(): void {
    /* do nothing if there is an active request, which might be streaming */
    if (this.recvRequest) return;

    /* If we're no longer connected, do nothing */
    if (!this.isConnected) return;

    const recvRequest = (this.recvRequest = this.createRequest(
      this.recvUri as string,
      null,
      this.authParams,
      null,
      this.stream ? XHRStates.REQ_RECV_STREAM : XHRStates.REQ_RECV_POLL,
    ));

    recvRequest.on('data', (data: string) => {
      this.onData(data);
    });
    recvRequest.on('complete', (err: ErrorInfo) => {
      this.recvRequest = null;
      /* A request completing must be considered activity, as realtime sends
       * heartbeats every 15s since a request began, not every 15s absolutely */
      this.onActivity();
      if (err) {
        if (err.code) {
          /* A protocol error received from realtime. TODO: once realtime
           * consistently sends errors wrapped in protocol messages, should be
           * able to remove this */
          this.onData(protocolMessageFromRawError(err));
        } else {
          /* A network/xhr error. Don't bother wrapping in a protocol message,
           * just disconnect the transport */
          this.disconnect(err);
        }
        return;
      }
      Platform.Config.nextTick(() => {
        this.recv();
      });
    });
    recvRequest.exec();
  }

  onData(responseData: string | Record<string, any>): void {
    try {
      const items = this.decodeResponse(responseData);
      if (items && items.length)
        for (let i = 0; i < items.length; i++)
          this.onProtocolMessage(
            protocolMessageFromDeserialized(
              items[i],
              this.connectionManager.realtime._RealtimePresence,
              this.connectionManager.realtime._Annotations,
              this.connectionManager.realtime._liveObjectsPlugin,
            ),
          );
    } catch (e) {
      Logger.logAction(
        this.logger,
        Logger.LOG_ERROR,
        'CometTransport.onData()',
        'Unexpected exception handing channel event: ' + (e as Error).stack,
      );
    }
  }

  encodeRequest(requestItems: Array<ProtocolMessage>): string {
    return JSON.stringify(requestItems);
  }

  decodeResponse(responseData: string | Record<string, any>): Record<string, any> {
    if (typeof responseData == 'string') return JSON.parse(responseData);
    return responseData;
  }

  /* Historical comment, back from when we supported JSONP:
   *
   * > For comet, we could do the auth update by aborting the current recv and
   * > starting a new one with the new token, that'd be sufficient for realtime.
   * > Problem is JSONP - you can't cancel truly abort a recv once started. So
   * > we need to send an AUTH for jsonp. In which case it's simpler to keep all
   * > comet transports the same and do it for all of them. So we send the AUTH
   * > instead, and don't need to abort the recv
   *
   * Now that we’ve dropped JSONP support, we may be able to revisit the above;
   * see https://github.com/ably/ably-js/issues/1214.
   */
  onAuthUpdated = (tokenDetails: API.TokenDetails): void => {
    this.authParams = { access_token: tokenDetails.token };
  };
}

export default CometTransport;
