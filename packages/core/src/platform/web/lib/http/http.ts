import Platform from 'common/platform';
import Defaults from 'common/lib/util/defaults';
import ErrorInfo, { PartialErrorInfo } from 'common/lib/types/errorinfo';
import { RequestBody, RequestResultError, RequestParams, RequestResult } from 'common/types/http';
import HttpMethods from 'common/constants/HttpMethods';
import BaseClient from 'common/lib/client/baseclient';
import XHRStates from 'common/constants/XHRStates';
import Logger from 'common/lib/util/logger';
import { StandardCallback } from 'common/types/utils';
import { isSuccessCode } from 'common/constants/HttpStatusCodes';
import { ModularPlugins } from 'common/lib/client/modularplugins';

export type HTTPRequestImplementations = Pick<ModularPlugins, 'XHRRequest' | 'FetchRequest'>;

function createMissingImplementationError() {
  return new ErrorInfo(
    'No HTTP request plugin provided. Provide at least one of the FetchRequest or XHRRequest plugins.',
    40000,
    400,
  );
}

const Http = class {
  static methods = [HttpMethods.Get, HttpMethods.Delete, HttpMethods.Post, HttpMethods.Put, HttpMethods.Patch];
  static methodsWithoutBody = [HttpMethods.Get, HttpMethods.Delete];
  static methodsWithBody = [HttpMethods.Post, HttpMethods.Put, HttpMethods.Patch];
  // HTTP request implementations that are available even without a BaseClient object (needed by some tests which directly instantiate `Http` without a client)
  static bundledRequestImplementations: HTTPRequestImplementations;
  checksInProgress: Array<StandardCallback<boolean>> | null = null;
  private client: BaseClient | null;

  constructor(client?: BaseClient) {
    this.client = client ?? null;
    const connectivityCheckUrl = client?.options.connectivityCheckUrl || Defaults.connectivityCheckUrl;
    const connectivityCheckParams = client?.options.connectivityCheckParams ?? null;
    const connectivityUrlIsDefault = !client?.options.connectivityCheckUrl;

    const requestImplementations = {
      ...Http.bundledRequestImplementations,
      ...client?._additionalHTTPRequestImplementations,
    };
    const xhrRequestImplementation = requestImplementations.XHRRequest;
    const fetchRequestImplementation = requestImplementations.FetchRequest;
    const hasImplementation = !!(xhrRequestImplementation || fetchRequestImplementation);

    if (!hasImplementation) {
      throw createMissingImplementationError();
    }

    if (Platform.Config.xhrSupported && xhrRequestImplementation) {
      this.supportsAuthHeaders = true;
      this.Request = async function (
        method: HttpMethods,
        uri: string,
        headers: Record<string, string> | null,
        params: RequestParams,
        body: RequestBody | null,
      ) {
        return new Promise((resolve) => {
          const req = xhrRequestImplementation.createRequest(
            uri,
            headers,
            params,
            body,
            XHRStates.REQ_SEND,
            (client && client.options.timeouts) ?? null,
            this.logger,
            method,
          );
          req.once(
            'complete',
            (
              error: RequestResult['error'],
              body: RequestResult['body'],
              headers: RequestResult['headers'],
              unpacked: RequestResult['unpacked'],
              statusCode: RequestResult['statusCode'],
            ) => resolve({ error, body, headers, unpacked, statusCode }),
          );
          req.exec();
        });
      };
      if (client?.options.disableConnectivityCheck) {
        this.checkConnectivity = async function () {
          return true;
        };
      } else {
        this.checkConnectivity = async function () {
          Logger.logAction(
            this.logger,
            Logger.LOG_MICRO,
            '(XHRRequest)Http.checkConnectivity()',
            'Sending; ' + connectivityCheckUrl,
          );

          const requestResult = await this.doUri(
            HttpMethods.Get,
            connectivityCheckUrl,
            null,
            null,
            connectivityCheckParams,
          );

          let result = false;
          if (!connectivityUrlIsDefault) {
            result = !requestResult.error && isSuccessCode(requestResult.statusCode as number);
          } else {
            result = !requestResult.error && (requestResult.body as string)?.replace(/\n/, '') == 'yes';
          }

          Logger.logAction(this.logger, Logger.LOG_MICRO, '(XHRRequest)Http.checkConnectivity()', 'Result: ' + result);
          return result;
        };
      }
    } else if (Platform.Config.fetchSupported && fetchRequestImplementation) {
      this.supportsAuthHeaders = true;
      this.Request = async (method, uri, headers, params, body) => {
        return fetchRequestImplementation(method, client ?? null, uri, headers, params, body);
      };

      if (client?.options.disableConnectivityCheck) {
        this.checkConnectivity = async function () {
          return true;
        };
      } else {
        this.checkConnectivity = async function () {
          Logger.logAction(
            this.logger,
            Logger.LOG_MICRO,
            '(Fetch)Http.checkConnectivity()',
            'Sending; ' + connectivityCheckUrl,
          );
          const requestResult = await this.doUri(HttpMethods.Get, connectivityCheckUrl, null, null, null);
          const result = !requestResult.error && (requestResult.body as string)?.replace(/\n/, '') == 'yes';
          Logger.logAction(this.logger, Logger.LOG_MICRO, '(Fetch)Http.checkConnectivity()', 'Result: ' + result);
          return result;
        };
      }
    } else {
      this.Request = async () => {
        const error = hasImplementation
          ? new PartialErrorInfo('no supported HTTP transports available', null, 400)
          : createMissingImplementationError();
        return { error };
      };
    }
  }

  get logger(): Logger {
    return this.client?.logger ?? Logger.defaultLogger;
  }

  async doUri(
    method: HttpMethods,
    uri: string,
    headers: Record<string, string> | null,
    body: RequestBody | null,
    params: RequestParams,
  ): Promise<RequestResult> {
    if (!this.Request) {
      return { error: new PartialErrorInfo('Request invoked before assigned to', null, 500) };
    }
    return this.Request(method, uri, headers, params, body);
  }

  private Request?: (
    method: HttpMethods,
    uri: string,
    headers: Record<string, string> | null,
    params: RequestParams,
    body: RequestBody | null,
  ) => Promise<RequestResult>;

  checkConnectivity?: () => Promise<boolean> = undefined;

  supportsAuthHeaders = false;
  supportsLinkHeaders = false;

  shouldFallback(errorInfo: RequestResultError) {
    const statusCode = errorInfo.statusCode as number;
    /* 400 + no code = a generic xhr onerror. Browser doesn't give us enough
     * detail to know whether it's fallback-fixable, but it may be (eg if a
     * network issue), so try just in case */
    return (
      (statusCode === 408 && !errorInfo.code) ||
      (statusCode === 400 && !errorInfo.code) ||
      (statusCode >= 500 && statusCode <= 504)
    );
  }
};

export default Http;
