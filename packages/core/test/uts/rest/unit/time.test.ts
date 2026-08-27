/**
 * UTS: REST Time API Tests
 *
 * Spec points: RSC16
 * Source: specification/uts/rest/unit/time.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';

describe('uts/rest/unit/time', function () {
  let mock;

  afterEach(function () {
    restoreAll();
  });

  /**
   * RSC16 - time() returns server time
   *
   * The time() method retrieves the server time from the /time endpoint
   * and returns it as a timestamp.
   */
  // UTS: rest/unit/RSC16/returns-server-time-0
  it('RSC16 - time() returns server time', async function () {
    const captured: any[] = [];
    const serverTimeMs = 1704067200000; // 2024-01-01 00:00:00 UTC

    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [serverTimeMs]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret' });
    const result = await client.time();

    // Result should match the server timestamp
    expect(result).to.be.a('number');
    expect(result).to.equal(serverTimeMs);

    // Verify correct endpoint was called
    expect(captured).to.have.length(1);
    expect(captured[0].method.toUpperCase()).to.equal('GET');
    expect(captured[0].path).to.equal('/time');
  });

  /**
   * RSC16 - time() request format
   *
   * The time request must be a GET request to /time with standard Ably headers.
   */
  // UTS: rest/unit/RSC16/request-format-get-time-1
  it('RSC16 - time() request format', async function () {
    const captured: any[] = [];

    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1704067200000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret' });
    await client.time();

    expect(captured).to.have.length(1);
    const request = captured[0];

    // Should be GET request to /time
    expect(request.method.toUpperCase()).to.equal('GET');
    expect(request.path).to.equal('/time');

    // Should have standard Ably headers
    expect(request.headers).to.have.property('X-Ably-Version');
    expect(request.headers).to.have.property('Ably-Agent');

    // Version header should be a version string
    expect(request.headers['X-Ably-Version']).to.match(/[0-9.]+/);

    // Agent header should include library name/version
    expect(request.headers['Ably-Agent']).to.match(/ably-js\/[0-9]+\.[0-9]+\.[0-9]+/);
  });

  /**
   * RSC16 - time() does not require authentication
   *
   * The /time endpoint does not require authentication and should not send
   * an Authorization header, even when credentials are available.
   */
  // UTS: rest/unit/RSC16/no-auth-required-2
  it('RSC16 - time() does not require authentication', async function () {
    const captured: any[] = [];

    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1704067200000]);
      },
    });
    installMockHttp(mock);

    // Client has credentials, but time() should not use them
    const client = new Ably.Rest({ key: 'app.key:secret' });
    const result = await client.time();

    // Should succeed
    expect(result).to.be.a('number');

    // Request should not have Authorization header
    expect(captured).to.have.length(1);
    expect(captured[0].headers).to.not.have.property('Authorization');
    expect(captured[0].headers).to.not.have.property('authorization');
  });

  /**
   * RSC16 - time() works without TLS
   *
   * The /time endpoint does not require authentication, so it should be
   * callable over HTTP (non-TLS). The RSC18 restriction (no basic auth
   * over non-TLS) does not apply because time() doesn't send authentication.
   */
  // UTS: rest/unit/RSC16/works-without-tls-3
  it('RSC16 - time() works without TLS', async function () {
    const captured: any[] = [];

    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1704067200000]);
      },
    });
    installMockHttp(mock);

    // Client with API key but using token auth to avoid RSC18 restriction
    const client = new Ably.Rest({
      key: 'app.key:secret',
      tls: false,
      useTokenAuth: true,
    });
    const result = await client.time();

    // Should succeed
    expect(result).to.be.a('number');

    // Request should use HTTP (not HTTPS)
    expect(captured).to.have.length(1);
    expect(captured[0].url.protocol).to.equal('http:');

    // Request should not have Authorization header
    expect(captured[0].headers).to.not.have.property('Authorization');
    expect(captured[0].headers).to.not.have.property('authorization');
  });

  /**
   * RSC16 - time() error handling
   *
   * Errors from the /time endpoint should be properly propagated to the caller.
   */
  // UTS: rest/unit/RSC16/error-propagated-4
  it('RSC16 - time() error handling', async function () {
    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(500, {
          error: {
            message: 'Internal server error',
            code: 50000,
            statusCode: 500,
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'app.key:secret' });

    try {
      await client.time();
      expect.fail('Expected time() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(500);
      expect(error.code).to.equal(50000);
    }
  });
});
