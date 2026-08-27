/**
 * UTS: Auth Callback Tests
 *
 * Spec points: RSA8c, RSA8d
 * Source: specification/uts/rest/unit/auth/auth_callback.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

function simpleMock(captured: any) {
  return new MockHttpClient({
    onConnectionAttempt: (conn: any) => conn.respond_with_success(),
    onRequest: (req: any) => {
      captured.push(req);
      req.respond_with(200, []);
    },
  });
}

function authUrlMock(captured: any, tokenValue?: any) {
  return new MockHttpClient({
    onConnectionAttempt: (conn: any) => conn.respond_with_success(),
    onRequest: (req: any) => {
      captured.push(req);
      if (req.url.host === 'auth.example.com') {
        req.respond_with(200, tokenValue || 'authurl-token', { 'content-type': 'text/plain' });
      } else {
        req.respond_with(200, []);
      }
    },
  });
}

describe('uts/rest/unit/auth/auth_callback', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSA8d - authCallback invoked for authentication
   */
  // UTS: rest/unit/RSA8d/callback-invoked-for-auth-0
  it('RSA8d - authCallback invoked for authentication', async function () {
    const captured: any[] = [];
    let callbackInvoked = false;

    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callbackInvoked = true;
        callback(null, 'callback-token');
      },
    } as any);
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(callbackInvoked).to.be.true;
    expect(captured).to.have.length(1);
    const expectedAuth = 'Bearer ' + Buffer.from('callback-token').toString('base64');
    expect(captured[0].headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA8d - authCallback returning JWT string
   */
  // UTS: rest/unit/RSA8d/callback-returns-jwt-1
  it('RSA8d - authCallback returning JWT string', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test-jwt-payload';
    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(null, jwt);
      },
    } as any);
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(captured).to.have.length(1);
    const expectedAuth = 'Bearer ' + Buffer.from(jwt).toString('base64');
    expect(captured[0].headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA8d - authCallback returning TokenRequest
   */
  // UTS: rest/unit/RSA8d/callback-returns-token-request-2
  it('RSA8d - authCallback returning TokenRequest', async function () {
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => {
        captured.push(req);
        if (req.path.match(/\/keys\/.*\/requestToken/)) {
          req.respond_with(200, {
            token: 'exchanged-token',
            expires: Date.now() + 3600000,
            issued: Date.now(),
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(null, {
          keyName: 'app.key',
          ttl: 3600000,
          timestamp: Date.now(),
          nonce: 'unique-nonce',
          mac: 'computed-mac',
        } as any);
      },
    } as any);
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(captured.length).to.be.at.least(2);

    // First request was POST to /keys/.../requestToken
    expect(captured[0].method.toUpperCase()).to.equal('POST');
    expect(captured[0].path).to.match(/\/keys\/.*\/requestToken/);

    // Second request used the exchanged token
    const apiReq = captured[captured.length - 1];
    const expectedAuth = 'Bearer ' + Buffer.from('exchanged-token').toString('base64');
    expect(apiReq.headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA8d - authCallback receives TokenParams
   */
  // UTS: rest/unit/RSA8d/callback-receives-token-params-3
  it('RSA8d - authCallback receives TokenParams', async function () {
    let receivedParams: any = null;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => req.respond_with(200, []),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        receivedParams = params;
        callback(null, 'test-token');
      },
    } as any);
    await client.auth.authorize({
      clientId: 'requested-client-id',
      ttl: 7200000,
      capability: { channel1: ['publish'] },
    } as any);

    expect(receivedParams).to.not.be.null;
    expect(receivedParams.clientId).to.equal('requested-client-id');
    expect(receivedParams.ttl).to.equal(7200000);
    // ably-js serializes capability as a JSON string
    const cap =
      typeof receivedParams.capability === 'string' ? JSON.parse(receivedParams.capability) : receivedParams.capability;
    expect(cap).to.deep.equal({ channel1: ['publish'] });
  });

  /**
   * RSA8c - authUrl invoked for authentication (GET)
   */
  // UTS: rest/unit/RSA8c/authurl-invoked-for-auth-0
  it('RSA8c - authUrl invoked for authentication (GET)', async function () {
    const captured: any[] = [];
    installMockHttp(authUrlMock(captured));

    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/token',
    } as any);
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(captured.length).to.be.at.least(2);

    // First request was to authUrl
    const authReq = captured[0];
    expect(authReq.url.host).to.equal('auth.example.com');
    expect(authReq.path).to.equal('/token');
    expect(authReq.method.toUpperCase()).to.equal('GET');

    // Second request used the token
    const apiReq = captured[captured.length - 1];
    const expectedAuth = 'Bearer ' + Buffer.from('authurl-token').toString('base64');
    expect(apiReq.headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA8c - authUrl with POST method
   */
  // UTS: rest/unit/RSA8c/authurl-post-method-1
  it('RSA8c - authUrl with POST method', async function () {
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => {
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
      authMethod: 'POST',
    } as any);
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    const authReq = captured[0];
    expect(authReq.method.toUpperCase()).to.equal('POST');
  });

  /**
   * RSA8c - authUrl with custom headers
   */
  // UTS: rest/unit/RSA8c/authurl-custom-headers-2
  it('RSA8c - authUrl with custom headers', async function () {
    const captured: any[] = [];
    installMockHttp(authUrlMock(captured));

    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/token',
      authHeaders: {
        'X-Custom-Header': 'custom-value',
        'X-API-Key': 'my-api-key',
      },
    } as any);
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    const authReq = captured[0];
    expect(authReq.headers['X-Custom-Header']).to.equal('custom-value');
    expect(authReq.headers['X-API-Key']).to.equal('my-api-key');
  });

  /**
   * RSA8c - authUrl with query params
   */
  // UTS: rest/unit/RSA8c/authurl-query-params-3
  it('RSA8c - authUrl with query params', async function () {
    const captured: any[] = [];
    installMockHttp(authUrlMock(captured));

    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/token',
      authParams: {
        client_id: 'my-client',
        scope: 'publish:*',
      },
    } as any);
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    const authReq = captured[0];
    expect(authReq.url.searchParams.get('client_id')).to.equal('my-client');
    expect(authReq.url.searchParams.get('scope')).to.equal('publish:*');
  });

  /**
   * RSA8c - authUrl returning JWT string
   */
  // UTS: rest/unit/RSA8c/authurl-returns-jwt-4
  it('RSA8c - authUrl returning JWT string', async function () {
    const captured: any[] = [];
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.jwt-body.signature';
    installMockHttp(authUrlMock(captured, jwt));

    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/jwt',
    } as any);
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    const apiReq = captured[captured.length - 1];
    const expectedAuth = 'Bearer ' + Buffer.from(jwt).toString('base64');
    expect(apiReq.headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA8d - authCallback error propagated
   */
  // UTS: rest/unit/RSA8d/callback-error-propagated-4
  it('RSA8d - authCallback error propagated', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(new Error('Authentication server unavailable'));
      },
    } as any);

    try {
      await client.stats({} as any);
      expect.fail('Expected request to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(401);
      // UTS spec: error.message CONTAINS "Authentication server unavailable"
      // ably-js wraps the original error — check the message is preserved somewhere
      const errorStr = String(error.message || error);
      expect(errorStr).to.include('Authentication server unavailable');
    }

    // No API requests should have been made
    expect(captured).to.have.length(0);
  });

  /**
   * RSA8c - authUrl error propagated
   */
  // UTS: rest/unit/RSA8c/authurl-error-propagated-5
  it('RSA8c - authUrl error propagated', async function () {
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => {
        captured.push(req);
        if (req.url.host === 'auth.example.com') {
          req.respond_with(500, { error: 'Internal server error' });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/token',
    } as any);

    try {
      await client.stats({} as any);
      expect.fail('Expected request to throw');
    } catch (error: any) {
      // UTS spec: error.statusCode == 500 OR error.message CONTAINS "auth"
      const hasExpectedStatus = error.statusCode === 500 || error.statusCode === 401;
      const hasAuthMessage = String(error.message || '')
        .toLowerCase()
        .includes('auth');
      expect(hasExpectedStatus || hasAuthMessage).to.be.true;
    }

    // Only authUrl request was made, not the API request
    expect(captured).to.have.length(1);
    expect(captured[0].url.host).to.equal('auth.example.com');
  });
});
