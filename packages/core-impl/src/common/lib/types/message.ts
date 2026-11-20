import Logger from '../util/logger';
import Platform from 'common/platform';
import {
  BaseMessage,
  encode,
  decode,
  wireToJSON,
  normalizeCipherOptions,
  encodeDataForWire,
  decodeData,
  EncodingDecodingContext,
  strMsg,
} from './basemessage';
import * as Utils from '../util/utils';
import * as API from '@ably/pubsub-core/api';

import type { IUntypedCryptoStatic } from 'common/types/ICryptoStatic';
import type { ChannelOptions } from '../../types/channel';
import type { Properties } from '../util/utils';
import type HttpChannel from '../client/httpchannel';
import type RealtimeChannel from '../client/realtimechannel';
import type ErrorInfo from './errorinfo';
type Channel = HttpChannel | RealtimeChannel;

const actions: API.MessageAction[] = [
  'message.create',
  'message.update',
  'message.delete',
  'meta',
  'message.summary',
  'message.append',
  'message.patch',
];

export function stringifyAction(action: number | undefined): API.MessageAction {
  return actions[action || 0] || 'unknown';
}

export function encodeAction(action: API.MessageAction): number {
  return actions.indexOf(action || 'message.create');
}

function getMessageSize(msg: WireMessage) {
  let size = 0;
  if (msg.name) {
    size += msg.name.length;
  }
  if (msg.clientId) {
    size += msg.clientId.length;
  }
  if (msg.extras) {
    size += JSON.stringify(msg.extras).length;
  }
  if (msg.data) {
    size += Utils.dataSizeBytes(msg.data);
  }
  return size;
}

export async function fromEncoded(
  logger: Logger,
  Crypto: IUntypedCryptoStatic | null,
  encoded: Properties<WireMessage>,
  inputOptions?: API.ChannelOptions,
): Promise<Message> {
  const options = normalizeCipherOptions(Crypto, logger, inputOptions ?? null);
  const wm = WireMessage.fromValues(encoded);
  return wm.decode(options, logger);
}

export async function fromEncodedArray(
  logger: Logger,
  Crypto: IUntypedCryptoStatic | null,
  encodedArray: Array<WireMessage>,
  options?: API.ChannelOptions,
): Promise<Message[]> {
  return Promise.all(
    encodedArray.map(function (encoded) {
      return fromEncoded(logger, Crypto, encoded, options);
    }),
  );
}

// these forms of the functions are used internally when we have a channel instance
// already, so don't need to normalise channel options
export async function _fromEncoded(encoded: Properties<WireMessage>, channel: Channel): Promise<Message> {
  const wm = WireMessage.fromValues(encoded);
  return wm.decode(channel.channelOptions, channel.logger);
}

export async function _fromEncodedArray(encodedArray: Properties<WireMessage>[], channel: Channel): Promise<Message[]> {
  return Promise.all(
    encodedArray.map(function (encoded) {
      return _fromEncoded(encoded, channel);
    }),
  );
}

export async function encodeArray(messages: Array<Message>, options: ChannelOptions): Promise<Array<WireMessage>> {
  return Promise.all(messages.map((message) => message.encode(options)));
}

export const serialize = Utils.encodeBody;

// Returns patches with each data operation's value encoded as a message's data
// is, by encodeData or encodeDataForWire
function mapPatchData(
  patches: API.MessagePatches,
  fn: (data: any, encoding: string | null | undefined) => { data: any; encoding: string | null | undefined },
): API.MessagePatches {
  if (!patches.data) {
    return patches;
  }
  return {
    ...patches,
    data: patches.data.map((op) => {
      if (op.data === undefined) {
        return op;
      }
      const { data, encoding } = fn(op.data, op.encoding);
      return { ...op, data, encoding: encoding ?? undefined };
    }),
  };
}

// Encodes a data operation's value. Unlike a message's data, it can be any
// JSON value, such as true, so everything but a string or binary is JSON.
function encodePatchValue(data: any, encoding: string | null | undefined) {
  if (typeof data === 'string' || Platform.BufferUtils.isBuffer(data)) {
    return { data, encoding };
  }
  return { data: JSON.stringify(data), encoding: encoding ? encoding + '/json' : 'json' };
}

// Decodes each data operation's value as a message's data is decoded, except
// that a JSON value stays as text with `encoding: json`: applyPatch splices the
// text into JSON text, and parses it only to set it into decoded values
async function decodePatches(patches: API.MessagePatches): Promise<API.MessagePatches> {
  if (!patches.data) {
    return patches;
  }
  const data = await Promise.all(
    patches.data.map(async (wireOp) => {
      const xforms = wireOp.encoding ? wireOp.encoding.split('/') : [];
      const isJSON = xforms[0] === 'json';
      const toDecode = (isJSON ? xforms.slice(1) : xforms).join('/');
      if (!toDecode) {
        return wireOp;
      }
      // encrypted channels do not support patches, so no cipher is needed
      const decoded = await decodeData(wireOp.data, toDecode, { channelOptions: {}, plugins: {} });
      if (decoded.error) {
        throw decoded.error;
      }
      const op: API.MessagePatchDataOperation = { ...wireOp, data: decoded.data };
      const encoding = isJSON ? ['json', decoded.encoding].filter(Boolean).join('/') : decoded.encoding;
      if (encoding) {
        op.encoding = encoding;
      } else {
        delete op.encoding;
      }
      return op;
    }),
  );
  return { ...patches, data };
}

