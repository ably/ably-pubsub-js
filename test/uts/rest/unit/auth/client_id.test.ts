/**
 * UTS: Client ID Tests
 *
 * Spec points: RSA7, RSA7a, RSA7b, RSA7c, RSA12, RSA12a, RSA12b, RSA15, RSA15a, RSA15b, RSA15c
 * Source: specification/uts/rest/unit/auth/client_id.md
 */

import { expect } from 'chai';
import ErrorInfo from '../../../../../src/common/lib/types/errorinfo';
import PushChannel from '../../../../../src/plugins/push/pushchannel';
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

describe('uts/rest/unit/auth/client_id', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSA7a - clientId from ClientOptions
   */
  // UTS: rest/unit/RSA7a/clientid-from-options-0
  it('RSA7a - clientId from ClientOptions', function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      clientId: 'my-client-id',
    });

    expect(client.auth.clientId).to.equal('my-client-id');
  });

  /**
   * RSA7b - clientId from TokenDetails
   *
   * Per spec, clientId from TokenDetails passed at construction should be
   * accessible via auth.clientId.
   */
  // UTS: rest/unit/RSA7b/clientid-from-token-details-0
  it('RSA7b - clientId from TokenDetails', function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      tokenDetails: {
        token: 'token-with-clientId',
        expires: Date.now() + 3600000,
        clientId: 'token-client-id',
      } as any,
    } as any);

    expect(client.auth.clientId).to.equal('token-client-id');
  });

  /**
   * RSA7b - clientId from authCallback TokenDetails
   *
   * Per spec, clientId from TokenDetails returned by authCallback should
   * update auth.clientId after the first auth request.
   */
  // UTS: rest/unit/RSA7b/clientid-from-callback-token-1
  it('RSA7b - clientId from authCallback TokenDetails', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        callback(null, {
          token: 'callback-token',
          expires: Date.now() + 3600000,
          issued: Date.now(),
          clientId: 'callback-client-id',
        } as any);
      },
    } as any);

    // Trigger auth by making a request
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(client.auth.clientId).to.equal('callback-client-id');
  });

  /**
   * RSA7c - clientId null when unidentified
   */
  // UTS: rest/unit/RSA7c/clientid-null-unidentified-0
  it('RSA7c - clientId null when unidentified', function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    expect(client.auth.clientId).to.satisfy((v: any) => v === null || v === undefined);
  });

  /**
   * RSA7c - clientId null with unidentified token
   */
  // UTS: rest/unit/RSA7c/clientid-null-unidentified-token-1
  it('RSA7c - clientId null with unidentified token', function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      tokenDetails: {
        token: 'token-without-clientId',
        expires: Date.now() + 3600000,
      } as any,
    } as any);

    expect(client.auth.clientId).to.satisfy((v: any) => v === null || v === undefined);
  });

  /**
   * RSA12a - clientId passed to authCallback in TokenParams
   */
  // UTS: rest/unit/RSA12a/clientid-passed-to-callback-0
  it('RSA12a - clientId passed to authCallback in TokenParams', async function () {
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
      clientId: 'library-client-id',
    } as any);

    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(receivedParams).to.not.be.null;
    expect(receivedParams.clientId).to.equal('library-client-id');
  });

  /**
   * RSA12b - clientId sent to authUrl as query param
   */
  // UTS: rest/unit/RSA12b/clientid-sent-to-authurl-0
  it('RSA12b - clientId sent to authUrl', async function () {
    const captured: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => {
        captured.push(req);
        if (req.url.host === 'auth.example.com') {
          req.respond_with(200, 'url-token', { 'content-type': 'text/plain' });
        } else {
          req.respond_with(200, []);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authUrl: 'https://auth.example.com/token',
      clientId: 'url-client-id',
    } as any);

    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    const authReq = captured[0];
    expect(authReq.url.host).to.equal('auth.example.com');
    // clientId should be in query params (GET is default)
    expect(authReq.url.searchParams.get('clientId')).to.equal('url-client-id');
  });

  /**
   * RSA7 - clientId updated after authorize()
   *
   * Per spec, auth.clientId should be updated when authorize() returns
   * a new token with a different clientId.
   */
  // UTS: rest/unit/RSA7/clientid-updated-after-authorize-0
  it('RSA7 - clientId updated after authorize()', async function () {
    let tokenCount = 0;

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn: any) => conn.respond_with_success(),
      onRequest: (req: any) => req.respond_with(200, []),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      authCallback: function (params: any, callback: any) {
        tokenCount++;
        callback(null, {
          token: 'token-' + tokenCount,
          expires: Date.now() + 3600000,
          issued: Date.now(),
          clientId: 'client-' + tokenCount,
        } as any);
      },
    } as any);

    // First auth
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }
    expect(client.auth.clientId).to.equal('client-1');

    // Second auth with explicit authorize
    await client.auth.authorize();
    expect(client.auth.clientId).to.equal('client-2');
  });

  /**
   * RSA12 - Wildcard clientId
   *
   * Per spec, wildcard '*' clientId in TokenDetails should be preserved
   * and accessible via auth.clientId.
   */
  // UTS: rest/unit/RSA12/wildcard-clientid-0
  it('RSA12 - Wildcard clientId', function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      tokenDetails: {
        token: 'wildcard-token',
        expires: Date.now() + 3600000,
        clientId: '*',
      } as any,
    } as any);

    expect(client.auth.clientId).to.equal('*');
  });

  /**
   * RSA7 - Consistency case 3: explicit clientId in options, null in token
   *
   * When ClientOptions.clientId is set but the token has no clientId,
   * the client should keep the explicit clientId from options.
   */
  // UTS: rest/unit/RSA7/clientid-mismatch-error-1
  it('RSA7 - case 3: explicit clientId kept when token has none', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      clientId: 'explicit-client',
      authCallback: function (params: any, callback: any) {
        callback(null, {
          token: 'token-no-clientId',
          expires: Date.now() + 3600000,
          issued: Date.now(),
          // no clientId in token
        } as any);
      },
    } as any);

    // Force auth
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    expect(client.auth.clientId).to.equal('explicit-client');
  });

  /**
   * RSA7 - Consistency case 5: no clientId in options, clientId in token
   *
   * When ClientOptions.clientId is not set but the token has a clientId,
   * the client should inherit the clientId from the token.
   *
   */
  // UTS: rest/unit/RSA7/clientid-updated-after-authorize-0.1
  it('RSA7 - case 5: clientId inherited from token', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      // no clientId in options
      authCallback: function (params: any, callback: any) {
        callback(null, {
          token: 'token-with-clientId',
          expires: Date.now() + 3600000,
          issued: Date.now(),
          clientId: 'token-client',
        } as any);
      },
    } as any);

    // Force auth
    try {
      await client.stats({} as any);
    } catch (e) {
      /* ok */
    }

    // Per spec, should inherit clientId from token
    expect(client.auth.clientId).to.equal('token-client');
  });

  /**
   * RSA15a - Matching clientId succeeds
   */
  // UTS: rest/unit/RSA15a/token-clientid-must-match-0
  it('RSA15a - Matching clientId succeeds', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      clientId: 'my-client',
      tokenDetails: {
        token: 'matching-token',
        expires: Date.now() + 3600000,
        clientId: 'my-client',
      } as any,
    } as any);

    // Should not throw when using the token
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    expect(client.auth.clientId).to.equal('my-client');
  });

  /**
   * RSA15a - Mismatched clientId error (40102)
   *
   * Per spec, if ClientOptions.clientId and TokenDetails.clientId are both
   * non-wildcard and don't match, an error with code 40102 must be raised.
   */
  // UTS: rest/unit/RSA15c/incompatible-clientid-error-0
  it('RSA15a - Mismatched clientId error (40102)', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      clientId: 'client-a',
      tokenDetails: {
        token: 'mismatched-token',
        expires: Date.now() + 3600000,
        clientId: 'client-b',
      } as any,
    } as any);

    try {
      await client.stats({} as any);
      expect.fail('Expected request to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40102);
    }
  });

  /**
   * RSA15b - Wildcard token clientId permits any ClientOptions clientId
   */
  // UTS: rest/unit/RSA15b/wildcard-token-permits-any-0
  it('RSA15b - Wildcard token clientId permits any ClientOptions clientId', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));

    const client = new Ably.Rest({
      clientId: 'any-client',
      tokenDetails: {
        token: 'wildcard-token',
        expires: Date.now() + 3600000,
        clientId: '*',
      } as any,
    } as any);

    // Should not throw — wildcard allows any clientId
    try {
      await client.stats({} as any);
    } catch (e) {
      /* response parse errors ok */
    }

    expect(client.auth.clientId).to.equal('any-client');
  });
  /** RSA7a - An explicit identity supplied to authorize remains authoritative. */
  it('RSA7a - authorize clientId is retained with a wildcard token', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));
    const client = new Ably.Rest({
      authCallback(_params: any, callback: any) {
        callback(null, { token: 'wildcard-token', clientId: '*', issued: Date.now(), expires: Date.now() + 3600000 });
      },
    });
    await client.auth.authorize(null, {
      clientId: 'explicit-client',
      authCallback(_params: any, callback: any) {
        callback(null, { token: 'wildcard-token', clientId: '*', issued: Date.now(), expires: Date.now() + 3600000 });
      },
    });
    expect(client.auth.clientId).to.equal('explicit-client');
  });

  /** RSA7b - A new unidentified token clears a previously derived identity. */
  it('RSA7b - an unidentified renewal clears the derived clientId', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));
    let count = 0;
    const client = new Ably.Rest({
      authCallback(_params: any, callback: any) {
        callback(null, {
          token: 'token-' + count,
          issued: Date.now(),
          clientId: count++ ? undefined : 'token-client',
          expires: Date.now() + 3600000,
        });
      },
    });
    await client.auth.authorize();
    expect(client.auth.clientId).to.equal('token-client');
    await client.auth.authorize();
    expect(client.auth.clientId).to.equal(undefined);
  });
  for (const clientId of [null, '']) {
    /** RSA7a - Preserve explicitly supplied unidentified client IDs. */
    it(`RSA7a - explicit ${JSON.stringify(clientId)} is not overridden by token details`, async function () {
      const captured: any[] = [];
      installMockHttp(simpleMock(captured));
      const client = new Ably.Rest({
        clientId,
        tokenDetails: {
          capability: '{}',
          token: 'token-client',
          clientId: 'token-client',
          issued: Date.now(),
          expires: Date.now() + 3600000,
        },
        authCallback(_params: any, callback: any) {
          callback(null, {
            token: 'renewed',
            clientId: 'renewed-client',
            issued: Date.now(),
            expires: Date.now() + 3600000,
          });
        },
      });
      expect(client.auth.clientId).to.equal(clientId);
      await client.auth.authorize();
      expect(client.auth.clientId).to.equal(clientId);
    });
  }

  /** RSA7 - REST token derivation must not affect Realtime before CONNECTED. */
  it('RSA7 - Realtime token acquisition does not establish identity before connection', async function () {
    const captured: any[] = [];
    installMockHttp(simpleMock(captured));
    const client = new Ably.Realtime({
      autoConnect: false,
      authCallback(_params: any, callback: any) {
        callback(null, {
          token: 'token-client',
          clientId: 'token-client',
          issued: Date.now(),
          expires: Date.now() + 3600000,
        });
      },
    });
    expect(client.auth.clientId).to.equal(undefined);
    await (client.auth as any)._ensureValidAuthCredentials(false);
    expect(client.auth.clientId).to.equal(undefined);
    client.close();
  });
  /** RSA7b4 - A wildcard token grants permission, not a concrete push identity. */
  it('RSA7b4 - wildcard token cannot subscribe or unsubscribe a push client', async function () {
    const client = new Ably.Rest({
      tokenDetails: {
        capability: '{}',
        issued: Date.now(),
        token: 'wildcard',
        clientId: '*',
        expires: Date.now() + 3600000,
      },
    });
    expect(client.auth.clientId).to.equal('*');
    const push = new PushChannel({ client: { auth: client.auth, ErrorInfo }, name: 'test' } as any);
    for (const call of [() => push.subscribeClient(), () => push.unsubscribeClient()]) {
      let caught: any;
      try {
        await call();
      } catch (error) {
        caught = error;
      }
      expect(caught?.code).to.equal(50000);
      expect(caught?.message).to.match(/without client ID/);
    }
  });
  /** RSA7b - authorize may accept TokenDetails without making a token request. */
  it('RSA7b - authorize derives and replaces clientId from supplied TokenDetails', async function () {
    const client = new Ably.Rest({ token: 'initial-token', logLevel: 0 });
    expect(client.auth.clientId).to.equal(undefined);
    for (const clientId of ['first-client', 'second-client', '*', undefined]) {
      await client.auth.authorize(null, {
        tokenDetails: {
          token: 'supplied-token',
          clientId,
          capability: '{}',
          issued: Date.now(),
          expires: Date.now() + 3600000,
        },
      });
      expect(client.auth.clientId).to.equal(clientId);
    }
  });
});
