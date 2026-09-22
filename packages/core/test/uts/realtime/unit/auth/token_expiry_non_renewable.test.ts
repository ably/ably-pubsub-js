/**
 * UTS: Token Expiry with Non-Renewable Token Tests
 *
 * Spec points: RSA4a, RSA4a1, RSA4a2
 * Source: specification/uts/realtime/unit/auth/token_expiry_non_renewable_test.md
 *
 * Tests behaviour when a token or tokenDetails is used to instantiate the
 * library without any means to renew the token (no API key, authCallback,
 * or authUrl). The library should warn at instantiation time and treat
 * subsequent token errors as fatal (no retry, transition to FAILED).
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, trackClient, installMockWebSocket, restoreAll, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/auth/token_expiry_non_renewable', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSA4a1 - Instantiation with non-renewable token logs info-level warning
   *
   * When a client is instantiated with only a token (no key, authCallback,
   * or authUrl), an info-level log message with error code 40171 should be
   * emitted, including a help URL per TI5.
   */
  // UTS: realtime/unit/RSA4a1/non-renewable-token-logs-warning-0
  it('RSA4a1 - non-renewable token logs info-level warning with code 40171', function () {
    const capturedLogMessages: Array<{ level: number; message: string }> = [];

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
      token: 'non-renewable-token',
      autoConnect: false,
      useBinaryProtocol: false,
      logHandler: (message: string, level: number) => {
        capturedLogMessages.push({ level, message });
      },
      logLevel: 4, // LOG_MICRO (ably-js uses numeric log levels: 0=NONE, 1=ERROR, 2=MAJOR, 3=MINOR, 4=MICRO)
    } as any);
    trackClient(client);

    // A log message with error code 40171 should have been emitted
    const has40171Message = capturedLogMessages.some(
      (m) => m.message.includes('40171') || (m.message.includes('no means') && m.message.includes('renew')),
    );
    expect(has40171Message).to.be.true;

    // TI5: log message should include the help URL
    const hasHelpUrl = capturedLogMessages.some((m) => m.message.includes('https://help.ably.io/error/40171'));
    expect(hasHelpUrl).to.be.true;
  });

  /**
   * RSA4a2 - Server token error with non-renewable token transitions to FAILED
   *
   * When the server responds with a token error (e.g. 40142 "Token expired")
   * and the client has no means to renew the token, the connection transitions
   * to FAILED with error code 40171.
   */
  // UTS: realtime/unit/RSA4a2/token-error-non-renewable-failed-0
  it('RSA4a2 - server token error with non-renewable token transitions to FAILED', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        // Server responds with token error (40142 = token expired)
        conn.respond_with_error({
          action: 9, // ERROR
          error: {
            code: 40142,
            statusCode: 401,
            message: 'Token expired',
          },
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      token: 'expired-token',
      autoConnect: false,
      useBinaryProtocol: false,
    } as any);
    trackClient(client);

    const stateChanges: any[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    client.connection.once('failed', () => {
      // Connection transitioned to FAILED (not DISCONNECTED -- no retry)
      expect(client.connection.state).to.equal('failed');

      // Error reason has code 40171 (non-renewable token error)
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(40171);

      // State change event also carries the error
      const failedChanges = stateChanges.filter((c: any) => c.current === 'failed');
      expect(failedChanges).to.have.length(1);
      expect(failedChanges[0].reason).to.not.be.null;
      expect(failedChanges[0].reason.code).to.equal(40171);

      done();
    });

    client.connect();
  });

  /**
   * RSA4a2 - Server token error with non-renewable token does not retry
   *
   * When a non-renewable token receives a token error, only one connection
   * attempt is made (no retry).
   */
  // UTS: realtime/unit/RSA4a2/token-error-non-renewable-no-retry-1
  it('RSA4a2 - server token error with non-renewable token does not retry', function (done) {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        // Always respond with token error
        conn.respond_with_error({
          action: 9, // ERROR
          error: {
            code: 40140,
            statusCode: 401,
            message: 'Token error',
          },
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      token: 'non-renewable-token',
      autoConnect: false,
      useBinaryProtocol: false,
    } as any);
    trackClient(client);

    client.connection.once('failed', () => {
      // Only one connection attempt was made (no retry)
      expect(connectionAttemptCount).to.equal(1);

      // Connection is in FAILED state
      expect(client.connection.state).to.equal('failed');

      // Error code is 40171
      expect(client.connection.errorReason).to.not.be.null;
      expect(client.connection.errorReason!.code).to.equal(40171);

      done();
    });

    client.connect();
  });
});
