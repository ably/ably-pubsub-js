/**
 * UTS: ObjectsPool Tests
 *
 * Spec points: RTO3-RTO9
 * Source: uts/objects/unit/objects_pool.md
 *
 * Tests the ObjectsPool internal data structure and sync state machine.
 * ObjectsPool manages object creation, sync state, and operation routing.
 *
 * Deviation: ably-js keeps syncState, bufferedObjectOperations, and
 * appliedOnAckSerials as private fields on RealtimeObject. Tests access
 * them via (channel as any)._object._state etc. for internal verification.
 *
 * Deviation: RTO5c9 (clear appliedOnAckSerials) and RTO9a3 (dedup) and
 * RTO9a2a4 (LOCAL source adds serial) are tested by directly manipulating
 * the internal _appliedOnAckSerials Set and observing effects, since
 * ably-js does not expose applyObjectMessages with a source parameter.
 */

import { expect } from 'chai';
import { Ably, restoreAll, installMockWebSocket, trackClient, flushAsync } from '../../helpers';
import { MockWebSocket } from '../../mock_websocket';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';
import {
  PM_ACTION,
  HAS_OBJECTS,
  OBJ_OP,
  MAP_SEMANTICS_LWW,
  buildObjectSyncMessage,
  buildObjectMessage,
  buildObjectState,
  buildCounterInc,
  buildMapSet,
  buildAckMessage,
  setupSyncedChannel,
  STANDARD_POOL_OBJECTS,
  captureNotifyUpdated,
} from '../helpers/standard_test_pool';

/**
 * Helper: convert a LiveObject's private _parentReferences Map<LiveObject, Set<string>>
 * into a plain object keyed by objectId for assertion purposes.
 * Returns e.g. { "root": Set{"score"}, "map:profile@1000": Set{"nested_counter"} }
 */
function getParentRefsById(obj: any): Map<string, Set<string>> {
  const refs: Map<string, Set<string>> = new Map();
  const parentRefs: Map<any, Set<string>> = (obj as any)._parentReferences;
  for (const [parent, keys] of parentRefs) {
    refs.set(parent.getObjectId(), new Set(keys));
  }
  return refs;
}

/**
 * Helper: assert that a LiveObject's parentReferences match the expected structure.
 * Expected is a Record<objectId, string[]> where each string[] is the set of keys.
 * An empty object means no parent references.
 */
function expectParentRefs(obj: any, expected: Record<string, string[]>) {
  const refs = getParentRefsById(obj);
  const expectedEntries = Object.entries(expected);
  expect(refs.size).to.equal(expectedEntries.length, `parentReferences size mismatch for ${obj.getObjectId()}`);
  for (const [parentId, keys] of expectedEntries) {
    expect(refs.has(parentId)).to.be.true;
    const actualKeys = refs.get(parentId)!;
    expect(actualKeys.size).to.equal(keys.length, `key set size mismatch for parent ${parentId}`);
    for (const key of keys) {
      expect(actualKeys.has(key)).to.be.true;
    }
  }
}

/**
 * Helper: build a full createOp for a map, including action and objectId.
 * ably-js validates createOp.objectId and createOp.action during overrideWithObjectState.
 */
function mapCreateOp(objectId: string, entries: Record<string, any> = {}) {
  return {
    action: OBJ_OP.MAP_CREATE,
    objectId,
    mapCreate: { semantics: MAP_SEMANTICS_LWW, entries },
  };
}

/**
 * Helper: build a full createOp for a counter, including action and objectId.
 */
function counterCreateOp(objectId: string, count: number) {
  return {
    action: OBJ_OP.COUNTER_CREATE,
    objectId,
    counterCreate: { count },
  };
}

/**
 * Helper: create a connected client + channel without auto-attaching or auto-syncing.
 * The caller is responsible for driving ATTACH/ATTACHED/OBJECT_SYNC manually.
 */
