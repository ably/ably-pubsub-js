/**
 * UTS: Server-Initiated Re-authentication Tests
 *
 * Spec points: RTN22, RTN22a
 * Source: uts/test/realtime/unit/connection/server_initiated_reauth_test.md
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, trackClient, installMockWebSocket, restoreAll } from '../../../helpers';

describe('uts/realtime/unit/connection/server_initiated_reauth', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN22 - Server sends AUTH, client re-authenticates
   */
  // UTS: realtime/unit/RTN22/server-auth-triggers-reauth-0
  it('RTN22 - server AUTH triggers client reauth', function (done) {
    let authCallbackCount = 0;
    const capturedAuthMessages: any[] = [];

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
          // AUTH
          capturedAuthMessages.push(msg);
          // Respond with updated CONNECTED (same id/key)
          mock.active_connection!.send_to_client({
            action: 4, // CONNECTED
            connectionId: 'connection-id',
            connectionKey: 'connection-key',
            connectionDetails: {
              connectionKey: 'connection-key',
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
      const stateChanges: any[] = [];
      client.connection.on((change: any) => {
        stateChanges.push(change);
      });

      client.connection.on('update', () => {
        // authCallback was called twice: once for initial connect, once for reauth
        expect(authCallbackCount).to.equal(2);

        // Client sent AUTH message back
        expect(capturedAuthMessages).to.have.length(1);
        expect(capturedAuthMessages[0].auth).to.not.be.undefined;

        // Connection stayed CONNECTED throughout (no non-connected transitions)
        const nonConnected = stateChanges.filter((c: any) => c.current !== 'connected');
        expect(nonConnected).to.have.length(0);

        client.close();
        done();
      });

      // Server requests re-authentication
      mock.active_connection!.send_to_client({ action: 17 }); // AUTH
    });

    client.connect();
  });

  /**
   * RTN22 - Connection remains CONNECTED during server-initiated reauth
   */
  // UTS: realtime/unit/RTN22/stays-connected-during-reauth-1
  it('RTN22 - connection stays CONNECTED during reauth', function (done) {
    let authCallbackCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 17) {
          // AUTH
          mock.active_connection!.send_to_client({
            action: 4, // CONNECTED
            connectionId: 'conn-1',
            connectionKey: 'key-1',
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

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, `reauth-token-${authCallbackCount}`);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      const stateChanges: any[] = [];
      client.connection.on((change: any) => {
        stateChanges.push(change);
      });

      client.connection.on('update', () => {
        // Connection never left CONNECTED
        expect(client.connection.state).to.equal('connected');

        // Only an UPDATE event, no state change events to non-connected states
        expect(stateChanges).to.have.length(1);
        expect(stateChanges[0].current).to.equal('connected');
        expect(stateChanges[0].previous).to.equal('connected');

        client.close();
        done();
      });

      // Server sends AUTH
      mock.active_connection!.send_to_client({ action: 17 }); // AUTH
    });

    client.connect();
  });

  /**
   * RTN22a - Forced disconnect on reauth failure
   */
  // UTS: realtime/unit/RTN22a/forced-disconnect-reauth-failure-0
  it('RTN22a - forced disconnect with token error', function (done) {
    let authCallbackCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
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
        cb(null, `recovery-token-${authCallbackCount}`);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      client.connection.once('disconnected', (stateChange: any) => {
        expect(stateChange.reason).to.not.be.null;
        expect(stateChange.reason.code).to.equal(40142);
        done();
      });

      // Server forcibly disconnects with token error
      mock.active_connection!.send_to_client({
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
