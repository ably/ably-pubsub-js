import Platform from 'common/platform';
import * as API from '../../../../ably';
import { Bufferlike as BrowserBufferlike } from '../../../platform/web/lib/util/bufferutils';
import Logger from '../util/logger';
import * as Utils from '../util/utils';
import ErrorInfo from './errorinfo';
import { actions } from './protocolmessagecommon';

import type { IUntypedCryptoStatic } from 'common/types/ICryptoStatic';
import type { ChannelOptions } from '../../types/channel';
import type ProtocolMessage from './protocolmessage';

/**
 * ChannelOptions on which encryption is fully configured, so a payload can be encrypted without
 * further checks. Narrow to this with isEncrypted().
 */
export type EncryptedChannelOptions = ChannelOptions & {
  cipher: API.CipherParams;
  channelCipher: NonNullable<ChannelOptions['channelCipher']>;
};

/**
 * Both fields are set together by normaliseChannelOptions and normalizeCipherOptions, but options
 * that have bypassed those are not necessarily consistent, so check both.
 */
export function isEncrypted(options: ChannelOptions | null | undefined): options is EncryptedChannelOptions {
  return !!options && !!options.cipher && !!options.channelCipher;
}

export type EncodingDecodingContext = {
  channelOptions: ChannelOptions;
  plugins: {
    vcdiff?: {
      decode: (delta: Uint8Array, source: Uint8Array) => Uint8Array;
    };
  };
  baseEncodedPreviousPayload?: Buffer | BrowserBufferlike;
};

function normaliseContext(context: EncodingDecodingContext | ChannelOptions): EncodingDecodingContext {
  if (!context || !(context as EncodingDecodingContext).channelOptions) {
    return {
      channelOptions: context as ChannelOptions,
      plugins: {},
      baseEncodedPreviousPayload: undefined,
    };
  }
  return context as EncodingDecodingContext;
}

export function normalizeCipherOptions(
  Crypto: IUntypedCryptoStatic | null,
  logger: Logger,
  options: API.ChannelOptions | null,
): ChannelOptions {
  if (options && options.cipher) {
    if (!Crypto) Utils.throwMissingPluginError('Crypto');
    const cipher = Crypto.getCipher(options.cipher, logger);
    return {
      cipher: cipher.cipherParams,
      channelCipher: cipher.cipher,
    };
  }
  return options ?? {};
}

async function encrypt<T extends BaseMessage>(msg: T, cipherOptions: EncryptedChannelOptions): Promise<T> {
  const { data, encoding } = await encryptData(msg.data, msg.encoding, cipherOptions);
  msg.data = data;
  msg.encoding = encoding;
  return msg;
}

export async function encryptData(
  data: any,
  encoding: string | null | undefined,
  cipherOptions: EncryptedChannelOptions,
): Promise<{ data: any; encoding: string | null | undefined }> {
  let cipher = cipherOptions.channelCipher;
  let dataToEncrypt = data;
  let finalEncoding = encoding ? encoding + '/' : '';

  if (!Platform.BufferUtils.isBuffer(dataToEncrypt)) {
    dataToEncrypt = Platform.BufferUtils.utf8Encode(String(dataToEncrypt));
    finalEncoding = finalEncoding + 'utf-8/';
  }

  const ciphertext = await cipher.encrypt(dataToEncrypt);
  finalEncoding = finalEncoding + 'cipher+' + cipher.algorithm;

  return {
    data: ciphertext,
    encoding: finalEncoding,
  };
}

/**
 * Encodes and encrypts message's payload. Mutates the message object.
 * Implements RSL4 and RSL5.
 */
export async function encode<T extends BaseMessage>(msg: T, options: ChannelOptions | null): Promise<T> {
  const { data, encoding } = encodeData(msg.data, msg.encoding);

  msg.data = data;
  msg.encoding = encoding;

  if (isEncrypted(options)) {
    return encrypt(msg, options);
  } else {
    return msg;
  }
}

export function encodeData(
  data: any,
  encoding: string | null | undefined,
): { data: any; encoding: string | null | undefined } {
  // RSL4a, supported types
  const nativeDataType =
    typeof data == 'string' || Platform.BufferUtils.isBuffer(data) || data === null || data === undefined;

  if (nativeDataType) {
    // nothing to do with the native data types at this point
    return {
      data,
      encoding,
    };
  }

  if (Utils.isObject(data) || Array.isArray(data)) {
    // RSL4c3 and RSL4d3, encode objects and arrays as strings
    return {
      data: JSON.stringify(data),
      encoding: encoding ? encoding + '/json' : 'json',
    };
  }

  // RSL4a, throw an error for unsupported types
  throw new ErrorInfo({
    message: 'Data type is unsupported',
    code: 40013,
    statusCode: 400,
    remediation:
      'Message data must be a string, Buffer/ArrayBuffer/TypedArray, plain object, or array. Convert other types (e.g. Date, Map, Set) to one of these before publishing.',
  });
}

