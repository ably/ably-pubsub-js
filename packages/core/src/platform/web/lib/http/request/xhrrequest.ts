import * as Utils from 'common/lib/util/utils';
import EventEmitter from 'common/lib/util/eventemitter';
import ErrorInfo, { IPartialErrorInfo, PartialErrorInfo } from 'common/lib/types/errorinfo';
import type { ErrorCode } from 'common/lib/types/errorcodes';
import Logger from 'common/lib/util/logger';
import Defaults from 'common/lib/util/defaults';
import HttpMethods from 'common/constants/HttpMethods';
import IXHRRequest from 'common/types/IXHRRequest';
import { RequestBody, RequestParams } from 'common/types/http';
import XHRStates from 'common/constants/XHRStates';
import Platform from 'common/platform';

function isAblyError(responseBody: unknown, headers: Record<string, string>): responseBody is { error?: ErrorInfo } {
  return Utils.allToLowerCase(Utils.keysArray(headers)).includes('x-ably-errorcode');
}

function getAblyError(responseBody: unknown, headers: Record<string, string>) {
  if (isAblyError(responseBody, headers)) {
    return responseBody.error && ErrorInfo.fromWireValues(responseBody.error);
  }
}

const noop = function () {};
let idCounter = 0;
const pendingRequests: Record<string, XHRRequest> = {};

function getHeader(xhr: XMLHttpRequest, header: string) {
  return xhr.getResponseHeader && xhr.getResponseHeader(header);
}

/* Safari mysteriously returns 'Identity' for transfer-encoding when in fact
 * it is 'chunked'. So instead, decide that it is chunked when
 * transfer-encoding is present or content-length is absent.  ('or' because
 * when using http2 streaming, there's no transfer-encoding header, but can
 * still deduce streaming from lack of content-length) */
function isEncodingChunked(xhr: XMLHttpRequest) {
  return (
    xhr.getResponseHeader && (xhr.getResponseHeader('transfer-encoding') || !xhr.getResponseHeader('content-length'))
  );
}

function getHeadersAsObject(xhr: XMLHttpRequest) {
  const headerPairs = xhr.getAllResponseHeaders().trim().split('\r\n');
  const headers: Record<string, string> = {};
  for (let i = 0; i < headerPairs.length; i++) {
    const parts = headerPairs[i].split(':').map((x) => x.trim());
    headers[parts[0].toLowerCase()] = parts[1];
  }
  return headers;
}

class XHRRequest extends EventEmitter implements IXHRRequest {
  uri: string;
  headers: Record<string, string>;
  body: RequestBody | null;
  method: string;
  requestMode: number;
  timeouts: Record<string, number>;
  timedOut: boolean;
  requestComplete: boolean;
  id: string;
  streamComplete?: boolean;
  xhr?: XMLHttpRequest | null;
  timer?: NodeJS.Timeout | number | null;

  constructor(
    uri: string,
    headers: Record<string, string> | null,
    params: Record<string, string>,
    body: RequestBody | null,
    requestMode: number,
    timeouts: Record<string, number>,
    logger: Logger,
    method?: HttpMethods,
  ) {
    super(logger);
    params = params || {};
    params.rnd = Utils.cheapRandStr();
    this.uri = uri + Utils.toQueryString(params);
    this.headers = headers || {};
    this.body = body;
    this.method = method ? method.toUpperCase() : Utils.isNil(body) ? 'GET' : 'POST';
    this.requestMode = requestMode;
    this.timeouts = timeouts;
    this.timedOut = false;
    this.requestComplete = false;
    this.id = String(++idCounter);
    pendingRequests[this.id] = this;
  }

