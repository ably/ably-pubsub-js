/**
 * UTS: Connection Failures When Connected Tests
 *
 * Spec points: RTN14h, RTN15a, RTN15b, RTN15c4, RTN15c5, RTN15c6, RTN15c7, RTN15e, RTN15h1, RTN15h2, RTN15h3, RTN15j
 * Source: uts/test/realtime/unit/connection/connection_failures_test.md
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

async function pumpTimers(clock: any, iterations = 30) {
  for (let i = 0; i < iterations; i++) {
    clock.tick(0);
    await flushAsync();
  }
}

describe('uts/realtime/unit/connection/connection_failures', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN15a - Unexpected transport disconnect triggers resume
   */
  // UTS: realtime/unit/RTN15a/unexpected-transport-disconnect-0
  it('RTN15a - unexpected disconnect triggers resume', function (done) {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        conn.respond_with_connected({
          connectionId: 'connection-1',
          connectionDetails: {
            connectionKey: 'key-1',
            maxIdleInterval: 15000,
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

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    let sawDisconnected = false;
    client.connection.on('disconnected', () => {
      sawDisconnected = true;
    });

    client.connection.once('connected', () => {
      const originalId = client.connection.id;

      // Listen for reconnection
      client.connection.on('connected', () => {
        expect(client.connection.state).to.equal('connected');
        expect(client.connection.id).to.equal(originalId);
        expect(connectionAttemptCount).to.equal(2);
        expect(sawDisconnected).to.be.true;
        done();
      });

      // Unexpected disconnect
      mock.active_connection!.simulate_disconnect();
    });

    client.connect();
  });

  /**
   * RTN15b, RTN15c6 - Successful resume preserves connectionId, uses resume param
   */
  // UTS: realtime/unit/RTN15b/successful-resume-0
  it('RTN15b, RTN15c6 - successful resume with connectionKey in URL', function (done) {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else {
          // Resume succeeds (same connectionId)
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1-updated',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      expect(client.connection.id).to.equal('connection-1');

      client.connection.on('connected', () => {
        // Connection resumed (same ID)
        expect(client.connection.id).to.equal('connection-1');
        // Connection key updated (RTN15e)
        expect(client.connection.key).to.equal('key-1-updated');

        // Second connection attempt included resume parameter
        const resumeConn = mock.connect_attempts[1];
        expect(resumeConn.url.searchParams.get('resume')).to.equal('key-1');

        expect(connectionAttemptCount).to.equal(2);
        done();
      });

      mock.active_connection!.simulate_disconnect();
    });

    client.connect();
  });

  /**
   * RTN15e - Connection key updated on resume
   *
   * Per spec: When connection is resumed, Connection.key may change and is
   * provided in CONNECTED message connectionDetails.
   */
  // UTS: realtime/unit/RTN15e/connection-key-updated-0
  it('RTN15e - connection key updated on resume', function (done) {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else {
          // Resume succeeds with updated key
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1-updated',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      expect(client.connection.key).to.equal('key-1');

      client.connection.on('connected', () => {
        // Connection key should be updated after resume
        expect(client.connection.key).to.equal('key-1-updated');
        // Connection ID preserved (successful resume)
        expect(client.connection.id).to.equal('connection-1');
        done();
      });

      mock.active_connection!.simulate_disconnect();
    });

    client.connect();
  });

  /**
   * RTN15c7 - Failed resume (new connectionId) resets state
   *
   * Per spec: CONNECTED with new connectionId and ErrorInfo in error field.
   * The error should be set as Connection#errorReason and as the reason
   * in the CONNECTED event.
   */
  // UTS: realtime/unit/RTN15c7/failed-resume-new-id-0
  it('RTN15c7 - failed resume gets new connectionId', function (done) {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else {
          // Resume failed: new connectionId + error
          conn.respond_with_connected({
            connectionId: 'connection-2',
            connectionDetails: {
              connectionKey: 'key-2',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            },
            error: {
              code: 80008,
              statusCode: 400,
              message: 'Unable to recover connection',
            },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      const originalId = client.connection.id;
      expect(originalId).to.equal('connection-1');

      client.connection.on('connected', (stateChange: any) => {
        // New connection (different ID = failed resume)
        expect(client.connection.id).to.equal('connection-2');
        expect(client.connection.id).to.not.equal(originalId);
        expect(client.connection.key).to.equal('key-2');
        expect(client.connection.state).to.equal('connected');

        // Error reason set from failed resume
        expect(client.connection.errorReason).to.not.be.null;
        expect(client.connection.errorReason!.code).to.equal(80008);

        // CONNECTED event should carry the error as reason
        expect(stateChange.reason).to.not.be.null;
        expect(stateChange.reason.code).to.equal(80008);
        done();
      });

      mock.active_connection!.simulate_disconnect();
    });

    client.connect();
  });

  /**
   * RTN14h - reconnection attempts continue to attempt a resume even after the
   * connectionStateTtl has expired and the connection has become SUSPENDED
   *
   * This replaces RTN15g (deleted in specification version 6.1.0): the client
   * no longer discards its connection state based on how long it has been
   * disconnected. It always attempts to resume and lets the server decide
   * whether continuity can be preserved.
   */
  // UTS: realtime/unit/RTN14h/resume-after-ttl-0
  it('RTN14h - reconnection still attempts resume after connectionStateTtl expires', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 5000, // Short TTL for testing
            } as any,
          });
        } else {
          // All reconnection attempts fail, so the connection stays suspended
          conn.respond_with_refused();
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

    const stateChanges: string[] = [];
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      disconnectedRetryTimeout: 1000,
      suspendedRetryTimeout: 2000,
      autoConnect: false,
      useBinaryProtocol: false,
      fallbackHosts: [],
    });
    trackClient(client);

    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');

    // Force disconnect
    mock.active_connection!.simulate_disconnect();

    // Advance time well past the connectionStateTtl so the connection becomes
    // suspended and then keeps attempting to reconnect.
    for (let i = 0; i < 15; i++) {
      await clock.tickAsync(2500);
      await pumpTimers(clock);
    }

    // Verify the connection became suspended
    expect(stateChanges).to.include('suspended');

    // Every reconnection attempt after the first should still attempt a resume,
    // carrying the original connectionKey, even those made after the TTL expired
    // and the connection became suspended.
    const reconnectAttempts = mock.connect_attempts.slice(1);
    expect(reconnectAttempts.length).to.be.greaterThan(0);
    for (const attempt of reconnectAttempts) {
      expect(attempt.url.searchParams.get('resume')).to.equal('key-1');
    }
    client.close();
  });

  /**
   * RTN15h1 - DISCONNECTED with token error, no means to renew → FAILED
   */
  // UTS: realtime/unit/RTN15h1/token-error-no-renew-0
  it('RTN15h1 - token error without renewal causes FAILED', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      token: 'some_token_string',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      client.connection.once('failed', () => {
        expect(client.connection.state).to.equal('failed');
        expect(client.connection.errorReason).to.not.be.null;
        done();
      });

      // Server sends DISCONNECTED with token error
      mock.active_connection!.send_to_client_and_close({
        action: 6, // DISCONNECTED
        error: {
          message: 'Token expired',
          code: 40142,
          statusCode: 401,
        },
      });
    });

    client.connect();
  });

  /**
   * RTN15h2 - DISCONNECTED with token error, renewable token → reconnect
   */
  // UTS: realtime/unit/RTN15h2/token-error-renew-success-0
  it('RTN15h2 - token error with renewal reconnects', function (done) {
    let connectionAttemptCount = 0;
    let authCallbackCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else {
          // Resume after token renewal
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1-renewed',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, `token-${authCallbackCount}`);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      const firstId = client.connection.id;

      client.connection.on('connected', () => {
        expect(client.connection.state).to.equal('connected');
        // Token was renewed (authCallback called again)
        expect(authCallbackCount).to.be.at.least(2);
        expect(connectionAttemptCount).to.equal(2);
        done();
      });

      // Server sends DISCONNECTED with token error
      mock.active_connection!.send_to_client_and_close({
        action: 6, // DISCONNECTED
        error: {
          message: 'Token expired',
          code: 40142,
          statusCode: 401,
        },
      });
    });

    client.connect();
  });

  /**
   * RTN15h3 - DISCONNECTED with non-token error → immediate resume
   */
  // UTS: realtime/unit/RTN15h3/non-token-error-resume-0
  it('RTN15h3 - non-token disconnect triggers resume', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else {
          // Resume succeeds (same ID)
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
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
      disconnectedRetryTimeout: 100,
      fallbackHosts: [],
    });
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');
    const originalId = client.connection.id;

    // Server sends DISCONNECTED with non-token error
    mock.active_connection!.send_to_client_and_close({
      action: 6, // DISCONNECTED
      error: {
        message: 'Service unavailable',
        code: 80003,
        statusCode: 503,
      },
    });

    // Advance past retry timeout
    await clock.tickAsync(200);
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.equal(originalId);
    expect(connectionAttemptCount).to.equal(2);
    client.close();
  });

  /**
   * RTN15c4 - Fatal ERROR during resume → FAILED
   */
  // UTS: realtime/unit/RTN15c4/fatal-error-during-resume-0
  it('RTN15c4 - fatal error during resume causes FAILED', function (done) {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else {
          // Resume attempt fails with fatal error
          conn.respond_with_error({
            action: 9, // ERROR
            error: { code: 50000, statusCode: 500, message: 'Internal server error' },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      client.connection.once('failed', () => {
        expect(client.connection.state).to.equal('failed');
        expect(client.connection.errorReason).to.not.be.null;
        expect(client.connection.errorReason!.code).to.equal(50000);
        expect(connectionAttemptCount).to.equal(2);
        done();
      });

      mock.active_connection!.simulate_disconnect();
    });

    client.connect();
  });

  /**
   * RTN15c5 - Token error during resume triggers renewal
   */
  // UTS: realtime/unit/RTN15c5/token-error-during-resume-0
  it('RTN15c5 - token error during resume triggers renewal', function (done) {
    let connectionAttemptCount = 0;
    let authCallbackCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_connected({
            connectionId: 'connection-1',
            connectionDetails: {
              connectionKey: 'key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else if (connectionAttemptCount === 2) {
          // Resume attempt fails with token error
          conn.respond_with_error({
            action: 9, // ERROR
            error: { code: 40142, statusCode: 401, message: 'Token expired' },
          });
        } else {
          // Retry with renewed token succeeds
          conn.respond_with_connected({
            connectionId: 'connection-2',
            connectionDetails: {
              connectionKey: 'key-2',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, `token-${authCallbackCount}`);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      // Track all subsequent connected events
      client.connection.on('connected', () => {
        expect(client.connection.state).to.equal('connected');
        // Token was renewed
        expect(authCallbackCount).to.be.at.least(2);
        // Three connection attempts: initial, failed resume, retry
        expect(connectionAttemptCount).to.equal(3);
        done();
      });

      mock.active_connection!.simulate_disconnect();
    });

    client.connect();
  });

  /**
   * RTN15j - ERROR with empty channel when CONNECTED → FAILED
   */
  // UTS: realtime/unit/RTN15j/error-empty-channel-failed-0
  it('RTN15j - connection-level ERROR causes FAILED', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
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

    client.connection.once('connected', () => {
      client.connection.once('failed', () => {
        expect(client.connection.state).to.equal('failed');
        expect(client.connection.errorReason).to.not.be.null;
        expect(client.connection.errorReason!.code).to.equal(50000);
        expect(client.connection.errorReason!.statusCode).to.equal(500);
        done();
      });

      // Connection-level ERROR (no channel)
      mock.active_connection!.send_to_client({
        action: 9, // ERROR
        error: { code: 50000, statusCode: 500, message: 'Internal error' },
      });
    });

    client.connect();
  });

  /**
   * RTN15h2 - DISCONNECTED with token error, renewal fails → DISCONNECTED
   *
   * Per spec: If the DISCONNECTED message contains a token error and the library
   * has the means to renew the token, but the token creation fails, the connection
   * must transition to the DISCONNECTED state and set Connection#errorReason.
   */
  // UTS: realtime/unit/RTN15h2/token-error-renew-fails-1
  it('RTN15h2 - token error with renewal failure causes DISCONNECTED', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;

        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    let authCallbackCount = 0;
    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        if (authCallbackCount <= 1) {
          // First call succeeds (initial connection)
          cb(null, `token-${authCallbackCount}`);
        } else {
          // Subsequent calls fail (renewal failure)
          cb(new Ably.ErrorInfo('Invalid credentials', 40101, 401));
        }
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      // Track state changes after initial connection to find the DISCONNECTED
      // state that occurs after the failed token renewal (not the brief
      // transient DISCONNECTED that may occur per RTN15h2i).
      const statesAfterConnect: string[] = [];
      client.connection.on((change: any) => {
        statesAfterConnect.push(change.current);

        // We expect: possibly disconnected (transient), connecting (renewal attempt),
        // then disconnected (renewal failed). Wait for the pattern:
        // ...connecting... then disconnected.
        if (change.current === 'disconnected' && statesAfterConnect.includes('connecting')) {
          expect(client.connection.state).to.equal('disconnected');
          expect(client.connection.errorReason).to.not.be.null;
          done();
        }
      });

      // Server sends DISCONNECTED with token error and closes connection
      mock.active_connection!.send_to_client_and_close({
        action: 6, // DISCONNECTED
        error: {
          message: 'Token expired',
          code: 40142,
          statusCode: 401,
        },
      });
    });

    client.connect();
  });
});
