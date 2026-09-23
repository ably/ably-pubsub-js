/**
 * UTS: Heartbeat Tests
 *
 * Spec points: RTN23a, RTN23b, RTN23c
 * Source: uts/test/realtime/unit/connection/heartbeat_test.md
 *
 * ably-js Node.js uses WebSocket ping frames (RTN23b) since the `ws` library
 * exposes them. It sends `heartbeats=false` in the connection URL; the browser,
 * React Native and NativeScript platforms send `heartbeats=bounce` (RTN23c).
 * The idle timer threshold is: maxIdleInterval + realtimeRequestTimeout.
 *
 * Both RTN23a (HEARTBEAT protocol messages) and RTN23b (ping frames)
 * are tested since the idle timer logic is the same — any activity resets it.
 *
 * Tests beyond the UTS spec (ably-js-specific):
 * - RTN23c - transportParams.heartbeats overrides the bounce default
 * - RTN23c1 - an unsolicited PONG is ignored
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import { actions } from '../../../../../src/common/lib/types/protocolmessagecommon';
import {
  Ably,
  Platform,
  trackClient,
  installMockWebSocket,
  installMockHttp,
  enableFakeTimers,
  restoreAll,
  flushAsync,
} from '../../../helpers';

async function pumpTimers(clock: any, iterations = 30) {
  for (let i = 0; i < iterations; i++) {
    clock.tick(0);
    await flushAsync();
  }
}

describe('uts/realtime/unit/connection/heartbeat', function () {
  afterEach(function () {
    restoreAll();
  });

  // --- RTN23a: URL parameter ---

  /**
   * RTN23a - heartbeats=true when ping frames not observable
   *
   * When the platform cannot observe WebSocket ping frames and cannot have its
   * code suspended while the socket stays alive, the client sends
   * heartbeats=true to request HEARTBEAT protocol messages.
   */
  // UTS: realtime/unit/RTN23a/heartbeats-true-query-param-0
  it('RTN23a - heartbeats=true in connection URL when ping frames not observable', function (done) {
    const saved = Platform.Config.websocketHeartbeatsParam;
    Platform.Config.websocketHeartbeatsParam = 'true';

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        const heartbeats = conn.url.searchParams.get('heartbeats');
        expect(heartbeats).to.equal('true');
        conn.respond_with_connected();
        Platform.Config.websocketHeartbeatsParam = saved;
        done();
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
  });

  /**
   * RTN23c - heartbeats=bounce on a platform which may suspend our code
   *
   * The browser and React Native platform configs set
   * websocketHeartbeatsParam to 'bounce'; this asserts that the value reaches
   * the connection URL. (These tests run on Node, whose own default is
   * 'false', so the config value is overridden for the duration.)
   */
  // UTS: realtime/unit/RTN23c/heartbeats-bounce-query-param-0
  it('RTN23c - heartbeats=bounce in connection URL', function (done) {
    const saved = Platform.Config.websocketHeartbeatsParam;
    Platform.Config.websocketHeartbeatsParam = 'bounce';

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        expect(conn.url.searchParams.get('heartbeats')).to.equal('bounce');
        conn.respond_with_connected();
        Platform.Config.websocketHeartbeatsParam = saved;
        done();
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
  });

  /**
   * RTC1f1 - a user-supplied transportParams.heartbeats wins over the
   * platform default, including over 'bounce'.
   */
  // ably-js-specific: not in the UTS spec
  it('RTN23c - transportParams.heartbeats overrides the bounce default', function (done) {
    const saved = Platform.Config.websocketHeartbeatsParam;
    Platform.Config.websocketHeartbeatsParam = 'bounce';

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        expect(conn.url.searchParams.get('heartbeats')).to.equal('true');
        conn.respond_with_connected();
        Platform.Config.websocketHeartbeatsParam = saved;
        done();
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      transportParams: { heartbeats: 'true' },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
  });

  // --- RTN23b: URL parameter ---

  /**
   * RTN23b - heartbeats=false when ping frames observable
   *
   * ably-js Node.js can observe ping frames via ws library's 'ping' event,
   * so it sends heartbeats=false in the connection URL.
   */
  // UTS: realtime/unit/RTN23b/heartbeats-false-query-param-0
  it('RTN23b - heartbeats=false in connection URL', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        const heartbeats = conn.url.searchParams.get('heartbeats');
        expect(heartbeats).to.equal('false');
        conn.respond_with_connected();
        done();
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
  });

  // --- RTN23a/b: Idle timer disconnect and reconnect ---
  // Note: RTN23a tests have flaked in the past (one-off failures in full suite runs
  // under heavy CPU load) but the issue has not been reproducible in isolation or
  // repeated full-suite runs. Likely a fake-timer + process.nextTick race under load.

  /**
   * RTN23a/b - Disconnect after maxIdleInterval + realtimeRequestTimeout
   */
  // UTS: realtime/unit/RTN23a/idle-timeout-reconnect-1
  it('RTN23a - disconnect after idle timeout', async function () {
    let connectionAttemptCount = 0;
    const stateChanges: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 5000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 2000,
      disconnectedRetryTimeout: 500,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');
    expect(connectionAttemptCount).to.equal(1);

    // Advance past idle timeout (maxIdleInterval + realtimeRequestTimeout + 100 = 7100ms)
    // Use small increments to avoid re-triggering after reconnect
    await clock.tickAsync(7200);
    await pumpTimers(clock);

    // Should have disconnected due to idle timeout
    expect(stateChanges).to.include('disconnected');

    // Advance past disconnectedRetryTimeout (500ms) to trigger reconnection
    await clock.tickAsync(600);
    await pumpTimers(clock);

    // Should have reconnected
    expect(connectionAttemptCount).to.equal(2);
    expect(client.connection.id).to.equal('connection-id-2');
    client.close();
  });

  /**
   * RTN23a - HEARTBEAT protocol message resets idle timer
   */
  // UTS: realtime/unit/RTN23a/heartbeat-resets-timer-2
  it('RTN23a - HEARTBEAT resets idle timer', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 3000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');
    expect(connectionAttemptCount).to.equal(1);

    // Advance 2000ms (within timeout of 3000+1000=4000ms)
    await clock.tickAsync(2000);
    await pumpTimers(clock);

    // Send HEARTBEAT from server — resets timer
    mock.active_connection!.send_to_client({ action: 0 }); // HEARTBEAT
    await pumpTimers(clock);

    // Advance another 2000ms (2000ms since HEARTBEAT, still within threshold)
    await clock.tickAsync(2000);
    await pumpTimers(clock);

    // Connection should still be alive
    expect(client.connection.state).to.equal('connected');
    expect(connectionAttemptCount).to.equal(1);

    // Advance past timeout (4100ms since last HEARTBEAT)
    await clock.tickAsync(2100);
    await pumpTimers(clock);

    // Should have reconnected
    expect(connectionAttemptCount).to.equal(2);
    client.close();
  });

  /**
   * RTN23a - Any protocol message resets idle timer
   */
  // UTS: realtime/unit/RTN23a/any-message-resets-timer-3
  it('RTN23a - any message resets idle timer', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 2000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(1);

    // Advance 1500ms (within timeout of 2000+1000=3000ms)
    await clock.tickAsync(1500);
    await pumpTimers(clock);

    // Send ACK from server — resets timer
    mock.active_connection!.send_to_client({ action: 1, msgSerial: 0 }); // ACK
    await pumpTimers(clock);

    // Advance 1500ms (still within threshold since ACK)
    await clock.tickAsync(1500);
    await pumpTimers(clock);

    // Still connected
    expect(client.connection.state).to.equal('connected');
    expect(connectionAttemptCount).to.equal(1);

    // Advance past timeout (3100ms since last activity)
    await clock.tickAsync(1600);
    await pumpTimers(clock);

    // Should have reconnected
    expect(connectionAttemptCount).to.equal(2);
    client.close();
  });

  /**
   * RTN23a - Heartbeat timeout triggers immediate reconnection
   */
  // UTS: realtime/unit/RTN23a/timeout-triggers-reconnect-4
  it('RTN23a - timeout triggers reconnection with state sequence', async function () {
    let connectionAttemptCount = 0;
    const stateChanges: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 2000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(1);

    // Advance past timeout (2000 + 1000 = 3000ms)
    await clock.tickAsync(3100);
    await pumpTimers(clock);

    // Verify disconnect → reconnect sequence
    expect(stateChanges).to.include('disconnected');
    expect(stateChanges).to.include('connected');
    expect(connectionAttemptCount).to.equal(2);
    expect(client.connection.id).to.equal('connection-id-2');
    client.close();
  });

  /**
   * RTN23a - Reconnection after timeout uses resume
   */
  // UTS: realtime/unit/RTN23a/reconnect-uses-resume-5
  it('RTN23a - reconnection after timeout uses resume', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 2000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    // Advance past timeout
    await clock.tickAsync(3100);
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(2);

    // First connection should not have resume
    const firstUrl = mock.connect_attempts[0].url;
    expect(firstUrl.searchParams.has('resume')).to.be.false;

    // Second connection should include resume with first connectionKey
    const secondUrl = mock.connect_attempts[1].url;
    expect(secondUrl.searchParams.get('resume')).to.equal('connection-key-1');
    client.close();
  });

  // --- RTN23b: Ping frame tests ---

  /**
   * RTN23b - Disconnect after idle timeout (no ping frames sent)
   */
  // UTS: realtime/unit/RTN23b/multiple-pings-keep-alive-6
  it('RTN23b - disconnect when no ping frames received', async function () {
    let connectionAttemptCount = 0;
    const stateChanges: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 5000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 2000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(1);

    // Advance past maxIdleInterval + realtimeRequestTimeout = 7000ms
    await clock.tickAsync(7100);
    await pumpTimers(clock);

    expect(stateChanges).to.include('disconnected');
    expect(connectionAttemptCount).to.equal(2);
    expect(client.connection.id).to.equal('connection-id-2');
    client.close();
  });

  /**
   * RTN23b - Ping frame resets idle timer
   */
  // UTS: realtime/unit/RTN23b/ping-frame-resets-timer-2
  it('RTN23b - ping frame resets idle timer', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 3000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(1);

    // Advance 2000ms (within timeout of 3000+1000=4000ms)
    await clock.tickAsync(2000);
    await pumpTimers(clock);

    // Send ping frame — resets timer
    mock.active_connection!.send_ping_frame();
    await pumpTimers(clock);

    // Advance 2000ms (since ping, still within threshold)
    await clock.tickAsync(2000);
    await pumpTimers(clock);

    // Still connected
    expect(client.connection.state).to.equal('connected');
    expect(connectionAttemptCount).to.equal(1);

    // Advance past timeout (4100ms since last ping)
    await clock.tickAsync(2100);
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(2);
    client.close();
  });

  /**
   * RTN23b - Protocol messages also reset timer (not just ping frames)
   */
  // UTS: realtime/unit/RTN23b/any-message-resets-timer-3
  it('RTN23b - protocol message resets idle timer', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 2000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    // Advance 1500ms
    await clock.tickAsync(1500);
    await pumpTimers(clock);

    // Send ping frame — resets timer
    mock.active_connection!.send_ping_frame();
    await pumpTimers(clock);

    // Advance 1500ms
    await clock.tickAsync(1500);
    await pumpTimers(clock);

    // Still connected
    expect(client.connection.state).to.equal('connected');

    // Send ATTACHED message — also resets timer
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-channel',
      flags: 0,
    });
    await pumpTimers(clock);

    // Advance 1500ms (since ATTACHED)
    await clock.tickAsync(1500);
    await pumpTimers(clock);

    // Still only one connection
    expect(connectionAttemptCount).to.equal(1);

    // Send another ping frame
    mock.active_connection!.send_ping_frame();
    await pumpTimers(clock);

    // Advance 1500ms
    await clock.tickAsync(1500);
    await pumpTimers(clock);
    expect(connectionAttemptCount).to.equal(1);

    // Now let it timeout (3100ms without activity)
    await clock.tickAsync(1600);
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(2);
    client.close();
  });

  /**
   * RTN23b - Ping frame timeout triggers immediate reconnection with resume
   */
  // UTS: realtime/unit/RTN23b/timeout-triggers-reconnect-4
  it('RTN23b - timeout triggers reconnection with resume', async function () {
    let connectionAttemptCount = 0;
    const stateChanges: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 2000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await pumpTimers(clock);

    // Advance past timeout
    await clock.tickAsync(3100);
    await pumpTimers(clock);

    // Verify state sequence
    expect(stateChanges).to.include('disconnected');
    expect(connectionAttemptCount).to.equal(2);

    // Verify resume param
    const secondUrl = mock.connect_attempts[1].url;
    expect(secondUrl.searchParams.get('resume')).to.equal('connection-key-1');
    client.close();
  });

  /**
   * RTN23b - Reconnect after ping timeout uses resume
   *
   * When a connection drops due to ping frame timeout (no activity within
   * maxIdleInterval + realtimeRequestTimeout), the reconnection attempt
   * must include the resume query parameter set to the previous connection's
   * connectionKey, enabling the server to resume the connection.
   */
  // UTS: realtime/unit/RTN23b/reconnect-uses-resume-5
  it('RTN23b - reconnect after ping timeout uses resume', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 2000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');
    expect(connectionAttemptCount).to.equal(1);

    // Advance past ping timeout (maxIdleInterval + realtimeRequestTimeout = 3000ms)
    await clock.tickAsync(3100);
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(2);

    // First connection should not have resume
    const firstUrl = mock.connect_attempts[0].url;
    expect(firstUrl.searchParams.has('resume')).to.be.false;

    // Second connection should include resume with first connectionKey
    const secondUrl = mock.connect_attempts[1].url;
    expect(secondUrl.searchParams.get('resume')).to.equal('connection-key-1');
    client.close();
  });

  /**
   * RTN23b - Multiple ping frames keep connection alive
   */
  // UTS: realtime/unit/RTN23b/idle-timeout-reconnect-1
  it('RTN23b - regular ping frames prevent timeout', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 2000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    // Send ping frames every 1500ms for 10+ seconds (timeout is 3000ms)
    for (let i = 0; i < 7; i++) {
      await clock.tickAsync(1500);
      await pumpTimers(clock);
      mock.active_connection!.send_ping_frame();
      await pumpTimers(clock);
      expect(client.connection.state).to.equal('connected');
    }

    // Connection stayed alive through all ping frames
    expect(connectionAttemptCount).to.equal(1);
    expect(client.connection.state).to.equal('connected');
    client.close();
  });

  // --- RTN23c1/c2: PING/PONG ---

  /**
   * RTN23c1/RTN23c2 - a PING is answered with a PONG echoing its id
   *
   * A PING with an id gets a PONG with the same id; a PING without one gets a
   * PONG without one. The PONG goes out on the transport the PING arrived on,
   * carries nothing else, and has no msgSerial since it is not acked (RTN7b).
   */
  // UTS: realtime/unit/RTN23c1/ping-pong-echo-id-0
  it('RTN23c1 - PING is answered with a PONG echoing its id', async function () {
    const fromClient: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => fromClient.push(msg),
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise((resolve) => client.connection.once('connected', resolve));

    mock.active_connection!.send_to_client({ action: actions.PING, id: 'ping-1' });
    await flushAsync();
    mock.active_connection!.send_to_client({ action: actions.PING });
    await flushAsync();

    // The client sent nothing but the two PONGs (e.g. no HEARTBEAT)
    expect(fromClient).to.have.lengthOf(2);
    const [pongWithId, pongWithoutId] = fromClient;

    expect(pongWithId.action).to.equal(actions.PONG);
    expect(pongWithId.id).to.equal('ping-1');

    expect(pongWithoutId.action).to.equal(actions.PONG);
    expect(pongWithoutId).to.not.have.property('id');

    for (const pong of fromClient) {
      expect(pong.msgSerial).to.be.undefined;
      expect(pong.channel).to.be.undefined;
      expect(pong.messages).to.be.undefined;
      expect(pong.presence).to.be.undefined;
    }

    client.close();
  });

  /**
   * RTN23c1 - the client answers a PING whatever heartbeats param it sent
   */
  // UTS: realtime/unit/RTN23c1/pong-regardless-of-heartbeats-param-1
  it('RTN23c1 - PING is answered even when heartbeats=false was sent', async function () {
    const fromClient: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        expect(conn.url.searchParams.get('heartbeats')).to.equal('false');
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => fromClient.push(msg),
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      transportParams: { heartbeats: 'false' },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise((resolve) => client.connection.once('connected', resolve));

    mock.active_connection!.send_to_client({ action: actions.PING, id: 'ping-id-2' });
    await flushAsync();

    expect(fromClient.filter((m) => m.action === actions.PONG).map((m) => m.id)).to.deep.equal(['ping-id-2']);

    client.close();
  });

  /**
   * RTN23a - a PING counts as activity and resets the idle timer
   */
  // UTS: realtime/unit/RTN23a/ping-resets-timer-6
  it('RTN23a - PING resets the idle timer', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `connection-id-${connectionAttemptCount}`,
          connectionDetails: {
            connectionKey: `connection-key-${connectionAttemptCount}`,
            maxIdleInterval: 3000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      realtimeRequestTimeout: 1000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');

    // Advance 2000ms (within the 3000+1000=4000ms threshold)
    await clock.tickAsync(2000);
    await pumpTimers(clock);

    mock.active_connection!.send_to_client({ action: actions.PING, id: 'ping-id-3' });
    await pumpTimers(clock);

    // 2000ms since the PING, still within the threshold if it reset the timer
    await clock.tickAsync(2000);
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');
    expect(connectionAttemptCount).to.equal(1);

    // Now let it expire (4100ms since the PING)
    await clock.tickAsync(2100);
    await pumpTimers(clock);

    expect(connectionAttemptCount).to.equal(2);
    client.close();
  });

  /**
   * RTN23c1 - an unsolicited PONG is ignored
   */
  // ably-js-specific: not in the UTS spec
  it('RTN23c1 - an unsolicited PONG is ignored', async function () {
    const stateChanges: string[] = [];

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

    client.connect();
    await new Promise((resolve) => client.connection.once('connected', resolve));
    client.connection.on((change: any) => stateChanges.push(change.current));

    mock.active_connection!.send_to_client({ action: actions.PONG, id: 'stray-pong' });
    await flushAsync();
    await flushAsync();

    expect(client.connection.state).to.equal('connected');
    expect(stateChanges).to.deep.equal([]);

    client.close();
  });
});
