import Logger from '../util/logger';
import { BaseMessage, encode, decode, wireToJSON, strMsg } from './basemessage';
import * as API from '../../../../ably';
import * as Utils from '../util/utils';

import type { Properties } from '../util/utils';
import type RestChannel from '../client/restchannel';
import type RealtimeChannel from '../client/realtimechannel';
import type { ChannelOptions } from '../../types/channel';
type Channel = RestChannel | RealtimeChannel;

const actions = ['annotation.create', 'annotation.delete'];

export async function fromEncoded(
  logger: Logger,
  encoded: WireAnnotation,
  options?: API.ChannelOptions,
): Promise<Annotation> {
  const wa = WireAnnotation.fromValues(encoded);
  return wa.decode(options || {}, logger);
}

export async function fromEncodedArray(
  logger: Logger,
  encodedArray: WireAnnotation[],
  options?: API.ChannelOptions,
): Promise<Annotation[]> {
  return Promise.all(
    encodedArray.map(function (encoded) {
      return fromEncoded(logger, encoded, options);
    }),
  );
}

// these forms of the functions are used internally when we have a channel instance
// already, so don't need to normalise channel options
export async function _fromEncoded(encoded: Properties<WireAnnotation>, channel: Channel): Promise<Annotation> {
  return WireAnnotation.fromValues(encoded).decode(channel.channelOptions, channel.logger);
}

export async function _fromEncodedArray(
  encodedArray: Properties<WireAnnotation>[],
  channel: Channel,
): Promise<Annotation[]> {
  return Promise.all(
    encodedArray.map(function (encoded) {
      return _fromEncoded(encoded, channel);
    }),
  );
}

// for tree-shakability
export function fromValues(values: Properties<Annotation>) {
  return Annotation.fromValues(values);
}

class Annotation extends BaseMessage {
  action?: API.AnnotationAction;
  serial?: string;
  messageSerial?: string;
  type?: string;
  name?: string;
  count?: number;

  async encode(options: ChannelOptions): Promise<WireAnnotation> {
    const res = Object.assign(new WireAnnotation(), this, {
      action: actions.indexOf(this.action || 'annotation.create'),
    });
    return encode(res, options);
  }

  static fromValues(values: Properties<Annotation>): Annotation {
    return Object.assign(new Annotation(), values);
  }

  static fromValuesArray(values: Properties<Annotation>[]): Annotation[] {
    return values.map((v) => Annotation.fromValues(v));
  }

  toString() {
    return strMsg(this, 'Annotation');
  }
}

export class WireAnnotation extends BaseMessage {
  action?: number;
  serial?: string;
  messageSerial?: string;
  type?: string;
  name?: string;
  count?: number;

  toJSON(...args: any[]) {
    return wireToJSON.call(this, ...args);
  }

  static fromValues(values: Properties<WireAnnotation>): WireAnnotation {
    return Object.assign(new WireAnnotation(), values);
  }

  static fromValuesArray(values: Properties<WireAnnotation>[]): WireAnnotation[] {
    return values.map((v) => WireAnnotation.fromValues(v));
  }

  async decode(channelOptions: ChannelOptions, logger: Logger): Promise<Annotation> {
    const res = Object.assign(new Annotation(), {
      ...this,
      action: actions[this.action!],
    });
    try {
      await decode(res, channelOptions);
    } catch (e) {
      Logger.logAction(logger, Logger.LOG_ERROR, 'WireAnnotation.decode()', Utils.inspectError(e));
    }
    return res;
  }

  toString() {
    return strMsg(this, 'WireAnnotation');
  }
}

export default Annotation;
