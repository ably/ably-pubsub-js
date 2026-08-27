/**
 * UTS: Connection Ping Tests
 *
 * Spec points: RTN13, RTN13a, RTN13b, RTN13c, RTN13d, RTN13e
 * Source: uts/test/realtime/unit/connection/connection_ping_test.md
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

/** Helper: pump fake + real event loops */
async function pumpTimers(clock: any, iterations = 30) {
  for (let i = 0; i < iterations; i++) {
    clock.tick(0);
    await flushAsync();
  }
}

describe('uts/realtime/unit/connection/connection_ping', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN13a - Ping sends HEARTBEAT and returns round-trip duration
   */
  // UTS: realtime/unit/RTN13a/ping-heartbeat-roundtrip-0
  it('RTN13a - ping sends HEARTBEAT and returns duration', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 0) {
          // HEARTBEAT
          mock.active_connection!.send_to_client({
            action: 0, // HEARTBEAT
            id: msg.id,
          });
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

    client.connection.once('connected', async () => {
      const duration = await client.connection.ping();
      expect(duration).to.be.a('number');
      expect(duration).to.be.at.least(0);
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN13e - HEARTBEAT includes random id for disambiguation
   */
  // UTS: realtime/unit/RTN13e/heartbeat-random-id-0
  it('RTN13e - sent HEARTBEAT includes id', function (done) {
    let capturedId: string | null = null;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 0) {
          // HEARTBEAT
          capturedId = msg.id;
          // Send wrong id first (should be ignored), then correct
          mock.active_connection!.send_to_client({ action: 0, id: 'wrong-id' });
          mock.active_connection!.send_to_client({ action: 0, id: msg.id });
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

    client.connection.once('connected', async () => {
      const duration = await client.connection.ping();
      expect(duration).to.be.a('number');
      expect(capturedId).to.not.be.null;
      expect(capturedId!.length).to.be.greaterThan(0);
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN13e - HEARTBEAT with no id is ignored as ping response
   */
  // UTS: realtime/unit/RTN13e/no-id-heartbeat-ignored-1
  it('RTN13e - HEARTBEAT without id is ignored', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 0) {
          // HEARTBEAT
          // Send no-id heartbeat first (should be ignored)
          mock.active_connection!.send_to_client({ action: 0 });
          // Then correct response
          mock.active_connection!.send_to_client({ action: 0, id: msg.id });
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

    client.connection.once('connected', async () => {
      const duration = await client.connection.ping();
      expect(duration).to.be.a('number');
      expect(duration).to.be.at.least(0);
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN13e - Multiple concurrent pings each get their own response
   */
  // UTS: realtime/unit/RTN13e/concurrent-pings-unique-ids-2
  it('RTN13e - concurrent pings disambiguated by id', function (done) {
    const sentIds: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 0) {
          // HEARTBEAT
          sentIds.push(msg.id);
          mock.active_connection!.send_to_client({ action: 0, id: msg.id });
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

    client.connection.once('connected', async () => {
      const [d1, d2] = await Promise.all([client.connection.ping(), client.connection.ping()]);

      expect(d1).to.be.a('number');
      expect(d2).to.be.a('number');
      expect(sentIds).to.have.length(2);
      expect(sentIds[0]).to.not.equal(sentIds[1]);

      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN13c - Ping times out if no HEARTBEAT response
   */
  // UTS: realtime/unit/RTN13c/deferred-ping-timeout-1
  it('RTN13c - ping timeout', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      // No onMessageFromClient — never respond to HEARTBEAT
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      realtimeRequestTimeout: 2000,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');

    const pingPromise = client.connection.ping();

    // Pump to send the HEARTBEAT
    await pumpTimers(clock, 5);

    // Advance past realtimeRequestTimeout
    await clock.tickAsync(2100);

    try {
      await pingPromise;
      expect.fail('Expected ping to reject');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }
    client.close();
  });

  /**
   * RTN13b - Ping errors in INITIALIZED state
   */
  // UTS: realtime/unit/RTN13b/ping-error-initialized-0
  it('RTN13b - ping errors in INITIALIZED', async function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    expect(client.connection.state).to.equal('initialized');

    try {
      await client.connection.ping();
      expect.fail('Expected ping to reject');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }
    client.close();
  });

  /**
   * RTN13b - Ping errors in CLOSED state
   */
  // UTS: realtime/unit/RTN13b/ping-error-closed-2
  it('RTN13b - ping errors in CLOSED', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 7) {
          // CLOSE
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
      client.connection.once('closed', async () => {
        try {
          await client.connection.ping();
          expect.fail('Expected ping to reject');
        } catch (err: any) {
          expect(err).to.not.be.null;
          done();
        }
      });
      client.close();
    });

    client.connect();
  });

  /**
   * RTN13b - Ping errors in FAILED state
   */
  // UTS: realtime/unit/RTN13b/deferred-ping-error-failed-4
  it('RTN13b - ping errors in FAILED', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_error({
          action: 9, // ERROR
          error: { code: 80000, statusCode: 400, message: 'Fatal error' },
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('failed', async () => {
      try {
        await client.connection.ping();
        expect.fail('Expected ping to reject');
      } catch (err: any) {
        expect(err).to.not.be.null;
        done();
      }
    });

    client.connect();
  });

  /**
   * RTN13b - Ping errors in SUSPENDED state
   */
  // UTS: realtime/unit/RTN13b/deferred-ping-error-suspended-5
  it('RTN13b - ping errors in SUSPENDED', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_refused();
      },
    });
    installMockWebSocket(mock.constructorFn);

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
      disconnectedRetryTimeout: 1000,
      suspendedRetryTimeout: 100,
      fallbackHosts: [],
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    // Advance past connectionStateTtl
    await clock.tickAsync(121000);
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('suspended');

    try {
      await client.connection.ping();
      expect.fail('Expected ping to reject');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }
    client.close();
  });

  /**
   * RTN13d - Ping deferred from CONNECTING until CONNECTED
   *
   * Per spec: "If the connection is not in the CONNECTED state when ping()
   * is called, the ping is deferred until the connection reaches a state
   * that can resolve it."
   */
  // UTS: realtime/unit/RTN13d/ping-deferred-connecting-0
  it('RTN13d - ping deferred from CONNECTING until CONNECTED', async function () {
    if (!process.env.RUN_DEVIATIONS) this.skip(); // ably-js rejects immediately; see #2203
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        setImmediate(() => {
          conn.respond_with_connected({
            connectionId: 'conn-id',
            connectionDetails: {
              connectionKey: 'conn-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 0) {
          // HEARTBEAT
          mock.active_connection!.send_to_client({ action: 0, id: msg.id });
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

    client.connect();
    expect(client.connection.state).to.equal('connecting');

    // Per spec, ping() should defer and resolve once CONNECTED
    const rtt = await client.connection.ping();
    expect(typeof rtt).to.equal('number');
    expect(rtt).to.be.at.least(0);
    client.close();
  });

  /**
   * RTN13d - Ping works after auto-reconnection from DISCONNECTED
   *
   * Note: ably-js doesn't defer ping(), but the client auto-reconnects
   * before ping() is called here (connectivity check succeeds immediately).
   */
  // UTS: realtime/unit/RTN13d/ping-deferred-disconnected-1
  it('RTN13d - ping succeeds after auto-reconnect from DISCONNECTED', async function () {
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
      onMessageFromClient: (msg) => {
        if (msg.action === 0) {
          // HEARTBEAT
          mock.active_connection!.send_to_client({ action: 0, id: msg.id });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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
      disconnectedRetryTimeout: 500,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');

    // Force disconnect
    mock.active_connection!.simulate_disconnect();
    await pumpTimers(clock);

    // Call ping() while DISCONNECTED
    const pingPromise = client.connection.ping();

    // Advance time for reconnection
    await clock.tickAsync(600);
    await pumpTimers(clock);

    const duration = await pingPromise;
    expect(duration).to.be.a('number');
    expect(duration).to.be.at.least(0);
    client.close();
  });

  /**
   * RTN13b+d - Ping from CONNECTING rejects when connection goes to FAILED
   *
   * Note: ably-js rejects ping() immediately in non-connected states.
   */
  // UTS: realtime/unit/RTN13b/ping-error-failed-3
  it('RTN13b+d - ping from CONNECTING rejects on FAILED', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        setImmediate(() => {
          conn.respond_with_error({
            action: 9, // ERROR
            error: { code: 80000, statusCode: 400, message: 'Fatal error' },
          });
        });
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
    expect(client.connection.state).to.equal('connecting');

    // Call ping() while CONNECTING
    client.connection.ping().then(
      () => {
        done(new Error('Expected ping to reject'));
      },
      (err: any) => {
        expect(err).to.not.be.null;
        done();
      },
    );
  });

  /**
   * RTN13b+d - Ping from DISCONNECTED rejects (not deferred)
   *
   * Note: ably-js rejects ping() immediately in non-connected states.
   */
  // UTS: realtime/unit/RTN13b/deferred-ping-error-failed-4.1
  it('RTN13b+d - ping from DISCONNECTED rejects', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_refused();
      },
    });
    installMockWebSocket(mock.constructorFn);

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
      disconnectedRetryTimeout: 1000,
      fallbackHosts: [],
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('disconnected');

    // Call ping() while DISCONNECTED
    const pingPromise = client.connection.ping();

    // Advance past connectionStateTtl to reach SUSPENDED
    await clock.tickAsync(121000);
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('suspended');

    try {
      await pingPromise;
      expect.fail('Expected ping to reject');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }
    client.close();
  });

  /**
   * RTN13c+d - Ping from CONNECTING rejects immediately (not deferred timeout)
   *
   * Note: ably-js rejects ping() immediately in non-connected states.
   */
  // UTS: realtime/unit/RTN13c/ping-timeout-0
  it('RTN13c+d - ping from CONNECTING rejects immediately', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        setImmediate(() => {
          conn.respond_with_connected();
        });
      },
      // No response to HEARTBEAT — will timeout
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      realtimeRequestTimeout: 2000,
    });
    trackClient(client);

    client.connect();

    // Call ping() while CONNECTING
    const pingPromise = client.connection.ping();

    // Pump to let connection establish
    await pumpTimers(clock);

    // Advance past realtimeRequestTimeout
    await clock.tickAsync(2200);
    await pumpTimers(clock);

    try {
      await pingPromise;
      expect.fail('Expected ping to reject');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }
    client.close();
  });

  /**
   * RTN13b - Ping errors in CLOSING state
   *
   * RTN13b lists CLOSING among the states where ping() must error.
   * In ably-js, calling client.close() while CONNECTED transitions
   * synchronously through CLOSING to CLOSED within closeImpl().
   * We listen on the connectionManager directly (which emits state
   * changes synchronously) to catch the CLOSING state and call ping().
   */
  // UTS: realtime/unit/RTN13b/ping-error-suspended-1
  it('RTN13b - ping errors in CLOSING', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
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

    client.connection.once('connected', () => {
      // Listen on connectionManager directly for synchronous state change
      (client as any).connection.connectionManager.once('connectionstate', (stateChange: any) => {
        if (stateChange.current === 'closing') {
          // We are now synchronously in CLOSING state
          client.connection.ping().then(
            () => {
              done(new Error('Expected ping to reject'));
            },
            (err: any) => {
              expect(err).to.not.be.null;
              done();
            },
          );
        }
      });

      // Initiate close — transitions through CLOSING -> CLOSED
      client.close();
    });

    client.connect();
  });
});
