/**
 * UTS: Connection errorReason Tests
 *
 * Spec points: RTN25
 * Source: uts/test/realtime/unit/connection/error_reason_test.md
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
} from '../../../helpers';

describe('uts/realtime/unit/connection/error_reason', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN25 - errorReason set on connection errors (FAILED state)
   */
  // UTS: realtime/unit/RTN25/error-reason-on-failed-0.1
  it('RTN25 - errorReason set on fatal error', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_error({
          action: 9, // ERROR
          error: { code: 40005, statusCode: 400, message: 'Invalid API key' },
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'invalid.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    // Initially errorReason should be null
    expect(client.connection.errorReason).to.be.null;

    client.connection.once('failed', () => {
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(40005);
      expect(client.connection.errorReason!.statusCode).to.equal(400);
      done();
    });

    client.connect();
  });

  /**
   * RTN25 - errorReason on DISCONNECTED state
   */
  // UTS: realtime/unit/RTN25/error-reason-disconnected-1
  it('RTN25 - errorReason set on DISCONNECTED', function (done) {
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

    client.connection.once('disconnected', () => {
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.message).to.be.a('string');
      done();
    });

    client.connect();
  });

  /**
   * RTN25 - errorReason on SUSPENDED state
   */
  // UTS: realtime/unit/RTN25/error-reason-suspended-2
  it('RTN25 - errorReason set on SUSPENDED', async function () {
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
      disconnectedRetryTimeout: 500,
      connectionStateTtl: 2000,
      fallbackHosts: [],
    } as any);
    trackClient(client);

    client.connect();

    // Advance past connectionStateTtl (2s) in small increments
    for (let i = 0; i < 10; i++) {
      await clock.tickAsync(500);
      if (client.connection.state === 'suspended') break;
    }

    expect(client.connection.state).to.equal('suspended');
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.message).to.be.a('string');
    client.close();
  });

  /**
   * RTN25/RTN14b/RSA4a - errorReason on token error with no renewal
   *
   * Per RTN14b: token ERROR during connection, no means to renew → RSA4a applies.
   * Per RSA4a2: transition to FAILED with error code 40171.
   */
  // UTS: realtime/unit/RTN25/error-reason-token-error-3
  it('RTN25 - errorReason on token error (non-renewable)', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_error({
          action: 9, // ERROR
          error: { code: 40142, statusCode: 401, message: 'Token expired' },
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      token: 'expired_token',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    // Per RSA4a2: no means to renew → FAILED state with error code 40171
    client.connection.once('failed', () => {
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(40171);
      done();
    });

    client.connect();
  });

  /**
   * RTN25 - errorReason cleared on successful reconnection
   */
  // UTS: realtime/unit/RTN25/error-reason-cleared-on-connect-4
  it('RTN25 - errorReason cleared on successful reconnect', function (done) {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        if (connectionAttemptCount === 1) {
          conn.respond_with_refused();
        } else {
          conn.respond_with_connected();
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
      disconnectedRetryTimeout: 15,
      fallbackHosts: [],
    });
    trackClient(client);

    client.connection.once('disconnected', function () {
      try {
        expect(client.connection.errorReason).to.not.be.null;
      } catch (err) {
        return done(err);
      }

      client.connection.once('connected', function () {
        try {
          expect(client.connection.errorReason).to.be.null;
          client.close();
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    client.connect();
  });

  /**
   * RTN25 - errorReason on protocol-level ERROR message
   */
  // UTS: realtime/unit/RTN25/error-reason-protocol-error-5
  it('RTN25 - errorReason on protocol ERROR message', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_error({
          action: 9, // ERROR
          error: { code: 50000, statusCode: 500, message: 'Internal server error' },
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

    client.connection.once('failed', () => {
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(50000);
      expect(client.connection.errorReason!.statusCode).to.equal(500);
      expect(client.connection.errorReason!.message).to.contain('Internal server error');
      done();
    });

    client.connect();
  });

  /**
   * RTN25 - errorReason propagated to ConnectionStateChange events
   */
  // UTS: realtime/unit/RTN25/error-reason-in-state-change-6
  it('RTN25 - errorReason in ConnectionStateChange', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_error({
          action: 9, // ERROR
          error: { code: 40003, statusCode: 400, message: 'Access token invalid' },
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

    client.connection.once('failed', (stateChange: any) => {
      // State change has reason populated
      expect(stateChange.reason).to.not.be.null;
      expect(stateChange.reason.code).to.equal(40003);
      expect(stateChange.reason.statusCode).to.equal(400);

      // Connection errorReason matches state change reason
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(stateChange.reason.code);
      done();
    });

    client.connect();
  });

  /**
   * RTN25/RTN15h1 - errorReason set on token error while connected (non-renewable)
   *
   * Per RTN15h1: If a DISCONNECTED message contains a token error and there is
   * no means to renew the token, the connection transitions to FAILED and
   * Connection#errorReason is set. This tests that errorReason captures the
   * token error details in this scenario.
   */
  // UTS: realtime/unit/RTN25/error-reason-on-failed-0
  it('RTN25 - errorReason set on token error while connected (RTN15h1)', function (done) {
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
      client.connection.once('failed', (stateChange: any) => {
        // errorReason is set (RTN25)
        expect(client.connection.errorReason).to.not.be.null;
        // Per RSA4a: non-renewable token error is wrapped with code 40171
        expect(client.connection.errorReason!.code).to.equal(40171);

        // State change reason also populated
        expect(stateChange.reason).to.not.be.null;
        expect(stateChange.reason.code).to.equal(40171);
        done();
      });

      // Server sends DISCONNECTED with token error while connected
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
