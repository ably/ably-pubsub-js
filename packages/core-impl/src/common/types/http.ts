import Defaults from 'common/lib/util/defaults';
import Platform from 'common/platform';
import BaseRealtime from 'common/lib/client/baserealtime';
import HttpMethods from '../constants/HttpMethods';
import BaseClient from '../lib/client/baseclient';
import ErrorInfo, { IPartialErrorInfo } from '../lib/types/errorinfo';
import Logger from 'common/lib/util/logger';
import * as Utils from 'common/lib/util/utils';

export type PathParameter = string | ((host: string) => string);
export type ResponseHeaders = Partial<Record<string, string | string[]>>;
export type RequestResultError = ErrnoException | IPartialErrorInfo;

/**
 * The `body`, `headers`, `unpacked`, and `statusCode` properties of a `RequestResult` may be populated even if its `error` property is non-null.
 */
export type RequestResult = {
  error: RequestResultError | null;
  body?: unknown;
  headers?: ResponseHeaders;
  unpacked?: boolean;
  statusCode?: number;
};

export type RequestParams = Record<string, string> | null;
export type RequestBody =
  | Buffer // only on Node
  | ArrayBuffer // only on web
  | string;

export interface IPlatformHttpStatic {
  new (client?: BaseClient): IPlatformHttp;
  methods: Array<HttpMethods>;
  methodsWithBody: Array<HttpMethods>;
  methodsWithoutBody: Array<HttpMethods>;
}

export interface IPlatformHttp {
  supportsAuthHeaders: boolean;
  supportsLinkHeaders: boolean;

  /**
   * This method should not throw any errors; rather, it should communicate any error by populating the {@link RequestResult.error} property of the returned {@link RequestResult}.
   *
   * @param signal Abandons the request when it aborts, which then fails with an error.
   */
  doUri(
    method: HttpMethods,
    uri: string,
    headers: Record<string, string> | null,
    body: RequestBody | null,
    params: RequestParams,
    signal?: AbortSignal,
  ): Promise<RequestResult>;

  checkConnectivity?: () => Promise<boolean>;

  /**
   * @param error An error from the {@link RequestResult.error} property of a result returned by {@link doUri}.
   */
  shouldFallback(error: RequestResultError): boolean;
}

export function paramString(params: Record<string, any> | null) {
  const paramPairs = [];
  if (params) {
    for (const needle in params) {
      paramPairs.push(needle + '=' + params[needle]);
    }
  }
  return paramPairs.join('&');
}

export function appendingParams(uri: string, params: Record<string, any> | null) {
  return uri + (params ? '?' : '') + paramString(params);
}

function logResult(
  result: RequestResult,
  method: HttpMethods,
  uri: string,
  params: Record<string, string> | null,
  logger: Logger,
) {
  if (result.error) {
    Logger.logActionNoStrip(
      logger,
      Logger.LOG_MICRO,
      'HttpRequester.' + method + '()',
      'Received Error; ' + appendingParams(uri, params) + '; Error: ' + Utils.inspectError(result.error),
    );
  } else {
    Logger.logActionNoStrip(
      logger,
      Logger.LOG_MICRO,
      'HttpRequester.' + method + '()',
      'Received; ' +
        appendingParams(uri, params) +
        '; Headers: ' +
        paramString(result.headers as Record<string, any>) +
        '; StatusCode: ' +
        result.statusCode +
        '; Body' +
        (Platform.BufferUtils.isBuffer(result.body)
          ? ' (Base64): ' + Platform.BufferUtils.base64Encode(result.body)
          : ': ' + result.body),
    );
  }
}

function logRequest(method: HttpMethods, uri: string, body: RequestBody | null, params: RequestParams, logger: Logger) {
  if (logger.shouldLog(Logger.LOG_MICRO)) {
    Logger.logActionNoStrip(
      logger,
      Logger.LOG_MICRO,
      'HttpRequester.' + method + '()',
      'Sending; ' +
        appendingParams(uri, params) +
        '; Body' +
        (Platform.BufferUtils.isBuffer(body) ? ' (Base64): ' + Platform.BufferUtils.base64Encode(body) : ': ' + body),
    );
  }
}

