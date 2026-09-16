import Platform from 'common/platform';
import * as Utils from '../util/utils';
import Transport from './transport';
import Defaults, { formatHostForUri } from '../util/defaults';
import Logger from '../util/logger';
import ProtocolMessage, {
  serialize as serializeProtocolMessage,
  deserialize as deserializeProtocolMessage,
} from '../types/protocolmessage';
import ErrorInfo from '../types/errorinfo';
import NodeWebSocket from 'ws';
import ConnectionManager, { TransportParams } from './connectionmanager';
import Auth from '../client/auth';
import { TransportNames } from 'common/constants/TransportName';

const shortName = TransportNames.WebSocket;

function isNodeWebSocket(ws: WebSocket | NodeWebSocket): ws is NodeWebSocket {
  return !!(ws as NodeWebSocket).on;
}

class WebSocketTransport extends Transport {
  shortName = shortName;
  wsHost: string;
  uri?: string;
  wsConnection?: WebSocket | NodeWebSocket;

  constructor(connectionManager: ConnectionManager, auth: Auth, params: TransportParams) {
    super(connectionManager, auth, params);
    /* If is a browser, can't detect pings, so request protocol heartbeats */
    params.heartbeats = Platform.Config.useProtocolHeartbeats;
    this.wsHost = params.host as string;
  }

  static isAvailable() {
    return !!Platform.Config.WebSocket;
  }

  createWebSocket(uri: string, connectParams: Record<string, string>) {
    this.uri = uri + Utils.toQueryString(connectParams);
    return new Platform.Config.WebSocket(this.uri);
  }

  toString() {
    return 'WebSocketTransport; uri=' + this.uri;
  }

