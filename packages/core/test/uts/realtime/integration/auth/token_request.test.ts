/**
 * UTS Integration: Token Request Tests
 *
 * Spec points: RSA9, RSA9a, RSA9g
 * Source: uts/realtime/integration/auth/token_request_test.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  trackClient,
  connectAndWait,
  closeAndWait,
} from '../sandbox';

describe('uts/realtime/integration/auth/token_request', function () {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSA9a, RSA9g - createTokenRequest produces server-accepted token
   */
  // UTS: realtime/integration/RSA9a/token-request-server-accepted-0
  it('RSA9a/RSA9g - createTokenRequest produces server-accepted token', async function () {
    const creator = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const client = new Ably.Realtime({
      authCallback: async (_params: any, cb: any) => {
        try {
          const tokenRequest = await creator.auth.createTokenRequest();
          cb(null, tokenRequest);
        } catch (err) {
          cb(err, null);
        }
      },
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);

    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.not.be.null;
    expect(client.connection.errorReason).to.be.null;

    await closeAndWait(client);
  });

  /**
   * RSA9 - createTokenRequest with clientId
   */
  // UTS: realtime/integration/RSA9/token-request-with-clientid-0
  it('RSA9 - createTokenRequest with clientId', async function () {
    const testClientId = `token-request-client-${Math.random().toString(36).substring(2, 10)}`;

    const creator = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const client = new Ably.Realtime({
      authCallback: async (_params: any, cb: any) => {
        try {
          const tokenRequest = await creator.auth.createTokenRequest({ clientId: testClientId });
          cb(null, tokenRequest);
        } catch (err) {
          cb(err, null);
        }
      },
      clientId: testClientId,
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);

    expect(client.connection.state).to.equal('connected');
    expect(client.auth.clientId).to.equal(testClientId);

    await closeAndWait(client);
  });
});
