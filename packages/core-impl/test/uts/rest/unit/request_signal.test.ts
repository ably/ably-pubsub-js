/**
 * The `requestSignal` client option — not a UTS spec translation.
 *
 * `requestSignal` is an internal client option, absent from the public types, that the Temporal worker plugin uses to
 * abandon each REST request once Temporal cancels the activity that makes it. These tests cover how
 * `HttpRequester.do` applies it to the host fallback sequence (RSC15l, RSC15f) and to token renewal (RSA4b).
 */

import { expect } from 'chai';
import { MockHttpClient, PendingRequest } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';

const PRIMARY = 'main.realtime.ably.net';
const ABORTED_MESSAGE = 'Request aborted before it completed, so no further hosts were tried';

const serverError = { error: { message: 'Server error', code: 50000, statusCode: 500 } };

describe('uts/rest/unit/request_signal', function () {
  afterEach(function () {
    restoreAll();
  });

  /** Installs a mock HTTP client that passes each request to `handler`, and returns the requests it receives. */
  function mockRequests(handler: (req: PendingRequest, index: number) => void): PendingRequest[] {
    const requests: PendingRequest[] = [];
    installMockHttp(
      new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          requests.push(req);
          handler(req, requests.length - 1);
        },
      }),
    );
    return requests;
  }

  function client(requestSignal?: () => AbortSignal | undefined, options: Record<string, unknown> = {}): any {
    return new Ably.Http({ key: 'app.key:secret', useBinaryProtocol: false, requestSignal, ...options } as any);
  }

  /** Expects `promise` to reject with the aborted error, and returns the error. */
  async function expectAbortedError(promise: Promise<unknown>): Promise<any> {
    try {
      await promise;
    } catch (err: any) {
      expect(err.code).to.equal(50000);
      expect(err.statusCode).to.equal(500);
      expect(err.message).to.equal(ABORTED_MESSAGE);
      return err;
    }
    expect.fail('Expected the request to fail with the aborted error');
  }

  it('leaves the fallback sequence unchanged without the option', async function () {
    const requests = mockRequests((req, index) =>
      index === 0 ? req.respond_with(500, serverError) : req.respond_with(200, [1234567890000]),
    );

    expect(await client().time()).to.equal(1234567890000);

    expect(requests).to.have.length(2);
    expect(requests[0].url.hostname).to.equal(PRIMARY);
    expect(requests[1].url.hostname).to.not.equal(PRIMARY);
    expect(requests.map((req) => req.signal)).to.deep.equal([undefined, undefined]);
  });

  it('passes no signal when the hook returns undefined', async function () {
    const requests = mockRequests((req) => req.respond_with(200, [1234567890000]));

    await client(() => undefined).time();

    expect(requests[0].signal).to.equal(undefined);
  });

  it('treats a hook that throws as no signal', async function () {
    const requests = mockRequests((req) => req.respond_with(200, [1234567890000]));

    const result = await client(() => {
      throw new Error('no activity');
    }).time();

    expect(result).to.equal(1234567890000);
    expect(requests[0].signal).to.equal(undefined);
  });

  it('passes the signal to the request to each host, and reads it once for each request', async function () {
    const controller = new AbortController();
    let calls = 0;
    const requests = mockRequests((req, index) =>
      index < 2 ? req.respond_with(500, serverError) : req.respond_with(200, [1234567890000]),
    );

    await client(() => {
      calls++;
      return controller.signal;
    }).time();

    expect(calls).to.equal(1);
    expect(requests).to.have.length(3);
    for (const req of requests) {
      expect(req.signal).to.equal(controller.signal);
    }
  });

  it('makes no request once the signal has aborted', async function () {
    const requests = mockRequests((req) => req.respond_with(200, [1234567890000]));

    const err = await expectAbortedError(client(() => AbortSignal.abort()).time());

    expect(requests).to.have.length(0);
    expect(err.cause).to.equal(undefined);
  });

  it('abandons the request in progress when the signal aborts, and tries no further host', async function () {
    const controller = new AbortController();
    const requests = mockRequests(() => controller.abort());

    const err = await expectAbortedError(client(() => controller.signal).time());

    expect(requests).to.have.length(1);
    expect(requests[0].url.hostname).to.equal(PRIMARY);
    expect(err.cause).to.equal(undefined);
  });

  it('tries no further host when the signal aborts after a host fails', async function () {
    const controller = new AbortController();
    const requests = mockRequests((req) => {
      req.respond_with(500, serverError);
      controller.abort();
    });

    await expectAbortedError(client(() => controller.signal).time());

    expect(requests).to.have.length(1);
  });

  it('reports a request to the only host that the signal cut short as aborted', async function () {
    const controller = new AbortController();
    const requests = mockRequests(() => controller.abort());

    await expectAbortedError(client(() => controller.signal, { fallbackHosts: [] }).time());

    expect(requests).to.have.length(1);
  });

  it('returns a response that arrives before the signal aborts', async function () {
    const controller = new AbortController();
    mockRequests((req) => {
      req.respond_with(200, [1234567890000]);
      controller.abort();
    });

    expect(await client(() => controller.signal).time()).to.equal(1234567890000);
  });

  describe('stored fallback host (RSC15f)', function () {
    /** A client whose first request fails on the primary host and succeeds on a fallback host, which it stores. */
    async function clientWithStoredFallback(
      signal: () => AbortSignal | undefined,
      handler: (req: PendingRequest) => void,
    ): Promise<{ ably: any; fallbackHost: string; requests: PendingRequest[] }> {
      let primed = false;
      const requests = mockRequests((req) => {
        if (!primed) {
          if (req.url.hostname === PRIMARY) {
            req.respond_with(500, serverError);
          } else {
            primed = true;
            req.respond_with(200, [1234567890000]);
          }
          return;
        }
        handler(req);
      });
      const ably = client(signal);
      await ably.time();
      const fallbackHost = requests[requests.length - 1].url.hostname;
      requests.length = 0;
      return { ably, fallbackHost, requests };
    }

    it('keeps the stored fallback host when the signal cuts its request short', async function () {
      let controller = new AbortController();
      let abortNext = true;
      const { ably, fallbackHost, requests } = await clientWithStoredFallback(
        () => controller.signal,
        (req) => {
          if (abortNext) {
            abortNext = false;
            controller.abort();
          } else {
            req.respond_with(200, [1234567890000]);
          }
        },
      );
      expect(fallbackHost).to.not.equal(PRIMARY);

      await expectAbortedError(ably.time());
      controller = new AbortController();
      await ably.time();

      expect(requests.map((req) => req.url.hostname)).to.deep.equal([fallbackHost, fallbackHost]);
    });

    it('does not start again from the primary host when the signal aborts after the stored fallback host fails', async function () {
      const controller = new AbortController();
      const { ably, fallbackHost, requests } = await clientWithStoredFallback(
        () => controller.signal,
        (req) => {
          req.respond_with(500, serverError);
          controller.abort();
        },
      );

      await expectAbortedError(ably.time());

      expect(requests.map((req) => req.url.hostname)).to.deep.equal([fallbackHost]);
    });
  });

  describe('token renewal (RSA4b)', function () {
    function tokenDetails(token: string) {
      const now = Date.now();
      return { token, keyName: 'app.key', issued: now, expires: now + 3_600_000, capability: '{"*":["*"]}' };
    }

    it('passes the same signal to the token requests and the retried request', async function () {
      const controller = new AbortController();
      let tokens = 0;
      let rejected = false;
      const requests = mockRequests((req) => {
        if (req.path.endsWith('/requestToken')) {
          tokens++;
          req.respond_with(200, tokenDetails('token-' + tokens));
        } else if (!rejected) {
          rejected = true;
          req.respond_with(401, { error: { message: 'Token expired', code: 40142, statusCode: 401 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      });

      await client(() => controller.signal, { useTokenAuth: true }).stats({});

      expect(requests.map((req) => req.path)).to.deep.equal([
        '/keys/app.key/requestToken',
        '/stats',
        '/keys/app.key/requestToken',
        '/stats',
      ]);
      for (const req of requests) {
        expect(req.signal).to.equal(controller.signal);
      }
    });

    it('does not retry the request when the signal aborts during the renewal', async function () {
      const controller = new AbortController();
      let tokens = 0;
      const requests = mockRequests((req) => {
        if (req.path.endsWith('/requestToken')) {
          tokens++;
          if (tokens === 1) {
            req.respond_with(200, tokenDetails('token-1'));
          } else {
            controller.abort();
          }
        } else {
          req.respond_with(401, { error: { message: 'Token expired', code: 40142, statusCode: 401 } });
        }
      });

      try {
        await client(() => controller.signal, { useTokenAuth: true }).stats({});
        expect.fail('Expected stats() to throw');
      } catch (err: any) {
        expect(err.message).to.not.equal('Expected stats() to throw');
      }

      expect(requests.map((req) => req.path)).to.deep.equal([
        '/keys/app.key/requestToken',
        '/stats',
        '/keys/app.key/requestToken',
      ]);
    });
  });
});
