/**
 * UTS: Channel Properties Tests
 *
 * Spec points: RTL15, RTL15b, RTL15b1, RTL15c, RTL15b2
 * Source: uts/test/realtime/unit/channels/channel_properties_test.md
 *
 * Tests channel properties: attachSerial and channelSerial tracking,
 * update from protocol messages, and clearing on state transitions.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import {
  Ably,
  installMockWebSocket,
  enableFakeTimers,
  restoreAll,
  trackClient,
  flushAsync,
  pollUntil,
} from '../../../helpers';

describe('uts/realtime/unit/channels/channel_properties', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL15c - attachSerial is updated from non-resumed ATTACHED message
   */
  // UTS: realtime/unit/RTL15c/attach-serial-from-attached-0
  it('RTL15c - attachSerial from ATTACHED', async function () {
    let attachCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachCount++;
          // No RESUMED flag, so resumed is false
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: `attach-serial-${attachCount}`,
            flags: 0,
          });
        }
        if (msg.action === 12) {
          // DETACH
          mock.active_connection!.send_to_client({
            action: 13, // DETACHED
            channel: msg.channel,
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

    const channel = client.channels.get('test-RTL15c');
    // Before connect — attachSerial should be null
    expect(channel.properties.attachSerial).to.satisfy((v: any) => !v);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    await channel.attach();
    expect(channel.properties.attachSerial).to.equal('attach-serial-1');

    await channel.detach();
    await channel.attach();
    expect(channel.properties.attachSerial).to.equal('attach-serial-2');
    client.close();
  });

  /**
   * RTL15c - attachSerial updated on server-initiated non-resumed reattach
   */
  // UTS: realtime/unit/RTL15c/attach-serial-server-reattach-1
  it('RTL15c - attachSerial updated on additional non-resumed ATTACHED', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'initial-serial',
            flags: 0,
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

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL15c-update');
    await channel.attach();
    expect(channel.properties.attachSerial).to.equal('initial-serial');

    // Server sends unsolicited ATTACHED without the RESUMED flag (e.g. RTL12 update)
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL15c-update',
      channelSerial: 'updated-serial',
      flags: 0,
    });
    await flushAsync();

    expect(channel.properties.attachSerial).to.equal('updated-serial');
    client.close();
  });

  /**
   * RTL15c - attachSerial not updated from resumed ATTACHED message
   */
  // UTS: realtime/unit/RTL15c/attach-serial-not-updated-resumed-2
  it('RTL15c - attachSerial not updated from resumed ATTACHED', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'initial-serial',
            flags: 0,
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

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL15c-resumed');
    await channel.attach();
    expect(channel.properties.attachSerial).to.equal('initial-serial');

    // Server sends unsolicited ATTACHED WITH the RESUMED flag
    // (successful resume, no loss of continuity)
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL15c-resumed',
      channelSerial: 'resumed-serial',
      flags: 4, // RESUMED (1 << 2)
    });
    await flushAsync();

    // channelSerial is updated per RTL15b regardless of the RESUMED flag,
    // confirming the message has been processed
    expect(channel.properties.channelSerial).to.equal('resumed-serial');
    // attachSerial must be unchanged, since the ATTACHED message had resumed=true
    expect(channel.properties.attachSerial).to.equal('initial-serial');
    client.close();
  });

  /**
   * RTL15b - channelSerial updated from ATTACHED message
   */
  // UTS: realtime/unit/RTL15b/channel-serial-from-attached-0
  it('RTL15b - channelSerial from ATTACHED', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'serial-001',
            flags: 0,
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

    const channel = client.channels.get('test-RTL15b');
    expect(channel.properties.channelSerial).to.satisfy((v: any) => !v);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    await channel.attach();
    expect(channel.properties.channelSerial).to.equal('serial-001');
    client.close();
  });

  /**
   * RTL15b - channelSerial updated from MESSAGE and PRESENCE actions
   */
  // UTS: realtime/unit/RTL15b/channel-serial-from-messages-1
  it('RTL15b - channelSerial updated from MESSAGE', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'serial-001',
            flags: 0,
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

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL15b-msg', { attachOnSubscribe: false });
    await channel.attach();
    expect(channel.properties.channelSerial).to.equal('serial-001');

    // MESSAGE with channelSerial updates it
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL15b-msg',
      channelSerial: 'serial-002',
      messages: [{ name: 'test', data: 'data' }],
    });
    await flushAsync();
    expect(channel.properties.channelSerial).to.equal('serial-002');
    client.close();
  });

  /**
   * RTL15b2 - channelSerial cleared on DETACHED state
   */
  // UTS: realtime/unit/RTL15b2/serial-cleared-detached-0
  it('RTL15b2 - channelSerial cleared on detach', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'serial-001',
            flags: 0,
          });
        }
        if (msg.action === 12) {
          // DETACH
          mock.active_connection!.send_to_client({
            action: 13, // DETACHED
            channel: msg.channel,
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

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL15b1-detach');
    await channel.attach();
    expect(channel.properties.channelSerial).to.equal('serial-001');

    await channel.detach();
    expect(channel.state).to.equal('detached');
    expect(channel.properties.channelSerial).to.satisfy((v: any) => !v);
    client.close();
  });

  /**
   * RTL15b2 - channelSerial cleared on FAILED state
   */
  // UTS: realtime/unit/RTL15b2/serial-cleared-failed-2
  it('RTL15b2 - channelSerial cleared on failed', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'serial-001',
            flags: 0,
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

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL15b1-failed');
    await channel.attach();
    expect(channel.properties.channelSerial).to.equal('serial-001');

    // Send channel ERROR → FAILED
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTL15b1-failed',
      error: { message: 'Error', code: 90001, statusCode: 500 },
    });
    await new Promise<void>((resolve) => channel.once('failed', resolve));

    expect(channel.state).to.equal('failed');
    expect(channel.properties.channelSerial).to.satisfy((v: any) => !v);
    client.close();
  });

  /**
   * RTL15b2 - channelSerial retained in SUSPENDED state
   *
   * As of specification version 6.1.0 (RTL15b2, replacing RTL15b1) the
   * channelSerial is cleared only when entering DETACHED or FAILED. It is
   * retained through SUSPENDED, so that it can be included on the subsequent
   * ATTACH (RTL4c1) for the server's continuity decision.
   */
  // UTS: realtime/unit/RTL15b2/serial-retained-suspended-0
  it('RTL15b2 - channelSerial retained in suspended', async function () {
    let attachCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachCount++;
          if (attachCount === 1) {
            mock.active_connection!.send_to_client({
              action: 11, // ATTACHED
              channel: msg.channel,
              channelSerial: 'serial-001',
              flags: 0,
            });
          }
          // Don't respond to second ATTACH — let it timeout
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      realtimeRequestTimeout: 100,
    });
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const channel = client.channels.get('test-RTL15b1-suspended');
    await channel.attach();
    expect(channel.properties.channelSerial).to.equal('serial-001');

    // Server sends DETACHED (triggers reattach attempt)
    mock.active_connection!.send_to_client({
      action: 13, // DETACHED
      channel: 'test-RTL15b1-suspended',
      error: { message: 'Server detach', code: 90001, statusCode: 500 },
    });

    // Pump and advance past timeout to reach suspended
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    await clock.tickAsync(150);

    expect(channel.state).to.equal('suspended');
    // RTL15b2: channelSerial is retained through SUSPENDED, not cleared
    expect(channel.properties.channelSerial).to.equal('serial-001');
    client.close();
  });

  /**
   * RTL15b - channelSerial not updated when field is not populated
   *
   * Receiving a MESSAGE without a channelSerial should not clear or change
   * the existing channelSerial.
   */
  // UTS: realtime/unit/RTL15b/serial-not-updated-empty-2
  it('RTL15b - channelSerial unchanged when not in message', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'serial-001',
            flags: 0,
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

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL15b-noupdate', { attachOnSubscribe: false });
    await channel.attach();
    expect(channel.properties.channelSerial).to.equal('serial-001');

    // Server sends MESSAGE without channelSerial
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL15b-noupdate',
      messages: [{ name: 'event', data: 'data' }],
    });

    await flushAsync();

    // channelSerial should remain unchanged
    expect(channel.properties.channelSerial).to.equal('serial-001');
    client.close();
  });

  /**
   * RTL15b - channelSerial not updated from irrelevant actions
   *
   * Receiving a protocol message with a different action (e.g. DETACHED)
   * should not update channelSerial even if the message contains a
   * channelSerial field. A server-initiated DETACHED triggers reattach
   * (RTL13a), so we verify the final channelSerial comes from the new
   * ATTACHED, not from the DETACHED message.
   */
  // UTS: realtime/unit/RTL15b/serial-not-updated-irrelevant-3
  it('RTL15b - channelSerial not from irrelevant actions', async function () {
    let attachCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachCount++;
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'serial-001',
            flags: 0,
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

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL15b-irrelevant');
    await channel.attach();
    expect(channel.properties.channelSerial).to.equal('serial-001');

    // Server sends DETACHED with a channelSerial field (triggers RTL13a reattach)
    mock.active_connection!.send_to_client({
      action: 13, // DETACHED
      channel: 'test-RTL15b-irrelevant',
      channelSerial: 'serial-should-not-apply',
      error: { code: 90198, statusCode: 500, message: 'Detached' },
    });

    // Wait for the reattach to complete
    await pollUntil(() => channel.state === 'attached' && attachCount >= 2);

    // channelSerial should be from the new ATTACHED, not from the DETACHED
    expect(attachCount).to.equal(2);
    expect(channel.properties.channelSerial).to.equal('serial-001');
    client.close();
  });
});
