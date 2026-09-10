import Logger from '../util/logger';
import { BaseMessage, encode, decode, wireToJSON, normalizeCipherOptions, strMsg } from './basemessage';
import * as API from '../../../../ably';
import * as Utils from '../util/utils';

import type { IUntypedCryptoStatic } from 'common/types/ICryptoStatic';
import type { Properties } from '../util/utils';
import type RestChannel from '../client/restchannel';
import type RealtimeChannel from '../client/realtimechannel';
import type { ChannelOptions } from '../../types/channel';
type Channel = RestChannel | RealtimeChannel;

const actions = ['absent', 'present', 'enter', 'leave', 'update'];

export async function fromEncoded(
  logger: Logger,
  Crypto: IUntypedCryptoStatic | null,
  encoded: WirePresenceMessage,
  inputOptions?: API.ChannelOptions,
): Promise<PresenceMessage> {
  const options = normalizeCipherOptions(Crypto, logger, inputOptions ?? null);
  const wpm = WirePresenceMessage.fromValues(encoded);
  return wpm.decode(options, logger);
}

export async function fromEncodedArray(
  logger: Logger,
  Crypto: IUntypedCryptoStatic | null,
  encodedArray: WirePresenceMessage[],
  options?: API.ChannelOptions,
): Promise<PresenceMessage[]> {
  return Promise.all(
    encodedArray.map(function (encoded) {
      return fromEncoded(logger, Crypto, encoded, options);
    }),
  );
}

// these forms of the functions are used internally when we have a channel instance
// already, so don't need to normalise channel options
export async function _fromEncoded(
  encoded: Properties<WirePresenceMessage>,
  channel: Channel,
): Promise<PresenceMessage> {
  return WirePresenceMessage.fromValues(encoded).decode(channel.channelOptions, channel.logger);
}

export async function _fromEncodedArray(
  encodedArray: Properties<WirePresenceMessage>[],
  channel: Channel,
): Promise<PresenceMessage[]> {
  return Promise.all(
    encodedArray.map(function (encoded) {
      return _fromEncoded(encoded, channel);
    }),
  );
}

// for tree-shakability
export function fromValues(values: Properties<PresenceMessage>) {
  return PresenceMessage.fromValues(values);
}

class PresenceMessage extends BaseMessage {
  action?: string;

  /* Returns whether this presenceMessage is synthesized, i.e. was not actually
   * sent by the connection (usually means a leave event sent 15s after a
   * disconnection). This is useful because synthesized messages cannot be
   * compared for newness by id lexicographically - RTP2b1
   */
  isSynthesized(): boolean {
    if (!this.id || !this.connectionId) {
      return true;
    }
    return this.id.substring(this.connectionId.length, 0) !== this.connectionId;
  }

  /* RTP2b2 */
  parseId(): { connectionId: string; msgSerial: number; index: number } {
    if (!this.id) throw new Error('parseId(): Presence message does not contain an id');
    const parts = this.id.split(':');
    return {
      connectionId: parts[0],
      msgSerial: parseInt(parts[1], 10),
      index: parseInt(parts[2], 10),
    };
  }

  async encode(options: ChannelOptions): Promise<WirePresenceMessage> {
    const res = Object.assign(new WirePresenceMessage(), this, {
      action: actions.indexOf(this.action || 'present'),
    });
    return encode(res, options);
  }

  static fromValues(values: Properties<PresenceMessage>): PresenceMessage {
    return Object.assign(new PresenceMessage(), values);
  }

  static fromValuesArray(values: Properties<PresenceMessage>[]): PresenceMessage[] {
    return values.map((v) => PresenceMessage.fromValues(v));
  }

  static fromData(data: any): PresenceMessage {
    if (data instanceof PresenceMessage) {
      return data;
    }
    return PresenceMessage.fromValues({
      data,
    });
  }

  toString() {
    return strMsg(this, 'PresenceMessage');
  }
}

export class WirePresenceMessage extends BaseMessage {
  action?: number;

  toJSON(...args: any[]) {
    return wireToJSON.call(this, ...args);
  }

  static fromValues(values: Properties<WirePresenceMessage>): WirePresenceMessage {
    return Object.assign(new WirePresenceMessage(), values);
  }

  static fromValuesArray(values: Properties<WirePresenceMessage>[]): WirePresenceMessage[] {
    return values.map((v) => WirePresenceMessage.fromValues(v));
  }

  async decode(channelOptions: ChannelOptions, logger: Logger): Promise<PresenceMessage> {
    const res = Object.assign(new PresenceMessage(), {
      ...this,
      action: actions[this.action!],
    });
    try {
      await decode(res, channelOptions);
    } catch (e) {
      Logger.logAction(logger, Logger.LOG_ERROR, 'WirePresenceMessage.decode()', Utils.inspectError(e));
    }
    return res;
  }

  toString() {
    return strMsg(this, 'WirePresenceMessage');
  }
}

export default PresenceMessage;
