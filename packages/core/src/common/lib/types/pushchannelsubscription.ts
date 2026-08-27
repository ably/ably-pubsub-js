import { MsgPack } from 'common/types/msgpack';
import * as Utils from '../util/utils';

type PushChannelSubscriptionObject = {
  channel: string;
  deviceId?: string;
  clientId?: string;
};

class PushChannelSubscription {
  /** PCS4, the channel name associated with this subscription */
  channel!: string;
  /** PCS2, optional, populated for subscriptions made for a specific device registration */
  deviceId?: string;
  /** PCS3, optional, populated for subscriptions made for a specific clientId */
  clientId?: string;

  /**
   * Overload toJSON() to intercept JSON.stringify()
   * @return {*}
   */
  toJSON(): PushChannelSubscriptionObject {
    return {
      channel: this.channel,
      deviceId: this.deviceId,
      clientId: this.clientId,
    };
  }

  toString(): string {
    let result = '[PushChannelSubscription';
    if (this.channel) result += '; channel=' + this.channel;
    if (this.deviceId) result += '; deviceId=' + this.deviceId;
    if (this.clientId) result += '; clientId=' + this.clientId;
    result += ']';
    return result;
  }

  static toRequestBody = Utils.encodeBody;

  static fromResponseBody(
    body: Array<Record<string, unknown>> | Record<string, unknown>,
    MsgPack: MsgPack | null,
    format?: Utils.Format,
  ): PushChannelSubscription | PushChannelSubscription[] {
    if (format) {
      body = Utils.decodeBody(body, MsgPack, format) as Record<string, unknown>;
    }

    if (Array.isArray(body)) {
      return PushChannelSubscription.fromValuesArray(body);
    } else {
      return PushChannelSubscription.fromValues(body);
    }
  }

  static fromValues(values: Record<string, unknown>): PushChannelSubscription {
    return Object.assign(new PushChannelSubscription(), values);
  }

  static fromValuesArray(values: Array<Record<string, unknown>>): PushChannelSubscription[] {
    const count = values.length,
      result = new Array(count);
    for (let i = 0; i < count; i++) result[i] = PushChannelSubscription.fromValues(values[i]);
    return result;
  }
}

export default PushChannelSubscription;
