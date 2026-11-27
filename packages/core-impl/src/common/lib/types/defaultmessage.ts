import Message, { WireMessage, fromEncoded, fromEncodedArray } from './message';
import { applyPatch } from './messagepatch';
import * as API from '@ably/pubsub-core/api';
import Platform from 'common/platform';
import Logger from '../util/logger';
import type { Properties } from '../util/utils';

/**
 `DefaultMessage` is the class that the non tree-shakable version of the library exports as `Message`, and that `DefaultPubSubHttpClient` and `DefaultPubSubRealtimeClient` also carry as their `Message` static property. It introduces the static methods that the public API declares on the `Message` class.
 */
export class DefaultMessage extends Message {
  static async fromEncoded(encoded: unknown, inputOptions?: API.ChannelOptions): Promise<Message> {
    return fromEncoded(Logger.defaultLogger, Platform.Crypto, encoded as WireMessage, inputOptions);
  }

  static async fromEncodedArray(encodedArray: Array<unknown>, options?: API.ChannelOptions): Promise<Message[]> {
    return fromEncodedArray(Logger.defaultLogger, Platform.Crypto, encodedArray as WireMessage[], options);
  }

  static applyPatch<T extends Properties<Message>>(message: T, patch: Properties<Message>): T {
    return applyPatch(message, patch);
  }

  static fromValues(values: Properties<Message>): Message {
    return Message.fromValues(values);
  }
}
