/**
 * UTS Integration: REST Auth Tests
 *
 * Spec points: RSA4, RSA8, RSC10
 * Source: uts/rest/integration/auth.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  getAppId,
  getKeyParts,
  uniqueChannelName,
  generateJWT,
} from './sandbox';

describe('uts/rest/integration/auth', function () {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSA4 - Basic auth with API key
   *
   * Client can authenticate using an API key via HTTP Basic Auth.
   */
  // UTS: rest/integration/RSA4/basic-auth-key-0
  it('RSA4 - basic auth with API key', async function () {
    const channelName = uniqueChannelName('test-RSA4');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await client.request('GET', '/channels/' + channelName, 3);

    expect(result.statusCode).to.be.at.least(200);
    expect(result.statusCode).to.be.below(300);
  });

  /**
   * RSA8 - Token auth with JWT
   *
   * Client can authenticate using a JWT token.
   */
  // UTS: rest/integration/RSA8/token-auth-jwt-0
  it('RSA8 - token auth with JWT', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());

    const jwt = generateJWT({
      keyName,
      keySecret,
      ttl: 3600000,
    });

    const channelName = uniqueChannelName('test-RSA8-jwt');

    const client = new Ably.Rest({
      token: jwt,
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await client.request('GET', '/channels/' + channelName, 3, null, null, {});

    expect(result.statusCode).to.be.at.least(200);
    expect(result.statusCode).to.be.below(300);
  });

  /**
   * RSA8 - Token auth with native token
   *
   * Client can authenticate using an Ably native token obtained via requestToken().
   */
  // UTS: rest/integration/RSA8/token-auth-native-1
  it('RSA8 - token auth with native token', async function () {
    const keyClient = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const tokenDetails = await keyClient.auth.requestToken();

    expect(tokenDetails.token).to.be.a('string');
    expect(tokenDetails.token.length).to.be.greaterThan(0);
    expect(tokenDetails.expires).to.be.greaterThan(Date.now());

    const channelName = uniqueChannelName('test-RSA8-native');
    const tokenClient = new Ably.Rest({
      token: tokenDetails.token,
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await tokenClient.request('GET', '/channels/' + channelName, 3, null, null, {});

    expect(result.statusCode).to.be.at.least(200);
    expect(result.statusCode).to.be.below(300);
  });

  /**
   * RSA8 - authCallback with TokenRequest
   *
   * Client can use authCallback to obtain authentication via TokenRequest.
   */
  // UTS: rest/integration/RSA8/auth-callback-token-request-2
  it('RSA8 - authCallback with TokenRequest', async function () {
    const tokenRequestClient = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const channelName = uniqueChannelName('test-RSA8-callback');

    const client = new Ably.Rest({
      authCallback: async (_params: any, cb: any) => {
        try {
          const tokenRequest = await tokenRequestClient.auth.createTokenRequest(_params, null);
          cb(null, tokenRequest);
        } catch (err) {
          cb(err, null);
        }
      },
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await client.request('GET', '/channels/' + channelName, 3, null, null, {});

    expect(result.statusCode).to.be.at.least(200);
    expect(result.statusCode).to.be.below(300);
  });

  /**
   * RSA8 - authCallback with JWT
   *
   * Client can use authCallback to obtain JWT tokens dynamically.
   */
  // UTS: rest/integration/RSA8/auth-callback-jwt-3
  it('RSA8 - authCallback with JWT', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());

    const channelName = uniqueChannelName('test-RSA8-jwt-callback');

    const client = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        try {
          const jwt = generateJWT({
            keyName,
            keySecret,
            clientId: _params.clientId,
            ttl: _params.ttl || 3600000,
          });
          cb(null, jwt);
        } catch (err) {
          cb(err, null);
        }
      },
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await client.request('GET', '/channels/' + channelName, 3, null, null, {});

    expect(result.statusCode).to.be.at.least(200);
    expect(result.statusCode).to.be.below(300);
  });

  /**
   * RSA4 - Invalid credentials rejected
   *
   * Server rejects requests with invalid API key credentials.
   */
  // UTS: rest/integration/RSA4/invalid-credentials-rejected-1
  it('RSA4 - invalid credentials rejected', async function () {
    const channelName = uniqueChannelName('test-RSA4-invalid');

    const invalidKey = getAppId() + '.invalidKey:invalidSecret';

    const client = new Ably.Rest({
      key: invalidKey,
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await client.request('GET', '/channels/' + channelName, 3, null, null, {});
    expect(result.success).to.equal(false);
    expect(result.statusCode).to.equal(401);
    expect(result.errorCode).to.equal(40400);
  });

  /**
   * RSC10 - Token renewal with expired JWT
   *
   * When a REST request fails with a token error (40140-40149), the client
   * should automatically renew the token and retry the request.
   */
  // UTS: rest/integration/RSC10/token-renewal-expired-jwt-0
  it('RSC10 - token renewal with expired JWT', async function () {
    if (!process.env.RUN_DEVIATIONS) this.skip(); // ably-js retry overwrites new auth header with stale one; see #2193
    const { keyName, keySecret } = getKeyParts(getApiKey());

    let callbackCount = 0;

    const channelName = uniqueChannelName('test-RSC10-renewal');

    const client = new Ably.Rest({
      authCallback: (_params: any, cb: any) => {
        callbackCount++;
        try {
          if (callbackCount === 1) {
            // First call: return a JWT that was issued 70s ago and expired 5s ago
            const jwt = generateJWT({
              keyName,
              keySecret,
              issuedAt: Date.now() - 70000,
              expiresAt: Date.now() - 5000,
            });
            cb(null, jwt);
          } else {
            // Subsequent calls: return a valid JWT
            const jwt = generateJWT({
              keyName,
              keySecret,
              ttl: 3600000,
            });
            cb(null, jwt);
          }
        } catch (err) {
          cb(err, null);
        }
      },
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await client.request('GET', '/channels/' + channelName, 3, null, null, {});

    // The request succeeded (token was renewed and retried)
    expect(result.statusCode).to.be.at.least(200);
    expect(result.statusCode).to.be.below(300);

    // The authCallback was called twice: once for expired token, once for renewal
    expect(callbackCount).to.equal(2);
  });

  /**
   * RSA8 - Capability restriction
   *
   * Tokens with restricted capabilities should only allow the permitted operations.
   */
  // UTS: rest/integration/RSA8/capability-restriction-4
  it('RSA8 - capability restriction', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());

    const allowedChannel = uniqueChannelName('test-RSA8-cap-allowed');
    const deniedChannel = uniqueChannelName('test-RSA8-cap-denied');

    const jwt = generateJWT({
      keyName,
      keySecret,
      capability: '{"' + allowedChannel + '":["publish","subscribe"]}',
      ttl: 3600000,
    });

    const client = new Ably.Rest({
      token: jwt,
      endpoint: SANDBOX_ENDPOINT,
    });

    // Publish to allowed channel should succeed
    await client.channels.get(allowedChannel).publish('test', 'hello');

    // Publish to denied channel should fail with 40160 (capability refused)
    try {
      await client.channels.get(deniedChannel).publish('test', 'hello');
      expect.fail('Publish to denied channel should have failed');
    } catch (error: any) {
      expect(error.code).to.equal(40160);
      expect(error.statusCode).to.equal(401);
    }
  });
});
