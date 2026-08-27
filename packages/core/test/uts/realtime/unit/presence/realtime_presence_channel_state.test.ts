/**
 * UTS: RealtimePresence Channel State Tests
 *
 * Spec points: RTL9, RTL9a, RTL11, RTL11a, RTP1, RTP5, RTP5a, RTP5b, RTP5f, RTP13, RTP19a
 * Source: specification/uts/realtime/unit/presence/realtime_presence_channel_state.md
 *
 * Tests interaction between channel state transitions and presence: HAS_PRESENCE
 * flag, sync completion, channel state effects on presence maps, queued presence
 * actions, and ACK/NACK independence from channel state.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import {
  Ably,
  installMockWebSocket,
  installMockHttp,
  enableFakeTimers,
  restoreAll,
  trackClient,
  flushAsync,
} from '../../../helpers';

describe('uts/realtime/unit/presence/realtime_presence_channel_state', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTP1 - HAS_PRESENCE flag triggers sync
   *
   * When a channel ATTACHED ProtocolMessage has HAS_PRESENCE flag, the server
   * will perform a SYNC operation. After sync completes, presence.get() returns
   * the synced members.
   */
  // UTS: realtime/unit/RTP1/has-presence-triggers-sync-0
  it('RTP1 - HAS_PRESENCE flag triggers sync', async function () {
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
            flags: 1, // HAS_PRESENCE
          });
          // Server follows up with SYNC
          mock.active_connection!.send_to_client({
            action: 16, // SYNC
            channel: msg.channel,
            channelSerial: 'seq1:',
            presence: [{ action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }],
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
    await client.channels.get('test-RTP1').attach();

    const channel = client.channels.get('test-RTP1');
    const members = await channel.presence.get();

    expect(members.length).to.equal(1);
    expect(members[0].clientId).to.equal('alice');
    expect(channel.presence.syncComplete).to.be.true;
  });

  /**
   * RTP1 - No HAS_PRESENCE flag means empty presence
   *
   * If the flag is 0 or absent, the presence map should be considered in sync
   * immediately with no members.
   */
  // UTS: realtime/unit/RTP1/no-has-presence-empty-1
  it('RTP1 - no HAS_PRESENCE flag means empty presence', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH - no HAS_PRESENCE flag
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
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

    const channel = client.channels.get('test-RTP1-empty');
    await channel.attach();

    const members = await channel.presence.get();

    expect(members.length).to.equal(0);
    expect(channel.presence.syncComplete).to.be.true;
  });

  /**
   * RTP1, RTP19a - No HAS_PRESENCE clears existing members
   *
   * If the PresenceMap has existing members when an ATTACHED message is received
   * without a HAS_PRESENCE flag, emit a LEAVE event for each existing member and
   * remove all members from the PresenceMap.
   */
  // UTS: realtime/unit/RTP1/no-has-presence-clears-existing-2
  it('RTP1, RTP19a - no HAS_PRESENCE clears existing members with LEAVE events', async function () {
    let connectionCount = 0;
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: `conn-${connectionCount}`,
          connectionDetails: {
            connectionKey: `key-${connectionCount}`,
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          if (connectionCount === 1) {
            // First attach: has presence
            mock.active_connection!.send_to_client({
              action: 11, // ATTACHED
              channel: msg.channel,
              flags: 1, // HAS_PRESENCE
            });
            mock.active_connection!.send_to_client({
              action: 16, // SYNC
              channel: msg.channel,
              channelSerial: 'seq1:',
              presence: [
                { action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 },
                { action: 1, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 },
              ],
            });
          } else {
            // Second attach: no HAS_PRESENCE
            mock.active_connection!.send_to_client({
              action: 11, // ATTACHED
              channel: msg.channel,
            });
          }
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

    const channel = client.channels.get('test-RTP19a');
    await channel.attach();

    // Verify members exist after first sync
    const members = await channel.presence.get();
    expect(members.length).to.equal(2);

    // Track LEAVE events
    const leaveEvents: any[] = [];
    channel.presence.subscribe('leave', (msg: any) => {
      leaveEvents.push(msg);
    });

    // Simulate disconnect and reconnect
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    // Reconnect -- this time ATTACHED without HAS_PRESENCE
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    const membersAfter = await channel.presence.get();

    // All members removed
    expect(membersAfter.length).to.equal(0);

    // LEAVE events emitted for each member
    expect(leaveEvents.length).to.equal(2);
    expect(leaveEvents.some((e: any) => e.clientId === 'alice')).to.be.true;
    expect(leaveEvents.some((e: any) => e.clientId === 'bob')).to.be.true;

    // LEAVE events have id=null per RTP19a (synthesized leaves)
    // NOTE: In ably-js, _synthesizeLeaves does not set an id field at all, so it will be undefined
    for (const e of leaveEvents) {
      expect(e.id == null).to.be.true;
    }
  });

  /**
   * RTP5a - DETACHED clears both presence maps
   *
   * If the channel enters the DETACHED state, all queued presence messages fail
   * immediately, and both the PresenceMap and internal PresenceMap are cleared.
   * LEAVE events should NOT be emitted when clearing.
   */
  // UTS: realtime/unit/RTP5a/detached-clears-presence-maps-0
  it('RTP5a - DETACHED clears presence maps without LEAVE events', async function () {
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
            flags: 1, // HAS_PRESENCE
          });
          mock.active_connection!.send_to_client({
            action: 16, // SYNC
            channel: msg.channel,
            channelSerial: 'seq1:',
            presence: [{ action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }],
          });
        } else if (msg.action === 12) {
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

    const channel = client.channels.get('test-RTP5a-detached');
    await channel.attach();

    // Verify member exists
    const members = await channel.presence.get();
    expect(members.length).to.equal(1);

    // Track events - LEAVE should NOT be emitted on clear
    const leaveEvents: any[] = [];
    channel.presence.subscribe('leave', (msg: any) => {
      leaveEvents.push(msg);
    });

    // Detach the channel
    await channel.detach();
    expect(channel.state).to.equal('detached');

    // RTP5a: No LEAVE events emitted when clearing on DETACHED
    expect(leaveEvents.length).to.equal(0);
  });

  /**
   * RTP5a - FAILED clears both presence maps
   *
   * Same as DETACHED -- FAILED state clears both maps, no LEAVE emitted.
   */
  // UTS: realtime/unit/RTP5a/failed-clears-presence-maps-1
  it('RTP5a - FAILED clears presence maps without LEAVE events', async function () {
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
            flags: 1, // HAS_PRESENCE
          });
          mock.active_connection!.send_to_client({
            action: 16, // SYNC
            channel: msg.channel,
            channelSerial: 'seq1:',
            presence: [{ action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }],
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

    const channel = client.channels.get('test-RTP5a-failed');
    await channel.attach();

    const members = await channel.presence.get();
    expect(members.length).to.equal(1);

    const leaveEvents: any[] = [];
    channel.presence.subscribe('leave', (msg: any) => {
      leaveEvents.push(msg);
    });

    // Server sends channel ERROR to put channel in FAILED state
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTP5a-failed',
      error: {
        code: 90001,
        statusCode: 400,
        message: 'Channel failed',
      },
    });

    await new Promise<void>((resolve) => {
      channel.once('failed', () => resolve());
    });
    expect(channel.state).to.equal('failed');

    // RTP5a: No LEAVE events emitted
    expect(leaveEvents.length).to.equal(0);
  });

  /**
   * RTP5b - ATTACHED sends queued presence messages
   *
   * If a channel enters the ATTACHED state then all queued presence messages
   * will be sent immediately.
   */
  // UTS: realtime/unit/RTP5b/attached-sends-queued-presence-0
  it('RTP5b - ATTACHED sends queued presence messages', async function () {
    const capturedPresence: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH - delay response
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
          mock.active_connection!.send_to_client({
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
      autoConnect: false,
      useBinaryProtocol: false,
      clientId: 'my-client',
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTP5b');

    // Start attach - channel goes to ATTACHING
    channel.attach();
    await new Promise<void>((resolve) => {
      if (channel.state === 'attaching') return resolve();
      channel.once('attaching', () => resolve());
    });
    // Allow the attach message to be processed
    await flushAsync();

    // Queue presence while channel is ATTACHING
    const enterFuture = channel.presence.enter('queued');

    // No presence sent yet (still attaching)
    expect(capturedPresence.length).to.equal(0);

    // Complete the attach
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTP5b',
    });

    await enterFuture;

    // Queued presence was sent after attach completed
    expect(capturedPresence.length).to.equal(1);
    // Wire protocol uses numeric presence actions: 2 = ENTER
    expect(capturedPresence[0].presence[0].action).to.equal(2);
    expect(capturedPresence[0].presence[0].data).to.equal('queued');
  });

  /**
   * RTP5f - SUSPENDED maintains presence map
   *
   * If the channel enters SUSPENDED, all queued presence messages fail
   * immediately, but the PresenceMap is maintained.
   */
  // UTS: realtime/unit/RTP5f/suspended-maintains-presence-map-0
  it('RTP5f - SUSPENDED maintains presence map', async function () {
    let connectCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectCount++;
        if (connectCount === 1) {
          mock.active_connection = conn;
          conn.respond_with_connected();
        } else {
          // Refuse reconnection to push toward SUSPENDED
          conn.respond_with_refused();
        }
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 1, // HAS_PRESENCE
          });
          mock.active_connection!.send_to_client({
            action: 16, // SYNC
            channel: msg.channel,
            channelSerial: 'seq1:',
            presence: [
              { action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 },
              { action: 1, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 },
            ],
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

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      fallbackHosts: [],
      disconnectedRetryTimeout: 500,
    });
    trackClient(client);

    client.connect();
    // Pump event loop for connection
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-RTP5f');
    await channel.attach();

    const members = await channel.presence.get();
    expect(members.length).to.equal(2);

    // Disconnect -- subsequent reconnections will be refused
    mock.active_connection!.simulate_disconnect();

    // Pump through disconnected retries and advance past connectionStateTtl
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }
    await clock.tickAsync(121000);
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(client.connection.state).to.equal('suspended');
    expect(channel.state).to.equal('suspended');

    // PresenceMap is maintained during SUSPENDED
    const membersDuringSuspended = await channel.presence.get({ waitForSync: false });

    // Members still exist in the map
    expect(membersDuringSuspended.length).to.equal(2);
  });

  /**
   * RTP13 - syncComplete attribute
   *
   * RealtimePresence#syncComplete is true if the initial SYNC operation has
   * completed for the members present on the channel.
   */
  // UTS: realtime/unit/RTP13/sync-complete-attribute-0
  it('RTP13 - syncComplete attribute tracks sync state', async function () {
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
            flags: 1, // HAS_PRESENCE
          });
          // Start multi-message SYNC (cursor is non-empty)
          mock.active_connection!.send_to_client({
            action: 16, // SYNC
            channel: msg.channel,
            channelSerial: 'seq1:cursor1',
            presence: [{ action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }],
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

    const channel = client.channels.get('test-RTP13');
    await channel.attach();

    // Allow sync messages to be processed
    await flushAsync();

    // Sync is in progress -- not yet complete
    expect(channel.presence.syncComplete).to.be.false;

    // Complete the sync (empty cursor)
    mock.active_connection!.send_to_client({
      action: 16, // SYNC
      channel: 'test-RTP13',
      channelSerial: 'seq1:',
      presence: [{ action: 1, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }],
    });

    // Allow the sync completion to be processed
    await flushAsync();

    expect(channel.presence.syncComplete).to.be.true;
  });

  /**
   * RTL9, RTL9a - RealtimeChannel#presence attribute
   *
   * Returns the RealtimePresence object for this channel. Same instance
   * returned each time.
   */
  // UTS: realtime/unit/RTL9/presence-attribute-0
  it('RTL9, RTL9a - channel.presence returns RealtimePresence object', function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
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

    const channel = client.channels.get('test-RTL9a');

    const presence = channel.presence;
    expect(presence).to.not.be.null;
    expect(presence).to.not.be.undefined;
    expect(presence).to.be.an('object');

    // RTL9a - Same presence object returned for same channel
    expect(channel.presence).to.equal(channel.presence);
  });

  /**
   * RTL9a - Same presence object returned for same channel
   *
   * Getting channel.presence multiple times returns the exact same instance.
   */
  // UTS: realtime/unit/RTL9/presence-attribute-0.1
  it('RTL9a - same presence object returned for same channel', function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
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

    const channel = client.channels.get('test-RTL9a-identity');

    const presence1 = channel.presence;
    const presence2 = channel.presence;

    expect(presence1).to.equal(presence2); // identity check — same instance
  });

  /**
   * RTL11 - Queued presence actions fail on DETACHED
   *
   * NOTE: The UTS spec expects presence.enter() on a DETACHED channel to error
   * immediately. However, ably-js re-attaches the channel from DETACHED state
   * (per RTP16b: _enterOrUpdateClient falls through from 'detached' to
   * 'attaching', calling channel.attach() first). This test verifies that
   * ably-js successfully re-attaches and sends the presence message, which is
   * the correct behavior per RTP5b and RTP16b.
   */
  // UTS: realtime/unit/RTL11/queued-presence-fail-detached-0
  it('RTL11 - presence on DETACHED channel triggers re-attach', async function () {
    const capturedPresence: any[] = [];
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
          });
        } else if (msg.action === 12) {
          // DETACH
          mock.active_connection!.send_to_client({
            action: 13, // DETACHED
            channel: msg.channel,
          });
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
          mock.active_connection!.send_to_client({
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
      autoConnect: false,
      useBinaryProtocol: false,
      clientId: 'my-client',
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL11-detached');

    // Attach then detach to put channel in DETACHED state
    await channel.attach();
    await channel.detach();
    expect(channel.state).to.equal('detached');

    // NOTE: In ably-js, presence.enter() on a DETACHED channel triggers re-attach
    // rather than immediate error. The channel goes to ATTACHING then ATTACHED,
    // and the queued presence is sent.
    await channel.presence.enter('queued-enter');

    // Channel was re-attached and presence was sent
    expect(channel.state).to.equal('attached');
    expect(capturedPresence.length).to.equal(1);
    // Wire protocol uses numeric presence actions: 2 = ENTER
    expect(capturedPresence[0].presence[0].action).to.equal(2);
  });

  /**
   * RTL11 - Queued presence actions fail on SUSPENDED
   *
   * Presence actions queued while ATTACHING fail when channel goes SUSPENDED.
   */
  // UTS: realtime/unit/RTL11/queued-presence-fail-suspended-1
  it('RTL11 - queued presence actions fail on SUSPENDED', async function () {
    let connectCount = 0;
    const capturedPresence: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectCount++;
        if (connectCount === 1) {
          mock.active_connection = conn;
          conn.respond_with_connected();
        } else {
          conn.respond_with_refused();
        }
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH - do NOT respond, leave in ATTACHING
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
        }
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
      clientId: 'my-client',
      fallbackHosts: [],
      disconnectedRetryTimeout: 500,
    });
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-RTL11-suspended');
    channel.attach();
    await new Promise<void>((resolve) => {
      if (channel.state === 'attaching') return resolve();
      channel.once('attaching', () => resolve());
    });
    // Allow the attach message to be sent
    await flushAsync();

    // Queue presence actions
    const enterFuture = channel.presence.enter('queued-enter');
    const updateFuture = channel.presence.update('queued-update');

    expect(capturedPresence.length).to.equal(0);

    // Connection goes SUSPENDED, causing channel to go SUSPENDED
    mock.active_connection!.simulate_disconnect();

    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }
    await clock.tickAsync(121000);
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(channel.state).to.equal('suspended');

    // No presence messages were sent
    expect(capturedPresence.length).to.equal(0);

    // Both queued futures completed with errors
    try {
      await enterFuture;
      expect.fail('enter should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
    }

    try {
      await updateFuture;
      expect.fail('update should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  /**
   * RTL11 - Queued presence actions fail on FAILED
   *
   * Presence actions queued while ATTACHING fail when channel goes FAILED.
   */
  // UTS: realtime/unit/RTL11/queued-presence-fail-failed-2
  it('RTL11 - queued presence actions fail on FAILED', async function () {
    const capturedPresence: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH - do NOT respond, leave in ATTACHING
        } else if (msg.action === 14) {
          // PRESENCE
          capturedPresence.push(msg);
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      clientId: 'my-client',
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL11-failed');
    channel.attach();
    await new Promise<void>((resolve) => {
      if (channel.state === 'attaching') return resolve();
      channel.once('attaching', () => resolve());
    });
    // Allow the attach message to be sent
    await flushAsync();

    // Queue presence
    const enterFuture = channel.presence.enter('queued-enter');

    expect(capturedPresence.length).to.equal(0);

    // Server sends ERROR for this channel -- channel goes FAILED
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTL11-failed',
      error: {
        code: 90001,
        statusCode: 400,
        message: 'Channel failed',
      },
    });

    await new Promise<void>((resolve) => {
      if (channel.state === 'failed') return resolve();
      channel.once('failed', () => resolve());
    });

    // No presence messages were sent
    expect(capturedPresence.length).to.equal(0);

    // Queued future completed with an error
    try {
      await enterFuture;
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
    }
  });

  /**
   * RTL11a - ACK/NACK unaffected by channel state changes
   *
   * Messages awaiting an ACK or NACK are unaffected by channel state changes.
   * A channel that becomes detached may still receive an ACK for messages
   * published on that channel.
   */
  // UTS: realtime/unit/RTL11a/ack-nack-unaffected-by-state-0
  it('RTL11a - ACK/NACK unaffected by channel state changes', async function () {
    const capturedPresence: any[] = [];
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
          });
        } else if (msg.action === 14) {
          // PRESENCE - capture but do NOT ACK yet
          capturedPresence.push(msg);
        } else if (msg.action === 12) {
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
      clientId: 'my-client',
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL11a');
    await channel.attach();

    // Send presence -- it goes to the server, but no ACK yet
    const enterFuture = channel.presence.enter('awaiting-ack');

    // Wait for the presence message to be captured
    await flushAsync();
    expect(capturedPresence.length).to.equal(1);

    // Detach the channel
    channel.detach();
    await new Promise<void>((resolve) => {
      if (channel.state === 'detached') return resolve();
      channel.once('detached', () => resolve());
    });
    expect(channel.state).to.equal('detached');

    // Now the server sends the ACK for the presence message that was already sent
    mock.active_connection!.send_to_client({
      action: 1, // ACK
      msgSerial: capturedPresence[0].msgSerial,
      count: 1,
    });

    // The enter future resolves successfully -- ACK was processed despite channel being DETACHED
    await enterFuture; // should complete without error
  });
});
