import * as Utils from '../util/utils';
import Defaults from '../util/defaults';
import Push from './push';
import PaginatedResource, { HttpPaginatedResponse, PaginatedResult } from './paginatedresource';
import RestChannel from './restchannel';
import ErrorInfo from '../types/errorinfo';
import Stats from '../types/stats';
import HttpMethods from '../../constants/HttpMethods';
import { ChannelOptions } from '../../types/channel';
import { RequestBody, RequestParams } from '../../types/http';
import * as API from '../../../../ably';
import Resource from './resource';

import Platform from '../../platform';
import BaseClient from './baseclient';
import { useTokenAuth } from './auth';
import { RestChannelMixin } from './restchannelmixin';
import { RestPresenceMixin } from './restpresencemixin';
import DeviceDetails from '../types/devicedetails';
import PushChannelSubscription from '../types/pushchannelsubscription';

type BatchResult<T> = API.BatchResult<T>;

type BatchPublishSpec = API.BatchPublishSpec;
type BatchPublishSuccessResult = API.BatchPublishSuccessResult;
type BatchPublishFailureResult = API.BatchPublishFailureResult;
type BatchPublishResult = BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>;
type BatchPresenceSuccessResult = API.BatchPresenceSuccessResult;
type BatchPresenceFailureResult = API.BatchPresenceFailureResult;
type BatchPresenceResult = BatchResult<BatchPresenceSuccessResult | BatchPresenceFailureResult>;

type TokenRevocationTargetSpecifier = API.TokenRevocationTargetSpecifier;
type TokenRevocationOptions = API.TokenRevocationOptions;
type TokenRevocationSuccessResult = API.TokenRevocationSuccessResult;
type TokenRevocationFailureResult = API.TokenRevocationFailureResult;
type TokenRevocationResult = BatchResult<TokenRevocationSuccessResult | TokenRevocationFailureResult>;

export class Rest {
  private readonly client: BaseClient;
  readonly channels: Channels;
  readonly push: Push;

  readonly channelMixin = RestChannelMixin;
  readonly presenceMixin = RestPresenceMixin;

  // exposed for plugins but shouldn't be bundled with minimal realtime
  Resource = Resource;
  PaginatedResource = PaginatedResource;
  DeviceDetails = DeviceDetails;
  PushChannelSubscription = PushChannelSubscription;

  constructor(client: BaseClient) {
    this.client = client;
    this.channels = new Channels(this.client);
    this.push = new Push(this.client);
  }

  async stats(params?: RequestParams): Promise<PaginatedResult<Stats>> {
    const headers = Defaults.defaultGetHeaders(this.client.options),
      format = this.client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      envelope = this.client.http.supportsLinkHeaders ? undefined : format;

    Utils.mixin(headers, this.client.options.headers);

    return new PaginatedResource(this.client, '/stats', headers, envelope, async (body, _, unpacked) => {
      const statsValues: Stats[] = unpacked
        ? (body as Stats[])
        : Utils.decodeBody<Stats[]>(body, this.client._MsgPack, format);
      for (let i = 0; i < statsValues.length; i++) statsValues[i] = Stats.fromValues(statsValues[i]);
      return statsValues;
    }).get(params as Record<string, string>);
  }

  async time(params?: RequestParams): Promise<number> {
    const headers = Defaults.defaultGetHeaders(this.client.options, { format: Utils.Format.json });
    if (this.client.options.headers) Utils.mixin(headers, this.client.options.headers);
    const timeUri = (host: string) => {
      return this.client.baseUri(host) + '/time';
    };

    let { error, body, unpacked } = await this.client.http.do(
      HttpMethods.Get,
      timeUri,
      headers,
      null,
      params as RequestParams,
    );

    if (error) {
      throw error;
    }
    if (!unpacked) body = JSON.parse(body as string);
    const time = (body as number[])[0];
    if (!time) {
      throw new ErrorInfo('Internal error (unexpected result type from GET /time)', 50000, 500);
    }
    /* calculate time offset only once for this device by adding to the prototype */
    this.client.serverTimeOffset = time - Platform.Config.now();
    return time;
  }

