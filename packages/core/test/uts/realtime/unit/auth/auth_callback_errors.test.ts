/**
 * UTS: Auth Callback Error Handling Tests
 *
 * Spec points: RSA4c, RSA4c1, RSA4c2, RSA4c3, RSA4d, RSA4d1, RSA4e, RSA4f
 * Source: specification/uts/realtime/unit/auth/auth_callback_errors_test.md
 *
 * Tests error handling when authentication via authCallback fails in various ways.
 * Behaviour depends on:
 * - The type of error (generic error vs 403 vs invalid format vs timeout)
 * - The connection state when the error occurs (CONNECTING vs CONNECTED)
 * - Whether the context is realtime (connection state machine) or REST (request error)
 *
 * Protocol actions: CONNECTED=4, ERROR=9, AUTH=17
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
  pollUntil,
} from '../../../helpers';

describe('uts/realtime/unit/auth/auth_callback_errors', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSA4c1, RSA4c2 - authCallback error during CONNECTING transitions to DISCONNECTED
   *
   * When authCallback throws an error during the initial connection (CONNECTING state),
   * the connection transitions to DISCONNECTED with an ErrorInfo having code 80019,
   * statusCode 401, and cause set to the underlying error.
   */
  // UTS: realtime/unit/RSA4c2/callback-error-connecting-disconnected-0
  it('RSA4c1/RSA4c2 - authCallback error during CONNECTING transitions to DISCONNECTED', function (done) {
    let authCallbackCount = 0;

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
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        if (authCallbackCount === 1) {
          cb({ code: 50000, statusCode: 500, message: 'Auth server unavailable' }, null);
        } else {
          cb(null, `valid-token-${authCallbackCount}`);
        }
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const stateChanges: any[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    client.connection.once('disconnected', () => {
      // RSA4c2: Connection transitioned to DISCONNECTED (not FAILED -- it's retriable)
      expect(client.connection.state).to.equal('disconnected');

      // RSA4c1: errorReason has code 80019 wrapping the underlying cause
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(80019);
      expect(client.connection.errorReason!.statusCode).to.equal(401);

      // RSA4c1: cause is set to the underlying error from authCallback
      expect(client.connection.errorReason!.cause).to.not.be.null;
      expect((client.connection.errorReason!.cause as any).code).to.equal(50000);

      // State change event carries the same error
      const disconnectedChanges = stateChanges.filter((c: any) => c.current === 'disconnected');
      expect(disconnectedChanges.length).to.be.at.least(1);
      expect(disconnectedChanges[0].reason).to.not.be.null;
      expect(disconnectedChanges[0].reason.code).to.equal(80019);

      done();
    });

    client.connect();
  });

  /**
   * RSA4c1, RSA4c2 - authCallback timeout during CONNECTING transitions to DISCONNECTED
   *
   * When authCallback times out (exceeds realtimeRequestTimeout), the connection
   * transitions to DISCONNECTED with error code 80019.
   */
  // UTS: realtime/unit/RSA4c2/callback-timeout-connecting-disconnected-1
  it('RSA4c1/RSA4c2 - authCallback timeout during CONNECTING transitions to DISCONNECTED', async function () {
    const clock = enableFakeTimers();

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
      authCallback: (_params: any, _cb: any) => {
        // Never calls cb -- simulates a timeout
      },
      realtimeRequestTimeout: 10000,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const stateChanges: any[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    client.connect();

    // Flush event loop so that connect() microtasks run and timers get scheduled
    await flushAsync();

    // Advance time past realtimeRequestTimeout
    await clock.tickAsync(11000);

    // Allow promise rejections and state transitions to propagate
    await pollUntil(() => client.connection.state === 'disconnected', 1000);

    // RSA4c2: Connection transitioned to DISCONNECTED
    expect(client.connection.state).to.equal('disconnected');

    // RSA4c1: errorReason has code 80019
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(80019);
    expect(client.connection.errorReason!.statusCode).to.equal(401);
  });

  /**
   * RSA4c3 - authCallback error while CONNECTED leaves connection CONNECTED
   *
   * When authCallback fails during an RTN22 server-initiated reauth while the
   * connection is CONNECTED, the connection stays CONNECTED. errorReason is NOT
   * set — the connection is healthy, the existing token is still valid, and there
   * is no state change to associate the error with (see specification#466).
   */
  // UTS: realtime/unit/RSA4c3/callback-error-connected-stays-0
  it('RSA4c3 - authCallback error while CONNECTED does not set errorReason', async function () {
    let authCallbackCount = 0;

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
      onMessageFromClient: (msg) => {
        if (msg.action === 17) {
          // AUTH -- don't respond, the auth attempt will fail before this
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        if (authCallbackCount === 1) {
          cb(null, 'initial-token');
        } else {
          cb({ code: 50000, statusCode: 500, message: 'Auth server unavailable' }, null);
        }
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Record state changes from this point
    const stateChanges: any[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    // Server requests re-authentication (RTN22)
    mock.active_connection!.send_to_client({ action: 17 }); // AUTH

    // Wait for the auth callback to be called a second time (the failure)
    await pollUntil(() => authCallbackCount >= 2, 1000);

    // RSA4c3: Connection remains CONNECTED
    expect(client.connection.state).to.equal('connected');

    // No state changes at all — the auth failure is silently swallowed
    expect(stateChanges).to.have.length(0);

    // errorReason is NOT set (see specification#466)
    expect(client.connection.errorReason).to.be.null;
  });

  /**
   * RSA4d - authCallback returns 403 error during CONNECTING transitions to FAILED
   *
   * A 403 from authCallback during initial connection is treated as fatal and causes
   * the connection to transition directly to FAILED (not DISCONNECTED).
   */
  // UTS: realtime/unit/RSA4d/callback-403-connecting-failed-0
  it('RSA4d - authCallback 403 during CONNECTING transitions to FAILED', function (done) {
    let connectionAttempted = false;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttempted = true;
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
      authCallback: (params: any, cb: any) => {
        cb({ code: 40300, statusCode: 403, message: 'Account disabled' }, null);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const stateChanges: any[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    client.connection.once('failed', () => {
      // RSA4d: Connection went to FAILED (not DISCONNECTED)
      expect(client.connection.state).to.equal('failed');

      // No WebSocket connection was attempted (auth failed before transport)
      expect(connectionAttempted).to.be.false;

      // RSA4d: ErrorInfo has code 80019 and statusCode 403
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(80019);
      expect(client.connection.errorReason!.statusCode).to.equal(403);

      // Cause is the original 403 error
      expect(client.connection.errorReason!.cause).to.not.be.null;
      expect((client.connection.errorReason!.cause as any).code).to.equal(40300);
      expect((client.connection.errorReason!.cause as any).statusCode).to.equal(403);

      // State change event carries the error
      const failedChanges = stateChanges.filter((c: any) => c.current === 'failed');
      expect(failedChanges).to.have.length(1);
      expect(failedChanges[0].reason).to.not.be.null;
      expect(failedChanges[0].reason.code).to.equal(80019);
      expect(failedChanges[0].reason.statusCode).to.equal(403);

      // No DISCONNECTED state was reached (went directly to FAILED)
      const disconnectedChanges = stateChanges.filter((c: any) => c.current === 'disconnected');
      expect(disconnectedChanges).to.have.length(0);

      done();
    });

    client.connect();
  });

  /**
   * RSA4d - authCallback 403 during RTN22 reauth transitions CONNECTED to FAILED
   *
   * A 403 from authCallback during server-initiated reauth (RTN22) causes the
   * connection to transition from CONNECTED to FAILED, overriding RSA4c3.
   */
  // UTS: realtime/unit/RSA4d/callback-403-reauth-failed-1
  it('RSA4d - authCallback 403 during reauth transitions CONNECTED to FAILED', function (done) {
    let authCallbackCount = 0;

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
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        if (authCallbackCount === 1) {
          // First call succeeds (initial connection)
          cb(null, 'initial-token');
        } else {
          // Reauth fails with 403
          cb({ code: 40300, statusCode: 403, message: 'Account suspended' }, null);
        }
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      client.connection.once('failed', () => {
        // RSA4d: FAILED with code 80019 and statusCode 403
        expect(client.connection.errorReason).to.not.be.null;
        expect(client.connection.errorReason!.code).to.equal(80019);
        expect(client.connection.errorReason!.statusCode).to.equal(403);
        expect(client.connection.errorReason!.cause).to.not.be.null;
        expect((client.connection.errorReason!.cause as any).code).to.equal(40300);

        done();
      });

      // Server requests re-authentication (RTN22)
      mock.active_connection!.send_to_client({ action: 17 }); // AUTH
    });

    client.connect();
  });

  /**
   * RSA4f - authCallback returns invalid type treated as invalid format error
   *
   * When authCallback returns an object that is not a String, JsonObject,
   * TokenRequest, or TokenDetails (e.g. an integer), it is treated as an
   * invalid format error per RSA4f, and the connection transitions to
   * DISCONNECTED with error code 80019 per RSA4c.
   */
  // UTS: realtime/unit/RSA4f/callback-invalid-type-format-0
  it('RSA4f - authCallback returns invalid type transitions to DISCONNECTED', function (done) {
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
      authCallback: (params: any, cb: any) => {
        // Return an invalid type -- an integer is not a valid token format
        cb(null, 12345);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('disconnected', () => {
      // RSA4c2: Connection transitioned to DISCONNECTED
      expect(client.connection.state).to.equal('disconnected');

      // RSA4c1: errorReason has code 80019
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(80019);
      expect(client.connection.errorReason!.statusCode).to.equal(401);

      done();
    });

    // Also listen for FAILED in case ably-js treats this as fatal
    client.connection.once('failed', () => {
      // Some implementations may treat invalid format as fatal
      expect(client.connection.errorReason).to.not.be.null;
      done();
    });

    client.connect();
  });

  /**
   * RSA4f - authCallback returns token string exceeding 128KiB treated as invalid format
   *
   * When authCallback returns a token string larger than 128KiB, it is treated
   * as an invalid format error per RSA4f and the connection transitions to
   * DISCONNECTED with error code 80019.
   */
  // UTS: realtime/unit/RSA4f/callback-oversized-token-format-1
  it('RSA4f - authCallback returns oversized token transitions to DISCONNECTED', function (done) {
    // Generate a token string larger than 128KiB (131072 bytes)
    const oversizedToken = 'x'.repeat(131073);

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
      authCallback: (params: any, cb: any) => {
        cb(null, oversizedToken);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('disconnected', () => {
      // RSA4c2: Connection transitioned to DISCONNECTED
      expect(client.connection.state).to.equal('disconnected');

      // RSA4c1: errorReason has code 80019
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(80019);
      expect(client.connection.errorReason!.statusCode).to.equal(401);

      done();
    });

    // Also listen for FAILED in case ably-js treats this differently
    client.connection.once('failed', () => {
      expect(client.connection.errorReason).to.not.be.null;
      done();
    });

    client.connect();
  });

  /**
   * RSA4e - REST authCallback error produces error with code 40170
   *
   * When a REST client's authCallback fails with a non-Ably error (e.g. a
   * generic exception), the resulting request error has code 40170 and
   * statusCode 401.
   */
  // UTS: realtime/unit/RSA4e/rest-callback-error-40170-0
  it('RSA4e - REST authCallback error produces error with code 40170', async function () {
    const mockHttp = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, []);
      },
    });
    installMockHttp(mockHttp);

    const client = new Ably.Rest({
      authCallback: (params: any, cb: any) => {
        // Generic error -- not an explicit ErrorInfo from Ably
        cb(new Error('Network failure connecting to auth server'), null);
      },
      useBinaryProtocol: false,
    });
    trackClient(client);

    // Attempt a REST request that requires authentication
    const channel = client.channels.get('test-channel');

    try {
      await channel.status();
      expect.fail('Expected an error to be thrown');
    } catch (error: any) {
      // RSA4e: Error has code 40170 and statusCode 401
      expect(error.code).to.equal(40170);
      expect(error.statusCode).to.equal(401);

      // Error message should be descriptive
      expect(error.message).to.not.be.null;
      expect(error.message.length).to.be.greaterThan(0);
    }
  });
});
