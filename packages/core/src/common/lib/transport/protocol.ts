import { actions } from '../types/protocolmessagecommon';
import ProtocolMessage, { stringify as stringifyProtocolMessage } from '../types/protocolmessage';
import * as Utils from '../util/utils';
import EventEmitter from '../util/eventemitter';
import Logger from '../util/logger';
import MessageQueue from './messagequeue';
import ErrorInfo from '../types/errorinfo';
import Transport from './transport';
import { StandardCallback, ErrCallback } from '../../types/utils';
import * as API from '../../../../ably';

export type PublishCallback = StandardCallback<API.PublishResult>;

export class PendingMessage {
  message: ProtocolMessage;
  callback?: PublishCallback;
  merged: boolean;
  sendAttempted: boolean;
  ackRequired: boolean;

  constructor(message: ProtocolMessage, callback?: PublishCallback) {
    this.message = message;
    this.callback = callback;
    this.merged = false;
    const action = message.action;
    this.sendAttempted = false;
    this.ackRequired =
      typeof action === 'number' &&
      [actions.MESSAGE, actions.PRESENCE, actions.ANNOTATION, actions.OBJECT].includes(action);
  }
}

class Protocol extends EventEmitter {
  transport: Transport;
  messageQueue: MessageQueue;

  constructor(transport: Transport) {
    super(transport.logger);
    this.transport = transport;
    this.messageQueue = new MessageQueue(this.logger);
    transport.on('ack', (serial: number, count: number, res?: API.PublishResult[]) => {
      this.onAck(serial, count, res);
    });
    transport.on('nack', (serial: number, count: number, err: ErrorInfo) => {
      this.onNack(serial, count, err);
    });
  }

  onAck(serial: number, count: number, res?: API.PublishResult[]): void {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'Protocol.onAck()', 'serial = ' + serial + '; count = ' + count);
    this.messageQueue.completeMessages({ serial, count }, null, res);
  }

  onNack(serial: number, count: number, err: ErrorInfo): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_ERROR,
      'Protocol.onNack()',
      'serial = ' + serial + '; count = ' + count + '; err = ' + Utils.inspectError(err),
    );
    if (!err) {
      err = new ErrorInfo('Unable to send message; channel not responding', 50001, 500);
    }
    this.messageQueue.completeMessages({ serial, count }, err);
  }

  onceIdle(listener: ErrCallback): void {
    const messageQueue = this.messageQueue;
    if (messageQueue.count() === 0) {
      listener();
      return;
    }
    messageQueue.once('idle', listener);
  }

  send(pendingMessage: PendingMessage): void {
    if (pendingMessage.ackRequired) {
      this.messageQueue.push(pendingMessage);
    }
    if (this.logger.shouldLog(Logger.LOG_MICRO)) {
      Logger.logActionNoStrip(
        this.logger,
        Logger.LOG_MICRO,
        'Protocol.send()',
        'sending msg; ' +
          stringifyProtocolMessage(
            pendingMessage.message,
            this.transport.connectionManager.realtime._RealtimePresence,
            this.transport.connectionManager.realtime._Annotations,
            this.transport.connectionManager.realtime._liveObjectsPlugin,
          ),
      );
    }
    pendingMessage.sendAttempted = true;
    this.transport.send(pendingMessage.message);
  }

  getTransport(): Transport {
    return this.transport;
  }

  getPendingMessages(): PendingMessage[] {
    return this.messageQueue.copyAll();
  }

  clearPendingMessages(): void {
    return this.messageQueue.clear();
  }

  finish(): void {
    const transport = this.transport;
    this.onceIdle(function () {
      transport.disconnect();
    });
  }
}

export default Protocol;