  static createRequest(
    uri: string,
    headers: Record<string, string> | null,
    params: RequestParams,
    body: RequestBody | null,
    requestMode: number,
    timeouts: Record<string, number> | null,
    logger: Logger,
    method?: HttpMethods,
  ): XHRRequest {
    /* XHR requests are used either with the context being a realtime
     * transport, or with timeouts passed in (for when used by a rest client),
     * or completely standalone.  Use the appropriate timeouts in each case */
    const _timeouts = timeouts || Defaults.TIMEOUTS;
    return new XHRRequest(
      uri,
      headers,
      Utils.copy(params) as Record<string, string>,
      body,
      requestMode,
      _timeouts,
      logger,
      method,
    );
  }

  complete(
    err?: IPartialErrorInfo | null,
    body?: unknown,
    headers?: Record<string, string> | null,
    unpacked?: boolean | null,
    statusCode?: number,
  ): void {
    if (!this.requestComplete) {
      this.requestComplete = true;
      if (!err && body) {
        this.emit('data', body);
      }
      this.emit('complete', err, body, headers, unpacked, statusCode);
      this.dispose();
    }
  }

  abort(): void {
    this.dispose();
  }

  exec(): void {
    let headers = this.headers;
    const timeout =
        this.requestMode == XHRStates.REQ_SEND ? this.timeouts.httpRequestTimeout : this.timeouts.recvTimeout,
      timer = (this.timer = setTimeout(() => {
        this.timedOut = true;
        xhr.abort();
      }, timeout)),
      method = this.method,
      xhr = (this.xhr = new XMLHttpRequest()),
      accept = headers['accept'];
    let body = this.body;
    let responseType: XMLHttpRequestResponseType = 'text';

    if (!accept) {
      // Default to JSON
      headers['accept'] = 'application/json';
    } else if (accept.indexOf('application/x-msgpack') === 0) {
      // Msgpack responses will be typed as ArrayBuffer
      responseType = 'arraybuffer';
    }

    if (body) {
      const contentType = headers['content-type'] || (headers['content-type'] = 'application/json');
      if (contentType.indexOf('application/json') > -1 && typeof body != 'string') body = JSON.stringify(body);
    }

    // Can probably remove this directive if https://github.com/nodesecurity/eslint-plugin-security/issues/26 is resolved
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    xhr.open(method, this.uri, true);
    xhr.responseType = responseType;

    if ('authorization' in headers) {
      xhr.withCredentials = true;
    }

    for (const h in headers) xhr.setRequestHeader(h, headers[h]);

    const errorHandler = (
      errorEvent: ProgressEvent<EventTarget>,
      message: string,
      code: ErrorCode | null,
      statusCode: number,
    ) => {
      let errorMessage = message + ' (event type: ' + errorEvent.type + ')';
      if (this?.xhr?.statusText) errorMessage += ', current statusText is ' + this.xhr.statusText;
      Logger.logAction(this.logger, Logger.LOG_ERROR, 'Request.on' + errorEvent.type + '()', errorMessage);
      this.complete(new PartialErrorInfo(errorMessage, code, statusCode));
    };
    xhr.onerror = (errorEvent) => {
      errorHandler(errorEvent, 'XHR error occurred', null, 400);
    };
    xhr.onabort = (errorEvent) => {
      if (this.timedOut) {
        errorHandler(errorEvent, 'Request aborted due to request timeout expiring', null, 408);
      } else {
        errorHandler(errorEvent, 'Request cancelled', null, 400);
      }
    };
    xhr.ontimeout = (errorEvent) => {
      errorHandler(errorEvent, 'Request timed out', null, 408);
    };

    let streaming: boolean | string;
    let statusCode: number;
    let successResponse: boolean;
    let streamPos = 0;
    let unpacked = false;

    const onResponse = () => {
      clearTimeout(timer);
      successResponse = statusCode < 400;
      if (statusCode == 204) {
        this.complete(null, null, null, null, statusCode);
        return;
      }
      streaming = this.requestMode == XHRStates.REQ_RECV_STREAM && successResponse && isEncodingChunked(xhr);
    };

    const onEnd = () => {
      let parsedResponse: any;
      try {
        const contentType = getHeader(xhr, 'content-type');
        /* Be liberal in what we accept; buggy auth servers may respond
         * without the correct contenttype, but assume they're still
         * responding with json */
        const json = contentType ? contentType.indexOf('application/json') >= 0 : xhr.responseType == 'text';

        if (json) {
          /* If we requested msgpack but server responded with json, then since
           * we set the responseType expecting msgpack, the response will be
           * an ArrayBuffer containing json */
          const jsonResponseBody =
            xhr.responseType === 'arraybuffer'
              ? Platform.BufferUtils.utf8Decode(xhr.response)
              : String(xhr.responseText);
          if (jsonResponseBody.length) {
            parsedResponse = JSON.parse(jsonResponseBody);
          } else {
            parsedResponse = jsonResponseBody;
          }
          unpacked = true;
        } else {
          parsedResponse = xhr.response;
        }

        if (parsedResponse.response !== undefined) {
          /* unwrap JSON envelope */
          statusCode = parsedResponse.statusCode;
          successResponse = statusCode < 400;
          headers = parsedResponse.headers;
          parsedResponse = parsedResponse.response;
        } else {
          headers = getHeadersAsObject(xhr);
        }
      } catch (e) {
        this.complete(new PartialErrorInfo('Malformed response body from server: ' + (e as Error).message, null, 400));
        return;
      }

      /* If response is an array, it's an array of protocol messages -- even if
       * is contains an error action (hence the nonsuccess statuscode), we can
       * consider the request to have succeeded, just pass it on to
       * onProtocolMessage to decide what to do */
      if (successResponse || Array.isArray(parsedResponse)) {
        this.complete(null, parsedResponse, headers, unpacked, statusCode);
        return;
      }

      let err: IPartialErrorInfo | undefined = getAblyError(parsedResponse, headers);
      if (!err) {
        err = new PartialErrorInfo(
          'Error response received from server: ' +
            statusCode +
            ' body was: ' +
            Platform.Config.inspect(parsedResponse),
          null,
          statusCode,
        );
      }
      this.complete(err, parsedResponse, headers, unpacked, statusCode);
    };

    function onProgress() {
      const responseText = xhr.responseText;
      const bodyEnd = responseText.length - 1;
      let idx, chunk;
      while (streamPos < bodyEnd && (idx = responseText.indexOf('\n', streamPos)) > -1) {
        chunk = responseText.slice(streamPos, idx);
        streamPos = idx + 1;
        onChunk(chunk);
      }
    }

    const onChunk = (chunk: string) => {
      try {
        chunk = JSON.parse(chunk);
      } catch (e) {
        this.complete(new PartialErrorInfo('Malformed response body from server: ' + (e as Error).message, null, 400));
        return;
      }
      this.emit('data', chunk);
    };

    const onStreamEnd = () => {
      onProgress();
      this.streamComplete = true;
      Platform.Config.nextTick(() => {
        this.complete();
      });
    };

    xhr.onreadystatechange = () => {
      const readyState = xhr.readyState;
      if (readyState < 3) return;
      if (xhr.status !== 0) {
        if (statusCode === undefined) {
          statusCode = xhr.status;
          onResponse();
        }
        if (readyState == 3 && streaming) {
          onProgress();
        } else if (readyState == 4) {
          if (streaming) onStreamEnd();
          else onEnd();
        }
      }
    };
    xhr.send(body as any);
  }

  dispose(): void {
    const xhr = this.xhr;
    if (xhr) {
      xhr.onreadystatechange = xhr.onerror = xhr.onabort = xhr.ontimeout = noop;
      this.xhr = null;
      const timer = this.timer;
      if (timer) {
        clearTimeout(timer as NodeJS.Timeout);
        this.timer = null;
      }
      if (!this.requestComplete) xhr.abort();
    }
    delete pendingRequests[this.id];
  }
}

export default XHRRequest;
