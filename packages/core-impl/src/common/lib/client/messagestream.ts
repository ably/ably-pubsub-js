import * as API from '@ably/pubsub-core/api';
import ErrorInfo from '../types/errorinfo';
import Message from '../types/message';
import Logger from '../util/logger';
import Platform from '../../platform';
import type RealtimeChannel from './realtimechannel';

type MutationAction = 'message.update' | 'message.delete' | 'message.append';

/** A MessageOperation with the version.sequence the stream numbers a write with. */
export type SequencedOperation = API.MessageOperation & { sequence?: number };

/**
 * The fields of the stored message that the stream's writes change, as the
 * server holds them once every write the producer made has applied. A repair
 * publishes them as one update.
 */
export interface StreamContent {
  name?: string;
  data?: any;
  extras?: any;
}

interface Write {
  action: MutationAction;
  message: API.Message;
  operation?: API.MessageOperation;
  /** The write's place in the order the producer made them, from 1. */
  index: number;
  /** The server doesn't store an ephemeral write, so it carries no sequence and a repair doesn't include it. */
  ephemeral: boolean;
}

interface Waiter {
  index: number;
  resolve: (result: API.MessageStreamResult) => void;
  reject: (err: ErrorInfo) => void;
}

/**
 * How many times a repair is sent. A repair sent again after a 40901 uses the
 * stored sequence that 40901 reported. That happens when a write applied though
 * its outcome was lost, such as when the connection is lost before its ACK
 * arrives.
 */
const MAX_REPAIR_ATTEMPTS = 3;

/**
 * Returns the stored sequence that a 40901 reports in error.detail.sequence, or
 * undefined for any other error. The server chose the code, and it isn't
 * registered in ErrorCode yet, so it's read as a plain number.
 */
function storedSequence(err: ErrorInfo): number | undefined {
  const code: number | null | undefined = err?.code;
  if (code !== 40901) {
    return undefined;
  }
  const sequence = Number(err.detail?.sequence);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : undefined;
}

function isEphemeral(message: API.Message): boolean {
  return !!message.extras?.ephemeral;
}

function isNil(value: unknown): value is null | undefined {
  return value === null || value === undefined;
}

/**
 * Writes the updates, deletes and appends to one message, numbering each with
 * version.sequence (see AITDR-040 and AITDR-043). The server applies a
 * sequenced write only if its sequence is exactly one more than the stored
 * sequence, so a write that fails makes every later one fail too, and nothing
 * lands out of order or twice.
 *
 * Writes are sent as they're made and never awaited one by one. The stream
 * keeps the content the stored message should hold. When a write fails, the
 * stream waits for the outcome of every write already sent. It then publishes
 * that content as one update, numbered from the stored sequence the outcomes
 * reported, and sends the writes the producer made meanwhile after it.
 */
export class MessageStream implements API.MessageStream {
  readonly serial: string;
  private readonly channel: RealtimeChannel;
  private readonly logger: Logger;
  private readonly content: StreamContent;
  /** The sequence the stored message holds, as the latest outcome reported it. */
  private stored: number;
  /** The sequence the latest sequenced write was sent with. */
  private sent: number;
  /** How many writes the producer has made. */
  private issued = 0;
  /** The stored message holds every write up to this index. */
  private confirmed = 0;
  /** Writes sent with no outcome yet. A repair isn't counted. */
  private inflight = 0;
  /** Writes made while a repair is needed or under way, sent after it. */
  private held: Write[] = [];
  private repairNeeded = false;
  private repairing = false;
  /** The operation of the latest stored write, which a repair carries. */
  private lastOperation?: API.MessageOperation;
  /** The delete that ended the message, which a repair sends again. */
  private deletion?: Write;
  private closing?: Promise<API.MessageStreamResult>;
  private aborted = false;
  /** The error a repair couldn't fix, which stops the stream. */
  private error?: ErrorInfo;
  private waiters: Waiter[] = [];

  constructor(channel: RealtimeChannel, serial: string, content: StreamContent, sequence: number) {
    this.channel = channel;
    this.logger = channel.logger;
    this.serial = serial;
    this.content = { ...content };
    this.stored = sequence;
    this.sent = sequence;
  }

  append(message: API.Message, operation?: API.MessageOperation): void {
    this.throwIfNotWritable('append');
    const ephemeral = isEphemeral(message);
    if (!ephemeral) {
      // checked before anything changes, so a refused append leaves the stream as it was
      const data = this.concat(this.content.data, message.data);
      this.patch(message);
      this.content.data = data;
    }
    this.write({ action: 'message.append', message, operation, ephemeral });
  }

  update(message: API.Message, operation?: API.MessageOperation): void {
    this.throwIfNotWritable('update');
    const ephemeral = isEphemeral(message);
    if (!ephemeral) {
      this.patch(message);
      if (!isNil(message.data)) {
        this.content.data = message.data;
      }
    }
    this.write({ action: 'message.update', message, operation, ephemeral });
  }

