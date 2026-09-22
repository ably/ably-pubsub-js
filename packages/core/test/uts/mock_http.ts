/**
 * Mock HTTP infrastructure for UTS tests.
 *
 * Implements the IPlatformHttpStatic/IPlatformHttp interfaces from ably-js
 * while exposing the UTS MockHttpClient interface (PendingConnection + PendingRequest).
 *
 * See: specification/uts/rest/unit/helpers/mock_http.md
 */

interface ConnectionResult {
  success: boolean;
  error?: { code: string; statusCode: number; message: string };
}

interface RequestResult {
  error: { message: string; code: number; statusCode: number } | null;
  body: string | null;
  headers: Record<string, string>;
  unpacked: boolean;
  statusCode: number;
}

/**
 * Represents a pending TCP connection attempt.
 * Test code calls one of the respond_with_* methods to control the outcome.
 */
class PendingConnection {
  host: string;
  port: number;
  tls: boolean;
  timestamp: number;
  _resolve: ((value: ConnectionResult) => void) | null;
  _promise: Promise<ConnectionResult>;

  constructor(host: string, port: number, tls: boolean) {
    this.host = host;
    this.port = port;
    this.tls = tls;
    this.timestamp = Date.now();
    this._resolve = null;
    this._promise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  /** Connection succeeds — HTTP requests can proceed */
  respond_with_success(): void {
    this._resolve!({ success: true });
  }

  /** Connection refused at network level */
  respond_with_refused(): void {
    this._resolve!({ success: false, error: { code: 'ECONNREFUSED', statusCode: 500, message: 'Connection refused' } });
  }

  /** Connection times out (unresponsive) */
  respond_with_timeout(): void {
    this._resolve!({ success: false, error: { code: 'ETIMEDOUT', statusCode: 500, message: 'Connection timed out' } });
  }

  /** DNS resolution fails */
  respond_with_dns_error(): void {
    this._resolve!({ success: false, error: { code: 'ENOTFOUND', statusCode: 500, message: 'DNS resolution failed' } });
  }
}

/**
 * Represents a pending HTTP request (after connection succeeded).
 * Test code calls respond_with() to provide the response.
 */
class PendingRequest {
  method: string;
  url: URL;
  path: string;
  headers: Record<string, string>;
  body: any;
  params: Record<string, string> | null;
  timestamp: number;
  _resolve: ((value: RequestResult) => void) | null;
  _promise: Promise<RequestResult>;

  constructor(
    method: string,
    uri: string,
    headers?: Record<string, string>,
    body?: any,
    params?: Record<string, string> | null,
  ) {
    this.method = method;
    this.url = new URL(uri);
    this.path = this.url.pathname;
    this.headers = headers || {};
    this.body = body;
    this.params = params || null;
    this.timestamp = Date.now();
    this._resolve = null;
    this._promise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  /** Respond with an HTTP response */
  respond_with(status: number, body: any, headers?: Record<string, string>): void {
    const responseHeaders = headers || {};
    const isError = status >= 400;
    let error: RequestResult['error'] = null;

    if (isError) {
      // Extract error info from body if present
      const errBody = typeof body === 'object' && body !== null && body.error ? body.error : null;
      error = {
        message: errBody ? errBody.message : `HTTP ${status}`,
        code: errBody ? errBody.code : status * 100,
        statusCode: errBody ? errBody.statusCode || status : status,
      };
    }

    this._resolve!({
      error: error,
      body: typeof body === 'string' ? body : JSON.stringify(body),
      headers: responseHeaders,
      unpacked: false,
      statusCode: status,
    });
  }

  /** Request times out after connection established */
  respond_with_timeout(): void {
    this._resolve!({
      error: { code: 'ETIMEDOUT', statusCode: 408, message: 'Request timed out' } as any,
      body: null,
      headers: {},
      unpacked: false,
      statusCode: 408,
    });
  }
}

interface MockHttpClientOptions {
  onConnectionAttempt?: (conn: PendingConnection) => void;
  onRequest?: (req: PendingRequest) => void;
}

type ConnectionWaiter = (conn: PendingConnection) => void;
type RequestWaiter = (req: PendingRequest) => void;

/**
 * MockHttpClient — the main mock class.
 *
 * Usage (handler pattern):
 *   const mock = new MockHttpClient({
 *     onConnectionAttempt: (conn) => conn.respond_with_success(),
 *     onRequest: (req) => req.respond_with(200, { time: 123 })
 *   });
 *
 * Usage (await pattern):
 *   const mock = new MockHttpClient();
 *   // ... start client operation ...
 *   const conn = await mock.await_connection_attempt();
 *   conn.respond_with_success();
 *   const req = await mock.await_request();
 *   req.respond_with(200, { time: 123 });
 */
class MockHttpClient {
  onConnectionAttempt: ((conn: PendingConnection) => void) | null;
  onRequest: ((req: PendingRequest) => void) | null;
  captured_requests: PendingRequest[];
  private _connectionWaiters: ConnectionWaiter[];
  private _requestWaiters: RequestWaiter[];

