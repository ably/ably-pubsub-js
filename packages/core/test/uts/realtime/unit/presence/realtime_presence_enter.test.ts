/**
 * UTS: Realtime Presence Enter/Update/Leave Tests
 *
 * Spec points: RTP4, RTP8, RTP8a, RTP8c, RTP8d, RTP8e, RTP8g, RTP8h, RTP8j,
 *   RTP9, RTP9a, RTP9d, RTP10, RTP10a, RTP10c, RTP14, RTP14a, RTP14d,
 *   RTP15, RTP15a, RTP15c, RTP15e, RTP15f, RTP16, RTP16a, RTP16b, RTP16c
 * Source: specification/uts/realtime/unit/presence/realtime_presence_enter.md
 *
 * Tests the RealtimePresence#enter, update, leave, enterClient, updateClient,
 * and leaveClient functions. These methods send PRESENCE ProtocolMessages to
 * the server and handle ACK/NACK responses. Tests cover protocol message
 * format, implicit channel attach, connection state conditions, and error cases.
 *
 * Protocol actions: HEARTBEAT=0, ACK=1, NACK=2, CONNECTED=4, ERROR=9,
 *   ATTACH=10, ATTACHED=11, DETACHED=13, PRESENCE=14, MESSAGE=15, SYNC=16
 * Presence actions (wire): ABSENT=0, PRESENT=1, ENTER=2, LEAVE=3, UPDATE=4
 * Flags: HAS_PRESENCE=1
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/presence/realtime_presence_enter', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTP8a, RTP8c - enter sends PRESENCE with ENTER action
   *
   * Enters the current client into this channel. A PRESENCE ProtocolMessage
   * with a PresenceMessage with action ENTER is sent. The clientId attribute
   * of the PresenceMessage must not be present (implicitly uses the connection's
   * clientId).
   */
  // UTS: realtime/unit/RTP8a/enter-sends-presence-enter-0
  it('RTP8a, RTP8c - enter sends PRESENCE with ENTER action', async function () {
    const channelName = 'test-RTP8a-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    await channel.presence.enter(null);

    expect(capturedPresence.length).to.equal(1);
    expect(capturedPresence[0].action).to.equal(14); // PRESENCE
    expect(capturedPresence[0].channel).to.equal(channelName);
    expect(capturedPresence[0].presence.length).to.equal(1);
    expect(capturedPresence[0].presence[0].action).to.equal(2); // ENTER
    // RTP8c: clientId must NOT be present in the PresenceMessage
    expect(capturedPresence[0].presence[0].clientId).to.be.undefined;

    client.close();
  });

  /**
   * RTP8e - enter with data
   *
   * Optional data can be included when entering. Data will be encoded
   * and decoded as with normal messages.
   */
  // UTS: realtime/unit/RTP8e/enter-with-data-0
  it('RTP8e - enter with data', async function () {
    const channelName = 'test-RTP8e-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    await channel.presence.enter('hello world');

    expect(capturedPresence.length).to.equal(1);
    expect(capturedPresence[0].presence[0].action).to.equal(2); // ENTER
    expect(capturedPresence[0].presence[0].data).to.equal('hello world');

    client.close();
  });

  /**
   * RTP8d - enter implicitly attaches channel
   *
   * Implicitly attaches the RealtimeChannel if the channel is in the
   * INITIALIZED state.
   */
  // UTS: realtime/unit/RTP8d/enter-implicitly-attaches-0
  it('RTP8d - enter implicitly attaches channel', async function () {
    const channelName = 'test-RTP8d-' + String(Math.random()).slice(2);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    expect(channel.state).to.equal('initialized');

    // enter() on INITIALIZED channel triggers implicit attach
    await channel.presence.enter(null);

    expect(channel.state).to.equal('attached');

    client.close();
  });

  /**
   * RTP8g - enter on FAILED channel errors
   *
   * If the channel is DETACHED or FAILED, the enter request results
   * in an error immediately.
   */
  // UTS: realtime/unit/RTP8g/enter-detached-failed-errors-0
  it('RTP8g - enter on FAILED channel errors', async function () {
    const channelName = 'test-RTP8g-' + String(Math.random()).slice(2);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // Respond with ERROR to put channel in FAILED state
          conn!.send_to_client({
            action: 9, // ERROR (channel-level)
            channel: channelName,
            error: { code: 90001, statusCode: 500, message: 'Channel failed' },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });

    // Put channel into FAILED state
    try {
      await channel.attach();
    } catch (_) {
      // Expected to fail
    }
    expect(channel.state).to.equal('failed');

    // enter() on FAILED channel should error immediately
    try {
      await channel.presence.enter(null);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }

    client.close();
  });

  /**
   * RTP8j - enter with null clientId (anonymous) errors
   *
   * If the connection is CONNECTED and the clientId is null (anonymous),
   * the enter request results in an error immediately.
   */
  // UTS: realtime/unit/RTP8j/enter-null-clientid-errors-0
  it('RTP8j - enter with null clientId errors', async function () {
    const channelName = 'test-RTP8j-' + String(Math.random()).slice(2);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // No clientId -- anonymous client
    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    // enter() without clientId should error
    try {
      await channel.presence.enter(null);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }

    client.close();
  });

  /**
   * RTP8j - enter with wildcard clientId errors
   *
   * If the connection is CONNECTED and the clientId is '*' (wildcard),
   * the enter request results in an error immediately.
   *
   * NOTE: ably-js rejects clientId: "*" at ClientOptions construction time
   * with "Can't use '*' as a clientId as that string is reserved." rather than
   * at enter() time. This test validates that the error occurs at construction.
   */
  // UTS: realtime/unit/RTP8j/enter-wildcard-clientid-errors-1
  it('RTP8j - enter with wildcard clientId errors', async function () {
    // ably-js rejects wildcard clientId at construction time
    try {
      new Ably.Realtime({
        key: 'fake.key:secret',
        clientId: '*',
        autoConnect: false,
        useBinaryProtocol: false,
      });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }
  });

  /**
   * RTP8h - NACK for missing presence permission
   *
   * If the Ably service determines that the client does not have
   * required presence permission, a NACK is sent resulting in an error.
   */
  // UTS: realtime/unit/RTP8h/nack-presence-permission-denied-0
  it('RTP8h - NACK for missing presence permission', async function () {
    const channelName = 'test-RTP8h-' + String(Math.random()).slice(2);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          // PRESENCE -- respond with NACK
          conn!.send_to_client({
            action: 2, // NACK
            msgSerial: msg.msgSerial,
            count: 1,
            error: { code: 40160, statusCode: 401, message: 'Presence permission denied' },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    try {
      await channel.presence.enter(null);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.not.be.null;
      expect(err.code).to.equal(40160);
    }

    client.close();
  });

  /**
   * RTP9a, RTP9d - update sends PRESENCE with UPDATE action
   *
   * Updates the data for the present member. A PRESENCE ProtocolMessage
   * with action UPDATE is sent. The clientId must not be present.
   */
  // UTS: realtime/unit/RTP9a/update-sends-presence-update-0
  it('RTP9a, RTP9d - update sends PRESENCE with UPDATE action', async function () {
    const channelName = 'test-RTP9a-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    await channel.presence.update('new-status');

    expect(capturedPresence.length).to.equal(1);
    expect(capturedPresence[0].presence[0].action).to.equal(4); // UPDATE
    expect(capturedPresence[0].presence[0].data).to.equal('new-status');
    // RTP9d: clientId must NOT be present
    expect(capturedPresence[0].presence[0].clientId).to.be.undefined;

    client.close();
  });

  /**
   * RTP10a, RTP10c - leave sends PRESENCE with LEAVE action
   *
   * Leaves this client from the channel. A PRESENCE ProtocolMessage
   * with action LEAVE is sent. The clientId must not be present.
   */
  // UTS: realtime/unit/RTP10a/leave-sends-presence-leave-0
  it('RTP10a, RTP10c - leave sends PRESENCE with LEAVE action', async function () {
    const channelName = 'test-RTP10a-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    await channel.presence.leave(null);

    expect(capturedPresence.length).to.equal(1);
    expect(capturedPresence[0].presence[0].action).to.equal(3); // LEAVE
    // RTP10c: clientId must NOT be present
    expect(capturedPresence[0].presence[0].clientId).to.be.undefined;

    client.close();
  });

  /**
   * RTP10a - leave with data updates the member data
   *
   * The data will be updated with the values provided when leaving.
   */
  // UTS: realtime/unit/RTP10a/leave-with-data-1
  it('RTP10a - leave with data', async function () {
    const channelName = 'test-RTP10a-data-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    await channel.presence.leave('goodbye');

    expect(capturedPresence[0].presence[0].action).to.equal(3); // LEAVE
    expect(capturedPresence[0].presence[0].data).to.equal('goodbye');

    client.close();
  });

  /**
   * RTP14a - enterClient enters on behalf of another clientId
   *
   * Enters into presence on a channel on behalf of another clientId.
   * This allows a single client with suitable permissions to register
   * presence on behalf of any number of clients using a single connection.
   *
   * NOTE: The UTS spec uses clientId: "*" (wildcard) in ClientOptions. ably-js
   * rejects "*" at construction time. Per the UTS spec note, we adapt to use
   * key auth without clientId. enterClient() works with key auth and sends
   * the explicit clientId in each presence message.
   */
  // UTS: realtime/unit/RTP14a/enterclient-on-behalf-0
  it('RTP14a - enterClient enters on behalf of another clientId', async function () {
    const channelName = 'test-RTP14a-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Use key auth without clientId (instead of wildcard "*")
    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    await channel.presence.enterClient('user-alice', 'alice-data');
    await channel.presence.enterClient('user-bob', 'bob-data');

    expect(capturedPresence.length).to.equal(2);

    // First enter: user-alice
    expect(capturedPresence[0].presence[0].action).to.equal(2); // ENTER
    expect(capturedPresence[0].presence[0].clientId).to.equal('user-alice');
    expect(capturedPresence[0].presence[0].data).to.equal('alice-data');

    // Second enter: user-bob
    expect(capturedPresence[1].presence[0].action).to.equal(2); // ENTER
    expect(capturedPresence[1].presence[0].clientId).to.equal('user-bob');
    expect(capturedPresence[1].presence[0].data).to.equal('bob-data');

    client.close();
  });

  /**
   * RTP15a - updateClient and leaveClient
   *
   * Performs update or leave for a given clientId. Functionally
   * equivalent to the corresponding enter, update, and leave methods.
   */
  // UTS: realtime/unit/RTP15a/updateclient-leaveclient-0
  it('RTP15a - updateClient and leaveClient', async function () {
    const channelName = 'test-RTP15a-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Use key auth without clientId (instead of wildcard "*")
    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    await channel.presence.enterClient('user-1', 'entered');
    await channel.presence.updateClient('user-1', 'updated');
    await channel.presence.leaveClient('user-1', 'leaving');

    expect(capturedPresence.length).to.equal(3);

    expect(capturedPresence[0].presence[0].action).to.equal(2); // ENTER
    expect(capturedPresence[0].presence[0].clientId).to.equal('user-1');
    expect(capturedPresence[0].presence[0].data).to.equal('entered');

    expect(capturedPresence[1].presence[0].action).to.equal(4); // UPDATE
    expect(capturedPresence[1].presence[0].clientId).to.equal('user-1');
    expect(capturedPresence[1].presence[0].data).to.equal('updated');

    expect(capturedPresence[2].presence[0].action).to.equal(3); // LEAVE
    expect(capturedPresence[2].presence[0].clientId).to.equal('user-1');
    expect(capturedPresence[2].presence[0].data).to.equal('leaving');

    client.close();
  });

  /**
   * RTP15e - enterClient implicitly attaches channel
   *
   * Implicitly attaches the RealtimeChannel if the channel is in the
   * INITIALIZED state.
   */
  // UTS: realtime/unit/RTP15e/enterclient-implicitly-attaches-0
  it('RTP15e - enterClient implicitly attaches channel', async function () {
    const channelName = 'test-RTP15e-' + String(Math.random()).slice(2);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Use key auth without clientId (instead of wildcard "*")
    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    expect(channel.state).to.equal('initialized');

    await channel.presence.enterClient('user-1', null);

    expect(channel.state).to.equal('attached');

    client.close();
  });

  /**
   * RTP15f - enterClient with mismatched clientId errors
   *
   * If the client is identified and has a valid clientId, and the
   * clientId argument does not match the client's clientId, then it
   * should indicate an error.
   *
   * NOTE: ably-js does NOT implement RTP15f client-side validation.
   * enterClient() passes the clientId through without checking it against
   * the connection's clientId. It relies on the server to reject mismatched
   * clientIds via NACK. This test simulates a server NACK to validate the
   * error propagation path.
   */
  // UTS: realtime/unit/RTP15f/enterclient-mismatched-clientid-0
  it('RTP15f - enterClient with mismatched clientId errors', async function () {
    const channelName = 'test-RTP15f-' + String(Math.random()).slice(2);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          // Server rejects with NACK for clientId mismatch
          conn!.send_to_client({
            action: 2, // NACK
            msgSerial: msg.msgSerial,
            count: 1,
            error: { code: 40012, statusCode: 400, message: 'clientId mismatch' },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Client has a specific (non-wildcard) clientId
    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    // enterClient with a different clientId than the connection's clientId
    try {
      await channel.presence.enterClient('other-client', null);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }

    // Connection and channel remain available
    expect(client.connection.state).to.equal('connected');
    expect(channel.state).to.equal('attached');

    client.close();
  });

  /**
   * RTP16a - Presence message sent when channel is ATTACHED
   *
   * If the channel is ATTACHED then presence messages are sent
   * immediately to the connection.
   */
  // UTS: realtime/unit/RTP16a/presence-sent-when-attached-0
  it('RTP16a - presence message sent when channel is ATTACHED', async function () {
    const channelName = 'test-RTP16a-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    await channel.presence.enter(null);

    // Message was sent immediately
    expect(capturedPresence.length).to.equal(1);

    client.close();
  });

  /**
   * RTP16b - Presence message queued when channel is ATTACHING
   *
   * If the channel is ATTACHING or INITIALIZED and queueMessages is
   * true, presence messages are queued at channel level, sent once
   * channel becomes ATTACHED.
   */
  // UTS: realtime/unit/RTP16b/presence-queued-when-attaching-0
  it('RTP16b - presence message queued when channel is ATTACHING', async function () {
    const channelName = 'test-RTP16b-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH -- delay the ATTACHED response (don't respond yet)
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });

    // Start attach but don't complete it
    channel.attach();
    // Wait a tick for the attach message to be sent
    await flushAsync();
    expect(channel.state).to.equal('attaching');

    // Queue presence while ATTACHING
    const enterFuture = channel.presence.enter(null);

    // No presence messages sent yet
    expect(capturedPresence.length).to.equal(0);

    // Now complete the attach
    mock.active_connection!.send_to_client({ action: 11, channel: channelName });

    await enterFuture;

    // Queued presence message was sent after attach completed
    expect(capturedPresence.length).to.equal(1);
    expect(capturedPresence[0].presence[0].action).to.equal(2); // ENTER

    client.close();
  });

  /**
   * RTP16c - Presence message errors in other channel states
   *
   * In any other case (channel not ATTACHED, ATTACHING, or INITIALIZED
   * with queueMessages) the operation should result in an error.
   */
  // UTS: realtime/unit/RTP16c/presence-errors-other-states-0
  it('RTP16c - presence message errors in other channel states', async function () {
    const channelName = 'test-RTP16c-' + String(Math.random()).slice(2);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // Respond with channel ERROR to put channel into FAILED state
          conn!.send_to_client({
            action: 9, // ERROR (channel-level)
            channel: channelName,
            error: { code: 90001, statusCode: 500, message: 'Channel error' },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'my-client',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });

    // Put channel in FAILED state
    try {
      await channel.attach();
    } catch (_) {
      // Expected
    }
    expect(channel.state).to.equal('failed');

    try {
      await channel.presence.enter(null);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }

    client.close();
  });

  /**
   * RTP15c - enterClient has no side effects on normal enter
   *
   * Using enterClient, updateClient, and leaveClient methods should
   * have no side effects on a client that has entered normally using enter.
   *
   * NOTE: The UTS spec uses clientId: "*" for the client, allowing both
   * enter() and enterClient(). ably-js rejects "*" at construction time.
   * We use a concrete clientId ("admin") to allow enter() for the main client,
   * plus enterClient()/leaveClient() for other users. enterClient with
   * the same clientId as the connection works in ably-js.
   */
  // UTS: realtime/unit/RTP15c/enterclient-no-side-effects-0
  it('RTP15c - enterClient has no side effects on normal enter', async function () {
    const channelName = 'test-RTP15c-' + String(Math.random()).slice(2);
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: channelName });
        } else if (msg.action === 14) {
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Use a concrete clientId to allow enter() for the main client
    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      clientId: 'admin',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    // Normal enter for the admin client
    await channel.presence.enter('main-client');

    // enterClient for a different user
    await channel.presence.enterClient('other-user', 'other-data');

    // leaveClient for the other user
    await channel.presence.leaveClient('other-user', null);

    // Three presence messages sent: enter, enterClient, leaveClient
    expect(capturedPresence.length).to.equal(3);

    // The main client's enter is unaffected by the enterClient/leaveClient calls
    expect(capturedPresence[0].presence[0].action).to.equal(2); // ENTER
    expect(capturedPresence[0].presence[0].data).to.equal('main-client');
    // RTP8c: clientId not present when using enter() (implicit from connection)
    expect(capturedPresence[0].presence[0].clientId).to.be.undefined;

    expect(capturedPresence[1].presence[0].action).to.equal(2); // ENTER
    expect(capturedPresence[1].presence[0].clientId).to.equal('other-user');

    expect(capturedPresence[2].presence[0].action).to.equal(3); // LEAVE
    expect(capturedPresence[2].presence[0].clientId).to.equal('other-user');

    client.close();
  });

  /**
   * RTP4 - 50 members via enterClient (same connection)
   *
   * Ensure a test exists that enters members using enterClient on a single
   * connection, checks for ENTER events to be emitted for each member, and
   * once sync is complete, all members should be present in a get() request.
   *
   * Note: The spec says 250 but we use 50 as a practical test size.
   */
  // UTS: realtime/unit/RTP4/bulk-enterclient-same-connection-0
  it('RTP4 - 50 members via enterClient (same connection)', async function () {
    this.timeout(30000);
    const channelName = 'test-RTP4-same-' + String(Math.random()).slice(2);
    const memberCount = 50;
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH with HAS_PRESENCE flag
          conn!.send_to_client({
            action: 11,
            channel: channelName,
            flags: 1, // HAS_PRESENCE
          });
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });

          // Server echoes back the ENTER as a PRESENCE event
          const presence = msg.presence;
          for (let idx = 0; idx < presence.length; idx++) {
            const p = presence[idx];
            conn!.send_to_client({
              action: 14, // PRESENCE
              channel: channelName,
              presence: [
                {
                  action: 2, // ENTER
                  clientId: p.clientId,
                  connectionId: 'conn-1',
                  id: 'conn-1:' + msg.msgSerial + ':' + idx,
                  timestamp: Date.now(),
                  data: p.data,
                },
              ],
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    // Use key auth without clientId (instead of wildcard "*")
    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName, { attachOnSubscribe: false });
    await channel.attach();

    // Track ENTER events received by subscriber
    const receivedEnters: any[] = [];
    channel.presence.subscribe('enter', (event: any) => {
      receivedEnters.push(event);
    });

    // Enter 50 members
    for (let i = 0; i < memberCount; i++) {
      await channel.presence.enterClient('user-' + i, 'data-' + i);
    }

    // Allow events to propagate
    await flushAsync();

    // Send a complete SYNC with all 50 members as PRESENT
    const syncMembers: any[] = [];
    for (let i = 0; i < memberCount; i++) {
      syncMembers.push({
        action: 1, // PRESENT
        clientId: 'user-' + i,
        connectionId: 'conn-1',
        id: 'conn-1:' + i + ':0',
        timestamp: Date.now(),
        data: 'data-' + i,
      });
    }

    mock.active_connection!.send_to_client({
      action: 16, // SYNC
      channel: channelName,
      channelSerial: 'seq1:',
      presence: syncMembers,
    });

    // Allow sync to complete
    await flushAsync();

    // Get all members after sync
    const members = await channel.presence.get();

    // All 50 members entered
    expect(capturedPresence.length).to.equal(memberCount);

    // All 50 ENTER events received by subscriber
    expect(receivedEnters.length).to.equal(memberCount);

    // All 50 members present after sync
    expect(members.length).to.equal(memberCount);

    // Verify each member exists with correct data
    for (let i = 0; i < memberCount; i++) {
      const member = members.find((m: any) => m.clientId === 'user-' + i);
      expect(member, 'member user-' + i + ' should exist').to.not.be.undefined;
      expect(member!.data).to.equal('data-' + i);
    }

    client.close();
  });

  /**
   * RTP4 - 50 members via enterClient (different connections)
   *
   * One connection enters members, a different connection observes the
   * ENTER events and verifies all members via get(). This is the more
   * realistic scenario where one client populates presence and another
   * client discovers the members.
   *
   * NOTE: ably-js MockWebSocket is a single mock per install. To simulate
   * two separate connections, we run them sequentially: first client A enters
   * all members, then we set up client B with its own mock to observe presence
   * via SYNC delivery and verify via get().
   */
  // UTS: realtime/unit/RTP4/bulk-enterclient-diff-connections-1
  it('RTP4 - 50 members via enterClient (different connections)', async function () {
    this.timeout(30000);
    const channelName = 'test-RTP4-diff-' + String(Math.random()).slice(2);
    const memberCount = 50;

    // --- Phase 1: Client A enters 50 members ---
    const capturedPresenceA: any[] = [];
    const mockA = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockA.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-A',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({
            action: 11,
            channel: channelName,
            flags: 1, // HAS_PRESENCE
          });
        } else if (msg.action === 14) {
          capturedPresenceA.push(msg);
          conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1 });
        }
      },
    });
    installMockWebSocket(mockA.constructorFn);

    // Use key auth without clientId (instead of wildcard "*")
    const clientA = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(clientA);

    clientA.connect();
    await new Promise<void>((resolve) => clientA.connection.once('connected', resolve));

    const channelA = clientA.channels.get(channelName, { attachOnSubscribe: false });
    await channelA.attach();

    // Client A enters 50 members
    for (let i = 0; i < memberCount; i++) {
      await channelA.presence.enterClient('user-' + i, 'data-' + i);
    }

    // Client A sent all 50 presence messages
    expect(capturedPresenceA.length).to.equal(memberCount);

    clientA.close();

    // --- Phase 2: Client B observes via SYNC ---
    restoreAll();

    const mockB = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockB.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-B',
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({
            action: 11,
            channel: channelName,
            flags: 1, // HAS_PRESENCE
          });
        }
      },
    });
    installMockWebSocket(mockB.constructorFn);

    const clientB = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(clientB);

    clientB.connect();
    await new Promise<void>((resolve) => clientB.connection.once('connected', resolve));

    const channelB = clientB.channels.get(channelName, { attachOnSubscribe: false });
    await channelB.attach();

    // Subscribe on client B to observe remote presence events
    const receivedEntersB: any[] = [];
    channelB.presence.subscribe('enter', (event: any) => {
      receivedEntersB.push(event);
    });

    // Server delivers ENTER events to client B
    for (let i = 0; i < memberCount; i++) {
      mockB.active_connection!.send_to_client({
        action: 14, // PRESENCE
        channel: channelName,
        presence: [
          {
            action: 2, // ENTER
            clientId: 'user-' + i,
            connectionId: 'conn-A',
            id: 'conn-A:' + i + ':0',
            timestamp: Date.now(),
            data: 'data-' + i,
          },
        ],
      });
    }

    // Allow events to propagate
    await flushAsync();

    // Server sends a SYNC to client B with all 50 members
    const syncMembers: any[] = [];
    for (let i = 0; i < memberCount; i++) {
      syncMembers.push({
        action: 1, // PRESENT
        clientId: 'user-' + i,
        connectionId: 'conn-A',
        id: 'conn-A:' + i + ':0',
        timestamp: Date.now(),
        data: 'data-' + i,
      });
    }

    mockB.active_connection!.send_to_client({
      action: 16, // SYNC
      channel: channelName,
      channelSerial: 'seq1:',
      presence: syncMembers,
    });

    // Allow sync to complete
    await flushAsync();

    // Client B gets all members
    const members = await channelB.presence.get();

    // Client B received all 50 ENTER events
    expect(receivedEntersB.length).to.equal(memberCount);

    // All 50 members present via get() on client B
    expect(members.length).to.equal(memberCount);

    // Verify each member has correct data and connectionId from conn-A
    for (let i = 0; i < memberCount; i++) {
      const member = members.find((m: any) => m.clientId === 'user-' + i);
      expect(member, 'member user-' + i + ' should exist').to.not.be.undefined;
      expect(member!.data).to.equal('data-' + i);
      expect(member!.connectionId).to.equal('conn-A');
    }

    clientB.close();
  });
});
