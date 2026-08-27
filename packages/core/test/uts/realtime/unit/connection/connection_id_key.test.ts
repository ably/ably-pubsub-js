/**
 * UTS: Connection ID and Key Tests
 *
 * Spec points: RTN8, RTN8a, RTN8b, RTN8c, RTN8d, RTN9, RTN9a, RTN9b, RTN9c, RTN9d
 * Source: uts/test/realtime/unit/connection/connection_id_key_test.md
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

describe('uts/realtime/unit/connection/connection_id_key', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN8a - Connection ID is unset until connected
   */
  // UTS: realtime/unit/RTN8a/id-unset-until-connected-0
  it('RTN8a - connection.id is null before connected', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_connected({
          connectionId: 'unique-conn-id-1',
          connectionDetails: {
            connectionKey: 'conn-key-1',
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

    // Before connecting, id should be undefined/null
    expect(client.connection.id).to.not.be.ok;

    client.connection.once('connected', () => {
      expect(client.connection.id).to.equal('unique-conn-id-1');
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN9a - Connection key is unset until connected
   */
  // UTS: realtime/unit/RTN9a/key-unset-until-connected-0
  it('RTN9a - connection.key is null before connected', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_connected({
          connectionId: 'unique-conn-id-1',
          connectionDetails: {
            connectionKey: 'conn-key-1',
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

    expect(client.connection.key).to.not.be.ok;

    client.connection.once('connected', () => {
      expect(client.connection.key).to.equal('conn-key-1');
      client.close();
      done();
    });

    client.connect();
  });

  /**
   * RTN8b - Connection ID is unique per connection
   */
  // UTS: realtime/unit/RTN8b/id-unique-per-connection-0
  it('RTN8b - connection.id is unique per client', function (done) {
    let connectionCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionCount++;
        conn.respond_with_connected({
          connectionId: `conn-id-${connectionCount}`,
          connectionDetails: {
            connectionKey: `conn-key-${connectionCount}`,
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client1 = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client1);

    const client2 = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client2);

    client1.connection.once('connected', () => {
      client2.connection.once('connected', () => {
        expect(client1.connection.id).to.not.equal(client2.connection.id);
        expect(client1.connection.id).to.equal('conn-id-1');
        expect(client2.connection.id).to.equal('conn-id-2');
        client1.close();
        client2.close();
        done();
      });
      client2.connect();
    });

    client1.connect();
  });

  /**
   * RTN9b - Connection key is unique per connection
   */
  // UTS: realtime/unit/RTN9b/key-unique-per-connection-0
  it('RTN9b - connection.key is unique per client', function (done) {
    let connectionCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionCount++;
        conn.respond_with_connected({
          connectionId: `conn-id-${connectionCount}`,
          connectionDetails: {
            connectionKey: `conn-key-${connectionCount}`,
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client1 = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client1);

    const client2 = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client2);

    client1.connection.once('connected', () => {
      client2.connection.once('connected', () => {
        expect(client1.connection.key).to.not.equal(client2.connection.key);
        expect(client1.connection.key).to.equal('conn-key-1');
        expect(client2.connection.key).to.equal('conn-key-2');
        client1.close();
        client2.close();
        done();
      });
      client2.connect();
    });

    client1.connect();
  });

  /**
   * RTN8c - Connection ID is null in CLOSED state
   */
  // UTS: realtime/unit/RTN8c/id-null-after-closed-0
  it('RTN8c - connection.id is null after close', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-id-1',
          connectionDetails: {
            connectionKey: 'conn-key-1',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      expect(client.connection.id).to.equal('conn-id-1');

      client.connection.once('closed', () => {
        expect(client.connection.id).to.not.be.ok;
        done();
      });

      client.close();
    });

    client.connect();
  });

  /**
   * RTN9c - Connection key is null in CLOSED state
   */
  // UTS: realtime/unit/RTN9c/key-null-after-closed-0
  it('RTN9c - connection.key is null after close', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-id-1',
          connectionDetails: {
            connectionKey: 'conn-key-1',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
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
      expect(client.connection.key).to.equal('conn-key-1');

      client.connection.once('closed', () => {
        expect(client.connection.key).to.not.be.ok;
        done();
      });

      client.close();
    });

    client.connect();
  });

  /**
   * RTN8c, RTN9c - ID and key null after FAILED
   */
  // UTS: realtime/unit/RTN8c/id-key-null-after-failed-1
  it('RTN8c, RTN9c - id and key null in FAILED state', function (done) {
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

    client.connection.once('failed', () => {
      expect(client.connection.id).to.not.be.ok;
      expect(client.connection.key).to.not.be.ok;
      done();
    });

    client.connect();
  });

  /**
   * RTN8d, RTN9d - ID and key are retained in the SUSPENDED state
   *
   * As of specification version 6.1.0 (RTN8d/RTN9d, replacing RTN8c/RTN9c) the
   * connection id and key are cleared only in the terminal states (CLOSED,
   * CLOSING, FAILED). They are retained through SUSPENDED, since the client
   * always attempts to resume on reconnecting and lets the server decide
   * whether continuity can be preserved.
   */
  // UTS: realtime/unit/RTN8d/id-key-retained-in-suspended-0
  it('RTN8d, RTN9d - id and key retained in SUSPENDED state', async function () {
    // Connect successfully on the first attempt, then refuse all reconnection
    // attempts so the connection ends up suspended.
    let attempt = 0;
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        if (attempt++ === 0) {
          mock.active_connection = conn;
          conn.respond_with_connected({
            connectionId: 'conn-id-1',
            connectionDetails: {
              connectionKey: 'conn-key-1',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else {
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
      disconnectedRetryTimeout: 1000,
      suspendedRetryTimeout: 100,
      fallbackHosts: [],
    });
    trackClient(client);

    client.connect();

    // Pump to let the initial connection succeed
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.equal('conn-id-1');
    expect(client.connection.key).to.equal('conn-key-1');

    // Drop the transport; subsequent attempts are refused, moving to DISCONNECTED
    mock.active_connection!.simulate_disconnect();
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // Advance past connectionStateTtl to reach SUSPENDED
    await clock.tickAsync(121000);
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(client.connection.state).to.equal('suspended');
    // RTN8d, RTN9d: id and key are retained, not cleared
    expect(client.connection.id).to.equal('conn-id-1');
    expect(client.connection.key).to.equal('conn-key-1');
    client.close();
  });
});
