/**
 * UTS: Auth Scheme Selection Tests
 *
 * Spec points: RSA1, RSA2, RSA3, RSA4, RSA4a2, RSA11, RSC1b, RSC18
 * Source: specification/uts/rest/unit/auth/auth_scheme.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

/** Standard mock that auto-succeeds and returns 200 */
function simpleMock(captured: any) {
  return new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      captured.push(req);
      req.respond_with(200, []);
    },
  });
}

/** Mock that routes requestToken vs API requests */
function tokenRoutingMock(captured: any, tokenValue?: any) {
  return new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      captured.push(req);
      if (req.path.match(/\/keys\/.*\/requestToken/)) {
        req.respond_with(200, {
          token: tokenValue || 'obtained-token',
          expires: Date.now() + 3600000,
          issued: Date.now(),
          capability: JSON.stringify({ '*': ['*'] }),
        });
      } else {
        req.respond_with(200, []);
      }
    },
  });
}

describe('uts/rest/unit/auth/auth_scheme', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSA4 - Basic auth with API key only
   */
  // UTS: rest/unit/RSA4/basic-auth-key-only-0
  it('RSA4 - Basic auth with API key only', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    expect(captured).to.have.length(1);
    const expectedAuth = 'Basic ' + Buffer.from('appId.keyId:keySecret').toString('base64');
    expect(captured[0].headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA3 - Token auth with explicit token string
   */
  // UTS: rest/unit/RSA3/token-auth-explicit-token-0
  it('RSA3 - Token auth with explicit token string', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({ token: 'explicit-token-string' });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    expect(captured).to.have.length(1);
    const expectedAuth = 'Bearer ' + Buffer.from('explicit-token-string').toString('base64');
    expect(captured[0].headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA3 - Token auth with TokenDetails
   */
  // UTS: rest/unit/RSA3/token-auth-token-details-1
  it('RSA3 - Token auth with TokenDetails', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      tokenDetails: {
        token: 'token-from-details',
        expires: Date.now() + 3600000,
      } as any,
    });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    expect(captured).to.have.length(1);
    const expectedAuth = 'Bearer ' + Buffer.from('token-from-details').toString('base64');
    expect(captured[0].headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA4 - useTokenAuth forces token auth
   */
  // UTS: rest/unit/RSA4/use-token-auth-forced-1
  it('RSA4 - useTokenAuth forces token auth', async function () {
    const captured: any[] = [];
    installMockHttp(tokenRoutingMock(captured, 'obtained-token'));

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useTokenAuth: true,
    });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    // API request should use Bearer, not Basic
    const apiRequest = captured[captured.length - 1];
    const expectedAuth = 'Bearer ' + Buffer.from('obtained-token').toString('base64');
    expect(apiRequest.headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA4 - authCallback triggers token auth
   */
  // UTS: rest/unit/RSA4/auth-callback-triggers-token-2
  it('RSA4 - authCallback triggers token auth', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callback(null, 'callback-token');
      },
    });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    expect(captured).to.have.length(1);
    const expectedAuth = 'Bearer ' + Buffer.from('callback-token').toString('base64');
    expect(captured[0].headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA4 - authUrl triggers token auth
   */
  // UTS: rest/unit/RSA4/authurl-triggers-token-3
  it('RSA4 - authUrl triggers token auth', async function () {
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        if (req.url.host === 'auth.example.com') {
          req.respond_with(200, 'authurl-token', { 'content-type': 'text/plain' });
        } else {
          req.respond_with(200, []);
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
      /* response parse errors ok */
    }

    expect(captured.length).to.be.at.least(2);
    const apiRequest = captured[captured.length - 1];
    const expectedAuth = 'Bearer ' + Buffer.from('authurl-token').toString('base64');
    expect(apiRequest.headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSC1b - Error when no auth method available
   */
  // UTS: rest/unit/RSC1b/no-auth-method-error-0
  it('RSC1b - Error when no auth method available', function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    try {
      new Ably.Rest({});
      expect.fail('Should have thrown');
    } catch (error: any) {
      expect(error.code).to.equal(40106);
    }

    expect(captured).to.have.length(0);
  });

  /**
   * RSA4a2 - Error when token expired and no renewal method
   *
   * Per RSA4a2: if the server responds with a token error (40142) and
   * there's no way to renew, the library should error with 40171.
   * Note: RSA4b1 (local expiry detection) is optional.
   */
  // UTS: rest/unit/RSA4a2/expired-token-no-renewal-0
  it('RSA4a2 - Error when token expired and no renewal method', async function () {
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        // Server rejects expired token
        req.respond_with(401, {
          error: { message: 'Token expired', code: 40142, statusCode: 401 },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      tokenDetails: {
        token: 'expired-token',
        expires: Date.now() - 1000,
      } as any,
    });

    try {
      await client.stats({} as any);
      expect.fail('Expected request to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40171);
    }
  });

  /**
   * RSA1 - Auth method priority (authCallback over key)
   */
  // UTS: rest/unit/RSA1/token-auth-takes-precedence-0
  it('RSA1 - Auth method priority (authCallback over key)', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      authCallback: function (params, callback) {
        callback(null, 'callback-token');
      },
    });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    const request = captured[0];
    const expectedAuth = 'Bearer ' + Buffer.from('callback-token').toString('base64');
    expect(request.headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA2, RSA11 - Basic auth header format
   */
  // UTS: rest/unit/RSA2/basic-auth-header-format-0
  it('RSA2, RSA11 - Basic auth header format', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({ key: 'app123.key456:secretXYZ' });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    const request = captured[0];
    const expected = 'Basic ' + Buffer.from('app123.key456:secretXYZ').toString('base64');
    expect(request.headers.authorization).to.equal(expected);
  });

  /**
   * RSC18 - Token auth allowed over non-TLS
   */
  // UTS: rest/unit/RSC18/token-auth-over-non-tls-0
  it('RSC18 - Token auth allowed over non-TLS', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      token: 'explicit-token',
      tls: false,
    });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    const request = captured[0];
    const expectedAuth = 'Bearer ' + Buffer.from('explicit-token').toString('base64');
    expect(request.headers.authorization).to.equal(expectedAuth);
    expect(request.url.protocol).to.equal('http:');
  });
});