async function setupManualChannel(
  channelName: string,
  opts?: { onMessageFromClient?: (msg: any, mockWs: MockWebSocket) => void },
): Promise<{ client: InstanceType<typeof Ably.Realtime>; channel: any; mockWs: MockWebSocket }> {
  const mockWs = new MockWebSocket({
    onConnectionAttempt: (conn) => {
      mockWs.active_connection = conn;
      conn.respond_with_connected({
        action: PM_ACTION.CONNECTED,
        connectionId: 'conn-1',
        connectionDetails: {
          connectionKey: 'conn-key-1',
          connectionStateTtl: 120000,
          maxIdleInterval: 15000,
          maxMessageSize: 65536,
          serverId: 'test-server',
          clientId: null,
          siteCode: 'test',
          objectsGCGracePeriod: 86400000,
        },
      });
    },
    onMessageFromClient: (msg: any) => {
      if (opts?.onMessageFromClient) {
        opts.onMessageFromClient(msg, mockWs);
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

  const channel = client.channels.get(channelName, { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });

  return { client, channel, mockWs };
}

/**
 * Get the internal RealtimeObject from a channel.
 */
function getRealtimeObject(channel: any): any {
  return (channel as any)._object;
}

/**
 * Attach a channel manually and wait for the attach to propagate.
 * Does NOT auto-respond with ATTACHED. The caller sends ATTACHED via mockWs.
 */
async function attachChannel(channel: any): Promise<void> {
  channel.attach();
  // Wait for the ATTACH message to be sent via WebSocket
  await flushAsync();
}

describe('uts/objects/unit/objects_pool', function () {
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTO3/pool-init-root-0
  it('RTO3 - pool initialized with zero-value root LiveMap', async function () {
    // No attach/sync: the pool must contain the zero-value root on initialization (RTO3b1)
    const { channel } = await setupManualChannel('test-RTO3');

    const rto = getRealtimeObject(channel);
    const rootMap = rto.getPool().get('root');

    expect(rootMap).to.exist;
    // esbuild may rename the class (LiveMap -> _LiveMap), so match by name
    expect(rootMap.constructor.name).to.match(/LiveMap$/);
    expect(rootMap.getObjectId()).to.equal('root');
    // zero-value root: empty data (public size() avoids coupling to internal _dataRef)
    expect(rootMap.size()).to.equal(0);
  });

  // UTS: objects/unit/RTO4/attached-has-objects-syncing-0
  it('RTO4a - ATTACHED with HAS_OBJECTS starts SYNCING', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO4a', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          // Send ATTACHED with HAS_OBJECTS but do NOT send OBJECT_SYNC
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
        }
      },
    });

    await attachChannel(channel);
    await flushAsync();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('syncing');
  });

  // UTS: objects/unit/RTO4b/attached-no-objects-synced-0
  it('RTO4b - ATTACHED without HAS_OBJECTS clears pool and goes to SYNCED', async function () {
    // First sync to populate pool
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO4b');

    // Verify pool has objects
    expect(root.get('name').value()).to.equal('Alice');
    expect(root.get('score').value()).to.equal(100);

    // Subscribe to root for update events
    const updates: any[] = [];
    root.subscribe((event: any) => updates.push(event));

    // Capture the internal update passed to the root LiveMap's notifyUpdated so the
    // spec's update-diff and objectMessage assertions (RTO4b2a) can be verified
    const rto = getRealtimeObject(channel);
    const rootMap = rto.getPool().get('root');
    const capture = captureNotifyUpdated(rootMap);

    // Send a new ATTACHED without HAS_OBJECTS (re-attach scenario)
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO4b',
      flags: 0,
    });
    await flushAsync();
    capture.restore();

    expect(rto._state).to.equal('synced');

    // Root should still exist but be cleared
    expect(root.size()).to.equal(0);
    // counter:score@1000 should be removed from pool
    expect(root.get('score').value()).to.be.undefined;
    expect(root.get('name').value()).to.be.undefined;

    // Should have received update events
    expect(updates.length).to.be.greaterThanOrEqual(1);
    // RTO4b2: the emitted LiveMapUpdate marks the cleared entries as removed
    // (spec setup has only "name"; the standard pool root also carries "score" etc.)
    const capturedUpdate = capture.getUpdate();
    expect(capturedUpdate).to.exist;
    expect(capturedUpdate.update.name).to.equal('removed');
    expect(capturedUpdate.update.score).to.equal('removed');
    // RTO4b2a: objectMessage is not populated on sync-completion updates.
    // PathObject subscription events expose it as `.message` (RTLO4b4d adaptation).
    expect(capturedUpdate.objectMessage).to.be.undefined;
    expect(updates[0].message).to.be.undefined;
  });

  // UTS: objects/unit/RTO5/sync-complete-sequence-0
  it('RTO5 - OBJECT_SYNC complete sequence populates pool', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          // Send OBJECT_SYNC with empty cursor (complete in one message)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: {
                    semantics: MAP_SEMANTICS_LWW,
                    entries: { name: { data: { string: 'Alice' }, timeserial: 't:0' } },
                  },
                  createOp: mapCreateOp('root'),
                },
              ),
              buildObjectState(
                'counter:abc@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 0 },
                  createOp: counterCreateOp('counter:abc@1000', 42),
                },
              ),
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');
    expect(root.get('name').value()).to.equal('Alice');
    // counter:abc@1000 should exist
    const counterPool = rto._objectsPool.get('counter:abc@1000');
    expect(counterPool).to.exist;
  });

  // UTS: objects/unit/RTO5a2/new-sequence-discards-old-0
  it('RTO5a2 - new sync sequence discards previous', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5a2', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'seq1:cursor',
            flags: HAS_OBJECTS,
          });
          // First sync (partial, with cursor)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'seq1:more', [
              buildObjectState(
                'counter:old@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 10 },
                },
              ),
            ]),
          );
          // New sync sequence (different id, empty cursor = complete)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'seq2:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
                  createOp: mapCreateOp('root'),
                },
              ),
              buildObjectState(
                'counter:new@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 0 },
                  createOp: counterCreateOp('counter:new@1000', 99),
                },
              ),
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');
    // counter:old@1000 should NOT be in pool (discarded with old sequence)
    expect(rto._objectsPool.get('counter:old@1000')).to.be.undefined;
    // counter:new@1000 should exist
    expect(rto._objectsPool.get('counter:new@1000')).to.exist;
  });

  // UTS: objects/unit/RTO5a5/absent-channel-serial-0
  it('RTO5a5 - OBJECT_SYNC with no channelSerial is a single-message sync', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5a5', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          // RTO5a5 - no channelSerial: the whole sync is contained in this one message, so the
          // objects are applied and the sync completes (SYNCED) without waiting for a cursor-empty
          // channelSerial (RTO5a4)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, null as any, [
              buildObjectState('counter:new@1000', { aaa: 't:0' }, { counter: { count: 99 } }),
            ]),
          );
        }
      },
    });

    // get() waits for SYNCED, so it doubles as the synchronization point for the applied sync
    await channel.object.get();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');
    expect(rto._objectsPool.get('counter:new@1000')).to.exist;
  });

  // UTS: objects/unit/RTO5a6/malformed-channel-serial-treated-as-absent-0
  it('RTO5a6 - malformed channelSerial is treated as absent', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5a6', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          // RTO5a6 - "malformedserialnocolon" has no ':' separator, so it cannot be parsed per
          // RTO5a1; it must be handled as if the channelSerial were absent (RTO5a5): the objects
          // are applied and the sync completes (SYNCED)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'malformedserialnocolon', [
              buildObjectState('counter:new@1000', { aaa: 't:0' }, { counter: { count: 99 } }),
            ]),
          );
        }
      },
    });

    // get() waits for SYNCED, so it doubles as the synchronization point for the applied sync
    await channel.object.get();

    const rto = getRealtimeObject(channel);
    // Treated as absent (RTO5a5): the message was applied and the sync ended
    expect(rto._state).to.equal('synced');
    expect(rto._objectsPool.get('counter:new@1000')).to.exist;
  });

  // UTS: objects/unit/RTO5f2a/partial-map-merge-0
  it('RTO5f2a - partial object state merge for maps', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5f2a', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          // First partial sync message (no createOp — partial)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:more', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: {
                    semantics: MAP_SEMANTICS_LWW,
                    entries: { name: { data: { string: 'Alice' }, timeserial: 't:0' } },
                  },
                },
              ),
            ]),
          );
          // Second partial sync message (completes sync, includes createOp)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: {
                    semantics: MAP_SEMANTICS_LWW,
                    entries: { age: { data: { number: 30 }, timeserial: 't:0' } },
                  },
                  createOp: mapCreateOp('root'),
                },
              ),
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    // Both entries should be merged
    expect(root.get('name').value()).to.equal('Alice');
    expect(root.get('age').value()).to.equal(30);
  });

  // UTS: objects/unit/RTO5c2/remove-absent-objects-0
  it('RTO5c2 - sync completion removes objects not in sync', async function () {
    // First sync to populate with counter:score@1000
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO5c2');

    // Verify counter exists
    expect(root.get('score').value()).to.equal(100);

    // New ATTACHED + sync WITHOUT counter:score@1000
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO5c2',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5c2', 'sync2:', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
            createOp: mapCreateOp('root'),
          },
        ),
      ]),
    );
    await flushAsync();

    const rto = getRealtimeObject(channel);
    // counter:score@1000 should be removed
    expect(rto._objectsPool.get('counter:score@1000')).to.be.undefined;
    // root should still exist
    expect(rto._objectsPool.get('root')).to.exist;
  });

  // UTS: objects/unit/RTO8a/buffer-during-syncing-0
  it('RTO7, RTO8a - OBJECT messages buffered during SYNCING', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO8a', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          // Send ATTACHED with HAS_OBJECTS but do NOT send OBJECT_SYNC
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
        }
      },
    });

    await attachChannel(channel);
    await flushAsync();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('syncing');

    // Send an OBJECT message while SYNCING
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO8a', [buildCounterInc('counter:abc@1000', 5, '01', 'site1')]),
    );
    await flushAsync();

    expect(rto._state).to.equal('syncing');
    expect(rto._bufferedObjectOperations).to.have.length(1);
    // counter:abc@1000 should NOT exist in pool (buffered, not applied)
    expect(rto._objectsPool.get('counter:abc@1000')).to.be.undefined;
  });

  // UTS: objects/unit/RTO5c6/apply-buffered-on-sync-0
  it('RTO5c6, RTO8b - buffered operations applied on sync completion', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5c6', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
        }
      },
    });

    await attachChannel(channel);
    await flushAsync();

    // Send OBJECT message during SYNCING (will be buffered)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO5c6', [buildCounterInc('counter:abc@1000', 10, '02', 'site1')]),
    );
    await flushAsync();

    const rto = getRealtimeObject(channel);
    expect(rto._bufferedObjectOperations).to.have.length(1);

    // Now complete the sync with counter:abc@1000 at count 100
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5c6', 'sync1:', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
            createOp: mapCreateOp('root'),
          },
        ),
        buildObjectState(
          'counter:abc@1000',
          { aaa: 't:0' },
          {
            counter: { count: 100 },
            createOp: counterCreateOp('counter:abc@1000', 0),
          },
        ),
      ]),
    );
    await flushAsync();

    // After sync, buffered increment of 10 should be applied on top of 100
    // Per RTLC6c/RTLC6d/RTLC16a the value is counter.count + createOp.counterCreate.count:
    // So counter.count=100, createOp.count=0 => value=100, then +10 = 110
    const counterObj = rto._objectsPool.get('counter:abc@1000');
    expect(counterObj).to.exist;
    expect(counterObj.value()).to.equal(110);
    expect(rto._bufferedObjectOperations).to.have.length(0);
  });

  // UTS: objects/unit/RTO9a1/null-operation-warning-0
  it('RTO9a1 - null operation is discarded with warning', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO9a1');

    // Send OBJECT with null operation
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO9a1', [{ serial: '01', siteCode: 'site1', operation: null }]),
    );
    await flushAsync();

    // Pool should be unchanged — null-operation message is discarded
    expect(root.get('name').value()).to.equal('Alice');
  });

  // UTS: objects/unit/RTO9a2b/unsupported-action-warning-0
  it('RTO9a2b - unsupported action is discarded with warning', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO9a2b');

    // Send OBJECT with unknown action
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO9a2b', [
        {
          serial: '01',
          siteCode: 'site1',
          operation: { action: 999, objectId: 'counter:score@1000' },
        },
      ]),
    );
    await flushAsync();

    // Pool should be unchanged
    expect(root.get('score').value()).to.equal(100);
  });

  // UTS: objects/unit/RTO6/zero-value-from-prefix-0
  it('RTO6 - zero-value object creation from objectId prefix', async function () {
    const { root, mockWs, channel } = await setupSyncedChannel('test-RTO6');

    const rto = getRealtimeObject(channel);

    // Send counter increment for non-existent counter
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO6', [buildCounterInc('counter:new@2000', 5, '01', 'site1')]),
    );
    await flushAsync();

    // counter:new@2000 should be created as zero-value then increment applied
    const counterObj = rto._objectsPool.get('counter:new@2000');
    expect(counterObj).to.exist;
    expect(counterObj.value()).to.equal(5);

    // Send map set for non-existent map
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO6', [buildMapSet('map:new@2000', 'key', { string: 'val' }, 't:1', 'site1')]),
    );
    await flushAsync();

    // map:new@2000 should be created as zero-value then set applied
    const mapObj = rto._objectsPool.get('map:new@2000');
    expect(mapObj).to.exist;
  });

  // UTS: objects/unit/RTO5d/null-object-skipped-0
  it('RTO5d - OBJECT_SYNC with null object field is skipped', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5d', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              { object: null },
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
                  createOp: mapCreateOp('root'),
                },
              ),
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');
  });

  // UTS: objects/unit/RTO5f3/unsupported-type-skipped-0
  it('RTO5f3 - OBJECT_SYNC with unsupported object type is skipped', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5f3', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
                  createOp: mapCreateOp('root'),
                },
              ),
              // Object with no map or counter field — unsupported type
              { object: { objectId: 'unknown:xyz@1000', siteTimeserials: {} } },
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');
    expect(rto._objectsPool.get('unknown:xyz@1000')).to.be.undefined;
  });

  // UTS: objects/unit/RTO5e/object-sync-transitions-syncing-0
  it('RTO5e - OBJECT_SYNC transitions to SYNCING', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5e', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
        }
      },
    });

    await attachChannel(channel);
    await flushAsync();

    const rto = getRealtimeObject(channel);
    // Already in SYNCING from ATTACHED with HAS_OBJECTS
    expect(rto._state).to.equal('syncing');

    // Now complete sync so we reach SYNCED state
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5e', 'sync1:', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
            createOp: mapCreateOp('root'),
          },
        ),
      ]),
    );
    await flushAsync();
    expect(rto._state).to.equal('synced');

    // Send a new OBJECT_SYNC without preceding ATTACHED — should transition to SYNCING
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5e', 'sync2:more', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
          },
        ),
      ]),
    );
    await flushAsync();

    expect(rto._state).to.equal('syncing');
  });

  // UTS: objects/unit/RTO5c7/sync-emits-updates-0
  it('RTO5c7 - sync completion emits updates for existing objects', async function () {
    // Use setupSyncedChannel to get initial state, then resync with new data
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO5c7');

    // Subscribe to root for updates
    const events: any[] = [];
    root.subscribe((event: any) => events.push(event));

    // Trigger re-sync with different data for root
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO5c7',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5c7', 'sync2:', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: {
              semantics: MAP_SEMANTICS_LWW,
              entries: { name: { data: { string: 'Bob' }, timeserial: 't:0' } },
            },
            createOp: mapCreateOp('root'),
          },
        ),
      ]),
    );
    await flushAsync();

    // Should have received at least one update event
    expect(events.length).to.be.greaterThanOrEqual(1);
    // Root should have new data
    expect(root.get('name').value()).to.equal('Bob');
  });

  // UTS: objects/unit/RTO5f2b/partial-counter-error-0
  it('RTO5f2b - partial counter state logs error and keeps first', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5f2b', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          // First message with counter (value = count + createOp.count = 10 + 0 = 10)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:more', [
              buildObjectState(
                'counter:abc@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 10 },
                  createOp: counterCreateOp('counter:abc@1000', 0),
                },
              ),
            ]),
          );
          // Second message with same counter (partial — should be rejected by RTO5f2b)
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
                  createOp: mapCreateOp('root'),
                },
              ),
              buildObjectState(
                'counter:abc@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 5 },
                  createOp: counterCreateOp('counter:abc@1000', 0),
                },
              ),
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    const rto = getRealtimeObject(channel);
    const counterObj = rto._objectsPool.get('counter:abc@1000');
    expect(counterObj).to.exist;
    // First value (10) should be kept, second partial (5) should be rejected
    expect(counterObj.value()).to.equal(10);
  });

  // UTS: objects/unit/RTO4d/attached-clears-buffer-0
  it('RTO4d - ATTACHED clears buffered operations', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO4d', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
        }
      },
    });

    await attachChannel(channel);
    await flushAsync();

    // Buffer an OBJECT message during SYNCING
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO4d', [buildCounterInc('counter:abc@1000', 5, '01', 'site1')]),
    );
    await flushAsync();

    const rto = getRealtimeObject(channel);
    expect(rto._bufferedObjectOperations).to.have.length(1);

    // Send new ATTACHED — buffer should be cleared
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO4d',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    await flushAsync();

    expect(rto._bufferedObjectOperations).to.have.length(0);
  });

  // UTS: objects/unit/RTO4-RTO5/attached-during-syncing-resets-0
  it('RTO4, RTO5 - ATTACHED during SYNCING resets sync', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO4-5', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          // Partial sync
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:more', [
              buildObjectState(
                'counter:old@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 0 },
                  createOp: counterCreateOp('counter:old@1000', 10),
                },
              ),
            ]),
          );
        }
      },
    });

    await attachChannel(channel);
    await flushAsync();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('syncing');

    // New ATTACHED resets sync
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO4-5',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    // Complete the new sync sequence
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO4-5', 'sync2:', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
            createOp: mapCreateOp('root'),
          },
        ),
        buildObjectState(
          'counter:new@1000',
          { aaa: 't:0' },
          {
            counter: { count: 0 },
            createOp: counterCreateOp('counter:new@1000', 99),
          },
        ),
      ]),
    );
    await flushAsync();

    expect(rto._state).to.equal('synced');
    // counter:old@1000 from the abandoned sync should NOT be in pool
    expect(rto._objectsPool.get('counter:old@1000')).to.be.undefined;
    // counter:new@1000 from the new sync should exist
    expect(rto._objectsPool.get('counter:new@1000')).to.exist;
  });

  // UTS: objects/unit/RTO5-RTO7/new-sync-keeps-buffer-0
  it('RTO5, RTO7 - new OBJECT_SYNC sequence does NOT clear buffer', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5-7', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
        }
      },
    });

    await attachChannel(channel);
    await flushAsync();

    // Buffer an OBJECT message during SYNCING
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO5-7', [buildCounterInc('counter:abc@1000', 5, '01', 'site1')]),
    );
    await flushAsync();

    const rto = getRealtimeObject(channel);
    expect(rto._bufferedObjectOperations).to.have.length(1);

    // New OBJECT_SYNC sequence (different id) — buffer should be preserved
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5-7', 'seq2:', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
            createOp: mapCreateOp('root'),
          },
        ),
        buildObjectState(
          'counter:abc@1000',
          { aaa: 't:0' },
          {
            counter: { count: 100 },
            createOp: counterCreateOp('counter:abc@1000', 0),
          },
        ),
      ]),
    );
    await flushAsync();

    expect(rto._state).to.equal('synced');
    // Buffer was applied: 100 + 5 = 105
    // Per RTLC6c/RTLC6d/RTLC16a: counter.count + createOp.count = 100 + 0 = 100, then +5 = 105
    const counterObj = rto._objectsPool.get('counter:abc@1000');
    expect(counterObj).to.exist;
    expect(counterObj.value()).to.equal(105);
  });

  // UTS: objects/unit/RTO7-RTO8/buffer-without-attached-0
  it('RTO7, RTO8 - OBJECT messages buffered even without preceding ATTACHED', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO7-8');

    // Trigger attachment but don't auto-respond — we do it manually
    channel.attach();
    await flushAsync();

    // Send ATTACHED with HAS_OBJECTS manually
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO7-8',
      channelSerial: 'sync1:cursor',
      flags: HAS_OBJECTS,
    });
    await flushAsync();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('syncing');

    // Send OBJECT before sync completes
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO7-8', [buildCounterInc('counter:abc@1000', 5, '01', 'site1')]),
    );
    await flushAsync();

    expect(rto._bufferedObjectOperations).to.have.length(1);
  });

  // UTS: objects/unit/RTO5c9/clear-applied-on-ack-serials-0
  it('RTO5c9 - sync completion clears appliedOnAckSerials', async function () {
    // Use setupSyncedChannel, then manually add to appliedOnAckSerials, then resync
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO5c9');

    const rto = getRealtimeObject(channel);

    // Manually populate appliedOnAckSerials (simulating publish+apply)
    rto._appliedOnAckSerials.add('serial-1');
    rto._appliedOnAckSerials.add('serial-2');
    expect(rto._appliedOnAckSerials.size).to.equal(2);

    // Trigger resync
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO5c9',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5c9', 'sync2:', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: { semantics: MAP_SEMANTICS_LWW, entries: {} },
            createOp: mapCreateOp('root'),
          },
        ),
      ]),
    );
    await flushAsync();

    expect(rto._appliedOnAckSerials.size).to.equal(0);
  });

  // UTS: objects/unit/RTO9a3/dedup-applied-on-ack-0
  it('RTO9a3 - appliedOnAckSerials deduplication', async function () {
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO9a3');

    const rto = getRealtimeObject(channel);

    // Manually add a serial to appliedOnAckSerials (simulating local apply)
    rto._appliedOnAckSerials.add('echo-serial-1');

    // counter:score@1000 starts at 100 (from STANDARD_POOL_OBJECTS createOp)
    const counterObj = rto._objectsPool.get('counter:score@1000');
    expect(counterObj).to.exist;
    const valueBefore = counterObj.value();

    // Send the echo message with the same serial
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO9a3', [
        {
          serial: 'echo-serial-1',
          siteCode: 'site1',
          operation: {
            action: OBJ_OP.COUNTER_INC,
            objectId: 'counter:score@1000',
            counterInc: { number: 5 },
          },
        },
      ]),
    );
    await flushAsync();

    // Counter should NOT have changed (echo was deduplicated)
    expect(counterObj.value()).to.equal(valueBefore);
    // Serial should be removed from the set after dedup
    expect(rto._appliedOnAckSerials.has('echo-serial-1')).to.be.false;
  });

  // UTS: objects/unit/RTO9a2a4/local-source-adds-serial-0
  it('RTO9a2a4 - LOCAL source adds serial to appliedOnAckSerials', async function () {
    // This tests publishAndApply which applies with LOCAL source.
    // setupSyncedChannel handles ACKs, so publishAndApply should work.
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO9a2a4');

    const rto = getRealtimeObject(channel);
    expect(rto._appliedOnAckSerials.size).to.equal(0);

    // Use the public API to increment, which uses publishAndApply
    await root.get('score').increment(5);
    await flushAsync();

    // After publishAndApply, the serial should be in appliedOnAckSerials
    expect(rto._appliedOnAckSerials.size).to.be.greaterThanOrEqual(1);
    // Counter should have been incremented
    expect(root.get('score').value()).to.equal(105);
  });

  // UTS: objects/unit/RTO5c-RTLM23/sync-clear-timeserial-hides-create-entries-0
  it('RTO5c, RTLM23 - sync with clearTimeserial hides initial createOp entries', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5c-RTLM23', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: {
                    semantics: MAP_SEMANTICS_LWW,
                    entries: {},
                    clearTimeserial: '05',
                  },
                  createOp: {
                    action: OBJ_OP.MAP_CREATE,
                    objectId: 'root',
                    mapCreate: {
                      semantics: MAP_SEMANTICS_LWW,
                      entries: {
                        old_key: { data: { string: 'old' }, timeserial: '03' },
                        new_key: { data: { string: 'new' }, timeserial: '07' },
                      },
                    },
                  },
                },
              ),
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');

    // old_key has timeserial '03' which is <= clearTimeserial '05', should be hidden
    expect(root.get('old_key').value()).to.be.undefined;
    // new_key has timeserial '07' which is > clearTimeserial '05', should be present
    expect(root.get('new_key').value()).to.equal('new');
  });

  // UTS: objects/unit/RTO5c10/sync-rebuilds-parent-refs-0
  it('RTO5c10 - sync rebuilds parentReferences', async function () {
    const { channel, root, mockWs } = await setupSyncedChannel('test-RTO5c10');

    const rto = getRealtimeObject(channel);

    // After standard sync, verify parentReferences match the standard pool tree:
    // root: no parent
    const rootObj = rto._objectsPool.get('root');
    expectParentRefs(rootObj, {});

    // counter:score@1000: referenced by root at key "score"
    const scoreObj = rto._objectsPool.get('counter:score@1000');
    expectParentRefs(scoreObj, { root: ['score'] });

    // map:profile@1000: referenced by root at key "profile"
    const profileObj = rto._objectsPool.get('map:profile@1000');
    expectParentRefs(profileObj, { root: ['profile'] });

    // counter:nested@1000: referenced by map:profile@1000 at key "nested_counter"
    const nestedObj = rto._objectsPool.get('counter:nested@1000');
    expectParentRefs(nestedObj, { 'map:profile@1000': ['nested_counter'] });

    // map:prefs@1000: referenced by map:profile@1000 at key "prefs"
    const prefsObj = rto._objectsPool.get('map:prefs@1000');
    expectParentRefs(prefsObj, { 'map:profile@1000': ['prefs'] });
  });

  // UTS: objects/unit/RTO5c10/resync-rebuilds-parent-refs-0
  it('RTO5c10 - re-sync rebuilds parentReferences with new tree structure', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5c10-resync', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          // First sync: counter:abc@1000 is a child of root
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: {
                    semantics: MAP_SEMANTICS_LWW,
                    entries: {
                      counter_key: { data: { objectId: 'counter:abc@1000' }, timeserial: 't:0' },
                    },
                  },
                  createOp: mapCreateOp('root'),
                },
              ),
              buildObjectState(
                'counter:abc@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 0 },
                  createOp: counterCreateOp('counter:abc@1000', 10),
                },
              ),
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');

    // Verify first sync parentReferences
    const counterObj = rto._objectsPool.get('counter:abc@1000');
    expectParentRefs(counterObj, { root: ['counter_key'] });

    // Second sync: counter:abc@1000 is now a child of map:wrapper@1000, not root
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO5c10-resync',
      channelSerial: 'sync2:cursor',
      flags: HAS_OBJECTS,
    });
    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5c10-resync', 'sync2:', [
        buildObjectState(
          'root',
          { aaa: 't:1' },
          {
            map: {
              semantics: MAP_SEMANTICS_LWW,
              entries: {
                wrapper: { data: { objectId: 'map:wrapper@1000' }, timeserial: 't:1' },
              },
            },
            createOp: mapCreateOp('root'),
          },
        ),
        buildObjectState(
          'map:wrapper@1000',
          { aaa: 't:1' },
          {
            map: {
              semantics: MAP_SEMANTICS_LWW,
              entries: {
                moved_counter: { data: { objectId: 'counter:abc@1000' }, timeserial: 't:1' },
              },
            },
            createOp: mapCreateOp('map:wrapper@1000'),
          },
        ),
        buildObjectState(
          'counter:abc@1000',
          { aaa: 't:1' },
          {
            counter: { count: 0 },
            createOp: counterCreateOp('counter:abc@1000', 20),
          },
        ),
      ]),
    );
    await flushAsync();

    expect(rto._state).to.equal('synced');

    // root is not referenced by any parent
    const rootObj = rto._objectsPool.get('root');
    expectParentRefs(rootObj, {});

    // map:wrapper@1000 is now a child of root at key "wrapper"
    const wrapperObj = rto._objectsPool.get('map:wrapper@1000');
    expectParentRefs(wrapperObj, { root: ['wrapper'] });

    // counter:abc@1000 is now a child of map:wrapper@1000, NOT of root
    const counterObjAfter = rto._objectsPool.get('counter:abc@1000');
    expectParentRefs(counterObjAfter, { 'map:wrapper@1000': ['moved_counter'] });
  });

  // UTS: objects/unit/RTO5c10/empty-sync-parent-refs-0
  it('RTO5c10 - empty sync leaves root with empty parentReferences', async function () {
    const { channel, mockWs } = await setupManualChannel('test-RTO5c10-empty', {
      onMessageFromClient: (msg, ws) => {
        if (msg.action === PM_ACTION.ATTACH) {
          ws.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:cursor',
            flags: HAS_OBJECTS,
          });
          // First sync: root has a child counter
          ws.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: {
                    semantics: MAP_SEMANTICS_LWW,
                    entries: {
                      child: { data: { objectId: 'counter:child@1000' }, timeserial: 't:0' },
                    },
                  },
                  createOp: mapCreateOp('root'),
                },
              ),
              buildObjectState(
                'counter:child@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 0 },
                  createOp: counterCreateOp('counter:child@1000', 1),
                },
              ),
            ]),
          );
        }
      },
    });

    const root = await channel.object.get();

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');

    // Verify parentReferences are populated after first sync
    const childObj = rto._objectsPool.get('counter:child@1000');
    expect(childObj).to.exist;
    expectParentRefs(childObj, { root: ['child'] });

    // Empty sync: ATTACHED without HAS_OBJECTS
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO5c10-empty',
      flags: 0,
    });
    await flushAsync();

    expect(rto._state).to.equal('synced');

    // counter:child@1000 was removed from pool (RTO4b1)
    expect(rto._objectsPool.get('counter:child@1000')).to.be.undefined;

    // root exists with empty data and empty parentReferences
    const rootObj = rto._objectsPool.get('root');
    expect(rootObj).to.exist;
    expectParentRefs(rootObj, {});
    expect(root.size()).to.equal(0);
  });
});