  connect() {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'WebSocketTransport.connect()', 'starting');
    Transport.prototype.connect.call(this);
    const self = this,
      params = this.params,
      options = params.options;
    const wsScheme = options.tls ? 'wss://' : 'ws://';
    const wsUri = wsScheme + formatHostForUri(this.wsHost) + ':' + Defaults.getPort(options) + '/';
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'WebSocketTransport.connect()', 'uri: ' + wsUri);
    Utils.whenPromiseSettles(
      this.auth.getAuthParams(),
      function (err: ErrorInfo | null, authParams?: Record<string, string>) {
        if (self.isDisposed) {
          return;
        }
        let paramStr = '';
        for (const param in authParams) paramStr += ' ' + param + ': ' + authParams[param] + ';';
        Logger.logAction(
          self.logger,
          Logger.LOG_MINOR,
          'WebSocketTransport.connect()',
          'authParams:' + paramStr + ' err: ' + err,
        );
        if (err) {
          self.disconnect(err);
          return;
        }
        const connectParams = params.getConnectParams(authParams!);
        try {
          const wsConnection = (self.wsConnection = self.createWebSocket(wsUri, connectParams));
          wsConnection.binaryType = Platform.Config.binaryType;
          wsConnection.onopen = function () {
            self.onWsOpen();
          };
          wsConnection.onclose = function (ev: CloseEvent) {
            self.onWsClose(ev);
          };
          wsConnection.onmessage = function (ev: MessageEvent) {
            self.onWsData(ev.data);
          };
          wsConnection.onerror = function (ev: Event) {
            self.onWsError(ev as ErrorEvent);
          };
          if (isNodeWebSocket(wsConnection)) {
            /* node; browsers currently don't have a general eventemitter and can't detect
             * pings. Also, no need to reply with a pong explicitly, ws lib handles that */
            wsConnection.on('ping', function () {
              self.onActivity();
            });
          }
        } catch (e) {
          Logger.logAction(
            self.logger,
            Logger.LOG_ERROR,
            'WebSocketTransport.connect()',
            'Unexpected exception creating websocket: err = ' + ((e as Error).stack || (e as Error).message),
          );
          self.disconnect(e as Error);
        }
      },
    );
  }

  send(message: ProtocolMessage) {
    const wsConnection = this.wsConnection;
    if (!wsConnection) {
      Logger.logAction(this.logger, Logger.LOG_ERROR, 'WebSocketTransport.send()', 'No socket connection');
      return;
    }
    try {
      (wsConnection as NodeWebSocket).send(
        serializeProtocolMessage(message, this.connectionManager.realtime._MsgPack, this.params.format),
      );
    } catch (e) {
      const msg = 'Exception from ws connection when trying to send: ' + Utils.inspectError(e);
      Logger.logAction(this.logger, Logger.LOG_ERROR, 'WebSocketTransport.send()', msg);
      /* Don't try to request a disconnect, that'll just involve sending data
       * down the websocket again. Just finish the transport. */
      this.finish('disconnected', new ErrorInfo(msg, 50000, 500));
    }
  }

  onWsData(data: string) {
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'WebSocketTransport.onWsData()',
      'data received; length = ' + data.length + '; type = ' + typeof data,
    );
    try {
      this.onProtocolMessage(
        deserializeProtocolMessage(
          data,
          this.connectionManager.realtime._MsgPack,
          this.connectionManager.realtime._RealtimePresence,
          this.connectionManager.realtime._Annotations,
          this.connectionManager.realtime._liveObjectsPlugin,
          this.format,
        ),
      );
    } catch (e) {
      Logger.logAction(
        this.logger,
        Logger.LOG_ERROR,
        'WebSocketTransport.onWsData()',
        'Unexpected exception handing channel message: ' + (e as Error).stack,
      );
    }
  }

  onWsOpen() {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'WebSocketTransport.onWsOpen()', 'opened WebSocket');
    this.emit('preconnect');
  }

  onWsClose(ev: number | CloseEvent) {
    let wasClean, code;
    if (typeof ev == 'object') {
      /* W3C spec-compatible */
      code = ev.code;
      // ev.wasClean is undefined in reactnative
      wasClean = ev.wasClean || code === 1000;
    } /*if(typeof(ev) == 'number')*/ else {
      /* ws in node */
      code = ev;
      wasClean = code == 1000;
    }
    delete this.wsConnection;
    if (wasClean) {
      Logger.logAction(this.logger, Logger.LOG_MINOR, 'WebSocketTransport.onWsClose()', 'Cleanly closed WebSocket');
      const err = new ErrorInfo('Websocket closed', 80003, 400);
      this.finish('disconnected', err);
    } else {
      const msg = 'Unclean disconnection of WebSocket ; code = ' + code,
        err = new ErrorInfo(msg, 80003, 400);
      Logger.logAction(this.logger, Logger.LOG_MINOR, 'WebSocketTransport.onWsClose()', msg);
      this.finish('disconnected', err);
    }
    this.emit('disposed');
  }

  onWsError(err: ErrorEvent) {
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'WebSocketTransport.onError()',
      'Error from WebSocket: ' + err.message,
    );
    /* Wait a tick before aborting: if the websocket was connected, this event
     * will be immediately followed by an onclose event with a close code. Allow
     * that to close it (so we see the close code) rather than anticipating it */
    Platform.Config.nextTick(() => {
      this.disconnect(Error(err.message));
    });
  }

  dispose() {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'WebSocketTransport.dispose()', '');
    this.isDisposed = true;
    const wsConnection = this.wsConnection;
    if (wsConnection) {
      /* Ignore any messages that come through after dispose() is called but before
       * websocket is actually closed. (mostly would be harmless, but if it's a
       * CONNECTED, it'll re-tick isConnected and cause all sorts of havoc) */
      wsConnection.onmessage = function () {};
      delete this.wsConnection;
      /* defer until the next event loop cycle before closing the socket,
       * giving some implementations the opportunity to send any outstanding close message */
      Platform.Config.nextTick(() => {
        Logger.logAction(this.logger, Logger.LOG_MICRO, 'WebSocketTransport.dispose()', 'closing websocket');
        if (!wsConnection) {
          throw new Error('WebSocketTransport.dispose(): wsConnection is not defined');
        }
        wsConnection.close();
      });
    }
  }
}

export default WebSocketTransport;
