import type { PageLinks, PageParams, WireHttpPaginatedResponse, WirePage } from '../common/wire.js';
import { ablyFailure } from './failure.js';

/**
 * A page of results from a paginated Ably REST query made from workflow code, such as channel history or
 * presence. It mirrors the Ably `PaginatedResult`.
 *
 * Fetching a related page with {@link TemporalAblyPaginatedResult.next | next()}, {@link TemporalAblyPaginatedResult.first
 * | first()} or {@link TemporalAblyPaginatedResult.current | current()} runs the query's activity again with the
 * parameters from that page's link.
 */
export interface TemporalAblyPaginatedResult<T> {
  /** The items in this page of results. */
  readonly items: T[];
  /**
   * Fetches the first page of results. Runs as a Temporal activity.
   *
   * @returns A promise which is fulfilled with the first page of results. It is rejected with an
   * `ApplicationFailure` of type `AblyError` if this page has no link to the first page.
   */
  first(): Promise<TemporalAblyPaginatedResult<T>>;
  /**
   * Fetches the next page of results. Runs as a Temporal activity when there is a next page.
   *
   * @returns A promise which is fulfilled with the next page of results, or with `null` if this is the last page.
   */
  next(): Promise<TemporalAblyPaginatedResult<T> | null>;
  /**
   * Fetches the current page of results again. Runs as a Temporal activity.
   *
   * @returns A promise which is fulfilled with the current page of results. It is rejected with an
   * `ApplicationFailure` of type `AblyError` if this page has no link to the current page.
   */
  current(): Promise<TemporalAblyPaginatedResult<T>>;
  /**
   * Returns whether there are more pages of results after this one.
   *
   * @returns `true` if {@link TemporalAblyPaginatedResult.next | next()} returns another page, otherwise `false`.
   */
  hasNext(): boolean;
  /**
   * Returns whether this is the last page of results.
   *
   * @returns `true` if this is the last page, otherwise `false`.
   */
  isLast(): boolean;
}

/**
 * A page of the response to `TemporalAblyRest.request()`, with the details of the HTTP response. It
 * mirrors the Ably `HttpPaginatedResponse`.
 *
 * Related pages are fetched with a `GET` request to the same path, with the same API version and headers.
 */
export interface TemporalAblyHttpPaginatedResponse<T = any> extends TemporalAblyPaginatedResult<T> {
  /** The HTTP status code of the response. */
  readonly statusCode: number;
  /** Whether `statusCode` indicates success. This is equivalent to `200 <= statusCode < 300`. */
  readonly success: boolean;
  /** The error code from the `X-Ably-Errorcode` response header, or `null` if the response has none. */
  readonly errorCode: number | null;
  /** The error message from the `X-Ably-Errormessage` response header, or `null` if the response has none. */
  readonly errorMessage: string | null;
  /** Additional details about the error, if the response has any. */
  readonly errorDetail?: Record<string, string>;
  /** The headers of the response. */
  readonly headers: Record<string, string | string[]>;
  first(): Promise<TemporalAblyHttpPaginatedResponse<T>>;
  next(): Promise<TemporalAblyHttpPaginatedResponse<T> | null>;
  current(): Promise<TemporalAblyHttpPaginatedResponse<T>>;
}

/** Which related page of a paginated result to fetch. */
export type PageRelation = keyof PageLinks;

/** Fetches the page at a link of a paginated result, by running the query's activity with the link's params. */
export type PageFetcher<P> = (params: PageParams, relation: PageRelation) => Promise<P>;

class PaginatedResultImpl<T, P> {
  readonly items: T[];
  private readonly links: PageLinks;

  constructor(
    page: WirePage<T>,
    private readonly fetchPage: PageFetcher<P>,
  ) {
    this.items = page.items ?? [];
    this.links = page.links ?? {};
  }

  async first(): Promise<P> {
    if (this.links.first) {
      return this.fetchPage(this.links.first, 'first');
    }
    throw ablyFailure({
      message: 'No link to the first page of results',
      code: 40400,
      statusCode: 404,
      remediation:
        'first() is only available on results from a paginated REST query (such as channel history or presence), whose response includes a link to the first page. This result has no such link, so there is no first page to return.',
    });
  }

  async current(): Promise<P> {
    if (this.links.current) {
      return this.fetchPage(this.links.current, 'current');
    }
    throw ablyFailure({
      message: 'No link to the current page of results',
      code: 40400,
      statusCode: 404,
      remediation:
        'current() reloads the current page and is only available on results from a paginated REST query (such as channel history or presence). This result has no such link. To page through results, use next() with hasNext() or isLast() instead.',
    });
  }

  async next(): Promise<P | null> {
    return this.links.next ? this.fetchPage(this.links.next, 'next') : null;
  }

  hasNext(): boolean {
    return !!this.links.next;
  }

  isLast(): boolean {
    return !this.hasNext();
  }
}

class HttpPaginatedResponseImpl<T, P> extends PaginatedResultImpl<T, P> {
  readonly statusCode: number;
  readonly success: boolean;
  readonly errorCode: number | null;
  readonly errorMessage: string | null;
  readonly errorDetail?: Record<string, string>;
  readonly headers: Record<string, string | string[]>;

  constructor(page: WireHttpPaginatedResponse<T>, fetchPage: PageFetcher<P>) {
    super(page, fetchPage);
    this.statusCode = page.statusCode;
    this.success = page.success;
    this.errorCode = page.errorCode ?? null;
    this.errorMessage = page.errorMessage ?? null;
    if (page.errorDetail !== undefined) {
      this.errorDetail = page.errorDetail;
    }
    this.headers = page.headers ?? {};
  }
}

/** Creates a {@link TemporalAblyPaginatedResult} from a page returned by an activity. */
export function paginatedResult<T>(
  page: WirePage<T>,
  fetchPage: PageFetcher<TemporalAblyPaginatedResult<T>>,
): TemporalAblyPaginatedResult<T> {
  return new PaginatedResultImpl(page, fetchPage);
}

/** Creates a {@link TemporalAblyHttpPaginatedResponse} from a page returned by the request activity. */
export function httpPaginatedResponse<T>(
  page: WireHttpPaginatedResponse<T>,
  fetchPage: PageFetcher<TemporalAblyHttpPaginatedResponse<T>>,
): TemporalAblyHttpPaginatedResponse<T> {
  return new HttpPaginatedResponseImpl(page, fetchPage);
}

/**
 * Runs a paginated query and wraps the page it returns. Related pages are fetched by running the same query
 * with the link's params in place of the caller's params.
 *
 * @param fetch - Runs the query's activity with the given params. `relation` is set when fetching a related page.
 * @param params - The caller's params for the first page.
 */
export async function paginate<T, P>(
  fetch: (params: P | PageParams | undefined, relation?: PageRelation) => Promise<WirePage<T>>,
  params: P | undefined,
): Promise<TemporalAblyPaginatedResult<T>> {
  const fetchPage = async (pageParams: PageParams, relation: PageRelation): Promise<TemporalAblyPaginatedResult<T>> =>
    paginatedResult(await fetch(pageParams, relation), fetchPage);
  return paginatedResult(await fetch(params), fetchPage);
}

/** Returns the activity summary for fetching a page of a paginated query, naming the related page if there is one. */
export function pageSummary(summary: string, relation: PageRelation | undefined): string {
  return relation ? `${summary} (${relation} page)` : summary;
}
