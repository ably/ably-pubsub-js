import * as API from '../../../../ably';
import { Crypto } from './crypto';
import { fromEncoded, fromEncodedArray } from '../../../common/lib/types/message';
import Logger from '../../../common/lib/util/logger';

// The type assertions for the decode* functions below are due to https://github.com/ably/ably-js/issues/1421

export const decodeMessage = ((obj, options) => {
  return fromEncoded(Logger.defaultLogger, null, obj, options);
}) as API.MessageStatic['fromEncoded'];

export const decodeEncryptedMessage = ((obj, options) => {
  return fromEncoded(Logger.defaultLogger, Crypto, obj, options);
}) as API.MessageStatic['fromEncoded'];

export const decodeMessages = ((obj, options) => {
  return fromEncodedArray(Logger.defaultLogger, null, obj, options);
}) as API.MessageStatic['fromEncodedArray'];

export const decodeEncryptedMessages = ((obj, options) => {
  return fromEncodedArray(Logger.defaultLogger, Crypto, obj, options);
}) as API.MessageStatic['fromEncodedArray'];
