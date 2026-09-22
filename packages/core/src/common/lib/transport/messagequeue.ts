import ErrorInfo from '../types/errorinfo';
import EventEmitter from '../util/eventemitter';
import Logger from '../util/logger';
import { PendingMessage } from './protocol';
import type * as API from '../../../../ably';

class MessageQueue extends EventEmitter {
  messages: Array<PendingMessage>;

  constructor(logger: Logger) {
    super(logger);
    this.messages = [];
  }

  count(): number {
    return this.messages.length;
  }

  push(message: PendingMessage): void {
    this.messages.push(message);
  }

  shift(): PendingMessage | undefined {
    return this.messages.shift();
  }

  last(): PendingMessage {
    return this.messages[this.messages.length - 1];
  }

  copyAll(): PendingMessage[] {
    return this.messages.slice();
  }

  append(messages: Array<PendingMessage>): void {
    this.messages.push.apply(this.messages, messages);
  }

  prepend(messages: Array<PendingMessage>): void {
    this.messages.unshift.apply(this.messages, messages);
  }

  /**
   * For all messages targeted by the selector, calls their callback and removes them from the queue.
   *
   * @param selector - Describes which messages to target. 'all' means all messages in the queue (regardless of whether they have had a `msgSerial` assigned); `serial` / `count` targets a range of messages described by an `ACK` or `NACK` received from Ably (this assumes that all the messages in the queue have had a `msgSerial` assigned).
   */
  completeMessages(
    selector: 'all' | { serial: number; count: number },
    err?: ErrorInfo | null,
    res?: API.PublishResult[],
  ): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'MessageQueue.completeMessages()',
      selector == 'all' ? '(all)' : 'serial = ' + selector.serial + '; count = ' + selector.count,
    );
    err = err || null;
    const messages = this.messages;
    if (messages.length === 0) {
      throw new Error('MessageQueue.completeMessages(): completeMessages called on any empty MessageQueue');
    }

    let completeMessages: PendingMessage[] = [];

    if (selector === 'all') {
      completeMessages = messages.splice(0);
    } else {
      const first = messages[0];
      if (first) {
        const startSerial = first.message.msgSerial as number;
        const endSerial =
          selector.serial + selector.count; /* the serial of the first message that is *not* the subject of this call */
        if (endSerial > startSerial) {
          completeMessages = messages.splice(0, endSerial - startSerial);
        }
      }
    }

    for (let i = 0; i < completeMessages.length; i++) {
      const message = completeMessages[i];
      const publishResponse = res?.[i];
      (message.callback as Function)(err, publishResponse);
    }

    if (messages.length == 0) this.emit('idle');
  }

  completeAllMessages(err: ErrorInfo): void {
    this.completeMessages('all', err);
  }

  resetSendAttempted(): void {
    for (let msg of this.messages) {
      msg.sendAttempted = false;
    }
  }

  clear(): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'MessageQueue.clear()',
      'clearing ' + this.messages.length + ' messages',
    );
    this.messages = [];
    this.emit('idle');
  }
}

export default MessageQueue;
