/**
 * UTS: RealtimePresence Get Tests
 *
 * Spec points: RTP11, RTP11a, RTP11b, RTP11c, RTP11c1, RTP11c2, RTP11c3, RTP11d
 * Source: specification/uts/realtime/unit/presence/realtime_presence_get.md
 *
 * Tests the RealtimePresence#get function which returns the list of current
 * members on the channel from the local PresenceMap. By default it waits for
 * the SYNC to complete. Supports filtering by clientId and connectionId, and
 * has specific error behaviour for SUSPENDED channels.
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
import RealtimeChannel from '../../../../../src/common/lib/client/realtimechannel';

describe('uts/realtime/unit/presence/realtime_presence_get', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTP11a - get returns current members (single-message sync)
   *
   * Returns the list of current members on the channel. By default, will wait
   * for the SYNC to be completed. A single-message sync has ATTACHED with
   * HAS_PRESENCE, followed by a SYNC with empty cursor.
   */
  // UTS: realtime/unit/RTP11a/get-returns-members-single-sync-0
  it('RTP11a - get returns current members after single-message sync', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH - send ATTACHED with HAS_PRESENCE but do NOT send SYNC yet
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 1, // HAS_PRESENCE
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

    const channel: RealtimeChannel = client.channels.get('test-RTP11a-single');
    await channel.attach();

    // Start get() -- sync has not arrived yet, so this must wait
    let getResolved = false;
    const getFuture = channel.presence.get().then((result) => {
      getResolved = true;
      return result;
    });

    // Give a tick to confirm get has not resolved yet
    await flushAsync();
    expect(getResolved).to.be.false;

    // Now send a single-message SYNC (empty cursor = complete)
    mock.active_connection!.send_to_client({
      action: 16, // SYNC
      channel: 'test-RTP11a-single',
      channelSerial: 'seq1:',
      presence: [
        { action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100, data: 'a' },
        { action: 1, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100, data: 'b' },
      ],
    });

    const members = await getFuture;

    expect(members.length).to.equal(2);
    const clientIds = members.map((m: any) => m.clientId).sort();
    expect(clientIds).to.deep.equal(['alice', 'bob']);
  });

  /**
   * RTP11a, RTP11c1 - get waits for multi-message sync
   *
   * When waitForSync is true (default), the method will wait until SYNC is
   * complete before returning. A multi-message sync has a non-empty cursor in
   * the first message and an empty cursor in the final message.
   */
  // UTS: realtime/unit/RTP11a/get-waits-for-multi-sync-1
  it('RTP11a, RTP11c1 - get waits for multi-message sync', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH - send ATTACHED with HAS_PRESENCE but no SYNC yet
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 1, // HAS_PRESENCE
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

    const channel: RealtimeChannel = client.channels.get('test-RTP11c1-multi');
    await channel.attach();

    // Start get() -- sync has not arrived yet
    let getResolved = false;
    const getFuture = channel.presence.get().then((result) => {
      getResolved = true;
      return result;
    });

    // Verify not resolved yet
    await flushAsync();
    expect(getResolved).to.be.false;

    // Send first SYNC message (non-empty cursor = more to come)
    mock.active_connection!.send_to_client({
      action: 16, // SYNC
      channel: 'test-RTP11c1-multi',
      channelSerial: 'seq1:cursor1',
      presence: [{ action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }],
    });

    // get() should still be waiting -- sync not complete
    await flushAsync();
    expect(getResolved).to.be.false;

    // Send final SYNC message (empty cursor = sync complete)
    mock.active_connection!.send_to_client({
      action: 16, // SYNC
      channel: 'test-RTP11c1-multi',
      channelSerial: 'seq1:',
      presence: [{ action: 1, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }],
    });

    const members = await getFuture;

    // Both alice (from first SYNC message) and bob (from second) are present
    expect(members.length).to.equal(2);
    const clientIds = members.map((m: any) => m.clientId).sort();
    expect(clientIds).to.deep.equal(['alice', 'bob']);
  });

  /**
   * RTP11c1 - get with waitForSync=false returns immediately
   *
   * When waitForSync is false, the known set of presence members is returned
   * immediately, which may be incomplete if the SYNC is not finished.
   */
  // UTS: realtime/unit/RTP11c1/get-no-wait-returns-immediately-0
  it('RTP11c1 - get with waitForSync=false returns immediately', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'conn-1',
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 1, // HAS_PRESENCE
          });
          // Start SYNC but don't complete it (cursor is non-empty)
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

    const channel = client.channels.get('test-RTP11c1-nowait');
    await channel.attach();

    // Allow sync messages to be processed
    await flushAsync();

    // Sync is in progress but we don't wait
    const members = await channel.presence.get({ waitForSync: false });

    // Returns what's available so far (may be incomplete)
    expect(members.length).to.equal(1);
    expect(members[0].clientId).to.equal('alice');
  });

  /**
   * RTP11c2 - get filtered by clientId
   *
   * clientId param filters members by the provided clientId.
   */
  // UTS: realtime/unit/RTP11c2/get-filtered-by-clientid-0
  it('RTP11c2 - get filtered by clientId', async function () {
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
            presence: [
              { action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 },
              { action: 1, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 },
              { action: 1, clientId: 'alice', connectionId: 'c3', id: 'c3:0:0', timestamp: 100 },
            ],
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

    const channel = client.channels.get('test-RTP11c2');
    await channel.attach();

    const members = await channel.presence.get({ clientId: 'alice' });

    // Only alice entries returned (from two different connections)
    expect(members.length).to.equal(2);
    expect(members.every((m: any) => m.clientId === 'alice')).to.be.true;
  });

  /**
   * RTP11c3 - get filtered by connectionId
   *
   * connectionId param filters members by the provided connectionId.
   */
  // UTS: realtime/unit/RTP11c3/get-filtered-by-connectionid-0
  it('RTP11c3 - get filtered by connectionId', async function () {
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
            presence: [
              { action: 1, clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 },
              { action: 1, clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 },
              { action: 1, clientId: 'carol', connectionId: 'c1', id: 'c1:0:1', timestamp: 100 },
            ],
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

    const channel = client.channels.get('test-RTP11c3');
    await channel.attach();

    const members = await channel.presence.get({ connectionId: 'c1' });

    // Only members from connection c1 (alice and carol)
    expect(members.length).to.equal(2);
    expect(members.every((m: any) => m.connectionId === 'c1')).to.be.true;
  });

  /**
   * RTP11b - get implicitly attaches channel
   *
   * Implicitly attaches the RealtimeChannel if the channel is in the
   * INITIALIZED state.
   */
  // UTS: realtime/unit/RTP11b/get-implicitly-attaches-0
  it('RTP11b - get implicitly attaches channel', async function () {
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

    const channel = client.channels.get('test-RTP11b');
    expect(channel.state).to.equal('initialized');

    const members = await channel.presence.get({ waitForSync: false });

    expect(channel.state).to.equal('attached');
    expect(members).to.not.be.null;
  });

  /**
   * RTP11d - get on SUSPENDED channel errors by default
   *
   * If the RealtimeChannel is SUSPENDED, get will by default (or if
   * waitForSync is true) result in an error with code 91005.
   */
  // UTS: realtime/unit/RTP11d/get-suspended-errors-default-0
  it('RTP11d - get on SUSPENDED channel errors by default', async function () {
    let connectCount = 0;

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
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-RTP11d');
    await channel.attach();

    // Simulate channel becoming SUSPENDED
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

    // Default get (waitForSync=true) should error
    try {
      await channel.presence.get();
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.not.be.null;
      expect(err.code).to.equal(91005);
    }
  });

  /**
   * RTP11d - get on SUSPENDED channel with waitForSync=false returns members
   *
   * If waitForSync is false on a SUSPENDED channel, return the members
   * currently in the PresenceMap.
   */
  // UTS: realtime/unit/RTP11d/get-suspended-no-wait-returns-1
  it('RTP11d - get on SUSPENDED channel with waitForSync=false returns members', async function () {
    let connectCount = 0;

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
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-RTP11d-nowait');
    await channel.attach();

    // Simulate channel becoming SUSPENDED
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

    // waitForSync=false returns what's in the PresenceMap
    const members = await channel.presence.get({ waitForSync: false });

    expect(members.length).to.equal(1);
    expect(members[0].clientId).to.equal('alice');
  });
});
