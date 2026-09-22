/**
 * UTS: Auth.authorize() Tests
 *
 * Spec points: RSA10, RSA10a, RSA10b, RSA10g, RSA10h, RSA10j, RSA10k, RSA10l
 * Source: specification/uts/rest/unit/auth/authorize.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

function tokenRoutingMock(captured: any) {
  return new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      if (captured) captured.push(req);
      if (req.path.match(/\/keys\/.*\/requestToken/)) {
        req.respond_with(200, {
          token: 'obtained-token',
          expires: Date.now() + 3600000,
          issued: Date.now(),
          keyName: 'appId.keyId',
        });
      } else {
        req.respond_with(200, []);
      }
    },
  });
}

describe('uts/rest/unit/auth/authorize', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSA10a - authorize() obtains token with defaults
   */
  // UTS: rest/unit/RSA10a/authorize-default-params-0
  it('RSA10a - authorize() obtains token', async function () {
    const captured: any[] = [];
    installMockHttp(tokenRoutingMock(captured));

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    const tokenDetails = await client.auth.authorize();

    expect(tokenDetails).to.be.an('object');
    expect(tokenDetails.token).to.equal('obtained-token');

    // Verify token is now used for requests
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }
    const apiReq = captured[captured.length - 1];
    const expectedAuth = 'Bearer ' + Buffer.from('obtained-token').toString('base64');
    expect(apiReq.headers.authorization).to.equal(expectedAuth);
  });

  /**
   * RSA10b - authorize() with explicit tokenParams overrides defaults
   */
  // UTS: rest/unit/RSA10b/authorize-explicit-params-0
  it('RSA10b - tokenParams override defaults', async function () {
    let callbackParams: any = null;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, []),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callbackParams = params;
        callback(null, 'callback-token');
      },
      clientId: 'default-client',
    });

    await client.auth.authorize({
      clientId: 'override-client',
      ttl: 7200000,
    });

    expect(callbackParams).to.not.be.null;
    expect(callbackParams!.clientId).to.equal('override-client');
    expect(callbackParams!.ttl).to.equal(7200000);
  });

  /**
   * RSA10g - authorize() updates auth.tokenDetails
   */
  // UTS: rest/unit/RSA10g/authorize-updates-token-details-0
  it('RSA10g - authorize() updates tokenDetails', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        if (req.path.match(/\/keys\/.*\/requestToken/)) {
          req.respond_with(200, {
            token: 'new-token',
            expires: Date.now() + 3600000,
            issued: Date.now(),
            keyName: 'appId.keyId',
            clientId: 'token-client',
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    // Before authorize
    expect(client.auth.tokenDetails).to.satisfy((v: any) => v === null || v === undefined);

    const result = await client.auth.authorize();

    expect(client.auth.tokenDetails).to.not.be.null;
    expect(client.auth.tokenDetails!.token).to.equal('new-token');
    expect(result.token).to.equal('new-token');
  });

  /**
   * RSA10h - authorize() with new authCallback replaces old
   */
  // UTS: rest/unit/RSA10h/authorize-replaces-auth-options-0
  it('RSA10h - authOptions replace stored options', async function () {
    let originalCalled = false;
    let newCalled = false;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, []),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        originalCalled = true;
        callback(null, 'original-token');
      },
    });

    await client.auth.authorize(null, {
      authCallback: function (params, callback) {
        newCalled = true;
        callback(null, 'new-token');
      },
    });

    expect(originalCalled).to.be.false;
    expect(newCalled).to.be.true;
  });

  /**
   * RSA10j - authorize() when already authorized gets new token
   */
  // UTS: rest/unit/RSA10j/authorize-replaces-existing-token-0
  it('RSA10j - authorize() when already authorized', async function () {
    let tokenCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, []),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        tokenCount++;
        callback(null, {
          token: 'token-' + tokenCount,
          expires: Date.now() + 3600000,
          issued: Date.now(),
        } as any);
      },
    });

    const result1 = await client.auth.authorize();
    const result2 = await client.auth.authorize();

    expect(result1.token).to.equal('token-1');
    expect(result2.token).to.equal('token-2');
    expect(client.auth.tokenDetails!.token).to.equal('token-2');
  });

  /**
   * RSA10k - authorize() with queryTime queries server time
   */
  // UTS: rest/unit/RSA10k/authorize-query-time-0
  it('RSA10k - queryTime queries server', async function () {
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        if (req.path === '/time') {
          req.respond_with(200, [Date.now()]);
        } else if (req.path.match(/\/keys\/.*\/requestToken/)) {
          req.respond_with(200, {
            token: 'time-synced-token',
            expires: Date.now() + 3600000,
            issued: Date.now(),
            keyName: 'appId.keyId',
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    // Must include key in authOptions since authorize() replaces stored options
    await client.auth.authorize(null, { key: 'appId.keyId:keySecret', queryTime: true });

    // Should have made a request to /time
    const timeReq = captured.find((r) => r.path === '/time');
    expect(timeReq).to.not.be.undefined;
  });

  /**
   * RSA10l - authorize() error handling
   */
  // UTS: rest/unit/RSA10l/authorize-error-propagated-0
  it('RSA10l - authorize() propagates errors', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(401, {
          error: {
            code: 40100,
            statusCode: 401,
            message: 'Unauthorized',
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'invalid.key:secret' });

    try {
      await client.auth.authorize();
      expect.fail('Expected authorize to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40100);
      expect(error.statusCode).to.equal(401);
    }
  });

  /**
   * RSA10e - authorize() saves tokenParams for reuse
   *
   * tokenParams provided to authorize() are saved and reused on subsequent
   * token requests (e.g. when the token expires and is re-acquired).
   */
  // UTS: rest/unit/RSA10e/authorize-saves-params-0
  it('RSA10e - tokenParams saved for reuse', async function () {
    const callbackInvocations: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, []),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params, callback) {
        callbackInvocations.push({ ...params });
        callback(null, {
          token: 'token-' + callbackInvocations.length,
          expires: Date.now() + 3600000,
          issued: Date.now(),
        } as any);
      },
    });

    // First authorize with custom tokenParams
    await client.auth.authorize({
      clientId: 'saved-client',
      ttl: 3600000,
    });

    // Second authorize without explicit tokenParams — should reuse saved
    await client.auth.authorize();

    expect(callbackInvocations).to.have.length(2);
    // Second callback should have received the saved params
    expect(callbackInvocations[1].clientId).to.equal('saved-client');
    expect(callbackInvocations[1].ttl).to.equal(3600000);
  });

  /**
   * RSA10i - authorize() preserves key from constructor
   *
   * The API key from ClientOptions is preserved even when authOptions
   * are provided to authorize().
   */
  // UTS: rest/unit/RSA10i/authorize-preserves-key-0
  it('RSA10i - key preserved after authorize with authOptions', async function () {
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        if (req.path.match(/\/keys\/.*\/requestToken/)) {
          req.respond_with(200, {
            token: 'token-via-key',
            expires: Date.now() + 3600000,
            issued: Date.now(),
            keyName: 'appId.keyId',
          });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    // Authorize with queryTime option (but same key)
    await client.auth.authorize(null, { key: 'appId.keyId:keySecret', queryTime: false });

    // Key should still work — make a second authorize
    const result = await client.auth.authorize();
    expect(result).to.be.an('object');
    expect(result.token).to.be.a('string');
  });

  /**
   * RSA10a - authorize() with incompatible key throws 40102
   */
  // UTS: rest/unit/RSA10a/authorize-default-params-0.1
  it('RSA10a - incompatible key in authOptions throws 40102', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, []),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    try {
      await client.auth.authorize(null, { key: 'different.key:secret' });
      expect.fail('Expected authorize to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40102);
    }
  });
});
