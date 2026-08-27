import * as Utils from '../util/utils';
import Logger from '../util/logger';
import Resource, { ResourceResult } from './resource';
import ErrorInfo, { IPartialErrorInfo } from '../types/errorinfo';
import BaseClient from './baseclient';
import { RequestBody, ResponseHeaders } from 'common/types/http';
import HttpStatusCodes from '../../constants/HttpStatusCodes';

export type BodyHandler = (body: unknown, headers: ResponseHeaders, unpacked?: boolean) => Promise<any>;

function getRelParams(linkUrl: string) {
  const urlMatch = linkUrl.match(/^\.\/(\w+)\?(.*)$/);
  return urlMatch && urlMatch[2] && Utils.parseQueryString(urlMatch[2]);
}

function parseRelLinks(linkHeader: string | Array<string>) {
  if (typeof linkHeader == 'string') linkHeader = linkHeader.split(',');

  const relParams: Record<string, Record<string, string>> = {};
  for (let i = 0; i < linkHeader.length; i++) {
    const linkMatch = linkHeader[i].match(/^\s*<(.+)>;\s*rel="(\w+)"$/);
    if (linkMatch) {
      const params = getRelParams(linkMatch[1]);
      if (params) relParams[linkMatch[2]] = params;
    }
  }
  return relParams;
}

function returnErrOnly(err: IPartialErrorInfo, body: unknown, useHPR?: boolean) {
  /* If using httpPaginatedResponse, errors from Ably are returned as part of
   * the HPR, only throw `err` for network errors etc. which don't
   * return a body and/or have no ably-originated error code (non-numeric
   * error codes originate from node) */
  return !(useHPR && (body || typeof err.code === 'number'));
}

class PaginatedResource {
  client: BaseClient;
  path: string;
  headers: Record<string, string>;
  envelope: Utils.Format | null;
  bodyHandler: BodyHandler;
  useHttpPaginatedResponse: boolean;

  constructor(
    client: BaseClient,
    path: string,
    headers: Record<string, string>,
    envelope: Utils.Format | undefined,
    bodyHandler: BodyHandler,
    useHttpPaginatedResponse?: boolean,
  ) {
    this.client = client;
    this.path = path;
    this.headers = headers;
    this.envelope = envelope ?? null;
    this.bodyHandler = bodyHandler;
    this.useHttpPaginatedResponse = useHttpPaginatedResponse || false;
  }

  get logger(): Logger {
    return this.client.logger;
  }

  async get<T1, T2>(params: Record<string, T2>): Promise<PaginatedResult<T1>> {
    const result = await Resource.get<T1>(this.client, this.path, this.headers, params, this.envelope, false);
    return this.handlePage(result);
  }

  async delete<T1, T2>(params: Record<string, T2>): Promise<PaginatedResult<T1>> {
    const result = await Resource.delete<T1>(this.client, this.path, this.headers, params, this.envelope, false);
    return this.handlePage(result);
  }

  async post<T1, T2>(params: Record<string, T2>, body: RequestBody | null): Promise<PaginatedResult<T1>> {
    const result = await Resource.post<T1>(this.client, this.path, body, this.headers, params, this.envelope, false);
    return this.handlePage(result);
  }

  async put<T1, T2>(params: Record<string, T2>, body: RequestBody | null): Promise<PaginatedResult<T1>> {
    const result = await Resource.put<T1>(this.client, this.path, body, this.headers, params, this.envelope, false);
    return this.handlePage(result);
  }

  async patch<T1, T2>(params: Record<string, T2>, body: RequestBody | null): Promise<PaginatedResult<T1>> {
    const result = await Resource.patch<T1>(this.client, this.path, body, this.headers, params, this.envelope, false);
    return this.handlePage(result);
  }

