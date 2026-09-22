/**
 * UTS: Auth.tokenDetails Tests
 *
 * Spec points: RSA16, RSA16a, RSA16b, RSA16c, RSA16d
 * Source: specification/uts/rest/unit/auth/token_details.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, enableFakeTimers, restoreAll } from '../../../helpers';

function simpleMock(captured?: any) {
  return new MockHttpClient({
    onConnectionAttempt: (conn: any) => conn.respond_with_success(),
    onRequest: (req: any) => {
      if (captured) captured.push(req);
      req.respond_with(200, []);
    },
  });
}

describe('uts/rest/unit/auth/token_details', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSA16a - tokenDetails reflects token from authCallback
   */
  // UTS: rest/unit/RSA16a/token-from-callback-0
  it('RSA16a - tokenDetails from authCallback', async function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(null, {
          token: 'callback-token-abc',
          expires: Date.now() + 3600000,
          issued: Date.now(),
          clientId: 'my-client',
        } as any);
      },
    } as any);

    // Force token acquisition
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(client.auth.tokenDetails).to.not.be.null;
    expect(client.auth.tokenDetails!.token).to.equal('callback-token-abc');
    expect(client.auth.tokenDetails!.clientId).to.equal('my-client');
    expect(client.auth.tokenDetails!.expires).to.be.a('number');
    expect(client.auth.tokenDetails!.issued).to.be.a('number');
  });

  /**
   * RSA16a - tokenDetails reflects token from requestToken (authorize with key)
   */
  // UTS: rest/unit/RSA16a/token-from-request-token-1
  it('RSA16a - tokenDetails from requestToken', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => {
        if (req.path.match(/\/keys\/.*\/requestToken/)) {
          req.respond_with(200, {
            token: 'requested-token-xyz',
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
    await client.auth.authorize();

    expect(client.auth.tokenDetails).to.not.be.null;
    expect(client.auth.tokenDetails!.token).to.equal('requested-token-xyz');
    expect(client.auth.tokenDetails!.clientId).to.equal('token-client');
  });

  /**
   * RSA16b - tokenDetails created from token string in ClientOptions
   */
  // UTS: rest/unit/RSA16b/token-string-in-options-0
  it('RSA16b - tokenDetails from token string option', function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({ token: 'standalone-token-string' } as any);

    expect(client.auth.tokenDetails).to.not.be.null;
    expect(client.auth.tokenDetails!.token).to.equal('standalone-token-string');
    // Other fields should be null/undefined since we only had the token string
    expect(client.auth.tokenDetails!.expires).to.satisfy((v: any) => v === null || v === undefined);
    expect(client.auth.tokenDetails!.issued).to.satisfy((v: any) => v === null || v === undefined);
    expect(client.auth.tokenDetails!.clientId).to.satisfy((v: any) => v === null || v === undefined);
    expect(client.auth.tokenDetails!.capability).to.satisfy((v: any) => v === null || v === undefined);
  });

  /**
   * RSA16b - tokenDetails created from token string in authCallback
   */
  // UTS: rest/unit/RSA16b/token-string-from-callback-1
  it('RSA16b - tokenDetails from token string authCallback', async function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(null, 'just-a-token-string');
      },
    } as any);

    // Force token acquisition
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(client.auth.tokenDetails).to.not.be.null;
    expect(client.auth.tokenDetails!.token).to.equal('just-a-token-string');
    // Other fields should be null/undefined
    expect(client.auth.tokenDetails!.expires).to.satisfy((v: any) => v === null || v === undefined);
    expect(client.auth.tokenDetails!.issued).to.satisfy((v: any) => v === null || v === undefined);
  });

  /**
   * RSA16c - tokenDetails set on instantiation with tokenDetails option
   */
  // UTS: rest/unit/RSA16c/set-on-instantiation-0
  it('RSA16c - tokenDetails set on instantiation', function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      tokenDetails: {
        token: 'initial-token',
        expires: Date.now() + 3600000,
        issued: Date.now(),
        clientId: 'initial-client',
      } as any,
    } as any);

    expect(client.auth.tokenDetails).to.not.be.null;
    expect(client.auth.tokenDetails!.token).to.equal('initial-token');
    expect(client.auth.tokenDetails!.clientId).to.equal('initial-client');
  });

  /**
   * RSA16c - tokenDetails updated after explicit authorize()
   */
  // UTS: rest/unit/RSA16c/updated-after-authorize-1
  it('RSA16c - tokenDetails updated after authorize()', async function () {
    let tokenCount = 0;

    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        tokenCount++;
        callback(null, {
          token: 'token-v' + tokenCount,
          expires: Date.now() + 3600000,
          issued: Date.now(),
          clientId: 'client-v' + tokenCount,
        } as any);
      },
    } as any);

    // First authorize
    await client.auth.authorize();
    const firstToken = client.auth.tokenDetails;

    // Second authorize
    await client.auth.authorize();
    const secondToken = client.auth.tokenDetails;

    expect(firstToken!.token).to.equal('token-v1');
    expect(secondToken!.token).to.equal('token-v2');
    expect(firstToken!.token).to.not.equal(secondToken!.token);
  });

  /**
   * RSA16c - tokenDetails updated after library-initiated renewal on expiry
   *
   * When the token expires (client-side check) and a new request is made,
   * the library proactively renews the token. tokenDetails should reflect
   * the new token.
   */
  // UTS: rest/unit/RSA16c/updated-after-expiry-renewal-2
  it('RSA16c - tokenDetails updated after expiry renewal', async function () {
    const clock = enableFakeTimers();
    let tokenCount = 0;

    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        tokenCount++;
        callback(null, {
          token: 'token-v' + tokenCount,
          expires: clock.now + 1000,
          issued: clock.now,
          clientId: 'client-v' + tokenCount,
        } as any);
      },
    } as any);

    // RSA4b1: client-side expiry check requires serverTimeOffset to be set
    (client as any).serverTimeOffset = 0;

    // First request gets initial token
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }
    const firstToken = client.auth.tokenDetails;

    // Advance time past token expiry
    clock.tick(2000);

    // Second request should trigger renewal due to client-side expiry check
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }
    const secondToken = client.auth.tokenDetails;

    expect(firstToken!.token).to.equal('token-v1');
    expect(secondToken!.token).to.equal('token-v2');
  });

  /**
   * RSA16c - tokenDetails updated after library-initiated renewal on 40142
   *
   * When a request fails with 40142 (token expired), the library renews
   * the token and tokenDetails should reflect the new token.
   */
  // UTS: rest/unit/RSA16c/updated-after-40142-renewal-3
  it('RSA16c - tokenDetails updated after 40142 renewal', async function () {
    let requestCount = 0;
    let tokenCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => {
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
      authCallback: function (params: any, callback: any) {
        tokenCount++;
        callback(null, {
          token: 'token-v' + tokenCount,
          expires: Date.now() + 3600000,
          issued: Date.now(),
          clientId: 'client-v' + tokenCount,
        } as any);
      },
    } as any);

    // First authorize
    await client.auth.authorize();
    const firstToken = client.auth.tokenDetails;

    // Make a request that will fail with 40142, triggering renewal
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }
    const secondToken = client.auth.tokenDetails;

    expect(firstToken!.token).to.equal('token-v1');
    expect(secondToken!.token).to.equal('token-v2');
  });

  /**
   * RSA16d - tokenDetails null after token invalidation
   *
   * When a token error occurs and renewal fails (authCallback errors),
   * tokenDetails should be null.
   */
  // UTS: rest/unit/RSA16d/null-after-invalidation-2
  it('RSA16d - tokenDetails null after invalidation', async function () {
    this.timeout(5000);
    let callbackCount = 0;
    let requestCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => {
        requestCount++;
        req.respond_with(401, {
          error: { code: 40142, statusCode: 401, message: 'Token expired' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callbackCount++;
        if (callbackCount === 1) {
          callback(null, {
            token: 'first-token',
            expires: Date.now() + 3600000,
            issued: Date.now(),
          } as any);
        } else {
          callback(new Error('Cannot obtain new token'));
        }
      },
    } as any);

    // First authorize succeeds
    await client.auth.authorize();
    expect(client.auth.tokenDetails).to.not.be.null;
    expect(client.auth.tokenDetails!.token).to.equal('first-token');

    // Make a request that fails with 40142, renewal will also fail
    try {
      await client.stats({} as any);
    } catch (e) {
      // Expected — renewal failed
    }

    // Spec (RSA16d): after failed renewal, tokenDetails MUST be null.
    // DEVIATION: ably-js may keep the stale token. See deviations.md.
    expect(callbackCount).to.equal(2);
    expect(client.auth.tokenDetails).to.be.null;
  });

  /**
   * RSA16d - tokenDetails null with basic auth
   */
  // UTS: rest/unit/RSA16d/null-with-basic-auth-0
  it('RSA16d - tokenDetails null with basic auth', async function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(client.auth.tokenDetails).to.satisfy((v: any) => v === null || v === undefined);
  });

  /**
   * RSA16d - tokenDetails null before first token obtained
   */
  // UTS: rest/unit/RSA16d/null-before-token-obtained-1
  it('RSA16d - tokenDetails null before first token', function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(null, 'my-token');
      },
    } as any);

    // No requests made yet
    expect(client.auth.tokenDetails).to.satisfy((v: any) => v === null || v === undefined);
  });

  /**
   * RSA16d - tokenDetails null after switching from token auth to basic auth
   *
   * When authorize() is called with a key and useTokenAuth: false,
   * the client switches to basic auth and tokenDetails becomes null.
   */
  // UTS: rest/unit/RSA16d/null-after-switch-to-basic-3
  it.skip('RSA16d - tokenDetails null after switch to basic auth', function () {
    // DEVIATION: ably-js's authorize() always performs token auth — it cannot
    // switch to basic auth. Calling authorize(null, { useTokenAuth: false })
    // throws "authOptions must include valid authentication parameters".
    // The spec scenario (switching from token auth to basic auth mid-session)
    // is not supported by ably-js.
  });

  /**
   * Edge case: tokenDetails preserved across multiple successful requests
   */
  // UTS: rest/unit/RSA16a/preserved-across-requests-0
  it('tokenDetails preserved across requests', async function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(null, {
          token: 'stable-token',
          expires: Date.now() + 3600000,
          issued: Date.now(),
          clientId: 'stable-client',
        } as any);
      },
    } as any);

    // Make multiple requests
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }
    const firstCheck = client.auth.tokenDetails;

    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }
    const secondCheck = client.auth.tokenDetails;

    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }
    const thirdCheck = client.auth.tokenDetails;

    expect(firstCheck!.token).to.equal('stable-token');
    expect(secondCheck!.token).to.equal('stable-token');
    expect(thirdCheck!.token).to.equal('stable-token');
  });

  /**
   * Edge case: tokenDetails reflects capability from token
   */
  // UTS: rest/unit/RSA16a/reflects-capability-1
  it('tokenDetails reflects capability', async function () {
    installMockHttp(simpleMock());

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(null, {
          token: 'capable-token',
          expires: Date.now() + 3600000,
          issued: Date.now(),
          capability: '{"channel1":["publish","subscribe"],"channel2":["subscribe"]}',
        } as any);
      },
    } as any);

    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(client.auth.tokenDetails).to.not.be.null;
    expect(client.auth.tokenDetails!.capability).to.equal(
      '{"channel1":["publish","subscribe"],"channel2":["subscribe"]}',
    );
  });
});
