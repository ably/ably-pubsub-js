import Platform from '../../platform';
import * as Utils from '../util/utils';
import Logger from '../util/logger';
import Auth from './auth';
import HttpMethods from '../../constants/HttpMethods';
import ErrorInfo, { IPartialErrorInfo, PartialErrorInfo } from '../types/errorinfo';
import BaseClient from './baseclient';
import { MsgPack } from 'common/types/msgpack';
import { RequestBody, ResponseHeaders, appendingParams as urlFromPathAndParams, paramString } from 'common/types/http';
import httpStatusCodes from '../../constants/HttpStatusCodes';

async function withAuthDetails<T>(
  client: BaseClient,
  headers: ResponseHeaders | undefined,
  params: Record<string, any>,
  opCallback: Function,
): Promise<ResourceResult<T>> {
  if (client.http.supportsAuthHeaders) {
    const authHeaders = await client.auth.getAuthHeaders();
    return opCallback(Utils.mixin(authHeaders!, headers), params);
  } else {
    const authParams = await client.auth.getAuthParams();
    return opCallback(headers, Utils.mixin(authParams!, params));
  }
}

function unenvelope<T>(
  result: ResourceResult<T>,
  MsgPack: MsgPack | null,
  format: Utils.Format | null,
): ResourceResult<T> {
  if (result.err && !result.body) {
    return { err: result.err };
  }

  if (result.statusCode === httpStatusCodes.NoContent) {
    return { ...result, body: [] as any, unpacked: true };
  }

  let body = result.body;

  if (!result.unpacked) {
    try {
      body = Utils.decodeBody(body, MsgPack, format);
    } catch (e) {
      if (Utils.isErrorInfoOrPartialErrorInfo(e)) {
        return { err: e };
      } else {
        return { err: new PartialErrorInfo(Utils.inspectError(e), null) };
      }
    }
  }

  if (!body) {
    return { err: new PartialErrorInfo('unenvelope(): Response body is missing', null) };
  }

  const { statusCode: wrappedStatusCode, response, headers: wrappedHeaders } = body as Record<string, any>;

  if (wrappedStatusCode === undefined) {
    /* Envelope already unwrapped by the transport */
    return { ...result, body, unpacked: true };
  }

  if (wrappedStatusCode < 200 || wrappedStatusCode >= 300) {
    /* handle wrapped errors */
    let wrappedErr = (response && response.error) || result.err;
    if (!wrappedErr) {
      wrappedErr = new Error('Error in unenveloping ' + body);
      wrappedErr.statusCode = wrappedStatusCode;
    }
    return { err: wrappedErr, body: response, headers: wrappedHeaders, unpacked: true, statusCode: wrappedStatusCode };
  }

  return { err: result.err, body: response, headers: wrappedHeaders, unpacked: true, statusCode: wrappedStatusCode };
}

function logResult<T>(
  result: ResourceResult<T>,
  method: HttpMethods,
  path: string,
  params: Record<string, string>,
  logger: Logger,
) {
  if (result.err) {
    Logger.logAction(
      logger,
      Logger.LOG_MICRO,
      'Resource.' + method + '()',
      'Received Error; ' + urlFromPathAndParams(path, params) + '; Error: ' + Utils.inspectError(result.err),
    );
  } else {
    Logger.logAction(
      logger,
      Logger.LOG_MICRO,
      'Resource.' + method + '()',
      'Received; ' +
        urlFromPathAndParams(path, params) +
        '; Headers: ' +
        paramString(result.headers as Record<string, any>) +
        '; StatusCode: ' +
        result.statusCode +
        '; Body: ' +
        (Platform.BufferUtils.isBuffer(result.body)
          ? ' (Base64): ' + Platform.BufferUtils.base64Encode(result.body)
          : ': ' + Platform.Config.inspect(result.body)),
    );
  }
}

export interface ResourceResponse<T> {
  body?: T;
  headers?: ResponseHeaders;
  unpacked?: boolean;
  statusCode?: number;
}

export interface ResourceResult<T> extends ResourceResponse<T> {
  /**
   * Any error returned by the underlying HTTP client.
   */
  err: IPartialErrorInfo | null;
}

class Resource {
  /**
   * @param throwError Whether to throw any error returned by the underlying HTTP client.
   *
   * If you specify `true`, then this method will return a `ResourceResponse<T>`, and if the underlying HTTP client returns an error, this method call will throw that error. If you specify `false`, then it will return a `ResourceResult<T>`, whose `err` property contains any error that was returned by the underlying HTTP client.
   */
  static async get<T = unknown>(
    client: BaseClient,
    path: string,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: true,
  ): Promise<ResourceResponse<T>>;
  static async get<T = unknown>(
    client: BaseClient,
    path: string,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: false,
  ): Promise<ResourceResult<T>>;
  static async get<T = unknown>(
    client: BaseClient,
    path: string,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: boolean,
  ): Promise<ResourceResponse<T> | ResourceResult<T>> {
    return Resource.do(HttpMethods.Get, client, path, null, headers, params, envelope, throwError ?? false);
  }

