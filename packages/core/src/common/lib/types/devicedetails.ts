import { MsgPack } from 'common/types/msgpack';
import type { LocalDevice } from 'plugins/push/pushactivation';
import * as Utils from '../util/utils';
import ErrorInfo, { IConvertibleToErrorInfo } from './errorinfo';

export enum DeviceFormFactor {
  Phone = 'phone',
  Tablet = 'tablet',
  Desktop = 'desktop',
  TV = 'tv',
  Watch = 'watch',
  Car = 'car',
  Embedded = 'embedded',
  Other = 'other',
}

export enum DevicePlatform {
  Android = 'android',
  IOS = 'ios',
  Browser = 'browser',
}

type DevicePushState = 'ACTIVE' | 'FAILING' | 'FAILED';

interface WebPushEncryptionKey {
  p256dh: string;
  auth: string;
}

interface WebPushRecipient {
  transportType: 'web';
  targetUrl: string;
  encryptionKey: WebPushEncryptionKey;
  publicVapidKey: string;
}

interface PushChannelRecipient {
  transportType: 'ablyChannel';
  channel: string;
  ablyKey: string;
  ablyUrl: string;
}

export interface FcmPushRecipient {
  transportType: 'fcm';
  registrationToken: string;
}

export interface ApnsPushRecipient {
  transportType: 'apns';
  deviceToken: string;
}

type PushRecipient = WebPushRecipient | PushChannelRecipient | FcmPushRecipient | ApnsPushRecipient;

export type DevicePushDetails = {
  error?: ErrorInfo;
  recipient?: PushRecipient;
  state?: DevicePushState;
  metadata?: string;
};

class DeviceDetails {
  id?: string;
  clientId?: string;
  deviceSecret?: string;
  formFactor?: DeviceFormFactor;
  platform?: DevicePlatform;
  push?: DevicePushDetails;
  metadata?: string;
  deviceIdentityToken?: string;

  toJSON(): DeviceDetails {
    return {
      id: this.id,
      deviceSecret: this.deviceSecret,
      platform: this.platform,
      formFactor: this.formFactor,
      clientId: this.clientId,
      metadata: this.metadata,
      deviceIdentityToken: this.deviceIdentityToken,
      push: {
        recipient: this.push?.recipient,
        state: this.push?.state,
        error: this.push?.error,
      },
    } as DeviceDetails;
  }

  toString(): string {
    let result = '[DeviceDetails';
    if (this.id) result += '; id=' + this.id;
    if (this.platform) result += '; platform=' + this.platform;
    if (this.formFactor) result += '; formFactor=' + this.formFactor;
    if (this.clientId) result += '; clientId=' + this.clientId;
    if (this.metadata) result += '; metadata=' + this.metadata;
    if (this.deviceIdentityToken) result += '; deviceIdentityToken=' + JSON.stringify(this.deviceIdentityToken);
    if (this.push?.recipient) result += '; push.recipient=' + JSON.stringify(this.push.recipient);
    if (this.push?.state) result += '; push.state=' + this.push.state;
    if (this.push?.error) result += '; push.error=' + JSON.stringify(this.push.error);
    if (this.push?.metadata) result += '; push.metadata=' + this.push.metadata;
    result += ']';
    return result;
  }

  static toRequestBody(body: unknown, MsgPack: MsgPack | null, format?: Utils.Format) {
    return Utils.encodeBody(body, MsgPack, format);
  }

  static fromResponseBody(
    body: Array<Record<string, unknown>> | Record<string, unknown>,
    MsgPack: MsgPack | null,
    format?: Utils.Format,
  ): DeviceDetails | DeviceDetails[] {
    if (format) {
      body = Utils.decodeBody(body, MsgPack, format);
    }

    if (Array.isArray(body)) {
      return DeviceDetails.fromValuesArray(body);
    } else {
      return DeviceDetails.fromValues(body);
    }
  }

  static fromValues(values: Record<string, unknown>): DeviceDetails {
    values.error = values.error && ErrorInfo.fromWireValues(values.error as IConvertibleToErrorInfo);
    return Object.assign(new DeviceDetails(), values);
  }

  static fromLocalDevice(device: LocalDevice): DeviceDetails {
    return Object.assign(new DeviceDetails(), device);
  }

  static fromValuesArray(values: Array<Record<string, unknown>>): DeviceDetails[] {
    const count = values.length,
      result = new Array(count);
    for (let i = 0; i < count; i++) result[i] = DeviceDetails.fromValues(values[i]);
    return result;
  }
}

export default DeviceDetails;
