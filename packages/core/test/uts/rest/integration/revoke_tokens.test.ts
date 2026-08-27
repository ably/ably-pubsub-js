/**
 * UTS Integration: Revoke Tokens Tests
 *
 * Spec points: RSA17, RSA17b, RSA17c, RSA17d, RSA17e, RSA17f, RSA17g, TRS2, TRF2
 * Source: uts/rest/integration/revoke_tokens.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  getKeyParts,
  uniqueChannelName,
  generateJWT,
  trackClient,
  connectAndWait,
  closeAndWait,
} from './sandbox';

describe('uts/rest/integration/revoke_tokens', function () {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSA17g, RSA17b, RSA17c, TRS2 - Token revocation prevents subsequent use
   *
   * Auth#revokeTokens sends a POST to /keys/{keyName}/revokeTokens with targets
   * as type:value strings, and returns a result containing per-target success
   * information. Revocation is verified via a Realtime client that gets
   * disconnected with error code 40141.
   */
  // UTS: rest/integration/RSA17g/revoke-token-prevents-use-0
  it('RSA17g, RSA17b, RSA17c, TRS2 - token revocation prevents subsequent use', async function () {
    const clientId = 'revoke-client-' + Math.random().toString(36).substring(2, 10);

    const keyClient = new Ably.Rest({
      key: getApiKey(4),
      endpoint: SANDBOX_ENDPOINT,
    });

    const tokenDetails = await keyClient.auth.requestToken({ clientId });

    const realtimeClient = new Ably.Realtime({
      token: tokenDetails,
      endpoint: SANDBOX_ENDPOINT,
    });
    trackClient(realtimeClient);
    await connectAndWait(realtimeClient);

    const disconnectedPromise = new Promise<any>((resolve) => {
      realtimeClient.connection.once('disconnected', resolve);
    });

    const revokeResult = await keyClient.auth.revokeTokens([{ type: 'clientId', value: clientId }]);

    expect(revokeResult.successCount).to.equal(1);
    expect(revokeResult.failureCount).to.equal(0);
    expect(revokeResult.results).to.have.length(1);

    const success = revokeResult.results[0] as any;
    expect(success.target).to.equal('clientId:' + clientId);
    expect(success.issuedBefore).to.be.a('number');
    expect(success.appliesAt).to.be.a('number');

    const stateChange = await disconnectedPromise;
    expect(stateChange.reason.code).to.equal(40141);

    await closeAndWait(realtimeClient);
  });

  /**
   * RSA17d - Token auth client rejected
   *
   * If called from a client using token authentication, should raise an error
   * with code 40162 and status code 401. This is a client-side check -- no
   * HTTP request is made to the server.
   */
  // UTS: rest/integration/RSA17d/token-auth-revoke-rejected-0
  it('RSA17d - token auth client rejected', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey(4));
    const jwt = generateJWT({
      keyName,
      keySecret,
      ttl: 3600000,
    });

    const tokenRest = new Ably.Rest({
      token: jwt,
      endpoint: SANDBOX_ENDPOINT,
    });

    try {
      await tokenRest.auth.revokeTokens([{ type: 'clientId', value: 'anyone' }]);
      expect.fail('revokeTokens should have failed with token auth client');
    } catch (error: any) {
      expect(error.code).to.equal(40162);
      expect(error.statusCode).to.equal(401);
    }
  });

  /**
   * RSA17e, RSA17f - issuedBefore and allowReauthMargin
   *
   * When issuedBefore is provided, only tokens issued before that timestamp are
   * revoked. When allowReauthMargin is true, the revocation is delayed by
   * approximately 30 seconds to allow token renewal.
   */
  // UTS: rest/integration/RSA17e/issued-before-reauth-margin-0
  it('RSA17e, RSA17f - issuedBefore and allowReauthMargin', async function () {
    const clientId = 'revoke-margin-client-' + Math.random().toString(36).substring(2, 10);

    const keyClient = new Ably.Rest({
      key: getApiKey(4),
      endpoint: SANDBOX_ENDPOINT,
    });

    const serverTime = await keyClient.time();
    const issuedBefore = serverTime - 20 * 60 * 1000;

    const revokeResult = await keyClient.auth.revokeTokens([{ type: 'clientId', value: clientId }], {
      issuedBefore,
      allowReauthMargin: true,
    });

    expect(revokeResult.successCount).to.equal(1);
    expect(revokeResult.results).to.have.length(1);

    const result = revokeResult.results[0] as any;

    expect(result.issuedBefore).to.equal(issuedBefore);

    const serverTimeThirtySecondsLater = serverTime + 30 * 1000;
    expect(result.appliesAt).to.be.greaterThan(serverTimeThirtySecondsLater);
  });

  /**
   * RSA17c, TRF2 - Mixed success and failure (invalid specifier type)
   *
   * The response can contain both successful and failed per-target results.
   * An invalid target type produces a failure result with an ErrorInfo.
   * The valid revocation is verified via a Realtime client disconnect.
   */
  // UTS: rest/integration/RSA17c/mixed-success-failure-0
  it('RSA17c, TRF2 - mixed success and failure', async function () {
    const clientId = 'revoke-mixed-client-' + Math.random().toString(36).substring(2, 10);

    const keyClient = new Ably.Rest({
      key: getApiKey(4),
      endpoint: SANDBOX_ENDPOINT,
    });

    const tokenDetails = await keyClient.auth.requestToken({ clientId });

    const realtimeClient = new Ably.Realtime({
      token: tokenDetails,
      endpoint: SANDBOX_ENDPOINT,
    });
    trackClient(realtimeClient);
    await connectAndWait(realtimeClient);

    const disconnectedPromise = new Promise<any>((resolve) => {
      realtimeClient.connection.once('disconnected', resolve);
    });

    const revokeResult = await keyClient.auth.revokeTokens([
      { type: 'clientId', value: clientId },
      { type: 'invalidType', value: 'abc' },
    ]);

    expect(revokeResult.successCount).to.equal(1);
    expect(revokeResult.failureCount).to.equal(1);
    expect(revokeResult.results).to.have.length(2);

    const success = revokeResult.results[0] as any;
    expect(success.target).to.equal('clientId:' + clientId);
    expect(success.issuedBefore).to.be.a('number');
    expect(success.appliesAt).to.be.a('number');

    const failure = revokeResult.results[1] as any;
    expect(failure.target).to.equal('invalidType:abc');
    expect(failure.error).to.exist;
    expect(failure.error.statusCode).to.equal(400);

    const stateChange = await disconnectedPromise;
    expect(stateChange.reason.code).to.equal(40141);

    await closeAndWait(realtimeClient);
  });
});
