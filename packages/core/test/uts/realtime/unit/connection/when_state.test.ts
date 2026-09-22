/**
 * UTS: Connection whenState Tests
 *
 * Spec points: RTN26, RTN26a, RTN26b
 * Source: uts/test/realtime/unit/connection/when_state_test.md
 *
 * Note: ably-js whenState returns a Promise (not callback-based).
 * If already in target state, resolves with null.
 * Otherwise resolves with ConnectionStateChange via once().
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import {
  Ably,
  trackClient,
  installMockWebSocket,
  installMockHttp,
  enableFakeTimers,
  restoreAll,
  flushAsync,
} from '../../../helpers';

describe('uts/realtime/unit/connection/when_state', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN26a - whenState resolves immediately if already in state
   */
  // UTS: realtime/unit/RTN26a/immediate-callback-current-state-0
  it('RTN26a - whenState resolves immediately for current state', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_connected();
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    // Already in initialized state
    const result = await client.connection.whenState('initialized');
    expect(result).to.be.null;

    // Connect and wait
    client.connect();
    await client.connection.whenState('connected');

    // Now already in connected state
    const result2 = await client.connection.whenState('connected');
    expect(result2).to.be.null;

    client.close();
  });

  /**
   * RTN26b - whenState waits for state if not already in it
   */
  // UTS: realtime/unit/RTN26b/deferred-callback-future-state-0
  it('RTN26b - whenState waits for target state', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_connected();
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    expect(client.connection.state).to.equal('initialized');

    // Set up whenState before connecting
    client.connection.whenState('connected').then((change: any) => {
      // Should be invoked with a ConnectionStateChange (not null)
      expect(change).to.not.be.null;
      expect(change.current).to.equal('connected');

      client.close();
      done();
    });

    // Start connection
    client.connect();
  });

  /**
   * RTN26b - whenState only fires once
   */
  // UTS: realtime/unit/RTN26b/fires-only-once-1
  it('RTN26b - whenState only fires once across reconnection', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `conn-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `conn-key-${connectionAttemptCount}`,
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Mock HTTP for connectivity checker
    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    let callbackCount = 0;

    // whenState returns a Promise; it resolves once
    client.connection.whenState('connected').then(() => {
      callbackCount++;
    });

    // Connect
    client.connect();

    // Pump to establish connection
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(client.connection.state).to.equal('connected');
    expect(callbackCount).to.equal(1);

    // Force disconnection
    mock.active_connection!.simulate_disconnect();

    // Pump to process disconnect
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // Advance time for reconnection
    await clock.tickAsync(200);

    // Pump to let reconnection complete
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(client.connection.state).to.equal('connected');

    // Callback should still only be 1 (Promise resolves once)
    expect(callbackCount).to.equal(1);
    client.close();
  });

  /**
   * RTN26a - Multiple whenState calls for same state
   */
  // UTS: realtime/unit/RTN26a/multiple-whenstate-calls-1
  it('RTN26a - multiple whenState calls all resolve', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_connected();
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const p1 = client.connection.whenState('connected');
    const p2 = client.connection.whenState('connected');
    const p3 = client.connection.whenState('connecting');

    client.connect();

    // All three should resolve
    await Promise.all([p1, p2, p3]);

    expect(client.connection.state).to.equal('connected');
    client.close();
  });

  /**
   * RTN26a - whenState does NOT fire for already-passed state
   */
  // UTS: realtime/unit/RTN26a/no-fire-for-past-state-2
  it('RTN26a - whenState does not fire for past state', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_connected();
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    let fired = false;
    client.connection.whenState('connecting').then(() => {
      fired = true;
    });

    await flushAsync();

    expect(fired).to.be.false;
  });

  /**
   * RTN26 - whenState with different states
   */
  // UTS: realtime/unit/RTN26/whenstate-different-states-0
  it('RTN26 - whenState works across state transitions', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_refused();
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Mock HTTP for connectivity checker
    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      fallbackHosts: [],
    });
    trackClient(client);

    // Already in initialized state — resolves immediately with null
    const initResult = await client.connection.whenState('initialized');
    expect(initResult).to.be.null;

    // Set up whenState for connecting and disconnected before connecting
    const connectingPromise = client.connection.whenState('connecting');
    const disconnectedPromise = client.connection.whenState('disconnected');

    // Start connection (will fail → disconnected)
    client.connect();

    // Both should resolve as the connection transitions through states
    const connectingResult = await connectingPromise;
    expect(connectingResult).to.not.be.null;

    const disconnectedResult = await disconnectedPromise;
    expect(disconnectedResult).to.not.be.null;
    expect(disconnectedResult.current).to.equal('disconnected');
    client.close();
  });

  /**
   * RTN26b - whenState waits for 'closed' terminal state
   *
   * Tests that whenState registered for 'closed' before closing the client
   * resolves with a ConnectionStateChange when the client transitions to closed.
   */
  // UTS: realtime/unit/RTN26b/deferred-callback-future-state-0.1
  it('RTN26b - whenState waits for closed state', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 7) {
          // CLOSE — respond with CLOSED
          mock.active_connection!.send_to_client({ action: 8 }); // CLOSED
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      // Register whenState for 'closed' while still connected
      client.connection.whenState('closed').then((change: any) => {
        // Should resolve with a ConnectionStateChange (not null)
        expect(change).to.not.be.null;
        expect(change.current).to.equal('closed');
        done();
      });

      // Initiate close — triggers transition through closing → closed
      client.close();
    });

    client.connect();
  });
});