export class HttpRequester {
  private readonly platformHttp: IPlatformHttp;
  checkConnectivity?: () => Promise<boolean>;

  constructor(private readonly client?: BaseClient) {
    this.platformHttp = new Platform.Http(client);

    this.checkConnectivity = this.platformHttp.checkConnectivity
      ? () => this.platformHttp.checkConnectivity!()
      : undefined;
  }

  get logger(): Logger {
    return this.client?.logger ?? Logger.defaultLogger;
  }

  get supportsAuthHeaders() {
    return this.platformHttp.supportsAuthHeaders;
  }

  get supportsLinkHeaders() {
    return this.platformHttp.supportsLinkHeaders;
  }

  _getHosts(client: BaseClient) {
    /* If we're a connected realtime client, try the endpoint we're connected
     * to first -- but still have fallbacks, being connected is not an absolute
     * guarantee that a datacenter has free capacity to service REST requests. */
    const connection = (client as BaseRealtime).connection,
      connectionHost = connection && connection.connectionManager.host;

    if (connectionHost) {
      return [connectionHost].concat(Defaults.getFallbackHosts(client.options));
    }

    return Defaults.getHosts(client.options);
  }

  /**
   * This method will not throw any errors; rather, it will communicate any error by populating the {@link RequestResult.error} property of the returned {@link RequestResult}.
   */
  async do(
    method: HttpMethods,
    path: PathParameter,
    headers: Record<string, string> | null,
    body: RequestBody | null,
    params: RequestParams,
  ): Promise<RequestResult> {
    try {
      /* Unlike for doUri, the presence of `this.client` here is mandatory, as it's used to generate the hosts */
      const client = this.client;
      if (!client) {
        return { error: new ErrorInfo('http.do called without client', 50000, 500) };
      }

      return await this.doWithSignal(
        readRequestSignal(client, this.logger),
        client,
        method,
        path,
        headers,
        body,
        params,
      );
    } catch (err) {
      // Handle any unexpected error, to ensure we always meet our contract of not throwing any errors
      return { error: new ErrorInfo(`Unexpected error in HttpRequester.do: ${Utils.inspectError(err)}`, 50000, 500) };
    }
  }

  /**
   * Makes the request for {@link do}: to the stored fallback host while it is valid (RSC15f), otherwise to the primary
   * host and then to each fallback host in turn (RSC15l).
   *
   * `signal` comes from the `requestSignal` client option. Once it has aborted, no further host is tried, and the
   * request fails with {@link requestAbortedError}.
   */
  private async doWithSignal(
    signal: AbortSignal | undefined,
    client: BaseClient,
    method: HttpMethods,
    path: PathParameter,
    headers: Record<string, string> | null,
    body: RequestBody | null,
    params: RequestParams,
  ): Promise<RequestResult> {
    const uriFromHost =
      typeof path === 'function'
        ? path
        : function (host: string) {
            return client.baseUri(host) + path;
          };

    let lastError: RequestResultError | null = null;
    const aborted = (): RequestResult => ({ error: requestAbortedError(lastError) });

    /* Requests `host`. Returns null without making a request once the signal has aborted, and in place of a failure
     * once the signal has aborted, since the abort may have cut the request short. */
    const requestHost = async (host: string): Promise<RequestResult | null> => {
      if (signal?.aborted) {
        return null;
      }
      const result = await this.doUri(method, uriFromHost(host), headers, body, params, signal);
      lastError = result.error;
      return result.error && signal?.aborted ? null : result;
    };

    const currentFallback = client._currentFallback;
    if (currentFallback) {
      if (currentFallback.validUntil > Platform.Config.now()) {
        /* Use stored fallback */
        const result = await requestHost(currentFallback.host);
        if (!result) {
          return aborted();
        }
        if (result.error && this.platformHttp.shouldFallback(result.error as ErrnoException)) {
          /* unstore the fallback and start from the top with the default sequence */
          client._currentFallback = null;
          return this.doWithSignal(signal, client, method, path, headers, body, params);
        }
        return result;
      } else {
        /* Fallback expired; remove it and fallthrough to normal sequence */
        client._currentFallback = null;
      }
    }

    const hosts = this._getHosts(client);

    /* see if we have one or more than one host */
    if (hosts.length === 1) {
      return (await requestHost(hosts[0])) ?? aborted();
    }

    let tryAHostStartedAt: number | null = null;
    const tryAHost = async (candidateHosts: Array<string>, persistOnSuccess?: boolean): Promise<RequestResult> => {
      const host = candidateHosts.shift();
      tryAHostStartedAt = tryAHostStartedAt ?? Platform.Config.now();
      const result = await requestHost(host as string);
      if (!result) {
        return aborted();
      }
      if (result.error && this.platformHttp.shouldFallback(result.error as ErrnoException) && candidateHosts.length) {
        // TO3l6
        const elapsedTime = Platform.Config.now() - tryAHostStartedAt;
        if (elapsedTime > client.options.timeouts.httpMaxRetryDuration) {
          return {
            error: new ErrorInfo(
              `Timeout for trying fallback hosts retries. Total elapsed time exceeded the ${client.options.timeouts.httpMaxRetryDuration}ms limit`,
              50003,
              500,
            ),
          };
        }

        return tryAHost(candidateHosts, true);
      }
      if (persistOnSuccess) {
        /* RSC15f */
        client._currentFallback = {
          host: host as string,
          validUntil: Platform.Config.now() + client.options.timeouts.fallbackRetryTimeout,
        };
      }
      return result;
    };
    return tryAHost(hosts);
  }

