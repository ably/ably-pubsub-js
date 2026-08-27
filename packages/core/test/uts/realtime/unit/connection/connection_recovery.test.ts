/**
 * UTS: Connection Recovery Tests (RTN16)
 *
 * Spec points: RTN16d, RTN16f, RTN16f1, RTN16g, RTN16g1, RTN16g2, RTN16g3, RTN16i, RTN16j, RTN16k, RTN16l
 * Source: specification/uts/realtime/unit/connection/connection_recovery_test.md
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

describe('uts/realtime/unit/connection/connection_recovery', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTN16g, RTN16g1 - createRecoveryKey returns string with connectionKey, msgSerial,
   * and channel/channelSerial pairs (including unicode channel names)
   */
  // UTS: realtime/unit/RTN16g/recovery-key-structure-0
  it('RTN16g, RTN16g1 - createRecoveryKey returns correct structure with unicode channel names', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-1',
          connectionDetails: {
            connectionKey: 'key-abc-123',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        // Respond to ATTACH requests with ATTACHED
        if (msg.action === 10) {
          // ATTACH
          const channelSerials: Record<string, string> = {
            'channel-alpha': 'serial-a-001',
            'channel-éàü-世界': 'serial-b-002',
          };
          conn!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: channelSerials[msg.channel] || 'default-serial',
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

    client.connection.once('connected', () => {
      // Get two channels and attach them (including one with unicode name)
      const channelA = client.channels.get('channel-alpha');
      const channelB = client.channels.get('channel-éàü-世界');

      let attachedCount = 0;
      const onAttached = () => {
        attachedCount++;
        if (attachedCount < 2) return;

        // Both channels attached — create recovery key
        const recoveryKeyString = client.connection.createRecoveryKey();

        // Recovery key is not null
        expect(recoveryKeyString).to.not.be.null;

        // Deserialize the recovery key (JSON format)
        const recoveryKey = JSON.parse(recoveryKeyString!);

        // Contains connectionKey
        expect(recoveryKey.connectionKey).to.equal('key-abc-123');

        // Contains msgSerial (starts at 0 since no messages were sent)
        expect(recoveryKey.msgSerial).to.equal(0);

        // Contains channelSerials map with both channels
        expect(recoveryKey.channelSerials).to.exist;
        expect(recoveryKey.channelSerials['channel-alpha']).to.equal('serial-a-001');

        // RTN16g1: Unicode channel name is correctly encoded in the serialized key
        expect(recoveryKey.channelSerials['channel-éàü-世界']).to.equal('serial-b-002');

        // Verify round-trip: re-serializing and deserializing preserves the unicode name
        const reSerialized = JSON.stringify(recoveryKey);
        const reParsed = JSON.parse(reSerialized);
        expect(reParsed.channelSerials['channel-éàü-世界']).to.equal('serial-b-002');

        done();
      };

      channelA.once('attached', onAttached);
      channelB.once('attached', onAttached);

      channelA.attach();
      channelB.attach();
    });

    client.connect();
  });

  /**
   * RTN16g2 - createRecoveryKey returns null in inactive states and before first connect
   */
  // UTS: realtime/unit/RTN16g2/recovery-key-null-inactive-0
  it('RTN16g2 - createRecoveryKey returns null before connect, in closing, and closed states', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
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
      onMessageFromClient: (msg) => {
        if (msg.action === 7) {
          // CLOSE -> respond CLOSED
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

    // Before connecting (INITIALIZED state, no connectionKey)
    expect(client.connection.createRecoveryKey()).to.be.null;

    client.connection.once('connected', () => {
      // Recovery key is available when CONNECTED
      expect(client.connection.createRecoveryKey()).to.not.be.null;

      // Listen for closing state
      client.connection.once('closing', () => {
        expect(client.connection.createRecoveryKey()).to.be.null;
      });

      // Listen for closed state
      client.connection.once('closed', () => {
        expect(client.connection.createRecoveryKey()).to.be.null;
        done();
      });

      // Transition to CLOSING then CLOSED
      client.connection.close();
    });

    client.connect();
  });

  /**
   * RTN16g2 - createRecoveryKey returns null in FAILED state
   */
  // UTS: realtime/unit/RTN16g2/recovery-key-null-inactive-0.1
  it('RTN16g2 - createRecoveryKey returns null in FAILED state', function (done) {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-f',
          connectionDetails: {
            connectionKey: 'key-f',
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
      // Verify we have a recovery key while connected
      expect(client.connection.createRecoveryKey()).to.not.be.null;

      client.connection.once('failed', () => {
        expect(client.connection.createRecoveryKey()).to.be.null;
        done();
      });

      // Trigger FAILED via fatal ERROR
      mock.active_connection!.send_to_client_and_close({
        action: 9, // ERROR
        error: { code: 50000, statusCode: 500, message: 'Fatal error' },
      });
    });

    client.connect();
  });

  /**
   * RTN16g3 - createRecoveryKey returns a recovery key in the SUSPENDED state
   *
   * As of specification version 6.1.0 (RTN16g3, replacing RTN16g2) the
   * connectionKey is retained through the SUSPENDED state (RTN8d/RTN9d), since
   * the client always attempts to resume on reconnecting. The connection
   * therefore remains recoverable while suspended, so createRecoveryKey()
   * returns a valid key rather than null.
   */
  // UTS: realtime/unit/RTN16g3/recovery-key-in-suspended-0
  it('RTN16g3 - createRecoveryKey returns a key in SUSPENDED state', async function () {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        if (connectionAttemptCount === 1) {
          mock.active_connection = conn;
          conn.respond_with_connected({
            connectionId: 'conn-s',
            connectionDetails: {
              connectionKey: 'key-s',
              maxIdleInterval: 15000,
              connectionStateTtl: 2000,
            } as any,
          });
        } else {
          // All subsequent connections fail to force SUSPENDED
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
      disconnectedRetryTimeout: 500,
      autoConnect: false,
      useBinaryProtocol: false,
      fallbackHosts: [],
    });
    trackClient(client);

    client.connect();

    // Pump to let initial connection succeed
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(client.connection.state).to.equal('connected');

    // Simulate disconnect
    mock.active_connection!.simulate_disconnect();

    // Advance time until SUSPENDED (connectionStateTtl expires)
    for (let i = 0; i < 10; i++) {
      await clock.tickAsync(1500);
      for (let j = 0; j < 30; j++) {
        clock.tick(0);
        await flushAsync();
      }
      if (client.connection.state === 'suspended') break;
    }

    expect(client.connection.state).to.equal('suspended');
    // RTN8d/RTN9d: connectionKey is retained, so the connection is still
    // recoverable while suspended and createRecoveryKey() returns a key.
    const recoveryKey = client.connection.createRecoveryKey();
    expect(recoveryKey).to.be.a('string');
    expect(JSON.parse(recoveryKey!).connectionKey).to.equal('key-s');
  });

  /**
   * RTN16k - recover option adds recover query param to WebSocket URL
   *
   * When instantiated with the `recover` client option, the library should add a
   * `recover` querystring param to the first WebSocket request. After successful
   * connection, subsequent reconnections use `resume` (not `recover`).
   */
  // UTS: realtime/unit/RTN16k/recover-query-param-0
  it('RTN16k - recover option adds recover query param to first connection only', function (done) {
    let connectionAttemptCount = 0;

    // Construct a valid recoveryKey
    const recoveryKey = JSON.stringify({
      connectionKey: 'recovered-key-xyz',
      msgSerial: 5,
      channelSerials: {},
    });

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          // First connection: successful recovery
          conn.respond_with_connected({
            connectionId: 'recovered-conn-id',
            connectionDetails: {
              connectionKey: 'new-key-after-recovery',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        } else {
          // Subsequent connection: resume after disconnect
          conn.respond_with_connected({
            connectionId: 'recovered-conn-id',
            connectionDetails: {
              connectionKey: 'resumed-key',
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
      recover: recoveryKey,
      autoConnect: false,
      useBinaryProtocol: false,
    } as any);
    trackClient(client);

    client.connection.once('connected', () => {
      // First connection attempt includes recover param with connectionKey from recoveryKey
      expect(mock.connect_attempts[0].url.searchParams.get('recover')).to.equal('recovered-key-xyz');

      // First connection attempt does NOT include resume param
      expect(mock.connect_attempts[0].url.searchParams.get('resume')).to.be.null;

      // Listen for second connection (resume after disconnect)
      client.connection.on('connected', () => {
        // Second connection attempt uses resume (not recover)
        expect(mock.connect_attempts[1].url.searchParams.get('resume')).to.equal('new-key-after-recovery');
        expect(mock.connect_attempts[1].url.searchParams.get('recover')).to.be.null;

        done();
      });

      // Simulate disconnect and reconnection
      mock.active_connection!.simulate_disconnect();
    });

    client.connect();
  });

  /**
   * RTN16f - recover option initializes msgSerial from recoveryKey
   *
   * When instantiated with the `recover` client option, the library should
   * initialize its internal msgSerial counter to the msgSerial component of
   * the recoveryKey.
   */
  // UTS: realtime/unit/RTN16f/recover-initializes-msgserial-0
  it('RTN16f - recover option initializes msgSerial from recoveryKey', async function () {
    const capturedMessages: any[] = [];

    // Construct a recoveryKey with msgSerial of 42
    const recoveryKey = JSON.stringify({
      connectionKey: 'old-key',
      msgSerial: 42,
      channelSerials: {
        'test-channel': 'ch-serial-1',
      },
    });

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;

        conn.respond_with_connected({
          connectionId: 'recovered-conn',
          connectionDetails: {
            connectionKey: 'new-key',
            maxIdleInterval: 300000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        capturedMessages.push(msg);

        if (msg.action === 10) {
          // ATTACH -> ATTACHED
          conn!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'ch-serial-updated',
          });
        } else if (msg.action === 15) {
          // MESSAGE -> ACK
          conn!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      recover: recoveryKey,
      autoConnect: false,
      useBinaryProtocol: false,
    } as any);
    trackClient(client);

    // Connect with recovery
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Attach the recovered channel
    const channel = client.channels.get('test-channel');
    channel.attach();
    await new Promise<void>((resolve) => channel.once('attached', resolve));

    // Publish a message - the msgSerial should start from the recovered value (42)
    await channel.publish('event', 'data');

    // Find the MESSAGE frame sent by the client
    const messageFrame = capturedMessages.find((m) => m.action === 15);

    // The first message published uses msgSerial from the recoveryKey
    expect(messageFrame).to.exist;
    expect(messageFrame.msgSerial).to.equal(42);
  });

  /**
   * RTN16f1 - Malformed recoveryKey logs error and connects normally
   *
   * If the recovery key provided in the `recover` client option cannot be
   * deserialized, the connection proceeds as if no `recover` option was provided.
   */
  // UTS: realtime/unit/RTN16f1/malformed-recovery-key-0
  it('RTN16f1 - malformed recoveryKey connects normally without recover param', function (done) {
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'fresh-conn',
          connectionDetails: {
            connectionKey: 'fresh-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Use a malformed (non-JSON) recover string
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      recover: 'this-is-not-valid-json!!!',
      autoConnect: false,
      useBinaryProtocol: false,
    } as any);
    trackClient(client);

    client.connection.once('connected', () => {
      // Connection succeeded normally
      expect(client.connection.state).to.equal('connected');
      expect(client.connection.id).to.equal('fresh-conn');
      expect(client.connection.key).to.equal('fresh-key');

      // No recover param was sent (malformed key was rejected)
      expect(mock.connect_attempts[0].url.searchParams.get('recover')).to.be.null;

      // Also no resume param (this is a fresh connection)
      expect(mock.connect_attempts[0].url.searchParams.get('resume')).to.be.null;

      // Only one connection attempt (normal connection, no retries)
      expect(connectionAttemptCount).to.equal(1);

      done();
    });

    client.connect();
  });

  /**
   * RTN16j - recover option instantiates channels from recoveryKey with correct channelSerials
   *
   * When instantiated with the `recover` client option, for every channel/channelSerial
   * pair in the recoveryKey, the library instantiates a corresponding channel and sets
   * its channelSerial (RTL15b).
   */
  // UTS: realtime/unit/RTN16j/recover-channel-serials-0
  it('RTN16j - channels from recoveryKey are instantiated with channelSerials', function (done) {
    const capturedMessages: any[] = [];

    // Construct a recoveryKey with multiple channels
    const recoveryKey = JSON.stringify({
      connectionKey: 'old-key-abc',
      msgSerial: 10,
      channelSerials: {
        'channel-one': 'serial-1-abc',
        'channel-two': 'serial-2-def',
        'channel-üñîçöðé': 'serial-3-unicode',
      },
    });

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'recovered-conn',
          connectionDetails: {
            connectionKey: 'new-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        capturedMessages.push(msg);
        if (msg.action === 10) {
          // ATTACH -> ATTACHED
          conn!.send_to_client({
            action: 11,
            channel: msg.channel,
            channelSerial: msg.channel === 'channel-one' ? 'serial-1-abc-updated' : 'serial-updated',
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      recover: recoveryKey,
      autoConnect: false,
      useBinaryProtocol: false,
    } as any);
    trackClient(client);

    client.connection.once('connected', () => {
      // RTN16j: Channels from the recoveryKey are instantiated
      const channelOne = client.channels.get('channel-one');
      const channelTwo = client.channels.get('channel-two');
      const channelUnicode = client.channels.get('channel-üñîçöðé');

      // Each channel has its channelSerial set from the recoveryKey
      expect(channelOne.properties.channelSerial).to.equal('serial-1-abc');
      expect(channelTwo.properties.channelSerial).to.equal('serial-2-def');
      expect(channelUnicode.properties.channelSerial).to.equal('serial-3-unicode');

      // RTN16i: Channels are NOT automatically attached — they should be in INITIALIZED state
      expect(channelOne.state).to.equal('initialized');
      expect(channelTwo.state).to.equal('initialized');
      expect(channelUnicode.state).to.equal('initialized');

      // When the user attaches, the ATTACH message should include the channelSerial
      channelOne.once('attached', () => {
        // Find the ATTACH frame sent for channel-one
        const attachFrame = capturedMessages.find((m) => m.action === 10 && m.channel === 'channel-one');
        expect(attachFrame).to.exist;
        expect(attachFrame.channelSerial).to.equal('serial-1-abc');

        done();
      });

      channelOne.attach();
    });

    client.connect();
  });
});
