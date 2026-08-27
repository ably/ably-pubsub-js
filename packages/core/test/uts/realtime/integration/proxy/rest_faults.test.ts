/**
 * UTS Proxy Integration: REST Fault Tests
 *
 * Spec points: RSC10, RSC15m, REC2c2, RTL6
 * Source: specification/uts/realtime/integration/proxy/rest_faults.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  getKeyParts,
  trackClient,
  closeAndWait,
  connectAndWait,
  generateJWT,
  uniqueChannelName,
  pollUntil,
} from '../sandbox';
import { createProxySession, waitForProxy, ProxySession } from '../helpers/proxy';

describe('uts/realtime/integration/proxy/rest_faults', function () {
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
   * RSC10 — Token renewal on HTTP 401 (40142)
   *
   * Proxy returns 401 with error code 40142 on the first HTTP request matching
   * /channels/ (times: 1). The SDK should transparently renew the token via
   * authCallback and retry the request.
   */
  // UTS: realtime/proxy/RSC10/token-renewal-on-401-0
  it('RSC10 - token renewal on HTTP 401 (40142)', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', pathContains: '/channels/' },
          action: {
            type: 'http_respond',
            status: 401,
            body: { error: { code: 40142, statusCode: 401, message: 'Token expired' } },
          },
          times: 1,
          comment: 'RSC10: Return 401 on first channel request, then passthrough',
        },
      ],
    });

    let authCallbackCount = 0;

    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        authCallbackCount++;
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

    const channelName = uniqueChannelName('test-RSC10-token-renewal');
    const channel = restClient.channels.get(channelName);

    // Publish a message — first request gets 401, SDK renews token, retries
    await channel.publish('test-event', 'hello');

    // authCallback was called at least twice (initial token + renewal after 401)
    expect(authCallbackCount).to.be.at.least(2);

    // Proxy event log shows at least two HTTP requests to the channel endpoint
    const log = await session.getLog();
    const httpRequests = log.filter((e) => e.type === 'http_request' && e.path && e.path.includes('/channels/'));
    expect(httpRequests.length).to.be.at.least(2);

    // First response was the injected 401, second response was a success
    const httpResponses = log.filter((e) => e.type === 'http_response');
    expect(httpResponses[0].status).to.equal(401);
    expect(httpResponses[1].status).to.be.oneOf([200, 201]);
  });

  /**
   * RSC15m / REC2c2 — HTTP 503 with fallback hosts disabled
   *
   * Proxy returns 503 with error code 50300 on the first HTTP request matching
   * /channels/ (times: 1). Since endpoint='localhost' disables fallback hosts
   * (REC2c2), the SDK should return the error immediately without retrying.
   */
  // UTS: realtime/proxy/RSC15m/http-503-no-fallback-0
  it('RSC15m / REC2c2 - HTTP 503 error with fallback hosts disabled', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', pathContains: '/channels/' },
          action: {
            type: 'http_respond',
            status: 503,
            body: { error: { code: 50300, statusCode: 503, message: 'Service temporarily unavailable' } },
          },
          times: 1,
          comment: 'RSC15m: Return 503 on first channel request',
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

    const channelName = uniqueChannelName('test-RSC15m-503-error');
    const channel = restClient.channels.get(channelName);

    // Publish should fail with 503 error
    let error: any;
    try {
      await channel.publish('test-event', 'hello');
      expect.fail('Expected publish to throw');
    } catch (err: any) {
      error = err;
    }

    // The error propagates to the caller with the correct error code
    expect(error.code).to.equal(50300);
    expect(error.statusCode).to.equal(503);

    // Proxy event log shows only one HTTP request to the channel endpoint
    // (no fallback attempts since endpoint="localhost" disables fallback hosts)
    const log = await session.getLog();
    const httpRequests = log.filter((e) => e.type === 'http_request' && e.path && e.path.includes('/channels/'));
    expect(httpRequests.length).to.equal(1);
  });

  /**
   * RTL6 — End-to-end publish and history through proxy
   *
   * No fault rules (pure passthrough). A Realtime client publishes through
   * the proxy, then a REST client retrieves via history through the proxy.
   */
  // UTS: realtime/proxy/RTL6/publish-history-through-proxy-0
  it('RTL6 - end-to-end publish and history through proxy', async function () {
    session = await createProxySession({
      rules: [],
    });

    const { keyName, keySecret } = getKeyParts(getApiKey());

    // Create Realtime client through proxy for publishing
    const realtimeClient = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
    } as any);
    trackClient(realtimeClient);

    // Create REST client through proxy for history retrieval
    const restClient = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
    } as any);

    const channelName = uniqueChannelName('test-RTL6-publish-history');
    const realtimeChannel = realtimeClient.channels.get(channelName);
    const restChannel = restClient.channels.get(channelName);

    // Connect Realtime client through proxy
    await connectAndWait(realtimeClient, 15000);

    // Attach to the channel
    await realtimeChannel.attach();

    // Publish a message via Realtime
    await realtimeChannel.publish('test-msg', 'hello world');

    // Poll until the message appears in history (eventual consistency)
    await pollUntil(
      async () => {
        const history = await restChannel.history();
        return history.items.length > 0;
      },
      { interval: 500, timeout: 10000 },
    );

    // Retrieve channel history via REST
    const history = await restChannel.history();

    // History contains the published message
    expect(history.items.length).to.be.at.least(1);

    // Find the published message in history
    const publishedMsg = history.items.find((m: any) => m.name === 'test-msg');
    expect(publishedMsg).to.not.be.undefined;
    expect(publishedMsg!.data).to.equal('hello world');

    // Proxy event log shows both WebSocket and HTTP traffic
    const log = await session.getLog();

    // At least one WebSocket connection was made (Realtime client)
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(1);

    // At least one HTTP request was made (REST history call + token requests)
    const httpRequests = log.filter((e) => e.type === 'http_request');
    expect(httpRequests.length).to.be.at.least(1);

    // Clean up the Realtime client
    await closeAndWait(realtimeClient);
  });
});
