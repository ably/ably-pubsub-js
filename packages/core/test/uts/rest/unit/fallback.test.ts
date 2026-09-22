/**
 * UTS: REST Fallback and Endpoint Configuration Tests
 *
 * Spec points: RSC15, RSC15a, RSC15f, RSC15l, RSC15l4, RSC15m,
 *   REC1a, REC1b1, REC1b2, REC1b3, REC1b4, REC1c1, REC1c2, REC1d, REC1d1,
 *   REC2a1, REC2a2, REC2b, REC2c1, REC2c2, REC2c3, REC2c4, REC2c5, REC2c6,
 *   REC3, REC3a, REC3b
 * Source: specification/uts/rest/unit/fallback.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, installMockHttp, enableFakeTimers, restoreAll } from '../../helpers';

describe('uts/rest/unit/fallback', function () {
  afterEach(function () {
    restoreAll();
  });

  // ── Fallback behavior (RSC15) ──────────────────────────────────────

  /**
   * RSC15l - 500 triggers fallback
   *
   * When the primary host returns a 500 error, the client should retry
   * the request on a fallback host.
   */
  // UTS: rest/unit/RSC15l/http-5xx-triggers-fallback-4
  it('RSC15l - 500 triggers fallback', async function () {
    let requestCount = 0;
    const hosts: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(requestCount).to.equal(2);
    expect(hosts[0]).to.equal('main.realtime.ably.net');
    expect(hosts[1]).to.not.equal('main.realtime.ably.net');
    expect(hosts[1]).to.match(/^main\.[a-e]\.fallback\.ably-realtime\.com$/);
  });

  /**
   * RSC15l - connection refused triggers fallback
   *
   * When the primary host refuses the connection, the client should
   * retry on a fallback host.
   */
  // UTS: rest/unit/RSC15l/connection-refused-fallback-0
  it('RSC15l - connection refused triggers fallback', async function () {
    let connCount = 0;
    const connHosts: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => {
        connCount++;
        connHosts.push(conn.host);
        if (connCount === 1) {
          conn.respond_with_refused();
        } else {
          conn.respond_with_success();
        }
      },
      onRequest: (req) => {
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(connCount).to.equal(2);
    expect(connHosts[0]).to.equal('main.realtime.ably.net');
    expect(connHosts[1]).to.not.equal('main.realtime.ably.net');
    expect(connHosts[1]).to.match(/^main\.[a-e]\.fallback\.ably-realtime\.com$/);
  });

  /**
   * RSC15l - 4xx does NOT trigger fallback
   *
   * Client errors (4xx) are not retryable. The client should not attempt
   * a fallback host and should propagate the error immediately.
   */
  // UTS: rest/unit/RSC15l/qualifying-errors-trigger-fallback-0
  it('RSC15l - 4xx does NOT trigger fallback', async function () {
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        req.respond_with(400, { error: { message: 'Bad request', code: 40000, statusCode: 400 } });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });

    try {
      await client.time();
      expect.fail('Expected time() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(400);
    }

    expect(requestCount).to.equal(1);
  });

  /**
   * RSC15m - no fallback when fallbackHosts is empty
   *
   * When fallbackHosts is explicitly set to an empty array, the client
   * should not attempt any fallback and should fail after the primary host.
   */
  // UTS: rest/unit/RSC15m/no-fallback-empty-hosts-0
  it('RSC15m - no fallback when fallbackHosts is empty', async function () {
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false, fallbackHosts: [] });

    try {
      await client.time();
      expect.fail('Expected time() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(500);
    }

    expect(requestCount).to.equal(1);
  });

  // ── Endpoint configuration (REC) ──────────────────────────────────

  /**
   * REC1a - default primary domain
   *
   * Without any endpoint configuration, the default primary host should
   * be main.realtime.ably.net.
   */
  // UTS: rest/unit/REC1a/default-primary-domain-0
  it('REC1a - default primary domain', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('main.realtime.ably.net');
  });

  /**
   * REC1b4 - endpoint as routing policy
   *
   * When endpoint is a simple name (no dots), it is treated as a routing
   * policy and the host becomes {endpoint}.realtime.ably.net.
   */
  // UTS: rest/unit/REC1b4/production-routing-policy-0
  it('REC1b4 - endpoint as routing policy', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false, endpoint: 'test' });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('test.realtime.ably.net');
  });

  /**
   * REC1b2 - endpoint as explicit hostname
   *
   * When endpoint contains dots, it is treated as an explicit hostname.
   */
  // UTS: rest/unit/REC1b2/explicit-hostname-with-period-0
  it('REC1b2 - endpoint as explicit hostname', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      endpoint: 'custom.ably.example.com',
    });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('custom.ably.example.com');
  });

  /**
   * REC1d1 - restHost option
   *
   * The deprecated restHost option sets the REST host directly.
   */
  // UTS: rest/unit/REC1d1/resthost-sets-primary-domain-0
  it('REC1d1 - restHost option', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      restHost: 'custom.rest.example.com',
    });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('custom.rest.example.com');
  });

  /**
   * REC1c2 - environment option
   *
   * The deprecated environment option maps to {environment}.realtime.ably.net.
   */
  // UTS: rest/unit/REC1c2/environment-sets-primary-domain-0
  it('REC1c2 - environment option', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      environment: 'sandbox',
    });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('sandbox.realtime.ably.net');
  });

  /**
   * REC2a2 - custom fallbackHosts
   *
   * When fallbackHosts is set to a custom list, the client should use
   * those hosts for fallback instead of the defaults.
   */
  // UTS: rest/unit/REC2a2/custom-fallback-hosts-0
  it('REC2a2 - custom fallbackHosts', async function () {
    let requestCount = 0;
    const hosts: any[] = [];
    const customFallbacks = ['fb1.example.com', 'fb2.example.com'];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      fallbackHosts: customFallbacks,
    });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(requestCount).to.equal(2);
    expect(hosts[0]).to.equal('main.realtime.ably.net');
    expect(customFallbacks).to.include(hosts[1]);
  });

  /**
   * REC2c6 - custom restHost has no fallbacks
   *
   * When restHost is set to a custom domain, fallback hosts are not
   * available (unless explicitly provided). A 500 should not trigger retry.
   */
  // UTS: rest/unit/REC2c6/custom-resthost-no-fallbacks-0
  it('REC2c6 - custom restHost has no fallbacks', async function () {
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      restHost: 'custom.example.com',
    });

    try {
      await client.time();
      expect.fail('Expected time() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(500);
    }

    expect(requestCount).to.equal(1);
  });

  // ── Additional fallback tests ─────────────────────────────────────

  /**
   * RSC15a - fallback hosts are randomized
   *
   * When the primary host fails and the client falls back, the fallback
   * hosts should be selected in a randomized order. Over multiple attempts,
   * we expect to see more than one distinct fallback host used.
   */
  // UTS: rest/unit/RSC15a/fallback-random-order-0
  it('RSC15a - fallback hosts are randomized', async function () {
    const fallbackHostsUsed: string[] = [];

    for (let i = 0; i < 10; i++) {
      let requestCount = 0;
      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          requestCount++;
          if (req.url.hostname === 'main.realtime.ably.net') {
            req.respond_with(500, { error: { message: 'fail', code: 50000, statusCode: 500 } });
          } else {
            fallbackHostsUsed.push(req.url.hostname);
            req.respond_with(200, [1234567890000]);
          }
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
      await client.time();

      restoreAll();
    }

    const uniqueHosts = new Set(fallbackHostsUsed);
    expect(uniqueHosts.size).to.be.at.least(2);
  });

  /**
   * RSC15l - DNS error triggers fallback
   *
   * When the primary host fails DNS resolution, the client should
   * retry on a fallback host.
   */
  // UTS: rest/unit/RSC15l/dns-error-fallback-1
  it('RSC15l - DNS error triggers fallback', async function () {
    const connHosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => {
        connHosts.push(conn.host);
        if (conn.host === 'main.realtime.ably.net') {
          conn.respond_with_dns_error();
        } else {
          conn.respond_with_success();
        }
      },
      onRequest: (req) => {
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(connHosts).to.have.length(2);
    expect(connHosts[0]).to.equal('main.realtime.ably.net');
    expect(connHosts[1]).to.not.equal('main.realtime.ably.net');
  });

  /**
   * RSC15l - timeout triggers fallback
   *
   * When the primary host connection times out, the client should
   * retry on a fallback host.
   */
  // UTS: rest/unit/RSC15l/connection-timeout-fallback-2
  it('RSC15l - timeout triggers fallback', async function () {
    const connHosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => {
        connHosts.push(conn.host);
        if (conn.host === 'main.realtime.ably.net') {
          conn.respond_with_timeout();
        } else {
          conn.respond_with_success();
        }
      },
      onRequest: (req) => {
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(connHosts).to.have.length(2);
    expect(connHosts[0]).to.equal('main.realtime.ably.net');
    expect(connHosts[1]).to.not.equal('main.realtime.ably.net');
  });

  /**
   * RSC15l - 503 triggers fallback
   *
   * When the primary host returns a 503 Service Unavailable, the client
   * should retry on a fallback host.
   */
  // UTS: rest/unit/RSC15l/http-4xx-no-fallback-5
  it('RSC15l - 503 triggers fallback', async function () {
    let requestCount = 0;
    const hosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (req.url.hostname === 'main.realtime.ably.net') {
          req.respond_with(503, { error: { message: 'Service unavailable', code: 50300, statusCode: 503 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(requestCount).to.equal(2);
    expect(hosts[0]).to.equal('main.realtime.ably.net');
    expect(hosts[1]).to.not.equal('main.realtime.ably.net');
  });

  /**
   * RSC15f - successful fallback host cached
   *
   * After a successful fallback, subsequent requests should go to the
   * cached fallback host instead of the primary host.
   */
  // UTS: rest/unit/RSC15f/successful-fallback-cached-0
  it('RSC15f - successful fallback host cached', async function () {
    const captured: any[] = [];
    let requestCount = 0;
    let fallbackHost: string | null = null;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        captured.push(req);
        if (req.url.hostname === 'main.realtime.ably.net') {
          req.respond_with(500, { error: { message: 'fail', code: 50000, statusCode: 500 } });
        } else {
          if (!fallbackHost) fallbackHost = req.url.hostname;
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });

    // First request: primary fails, fallback succeeds
    await client.time();
    expect(fallbackHost).to.not.be.null;

    // Second request: should go to cached fallback host, not primary
    const countBefore = requestCount;
    await client.time();

    // The second request should use the cached fallback host
    const secondRequestHost = captured[captured.length - 1].url.hostname;
    expect(secondRequestHost).to.equal(fallbackHost);
  });

  // ── Category A: Additional status code variants ───────────────────

  [501, 502, 504].forEach((statusCode) => {
    it(`RSC15l - ${statusCode} triggers fallback`, async function () {
      let requestCount = 0;
      const hosts: string[] = [];

      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          requestCount++;
          hosts.push(req.url.hostname);
          if (requestCount === 1) {
            req.respond_with(statusCode, { error: { message: 'Server error', code: statusCode * 100, statusCode } });
          } else {
            req.respond_with(200, [1234567890000]);
          }
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
      const result = await client.time();

      expect(result).to.equal(1234567890000);
      expect(requestCount).to.equal(2);
      expect(hosts[0]).to.equal('main.realtime.ably.net');
      expect(hosts[1]).to.not.equal('main.realtime.ably.net');
    });
  });

  [401, 404].forEach((statusCode) => {
    it(`RSC15l - ${statusCode} does NOT trigger fallback`, async function () {
      let requestCount = 0;

      const mock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => {
          requestCount++;
          req.respond_with(statusCode, { error: { message: 'Client error', code: statusCode * 100, statusCode } });
        },
      });
      installMockHttp(mock);

      const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });

      try {
        await client.time();
        expect.fail('Expected time() to throw');
      } catch (error: any) {
        expect(error.statusCode).to.equal(statusCode);
      }

      expect(requestCount).to.equal(1);
    });
  });

  // ── Category B: Request timeout and CloudFront ────────────────────

  // UTS: rest/unit/RSC15l/request-timeout-fallback-3
  it('RSC15l - request timeout triggers fallback', async function () {
    let connCount = 0;
    const connHosts: string[] = [];
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => {
        connCount++;
        connHosts.push(conn.host);
        conn.respond_with_success();
      },
      onRequest: (req) => {
        requestCount++;
        if (requestCount === 1) {
          req.respond_with_timeout();
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    const result = await client.time();
    expect(result).to.equal(1234567890000);
    expect(connCount).to.be.at.least(2);
    expect(connHosts[0]).to.equal('main.realtime.ably.net');
    expect(connHosts[1]).to.not.equal('main.realtime.ably.net');
  });

  // UTS: rest/unit/RSC15l4/cloudfront-error-triggers-fallback-0
  it('RSC15l4 - CloudFront Server header triggers fallback', async function () {
    // DEVIATION: see deviations.md
    if (!process.env.RUN_DEVIATIONS) this.skip();
    let requestCount = 0;
    const hosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          // Spec: CloudFront Server header with status >= 400 should trigger fallback
          // DEVIATION: ably-js does not inspect the Server header. See deviations.md.
          req.respond_with(
            403,
            { error: { message: 'Forbidden', code: 40300, statusCode: 403 } },
            { Server: 'CloudFront' },
          );
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    try {
      const result = await client.time();
      expect(result).to.equal(1234567890000);
      expect(requestCount).to.equal(2);
      expect(hosts[0]).to.equal('main.realtime.ably.net');
      expect(hosts[1]).to.not.equal('main.realtime.ably.net');
    } catch (e) {
      expect.fail(
        'CloudFront 403 with Server header should trigger fallback, but ably-js threw: ' + (e as Error).message,
      );
    }
  });

  // ── Category C: Cached fallback expiry ────────────────────────────

  // UTS: rest/unit/RSC15f/cached-fallback-expires-1
  it('RSC15f - cached fallback expires after fallbackRetryTimeout', async function () {
    const clock = enableFakeTimers();
    const hosts: string[] = [];
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (req.url.hostname === 'main.realtime.ably.net' && requestCount <= 1) {
          req.respond_with(500, { error: { message: 'fail', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      fallbackRetryTimeout: 100,
    } as any);

    // First request: primary fails → cached fallback used
    await client.time();
    expect(hosts.length).to.be.at.least(2);
    const fallbackHost = hosts[hosts.length - 1];
    expect(fallbackHost).to.not.equal('main.realtime.ably.net');

    // Second request within cache window: should go to cached fallback
    hosts.length = 0;
    requestCount = 0;
    await client.time();
    expect(hosts[0]).to.equal(fallbackHost);

    // Advance time past fallbackRetryTimeout
    clock.tick(150);

    // Third request after cache expiry: should try primary again
    hosts.length = 0;
    requestCount = 0;
    await client.time();
    expect(hosts[0]).to.equal('main.realtime.ably.net');
  });

  // UTS: rest/unit/RSC15f/expired-not-resurrected-2
  it('RSC15f - expired fallback not resurrected by late in-flight success', async function () {
    const clock = enableFakeTimers();
    const hosts: string[] = [];
    let requestCount = 0;
    let heldRequest: any = null;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          // Primary fails → triggers fallback
          req.respond_with(500, { error: { message: 'fail', code: 50000, statusCode: 500 } });
        } else if (requestCount === 2) {
          // First fallback succeeds → caches this host
          req.respond_with(200, [1234567890000]);
        } else if (requestCount === 3) {
          // Second request to cached fallback — hold it, don't respond yet
          heldRequest = req;
        } else {
          // All subsequent requests succeed
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      fallbackRetryTimeout: 100,
    } as any);

    // Requests 1+2: primary fails → fallback succeeds → fallback cached
    await client.time();
    const fallbackHost = hosts[1];
    expect(fallbackHost).to.not.equal('main.realtime.ably.net');

    // Request 3: goes to cached fallback, but we hold the response
    const requestFuture = client.time();

    // Advance time past fallbackRetryTimeout
    clock.tick(150);

    // Request 4: cache expired → should try primary
    await client.time();
    expect(hosts[3]).to.equal('main.realtime.ably.net');

    // Now let the held request complete successfully
    expect(heldRequest).to.not.be.null;
    heldRequest.respond_with(200, [1234567890000]);
    await requestFuture;

    // Request 5: late success must NOT have re-pinned the fallback
    await client.time();

    expect(hosts).to.have.length(5);
    expect(hosts[0]).to.equal('main.realtime.ably.net'); // primary fail
    expect(hosts[1]).to.equal(fallbackHost); // fallback success (cached)
    expect(hosts[2]).to.equal(fallbackHost); // cached fallback (held)
    expect(hosts[3]).to.equal('main.realtime.ably.net'); // after expiry → primary
    expect(hosts[4]).to.equal('main.realtime.ably.net'); // still primary, not re-pinned
  });

  // ── Category D: Endpoint edge cases ───────────────────────────────

  // UTS: rest/unit/REC1b2/endpoint-localhost-1
  it('REC1b2 - endpoint as localhost', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false, endpoint: 'localhost' });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('localhost');
  });

  // UTS: rest/unit/REC1b2/endpoint-ipv6-address-2
  it('REC1b2 - endpoint as IPv6 address', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false, endpoint: '::1' });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.satisfy((h: string) => h === '::1' || h === '[::1]');
    expect(captured[0].url.href).to.include('[::1]');
  });

  // UTS: rest/unit/REC1b3/nonprod-routing-policy-0
  it('REC1b3 - endpoint as nonprod routing policy', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false, endpoint: 'nonprod:staging' });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('staging.realtime.ably-nonprod.net');
  });

  // UTS: rest/unit/REC1d2/realtimehost-sets-primary-domain-0
  it('REC1d - realtimeHost sets primary domain when restHost not set', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      realtimeHost: 'custom.realtime.example.com',
    } as any);
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('custom.realtime.example.com');
  });

  // ── Category E: Option conflict detection ─────────────────────────

  // UTS: rest/unit/REC1b1/endpoint-conflicts-environment-0
  it('REC1b1 - endpoint conflicts with environment', function () {
    try {
      new Ably.Rest({ key: 'app.key:secret', endpoint: 'test', environment: 'production' } as any);
      expect.fail('Expected constructor to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40106);
    }
  });

  // UTS: rest/unit/REC1b1/endpoint-conflicts-resthost-1
  it('REC1b1 - endpoint conflicts with restHost', function () {
    try {
      new Ably.Rest({ key: 'app.key:secret', endpoint: 'test', restHost: 'custom.host.com' } as any);
      expect.fail('Expected constructor to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40106);
    }
  });

  // UTS: rest/unit/REC1b1/endpoint-conflicts-realtimehost-2
  it('REC1b1 - endpoint conflicts with realtimeHost', function () {
    try {
      new Ably.Rest({
        key: 'app.key:secret',
        endpoint: 'custom.example.com',
        realtimeHost: 'rt.example.com',
      } as any);
      expect.fail('Expected constructor to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40106);
    }
  });

  // UTS: rest/unit/REC1b1/endpoint-conflicts-fallback-default-3
  it.skip('REC1b1 - endpoint conflicts with fallbackHostsUseDefault', function () {
    // SKIP: ably-js does not implement the fallbackHostsUseDefault option.
    // The option is not recognized, so no conflict validation occurs.
    try {
      new Ably.Rest({
        key: 'app.key:secret',
        endpoint: 'custom.example.com',
        fallbackHostsUseDefault: true,
      } as any);
      expect.fail('Expected constructor to throw');
    } catch (error: any) {
      expect(error.code).to.satisfy((c: number) => c === 40000 || c === 40106);
    }
  });

  // UTS: rest/unit/REC2a1/fallback-hosts-conflicts-use-default-0
  it.skip('REC2a1 - fallbackHosts conflicts with fallbackHostsUseDefault', function () {
    // SKIP: ably-js does not implement the fallbackHostsUseDefault option.
    // The option is not recognized, so no conflict validation occurs.
    try {
      new Ably.Rest({
        key: 'app.key:secret',
        fallbackHosts: ['a.example.com'],
        fallbackHostsUseDefault: true,
      } as any);
      expect.fail('Expected constructor to throw');
    } catch (error: any) {
      expect(error.code).to.satisfy((c: number) => c === 40000 || c === 40106);
    }
  });

  // UTS: rest/unit/REC1c1/environment-conflicts-resthost-0
  it('REC1c1 - environment conflicts with restHost', function () {
    try {
      new Ably.Rest({ key: 'app.key:secret', environment: 'sandbox', restHost: 'custom.host.com' } as any);
      expect.fail('Expected constructor to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40106);
    }
  });

  // UTS: rest/unit/REC1c1/environment-conflicts-realtimehost-1
  it('REC1c1 - environment conflicts with realtimeHost', function () {
    try {
      new Ably.Rest({ key: 'app.key:secret', environment: 'sandbox', realtimeHost: 'custom.rt.com' } as any);
      expect.fail('Expected constructor to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40106);
    }
  });

  // UTS: rest/unit/REC1d/resthost-precedence-over-realtimehost-0
  it('REC1d - restHost takes precedence over realtimeHost', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1234567890000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      restHost: 'rest.example.com',
      realtimeHost: 'realtime.example.com',
    } as any);
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('rest.example.com');
  });

  // ── Category F: Fallback domain configuration ─────────────────────

  // UTS: rest/unit/REC2c2/explicit-hostname-no-fallbacks-0
  it('REC2c2 - explicit hostname endpoint has no fallbacks', async function () {
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      endpoint: 'custom.ably.example.com',
    });

    try {
      await client.time();
      expect.fail('Expected time() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(500);
    }

    expect(requestCount).to.equal(1);
  });

  // UTS: rest/unit/REC2c3/nonprod-fallback-domains-0
  it('REC2c3 - nonprod endpoint gets nonprod fallback domains', async function () {
    let requestCount = 0;
    const hosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false, endpoint: 'nonprod:staging' });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(requestCount).to.equal(2);
    expect(hosts[0]).to.equal('staging.realtime.ably-nonprod.net');
    expect(hosts[1]).to.match(/^staging\.[a-e]\.fallback\.ably-realtime-nonprod\.com$/);
  });

  // UTS: rest/unit/REC2b/fallback-hosts-use-default-0
  it.skip('REC2b - fallbackHostsUseDefault uses default fallback domains', async function () {
    // SKIP: ably-js does not implement the fallbackHostsUseDefault option.
    // The option is ignored, so setting restHost disables fallbacks as normal.
    let requestCount = 0;
    const hosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      restHost: 'custom.host.com',
      fallbackHostsUseDefault: true,
    } as any);
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(requestCount).to.equal(2);
    expect(hosts[0]).to.equal('custom.host.com');
    expect(hosts[1]).to.match(/^main\.[a-e]\.fallback\.ably-realtime\.com$/);
  });

  // UTS: rest/unit/REC2c1/default-fallback-domains-0
  it('REC2c1 - default fallback domains', async function () {
    let requestCount = 0;
    const hosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(requestCount).to.equal(2);
    expect(hosts[0]).to.equal('main.realtime.ably.net');
    expect(hosts[1]).to.match(/^main\.[a-e]\.fallback\.ably-realtime\.com$/);
  });

  // UTS: rest/unit/REC2c5/production-environment-fallback-domains-0
  it('REC2c5 - environment fallback domains', async function () {
    let requestCount = 0;
    const hosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      environment: 'sandbox',
    });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(requestCount).to.equal(2);
    expect(hosts[0]).to.equal('sandbox.realtime.ably.net');
    expect(hosts[1]).to.match(/^sandbox\.[a-e]\.fallback\.ably-realtime\.com$/);
  });

  // UTS: rest/unit/REC2c6/custom-realtimehost-no-fallbacks-1
  it('REC2c6 - custom realtimeHost has no fallback domains', async function () {
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'app.key:secret',
      useBinaryProtocol: false,
      realtimeHost: 'custom.realtime.example.com',
    } as any);

    try {
      await client.time();
      expect.fail('Expected time() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(500);
    }

    expect(requestCount).to.equal(1);
  });

  // UTS: rest/unit/REC2c4/production-endpoint-fallback-domains-0
  it('REC2c4 - production routing via endpoint gets production fallback domains', async function () {
    let requestCount = 0;
    const hosts: string[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        hosts.push(req.url.hostname);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false, endpoint: 'test' });
    const result = await client.time();

    expect(result).to.equal(1234567890000);
    expect(requestCount).to.equal(2);
    expect(hosts[0]).to.equal('test.realtime.ably.net');
    expect(hosts[1]).to.match(/^test\.[a-e]\.fallback\.ably-realtime\.com$/);
  });

  // ── Connectivity check tests (REC3) ──────────────────────────────

  // UTS: rest/unit/REC3/connectivity-check-validation-0
  it.skip('REC3 - connectivity check response validation', function () {
    // SKIP: The connectivity check (checkConnectivity) is an internal method
    // on the Http class, used by the Realtime ConnectionManager. It is not
    // exposed on the public Rest or Realtime client API. Testing it requires
    // either Realtime connection state machine integration or direct access
    // to the Http instance internals. Additionally, the mock's
    // checkConnectivity method is hardcoded and does not go through the
    // standard doUri path with client options.
  });

  // UTS: rest/unit/REC3a/default-connectivity-check-url-0
  it.skip('REC3a - default connectivity check URL', function () {
    // SKIP: The connectivity check URL is used internally by the Realtime
    // ConnectionManager's checkConnectivity method. It is not accessible
    // from the Rest client. The mock HTTP checkConnectivity is hardcoded
    // to use the default URL and does not capture request details in a way
    // that allows URL verification. Testing requires Realtime client
    // integration with mock WebSocket + mock HTTP, which is beyond the
    // scope of this REST unit test file.
  });

  // UTS: rest/unit/REC3b/custom-connectivity-check-url-0
  it.skip('REC3b - custom connectivity check URL', function () {
    // SKIP: Same as REC3a — the connectivityCheckUrl option affects the
    // internal Http.checkConnectivity method used by Realtime's
    // ConnectionManager. The mock HTTP checkConnectivity method does not
    // read client options and always uses the hardcoded default URL.
    // Testing requires either modifying the mock infrastructure to pass
    // client options through to checkConnectivity, or using a Realtime
    // client with mock WebSocket integration.
  });

  // UTS: rest/unit/RSC15j/host-header-matches-request-0
  it('RSC15j - Host header matches request host', async function () {
    let reqCount = 0;
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        reqCount++;
        if (reqCount === 1) {
          req.respond_with(500, { error: { code: 50000, message: 'Internal error' } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    await client.time();

    expect(captured).to.have.length(2);
    const host1 = captured[0].url.hostname;
    const host2 = captured[1].url.hostname;
    expect(host1).to.not.equal(host2);

    if (captured[0].headers['host']) {
      expect(captured[0].headers['host']).to.include(host1);
    }
    if (captured[1].headers['host']) {
      expect(captured[1].headers['host']).to.include(host2);
    }
  });
});