export async function decode<T extends BaseMessage>(
  message: T,
  inputContext: EncodingDecodingContext | ChannelOptions,
): Promise<void> {
  // data can be decoded partially and throw an error on a later decoding step.
  // so we need to reassign the data and encoding values we got, and only then throw an error if there is one
  const { data, encoding, error } = await decodeData(message.data, message.encoding, inputContext);
  message.data = data;
  message.encoding = encoding;

  if (error) {
    throw error;
  }
}

/**
 * Implements RSL6
 */
export async function decodeData(
  data: any,
  encoding: string | null | undefined,
  inputContext: EncodingDecodingContext | ChannelOptions,
): Promise<{
  error?: ErrorInfo;
  data: any;
  encoding: string | null | undefined;
}> {
  const context = normaliseContext(inputContext);
  let lastPayload = data;
  let decodedData = data;
  let finalEncoding = encoding;
  let decodingError: ErrorInfo | undefined;

  if (encoding) {
    const xforms = encoding.split('/');
    let lastProcessedEncodingIndex;
    let encodingsToProcess = xforms.length;
    let xform = '';

    try {
      while ((lastProcessedEncodingIndex = encodingsToProcess) > 0) {
        // eslint-disable-next-line security/detect-unsafe-regex
        const match = xforms[--encodingsToProcess].match(/([-\w]+)(\+([\w-]+))?/);
        if (!match) break;
        xform = match[1];
        switch (xform) {
          case 'base64':
            decodedData = Platform.BufferUtils.base64Decode(String(decodedData));
            if (lastProcessedEncodingIndex == xforms.length) {
              lastPayload = decodedData;
            }
            continue;
          case 'utf-8':
            decodedData = Platform.BufferUtils.utf8Decode(decodedData);
            continue;
          case 'json':
            decodedData = JSON.parse(decodedData);
            continue;
          case 'cipher':
            if (
              context.channelOptions != null &&
              context.channelOptions.cipher &&
              context.channelOptions.channelCipher
            ) {
              const xformAlgorithm = match[3],
                cipher = context.channelOptions.channelCipher;
              /* don't attempt to decrypt unless the cipher params are compatible */
              if (xformAlgorithm != cipher.algorithm) {
                throw new Error('Unable to decrypt message with given cipher; incompatible cipher params');
              }
              decodedData = await cipher.decrypt(decodedData);
              continue;
            } else {
              throw new Error('Unable to decrypt message; not an encrypted channel');
            }
          case 'vcdiff':
            if (!context.plugins || !context.plugins.vcdiff) {
              throw new ErrorInfo({
                message: 'Missing Vcdiff decoder (https://github.com/ably-forks/vcdiff-decoder)',
                code: 40019,
                statusCode: 400,
                remediation: 'Install @ably/vcdiff-decoder and pass it in ClientOptions.plugins.vcdiff.',
              });
            }
            if (typeof Uint8Array === 'undefined') {
              throw new ErrorInfo({
                message: 'Delta decoding not supported on this browser (need ArrayBuffer & Uint8Array)',
                code: 40020,
                statusCode: 400,
                remediation:
                  'Disable channel deltas (do not set delta in channel params) on environments without typed-array support, or upgrade the JavaScript runtime.',
              });
            }
            try {
              let deltaBase = context.baseEncodedPreviousPayload;
              if (typeof deltaBase === 'string') {
                deltaBase = Platform.BufferUtils.utf8Encode(deltaBase);
              }

              // vcdiff expects Uint8Arrays, can't copy with ArrayBuffers.
              const deltaBaseBuffer = Platform.BufferUtils.toBuffer(deltaBase as Buffer);
              decodedData = Platform.BufferUtils.toBuffer(decodedData);

              decodedData = Platform.BufferUtils.arrayBufferViewToBuffer(
                context.plugins.vcdiff.decode(decodedData, deltaBaseBuffer),
              );
              lastPayload = decodedData;
            } catch (e) {
              throw new ErrorInfo({
                message: 'Vcdiff delta decode failed with ' + e,
                code: 40018,
                statusCode: 400,
                remediation:
                  'The SDK recovers automatically by re-attaching from the last successfully processed message, and the server re-sends the affected message in full before deltas resume. If this recurs, disable deltas for this channel by removing delta from the channel params.',
              });
            }
            continue;
          default:
            throw new Error('Unknown encoding');
        }
      }
    } catch (e) {
      const err = e as ErrorInfo;
      decodingError = new ErrorInfo({
        message: `Error processing the ${xform} encoding, decoder returned ‘${err.message}’`,
        code: err.code || 40013,
        statusCode: 400,
        remediation: err.remediation,
      });
    } finally {
      finalEncoding =
        (lastProcessedEncodingIndex as number) <= 0 ? null : xforms.slice(0, lastProcessedEncodingIndex).join('/');
    }
  }

  if (decodingError) {
    return {
      error: decodingError,
      data: decodedData,
      encoding: finalEncoding,
    };
  }

  context.baseEncodedPreviousPayload = lastPayload;
  return {
    data: decodedData,
    encoding: finalEncoding,
  };
}

