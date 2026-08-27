/**
 * UTS: Realtime Connection Authentication Tests
 *
 * Spec points: RTN2e, RTN27b, RSA4c, RSA4c1, RSA4c2, RSA4c3, RSA4d, RSA8d, RSA12a
 * Source: uts/test/realtime/unit/auth/connection_auth_test.md
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, trackClient, installMockWebSocket, restoreAll, flushAsync, pollUntil } from '../../../helpers';

describe('uts/realtime/unit/auth/connection_auth', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN2e/RTN27b - Token obtained before WebSocket connection
   *
   * When authCallback is configured but no token is provided, the library must
   * obtain a token via the callback before opening the WebSocket connection.
   */
  // UTS: realtime/unit/RTN2e/token-before-websocket-0
  it('RTN2e/RTN27b - token obtained before WebSocket connection', function (done) {
    let callbackInvoked = false;
    let callbackInvokedTime: number | null = null;
    let connectionAttemptTime: number | null = null;
    let capturedWsUrl: string | null = null;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptTime = Date.now();
        capturedWsUrl = conn.url.toString();
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
        callbackInvoked = true;
        callbackInvokedTime = Date.now();
        cb(null, 'callback-provided-token');
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      expect(callbackInvoked).to.be.true;
      expect(callbackInvokedTime).to.not.be.null;
      expect(connectionAttemptTime).to.not.be.null;
      expect(callbackInvokedTime!).to.be.at.most(connectionAttemptTime!);

      expect(capturedWsUrl).to.not.be.null;
      expect(capturedWsUrl).to.include('access_token=callback-provided-token');
      expect(capturedWsUrl).to.not.include('key=');

      expect(client.connection.state).to.equal('connected');
      done();
    });

    client.connect();
  });

  /**
   * RTN2e/RTN27b - authCallback error prevents connection attempt
   *
   * If authCallback fails during initial token acquisition, the library
   * should NOT attempt to open a WebSocket connection.
   */
  // UTS: realtime/unit/RTN2e/callback-error-prevents-connect-1
  it('RTN2e/RTN27b - authCallback error prevents connection attempt', function (done) {
    let connectionAttempted = false;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttempted = true;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        cb(new Error('Auth callback failed'), null);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('disconnected', () => {
      expect(connectionAttempted).to.be.false;
      expect(client.connection.errorReason).to.not.be.null;
      done();
    });

    client.connection.once('failed', () => {
      expect(connectionAttempted).to.be.false;
      expect(client.connection.errorReason).to.not.be.null;
      done();
    });

    client.connect();
  });

  /**
   * RTN2e - authCallback TokenParams include clientId
   *
   * When invoking authCallback, the library passes TokenParams that include
   * any configured clientId (per RSA12a).
   */
  // UTS: realtime/unit/RTN2e/callback-params-include-clientid-2
  it('RTN2e - authCallback TokenParams include clientId', function (done) {
    let receivedParams: any = null;

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
        receivedParams = params;
        cb(null, 'token-for-client');
      },
      clientId: 'my-client-id',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      expect(receivedParams).to.not.be.null;
      expect(receivedParams.clientId).to.equal('my-client-id');
      done();
    });

    client.connect();
  });

  /**
   * RTN2e - Multiple connections reuse valid token
   *
   * If a valid (non-expired) token exists from a previous authCallback invocation,
   * it should be reused for subsequent connection attempts.
   */
  // UTS: realtime/unit/RTN2e/reuse-valid-token-3
  it('RTN2e - multiple connections reuse valid token', function (done) {
    let callbackCount = 0;

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
        callbackCount++;
        cb(null, {
          token: 'reusable-token',
          issued: Date.now(),
          expires: Date.now() + 3600000,
        });
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      client.close();
      client.connection.once('closed', () => {
        client.connect();
        client.connection.once('connected', () => {
          expect(callbackCount).to.equal(1);
          done();
        });
      });
    });

    client.connect();
  });

  /**
   * RSA4c2 - authCallback error during CONNECTING causes DISCONNECTED
   *
   * Per RSA4c: if authCallback errors during connection, and RSA4d does not
   * apply (not a 403), then:
   *   RSA4c1: errorReason set with code 80019, statusCode 401, cause = underlying error
   *   RSA4c2: connection transitions to DISCONNECTED
   */
  // UTS: realtime/unit/RSA4c2/callback-error-causes-disconnected-0
  it('RSA4c2 - authCallback error during CONNECTING causes DISCONNECTED', function (done) {
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
          cb(null, `token-${authCallbackCount}`);
        }
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('disconnected', (stateChange: any) => {
      // RSA4c1: errorReason has code 80019 wrapping the underlying cause
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(80019);
      expect(client.connection.errorReason!.statusCode).to.equal(401);

      // RSA4c1: cause set to the underlying error
      expect(client.connection.errorReason!.cause).to.not.be.null;
      expect((client.connection.errorReason!.cause as any).code).to.equal(50000);

      // RSA4c2: state change reason also has 80019
      expect(stateChange.reason).to.not.be.null;
      expect(stateChange.reason.code).to.equal(80019);

      done();
    });

    client.connect();
  });

  /**
   * RSA4c3 - authCallback error while CONNECTED
   *
   * Per RSA4c3: connection should remain CONNECTED. errorReason is NOT set —
   * the connection is healthy, the existing token is still valid, and there is
   * no state change to associate the error with (see specification#466).
   */
  // UTS: realtime/unit/RSA4c3/callback-error-stays-connected-0
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
          // AUTH — don't respond, the auth attempt will fail before this
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

    const stateChanges: any[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    // Server requests re-authentication (RTN22)
    mock.active_connection!.send_to_client({ action: 17 }); // AUTH

    // Wait for the auth callback to be called a second time (the failure)
    await pollUntil(() => authCallbackCount >= 2, 1000);

    // RSA4c3: connection should remain CONNECTED
    expect(client.connection.state).to.equal('connected');

    // No state changes at all — the auth failure is silently swallowed
    expect(stateChanges).to.have.length(0);

    // errorReason is NOT set (see specification#466)
    expect(client.connection.errorReason).to.be.null;
  });

  /**
   * RSA4d - authCallback 403 error during CONNECTING causes FAILED
   *
   * Per RSA4d: if authCallback returns statusCode 403, the connection
   * transitions to FAILED with code 80019 and statusCode 403.
   */
  // UTS: realtime/unit/RSA4d/callback-403-causes-failed-0
  it('RSA4d - authCallback 403 during CONNECTING causes FAILED', function (done) {
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
        cb({ code: 40300, statusCode: 403, message: 'Account disabled' }, null);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('failed', (stateChange: any) => {
      // RSA4d: FAILED with code 80019 and statusCode 403
      expect(client.connection.state).to.equal('failed');
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(80019);
      expect(client.connection.errorReason!.statusCode).to.equal(403);

      // Cause is the underlying 403 error
      expect(client.connection.errorReason!.cause).to.not.be.null;
      expect((client.connection.errorReason!.cause as any).code).to.equal(40300);

      done();
    });

    client.connect();
  });

  /**
   * RSA4d - authCallback 403 during RTN22 reauth causes FAILED
   *
   * Per RSA4d: 403 from authCallback during server-initiated reauth
   * causes FAILED, overriding RSA4c3's "stay CONNECTED" rule.
   */
  // UTS: realtime/unit/RSA4d/callback-403-reauth-causes-failed-1
  it('RSA4d - authCallback 403 during reauth causes FAILED', function (done) {
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
          cb(null, 'initial-token');
        } else {
          cb({ code: 40300, statusCode: 403, message: 'Account suspended' }, null);
        }
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      client.connection.once('failed', (stateChange: any) => {
        // RSA4d: FAILED with code 80019 and statusCode 403
        expect(client.connection.state).to.equal('failed');
        expect(client.connection.errorReason).to.not.be.null;
        expect(client.connection.errorReason!.code).to.equal(80019);
        expect(client.connection.errorReason!.statusCode).to.equal(403);

        // Cause is the underlying 403 error
        expect(client.connection.errorReason!.cause).to.not.be.null;
        expect((client.connection.errorReason!.cause as any).code).to.equal(40300);

        done();
      });

      // Server requests re-authentication (RTN22)
      mock.active_connection!.send_to_client({ action: 17 }); // AUTH
    });

    client.connect();
  });
});
