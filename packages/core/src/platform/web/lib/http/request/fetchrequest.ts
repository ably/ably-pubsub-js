import HttpMethods from 'common/constants/HttpMethods';
import BaseClient from 'common/lib/client/baseclient';
import ErrorInfo, { PartialErrorInfo } from 'common/lib/types/errorinfo';
import { RequestBody, RequestResultError, ResponseHeaders, RequestParams, RequestResult } from 'common/types/http';
import Platform from 'common/platform';
import Defaults from 'common/lib/util/defaults';
import * as Utils from 'common/lib/util/utils';

function isAblyError(responseBody: unknown, headers: Headers): responseBody is { error?: ErrorInfo } {
  return !!headers.get('x-ably-errorcode');
}

function getAblyError(responseBody: unknown, headers: Headers) {
  if (isAblyError(responseBody, headers)) {
    return responseBody.error && ErrorInfo.fromWireValues(responseBody.error);
  }
}

function convertHeaders(headers: Headers) {
  const result: ResponseHeaders = {};

  headers.forEach((value, key) => {
    result[key] = value;
  });

  return result;
}

export default async function fetchRequest(
  method: HttpMethods,
  client: BaseClient | null,
  uri: string,
  headers: Record<string, string> | null,
  params: RequestParams,
  body: RequestBody | null,
): Promise<RequestResult> {
  const fetchHeaders = new Headers(headers || {});
  const _method = method ? method.toUpperCase() : Utils.isNil(body) ? 'GET' : 'POST';

  const controller = new AbortController();

  let timeout: ReturnType<typeof setTimeout>; // This way we don’t have to worry about the fact that the TypeScript compiler is — for reasons I haven’t looked into — picking up the signature of the Node version of setTimeout, which has a different return type to the web one
  const timeoutPromise: Promise<RequestResult> = new Promise((resolve) => {
    timeout = setTimeout(
      () => {
        controller.abort();
        // When AbortController.abort() is called, the fetch() promise rejects with a DOMException named AbortError (source: https://developer.mozilla.org/en-US/docs/Web/API/AbortController)
        // However, we beat it in the Promise.race() by resolving our custom 'Request timed out' error on the next line, thereby exposing users to the better-formatted error.
        resolve({ error: new PartialErrorInfo('Request timed out', null, 408) });
      },
      client ? client.options.timeouts.httpRequestTimeout : Defaults.TIMEOUTS.httpRequestTimeout,
    );
  });

  const requestInit: RequestInit = {
    method: _method,
    headers: fetchHeaders,
    body: body as any,
    signal: controller.signal,
  };

  if (!Platform.Config.isWebworker) {
    requestInit.credentials = fetchHeaders.has('authorization') ? 'include' : 'same-origin';
  }

  const resultPromise = (async (): Promise<RequestResult> => {
    try {
      const urlParams = new URLSearchParams(params || {});
      urlParams.set('rnd', Utils.cheapRandStr());
      const preparedURI = uri + '?' + urlParams;
      const res = await Utils.getGlobalObject().fetch(preparedURI, requestInit);

      clearTimeout(timeout!);

      if (res.status == 204) {
        return { error: null, statusCode: res.status };
      }

      const contentType = res.headers.get('Content-Type');
      let body;
      if (contentType && contentType.indexOf('application/x-msgpack') > -1) {
        body = await res.arrayBuffer();
      } else if (contentType && contentType.indexOf('application/json') > -1) {
        body = await res.json();
      } else {
        body = await res.text();
      }

      const unpacked = !!contentType && contentType.indexOf('application/x-msgpack') === -1;
      const headers = convertHeaders(res.headers);

      if (!res.ok) {
        const error =
          getAblyError(body, res.headers) ||
          new PartialErrorInfo(
            'Error response received from server: ' + res.status + ' body was: ' + Platform.Config.inspect(body),
            null,
            res.status,
          );

        return { error, body, headers, unpacked, statusCode: res.status };
      } else {
        return { error: null, body, headers, unpacked, statusCode: res.status };
      }
    } catch (error) {
      clearTimeout(timeout!);
      return { error: error as RequestResultError };
    }
  })();

  return Promise.race([timeoutPromise, resultPromise]);
}
