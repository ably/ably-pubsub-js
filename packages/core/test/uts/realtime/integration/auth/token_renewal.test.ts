/**
 * UTS Integration: Token Renewal Tests
 *
 * Spec points: RSA4b, RTN14b
 * Source: uts/realtime/integration/auth/token_renewal_test.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  getKeyParts,
  trackClient,
  connectAndWait,
  closeAndWait,
  generateJWT,
  pollUntil,
} from '../sandbox';

describe('uts/realtime/integration/auth/token_renewal', function () {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSA4b, RTN14b - Token renewal on expiry
   */
  // UTS: realtime/integration/RSA4b/token-renewal-on-expiry-0
  it('RSA4b/RTN14b - token renewal on expiry', async function () {
    const { keyName, keySecret } = getKeyParts(getApiKey());
    let callbackCount = 0;

    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        callbackCount++;
        if (callbackCount === 1) {
          cb(null, generateJWT({ keyName, keySecret, ttl: 5000 }));
        } else {
          cb(null, generateJWT({ keyName, keySecret, ttl: 3600000 }));
        }
      },
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);
    expect(callbackCount).to.equal(1);

    await pollUntil(() => (callbackCount >= 2 ? true : null), {
      interval: 1000,
      timeout: 30000,
    });

    await connectAndWait(client);

    expect(callbackCount).to.be.at.least(2);
    expect(client.connection.state).to.equal('connected');

    await closeAndWait(client);
  });
});