/* This should be called on encode()d (and encrypt()d) Messages (as it
 * assumes the data is a string or buffer) */
export function getMessagesSize(messages: WireMessage[]): number {
  let msg,
    total = 0;
  for (let i = 0; i < messages.length; i++) {
    msg = messages[i];
    total += msg.size || (msg.size = getMessageSize(msg));
  }
  return total;
}

class Message extends BaseMessage {
  name?: string;
  connectionKey?: string;
  action?: API.MessageAction;
  serial?: string;
  version?: API.MessageVersion;
  annotations?: API.MessageAnnotations;
  patches?: API.MessagePatches;

  expandFields() {
    // TM2s
    if (!this.version) {
      this.version = {};
    }

    // TM2s1
    if (!this.version.serial && this.serial) {
      this.version.serial = this.serial;
    }

    // TM2s2
    if (!this.version.timestamp && this.timestamp) {
      this.version.timestamp = this.timestamp;
    }

    if (!this.annotations) {
      // TM2u
      this.annotations = {
        summary: {},
      };
    } else if (!this.annotations.summary) {
      // TM8a
      this.annotations.summary = {};
    }
    if (this.annotations && this.annotations.summary) {
      // Ensure clipped field is set to false where not explicitly provided
      for (const [type, summaryEntry] of Object.entries(this.annotations.summary)) {
        if (type.endsWith(':distinct.v1') || type.endsWith(':unique.v1') || type.endsWith(':multiple.v1')) {
          for (const [, entry] of Object.entries(summaryEntry)) {
            // TM7c1c, TM7d1c
            if (!entry.clipped) {
              entry.clipped = false;
            }
          }
        } else if (type.endsWith(':flag.v1')) {
          // TM7c1c
          if (!(summaryEntry as API.SummaryClientIdList).clipped) {
            (summaryEntry as API.SummaryClientIdList).clipped = false;
          }
        }
      }
    }
  }

  async encode(options: ChannelOptions): Promise<WireMessage> {
    const res = Object.assign(new WireMessage(), this, {
      action: actions.indexOf(this.action || 'message.create'),
      ...(this.patches && { patches: mapPatchData(this.patches, encodePatchValue) }),
    });
    return encode(res, options);
  }

  static fromValues(values: Properties<Message>): Message {
    return Object.assign(new Message(), values);
  }

  static fromValuesArray(values: Properties<Message>[]): Message[] {
    return values.map((v) => Message.fromValues(v));
  }

  toString() {
    return strMsg(this, 'Message');
  }
}

export class WireMessage extends BaseMessage {
  name?: string;
  connectionKey?: string;
  action?: number;
  serial?: string;
  version?: API.MessageVersion;
  annotations?: API.MessageAnnotations;
  patches?: API.MessagePatches;

  // Overload toJSON() to intercept JSON.stringify()
  toJSON(...args: any[]) {
    const result = wireToJSON.call(this, ...args);
    if (this.patches) {
      // as wireToJSON does, infer the format from the arguments
      const format = args.length > 0 ? Utils.Format.json : Utils.Format.msgpack;
      result.patches = mapPatchData(this.patches, (data, encoding) => encodeDataForWire(data, encoding, format));
    }
    return result;
  }

  static fromValues(values: Properties<WireMessage>): WireMessage {
    return Object.assign(new WireMessage(), values);
  }

  static fromValuesArray(values: Properties<WireMessage>[]): WireMessage[] {
    return values.map((v) => WireMessage.fromValues(v));
  }

  // for contexts where some decoding errors need to be handled specially by the caller
  async decodeWithErr(
    inputContext: EncodingDecodingContext | ChannelOptions,
    logger: Logger,
  ): Promise<{ decoded: Message; err: ErrorInfo | undefined }> {
    const res: Message = Object.assign(new Message(), {
      ...this,
      action: stringifyAction(this.action),
    });
    let err: ErrorInfo | undefined;
    try {
      await decode(res, inputContext);
      if (res.patches) {
        res.patches = await decodePatches(res.patches);
      }
    } catch (e) {
      Logger.logAction(logger, Logger.LOG_ERROR, 'WireMessage.decode()', Utils.inspectError(e));
      err = e as ErrorInfo;
    }
    res.expandFields();
    return { decoded: res, err: err };
  }

  async decode(inputContext: EncodingDecodingContext | ChannelOptions, logger: Logger): Promise<Message> {
    const { decoded } = await this.decodeWithErr(inputContext, logger);
    return decoded;
  }

  toString() {
    return strMsg(this, 'WireMessage');
  }
}

export default Message;
