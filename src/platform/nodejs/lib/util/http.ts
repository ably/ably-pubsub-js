import Platform from 'common/platform';
import Defaults from 'common/lib/util/defaults';
import ErrorInfo from 'common/lib/types/errorinfo';
import type { ErrorCode } from 'common/lib/types/errorcodes';
import {
  ErrnoException,
  RequestBody,
  IPlatformHttpStatic,
  RequestResultError,
  RequestParams,
  RequestResult,
} from '../../../../common/types/http';
import HttpMethods from '../../../../common/constants/HttpMethods';
import got, { Response, Options, CancelableRequest, Agents } from 'got';
import http from 'http';
import https from 'https';
import BaseClient from 'common/lib/client/baseclient';
import { RestAgentOptions } from 'common/types/ClientOptions';
import { isSuccessCode } from 'common/constants/HttpStatusCodes';
import { createMissingPluginError, shallowEquals } from 'common/lib/util/utils';

/***************************************************
 *
 * These Http operations are used for REST operations
 * and assume that the system is stateless - ie
 * there is no connection state that tells us
 * anything about the state of the network or the
 * viability of any of the hosts we know about.
 * Therefore all requests will respond to specific
 * errors by attempting the fallback hosts, and no
 * assumptions about host or network is retained to
 * influence the handling of any subsequent request.
 *
 ***************************************************/

const globalAgentPool: Array<{ options: RestAgentOptions; agents: Agents }> = [];

const Http: IPlatformHttpStatic = class {
  static methods = [HttpMethods.Get, HttpMethods.Delete, HttpMethods.Post, HttpMethods.Put, HttpMethods.Patch];
  static methodsWithoutBody = [HttpMethods.Get, HttpMethods.Delete];
  static methodsWithBody = [HttpMethods.Post, HttpMethods.Put, HttpMethods.Patch];
  private agent: Agents | null = null;
  supportsAuthHeaders = true;
  supportsLinkHeaders = true;
  private client: BaseClient | null;

  constructor(client?: BaseClient) {
    this.client = client ?? null;
  }

  async doUri(
    method: HttpMethods,
    uri: string,
    headers: Record<string, string> | null,
    body: RequestBody | null,
    params: RequestParams,
  ): Promise<RequestResult> {
    /* Will generally be making requests to one or two servers exclusively
     * (Ably and perhaps an auth server), so for efficiency, use the
     * foreverAgent to keep the TCP stream alive between requests where possible */
    const agentOptions =
      (this.client && this.client.options.restAgentOptions) || (Defaults.restAgentOptions as RestAgentOptions);
    const doOptions: Options = { headers: headers || undefined, responseType: 'buffer' };

    if (!this.agent) {
      const persistedAgent = globalAgentPool.find((x) => shallowEquals(agentOptions, x.options))?.agents;
      if (persistedAgent) {
        this.agent = persistedAgent;
      } else {
        this.agent = {
          http: new http.Agent(agentOptions),
          https: new https.Agent(agentOptions),
        };
        globalAgentPool.push({
          options: agentOptions,
          agents: this.agent,
        });
      }
    }

    if (body) {
      doOptions.body = body as Buffer;
    }
    if (params) doOptions.searchParams = params;

    doOptions.agent = this.agent;

    doOptions.url = uri;
    doOptions.timeout = {
      request: ((this.client && this.client.options.timeouts) || Defaults.TIMEOUTS).httpRequestTimeout,
    };
    // We have our own logic that retries appropriate statuscodes to fallback endpoints,
    // with timeouts constructed appropriately. Don't want `got` doing its own retries to
    // the same endpoint, inappropriately retrying 429s, etc
    doOptions.retry = { limit: 0 };

    try {
      const res = await (got[method](doOptions) as CancelableRequest<Response>);
      return this._handler(null, res, res.body);
    } catch (err) {
      if (err instanceof got.HTTPError) {
        return this._handler(null, err.response, err.response.body);
      }
      return this._handler(err as ErrnoException);
    }
  }

  checkConnectivity = async (): Promise<boolean> => {
    if (this.client?.options.disableConnectivityCheck) {
      return true;
    }
    const connectivityCheckUrl = this.client?.options.connectivityCheckUrl || Defaults.connectivityCheckUrl;
    const connectivityCheckParams = this.client?.options.connectivityCheckParams ?? null;
    const connectivityUrlIsDefault = !this.client?.options.connectivityCheckUrl;

    const { error, statusCode, body } = await this.doUri(
      HttpMethods.Get,
      connectivityCheckUrl,
      null,
      null,
      connectivityCheckParams,
    );

    if (!error && !connectivityUrlIsDefault) {
      return isSuccessCode(statusCode as number);
    }
    return !error && (body as Buffer | string)?.toString().trim() === 'yes';
  };

  shouldFallback(err: RequestResultError) {
    const { code, statusCode } = err as ErrnoException;
    return (
      code === 'ENETUNREACH' ||
      code === 'EHOSTUNREACH' ||
      code === 'EHOSTDOWN' ||
      code === 'ETIMEDOUT' ||
      code === 'ESOCKETTIMEDOUT' ||
      code === 'ENOTFOUND' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      (statusCode >= 500 && statusCode <= 504)
    );
  }

  private _handler(err: ErrnoException | null, response?: Response, body?: unknown) {
    if (err) {
      return { error: err };
    }

    const statusCode = (response as Response).statusCode,
      headers = (response as Response).headers;

    if (statusCode >= 300) {
      switch (headers['content-type']) {
        case 'application/json':
          body = JSON.parse(body as string);
          break;

        case 'application/x-msgpack':
          if (!this.client?._MsgPack) {
            return { error: createMissingPluginError('MsgPack') };
          }
          body = this.client._MsgPack.decode(body as Buffer);
          break;
      }

      const error = (body as { error: ErrorInfo }).error
        ? ErrorInfo.fromWireValues((body as { error: ErrorInfo }).error)
        : new ErrorInfo(
            (headers['x-ably-errormessage'] as string) ||
              'Error response received from server: ' + statusCode + ' body was: ' + Platform.Config.inspect(body),
            // Read off a response header, so the server chose it and it can't be checked
            // against the registry.
            Number(headers['x-ably-errorcode']) as ErrorCode,
            statusCode,
          );

      return { error, body, headers, unpacked: true, statusCode };
    }

    return { error: null, body, headers, unpacked: false, statusCode };
  }
};

export default Http;
