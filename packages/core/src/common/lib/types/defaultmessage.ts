import Message, { WireMessage, fromEncoded, fromEncodedArray } from './message';
import * as API from '../../../../ably';
import Platform from 'common/platform';
import Logger from '../util/logger';
import type { Properties } from '../util/utils';

/**
 `DefaultMessage` is the class returned by `DefaultRest` and `DefaultRealtime`’s `Message` static property. It introduces the static methods described in the `MessageStatic` interface of the public API of the non tree-shakable version of the library.
 */
export class DefaultMessage extends Message {
  static async fromEncoded(encoded: unknown, inputOptions?: API.ChannelOptions): Promise<Message> {
    return fromEncoded(Logger.defaultLogger, Platform.Crypto, encoded as WireMessage, inputOptions);
  }

  static async fromEncodedArray(encodedArray: Array<unknown>, options?: API.ChannelOptions): Promise<Message[]> {
    return fromEncodedArray(Logger.defaultLogger, Platform.Crypto, encodedArray as WireMessage[], options);
  }

  static fromValues(values: Properties<Message>): Message {
    return Message.fromValues(values);
  }
}
