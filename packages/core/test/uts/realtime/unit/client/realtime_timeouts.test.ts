/**
 * UTS: Realtime Client Configured Timeouts
 *
 * Spec points: RTC7
 * Source: uts/test/realtime/unit/client/realtime_timeouts.md
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

/**
 * Helper: wait for connection state using real event loop.
 * Fake timers only replace Platform.Config — Node.js setTimeout still works.
 */
function waitForState(connection: any, state: any, timeoutMs: any) {
  return new Promise<void>((resolve, reject) => {
    if (connection.state === state) return resolve();
    const timer = setTimeout(() => reject(new Error(`Timeout waiting for state ${state}`)), timeoutMs || 5000);
    connection.once(state, () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * Helper: flush fake timers + real event loop to let connection establish.
 * ably-js uses Platform.Config.setTimeout(fn, 0) for scheduling and real
 * async chains for auth. This pumps both until the client connects.
 */
async function connectWithFakeTimers(client: any, clock: any) {
  client.connect();
  // Pump fake timers and real event loop in alternation
  for (let i = 0; i < 30; i++) {
    clock.tick(0);
    await flushAsync();
  }
}

describe('uts/realtime/unit/client/realtime_timeouts', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTC7 - default timeouts applied when not configured
   */
  // UTS: realtime/unit/RTC7/default-timeouts-applied-3
  it('RTC7 - default timeouts', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
    });
    trackClient(client);

    expect(client.options.timeouts.realtimeRequestTimeout).to.equal(10000);
    expect(client.options.timeouts.disconnectedRetryTimeout).to.equal(15000);
    expect(client.options.timeouts.suspendedRetryTimeout).to.equal(30000);
    expect(client.options.timeouts.httpRequestTimeout).to.equal(10000);
    // NOTE: UTS spec checks httpOpenTimeout == 4000.
    // ably-js uses webSocketSlowTimeout (4000) and webSocketConnectTimeout (10000) instead.
    expect(client.options.timeouts.webSocketSlowTimeout).to.equal(4000);
    expect(client.options.timeouts.webSocketConnectTimeout).to.equal(10000);
    client.close();
  });

  /**
   * RTC7 - custom realtimeRequestTimeout applied to channel attach
   *
   * When the server does not respond to ATTACH within the custom timeout,
   * the channel should transition to SUSPENDED (RTL4f).
   */
  // UTS: realtime/unit/RTC7/attach-request-timeout-0
  it('RTC7 - realtimeRequestTimeout on attach', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          // Do NOT respond — simulate timeout
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      realtimeRequestTimeout: 500,
    });
    trackClient(client);

    await connectWithFakeTimers(client, clock);
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-attach-timeout');
    const attachPromise = channel.attach();

    // Pump to let ATTACH message be sent
    for (let i = 0; i < 5; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // Advance past the custom timeout
    await clock.tickAsync(600);

    try {
      await attachPromise;
      expect.fail('Expected attach to fail');
    } catch (err) {
      expect(err).to.not.be.null;
    }

    // RTL4f: attach timeout → SUSPENDED
    expect(channel.state).to.equal('suspended');
    client.close();
  });

  /**
   * RTC7 - custom realtimeRequestTimeout applied to channel detach
   *
   * When the server does not respond to DETACH within the custom timeout,
   * the channel should return to ATTACHED (RTL5f).
   */
  // UTS: realtime/unit/RTC7/detach-request-timeout-1
  it('RTC7 - realtimeRequestTimeout on detach', async function () {
    let ignoreDetach = false;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg: any, conn: any) => {
        if (msg.action === 10) {
          // ATTACH
          conn.send_to_client({ action: 11, channel: msg.channel, flags: 0 }); // ATTACHED
        }
        if (msg.action === 12 && ignoreDetach) {
          // DETACH
          // Do NOT respond — simulate timeout
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      realtimeRequestTimeout: 500,
    });
    trackClient(client);

    await connectWithFakeTimers(client, clock);
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-detach-timeout');

    const attachPromise = channel.attach();
    // Pump to let ATTACH and ATTACHED messages flow
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    await attachPromise;

    // Now ignore DETACH messages
    ignoreDetach = true;

    const detachPromise = channel.detach();

    // Advance past the custom timeout
    await clock.tickAsync(600);

    try {
      await detachPromise;
      expect.fail('Expected detach to fail');
    } catch (err) {
      expect(err).to.not.be.null;
    }

    // RTL5f: detach timeout → back to ATTACHED
    expect(channel.state).to.equal('attached');
    client.close();
  });

  /**
   * RTC7 - custom disconnectedRetryTimeout controls reconnection delay
   *
   * After disconnect, RTN15a triggers an immediate retry. If that fails too,
   * the library waits disconnectedRetryTimeout before the next attempt.
   */
  // UTS: realtime/unit/RTC7/disconnected-retry-timeout-2
  it('RTC7 - disconnectedRetryTimeout controls retry delay', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        if (connectionAttemptCount === 1) {
          mock.active_connection = conn;
          conn.respond_with_connected({
            connectionDetails: { maxIdleInterval: 0, connectionStateTtl: 120000 } as any,
          });
        } else {
          // All subsequent attempts fail
          conn.respond_with_refused();
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Mock HTTP to prevent real network requests from connectivity checker
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
      disconnectedRetryTimeout: 2000,
      fallbackHosts: [],
    });
    trackClient(client);

    await connectWithFakeTimers(client, clock);
    expect(connectionAttemptCount).to.equal(1);

    // Force disconnection
    mock.active_connection!.simulate_disconnect();

    // Pump to process disconnect + immediate retry (RTN15a)
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const countAfterImmediate = connectionAttemptCount;

    // Advance less than custom timeout — no new retry yet
    await clock.tickAsync(1500);
    expect(connectionAttemptCount).to.equal(countAfterImmediate);

    // Advance past the custom timeout (2000ms total + margin)
    await clock.tickAsync(1500);

    // A new reconnection attempt should have been made
    expect(connectionAttemptCount).to.be.greaterThan(countAfterImmediate);
    client.close();
  });
});