  /**
   * This method will not throw any errors; rather, it will communicate any error by populating the {@link RequestResult.error} property of the returned {@link RequestResult}.
   *
   * @param signal Abandons the request when it aborts, which then fails with an error.
   */
  async doUri(
    method: HttpMethods,
    uri: string,
    headers: Record<string, string> | null,
    body: RequestBody | null,
    params: RequestParams,
    signal?: AbortSignal,
  ): Promise<RequestResult> {
    try {
      logRequest(method, uri, body, params, this.logger);

      const result = await this.platformHttp.doUri(method, uri, headers, body, params, signal);

      if (this.logger.shouldLog(Logger.LOG_MICRO)) {
        logResult(result, method, uri, params, this.logger);
      }

      return result;
    } catch (err) {
      // Handle any unexpected error, to ensure we always meet our contract of not throwing any errors
      return {
        error: new ErrorInfo(`Unexpected error in HttpRequester.doUri: ${Utils.inspectError(err)}`, 50000, 500),
      };
    }
  }
}

/**
 * Calls the client's `requestSignal` hook, if it has one, and returns the signal it gives for the request about to be
 * made. A hook that throws, or returns anything other than an `AbortSignal`, sets no signal.
 */
function readRequestSignal(client: BaseClient, logger: Logger): AbortSignal | undefined {
  const hook = client.options.requestSignal;
  if (!hook) {
    return undefined;
  }
  try {
    const signal = hook();
    return signal instanceof AbortSignal ? signal : undefined;
  } catch (err) {
    Logger.logAction(
      logger,
      Logger.LOG_ERROR,
      'HttpRequester.do()',
      'requestSignal threw, so the request has no signal; error = ' + Utils.inspectError(err),
    );
    return undefined;
  }
}

/**
 * The error for a request that the signal from the `requestSignal` client option aborted before it completed.
 * `lastError` is the failure of the last host tried before the abort, if any.
 *
 * It has no remediation because only the internal `requestSignal` option can cause it, and the Temporal worker plugin,
 * which sets that option, reports the cancellation of the activity in its place.
 */
function requestAbortedError(lastError: RequestResultError | null): ErrorInfo {
  return new ErrorInfo({
    message: 'Request aborted before it completed, so no further hosts were tried',
    code: 50000,
    statusCode: 500,
    cause: Utils.isErrorInfoOrPartialErrorInfo(lastError) ? lastError : undefined,
  });
}

export interface ErrnoException extends Error {
  errno?: number;
  code?: string;
  path?: string;
  syscall?: string;
  stack?: string;
  statusCode: number;
}
