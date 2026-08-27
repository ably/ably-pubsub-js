/**
 * UTS: Connection Auto Connect Tests
 *
 * Spec points: RTN3
 * Source: uts/test/realtime/unit/connection/auto_connect_test.md
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, trackClient, installMockWebSocket, restoreAll, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/connection/auto_connect', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN3 - autoConnect true initiates connection immediately
   */
  // UTS: realtime/unit/RTN3/auto-connect-true-0
  it('RTN3 - autoConnect true initiates connection immediately', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
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

    // Create client with default autoConnect (true) — do NOT call connect()
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connection.once('connected', () => {
      expect(client.connection.state).to.equal('connected');
      expect(client.connection.id).to.equal('connection-id');
      client.close();
      done();
    });
  });

  /**
   * RTN3 - autoConnect false does not initiate connection
   */
  // UTS: realtime/unit/RTN3/auto-connect-false-1
  it('RTN3 - autoConnect false does not initiate connection', async function () {
    let connectionAttempted = false;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttempted = true;
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

    expect(client.connection.state).to.equal('initialized');

    await flushAsync();

    expect(connectionAttempted).to.be.false;
    expect(client.connection.state).to.equal('initialized');
    expect(mock.connect_attempts).to.have.length(0);
  });

  /**
   * RTN3 - explicit connect after autoConnect false
   */
  // UTS: realtime/unit/RTN3/explicit-connect-after-false-2
  it('RTN3 - explicit connect after autoConnect false', function (done) {
    let connectionAttempted = false;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttempted = true;
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

    // Verify no connection yet
    expect(client.connection.state).to.equal('initialized');
    expect(connectionAttempted).to.be.false;

    client.connection.once('connected', () => {
      expect(connectionAttempted).to.be.true;
      expect(client.connection.state).to.equal('connected');
      client.close();
      done();
    });

    // Explicitly connect
    client.connect();
  });
});
