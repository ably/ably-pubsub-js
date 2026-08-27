/**
 * UTS Integration: Connection Failures Tests
 *
 * Spec points: RTN14a, RTN14g
 * Source: uts/realtime/integration/connection/connection_failures_test.md
 */

import { expect } from 'chai';
import { Ably, SANDBOX_ENDPOINT, setupSandbox, teardownSandbox, trackClient } from '../sandbox';

describe('uts/realtime/integration/connection/connection_failures', function () {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTN14a - Invalid API key causes FAILED
   */
  // UTS: realtime/integration/RTN14a/invalid-key-failed-0
  it('RTN14a - invalid API key causes FAILED', async function () {
    const client = new Ably.Realtime({
      key: 'invalid.key:secret',
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for FAILED')), 15000);
      client.connection.once('failed', () => {
        clearTimeout(timer);
        resolve();
      });
      client.connect();
    });

    expect(client.connection.state).to.equal('failed');
    expect(client.connection.errorReason).to.not.be.null;

    const code = client.connection.errorReason!.code;
    expect(code === 40005 || code === 40101).to.be.true;

    const statusCode = client.connection.errorReason!.statusCode;
    expect(statusCode === 401 || statusCode === 404).to.be.true;
  });

  /**
   * RTN14g - Non-existent key causes FAILED
   */
  // UTS: realtime/integration/RTN14g/revoked-key-failed-0
  it('RTN14g - non-existent key causes FAILED', async function () {
    const client = new Ably.Realtime({
      key: 'nonexistent.keyname:keysecret',
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out waiting for FAILED')), 15000);
      client.connection.once('failed', () => {
        clearTimeout(timer);
        resolve();
      });
      client.connect();
    });

    expect(client.connection.state).to.equal('failed');
    expect(client.connection.errorReason).to.not.be.null;

    const code = client.connection.errorReason!.code;
    expect(code < 40140 || code >= 40150).to.be.true;
  });
});