  delete(message?: API.Message, operation?: API.MessageOperation): void {
    this.throwIfNotWritable('delete');
    const msg = message ?? {};
    const ephemeral = isEphemeral(msg);
    const write = this.write({ action: 'message.delete', message: msg, operation, ephemeral });
    if (!ephemeral) {
      this.deletion = write;
    }
  }

  async flush(): Promise<API.MessageStreamResult> {
    if (this.error) {
      throw this.error;
    }
    if (this.aborted) {
      throw this.abortedError();
    }
    return this.awaitConfirmed(this.issued);
  }

  // not async, so that a second call returns the first call's promise
  close(message?: API.Message, operation?: API.MessageOperation): Promise<API.MessageStreamResult> {
    if (!this.closing) {
      try {
        if (message) {
          this.append(message, operation);
        }
      } catch (err) {
        return Promise.reject(err);
      }
      Logger.logAction(this.logger, Logger.LOG_MICRO, 'MessageStream.close()', 'serial = ' + this.serial);
      this.closing = this.flush();
    }
    return this.closing;
  }

  abort(message?: API.Message, operation?: API.MessageOperation): void {
    if (this.aborted) {
      return;
    }
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'MessageStream.abort()',
      'serial = ' + this.serial + '; unconfirmed writes = ' + (this.issued - this.confirmed),
    );
    const stopped = !!this.error;
    this.aborted = true;
    this.held = [];
    if (message) {
      this.sendAbortMessage(message, operation);
    }
    // a stream stopped by an error has rejected its waiters already
    if (!stopped) {
      this.rejectWaiters(this.abortedError());
    }
  }

  /**
   * Sends abort()'s message as an update with no sequence, so that the server
   * applies it whatever sequence it holds: after a failed write the stream
   * doesn't know it. Its outcome isn't awaited, and a failure is only logged.
   */
  private sendAbortMessage(message: API.Message, operation?: API.MessageOperation): void {
    this.channel
      .sendUpdate(Message.fromValues({ ...message, serial: this.serial }), 'message.update', operation)
      .catch((err: ErrorInfo) => {
        Logger.logAction(
          this.logger,
          Logger.LOG_MINOR,
          'MessageStream.abort()',
          'abort message not sent; serial = ' + this.serial + '; err = ' + err,
        );
      });
  }

  private write(fields: Omit<Write, 'index'>): Write {
    const write: Write = { ...fields, index: ++this.issued };
    if (!write.ephemeral) {
      this.lastOperation = write.operation;
    }
    if (this.repairNeeded || this.repairing) {
      this.held.push(write);
    } else {
      this.send(write);
    }
    return write;
  }

  private send(write: Write): void {
    const sequence = write.ephemeral ? undefined : ++this.sent;
    // the server refuses a sequence on an ephemeral write
    const operation = sequence === undefined ? write.operation : { ...write.operation, sequence };
    this.inflight++;
    this.channel
      .sendUpdate(Message.fromValues({ ...write.message, serial: this.serial }), write.action, operation)
      .then(
        () => this.onAck(write, sequence),
        (err: ErrorInfo) => this.onNack(write, err),
      );
  }

  private onAck(write: Write, sequence: number | undefined): void {
    this.inflight--;
    if (this.isStopped()) {
      return;
    }
    if (sequence !== undefined) {
      this.stored = sequence;
    }
    // outcomes arrive in the order the writes were sent, so every earlier write has applied
    if (!this.repairNeeded) {
      this.advance(write.index);
    }
    this.maybeRepair();
  }

  private onNack(write: Write, err: ErrorInfo): void {
    this.inflight--;
    if (this.isStopped()) {
      return;
    }
    if (write.ephemeral) {
      // the server doesn't store an ephemeral write, so a repair can't restore it
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'MessageStream.onNack()',
        'ephemeral write not sent; serial = ' + this.serial + '; err = ' + err,
      );
      if (!this.repairNeeded) {
        this.advance(write.index);
      }
      this.maybeRepair();
      return;
    }
    const stored = storedSequence(err);
    if (stored !== undefined) {
      this.stored = stored;
    }
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'MessageStream.onNack()',
      'write failed, the stream will repair the message; serial = ' + this.serial + '; err = ' + err,
    );
    this.repairNeeded = true;
    this.maybeRepair();
  }

  /**
   * Starts a repair once no write is in flight. Until then a write still in
   * flight can apply, or report a newer stored sequence, and a repair sent
   * ahead of it could overtake it.
   */
  private maybeRepair(): void {
    if (this.repairNeeded && this.inflight === 0 && !this.repairing) {
      void this.repair();
    }
  }

  private async repair(): Promise<void> {
    this.repairNeeded = false;
    this.repairing = true;
    for (let attempt = 1; ; attempt++) {
      // the repair carries every write made so far, so the held writes aren't sent
      const covered = this.issued;
      this.held = [];
      const sequence = this.stored + 1;
      this.sent = sequence;
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'MessageStream.repair()',
        'serial = ' + this.serial + '; sequence = ' + sequence + '; attempt = ' + attempt,
      );
      try {
        await this.channel.sendUpdate(this.repairMessage(), this.deletion ? 'message.delete' : 'message.update', {
          ...this.lastOperation,
          sequence,
        });
      } catch (err) {
        if (this.isStopped()) {
          return;
        }
        const stored = storedSequence(err as ErrorInfo);
        if (stored !== undefined && attempt < MAX_REPAIR_ATTEMPTS) {
          this.stored = stored;
          continue;
        }
        this.fail(err as ErrorInfo);
        return;
      }
      if (this.isStopped()) {
        return;
      }
      this.stored = sequence;
      this.repairing = false;
      this.advance(covered);
      const held = this.held;
      this.held = [];
      for (const write of held) {
        this.send(write);
      }
      return;
    }
  }

  private repairMessage(): Message {
    if (this.deletion) {
      return Message.fromValues({ ...this.deletion.message, serial: this.serial });
    }
    return Message.fromValues({
      serial: this.serial,
      name: this.content.name,
      data: this.content.data,
      extras: this.content.extras,
    });
  }

  private fail(err: ErrorInfo): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_ERROR,
      'MessageStream.fail()',
      'unable to repair message; serial = ' + this.serial + '; err = ' + err,
    );
    this.error = err;
    this.repairing = false;
    this.held = [];
    this.rejectWaiters(err);
  }

  private advance(index: number): void {
    if (index <= this.confirmed) {
      return;
    }
    this.confirmed = index;
    const ready = this.waiters.filter((w) => w.index <= index);
    this.waiters = this.waiters.filter((w) => w.index > index);
    for (const waiter of ready) {
      waiter.resolve({ serial: this.serial });
    }
  }

  private awaitConfirmed(index: number): Promise<API.MessageStreamResult> {
    if (this.confirmed >= index) {
      return Promise.resolve({ serial: this.serial });
    }
    return new Promise((resolve, reject) => {
      this.waiters.push({ index, resolve, reject });
    });
  }

  private rejectWaiters(err: ErrorInfo): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const waiter of waiters) {
      waiter.reject(err);
    }
  }

  private isStopped(): boolean {
    return this.aborted || !!this.error;
  }

  /** Server-side, ConcatData joins two strings or two binaries, and refuses anything else. */
  private concat(existing: any, appended: any): any {
    if (isNil(appended)) {
      return existing;
    }
    if (isNil(existing)) {
      return appended;
    }
    if (typeof existing === 'string' && typeof appended === 'string') {
      return existing + appended;
    }
    const bufferUtils = Platform.BufferUtils;
    if (bufferUtils.isBuffer(existing) && bufferUtils.isBuffer(appended)) {
      return bufferUtils.concat([existing, appended]);
    }
    throw new ErrorInfo({
      message:
        'Unable to append to stream; the appended data and the message data must both be strings or both be binary',
      code: 40003,
      statusCode: 400,
      remediation:
        'Append data of the same type as the message data: a string to a string, or binary to binary. To change the type, call stream.update() with the new data.',
    });
  }

  /** As the server does, a write that sets name or extras replaces them, and one that doesn't keeps them. */
  private patch(message: API.Message): void {
    if (!isNil(message.name)) {
      this.content.name = message.name;
    }
    if (!isNil(message.extras)) {
      this.content.extras = message.extras;
    }
  }

  private throwIfNotWritable(method: string): void {
    if (this.error) {
      throw this.error;
    }
    if (this.aborted) {
      throw this.abortedError();
    }
    if (this.closing) {
      throw new ErrorInfo({
        message: `Unable to ${method}; the stream is closed`,
        code: 40000,
        statusCode: 400,
        remediation:
          'Make every write before calling stream.close(). To write to the message again, call channel.adoptStream() with its serial.',
      });
    }
    if (this.deletion) {
      throw new ErrorInfo({
        message: `Unable to ${method}; the stream deleted its message`,
        code: 40000,
        statusCode: 400,
        remediation: 'Make no writes after stream.delete(). Call stream.close() to wait for the delete to apply.',
      });
    }
  }

  private abortedError(): ErrorInfo {
    return new ErrorInfo({
      message: 'Stream aborted; stream.abort() was called before every write applied',
      code: 40000,
      statusCode: 400,
      remediation: 'Call stream.close() instead of stream.abort() to wait for every write to apply.',
    });
  }
}

export default MessageStream;
