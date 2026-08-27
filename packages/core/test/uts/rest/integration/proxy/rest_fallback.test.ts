/**
 * UTS Proxy Integration: REST Fallback Tests
 *
 * Spec points: RSC15l, RSC15l2, RSC15l4
 * Source: specification/uts/rest/integration/proxy/rest_fallback.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  uniqueChannelName,
} from '../../integration/sandbox';
import { createProxySession, waitForProxy, ProxySession } from '../../../../uts/realtime/integration/helpers/proxy';

describe('uts/rest/integration/proxy/rest_fallback', function () {
  this.timeout(120000);

  let session: ProxySession | null = null;

  before(async function () {
    await waitForProxy();
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  afterEach(async function () {
    if (session) {
      await session.close();
      session = null;
    }
  });

  /**
   * RSC15l2 — Request timeout triggers fallback via proxy
   *
   * The proxy delays the first /time request beyond httpRequestTimeout.
   * The SDK should time out and retry on a fallback host (also routed
   * through the proxy, where the rule has expired after times:1).
   */
  // UTS: rest/proxy/RSC15l2/timeout-triggers-fallback-0
  it('RSC15l2 - request timeout triggers fallback', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', pathContains: '/time' },
          action: {
            type: 'http_delay',
            delayMs: 20000,
          },
          times: 1,
          comment: 'RSC15l2: Delay first /time request beyond httpRequestTimeout',
        },
      ],
    });

    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        const innerRest = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
        innerRest.auth.requestToken().then(
          (token: any) => cb(null, token),
          (err: any) => cb(err, null),
        );
      },
      endpoint: 'localhost',
      fallbackHosts: ['localhost'],
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      httpRequestTimeout: 3000,
    } as any);

    const result = await restClient.time();

    expect(result).to.be.a('number');
    expect(result).to.be.greaterThan(0);

    // Proxy log should show at least two /time requests (initial + fallback retry)
    const log = await session.getLog();
    const timeRequests = log.filter((e) => e.type === 'http_request' && e.path && e.path.includes('/time'));
    expect(timeRequests.length).to.be.at.least(2);
  });

  /**
   * RSC15l4 — CloudFront Server header triggers fallback via proxy
   *
   * The proxy returns a 403 with Server: CloudFront on the first /time
   * request. The SDK should treat this as a retryable server error and
   * retry on a fallback host.
   */
  // UTS: rest/proxy/RSC15l4/cloudfront-header-fallback-0
  it('RSC15l4 - CloudFront Server header triggers fallback', async function () {
    // DEVIATION: see deviations.md — ably-js does not inspect the Server response header
    if (!process.env.RUN_DEVIATIONS) this.skip();
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', pathContains: '/time' },
          action: {
            type: 'http_respond',
            status: 403,
            body: { error: { message: 'Forbidden', code: 40300, statusCode: 403 } },
            headers: { Server: 'CloudFront' },
          },
          times: 1,
          comment: 'RSC15l4: CloudFront 403 on first /time request',
        },
      ],
    });

    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        const innerRest = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
        innerRest.auth.requestToken().then(
          (token: any) => cb(null, token),
          (err: any) => cb(err, null),
        );
      },
      endpoint: 'localhost',
      fallbackHosts: ['localhost'],
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
    } as any);

    const result = await restClient.time();

    expect(result).to.be.a('number');
    expect(result).to.be.greaterThan(0);

    // Proxy log should show at least two /time requests (initial + fallback retry)
    const log = await session.getLog();
    const timeRequests = log.filter((e) => e.type === 'http_request' && e.path && e.path.includes('/time'));
    expect(timeRequests.length).to.be.at.least(2);

    // First response was the injected 403 with CloudFront header
    const httpResponses = log.filter((e) => e.type === 'http_response');
    expect(httpResponses[0].status).to.equal(403);
  });

  /**
   * Unreachable endpoint surfaces error correctly
   *
   * A Rest client pointed at a port with nothing listening should fail
   * with a usable error object (not an unhandled crash).
   */
  // UTS: rest/proxy/RSC15l/unreachable-endpoint-error-0
  it('Unreachable endpoint surfaces error correctly', async function () {
    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        const innerRest = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
        innerRest.auth.requestToken().then(
          (token: any) => cb(null, token),
          (err: any) => cb(err, null),
        );
      },
      endpoint: 'localhost',
      port: 19999,
      tls: false,
      useBinaryProtocol: false,
    } as any);

    let error: any;
    try {
      await restClient.time();
      expect.fail('Expected time() to throw');
    } catch (err: any) {
      error = err;
    }

    // The error should have a statusCode or code property — i.e. it's a usable error, not an unhandled crash
    expect(error).to.exist;
    expect(error.statusCode || error.code).to.exist;
  });

  /**
   * Connection drop mid-response retried on fallback
   *
   * The proxy drops the first /time request (http_drop). The SDK should
   * retry on a fallback host and succeed.
   */
  // UTS: rest/proxy/RSC15l/connection-drop-fallback-1
  it('Connection drop mid-response retried on fallback', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', pathContains: '/time' },
          action: {
            type: 'http_drop',
          },
          times: 1,
          comment: 'Drop first /time request to trigger fallback retry',
        },
      ],
    });

    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        const innerRest = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
        innerRest.auth.requestToken().then(
          (token: any) => cb(null, token),
          (err: any) => cb(err, null),
        );
      },
      endpoint: 'localhost',
      fallbackHosts: ['localhost'],
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
    } as any);

    const result = await restClient.time();

    expect(result).to.be.a('number');
    expect(result).to.be.greaterThan(0);

    // Proxy log should show at least two /time requests (initial drop + fallback retry)
    const log = await session.getLog();
    const timeRequests = log.filter((e) => e.type === 'http_request' && e.path && e.path.includes('/time'));
    expect(timeRequests.length).to.be.at.least(2);
  });

  /**
   * HTTP 503 with JSON error body — error parsed correctly
   *
   * The proxy returns a 503 with a structured Ably error body on the first
   * /time request. With no fallbackHosts, the SDK should surface the error
   * with code, statusCode, and message parsed from the body.
   */
  // UTS: rest/proxy/RSC15l/http-5xx-json-error-parsed-0
  it('HTTP 503 with JSON error body - error parsed correctly', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', pathContains: '/time' },
          action: {
            type: 'http_respond',
            status: 503,
            body: { error: { code: 50300, statusCode: 503, message: 'Service temporarily unavailable' } },
          },
          times: 1,
          comment: 'Return 503 with Ably error body on first /time request',
        },
      ],
    });

    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        const innerRest = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
        innerRest.auth.requestToken().then(
          (token: any) => cb(null, token),
          (err: any) => cb(err, null),
        );
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
    } as any);

    let error: any;
    try {
      await restClient.time();
      expect.fail('Expected time() to throw');
    } catch (err: any) {
      error = err;
    }

    expect(error.code).to.equal(50300);
    expect(error.statusCode).to.equal(503);
    expect(error.message).to.include('Service temporarily unavailable');
  });

  /**
   * HTTP 503 without error field in body — error synthesized from status
   *
   * The proxy returns a 503 with an empty body (no `error` field). The SDK
   * should still produce a usable error with the correct statusCode.
   */
  // UTS: rest/proxy/RSC15l/http-5xx-no-json-synthesized-1
  it('HTTP 503 without error field in body - error synthesized from status', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', pathContains: '/time' },
          action: {
            type: 'http_respond',
            status: 503,
            body: {},
          },
          times: 1,
          comment: 'Return 503 with empty body on first /time request',
        },
      ],
    });

    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        const innerRest = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
        innerRest.auth.requestToken().then(
          (token: any) => cb(null, token),
          (err: any) => cb(err, null),
        );
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
    } as any);

    let error: any;
    try {
      await restClient.time();
      expect.fail('Expected time() to throw');
    } catch (err: any) {
      error = err;
    }

    expect(error).to.exist;
    expect(error.statusCode).to.equal(503);
  });

  /**
   * HTTP 403 with error body — not retried, error parsed
   *
   * The proxy returns a 403 with an Ably error body. Even with fallbackHosts
   * configured, 403 is not a fallback-eligible status, so the SDK should NOT
   * retry and should surface the error directly.
   */
  // UTS: rest/proxy/RSC15l/http-4xx-not-retried-0
  it('HTTP 403 with error body - not retried, error parsed', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', pathContains: '/time' },
          action: {
            type: 'http_respond',
            status: 403,
            body: { error: { code: 40300, statusCode: 403, message: 'Forbidden' } },
          },
          times: 1,
          comment: 'Return 403 with Ably error body on first /time request',
        },
      ],
    });

    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        const innerRest = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
        innerRest.auth.requestToken().then(
          (token: any) => cb(null, token),
          (err: any) => cb(err, null),
        );
      },
      endpoint: 'localhost',
      fallbackHosts: ['localhost'],
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
    } as any);

    let error: any;
    try {
      await restClient.time();
      expect.fail('Expected time() to throw');
    } catch (err: any) {
      error = err;
    }

    expect(error.code).to.equal(40300);
    expect(error.statusCode).to.equal(403);

    // Proxy log should show exactly 1 /time request — 403 is not fallback-eligible, no retry
    const log = await session.getLog();
    const timeRequests = log.filter((e) => e.type === 'http_request' && e.path && e.path.includes('/time'));
    expect(timeRequests.length).to.equal(1);
  });

  /**
   * RSL1k4 — Idempotent publish retry deduplication
   *
   * Requires proxy support for response modification (forwarding the request
   * to the server, then replacing the response sent back to the client).
   * The current proxy only supports http_respond which intercepts BEFORE
   * forwarding to the server, so the first publish would never reach the
   * server and we cannot test deduplication.
   */
  // UTS: rest/proxy/RSL1k4/idempotent-retry-dedup-0
  it.skip('RSL1k4 - Idempotent publish retry deduplication', async function () {
    // Requires proxy support for response modification (forwarding to server
    // then replacing the response). Current proxy only supports http_respond
    // which intercepts before forwarding, so the publish never reaches the
    // server and retry deduplication cannot be tested end-to-end.

    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', method: 'POST', pathContains: '/channels/' },
          action: {
            type: 'http_respond',
            status: 503,
            body: { error: { code: 50300, statusCode: 503, message: 'Service temporarily unavailable' } },
          },
          times: 1,
          comment: 'RSL1k4: Return 503 on first publish to trigger retry',
        },
      ],
    });

    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        const innerRest = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
        innerRest.auth.requestToken().then(
          (token: any) => cb(null, token),
          (err: any) => cb(err, null),
        );
      },
      endpoint: 'localhost',
      fallbackHosts: ['localhost'],
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      idempotentRestPublishing: true,
    } as any);

    const channelName = uniqueChannelName('test-RSL1k4-idempotent');
    const channel = restClient.channels.get(channelName);

    // Publish — first attempt gets 503, SDK retries on fallback and succeeds
    await channel.publish('test-msg', 'hello');

    // History should contain exactly one copy of the message (deduplication)
    const history = await channel.history();
    const matches = history.items.filter((m: any) => m.name === 'test-msg');
    expect(matches.length).to.equal(1);
  });
});
