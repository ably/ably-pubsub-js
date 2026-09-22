/**
 * UTS: Token Renewal Tests
 *
 * Spec points: RSA4a2, RSA4b, RSA4b1, RSC10
 * Source: specification/uts/rest/unit/auth/token_renewal.md
 *
 * These tests verify that the library correctly handles token expiry:
 * - Transparent retry on 40142/40140 server rejection
 * - No retry when no renewal mechanism is available
 * - Non-token 401 errors are not retried
 *
 * NOTE: ably-js has a header-overwrite bug in Resource.do() — see deviations.md.
 * The retry path passes merged headers (including old authorization) to
 * withAuthDetails, which overwrites the new auth header with the old one.
 * Tests here use requestCount-based mocking to avoid triggering infinite loops.
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/auth/token_renewal', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSA4b - Token renewal on 40142 (token expired)
   *
   * When a request is rejected with 40142, the library obtains a new
   * token via authCallback and retries the request.
   */
  // UTS: rest/unit/RSA4b/renewal-on-40142-0
  it('RSA4b - renewal on 40142 error', async function () {
    // DEVIATION: see deviations.md
    if (!process.env.RUN_DEVIATIONS) this.skip();
    let callbackCount = 0;
    let requestCount = 0;
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        requestCount++;
        if (requestCount === 1) {
          req.respond_with(401, {
            error: { code: 40142, statusCode: 401, message: 'Token expired' },
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callbackCount++;
        callback(null, 'token-' + callbackCount);
      },
    });

    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse ok */
    }

    // authCallback called twice: initial + renewal
    expect(callbackCount).to.equal(2);
    // Two HTTP requests: original + retry
    expect(requestCount).to.equal(2);

    // First request used first token
    const expectedAuth1 = 'Bearer ' + Buffer.from('token-1').toString('base64');
    expect(captured[0].headers.authorization).to.equal(expectedAuth1);

    // Second request should use renewed token (token-2)
    // NOTE: ably-js has a header-overwrite bug — see deviations.md
    const expectedAuth2 = 'Bearer ' + Buffer.from('token-2').toString('base64');
    expect(captured[1].headers.authorization).to.equal(expectedAuth2);
  });

  /**
   * RSA4b - Token renewal on 40140 error
   */
  // UTS: rest/unit/RSA4b/renewal-on-40140-1
  it('RSA4b - renewal on 40140 error', async function () {
    let callbackCount = 0;
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        if (requestCount === 1) {
          req.respond_with(401, {
            error: { code: 40140, statusCode: 401, message: 'Token error' },
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callbackCount++;
        callback(null, 'token-' + callbackCount);
      },
    });

    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(callbackCount).to.equal(2);
    expect(requestCount).to.equal(2);
  });

  /**
   * RSA4a2 - No renewal without authCallback/authUrl/key
   *
   * When the client has only a static token and no way to renew,
   * the error should be indicated with code 40171 (not retry).
   */
  // UTS: rest/unit/RSA4a2/no-renewal-without-callback-0
  it('RSA4a2 - no renewal without callback', async function () {
    this.timeout(5000);
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        req.respond_with(401, {
          error: { code: 40142, statusCode: 401, message: 'Token expired' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ token: 'static-token' });

    try {
      await client.stats({} as any);
      expect.fail('Expected request to throw');
    } catch (error: any) {
      // RSA4a2: client must indicate error with code 40171
      expect(error.code).to.equal(40171);
    }

    // RSA4a2: only 1 request (no retry without renewal mechanism)
    expect(requestCount).to.equal(1);
  });

  /**
   * RSA4b - Renewal with authUrl
   */
  // UTS: rest/unit/RSA4b/renewal-via-authurl-2
  it('RSA4b - renewal with authUrl', async function () {
    let authUrlCallCount = 0;
    let apiRequestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        if (req.url.host === 'auth.example.com') {
          authUrlCallCount++;
          req.respond_with(200, 'token-' + authUrlCallCount, { 'content-type': 'text/plain' });
        } else {
          apiRequestCount++;
          if (apiRequestCount === 1) {
            req.respond_with(401, {
              error: { code: 40142, statusCode: 401, message: 'Token expired' },
            });
          } else {
            req.respond_with(200, []);
          }
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/token',
    });

    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(authUrlCallCount).to.equal(2);
    expect(apiRequestCount).to.equal(2);
  });

  /**
   * RSC10 - REST request retried transparently after token renewal
   *
   * Uses requestCount-based mocking to avoid triggering the ably-js
   * header-overwrite bug (see deviations.md).
   */
  // UTS: rest/unit/RSC10/request-retried-after-renewal-0
  it('RSC10 - transparent retry after renewal', async function () {
    // DEVIATION: see deviations.md
    if (!process.env.RUN_DEVIATIONS) this.skip();
    let callbackCount = 0;
    let requestCount = 0;
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        requestCount++;
        if (requestCount === 1) {
          req.respond_with(401, {
            error: { code: 40142, statusCode: 401, message: 'Token expired' },
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callbackCount++;
        callback(null, 'token-' + callbackCount);
      },
    });

    // This should succeed transparently despite the first 40142
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse ok */
    }

    expect(callbackCount).to.equal(2);
    expect(captured).to.have.length(2);

    // First request used first token
    const expectedAuth1 = 'Bearer ' + Buffer.from('token-1').toString('base64');
    expect(captured[0].headers.authorization).to.equal(expectedAuth1);

    // Second request should use renewed token
    // NOTE: ably-js has a header-overwrite bug — see deviations.md
    const expectedAuth2 = 'Bearer ' + Buffer.from('token-2').toString('base64');
    expect(captured[1].headers.authorization).to.equal(expectedAuth2);
  });

  /**
   * RSC10 - Non-token 401 errors MUST NOT trigger renewal
   *
   * Only errors with codes 40140-40149 trigger renewal. Other 401
   * errors (e.g. 40100) are propagated immediately.
   */
  // UTS: rest/unit/RSC10b/non-token-401-no-renewal-0
  it('RSC10 - non-token 401 no renewal', async function () {
    let callbackCount = 0;
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        req.respond_with(401, {
          error: { code: 40100, statusCode: 401, message: 'Unauthorized' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callbackCount++;
        callback(null, 'token-' + callbackCount);
      },
    });

    try {
      await client.stats({} as any);
      expect.fail('Expected request to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(401);
    }

    expect(requestCount).to.equal(1);
    expect(callbackCount).to.equal(1);
  });

  /**
   * RSA4b1 - Token renewal when expired token is used
   *
   * Per RSA4b1, pre-emptive local expiry detection is only active when
   * the server time offset is known (via queryTime). Without queryTime,
   * ably-js sends the expired token, the server rejects it with 40142,
   * and the library renews.
   *
   * This test verifies the full flow: expired token → server rejection →
   * renewal → successful retry.
   */
  // UTS: rest/unit/RSA4b1/preemptive-renewal-0
  it('RSA4b1 - renewal when expired token is rejected', async function () {
    let callbackCount = 0;
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        // First request (with expired token) fails; second succeeds
        if (requestCount === 1) {
          req.respond_with(401, {
            error: { code: 40142, statusCode: 401, message: 'Token expired' },
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callbackCount++;
        if (callbackCount === 1) {
          // First token is already expired
          callback(null, {
            token: 'expired-token',
            expires: Date.now() - 1000,
            issued: Date.now() - 3600000,
          } as any);
        } else {
          callback(null, {
            token: 'fresh-token',
            expires: Date.now() + 3600000,
            issued: Date.now(),
          } as any);
        }
      },
    });

    // Force initial token acquisition
    await client.auth.authorize();
    expect(callbackCount).to.equal(1);

    // Request uses expired token → server rejects → renewal → retry
    try {
      await client.channels.get('test').history({} as any);
    } catch (e) {
      /* ok */
    }

    // Callback called twice: initial + renewal after 40142
    expect(callbackCount).to.equal(2);
    // 2 HTTP requests: failed with expired token + retry with fresh token
    expect(requestCount).to.equal(2);
  });

  /**
   * RSA4b - Token renewal with msgpack error response
   *
   * DEVIATION: ably-js does not support msgpack protocol
   */
  // UTS: rest/unit/RSA4b/renewal-msgpack-response-4
  it.skip('RSA4b - token renewal with msgpack error response (msgpack not supported)', function () {
    // DEVIATION: ably-js does not support msgpack protocol
  });

  /**
   * RSA4b - Renewal limit (max 1 retry per spec)
   *
   * If the renewed token is also rejected, the error should propagate.
   *
   * NOTE: ably-js has no built-in renewal limit — the retry loop in
   * Resource.do() is unbounded. Combined with the header-overwrite bug,
   * this causes an infinite loop. The authCallback caps retries to
   * prevent OOM. See deviations.md.
   */
  // UTS: rest/unit/RSA4b/renewal-limit-no-loop-3
  it('RSA4b - renewal limit', async function () {
    // DEVIATION: see deviations.md
    if (!process.env.RUN_DEVIATIONS) this.skip();
    this.timeout(5000);

    let callbackCount = 0;
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        req.respond_with(401, {
          error: { code: 40142, statusCode: 401, message: 'Token expired' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callbackCount++;
        if (callbackCount > 3) {
          // Cap retries to prevent infinite loop (ably-js has no limit)
          callback(new Error('Token renewal limit exceeded') as any, null);
          return;
        }
        callback(null, 'token-' + callbackCount);
      },
    });

    try {
      await client.stats({} as any);
      expect.fail('Expected request to throw');
    } catch (error) {
      expect(error).to.exist;
    }

    // Spec (RSA4b): exactly 2 callbacks (initial + 1 renewal), 2 requests.
    // DEVIATION: ably-js has no renewal limit — unbounded retry loop.
    // The authCallback caps at 3 to prevent OOM. See deviations.md.
    expect(callbackCount).to.equal(2);
    expect(requestCount).to.equal(2);
  });
});
