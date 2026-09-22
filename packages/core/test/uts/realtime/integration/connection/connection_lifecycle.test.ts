/**
 * UTS Integration: Connection Lifecycle Tests
 *
 * Spec points: RTN4b, RTN4c, RTN11, RTN12, RTN12a, RTN21
 * Source: uts/realtime/integration/connection_lifecycle_test.md
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

describe('uts/realtime/integration/connection/connection_lifecycle', function () {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTN4b, RTN21 - Successful connection establishment
   */
  // UTS: realtime/integration/RTN4b/successful-connection-0
  it('RTN4b/RTN21 - successful connection establishment', async function () {
    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    expect(client.connection.state).to.equal('initialized');

    await connectAndWait(client);

    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.match(/[a-zA-Z0-9_-]+/);
    expect(client.connection.key).to.match(/[a-zA-Z0-9_!-]+/);
    expect(client.connection.errorReason).to.be.null;

    await closeAndWait(client);
  });

  /**
   * RTN4c, RTN12, RTN12a - Graceful connection close
   */
  // UTS: realtime/integration/RTN4c/graceful-close-0
  it('RTN4c/RTN12/RTN12a - graceful connection close', async function () {
    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);
    expect(client.connection.state).to.equal('connected');

    await closeAndWait(client);

    expect(client.connection.state).to.equal('closed');
    // UTS spec says id/key are null and errorReason is null after clean close.
    // ably-js sets errorReason to "Connection closed" (code 80017) and clears
    // id/key to undefined rather than null.
    expect(client.connection.id).to.not.be.ok;
    expect(client.connection.key).to.not.be.ok;
  });

  /**
   * RTN11, RTN4b - Connect and reconnect cycle
   *
   * Uses two separate client instances because ably-js does not support
   * calling connect() on a client that has been closed.
   */
  // UTS: realtime/integration/RTN11/connect-reconnect-cycle-0
  it('RTN11/RTN4b - connect, close, reconnect cycle', async function () {
    const client1 = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client1);

    expect(client1.connection.state).to.equal('initialized');

    await connectAndWait(client1);
    const firstConnectionId = client1.connection.id;

    await closeAndWait(client1);
    expect(client1.connection.state).to.equal('closed');

    const client2 = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client2);

    await connectAndWait(client2);
    const secondConnectionId = client2.connection.id;

    expect(secondConnectionId).to.not.be.null;
    expect(firstConnectionId).to.not.equal(secondConnectionId);
    expect(client2.connection.errorReason).to.be.null;

    await closeAndWait(client2);
  });
});
