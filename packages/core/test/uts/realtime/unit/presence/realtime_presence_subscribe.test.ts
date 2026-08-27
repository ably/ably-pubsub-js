/**
 * UTS: RealtimePresence Subscribe/Unsubscribe Tests
 *
 * Spec points: RTP6, RTP6a, RTP6b, RTP6d, RTP6e, RTP7, RTP7a, RTP7b, RTP7c
 * Source: specification/uts/realtime/unit/presence/realtime_presence_subscribe.md
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, trackClient, installMockWebSocket, restoreAll, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/presence/realtime_presence_subscribe', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTP6a - Subscribe to all presence events
   *
   * Subscribe with a single listener argument subscribes a listener to
   * all presence messages.
   */
  // UTS: realtime/unit/RTP6a/subscribe-all-presence-events-0
  it('RTP6a - subscribe to all presence events', async function () {
    const channelName = `test-RTP6a-${Date.now()}`;

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
            channel: channelName,
            flags: 1, // HAS_PRESENCE
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName);
    const receivedEvents: any[] = [];

    channel.presence.subscribe((event: any) => {
      receivedEvents.push(event);
    });

    // Wait for implicit attach
    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    // Server delivers ENTER, UPDATE, and LEAVE events
    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [{ action: 2, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 1000 }],
    });

    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [{ action: 4, clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 2000, data: 'updated' }],
    });

    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [{ action: 3, clientId: 'alice', connectionId: 'c1', id: 'c1:2:0', timestamp: 3000 }],
    });

    await flushAsync();

    expect(receivedEvents.length).to.equal(3);
    expect(receivedEvents[0].action).to.equal('enter');
    expect(receivedEvents[0].clientId).to.equal('alice');
    expect(receivedEvents[1].action).to.equal('update');
    expect(receivedEvents[1].data).to.equal('updated');
    expect(receivedEvents[2].action).to.equal('leave');

    client.close();
  });

  /**
   * RTP6b - Subscribe filtered by action
   *
   * Subscribe with an action argument and a listener subscribes the
   * listener to receive only presence messages with that action.
   */
  // UTS: realtime/unit/RTP6b/subscribe-filtered-by-action-0
  it('RTP6b - subscribe filtered by single action', async function () {
    const channelName = `test-RTP6b-${Date.now()}`;

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
            channel: channelName,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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

    const enterEvents: any[] = [];
    const leaveEvents: any[] = [];

    channel.presence.subscribe('enter', (event: any) => {
      enterEvents.push(event);
    });

    channel.presence.subscribe('leave', (event: any) => {
      leaveEvents.push(event);
    });

    // Server delivers all three action types
    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [
        { action: 2, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 1000 },
        { action: 4, clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 2000 },
        { action: 3, clientId: 'alice', connectionId: 'c1', id: 'c1:2:0', timestamp: 3000 },
      ],
    });

    await flushAsync();

    // ENTER listener only gets ENTER events
    expect(enterEvents.length).to.equal(1);
    expect(enterEvents[0].action).to.equal('enter');

    // LEAVE listener only gets LEAVE events
    expect(leaveEvents.length).to.equal(1);
    expect(leaveEvents[0].action).to.equal('leave');

    client.close();
  });

  /**
   * RTP6b - Subscribe filtered by multiple actions
   *
   * The action argument may also be an array of actions.
   */
  // UTS: realtime/unit/RTP6b/subscribe-filtered-multiple-actions-1
  it('RTP6b - subscribe filtered by multiple actions', async function () {
    const channelName = `test-RTP6b-multi-${Date.now()}`;

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
            channel: channelName,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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

    const enterLeaveEvents: any[] = [];
    channel.presence.subscribe(['enter', 'leave'], (event: any) => {
      enterLeaveEvents.push(event);
    });

    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [
        { action: 2, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 1000 },
        { action: 4, clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 2000 },
        { action: 3, clientId: 'alice', connectionId: 'c1', id: 'c1:2:0', timestamp: 3000 },
      ],
    });

    await flushAsync();

    // Only ENTER and LEAVE events received -- UPDATE filtered out
    expect(enterLeaveEvents.length).to.equal(2);
    expect(enterLeaveEvents[0].action).to.equal('enter');
    expect(enterLeaveEvents[1].action).to.equal('leave');

    client.close();
  });

  /**
   * RTP6d - Subscribe implicitly attaches channel
   *
   * If the attachOnSubscribe channel option is true (default),
   * implicitly attach the RealtimeChannel.
   */
  // UTS: realtime/unit/RTP6d/subscribe-implicitly-attaches-0
  it('RTP6d - subscribe implicitly attaches channel', async function () {
    const channelName = `test-RTP6d-${Date.now()}`;
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
            channel: channelName,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'fake.key:secret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get(channelName);
    expect(channel.state).to.equal('initialized');

    // Subscribe without explicitly attaching -- should trigger implicit attach
    channel.presence.subscribe((event: any) => {});

    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    expect(attachCount).to.equal(1);
    expect(channel.state).to.equal('attached');

    client.close();
  });

  /**
   * RTP6e - Subscribe with attachOnSubscribe=false does not attach
   *
   * If the attachOnSubscribe channel option is false, do not
   * implicitly attach.
   */
  // UTS: realtime/unit/RTP6e/subscribe-no-attach-option-0
  it('RTP6e - subscribe with attachOnSubscribe=false does not attach', async function () {
    const channelName = `test-RTP6e-${Date.now()}`;
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
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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

    channel.presence.subscribe((event: any) => {});

    await flushAsync();

    // Channel stays in INITIALIZED -- no implicit attach
    expect(channel.state).to.equal('initialized');
    expect(attachCount).to.equal(0);

    client.close();
  });

  /**
   * RTP7c - Unsubscribe all listeners
   *
   * Unsubscribe with no arguments unsubscribes all listeners.
   */
  // UTS: realtime/unit/RTP7c/unsubscribe-all-listeners-0
  it('RTP7c - unsubscribe all listeners', async function () {
    const channelName = `test-RTP7c-${Date.now()}`;

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
            channel: channelName,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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

    const eventsA: any[] = [];
    const eventsB: any[] = [];

    channel.presence.subscribe((event: any) => {
      eventsA.push(event);
    });
    channel.presence.subscribe((event: any) => {
      eventsB.push(event);
    });

    // Deliver first event -- both listeners receive it
    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [{ action: 2, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 1000 }],
    });

    await flushAsync();

    expect(eventsA.length).to.equal(1);
    expect(eventsB.length).to.equal(1);

    // Unsubscribe all
    channel.presence.unsubscribe();

    // Deliver second event -- no listeners receive it
    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [{ action: 2, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 2000 }],
    });

    await flushAsync();

    expect(eventsA.length).to.equal(1); // No new events after unsubscribe
    expect(eventsB.length).to.equal(1);

    client.close();
  });

  /**
   * RTP7a - Unsubscribe specific listener
   *
   * Unsubscribe with a single listener argument unsubscribes that
   * specific listener.
   */
  // UTS: realtime/unit/RTP7a/unsubscribe-specific-listener-0
  it('RTP7a - unsubscribe specific listener', async function () {
    const channelName = `test-RTP7a-${Date.now()}`;

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
            channel: channelName,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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

    const eventsA: any[] = [];
    const eventsB: any[] = [];

    const listenerA = (event: any) => {
      eventsA.push(event);
    };
    const listenerB = (event: any) => {
      eventsB.push(event);
    };

    channel.presence.subscribe(listenerA);
    channel.presence.subscribe(listenerB);

    // Unsubscribe only listenerA
    channel.presence.unsubscribe(listenerA);

    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [{ action: 2, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 1000 }],
    });

    await flushAsync();

    expect(eventsA.length).to.equal(0); // Unsubscribed -- no events
    expect(eventsB.length).to.equal(1); // Still subscribed -- receives event

    client.close();
  });

  /**
   * RTP7b - Unsubscribe listener for specific action
   *
   * Unsubscribe with an action argument and a listener unsubscribes
   * the listener for that action only.
   */
  // UTS: realtime/unit/RTP7b/unsubscribe-for-specific-action-0
  it('RTP7b - unsubscribe listener for specific action', async function () {
    const channelName = `test-RTP7b-${Date.now()}`;

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
            channel: channelName,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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

    const received: any[] = [];
    const listener = (event: any) => {
      received.push(event);
    };

    // Subscribe to both ENTER and LEAVE
    channel.presence.subscribe('enter', listener);
    channel.presence.subscribe('leave', listener);

    // Unsubscribe only for ENTER
    channel.presence.unsubscribe('enter', listener);

    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [
        { action: 2, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 1000 },
        { action: 3, clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 2000 },
      ],
    });

    await flushAsync();

    // Only LEAVE received -- ENTER subscription was removed
    expect(received.length).to.equal(1);
    expect(received[0].action).to.equal('leave');

    client.close();
  });

  /**
   * RTP6 - Presence events update the PresenceMap
   *
   * Incoming presence messages are applied to the PresenceMap (RTP2)
   * before being emitted to subscribers.
   */
  // UTS: realtime/unit/RTP6/presence-events-update-map-0
  it('RTP6 - presence events update the PresenceMap', async function () {
    const channelName = `test-RTP6-map-${Date.now()}`;

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
            channel: channelName,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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

    channel.presence.subscribe((event: any) => {});

    // Server delivers ENTER
    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [{ action: 2, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 1000, data: 'hello' }],
    });

    await flushAsync();

    const members = await channel.presence.get({ waitForSync: false });

    expect(members.length).to.equal(1);
    expect(members[0].clientId).to.equal('alice');
    expect(members[0].data).to.equal('hello');
    expect(members[0].action).to.equal('present'); // Stored as PRESENT per RTP2d2

    client.close();
  });

  /**
   * RTP6 - Multiple presence messages in single ProtocolMessage
   *
   * A PRESENCE ProtocolMessage may contain multiple PresenceMessages.
   */
  // UTS: realtime/unit/RTP6/multiple-presence-in-single-message-1
  it('RTP6 - multiple presence messages in single ProtocolMessage', async function () {
    const channelName = `test-RTP6-batch-${Date.now()}`;

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
            channel: channelName,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

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

    const received: any[] = [];
    channel.presence.subscribe((event: any) => {
      received.push(event);
    });

    // Server delivers multiple presence events in one ProtocolMessage
    mock.active_connection!.send_to_client({
      action: 14, // PRESENCE
      channel: channelName,
      presence: [
        { action: 2, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 1000 },
        { action: 2, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 1000 },
        { action: 2, clientId: 'carol', connectionId: 'c3', id: 'c3:0:0', timestamp: 1000 },
      ],
    });

    await flushAsync();

    expect(received.length).to.equal(3);
    expect(received[0].clientId).to.equal('alice');
    expect(received[1].clientId).to.equal('bob');
    expect(received[2].clientId).to.equal('carol');

    client.close();
  });
});