  async request(
    method: string,
    path: string,
    version: number,
    params?: RequestParams,
    body?: unknown,
    customHeaders?: Record<string, string>,
  ): Promise<HttpPaginatedResponse<unknown>> {
    const [encoder, decoder, format] = (() => {
      if (this.client.options.useBinaryProtocol) {
        if (!this.client._MsgPack) {
          Utils.throwMissingPluginError('MsgPack');
        }
        return [this.client._MsgPack.encode, this.client._MsgPack.decode, Utils.Format.msgpack];
      } else {
        return [JSON.stringify, JSON.parse, Utils.Format.json];
      }
    })();
    const envelope = this.client.http.supportsLinkHeaders ? undefined : format;
    params = params || {};
    const _method = method.toLowerCase() as HttpMethods;
    const headers =
      _method == 'get'
        ? Defaults.defaultGetHeaders(this.client.options, { format, protocolVersion: version })
        : Defaults.defaultPostHeaders(this.client.options, { format, protocolVersion: version });

    if (typeof body !== 'string') {
      body = encoder(body) ?? null;
    }
    Utils.mixin(headers, this.client.options.headers);
    if (customHeaders) {
      Utils.mixin(headers, customHeaders);
    }
    const paginatedResource = new PaginatedResource(
      this.client,
      path,
      headers,
      envelope,
      async function (resbody, headers, unpacked) {
        return Utils.ensureArray(unpacked ? resbody : decoder(resbody as string & Buffer));
      },
      /* useHttpPaginatedResponse: */ true,
    );

    if (!Platform.Http.methods.includes(_method)) {
      throw new ErrorInfo({
        message: 'Unsupported method ' + _method,
        code: 40500,
        statusCode: 405,
        remediation: `Use one of: ${Platform.Http.methods.join(', ')}.`,
      });
    }

    if (Platform.Http.methodsWithBody.includes(_method)) {
      return paginatedResource[_method as HttpMethods.Post](params, body as RequestBody) as Promise<
        HttpPaginatedResponse<unknown>
      >;
    } else {
      return paginatedResource[_method as HttpMethods.Get | HttpMethods.Delete](params) as Promise<
        HttpPaginatedResponse<unknown>
      >;
    }
  }

  async batchPublish<T extends BatchPublishSpec | BatchPublishSpec[]>(
    specOrSpecs: T,
  ): Promise<T extends BatchPublishSpec ? BatchPublishResult : BatchPublishResult[]> {
    let requestBodyDTO: BatchPublishSpec[];
    let singleSpecMode: boolean;
    if (Array.isArray(specOrSpecs)) {
      requestBodyDTO = specOrSpecs;
      singleSpecMode = false;
    } else {
      requestBodyDTO = [specOrSpecs];
      singleSpecMode = true;
    }

    const format = this.client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultPostHeaders(this.client.options);

    if (this.client.options.headers) Utils.mixin(headers, this.client.options.headers);

    const requestBody = Utils.encodeBody(requestBodyDTO, this.client._MsgPack, format);

    const response = await Resource.post(this.client, '/messages', requestBody, headers, {}, null, true);

    const batchResults = (
      response.unpacked ? response.body : Utils.decodeBody(response.body, this.client._MsgPack, format)
    ) as BatchPublishResult[];

    // I don't love the below type assertions but not sure how to avoid them
    if (singleSpecMode) {
      return batchResults[0] as T extends BatchPublishSpec ? BatchPublishResult : BatchPublishResult[];
    } else {
      return batchResults as T extends BatchPublishSpec ? BatchPublishResult : BatchPublishResult[];
    }
  }

  async batchPresence(channels: string[]): Promise<BatchPresenceResult> {
    const format = this.client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultGetHeaders(this.client.options);

    if (this.client.options.headers) Utils.mixin(headers, this.client.options.headers);

    const channelsParam = channels.join(',');

    const response = await Resource.get(this.client, '/presence', headers, { channels: channelsParam }, null, true);

    return (
      response.unpacked ? response.body : Utils.decodeBody(response.body, this.client._MsgPack, format)
    ) as BatchPresenceResult;
  }

  async revokeTokens(
    specifiers: TokenRevocationTargetSpecifier[],
    options?: TokenRevocationOptions,
  ): Promise<TokenRevocationResult> {
    if (useTokenAuth(this.client.options)) {
      throw new ErrorInfo({
        message: 'Cannot revoke tokens when using token auth',
        code: 40162,
        statusCode: 401,
        remediation:
          'Token revocation must use basic auth, so construct a separate Ably.Rest client with ClientOptions.key (the API key that issued the tokens) just for this call. Revocable tokens must have been enabled on the key in the Ably dashboard before the tokens were issued, otherwise there is nothing to revoke.',
      });
    }

    const keyName = this.client.options.keyName!;

    let resolvedOptions = options ?? {};

    const requestBodyDTO = {
      targets: specifiers.map((specifier) => `${specifier.type}:${specifier.value}`),
      ...resolvedOptions,
    };

    const format = this.client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultPostHeaders(this.client.options);

    if (this.client.options.headers) Utils.mixin(headers, this.client.options.headers);

    const requestBody = Utils.encodeBody(requestBodyDTO, this.client._MsgPack, format);

    const response = await Resource.post(
      this.client,
      `/keys/${keyName}/revokeTokens`,
      requestBody,
      headers,
      {},
      null,
      true,
    );

    return (
      response.unpacked ? response.body : Utils.decodeBody(response.body, this.client._MsgPack, format)
    ) as TokenRevocationResult;
  }
}

class Channels {
  client: BaseClient;
  // RSN2
  all: Record<string, RestChannel>;

  constructor(client: BaseClient) {
    this.client = client;
    this.all = Object.create(null);
  }

  get(name: string, channelOptions?: ChannelOptions) {
    name = String(name);
    let channel = this.all[name];
    if (!channel) {
      this.all[name] = channel = new RestChannel(this.client, name, channelOptions);
    } else if (channelOptions) {
      channel.setOptions(channelOptions);
    }

    return channel;
  }

  /* Included to support certain niche use-cases; most users should ignore this.
   * Please do not use this unless you know what you're doing */
  release(name: string) {
    delete this.all[String(name)];
  }
}
