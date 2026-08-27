/**
 * UTS: Parent References Tests
 *
 * Spec points: RTLO3f, RTLO4g, RTLO4h, RTLO4f, RTO5c10
 * Source: uts/objects/unit/parent_references.md
 *
 * Tests the parentReferences tracking on LiveObject, the addParentReference and
 * removeParentReference methods, the getFullPaths graph traversal, and the
 * post-sync rebuild of parentReferences by the ObjectsPool.
 *
 * parentReferences is a Map<LiveObject, Set<string>> keyed by parent LiveObject
 * instance, with each value being the set of keys at which that parent references
 * this LiveObject.
 */

import { expect } from 'chai';
import { restoreAll, flushAsync } from '../../helpers';
import {
  setupSyncedChannel,
  buildObjectSyncMessage,
  buildObjectState,
  OBJ_OP,
  PM_ACTION,
  HAS_OBJECTS,
  MAP_SEMANTICS_LWW,
} from '../helpers/standard_test_pool';
import { LiveCounter } from '../../../../src/plugins/liveobjects/livecounter';
import { LiveMap } from '../../../../src/plugins/liveobjects/livemap';

/**
 * Helper to get the RealtimeObject from a channel.
 */
function getRealtimeObject(channel: any): any {
  return channel._object;
}

/**
 * Helper to get a LiveObject from the pool by objectId.
 */
function getFromPool(channel: any, objectId: string): any {
  return getRealtimeObject(channel).getPool().get(objectId);
}

/**
 * Helper to create a zero-value LiveCounter with a given objectId.
 */
function createZeroCounter(channel: any, objectId: string): LiveCounter {
  const realtimeObject = getRealtimeObject(channel);
  return LiveCounter.zeroValue(realtimeObject, objectId);
}

/**
 * Helper to create a zero-value LiveMap with a given objectId.
 */
function createZeroMap(channel: any, objectId: string): LiveMap {
  const realtimeObject = getRealtimeObject(channel);
  return LiveMap.zeroValue(realtimeObject, objectId);
}

/**
 * Helper to get the _parentReferences Map from a LiveObject.
 */
function getParentRefs(obj: any): Map<any, Set<string>> {
  return (obj as any)._parentReferences;
}

/**
 * Helper to assert that a LiveObject's parentReferences contains a specific parent
 * with the expected set of keys.
 */
function assertParentRefKeys(child: any, parent: any, expectedKeys: string[]): void {
  const refs = getParentRefs(child);
  const keys = refs.get(parent);
  expect(keys, `Expected parent ${parent.getObjectId()} in parentReferences`).to.exist;
  expect([...keys!].sort()).to.deep.equal([...expectedKeys].sort());
}

/**
 * Normalize paths for order-independent comparison: sort each path array as a
 * string and then sort the list of stringified paths.
 */
function normalizePaths(paths: string[][]): string {
  return JSON.stringify(paths.map((p) => JSON.stringify(p)).sort());
}

/**
 * Assert that a set of paths contains the expected paths (order-independent).
 */
function assertPathsContain(actual: string[][], expected: string[][]): void {
  const actualStr = actual.map((p) => JSON.stringify(p)).sort();
  for (const exp of expected) {
    const expStr = JSON.stringify(exp);
    expect(actualStr, `Expected paths to contain ${expStr}`).to.include(expStr);
  }
}