  async handlePage<T>(result: ResourceResult<T>): Promise<PaginatedResult<T>> {
    if (result.err && returnErrOnly(result.err, result.body, this.useHttpPaginatedResponse)) {
      Logger.logAction(
        this.logger,
        Logger.LOG_ERROR,
        'PaginatedResource.handlePage()',
        'Unexpected error getting resource: err = ' + Utils.inspectError(result.err),
      );
      throw result.err;
    }

    let items, linkHeader, relParams;

    try {
      items =
        result.statusCode == HttpStatusCodes.NoContent
          ? []
          : await this.bodyHandler(result.body, result.headers || {}, result.unpacked);
    } catch (e) {
      /* If we got an error, the failure to parse the body is almost certainly
       * due to that, so throw that in preference over the parse error */
      throw result.err || e;
    }

    if (result.headers && (linkHeader = result.headers['Link'] || result.headers['link'])) {
      relParams = parseRelLinks(linkHeader);
    }

    if (this.useHttpPaginatedResponse) {
      return new HttpPaginatedResponse(
        this,
        items,
        result.headers || {},
        result.statusCode as number,
        relParams,
        result.err,
      );
    } else {
      return new PaginatedResult(this, items, relParams);
    }
  }
}

export class PaginatedResult<T> {
  resource: PaginatedResource;
  items: T[];
  private _relParams?: Record<string, any>;

  constructor(resource: PaginatedResource, items: T[], relParams?: Record<string, any>) {
    this.resource = resource;
    this.items = items;
    this._relParams = relParams;
  }

  async first(): Promise<PaginatedResult<T>> {
    if (this.hasFirst()) {
      return this.get(this._relParams!.first);
    }

    throw new ErrorInfo({
      message: 'No link to the first page of results',
      code: 40400,
      statusCode: 404,
      remediation:
        'first() is only available on results from a paginated REST query (such as channel history, presence, or stats), whose response includes a link to the first page. This result has no such link, so there is no first page to return.',
    });
  }

  async current(): Promise<PaginatedResult<T>> {
    if (this.hasCurrent()) {
      return this.get(this._relParams!.current);
    }

    throw new ErrorInfo({
      message: 'No link to the current page of results',
      code: 40400,
      statusCode: 404,
      remediation:
        'current() reloads the current page and is only available on results from a paginated REST query (such as channel history, presence, or stats). This result has no such link. To page through results, use next() with hasNext() or isLast() instead.',
    });
  }

  async next(): Promise<PaginatedResult<T> | null> {
    if (this.hasNext()) {
      return this.get(this._relParams!.next);
    }

    return null;
  }

  hasFirst(): boolean {
    return this._relParams != null && 'first' in this._relParams;
  }

  hasCurrent(): boolean {
    return this._relParams != null && 'current' in this._relParams;
  }

  hasNext(): boolean {
    return this._relParams != null && 'next' in this._relParams;
  }

  isLast(): boolean {
    return !this.hasNext();
  }

  /* We assume that only the initial request can be a POST, and that accessing
   * the rest of a multipage set of results can always be done with GET */
  async get(params: any): Promise<PaginatedResult<T>> {
    const res = this.resource;
    const result = await Resource.get<T>(res.client, res.path, res.headers, params, res.envelope, false);
    return res.handlePage(result);
  }
}

export class HttpPaginatedResponse<T> extends PaginatedResult<T> {
  statusCode: number;
  success: boolean;
  headers: ResponseHeaders;
  errorCode?: number | null;
  errorMessage?: string | null;
  errorDetail?: Record<string, string>;

  constructor(
    resource: PaginatedResource,
    items: T[],
    headers: ResponseHeaders,
    statusCode: number,
    relParams: any,
    err: IPartialErrorInfo | null,
  ) {
    super(resource, items, relParams);
    this.statusCode = statusCode;
    this.success = statusCode < 300 && statusCode >= 200;
    this.headers = headers;
    this.errorCode = err && err.code;
    this.errorMessage = err && err.message;
    this.errorDetail = err?.detail;
  }

  toJSON() {
    return {
      items: this.items,
      statusCode: this.statusCode,
      success: this.success,
      headers: this.headers,
      errorCode: this.errorCode,
      errorMessage: this.errorMessage,
      errorDetail: this.errorDetail,
    };
  }
}

export default PaginatedResource;
