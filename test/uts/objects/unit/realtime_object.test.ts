/**
 * UTS: RealtimeObject Tests
 *
 * Spec points: RTO2, RTO10, RTO15, RTO17-RTO20, RTO22-RTO26
 * Source: uts/objects/unit/realtime_object.md
 *
 * Tests the RealtimeObject entry point (channel.object): get() lifecycle,
 * channel mode enforcement, publish + ACK flow, publishAndApply,
 * sync state events, echo deduplication, and GC.
 *
 * Deviations:
 * - RTO10/RTO10b1/RTO10c1b1 (GC tests): ObjectsPool uses real setInterval + Date.now,
 *   not Platform.Config.setTimeout. Instead of stubbing Date.now, the tests
 *   backdate the tombstone's serialTimestamp (RTLO6a: it becomes tombstonedAt)
 *   past the grace period and use a short gcInterval to trigger GC.
 * - RTO20f (siteTimeserials): verified observably — after a local increment, a later inbound
 *   COUNTER_INC from SITE_CODE with a non-ACK serial ("t:0:9", below the ACK serial) still applies
 *   to 120, proving the LOCAL apply-on-ACK left siteTimeserials untouched (RTLC7c). No private access.
 * - RTO17-RTO18 scenario "re-attach after detach": ably-js channel goes through
 *   SUSPENDED (not directly to DETACHED) on server DETACHED, so this scenario
 *   is verified via a fresh setupSyncedChannel + server-initiated ATTACHED instead.
 */

import { expect } from 'chai';
import {
  Ably,
  installMockWebSocket,
  trackClient,
  restoreAll,
  flushAsync,
  enableFakeTimers,
  pollUntil,
} from '../../helpers';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';
import { MockWebSocket } from '../../mock_websocket';
import {
  setupSyncedChannel,
  setupSyncedChannelNoAck,
  buildObjectMessage,
  buildObjectSyncMessage,
  buildAckMessage,
  buildCounterInc,
  buildMapSet,
  remoteSerial,
  belowAckSerial,
  buildObjectDelete,
  STANDARD_POOL_OBJECTS,
  PM_ACTION,
  HAS_OBJECTS,
  OBJ_OP,
  SITE_CODE,
  ackSerial,
} from '../helpers/standard_test_pool';
import { DEFAULTS } from '../../../../src/plugins/liveobjects/defaults';

