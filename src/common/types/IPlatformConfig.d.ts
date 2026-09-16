import { DeviceFormFactor, DevicePlatform } from 'common/lib/types/devicedetails';

/**
 * Interface for common config properties shared between all platforms and that are relevant for all platforms.
 *
 * These properties must always be required and set for each platform.
 */
export interface ICommonPlatformConfig {
  agent: string;
  logTimestamps: boolean;
  binaryType: BinaryType;
  WebSocket: typeof WebSocket | typeof import('ws');
  /**
   * The value of the `heartbeats` transport param that a websocket transport on this
   * platform should request by default — see RTN23b/RTN23c. `'false'` where websocket
   * ping frames are observable, `'bounce'` where they are not and this platform may
   * additionally suspend our code while leaving the socket alive to answer them.
   */
  websocketHeartbeatsParam: 'true' | 'false' | 'bounce';
  supportsBinary: boolean;
  preferBinary: boolean;
  nextTick: process.nextTick;
  setTimeout: (handler: () => void, timeout?: number) => ReturnType<typeof globalThis.setTimeout>;
  clearTimeout: (id: ReturnType<typeof globalThis.setTimeout> | null | undefined) => void;
  now: () => number;
  inspect: (value: unknown) => string;
  stringByteSize: Buffer.byteLength;
  getRandomArrayBuffer: (byteLength: number) => Promise<ArrayBuffer>;
  push?: IPlatformPushConfig;
}

/**
 * Interface for platform specific config properties that do make sense on some platforms but not on others.
 *
 * These properties should always be optional, so that only relevant platforms would set them.
 */
export interface ISpecificPlatformConfig {
  addEventListener?: typeof window.addEventListener | typeof global.addEventListener | null;
  userAgent?: string | null;
  inherits?: typeof import('util').inherits;
  currentUrl?: string;
  fetchSupported?: boolean;
  xhrSupported?: boolean;
  allowComet?: boolean;
  ArrayBuffer?: typeof ArrayBuffer | false;
  atob?: typeof atob | null;
  TextEncoder?: typeof TextEncoder;
  TextDecoder?: typeof TextDecoder;
  isWebworker?: boolean;
}

export interface IPlatformPushStorage {
  get(name: string): string | null | Promise<string | null>;
  set(name: string, value: string): void | Promise<void>;
  remove(name: string): void | Promise<void>;
}

export interface IPlatformPushConfig {
  platform: DevicePlatform;
  formFactor: DeviceFormFactor;
  storage: IPlatformPushStorage;
  /**
   * Must be set when `storage` methods return promises (e.g. React Native's AsyncStorage).
   * Declarative rather than inferred: the synchronous device-load path has write side effects
   * and must be refused before any storage call is made against an async implementation.
   */
  storageIsAsync?: boolean;
  getPushDeviceDetails?(machine: any);
}

export type IPlatformConfig = ICommonPlatformConfig & ISpecificPlatformConfig;
