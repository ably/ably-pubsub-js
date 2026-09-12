import Logger, { LoggerOptions } from '../util/logger';
import Defaults, { formatHostForUri } from '../util/defaults';
import Auth from './auth';
import { HttpPaginatedResponse, PaginatedResult } from './paginatedresource';
import ErrorInfo from '../types/errorinfo';
import Stats from '../types/stats';
import { Http, RequestParams } from '../../types/http';
import ClientOptions, { NormalisedClientOptions } from '../../types/ClientOptions';
import * as API from '../../../../ably';
import * as Utils from '../util/utils';

import Platform from '../../platform';
import { Rest } from './rest';
import { IUntypedCryptoStatic } from 'common/types/ICryptoStatic';
import { AnnotationsPlugin } from './modularplugins';
import { throwMissingPluginError } from '../util/utils';
import { MsgPack } from 'common/types/msgpack';
import { HTTPRequestImplementations } from 'platform/web/lib/http/http';
import { FilteredSubscriptions } from './filteredsubscriptions';
import type { LocalDevice } from 'plugins/push/pushactivation';
import type { IPlatformPushConfig } from 'common/types/IPlatformConfig';
import EventEmitter from '../util/eventemitter';
import { MessageEncoding } from '../types/basemessage';
import type * as LiveObjectsPlugin from 'plugins/liveobjects';

type BatchResult<T> = API.BatchResult<T>;
type BatchPublishSpec = API.BatchPublishSpec;
type BatchPublishSuccessResult = API.BatchPublishSuccessResult;
type BatchPublishFailureResult = API.BatchPublishFailureResult;
type BatchPublishResult = BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>;
type BatchPresenceSuccessResult = API.BatchPresenceSuccessResult;
type BatchPresenceFailureResult = API.BatchPresenceFailureResult;
type BatchPresenceResult = BatchResult<BatchPresenceSuccessResult | BatchPresenceFailureResult>;

/**
 `BaseClient` acts as the base class for all of the client classes exported by the SDK. It is an implementation detail and this class is not advertised publicly.
 */
class BaseClient {
  options: NormalisedClientOptions;
  _currentFallback: null | {
    host: string;
    validUntil: number;
  };
  serverTimeOffset: number | null;
  http: Http;
  auth: Auth;

  private readonly _rest: Rest | null;
  readonly _Crypto: IUntypedCryptoStatic | null;
  readonly _MsgPack: MsgPack | null;
  // Extra HTTP request implementations available to this client, in addition to those in web’s Http.bundledRequestImplementations
  readonly _additionalHTTPRequestImplementations: HTTPRequestImplementations | null;
  private readonly __FilteredSubscriptions: typeof FilteredSubscriptions | null;
  readonly _Annotations: AnnotationsPlugin | null;
  readonly _liveObjectsPlugin: typeof LiveObjectsPlugin | null;
  readonly logger: Logger;
  _device?: LocalDevice;
  private _devicePromise?: Promise<LocalDevice>;

  constructor(options: ClientOptions) {
    this._additionalHTTPRequestImplementations = options.plugins ?? null;

    this.logger = new Logger();
    this.logger.setLog(options.logLevel, options.logHandler);
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'BaseClient()',
      'initialized with clientOptions ' + Platform.Config.inspect(options),
    );

    this._MsgPack = options.plugins?.MsgPack ?? null;
    const normalOptions = (this.options = Defaults.normaliseOptions(options, this._MsgPack, this.logger));

    /* process options */
    if (normalOptions.key) {
      const keyMatch = normalOptions.key.match(/^([^:\s]+):([^:.\s]+)$/);
      if (!keyMatch) {
        const msg = 'invalid key parameter';
        Logger.logAction(this.logger, Logger.LOG_ERROR, 'BaseClient()', msg);
        throw new ErrorInfo({
          message: msg,
          code: 40400,
          statusCode: 404,
          remediation:
            'ClientOptions.key must be the full "appId.keyId:secret" string copied from the Ably dashboard. If you have the Ably CLI installed, `ably auth keys list` shows the keys configured on the current app.',
        });
      }
      normalOptions.keyName = keyMatch[1];
      normalOptions.keySecret = keyMatch[2];
    }

    if ('clientId' in normalOptions) {
      if (!(typeof normalOptions.clientId === 'string' || normalOptions.clientId === null)) {
        throw new ErrorInfo({
          message: 'clientId must be either a string or null',
          code: 40012,
          statusCode: 400,
          remediation:
            'Pass a stable string such as a user id to identify the client, or null (or omit it) for an anonymous client. Values like numbers or objects are not accepted.',
        });
      } else if (normalOptions.clientId === '*') {
        throw new ErrorInfo({
          message: 'Can’t use "*" as a clientId as that string is reserved',
          code: 40012,
          statusCode: 400,
          remediation:
            'ClientOptions.clientId sets one fixed identity and cannot be "*". To let this client act as any clientId, request a wildcard token instead: set defaultTokenParams: { clientId: "*" } on the client. The "*" belongs in the token request, not in ClientOptions.clientId.',
        });
      }
    }

    Logger.logAction(this.logger, Logger.LOG_MINOR, 'BaseClient()', 'started; version = ' + Defaults.version);

    this._currentFallback = null;