  constructor(options?: MockHttpClientOptions) {
    options = options || {};
    this.onConnectionAttempt = options.onConnectionAttempt || null;
    this.onRequest = options.onRequest || null;
    this.captured_requests = [];
    this._connectionWaiters = [];
    this._requestWaiters = [];
  }

  /** Wait for the next connection attempt */
  await_connection_attempt(timeout?: number): Promise<PendingConnection> {
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => reject(new Error('Timeout waiting for connection attempt')), timeout)
        : null;
      this._connectionWaiters.push((conn) => {
        if (timer) clearTimeout(timer);
        resolve(conn);
      });
    });
  }

  /** Wait for the next HTTP request (after connection succeeds) */
  await_request(timeout?: number): Promise<PendingRequest> {
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => reject(new Error('Timeout waiting for request')), timeout) : null;
      this._requestWaiters.push((req) => {
        if (timer) clearTimeout(timer);
        resolve(req);
      });
    });
  }

  /** Clear all state */
  reset(): void {
    this.captured_requests = [];
    this._connectionWaiters = [];
    this._requestWaiters = [];
  }

  /**
   * Returns an object conforming to IPlatformHttpStatic that can be assigned
   * to Platform.Http.
   */
  asPlatformHttp(): any {
    const mock = this;

    class MockPlatformHttp {
      static methods = ['get', 'delete', 'post', 'put', 'patch'];
      static methodsWithBody = ['post', 'put', 'patch'];
      static methodsWithoutBody = ['get', 'delete'];

      supportsAuthHeaders: boolean;
      supportsLinkHeaders: boolean;

      constructor() {
        this.supportsAuthHeaders = true;
        this.supportsLinkHeaders = true;
      }

      async doUri(
        method: string,
        uri: string,
        headers: Record<string, string>,
        body: any,
        params: Record<string, string>,
      ): Promise<RequestResult> {
        // Phase 1: Connection attempt
        let parsedUrl: URL;
        try {
          // Append params to URL (mirrors real HTTP behavior)
          let fullUri = uri;
          if (params && typeof params === 'object') {
            const qs = Object.entries(params)
              .filter(([, v]) => v !== undefined && v !== null)
              .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
              .join('&');
            if (qs) {
              fullUri += (uri.includes('?') ? '&' : '?') + qs;
            }
          }
          parsedUrl = new URL(fullUri);
        } catch (e) {
          return {
            error: { message: 'Invalid URI: ' + uri, statusCode: 400, code: 40000 },
            body: null,
            headers: {},
            unpacked: false,
            statusCode: 400,
          };
        }

        const host = parsedUrl.hostname;
        const port = parseInt(parsedUrl.port) || (parsedUrl.protocol === 'https:' ? 443 : 80);
        const tls = parsedUrl.protocol === 'https:';

        const conn = new PendingConnection(host, port, tls);

        // Notify handler or waiter
        if (mock.onConnectionAttempt) {
          mock.onConnectionAttempt(conn);
        } else if (mock._connectionWaiters.length > 0) {
          mock._connectionWaiters.shift()!(conn);
        } else {
          // Auto-succeed if no handler
          conn.respond_with_success();
        }

        const connResult = await conn._promise;

        if (!connResult.success) {
          return { error: connResult.error as any, body: null, headers: {}, unpacked: false, statusCode: 0 };
        }

        // Phase 2: HTTP request (use parsedUrl which includes params)
        const req = new PendingRequest(method, parsedUrl.href, headers, body, params);
        mock.captured_requests.push(req);

        // Notify handler or waiter
        if (mock.onRequest) {
          mock.onRequest(req);
        } else if (mock._requestWaiters.length > 0) {
          mock._requestWaiters.shift()!(req);
        } else {
          // Default: 404
          req.respond_with(404, { error: { message: 'No handler configured', code: 40400 } });
        }

        return req._promise;
      }

      async checkConnectivity(): Promise<boolean> {
        // Perform the connectivity check via doUri (same as real implementation)
        const url = 'https://internet-up.ably-realtime.com/is-the-internet-up.txt';
        const { error, body } = await this.doUri('get', url, {}, null, null as any);
        return !error && (body as string)?.toString().trim() === 'yes';
      }

      shouldFallback(error: any): boolean {
        if (!error) return false;
        const code = error.code;
        const statusCode = error.statusCode;
        if (
          code === 'ECONNREFUSED' ||
          code === 'ENETUNREACH' ||
          code === 'EHOSTUNREACH' ||
          code === 'ETIMEDOUT' ||
          code === 'ECONNRESET' ||
          code === 'ENOTFOUND'
        ) {
          return true;
        }
        // RSC15l2: request timeout (HTTP 408)
        if (statusCode === 408) {
          return true;
        }
        return statusCode >= 500 && statusCode <= 504;
      }
    }

    return MockPlatformHttp;
  }
}

export { MockHttpClient, PendingConnection, PendingRequest };