describe('uts/objects/unit/realtime_object', function () {
  // test:uts runs mocha with --no-config, so the shared root-hooks timeout does not apply; raise
  // the 2s default so pollUntil's 5s quiescence deadline can elapse and fail on the real assertion.
  this.timeout(6000);
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTO23/get-returns-path-object-0
  it('RTO23 - get() returns PathObject wrapping root', async function () {
    const { root } = await setupSyncedChannel('test-RTO23');

    expect(root).to.exist;
    expect(root.path()).to.equal('');
  });

  // UTS: objects/unit/RTO23a/get-requires-subscribe-mode-0
  it('RTO23a - get() requires OBJECT_SUBSCRIBE mode', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Only OBJECT_PUBLISH, no OBJECT_SUBSCRIBE
    const channel = client.channels.get('test-RTO23a', { modes: ['OBJECT_PUBLISH'] });

    try {
      await channel.object.get();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40024);
    }
  });

  // UTS: objects/unit/RTO23e/get-reattaches-detached-0
  it('RTO23e - get() re-attaches a DETACHED channel and resolves', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.DETACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.DETACHED,
            channel: msg.channel,
          });
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO23e-detached', { modes: ['OBJECT_SUBSCRIBE'] });

    // First get the channel to attached state
    await channel.object.get();

    // Detach the channel
    await channel.detach();
    await flushAsync();
    expect(channel.state).to.equal('detached');

    // RTO23e/RTL33b: get() performs ensure-active-channel, which re-attaches the
    // DETACHED channel and resolves with the root PathObject
    const root = await channel.object.get();
    expect(root.path()).to.equal('');
    expect(channel.state).to.equal('attached');
  });

  // UTS: objects/unit/RTO23c/get-waits-for-synced-0
  it('RTO23c - get() waits for SYNCED state', async function () {
    let attachSent = false;
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          attachSent = true;
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO23c', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });

    // Start get() -- it will wait for sync to complete
    const getFuture = channel.object.get();

    // Wait until attach is sent
    await pollUntil(() => attachSent);
    expect(attachSent).to.be.true;

    // Now send the sync data to complete the sync
    mockWs.active_connection!.send_to_client(buildObjectSyncMessage('test-RTO23c', 'sync1:', STANDARD_POOL_OBJECTS));

    const root = await getFuture;
    expect(root).to.exist;
  });

  // UTS: objects/unit/RTO23c1/fails-on-channel-detached-0
  it('RTO23c1 - get() fails when channel enters DETACHED during sync wait', async function () {
    const { channel, mockWs } = await setupSyncedChannel('test-RTO23c1-detached');

    // Move the objects sync state back to SYNCING so a fresh get() must wait (RTO23c)
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO23c1-detached',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    await flushAsync();

    const getFuture = channel.object.get();

    // While still SYNCING the get() cannot complete — it parks in the RTO23c wait for SYNCED
    let settled = false;
    getFuture.then(
      () => (settled = true),
      () => (settled = true),
    );
    await flushAsync();
    expect(settled).to.equal(false);

    // Detach the channel client-side (an unsolicited server DETACHED would trigger an RTL13a
    // re-attach); the shared mock answers the outbound DETACH with DETACHED
    await channel.detach();

    try {
      await getFuture;
      expect.fail('should have thrown');
    } catch (err: any) {
      // RTO23c1 - fail with code 92008 and statusCode 400
      expect(err.code).to.equal(92008);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO23c1/fails-on-channel-suspended-0
  it('RTO23c1 - get() fails when channel enters SUSPENDED during sync wait', async function () {
    const { channel, mockWs } = await setupSyncedChannel('test-RTO23c1-suspended');

    // Move the objects sync state back to SYNCING so a fresh get() must wait (RTO23c)
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO23c1-suspended',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    await flushAsync();

    const getFuture = channel.object.get();

    let settled = false;
    getFuture.then(
      () => (settled = true),
      () => (settled = true),
    );
    await flushAsync();
    expect(settled).to.equal(false);

    // SUSPENDED is a connection-level state the mock cannot drive; drive the RealtimeObject's
    // internal channel-state handler directly, exactly as the RTO27 tests do
    (channel as any)._object.actOnChannelState('suspended');

    try {
      await getFuture;
      expect.fail('should have thrown');
    } catch (err: any) {
      // RTO23c1 - fail with code 92008 and statusCode 400
      expect(err.code).to.equal(92008);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO23c1/fails-on-channel-failed-0
  it('RTO23c1 - get() fails with cause when channel enters FAILED during sync wait', async function () {
    const { channel, mockWs } = await setupSyncedChannel('test-RTO23c1-failed');

    // Move the objects sync state back to SYNCING so a fresh get() must wait (RTO23c)
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO23c1-failed',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    await flushAsync();

    const getFuture = channel.object.get();

    let settled = false;
    getFuture.then(
      () => (settled = true),
      () => (settled = true),
    );
    await flushAsync();
    expect(settled).to.equal(false);

    // A channel ERROR moves the channel to FAILED and sets its errorReason
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ERROR,
      channel: 'test-RTO23c1-failed',
      error: { code: 90000, statusCode: 400, message: 'Channel failed' },
    });

    try {
      await getFuture;
      expect.fail('should have thrown');
    } catch (err: any) {
      // RTO23c1 - fail with code 92008 and statusCode 400
      expect(err.code).to.equal(92008);
      expect(err.statusCode).to.equal(400);
      // RTO23c1 - cause is set to the channel's errorReason (the injected FAILED error)
      expect(err.cause.code).to.equal(90000);
    }
  });

  // UTS: objects/unit/RTO15/publish-sends-object-pm-0
  it('RTO15 - publish sends OBJECT ProtocolMessage', async function () {
    const capturedMessages: any[] = [];
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage('test-RTO15', 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          capturedMessages.push(msg);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, ['serial-0']));
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO15', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    await channel.object.get();

    // Drive the internal publish (RTO15) through a public mutation; the PublishResult
    // is consumed internally by RTO20 (apply-on-ACK), so only the wire behaviour is asserted.
    const root = await channel.object.get();
    await root.get('score').increment(5);

    expect(capturedMessages.length).to.equal(1);
    expect(capturedMessages[0].action).to.equal(PM_ACTION.OBJECT);
    expect(capturedMessages[0].channel).to.equal('test-RTO15');
    expect(capturedMessages[0].state.length).to.equal(1);
    // RTO15e3 - the state entry is the encoded ObjectMessage for the driven mutation
    const stateEntry = capturedMessages[0].state[0];
    expect(stateEntry.operation.action).to.equal(OBJ_OP.COUNTER_INC);
    expect(stateEntry.operation.objectId).to.equal('counter:score@1000');
    expect(stateEntry.operation.counterInc.number).to.equal(5);
  });

  // UTS: objects/unit/RTO20/publish-and-apply-local-0
  it('RTO20 - publishAndApply applies locally on ACK', async function () {
    const { root } = await setupSyncedChannel('test-RTO20-apply');

    await root.get('score').increment(10);
    expect(root.get('score').value()).to.equal(110);
  });

  // UTS: objects/unit/RTO20c/missing-site-code-0
  it('RTO20c - publishAndApply logs error when siteCode missing', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            objectsGCGracePeriod: 86400000,
            // Explicitly clear the mock default siteCode ('test') so this test
            // genuinely simulates a CONNECTED with no siteCode (RTO20c1).
            siteCode: undefined,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage('test-RTO20c', 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, ['serial-0']));
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO20c', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    // Increment should publish but not apply locally (no siteCode)
    await root.get('score').increment(10);

    // Value should remain 100 since local apply was skipped
    expect(root.get('score').value()).to.equal(100);
  });

  // UTS: objects/unit/RTO20d1/null-serial-skipped-0
  it('RTO20d1 - null serial in PublishResult is skipped', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage('test-RTO20d1', 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          // Return null serial -- operation should not be applied locally
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, [null as any]));
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO20d1', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.get('score').increment(10);

    // Value should remain 100 since null serial means skip
    expect(root.get('score').value()).to.equal(100);
  });

  // UTS: objects/unit/RTO20d4/empty-synthetic-list-skips-sync-wait-0
  it('RTO20d4 - empty synthetic list skips the RTO20e sync wait', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage('test-RTO20d4', 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          // All-null serial list -> every synthetic ObjectMessage is skipped per RTO20d1
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, [null as any]));
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO20d4', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    // Move the objects sync state back to SYNCING so a normal publishAndApply would park in
    // the RTO20e wait for SYNCED. No sync-completing message is ever sent, so if the RTO20e wait
    // were performed this future would never resolve.
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO20d4',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });

    // RTO20d4 - the all-null ACK makes the synthetic list empty, so publishAndApply completes
    // without the RTO20e wait. Resolution despite the channel never reaching SYNCED proves it.
    await root.get('score').increment(10);

    // Nothing applied locally, so the value is unchanged.
    expect(root.get('score').value()).to.equal(100);
  });

  // UTS: objects/unit/RTO20e/waits-for-synced-0
  it('RTO20e - publishAndApply waits for SYNCED during SYNCING', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO20e');

    // Trigger re-sync by sending a new ATTACHED with cursor
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO20e',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });

    // Start increment -- it will wait for sync to complete
    const incFuture = root.get('score').increment(10);

    // RTO20e: while still SYNCING, the operation must not have completed and the
    // local value must not yet reflect the increment
    let settled = false;
    incFuture.then(
      () => (settled = true),
      () => (settled = true),
    );
    await flushAsync();
    expect(settled).to.equal(false);
    expect(root.get('score').value()).to.equal(100);

    // Complete the re-sync
    mockWs.active_connection!.send_to_client(buildObjectSyncMessage('test-RTO20e', 'sync2:', STANDARD_POOL_OBJECTS));

    await incFuture;

    expect(root.get('score').value()).to.equal(110);
  });

  // UTS: objects/unit/RTO20e1/fails-on-channel-detached-0
  it('RTO20e1 - publishAndApply fails when channel enters DETACHED during sync wait', async function () {
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO20e1-detached');

    // Trigger re-sync (state becomes SYNCING)
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO20e1-detached',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    await flushAsync();

    // Start increment — publish() will succeed (auto-ACK from setupSyncedChannel),
    // but publishAndApply waits for sync to complete.
    const incPromise = root.get('score').increment(10);

    // The operation must still be parked in the RTO20e wait for SYNCED
    let settled = false;
    incPromise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await flushAsync();
    expect(settled).to.equal(false);

    // Detach the channel client-side (an unsolicited server DETACHED would trigger an
    // RTL13a re-attach); the shared mock answers the outbound DETACH with DETACHED
    await channel.detach();

    try {
      await incPromise;
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92008);
    }
  });

  // UTS: objects/unit/RTO20e1/fails-on-channel-failed-0
  it('RTO20e1 - publishAndApply fails when channel enters FAILED during sync wait', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO20e1');

    // Trigger re-sync (state becomes SYNCING)
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO20e1',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    await flushAsync();

    // Start increment — publish() will succeed (auto-ACK from setupSyncedChannel),
    // but publishAndApply waits for sync to complete. Schedule ERROR to arrive
    // after the publish resolves and the sync wait begins.
    const incPromise = root.get('score').increment(10);

    // The operation must still be parked in the RTO20e wait for SYNCED
    let settled = false;
    incPromise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await flushAsync();
    expect(settled).to.equal(false);

    // Now send ERROR to put channel into FAILED state
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ERROR,
      channel: 'test-RTO20e1',
      error: { code: 90000, statusCode: 400, message: 'Channel failed' },
    });

    try {
      await incPromise;
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92008);
    }
  });

  // UTS: objects/unit/RTO17/sync-state-events-0
  it('RTO17, RTO18 - Sync state events', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO17', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });

    const events: string[] = [];
    channel.object.on('syncing', () => events.push('SYNCING'));
    channel.object.on('synced', () => events.push('SYNCED'));

    // Start get() which triggers attach
    const getFuture = channel.object.get();

    // Wait for SYNCING event
    await pollUntil(() => events.length >= 1);

    // Complete sync
    mockWs.active_connection!.send_to_client(buildObjectSyncMessage('test-RTO17', 'sync1:', STANDARD_POOL_OBJECTS));

    await getFuture;

    expect(events).to.deep.equal(['SYNCING', 'SYNCED']);
  });

  // UTS: objects/unit/RTO18d/duplicate-listener-0
  it('RTO18d - Duplicate listener registered twice fires twice', async function () {
    const { channel, mockWs } = await setupSyncedChannel('test-RTO18d');

    let callCount = 0;
    const listener = () => {
      callCount++;
    };
    channel.object.on('synced', listener);
    channel.object.on('synced', listener);

    // Trigger re-sync
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO18d',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    mockWs.active_connection!.send_to_client(buildObjectSyncMessage('test-RTO18d', 'sync2:', STANDARD_POOL_OBJECTS));

    await pollUntil(() => callCount >= 2);

    expect(callCount).to.equal(2);
  });

  // UTS: objects/unit/RTO19/off-deregisters-0
  it('RTO19 - off() deregisters listener', async function () {
    const { channel, mockWs } = await setupSyncedChannel('test-RTO19');

    let callCount = 0;
    const listener = () => {
      callCount++;
    };
    const sub = channel.object.on('synced', listener);
    sub.off();

    // Trigger re-sync
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO19',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    mockWs.active_connection!.send_to_client(buildObjectSyncMessage('test-RTO19', 'sync2:', STANDARD_POOL_OBJECTS));
    await flushAsync();

    expect(callCount).to.equal(0);
  });

  // UTS: objects/unit/RTO2/mode-enforcement-0
  it('RTO2 - Channel mode enforcement (OBJECT_PUBLISH missing from granted modes)', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          // Server grants only OBJECT_SUBSCRIBE (1 << 24), not OBJECT_PUBLISH (1 << 25)
          const OBJECT_SUBSCRIBE_FLAG = 1 << 24;
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS | OBJECT_SUBSCRIBE_FLAG,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Request both modes but server grants only OBJECT_SUBSCRIBE
    const channel = client.channels.get('test-RTO2', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    try {
      await root.set('name', 'Bob');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40024);
    }
  });

  // UTS: objects/unit/RTO20/echo-dedup-0
  it('RTO20 - Echo deduplication via appliedOnAckSerials', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO20-echo');

    await root.get('score').increment(10);
    const scoreAfterApply = root.get('score').value();

    // Send echo with the same serial that was used in the ACK: the first OBJECT
    // message gets msgSerial 0, so the auto-ACK serial is ackSerial(0, 0)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO20-echo', [buildCounterInc('counter:score@1000', 10, ackSerial(0, 0), SITE_CODE)]),
    );
    await flushAsync();
    const scoreAfterEcho = root.get('score').value();

    expect(scoreAfterApply).to.equal(110);
    expect(scoreAfterEcho).to.equal(110);
  });

  // UTS: objects/unit/RTO20f/ack-no-site-timeserials-update-0
  it('RTO20f - Apply-on-ACK does not update siteTimeserials', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO20f');

    await root.get('score').increment(10);
    expect(root.get('score').value()).to.equal(110);

    // Inbound COUNTER_INC from the same siteCode as the ACK (SITE_CODE) but with serial "t:0:9":
    // NOT the apply-on-ACK serial (so RTO9a3 echo-dedup does not discard it), yet sorting below
    // "t:1:0". If LOCAL had wrongly written siteTimeserials[SITE_CODE] = "t:1:0" the newness check
    // would reject this as stale (value stays 110); if LOCAL correctly left siteTimeserials
    // untouched (RTLC7c), SITE_CODE has no entry and the op applies, reaching 120.
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO20f', [buildCounterInc('counter:score@1000', 10, belowAckSerial(9), SITE_CODE)]),
    );
    await pollUntil(() => root.get('score').value() === 120);
    expect(root.get('score').value()).to.equal(120);
  });

  // UTS: objects/unit/RTO20/ack-after-echo-no-double-apply-0
  it('RTO20 - ACK after echo does not double-apply', async function () {
    const { root, mockWs } = await setupSyncedChannelNoAck('test-RTO20-ack-after-echo');

    // The spec's poll_until for the outbound OBJECT message before injecting the echo/ACK
    // is omitted: ably-js is single-threaded and the publish reaches the transport
    // synchronously before increment() returns, so the ACK can never arrive while no
    // message is pending on the connection.
    const incFuture = root.get('score').increment(10);

    // Send the echo BEFORE the ACK. The serial and siteCode must match what
    // publishAndApply will generate from the ACK: ackSerial(0, 0) and SITE_CODE
    // (from connectionDetails.siteCode in setupSyncedChannelNoAck).
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO20-ack-after-echo', [
        buildCounterInc('counter:score@1000', 10, ackSerial(0, 0), SITE_CODE),
      ]),
    );
    await flushAsync();

    // Now send the ACK with the same serial
    mockWs.active_connection!.send_to_client(buildAckMessage(0, [ackSerial(0, 0)]));

    await incFuture;

    expect(root.get('score').value()).to.equal(110);
  });

  // UTS: objects/unit/RTO5c9-RTO20/ack-serials-cleared-on-resync-0
  it('RTO5c9, RTO20 - appliedOnAckSerials cleared on re-sync', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO5c9');

    await root.get('score').increment(10);
    expect(root.get('score').value()).to.equal(110);

    // Trigger re-sync
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO5c9',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    mockWs.active_connection!.send_to_client(buildObjectSyncMessage('test-RTO5c9', 'sync2:', STANDARD_POOL_OBJECTS));
    await flushAsync();

    // After re-sync, the score is back to 100 (from pool state)
    expect(root.get('score').value()).to.equal(100);

    // Replay the same serial the apply-on-ACK used (ackSerial(0, 0) from
    // setupSyncedChannel's auto-ACK, siteCode SITE_CODE). If appliedOnAckSerials was
    // cleared per RTO5c9 this applies normally; if not, dedup (RTO9a3) would reject
    // it and score stays 100.
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO5c9', [buildCounterInc('counter:score@1000', 10, ackSerial(0, 0), SITE_CODE)]),
    );
    await flushAsync();

    expect(root.get('score').value()).to.equal(110);
  });

  // UTS: objects/unit/RTO20/subscription-fires-on-ack-apply-0
  it('RTO20 - Subscription fires on apply-on-ACK', async function () {
    const { root } = await setupSyncedChannel('test-RTO20-sub');

    const events: any[] = [];
    root.get('score').subscribe((event: any) => events.push(event));

    await root.get('score').increment(10);

    expect(events.length).to.be.greaterThanOrEqual(1);
    expect(root.get('score').value()).to.equal(110);
  });

  // UTS: objects/unit/RTO23/get-implicit-attach-0
  it('RTO23 - get() implicitly attaches channel', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO23-attach', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });

    expect(channel.state).to.equal('initialized');
    const root = await channel.object.get();

    expect(root).to.exist;
    expect(channel.state).to.equal('attached');
  });

  // UTS: objects/unit/RTO23d/get-resolves-immediately-synced-0
  it('RTO23d - get() resolves immediately when already SYNCED', async function () {
    const { channel } = await setupSyncedChannel('test-RTO23d');

    const root2 = await channel.object.get();
    expect(root2).to.exist;
    expect(root2.path()).to.equal('');
  });

  // UTS: objects/unit/RTO10/gc-tombstoned-objects-0
  it('RTO10 - GC removes tombstoned objects past grace period', async function () {
    const origGcInterval = DEFAULTS.gcInterval;

    try {
      // Use short GC interval so the timer fires quickly
      DEFAULTS.gcInterval = 50;

      const { root, mockWs } = await setupSyncedChannel('test-RTO10');

      // Delete the counter object (tombstone it). The tombstone's serialTimestamp is
      // backdated past the grace period (RTLO6a: it becomes tombstonedAt), so the object
      // is GC-eligible under the real clock -- no Date.now stubbing needed.
      mockWs.active_connection!.send_to_client(
        buildObjectMessage('test-RTO10', [
          buildObjectDelete('counter:score@1000', '99', 'site1', Date.now() - (86400000 + 300000)),
        ]),
      );
      await flushAsync();

      // Wait for the (real) GC interval to fire by polling for its observable effect,
      // rather than sleeping a fixed period that races the timer on slow machines
      await pollUntil(() => root.get('score').value() === undefined);

      expect(root.get('score').value()).to.be.undefined;
    } finally {
      DEFAULTS.gcInterval = origGcInterval;
    }
  });

  // UTS: objects/unit/RTO10c1b1/gc-root-never-removed-0
  it('RTO10c1b1 - GC never removes the root object', async function () {
    const origGcInterval = DEFAULTS.gcInterval;

    try {
      // Use short GC interval so the timer fires quickly
      DEFAULTS.gcInterval = 50;

      const { root, mockWs } = await setupSyncedChannel('test-RTO10c1b1');

      // Rogue OBJECT_DELETE targeting the root object, backdated past the grace period so it
      // would be GC-eligible if the tombstone were (incorrectly) applied; rejected per RTLO4e10.
      // The score counter is deleted the same way as a control: its removal signals that a full
      // GC sweep has completed (the derived rendering of the spec test's ADVANCE_TIME).
      mockWs.active_connection!.send_to_client(
        buildObjectMessage('test-RTO10c1b1', [
          buildObjectDelete('root', remoteSerial(0), 'remote', Date.now() - (86400000 + 300000)),
          buildObjectDelete('counter:score@1000', '99', 'site1', Date.now() - (86400000 + 300000)),
        ]),
      );
      await flushAsync();

      // RTLO4e10: root is not tombstoned, data untouched
      expect(root.get('name').value()).to.equal('Alice');

      // Wait for a GC sweep to complete, observable via the control counter's removal
      await pollUntil(() => root.get('score').value() === undefined);

      // RTO10c1b1/RTO3b: root survived the sweep and is still live -- a subsequent
      // operation still applies to the same root object the client holds
      mockWs.active_connection!.send_to_client(
        buildObjectMessage('test-RTO10c1b1', [
          buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(1), 'remote'),
        ]),
      );
      await flushAsync();
      expect(root.get('name').value()).to.equal('Bob');
    } finally {
      DEFAULTS.gcInterval = origGcInterval;
    }
  });

  // UTS: objects/unit/RTO10b1/gc-grace-period-source-0
  it('RTO10b1 - GC grace period from ConnectionDetails', async function () {
    const origGcInterval = DEFAULTS.gcInterval;

    try {
      DEFAULTS.gcInterval = 50;

      const mockWs = new MockWebSocket({
        onConnectionAttempt: (conn) => {
          mockWs.active_connection = conn;
          conn.respond_with_connected({
            action: PM_ACTION.CONNECTED,
            connectionId: 'conn-1',
            connectionDetails: {
              connectionKey: 'key-1',
              siteCode: 'test-site',
              // Short grace period: 5000ms
              objectsGCGracePeriod: 5000,
            },
          });
        },
        onMessageFromClient: (msg: any) => {
          if (msg.action === PM_ACTION.ATTACH) {
            mockWs.active_connection!.send_to_client({
              action: PM_ACTION.ATTACHED,
              channel: msg.channel,
              channelSerial: 'sync1:',
              flags: HAS_OBJECTS,
            });
            mockWs.active_connection!.send_to_client(
              buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
            );
          } else if (msg.action === PM_ACTION.OBJECT) {
            const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
            mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
          }
        },
      });
      installMockWebSocket(mockWs.constructorFn);

      const client = new Ably.Realtime({
        key: 'appId.keyId:keySecret',
        autoConnect: false,
        useBinaryProtocol: false,
        plugins: { LiveObjects: LiveObjectsPlugin },
      });
      trackClient(client);
      client.connect();
      await new Promise<void>((resolve) => client.connection.once('connected', resolve));

      const channel = client.channels.get('test-RTO10b1', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
      const root = await channel.object.get();

      // Delete the counter (tombstone it). The tombstone is backdated 6s: eligible under
      // the server-provided 5000ms grace, but NOT under the 24h default -- so the test
      // fails if the implementation ignores ConnectionDetails.objectsGCGracePeriod
      // (RTO10b1). No Date.now stubbing needed.
      mockWs.active_connection!.send_to_client(
        buildObjectMessage('test-RTO10b1', [buildObjectDelete('counter:score@1000', '99', 'site1', Date.now() - 6000)]),
      );
      await flushAsync();

      // Wait for the (real) GC interval to fire by polling for its observable effect,
      // rather than sleeping a fixed period that races the timer on slow machines
      await pollUntil(() => root.get('score').value() === undefined);

      expect(root.get('score').value()).to.be.undefined;
    } finally {
      DEFAULTS.gcInterval = origGcInterval;
    }
  });

  // UTS: objects/unit/RTO17-RTO18/sync-event-sequences-0
  describe('RTO17, RTO18 - Sync event sequences for all state transitions', function () {
    afterEach(function () {
      restoreAll();
    });

    it('initial attach emits SYNCING then SYNCED', async function () {
      const mockWs = new MockWebSocket({
        onConnectionAttempt: (conn) => {
          mockWs.active_connection = conn;
          conn.respond_with_connected({
            action: PM_ACTION.CONNECTED,
            connectionId: 'conn-1',
            connectionDetails: {
              connectionKey: 'key-1',
              siteCode: 'test-site',
              objectsGCGracePeriod: 86400000,
            },
          });
        },
        onMessageFromClient: (msg: any) => {
          if (msg.action === PM_ACTION.ATTACH) {
            mockWs.active_connection!.send_to_client({
              action: PM_ACTION.ATTACHED,
              channel: msg.channel,
              channelSerial: 'sync1:cursor',
              flags: HAS_OBJECTS,
            });
          }
        },
      });
      installMockWebSocket(mockWs.constructorFn);

      const client = new Ably.Realtime({
        key: 'appId.keyId:keySecret',
        autoConnect: false,
        useBinaryProtocol: false,
        plugins: { LiveObjects: LiveObjectsPlugin },
      });
      trackClient(client);
      client.connect();
      await new Promise<void>((resolve) => client.connection.once('connected', resolve));

      const channel = client.channels.get('test-RTO17-initial', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
      const events: string[] = [];
      channel.object.on('syncing', () => events.push('SYNCING'));
      channel.object.on('synced', () => events.push('SYNCED'));

      const getFuture = channel.object.get();

      // Wait for SYNCING
      await pollUntil(() => events.length >= 1);

      mockWs.active_connection!.send_to_client(
        buildObjectSyncMessage('test-RTO17-initial', 'sync1:', STANDARD_POOL_OBJECTS),
      );
      await getFuture;

      expect(events).to.deep.equal(['SYNCING', 'SYNCED']);
    });

    it('re-sync on new ATTACHED emits SYNCING then SYNCED', async function () {
      const { channel, mockWs } = await setupSyncedChannel('test-RTO17-resync');

      const events: string[] = [];
      channel.object.on('syncing', () => events.push('SYNCING'));
      channel.object.on('synced', () => events.push('SYNCED'));

      mockWs.active_connection!.send_to_client({
        action: PM_ACTION.ATTACHED,
        channel: 'test-RTO17-resync',
        channelSerial: 'sync3:cursor',
        flags: HAS_OBJECTS,
      });
      mockWs.active_connection!.send_to_client(
        buildObjectSyncMessage('test-RTO17-resync', 'sync3:', STANDARD_POOL_OBJECTS),
      );

      await pollUntil(() => events.length >= 2);

      expect(events).to.deep.equal(['SYNCING', 'SYNCED']);
    });

    it('ATTACHED without HAS_OBJECTS emits SYNCING then SYNCED', async function () {
      const { channel, mockWs } = await setupSyncedChannel('test-RTO17-no-objects');

      const events: string[] = [];
      channel.object.on('syncing', () => events.push('SYNCING'));
      channel.object.on('synced', () => events.push('SYNCED'));

      mockWs.active_connection!.send_to_client({
        action: PM_ACTION.ATTACHED,
        channel: 'test-RTO17-no-objects',
        channelSerial: 'sync4:',
        flags: 0,
      });

      await pollUntil(() => events.length >= 2);

      // RTO4c emits SYNCING on any ATTACHED; without HAS_OBJECTS the sync completes
      // immediately (RTO4b4), so the sequence is exactly ['SYNCING', 'SYNCED']
      expect(events).to.deep.equal(['SYNCING', 'SYNCED']);
    });
  });

  // UTS: objects/unit/RTO25a/access-requires-subscribe-mode-0
  it('RTO25a - Access API precondition requires OBJECT_SUBSCRIBE mode', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          // Server grants only OBJECT_PUBLISH (1 << 25), not OBJECT_SUBSCRIBE
          const OBJECT_PUBLISH_FLAG = 1 << 25;
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS | OBJECT_PUBLISH_FLAG,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Only OBJECT_PUBLISH, no OBJECT_SUBSCRIBE
    const channel = client.channels.get('test-RTO25a', { modes: ['OBJECT_PUBLISH'] });

    try {
      await channel.object.get();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40024);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO25b/access-throws-detached-0
  it('RTO25b - Access API precondition throws on DETACHED channel', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.DETACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.DETACHED,
            channel: msg.channel,
          });
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO25b-detached', { modes: ['OBJECT_SUBSCRIBE'] });

    // Attach and sync first, save the root PathObject
    const root = await channel.object.get();

    // Detach channel
    await channel.detach();
    await flushAsync();
    expect(channel.state).to.equal('detached');

    try {
      // keys() is a generator — the RTO25b precondition throws on first iteration
      [...root.keys()];
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(90001);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO23e/get-rejects-failed-0
  it('RTO23e - get() on a FAILED channel rejects with 90001', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          // Respond with ERROR to put channel into FAILED state
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ERROR,
            channel: msg.channel,
            error: { code: 90000, statusCode: 400, message: 'Channel error' },
          });
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO25b-failed', { modes: ['OBJECT_SUBSCRIBE'] });

    // Trigger attach which will fail, putting channel into FAILED state
    channel.attach();
    await pollUntil(() => channel.state === 'failed');
    expect(channel.state).to.equal('failed');

    try {
      await channel.object.get();
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(90001);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO25b/access-throws-failed-0
  it('RTO25b - Access API precondition throws on FAILED channel', async function () {
    // Root is obtained while ATTACHED; the channel then enters FAILED via a
    // server-sent channel ERROR, and an access method must throw 90001
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO25b-failed-keys');

    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ERROR,
      channel: 'test-RTO25b-failed-keys',
      error: { code: 90000, statusCode: 400, message: 'Channel error' },
    });
    await flushAsync();
    expect(channel.state).to.equal('failed');

    try {
      // keys() is a generator — the RTO25b precondition throws on first iteration
      [...root.keys()];
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(90001);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO26a/write-requires-publish-mode-0
  it('RTO26a - Write API precondition requires OBJECT_PUBLISH mode', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          // Server grants only OBJECT_SUBSCRIBE (1 << 24), not OBJECT_PUBLISH
          const OBJECT_SUBSCRIBE_FLAG = 1 << 24;
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS | OBJECT_SUBSCRIBE_FLAG,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Request only OBJECT_SUBSCRIBE, no OBJECT_PUBLISH
    const channel = client.channels.get('test-RTO26a', { modes: ['OBJECT_SUBSCRIBE'] });
    const root = await channel.object.get();

    try {
      await root.set('name', 'Bob');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40024);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO26b/write-throws-detached-0
  // RTO26 applies to write API methods on PathObject/Instance which call
  // throwIfInvalidWriteApiConfiguration(). We use root.set() which checks channel state.
  it('RTO26b - Write API precondition throws on DETACHED channel', async function () {
    let attachCount = 0;
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          attachCount++;
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.DETACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.DETACHED,
            channel: msg.channel,
          });
        } else if (msg.action === PM_ACTION.OBJECT) {
          const serials = (msg.state || []).map((_: any, i: number) => `t:${msg.msgSerial + 1}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO26b-detached', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await channel.detach();
    await flushAsync();
    expect(channel.state).to.equal('detached');

    try {
      await root.set('name', 'Bob');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(90001);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO26b/write-throws-failed-0
  it('RTO26b - Write API precondition throws on FAILED channel', async function () {
    const { root, channel, mockWs } = await setupSyncedChannel('test-RTO26b-failed');

    // Force channel to FAILED state via channel ERROR
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ERROR,
      channel: 'test-RTO26b-failed',
      error: { code: 90000, statusCode: 400, message: 'Channel error' },
    });
    await flushAsync();
    expect(channel.state).to.equal('failed');

    try {
      await root.set('name', 'Bob');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(90001);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO26c/write-throws-echo-disabled-0
  it('RTO26c - Write API precondition throws when echoMessages is false', async function () {
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        });
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: HAS_OBJECTS,
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        }
      },
    });
    installMockWebSocket(mockWs.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      echoMessages: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTO26c', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    try {
      await root.set('name', 'Bob');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTO24a/single-register-instance-0
  it('RTO24a - RealtimeObject maintains a single PathObjectSubscriptionRegister', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24a');

    const eventsRoot: any[] = [];
    const eventsScore: any[] = [];

    // Subscribe via root PathObject at path []
    root.subscribe((event: any) => eventsRoot.push(event));

    // Subscribe via a deeper PathObject at path ["score"]
    const scorePath = root.get('score');
    scorePath.subscribe((event: any) => eventsScore.push(event));

    // Trigger an update on the score counter (serial must be > 't:0' from standard pool)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24a', [buildCounterInc('counter:score@1000', 5, 't:1', 'aaa')]),
    );

    await pollUntil(() => eventsScore.length >= 1);

    // Both subscriptions are managed by the same register and both fire
    expect(eventsRoot.length).to.be.greaterThanOrEqual(1);
    expect(eventsScore.length).to.be.greaterThanOrEqual(1);
  });

  // UTS: objects/unit/RTO24c1/coverage-prefix-depth-0
  it('RTO24c1 - Subscription coverage: prefix match with depth constraint', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24c1');

    const shallowEvents: any[] = [];
    const deepEvents: any[] = [];

    // Subscribe at root with depth 1 -- covers only the subscription's own path
    // (relativeDepth = candidateLen - subLen + 1; a child of root is depth 2).
    // PathObject.subscribe(listener, options?) — listener first, options second
    // (the spec pseudocode passes options first).
    root.subscribe((event: any) => shallowEvents.push(event), { depth: 1 });

    // Subscribe at root with no depth limit -- covers everything
    root.subscribe((event: any) => deepEvents.push(event));

    // MAP_SET on root itself -- candidate path is root's own path, seen by both.
    // Serial "t:1" sorts after the pool entry timeserial "t:0" (RTLM9 string LWW).
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1', [buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote')]),
    );

    // Quiescence: wait for the shallow listener itself to receive the root update
    await pollUntil(() => shallowEvents.length >= 1);

    // COUNTER_INC on a direct child of root (path ["score"], depth 2) -- deep only
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1', [buildCounterInc('counter:score@1000', 5, 't:2', 'remote')]),
    );

    await pollUntil(() => deepEvents.length >= 2);

    // Shallow subscription (depth 1) only sees the update on its own path
    expect(shallowEvents.length).to.equal(1);

    // Deep subscription (no depth limit) sees both updates
    expect(deepEvents.length).to.be.greaterThanOrEqual(2);
  });

  // UTS: objects/unit/RTO27 - objects data lifecycle on channel state transitions
  describe('RTO27 - objects data lifecycle on channel state transitions', function () {
    // DETACHED/FAILED: every pooled object has its data cleared to the zero value
    // (map -> empty, counter -> 0) WITHOUT emitting update events; the objects
    // themselves remain in the pool (only their data is cleared).
    for (const state of ['detached', 'failed'] as const) {
      it(`RTO27 - clears objects data (no events) on channel ${state}`, async function () {
        const { channel, root } = await setupSyncedChannel(`test-RTO27-${state}`);
        const rto = (channel as any)._object;

        // Sanity: pool is populated from STANDARD_POOL_OBJECTS
        expect(root.get('name').value()).to.equal('Alice');
        const counter = rto._objectsPool.get('counter:score@1000');
        expect(counter).to.exist;
        expect(counter.value()).to.equal(100);
        const profileMap = rto._objectsPool.get('map:profile@1000'); // nested map (email, nested_counter, prefs)
        expect(profileMap.size()).to.equal(3);

        // Subscribe to root and collect any emitted updates
        const updates: any[] = [];
        root.subscribe((event: any) => updates.push(event));

        // Drive the internal channel-state transition directly
        rto.actOnChannelState(state);
        await flushAsync();

        // Root map data cleared to zero value (empty)
        expect(root.size()).to.equal(0);
        expect(root.get('name').value()).to.be.undefined;

        // Counter object is STILL in the pool, with its data reset to 0
        const counterAfter = rto._objectsPool.get('counter:score@1000');
        expect(counterAfter).to.exist;
        expect(counterAfter.value()).to.equal(0);

        // Nested map is STILL in the pool, with its OWN data cleared — checked independently via the
        // pool so a nested-object regression can't be hidden by the root clear
        expect(rto._objectsPool.get('map:profile@1000')).to.exist;
        expect(profileMap.size()).to.equal(0);

        // No update events were emitted for the data clearing
        expect(updates.length).to.equal(0);
      });
    }

    // SUSPENDED: objects data is retained unchanged (state not handled by the switch).
    it('RTO27 - retains objects data on channel suspended', async function () {
      const { channel, root } = await setupSyncedChannel('test-RTO27-suspended');
      const rto = (channel as any)._object;

      // Sanity: pool is populated
      expect(root.get('name').value()).to.equal('Alice');
      expect(rto._objectsPool.get('counter:score@1000').value()).to.equal(100);
      expect(rto._objectsPool.get('map:profile@1000').size()).to.equal(3); // nested map

      rto.actOnChannelState('suspended');
      await flushAsync();

      // Data retained unchanged — root, the counter, and the nested map
      expect(root.get('name').value()).to.equal('Alice');
      expect(rto._objectsPool.get('counter:score@1000').value()).to.equal(100);
      expect(rto._objectsPool.get('map:profile@1000').size()).to.equal(3);
    });
  });
});