    this.serverTimeOffset = null;
    this.http = new Http(this);
    this.auth = new Auth(this, normalOptions);

    this._rest = options.plugins?.Rest ? new options.plugins.Rest(this) : null;
    this._Crypto = options.plugins?.Crypto ?? null;
    this.__FilteredSubscriptions = options.plugins?.MessageInteractions ?? null;
    this._Annotations = options.plugins?.Annotations ?? null;
    this._liveObjectsPlugin = options.plugins?.LiveObjects ?? null;
  }

  get rest(): Rest {
    if (!this._rest) {
      throwMissingPluginError('Rest');
    }
    return this._rest;
  }

  get _FilteredSubscriptions(): typeof FilteredSubscriptions {
    if (!this.__FilteredSubscriptions) {
      throwMissingPluginError('MessageInteractions');
    }
    return this.__FilteredSubscriptions;
  }

  get channels() {
    return this.rest.channels;
  }

  get push() {
    return this.rest.push;
  }

  /**
   * The effective platform push config for this client. A config carried by the client's Push
   * plugin (e.g. ReactNativePush, whose storage and token callbacks are supplied per client)
   * takes precedence over the platform-level Platform.Config.push (set statically on web), so
   * multiple clients never share plugin-supplied storage or callbacks.
   */
  get pushConfig(): IPlatformPushConfig | undefined {
    return this.options.plugins?.Push?.pushConfig ?? Platform.Config.push;
  }

  /**
   * RSH8
   *
   * @deprecated Use {@link getDevice} instead. `device()` reads the device state from storage
   * synchronously, which is not possible on platforms with asynchronous storage such as React
   * Native. In the next major release `device()` will become asynchronous.
   */
  device(): LocalDevice & API.LocalDevice {
    if (!this.options.plugins?.Push || !this.push.LocalDevice) {
      throwMissingPluginError('Push');
    }
    if (!this._device) {
      if (this.pushConfig?.storageIsAsync) {
        throw new ErrorInfo({
          message:
            'client.device() cannot load the local device synchronously: push storage on this platform is asynchronous',
          code: 40000,
          statusCode: 400,
          remediation:
            'Use await client.getDevice() instead. device() is deprecated and will become asynchronous in the next major release.',
        });
      }
      this._device = this.push.LocalDevice.load(this);
    }
    return this._device;
  }

  /** RSH8 */
  async getDevice(): Promise<LocalDevice & API.LocalDevice> {
    if (!this.options.plugins?.Push || !this.push.LocalDevice) {
      throwMissingPluginError('Push');
    }
    if (!this._device) {
      const devicePromise = (this._devicePromise ??= this.push.LocalDevice.loadAsync(this));
      try {
        this._device = await devicePromise;
      } catch (err) {
        // drop the failed load so a later call can retry after a transient storage failure
        if (this._devicePromise === devicePromise) {
          this._devicePromise = undefined;
        }
        throw err;
      }
    }
    return this._device;
  }

  baseUri(host: string) {
    return Defaults.getHttpScheme(this.options) + formatHostForUri(host) + ':' + Defaults.getPort(this.options, false);
  }

  async stats(params?: RequestParams): Promise<PaginatedResult<Stats>> {
    return this.rest.stats(params);
  }

  async time(params?: RequestParams): Promise<number> {
    return this.rest.time(params);
  }

  async request(
    method: string,
    path: string,
    version: number,
    params?: RequestParams,
    body?: unknown,
    customHeaders?: Record<string, string>,
  ): Promise<HttpPaginatedResponse<unknown>> {
    return this.rest.request(method, path, version, params, body, customHeaders);
  }

  batchPublish<T extends BatchPublishSpec | BatchPublishSpec[]>(
    specOrSpecs: T,
  ): Promise<T extends BatchPublishSpec ? BatchPublishResult : BatchPublishResult[]> {
    return this.rest.batchPublish(specOrSpecs);
  }

  batchPresence(channels: string[]): Promise<BatchPresenceResult> {
    return this.rest.batchPresence(channels);
  }

  setLog(logOptions: LoggerOptions): void {
    this.logger.setLog(logOptions.level, logOptions.handler);
  }

  /**
   * Get the current time based on the local clock,
   * or if the option queryTime is true, return the server time.
   * The server time offset from the local time is stored so that
   * only one request to the server to get the time is ever needed
   */
  async getTimestamp(queryTime: boolean): Promise<number> {
    if (!this.isTimeOffsetSet() && queryTime) {
      return this.time();
    }

    return this.getTimestampUsingOffset();
  }

  getTimestampUsingOffset(): number {
    return Platform.Config.now() + (this.serverTimeOffset || 0);
  }

  isTimeOffsetSet(): boolean {
    return this.serverTimeOffset !== null;
  }

  static Platform = Platform;

  /**
   * These exports are for use by UMD plugins; reason being so that constructors and static methods can be accessed by these plugins without needing to import the classes directly and result in the class existing in both the plugin and the core library.
   */
  Platform = Platform;
  ErrorInfo = ErrorInfo;
  Logger = Logger;
  Defaults = Defaults;
  Utils = Utils;
  EventEmitter = EventEmitter;
  MessageEncoding = MessageEncoding;
}

export default BaseClient;
