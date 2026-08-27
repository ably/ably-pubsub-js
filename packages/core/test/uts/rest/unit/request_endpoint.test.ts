/**
 * UTS: Request Endpoint Configuration Tests
 *
 * Spec points: RSC25
 * Source: specification/uts/rest/unit/request_endpoint.md
 *
 * Tests that REST requests are sent to the correct host based on
 * endpoint configuration, and that fallback behavior works correctly.
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';

describe('uts/rest/unit/request_endpoint', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSC25 - Default primary domain used for requests
   *
   * When no endpoint configuration is provided, REST requests must be
   * sent to the default primary domain (main.realtime.ably.net).
   */
  // UTS: rest/unit/RSC25/default-primary-domain-0
  it('RSC25 - default primary domain', async function () {
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
   * RSC25 - Custom endpoint used for requests
   *
   * When a custom endpoint (e.g. 'test') is configured, REST requests
   * must be sent to the corresponding domain.
   */
  // UTS: rest/unit/RSC25/custom-endpoint-domain-1
  it('RSC25 - custom endpoint', async function () {
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
      endpoint: 'test',
    });
    await client.time();

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('test.realtime.ably.net');
  });

  /**
   * RSC25 - Multiple requests all go to primary domain
   *
   * Successive requests should continue using the primary domain
   * without host switching (absent any fallback triggering errors).
   */
  // UTS: rest/unit/RSC25/multiple-requests-primary-domain-2
  it('RSC25 - multiple requests use primary domain', async function () {
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
    await client.time();
    await client.time();

    expect(captured).to.have.length(3);
    expect(captured[0].url.hostname).to.equal('main.realtime.ably.net');
    expect(captured[1].url.hostname).to.equal('main.realtime.ably.net');
    expect(captured[2].url.hostname).to.equal('main.realtime.ably.net');
  });

  /**
   * RSC25 - Primary domain tried first before fallback
   *
   * When the primary host fails with a 500 error, the client should
   * try the primary first, then fall back to a different host.
   */
  // UTS: rest/unit/RSC25/primary-tried-before-fallback-3
  it('RSC25 - primary tried before fallback', async function () {
    let requestCount = 0;
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        captured.push(req);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Server error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(200, [1234567890000]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    await client.time();

    expect(captured).to.have.length(2);
    // First request goes to primary
    expect(captured[0].url.hostname).to.equal('main.realtime.ably.net');
    // Second request goes to a fallback (not primary)
    expect(captured[1].url.hostname).to.not.equal('main.realtime.ably.net');
  });

  /**
   * RSC25 - Request path preserved
   *
   * The request path and method must be correctly constructed
   * regardless of endpoint configuration.
   */
  // UTS: rest/unit/RSC25/request-path-preserved-4
  it('RSC25 - request path preserved', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret', useBinaryProtocol: false });
    await client.channels.get('test-channel').history(null);

    expect(captured).to.have.length(1);
    expect(captured[0].url.hostname).to.equal('main.realtime.ably.net');
    expect(captured[0].path).to.equal('/channels/test-channel/messages');
    expect(captured[0].method).to.equal('get');
  });
});