export function wireToJSON(this: BaseMessage, ...args: any[]): any {
  // encode message data for wire transmission. we can infer the format used by client by inspecting with what arguments this method was called.
  // if JSON encoding is being used, the JSON.stringify() will be called and this toJSON() method will have a non-empty arguments list.
  // MSGPack encoding implementation also calls toJSON(), but with an empty arguments list.
  const format = args.length > 0 ? Utils.Format.json : Utils.Format.msgpack;
  const { data, encoding } = encodeDataForWire(this.data, this.encoding, format);

  return Object.assign({}, this, { encoding, data });
}

/**
 * Prepares the payload data to be transmitted over the wire to Ably.
 * Encodes the data depending on the selected protocol format.
 *
 * Implements RSL4c1 and RSL4d1
 */
export function encodeDataForWire(
  data: any,
  encoding: string | null | undefined,
  format: Utils.Format,
): { data: any; encoding: string | null | undefined } {
  if (!data || !Platform.BufferUtils.isBuffer(data)) {
    // no encoding required for non-buffer payloads
    return {
      data,
      encoding,
    };
  }

  if (format === Utils.Format.msgpack) {
    // RSL4c1
    // BufferUtils.toBuffer returns a datatype understandable by that platform's msgpack implementation:
    // Buffer in node, Uint8Array in browsers
    return {
      data: Platform.BufferUtils.toBuffer(data),
      encoding,
    };
  }

  // RSL4d1, encode binary payload as base64 string
  return {
    data: Platform.BufferUtils.base64Encode(data),
    encoding: encoding ? encoding + '/base64' : 'base64',
  };
}

export const MessageEncoding = {
  encryptData,
  encodeData,
  encodeDataForWire,
  decodeData,
};

// in-place, generally called on the protocol message before decoding
export function populateFieldsFromParent(parent: ProtocolMessage) {
  const { id, connectionId, timestamp } = parent;

  let msgs: BaseMessage[];
  switch (parent.action) {
    case actions.MESSAGE: {
      msgs = parent.messages!;
      break;
    }
    case actions.PRESENCE:
    case actions.SYNC:
      msgs = parent.presence!;
      break;
    case actions.ANNOTATION:
      msgs = parent.annotations!;
      break;
    case actions.OBJECT:
    case actions.OBJECT_SYNC:
      msgs = parent.state!;
      break;
    default:
      throw new ErrorInfo('Unexpected action ' + parent.action, 40000, 400);
  }

  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i];
    if (!msg.connectionId) {
      msg.connectionId = connectionId;
    }
    if (!msg.timestamp) {
      msg.timestamp = timestamp;
    }
    if (id && !msg.id) {
      msg.id = id + ':' + i;
    }
  }
}

export function strMsg(m: any, cls: string) {
  let result = '[' + cls;
  for (const attr in m) {
    if (attr === 'data') {
      if (typeof m.data == 'string') {
        result += '; data=' + m.data;
      } else if (Platform.BufferUtils.isBuffer(m.data)) {
        result += '; data (buffer)=' + Platform.BufferUtils.base64Encode(m.data);
      } else if (typeof m.data !== 'undefined') {
        result += '; data (json)=' + JSON.stringify(m.data);
      }
    } else if (attr && (attr === 'extras' || attr === 'operation')) {
      result += '; ' + attr + '=' + JSON.stringify(m[attr]);
    } else if (attr === 'version') {
      result += '; version=' + JSON.stringify(m[attr]);
    } else if (attr === 'annotations') {
      result += '; annotations=' + JSON.stringify(m[attr]);
    } else if (m[attr] !== undefined) {
      result += '; ' + attr + '=' + m[attr];
    }
  }
  result += ']';
  return result;
}

export abstract class BaseMessage {
  id?: string;
  timestamp?: number;
  clientId?: string;
  connectionId?: string;
  data?: any;
  encoding?: string | null;
  extras?: any;
  size?: number;
}