  /**
   * @param throwError Whether to throw any error returned by the underlying HTTP client.
   *
   * If you specify `true`, then this method will return a `ResourceResponse<T>`, and if the underlying HTTP client returns an error, this method call will throw that error. If you specify `false`, then it will return a `ResourceResult<T>`, whose `err` property contains any error that was returned by the underlying HTTP client.
   */
  static async delete<T = unknown>(
    client: BaseClient,
    path: string,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: true,
  ): Promise<ResourceResponse<T>>;
  static async delete<T = unknown>(
    client: BaseClient,
    path: string,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: false,
  ): Promise<ResourceResult<T>>;
  static async delete<T = unknown>(
    client: BaseClient,
    path: string,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: boolean,
  ): Promise<ResourceResponse<T> | ResourceResult<T>> {
    return Resource.do(HttpMethods.Delete, client, path, null, headers, params, envelope, throwError);
  }

  /**
   * @param throwError Whether to throw any error returned by the underlying HTTP client.
   *
   * If you specify `true`, then this method will return a `ResourceResponse<T>`, and if the underlying HTTP client returns an error, this method call will throw that error. If you specify `false`, then it will return a `ResourceResult<T>`, whose `err` property contains any error that was returned by the underlying HTTP client.
   */
  static async post<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: true,
  ): Promise<ResourceResponse<T>>;
  static async post<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: false,
  ): Promise<ResourceResult<T>>;
  static async post<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: boolean,
  ): Promise<ResourceResponse<T> | ResourceResult<T>> {
    return Resource.do(HttpMethods.Post, client, path, body, headers, params, envelope, throwError);
  }

  /**
   * @param throwError Whether to throw any error returned by the underlying HTTP client.
   *
   * If you specify `true`, then this method will return a `ResourceResponse<T>`, and if the underlying HTTP client returns an error, this method call will throw that error. If you specify `false`, then it will return a `ResourceResult<T>`, whose `err` property contains any error that was returned by the underlying HTTP client.
   */
  static async patch<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: true,
  ): Promise<ResourceResponse<T>>;
  static async patch<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: false,
  ): Promise<ResourceResult<T>>;
  static async patch<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: boolean,
  ): Promise<ResourceResponse<T> | ResourceResult<T>> {
    return Resource.do(HttpMethods.Patch, client, path, body, headers, params, envelope, throwError);
  }

  /**
   * @param throwError Whether to throw any error returned by the underlying HTTP client.
   *
   * If you specify `true`, then this method will return a `ResourceResponse<T>`, and if the underlying HTTP client returns an error, this method call will throw that error. If you specify `false`, then it will return a `ResourceResult<T>`, whose `err` property contains any error that was returned by the underlying HTTP client.
   */
  static async put<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: true,
  ): Promise<ResourceResponse<T>>;
  static async put<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: false,
  ): Promise<ResourceResult<T>>;
  static async put<T = unknown>(
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: boolean,
  ): Promise<ResourceResponse<T> | ResourceResult<T>> {
    return Resource.do(HttpMethods.Put, client, path, body, headers, params, envelope, throwError);
  }

  static async do<T>(
    method: HttpMethods,
    client: BaseClient,
    path: string,
    body: RequestBody | null,
    headers: Record<string, string>,
    params: Record<string, any>,
    envelope: Utils.Format | null,
    throwError: boolean,
  ): Promise<ResourceResponse<T> | ResourceResult<T>> {
    if (envelope) {
      (params = params || {})['envelope'] = envelope;
    }

    const logger = client.logger;

    async function doRequest(
      this: any,
      headers: Record<string, string>,
      params: Record<string, any>,
    ): Promise<ResourceResult<T>> {
      if (logger.shouldLog(Logger.LOG_MICRO)) {
        let decodedBody = body;
        if (headers['content-type']?.indexOf('msgpack') > 0) {
          try {
            if (!client._MsgPack) {
              Utils.throwMissingPluginError('MsgPack');
            }
            decodedBody = client._MsgPack.decode(body as Buffer);
          } catch (decodeErr) {
            Logger.logAction(
              logger,
              Logger.LOG_MICRO,
              'Resource.' + method + '()',
              'Sending MsgPack Decoding Error: ' + Utils.inspectError(decodeErr),
            );
          }
        }
        Logger.logAction(
          logger,
          Logger.LOG_MICRO,
          'Resource.' + method + '()',
          'Sending; ' + urlFromPathAndParams(path, params) + '; Body: ' + decodedBody,
        );
      }

      const httpResult = await client.http.do(method, path, headers, body, params);

      if (httpResult.error && Auth.isTokenErr(httpResult.error as ErrorInfo)) {
        /* token has expired, so get a new one */
        await client.auth.authorize(null, null);
        /* retry ... */
        return withAuthDetails(client, headers, params, doRequest);
      }

      return {
        err: httpResult.error as ErrorInfo,
        body: httpResult.body as T | undefined,
        headers: httpResult.headers,
        unpacked: httpResult.unpacked,
        statusCode: httpResult.statusCode,
      };
    }

    let result = await withAuthDetails<T>(client, headers, params, doRequest);

    if (envelope) {
      result = unenvelope(result, client._MsgPack, envelope);
    }

    if (logger.shouldLog(Logger.LOG_MICRO)) {
      logResult(result, method, path, params, logger);
    }

    if (throwError) {
      if (result.err) {
        throw result.err;
      } else {
        const response: Omit<ResourceResult<T>, 'err'> & Pick<Partial<ResourceResult<T>>, 'err'> = { ...result };
        delete response.err;
        return response;
      }
    }

    return result;
  }
}

export default Resource;