describe('uts/objects/unit/parent_references', function () {
  afterEach(function () {
    restoreAll();
  });

  // =========================================================================
  // RTLO3f2 - parentReferences initialized to empty map
  // =========================================================================

  // UTS: objects/unit/RTLO3f2/init-empty-counter-0
  it('RTLO3f2 - parentReferences initialized to empty map on LiveCounter', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO3f2-counter');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const refs = getParentRefs(counter);
    expect(refs.size).to.equal(0);
  });

  // UTS: objects/unit/RTLO3f2/init-empty-map-0
  it('RTLO3f2 - parentReferences initialized to empty map on LiveMap', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO3f2-map');

    const map = createZeroMap(channel, 'map:abc@1000');

    const refs = getParentRefs(map);
    expect(refs.size).to.equal(0);
  });

  // =========================================================================
  // RTLO4g - addParentReference
  // =========================================================================

  // UTS: objects/unit/RTLO4g2/first-reference-new-entry-0
  it('RTLO4g2 - addParentReference creates new entry for first reference', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4g2-first');

    const child = createZeroCounter(channel, 'counter:child@1000');
    const parent = createZeroMap(channel, 'map:parent@1000');

    child.addParentReference(parent, 'score');

    const refs = getParentRefs(child);
    expect(refs.has(parent)).to.equal(true);
    assertParentRefKeys(child, parent, ['score']);
  });

  // UTS: objects/unit/RTLO4g1/second-key-same-parent-0
  it('RTLO4g1 - addParentReference adds key to existing entry for same parent', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4g1-second');

    const child = createZeroCounter(channel, 'counter:child@1000');
    const parent = createZeroMap(channel, 'map:parent@1000');

    // Pre-set state: parent already references child at "score"
    child.addParentReference(parent, 'score');

    // Add a second key for the same parent
    child.addParentReference(parent, 'points');

    assertParentRefKeys(child, parent, ['score', 'points']);
  });

  // UTS: objects/unit/RTLO4g/different-parent-separate-entry-0
  it('RTLO4g - addParentReference with different parent creates separate entry', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4g-diff');

    const child = createZeroCounter(channel, 'counter:child@1000');
    const parentA = createZeroMap(channel, 'map:a@1000');
    const parentB = createZeroMap(channel, 'map:b@1000');

    child.addParentReference(parentA, 'x');
    child.addParentReference(parentB, 'y');

    const refs = getParentRefs(child);
    expect(refs.size).to.equal(2);
    assertParentRefKeys(child, parentA, ['x']);
    assertParentRefKeys(child, parentB, ['y']);
  });

  // UTS: objects/unit/RTLO4g/multiple-parents-multiple-keys-0
  it('RTLO4g - addParentReference with multiple parents and multiple keys', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4g-multi');

    const child = createZeroCounter(channel, 'counter:child@1000');
    const parentA = createZeroMap(channel, 'map:a@1000');
    const parentB = createZeroMap(channel, 'map:b@1000');

    child.addParentReference(parentA, 'x');
    child.addParentReference(parentA, 'y');
    child.addParentReference(parentB, 'p');
    child.addParentReference(parentB, 'q');

    assertParentRefKeys(child, parentA, ['x', 'y']);
    assertParentRefKeys(child, parentB, ['p', 'q']);
  });

  // =========================================================================
  // RTLO4h - removeParentReference
  // =========================================================================

  // UTS: objects/unit/RTLO4h1/nonexistent-parent-noop-0
  it('RTLO4h1 - removeParentReference no-op for non-existent parent', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4h1-noop');

    const child = createZeroCounter(channel, 'counter:child@1000');
    const parent = createZeroMap(channel, 'map:parent@1000');

    child.removeParentReference(parent, 'score');

    const refs = getParentRefs(child);
    expect(refs.size).to.equal(0);
  });

  // UTS: objects/unit/RTLO4h2/remove-key-leaves-others-0
  it('RTLO4h2 - removeParentReference removes key but leaves other keys', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4h2-leaves');

    const child = createZeroCounter(channel, 'counter:child@1000');
    const parent = createZeroMap(channel, 'map:parent@1000');

    // Pre-set: parent references child at "score" and "points"
    child.addParentReference(parent, 'score');
    child.addParentReference(parent, 'points');

    child.removeParentReference(parent, 'score');

    assertParentRefKeys(child, parent, ['points']);
  });

  // UTS: objects/unit/RTLO4h3/remove-last-key-removes-entry-0
  it('RTLO4h3 - removeParentReference removes entry when set becomes empty', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4h3-last');

    const child = createZeroCounter(channel, 'counter:child@1000');
    const parent = createZeroMap(channel, 'map:parent@1000');

    // Pre-set: parent references child at "score"
    child.addParentReference(parent, 'score');

    child.removeParentReference(parent, 'score');

    const refs = getParentRefs(child);
    expect(refs.has(parent)).to.equal(false);
    expect(refs.size).to.equal(0);
  });

  // UTS: objects/unit/RTLO4h/remove-nonexistent-key-0
  it('RTLO4h - removeParentReference for non-existent key in existing parent', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4h-nokey');

    const child = createZeroCounter(channel, 'counter:child@1000');
    const parent = createZeroMap(channel, 'map:parent@1000');

    // Pre-set: parent references child at "score"
    child.addParentReference(parent, 'score');

    child.removeParentReference(parent, 'nonexistent');

    assertParentRefKeys(child, parent, ['score']);
  });

  // =========================================================================
  // RTLO4f - getFullPaths
  // =========================================================================

  // UTS: objects/unit/RTLO4f2/root-returns-empty-path-0
  it('RTLO4f2 - getFullPaths for root returns empty key-path', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4f2-root');

    const root = getFromPool(channel, 'root');
    expect(root).to.exist;

    const paths = root.getFullPaths();
    expect(paths.length).to.equal(1);
    expect(paths).to.deep.include([]);
  });

  // UTS: objects/unit/RTLO4f/direct-child-single-path-0
  it('RTLO4f - getFullPaths for direct child of root', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4f-child');

    const root = getFromPool(channel, 'root');
    const counter = createZeroCounter(channel, 'counter:score@2000');
    // Register in pool so it can be found
    getRealtimeObject(channel).getPool().set('counter:score@2000', counter);

    counter.addParentReference(root, 'score');

    const paths = counter.getFullPaths();
    expect(paths.length).to.equal(1);
    assertPathsContain(paths, [['score']]);
  });

  // UTS: objects/unit/RTLO4f/deep-nesting-0
  it('RTLO4f - getFullPaths for deeply nested object', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4f-deep');

    const root = getFromPool(channel, 'root');

    const profile = createZeroMap(channel, 'map:profile@2000');
    getRealtimeObject(channel).getPool().set('map:profile@2000', profile);
    profile.addParentReference(root, 'profile');

    const prefs = createZeroMap(channel, 'map:prefs@2000');
    getRealtimeObject(channel).getPool().set('map:prefs@2000', prefs);
    prefs.addParentReference(profile, 'prefs');

    const themeCounter = createZeroCounter(channel, 'counter:theme@2000');
    getRealtimeObject(channel).getPool().set('counter:theme@2000', themeCounter);
    themeCounter.addParentReference(prefs, 'theme_counter');

    const paths = themeCounter.getFullPaths();
    expect(paths.length).to.equal(1);
    assertPathsContain(paths, [['profile', 'prefs', 'theme_counter']]);
  });

  // UTS: objects/unit/RTLO4f/diamond-graph-0
  it('RTLO4f - getFullPaths with multiple parents (diamond graph)', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4f-diamond');

    const root = getFromPool(channel, 'root');

    const mapA = createZeroMap(channel, 'map:a@2000');
    getRealtimeObject(channel).getPool().set('map:a@2000', mapA);
    mapA.addParentReference(root, 'a');

    const mapB = createZeroMap(channel, 'map:b@2000');
    getRealtimeObject(channel).getPool().set('map:b@2000', mapB);
    mapB.addParentReference(root, 'b');

    const leaf = createZeroCounter(channel, 'counter:leaf@2000');
    getRealtimeObject(channel).getPool().set('counter:leaf@2000', leaf);
    leaf.addParentReference(mapA, 'x');
    leaf.addParentReference(mapB, 'y');

    const paths = leaf.getFullPaths();
    expect(paths.length).to.equal(2);
    assertPathsContain(paths, [
      ['a', 'x'],
      ['b', 'y'],
    ]);
  });

  // UTS: objects/unit/RTLO4f/single-parent-multiple-keys-0
  it('RTLO4f - getFullPaths with single parent referencing at multiple keys', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4f-multikey');

    const root = getFromPool(channel, 'root');

    const child = createZeroCounter(channel, 'counter:child@2000');
    getRealtimeObject(channel).getPool().set('counter:child@2000', child);
    child.addParentReference(root, 'primary');
    child.addParentReference(root, 'alias');

    const paths = child.getFullPaths();
    expect(paths.length).to.equal(2);
    assertPathsContain(paths, [['primary'], ['alias']]);
  });

  // UTS: objects/unit/RTLO4f/orphan-returns-empty-0
  it('RTLO4f - getFullPaths for orphan returns empty list', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4f-orphan');

    const orphan = createZeroCounter(channel, 'counter:orphan@2000');
    getRealtimeObject(channel).getPool().set('counter:orphan@2000', orphan);

    const paths = orphan.getFullPaths();
    expect(paths.length).to.equal(0);
  });

  // UTS: objects/unit/RTLO4f/cycle-suppression-0
  it('RTLO4f - getFullPaths suppresses cycles', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4f-cycle');

    const root = getFromPool(channel, 'root');

    const mapA = createZeroMap(channel, 'map:a@2000');
    getRealtimeObject(channel).getPool().set('map:a@2000', mapA);
    mapA.addParentReference(root, 'a');

    const mapB = createZeroMap(channel, 'map:b@2000');
    getRealtimeObject(channel).getPool().set('map:b@2000', mapB);
    mapB.addParentReference(mapA, 'b');

    // Create a cycle: map:A also has map:B as a parent
    mapA.addParentReference(mapB, 'a');

    // map:B should still have exactly one valid path: ["a", "b"]
    const pathsB = mapB.getFullPaths();
    expect(pathsB.length).to.equal(1);
    assertPathsContain(pathsB, [['a', 'b']]);

    // map:A should still have exactly one valid path: ["a"]
    const pathsA = mapA.getFullPaths();
    expect(pathsA.length).to.equal(1);
    assertPathsContain(pathsA, [['a']]);
  });

  // UTS: objects/unit/RTLO4f/complex-diamond-deep-0
  it('RTLO4f - getFullPaths with complex diamond and deep nesting', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO4f-complex');

    const root = getFromPool(channel, 'root');

    const mapL = createZeroMap(channel, 'map:l@2000');
    getRealtimeObject(channel).getPool().set('map:l@2000', mapL);
    mapL.addParentReference(root, 'left');

    const mapR = createZeroMap(channel, 'map:r@2000');
    getRealtimeObject(channel).getPool().set('map:r@2000', mapR);
    mapR.addParentReference(root, 'right');

    const mapM = createZeroMap(channel, 'map:m@2000');
    getRealtimeObject(channel).getPool().set('map:m@2000', mapM);
    mapM.addParentReference(mapL, 'mid');

    const target = createZeroCounter(channel, 'counter:t@2000');
    getRealtimeObject(channel).getPool().set('counter:t@2000', target);
    target.addParentReference(mapM, 'target');
    target.addParentReference(mapR, 'target');

    const paths = target.getFullPaths();
    expect(paths.length).to.equal(2);
    assertPathsContain(paths, [
      ['left', 'mid', 'target'],
      ['right', 'target'],
    ]);
  });

  // =========================================================================
  // RTO5c10 - Post-sync rebuild of parentReferences
  // =========================================================================

  // UTS: objects/unit/RTO5c10/rebuild-from-sync-0
  it('RTO5c10 - Post-sync rebuild populates parentReferences from LiveMap entries', async function () {
    const { channel } = await setupSyncedChannel('test-RTO5c10-rebuild');

    const rto = getRealtimeObject(channel);
    expect(rto._state).to.equal('synced');

    // Get objects from the pool (populated by STANDARD_POOL_OBJECTS sync)
    const root = getFromPool(channel, 'root');
    const score = getFromPool(channel, 'counter:score@1000');
    const profile = getFromPool(channel, 'map:profile@1000');
    const nested = getFromPool(channel, 'counter:nested@1000');
    const prefs = getFromPool(channel, 'map:prefs@1000');

    expect(root).to.exist;
    expect(score).to.exist;
    expect(profile).to.exist;
    expect(nested).to.exist;
    expect(prefs).to.exist;

    // root has no parent references
    expect(getParentRefs(root).size).to.equal(0);

    // counter:score@1000 is referenced by root at key "score"
    assertParentRefKeys(score, root, ['score']);

    // map:profile@1000 is referenced by root at key "profile"
    assertParentRefKeys(profile, root, ['profile']);

    // counter:nested@1000 is referenced by map:profile@1000 at key "nested_counter"
    assertParentRefKeys(nested, profile, ['nested_counter']);

    // map:prefs@1000 is referenced by map:profile@1000 at key "prefs"
    assertParentRefKeys(prefs, profile, ['prefs']);

    // getFullPaths works correctly after rebuild
    const scorePaths = score.getFullPaths();
    assertPathsContain(scorePaths, [['score']]);

    const nestedPaths = nested.getFullPaths();
    assertPathsContain(nestedPaths, [['profile', 'nested_counter']]);
  });

  // UTS: objects/unit/RTO5c10a/rebuild-clears-stale-refs-0
  it('RTO5c10a - Post-sync rebuild clears stale parentReferences', async function () {
    const { channel, mockWs } = await setupSyncedChannel('test-RTO5c10a-stale');

    const rto = getRealtimeObject(channel);

    // After first sync, counter:score@1000 should be referenced by root at "score"
    const score = getFromPool(channel, 'counter:score@1000');
    const root = getFromPool(channel, 'root');
    assertParentRefKeys(score, root, ['score']);

    // Second sync: root --"points"--> counter:score@1000 (key changed from "score" to "points")
    // Send new ATTACHED + OBJECT_SYNC
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO5c10a-stale',
      channelSerial: 'sync2:',
      flags: HAS_OBJECTS,
    });

    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5c10a-stale', 'sync2:', [
        buildObjectState(
          'root',
          { aaa: 't:1' },
          {
            map: {
              semantics: MAP_SEMANTICS_LWW,
              entries: {
                points: { data: { objectId: 'counter:score@1000' }, timeserial: 't:1' },
              },
            },
            createOp: {
              action: OBJ_OP.MAP_CREATE,
              objectId: 'root',
              mapCreate: { semantics: MAP_SEMANTICS_LWW, entries: {} },
            },
          },
        ),
        buildObjectState(
          'counter:score@1000',
          { aaa: 't:1' },
          {
            counter: { count: 0 },
            createOp: {
              action: OBJ_OP.COUNTER_CREATE,
              objectId: 'counter:score@1000',
              counterCreate: { count: 20 },
            },
          },
        ),
      ]),
    );
    await flushAsync();

    expect(rto._state).to.equal('synced');

    // Get the (potentially reused) objects from the pool after resync
    const scoreAfter = getFromPool(channel, 'counter:score@1000');
    const rootAfter = getFromPool(channel, 'root');
    expect(scoreAfter).to.exist;
    expect(rootAfter).to.exist;

    // Old "score" reference should be gone, replaced by "points"
    assertParentRefKeys(scoreAfter, rootAfter, ['points']);

    const paths = scoreAfter.getFullPaths();
    expect(paths.length).to.equal(1);
    assertPathsContain(paths, [['points']]);
  });

  // UTS: objects/unit/RTO5c10/unreferenced-empty-refs-0
  it('RTO5c10 - Post-sync unreferenced objects have empty parentReferences', async function () {
    const { channel, mockWs } = await setupSyncedChannel('test-RTO5c10-orphan');

    const rto = getRealtimeObject(channel);

    // Send a new ATTACHED + OBJECT_SYNC with an unreferenced counter
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.ATTACHED,
      channel: 'test-RTO5c10-orphan',
      channelSerial: 'sync2:',
      flags: HAS_OBJECTS,
    });

    mockWs.active_connection!.send_to_client(
      buildObjectSyncMessage('test-RTO5c10-orphan', 'sync2:', [
        buildObjectState(
          'root',
          { aaa: 't:0' },
          {
            map: {
              semantics: MAP_SEMANTICS_LWW,
              entries: {
                name: { data: { string: 'Alice' }, timeserial: 't:0' },
              },
            },
            createOp: {
              action: OBJ_OP.MAP_CREATE,
              objectId: 'root',
              mapCreate: { semantics: MAP_SEMANTICS_LWW, entries: {} },
            },
          },
        ),
        buildObjectState(
          'counter:orphan@1000',
          { aaa: 't:0' },
          {
            counter: { count: 0 },
            createOp: {
              action: OBJ_OP.COUNTER_CREATE,
              objectId: 'counter:orphan@1000',
              counterCreate: { count: 42 },
            },
          },
        ),
      ]),
    );
    await flushAsync();

    expect(rto._state).to.equal('synced');

    // The counter exists in the pool but no LiveMap entry points to it
    const orphan = getFromPool(channel, 'counter:orphan@1000');
    expect(orphan).to.exist;

    const refs = getParentRefs(orphan);
    expect(refs.size).to.equal(0);

    // getFullPaths returns empty list for unreferenced object
    const paths = orphan.getFullPaths();
    expect(paths.length).to.equal(0);
  });
});
