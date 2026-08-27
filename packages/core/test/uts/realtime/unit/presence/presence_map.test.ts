/**
 * UTS: PresenceMap Tests
 *
 * Spec points: RTP2, RTP2a, RTP2b, RTP2b1, RTP2b1a, RTP2b2, RTP2c, RTP2d,
 *              RTP2d1, RTP2d2, RTP2h, RTP2h1, RTP2h1a, RTP2h1b, RTP2h2,
 *              RTP2h2a, RTP2h2b
 * Source: specification/uts/realtime/unit/presence/presence_map.md
 *
 * Tests the PresenceMap data structure that maintains a map of members currently
 * present on a channel. The map is keyed by memberKey (TP3h: connectionId:clientId)
 * and stores PresenceMessage values with action set to PRESENT (or ABSENT during sync).
 *
 * NOTE: In ably-js, PresenceMap.put() returns boolean (true if accepted, false if
 * rejected by newerThan), not the PresenceMessage. Similarly, PresenceMap.remove()
 * returns boolean (true if existing member found). The UTS spec describes an
 * idealized interface where put() returns the message. Tests are adapted accordingly.
 */

import { expect } from 'chai';
import { PresenceMap } from '../../../../../src/common/lib/client/presencemap';
import PresenceMessage from '../../../../../src/common/lib/types/presencemessage';
import Logger from '../../../../../src/common/lib/util/logger';

/**
 * Create a minimal mock RealtimePresence that satisfies PresenceMap's constructor.
 * PresenceMap needs: presence.channel.name, presence.logger, presence._synthesizeLeaves,
 * and presence.syncComplete (set by setInProgress).
 */
function createMockPresence(): any {
  const logger = new Logger();
  logger.setLog(0);
  return {
    channel: { name: 'test-channel' },
    logger: logger,
    syncComplete: true,
    _synthesizeLeaves: (_items: any[]) => {},
  };
}

/**
 * Create a PresenceMessage with the given properties.
 * Actions are strings in ably-js: 'absent', 'present', 'enter', 'leave', 'update'.
 */
function makePresenceMessage(props: {
  action: string;
  clientId: string;
  connectionId: string;
  id: string;
  timestamp: number;
  data?: any;
}): PresenceMessage {
  return PresenceMessage.fromValues({
    action: props.action,
    clientId: props.clientId,
    connectionId: props.connectionId,
    id: props.id,
    timestamp: props.timestamp,
    data: props.data,
  });
}

/**
 * Create a PresenceMap keyed by memberKey (connectionId:clientId), which is the
 * standard key for the main presence map (TP3h).
 */
function createPresenceMap(): PresenceMap {
  const mockPresence = createMockPresence();
  return new PresenceMap(mockPresence, (item) => item.connectionId + ':' + item.clientId);
}

describe('uts/realtime/unit/presence/presence_map', function () {
  /**
   * RTP2 - Basic put and get
   *
   * Use a PresenceMap to maintain a list of members present on a channel,
   * a map of memberKeys to presence messages.
   */
  // UTS: realtime/unit/RTP2/basic-put-and-get-0
  it('RTP2 - basic put and get', function () {
    const map = createPresenceMap();

    const msg = makePresenceMessage({
      action: 'enter',
      clientId: 'client-1',
      connectionId: 'conn-1',
      id: 'conn-1:0:0',
      timestamp: 1000,
    });
    const result = map.put(msg);

    expect(result).to.equal(true);
    expect(map.get('conn-1:client-1')).to.not.be.undefined;
    expect(map.get('conn-1:client-1').clientId).to.equal('client-1');
    expect(map.get('conn-1:client-1').connectionId).to.equal('conn-1');
  });

  /**
   * RTP2d2 - ENTER stored as PRESENT
   *
   * When an ENTER, UPDATE, or PRESENT message is received, add to the
   * presence map with action set to PRESENT.
   */
  // UTS: realtime/unit/RTP2d2/enter-stored-as-present-0
  it('RTP2d2 - ENTER stored as PRESENT', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:0:0',
        timestamp: 1000,
        data: 'entered',
      }),
    );

    const stored = map.get('conn-1:client-1');
    expect(stored).to.not.be.undefined;
    expect(stored.action).to.equal('present'); // RTP2d2: stored as PRESENT regardless of original action
    expect(stored.data).to.equal('entered');
  });

  /**
   * RTP2d2 - UPDATE stored as PRESENT
   *
   * UPDATE messages are also stored with action PRESENT.
   */
  // UTS: realtime/unit/RTP2d2/update-stored-as-present-1
  it('RTP2d2 - UPDATE stored as PRESENT', function () {
    const map = createPresenceMap();

    // First enter
    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:0:0',
        timestamp: 1000,
        data: 'initial',
      }),
    );

    // Then update
    map.put(
      makePresenceMessage({
        action: 'update',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:1:0',
        timestamp: 2000,
        data: 'updated',
      }),
    );

    const stored = map.get('conn-1:client-1');
    expect(stored.action).to.equal('present');
    expect(stored.data).to.equal('updated');
  });

  /**
   * RTP2d2 - PRESENT stored as PRESENT
   *
   * PRESENT messages (from SYNC) are stored with action PRESENT.
   */
  // UTS: realtime/unit/RTP2d2/present-stored-as-present-2
  it('RTP2d2 - PRESENT stored as PRESENT', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({
        action: 'present',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:0:0',
        timestamp: 1000,
      }),
    );

    const stored = map.get('conn-1:client-1');
    expect(stored).to.not.be.undefined;
    expect(stored.action).to.equal('present');
  });

  /**
   * RTP2d1 - put returns message with original action
   *
   * Emit to subscribers with the original action (ENTER, UPDATE, or PRESENT),
   * not the stored PRESENT action.
   *
   * NOTE: In ably-js, put() returns boolean, not the message. The action conversion
   * to PRESENT happens inside put() before storing. The original action is NOT
   * preserved in the return value. Event emission with original action is done at a
   * higher level (RealtimePresence), not inside PresenceMap.put().
   * This test verifies the ably-js behavior: put() returns true for accepted messages.
   */
  // UTS: realtime/unit/RTP2d1/put-returns-original-action-0
  it('RTP2d1 - put returns true for accepted messages', function () {
    const map = createPresenceMap();

    const resultEnter = map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:0:0',
        timestamp: 1000,
      }),
    );

    const resultUpdate = map.put(
      makePresenceMessage({
        action: 'update',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:1:0',
        timestamp: 2000,
        data: 'updated',
      }),
    );

    // In ably-js, put() returns boolean true for accepted
    expect(resultEnter).to.equal(true);
    expect(resultUpdate).to.equal(true);
  });

  /**
   * RTP2h1 - LEAVE outside sync removes member
   *
   * When a LEAVE message is received and SYNC is NOT in progress,
   * emit LEAVE and delete from presence map.
   */
  // UTS: realtime/unit/RTP2h1/leave-outside-sync-removes-0
  it('RTP2h1 - LEAVE outside sync removes member', function () {
    const map = createPresenceMap();

    // Add a member
    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:0:0',
        timestamp: 1000,
      }),
    );

    // Remove the member
    const result = map.remove(
      makePresenceMessage({
        action: 'leave',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:1:0',
        timestamp: 2000,
      }),
    );

    // RTP2h1a: remove returns true (existing member was found)
    expect(result).to.equal(true);

    // RTP2h1b: deleted from presence map
    expect(map.get('conn-1:client-1')).to.be.undefined;
    expect(map.values()).to.have.length(0);
  });

  /**
   * RTP2h1 - LEAVE for non-existent member returns false
   *
   * If there is no matching memberKey in the map, there is nothing to remove.
   * In ably-js, remove() returns false when no existing item is found.
   */
  // UTS: realtime/unit/RTP2h1/leave-nonexistent-returns-null-1
  it('RTP2h1 - LEAVE for non-existent member returns false', function () {
    const map = createPresenceMap();

    const result = map.remove(
      makePresenceMessage({
        action: 'leave',
        clientId: 'unknown',
        connectionId: 'conn-x',
        id: 'conn-x:0:0',
        timestamp: 1000,
      }),
    );

    expect(result).to.equal(false);
  });

  /**
   * RTP2h2a - LEAVE during sync stores as ABSENT
   *
   * If a SYNC is in progress and a LEAVE message is received,
   * store the member in the presence map with action set to ABSENT.
   *
   * NOTE: In ably-js, remove() during sync stores as ABSENT and returns true
   * (existing member found). The UTS spec says no LEAVE is emitted during sync
   * (i.e. remove returns null). In ably-js, the return is boolean indicating
   * whether an existing member was found.
   */
  // UTS: realtime/unit/RTP2h2a/leave-during-sync-stores-absent-0
  it('RTP2h2a - LEAVE during sync stores as ABSENT', function () {
    const map = createPresenceMap();

    // Add a member
    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:0:0',
        timestamp: 1000,
      }),
    );

    // Start sync
    map.startSync();

    // LEAVE during sync
    const result = map.remove(
      makePresenceMessage({
        action: 'leave',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:1:0',
        timestamp: 2000,
      }),
    );

    // In ably-js, remove() returns true because an existing member was found
    expect(result).to.equal(true);

    // Member is stored as ABSENT (not deleted)
    const stored = map.get('conn-1:client-1');
    expect(stored).to.not.be.undefined;
    expect(stored.action).to.equal('absent');
  });

  /**
   * RTP2h2b - ABSENT members deleted on endSync
   *
   * When SYNC completes, delete all members with action ABSENT.
   * Additionally, residual members (present at start of sync but not seen during sync)
   * are also removed.
   */
  // UTS: realtime/unit/RTP2h2b/absent-deleted-on-endsync-0
  it('RTP2h2b - ABSENT members deleted on endSync', function () {
    const map = createPresenceMap();

    // Track synthesized leaves
    const synthesizedLeaves: any[] = [];
    const mockPresence = (map as any).presence;
    mockPresence._synthesizeLeaves = (items: any[]) => {
      synthesizedLeaves.push(...items);
    };

    // Add two members
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }),
    );
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }),
    );

    // Start sync
    map.startSync();

    // Alice gets updated during sync (still present)
    map.put(
      makePresenceMessage({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }),
    );

    // Bob sends LEAVE during sync (stored as ABSENT)
    map.remove(
      makePresenceMessage({ action: 'leave', clientId: 'bob', connectionId: 'c2', id: 'c2:1:0', timestamp: 200 }),
    );

    // End sync
    map.endSync();

    // Bob's ABSENT entry was deleted
    expect(map.get('c2:bob')).to.be.undefined;

    // Alice remains
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.get('c1:alice').action).to.equal('present');

    expect(map.values()).to.have.length(1);
  });

  /**
   * RTP2b2 - Newness comparison by id (msgSerial:index)
   *
   * When the connectionId IS an initial substring of the message id,
   * split the id into connectionId:msgSerial:index and compare msgSerial
   * then index numerically. Larger values are newer.
   */
  // UTS: realtime/unit/RTP2b2/newness-by-msgserial-index-0
  it('RTP2b2 - newness comparison by id (msgSerial:index)', function () {
    const map = createPresenceMap();

    // Add initial message with msgSerial=5, index=0
    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:5:0',
        timestamp: 1000,
        data: 'first',
      }),
    );

    // Try to put an older message (msgSerial=3) -- should be rejected
    const staleResult = map.put(
      makePresenceMessage({
        action: 'update',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:3:0',
        timestamp: 2000,
        data: 'stale',
      }),
    );

    // Stale message rejected (RTP2a) — check before newer put
    expect(staleResult).to.equal(false);
    expect(map.get('conn-1:client-1').data).to.equal('first');

    // Put a newer message (msgSerial=7)
    const newerResult = map.put(
      makePresenceMessage({
        action: 'update',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:7:0',
        timestamp: 500,
        data: 'newer',
      }),
    );

    // Newer message accepted (even though timestamp is older)
    expect(newerResult).to.equal(true);
    expect(map.get('conn-1:client-1').data).to.equal('newer');
  });

  /**
   * RTP2b2 - Newness comparison by index when msgSerial equal
   *
   * When msgSerial values are equal, compare by index.
   */
  // UTS: realtime/unit/RTP2b2/newness-by-index-same-serial-1
  it('RTP2b2 - newness comparison by index when msgSerial equal', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:5:2',
        timestamp: 1000,
        data: 'index-2',
      }),
    );

    // Same msgSerial, lower index -- stale
    const stale = map.put(
      makePresenceMessage({
        action: 'update',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:5:1',
        timestamp: 2000,
        data: 'index-1',
      }),
    );

    // Same msgSerial, higher index -- newer
    const newer = map.put(
      makePresenceMessage({
        action: 'update',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:5:5',
        timestamp: 500,
        data: 'index-5',
      }),
    );

    expect(stale).to.equal(false);
    expect(newer).to.equal(true);
    expect(map.get('conn-1:client-1').data).to.equal('index-5');
  });

  /**
   * RTP2b1 - Newness comparison by timestamp (synthesized leave)
   *
   * If either message has a connectionId which is NOT an initial substring
   * of its id, compare by timestamp. This handles "synthesized leave" events
   * where the server generates a LEAVE on behalf of a disconnected client.
   */
  // UTS: realtime/unit/RTP2b1/newness-by-timestamp-0
  it('RTP2b1 - newness comparison by timestamp (synthesized leave)', function () {
    const map = createPresenceMap();

    // Add member with normal id (connectionId is prefix of id)
    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:0:0',
        timestamp: 1000,
        data: 'entered',
      }),
    );

    // Synthesized leave: id does NOT start with connectionId
    const result = map.remove(
      makePresenceMessage({
        action: 'leave',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'synthesized-leave-id',
        timestamp: 2000,
      }),
    );

    // Timestamp 2000 > 1000, so the synthesized leave is newer
    expect(result).to.equal(true);
    expect(map.get('conn-1:client-1')).to.be.undefined;
  });

  /**
   * RTP2b1 - Synthesized leave rejected when older by timestamp
   *
   * When comparing by timestamp, an older synthesized leave is rejected.
   */
  // UTS: realtime/unit/RTP2b1/older-synth-leave-rejected-1
  it('RTP2b1 - synthesized leave rejected when older by timestamp', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:0:0',
        timestamp: 5000,
        data: 'entered',
      }),
    );

    // Synthesized leave with older timestamp
    const result = map.remove(
      makePresenceMessage({
        action: 'leave',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'synthesized-leave-id',
        timestamp: 3000,
      }),
    );

    // Rejected -- existing message (timestamp 5000) is newer
    expect(result).to.equal(false);
    expect(map.get('conn-1:client-1')).to.not.be.undefined;
    expect(map.get('conn-1:client-1').data).to.equal('entered');
  });

  /**
   * RTP2b1a - Equal timestamps: incoming message is newer
   *
   * If timestamps are equal, the newly-incoming message is considered newer.
   */
  // UTS: realtime/unit/RTP2b1a/equal-timestamps-incoming-wins-0
  it('RTP2b1a - equal timestamps: incoming message is newer', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'synthesized-id-1',
        timestamp: 1000,
        data: 'first',
      }),
    );

    // Same timestamp, incoming wins
    const result = map.put(
      makePresenceMessage({
        action: 'update',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'synthesized-id-2',
        timestamp: 1000,
        data: 'second',
      }),
    );

    expect(result).to.equal(true);
    expect(map.get('conn-1:client-1').data).to.equal('second');
  });

  /**
   * RTP2c - SYNC messages use same newness comparison
   *
   * Presence events from a SYNC must be compared for newness
   * the same way as PRESENCE messages.
   */
  // UTS: realtime/unit/RTP2c/sync-uses-same-newness-0
  it('RTP2c - SYNC messages use same newness comparison', function () {
    const map = createPresenceMap();

    map.startSync();

    // First SYNC message
    map.put(
      makePresenceMessage({
        action: 'present',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:5:0',
        timestamp: 1000,
        data: 'sync-first',
      }),
    );

    // Second SYNC message with older serial -- rejected
    const stale = map.put(
      makePresenceMessage({
        action: 'present',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:3:0',
        timestamp: 2000,
        data: 'sync-stale',
      }),
    );

    // Third SYNC message with newer serial -- accepted
    const newer = map.put(
      makePresenceMessage({
        action: 'present',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:8:0',
        timestamp: 500,
        data: 'sync-newer',
      }),
    );

    expect(stale).to.equal(false);
    expect(newer).to.equal(true);
    expect(map.get('conn-1:client-1').data).to.equal('sync-newer');
  });

  /**
   * RTP2 - Multiple members coexist
   *
   * The presence map maintains multiple members with different memberKeys.
   */
  // UTS: realtime/unit/RTP2/multiple-members-coexist-1
  it('RTP2 - multiple members coexist', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }),
    );
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }),
    );
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'alice', connectionId: 'c3', id: 'c3:0:0', timestamp: 100 }),
    );

    // Three distinct members (alice on c1, bob on c2, alice on c3)
    expect(map.values()).to.have.length(3);
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.get('c2:bob')).to.not.be.undefined;
    expect(map.get('c3:alice')).to.not.be.undefined;
  });

  /**
   * RTP2 - values() excludes ABSENT members
   *
   * The values() method returns only PRESENT members.
   */
  // UTS: realtime/unit/RTP2/values-excludes-absent-2
  it('RTP2 - values() excludes ABSENT members', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }),
    );
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }),
    );

    // Start sync and mark bob as ABSENT
    map.startSync();
    map.remove(
      makePresenceMessage({ action: 'leave', clientId: 'bob', connectionId: 'c2', id: 'c2:1:0', timestamp: 200 }),
    );

    // Bob is stored as ABSENT but excluded from values()
    expect(map.get('c2:bob')).to.not.be.undefined;
    expect(map.get('c2:bob').action).to.equal('absent');

    const members = map.values();
    expect(members).to.have.length(1);
    expect(members[0].clientId).to.equal('alice');
  });

  /**
   * clear() resets all state
   *
   * Verifies that clear() removes all members and resets sync state.
   */
  // UTS: realtime/unit/RTP2/clear-resets-state-3.1
  it('clear() resets all state', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }),
    );
    map.startSync();

    map.clear();

    expect(map.values()).to.have.length(0);
    expect(map.get('c1:alice')).to.be.undefined;
    expect(map.syncInProgress).to.equal(false);
  });

  /**
   * RTP2 - Residual members removed on endSync
   *
   * Members present at the start of sync but not seen during sync are
   * treated as residual and removed when sync completes. The PresenceMap
   * calls _synthesizeLeaves with these residual members.
   */
  // UTS: realtime/unit/RTP2/multiple-members-coexist-1.1
  it('RTP2 - residual members removed on endSync', function () {
    const map = createPresenceMap();

    // Track synthesized leaves
    const synthesizedLeaves: any[] = [];
    const mockPresence = (map as any).presence;
    mockPresence._synthesizeLeaves = (items: any[]) => {
      synthesizedLeaves.push(...items);
    };

    // Add two members before sync
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }),
    );
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }),
    );

    // Start sync -- both are now residual
    map.startSync();

    // Only alice is seen during sync
    map.put(
      makePresenceMessage({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }),
    );

    // End sync -- bob was not seen, so he should be removed
    map.endSync();

    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.get('c2:bob')).to.be.undefined;
    expect(map.values()).to.have.length(1);

    // _synthesizeLeaves should have been called with bob's entry
    expect(synthesizedLeaves).to.have.length(1);
    expect(synthesizedLeaves[0].clientId).to.equal('bob');
  });

  /**
   * RTP2 - startSync marks all current members as residual
   *
   * After startSync(), all existing members are tracked as residual.
   * If they are not re-confirmed via put() during sync, they are removed
   * on endSync().
   */
  // UTS: realtime/unit/RTP2/multiple-members-coexist-1.2
  it('RTP2 - startSync marks all current members as residual', function () {
    const map = createPresenceMap();

    const mockPresence = (map as any).presence;
    mockPresence._synthesizeLeaves = (_items: any[]) => {};

    // Add three members
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }),
    );
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }),
    );
    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'carol', connectionId: 'c3', id: 'c3:0:0', timestamp: 100 }),
    );

    map.startSync();

    // None are re-confirmed during sync
    map.endSync();

    // All should be removed as residual
    expect(map.values()).to.have.length(0);
  });

  /**
   * RTP2 - put during sync removes member from residual tracking
   *
   * When a member is seen during sync (via put()), it is no longer
   * considered residual and will survive endSync().
   */
  // UTS: realtime/unit/RTP2h2a/leave-during-sync-stores-absent-0.1
  it('RTP2 - put during sync removes member from residual tracking', function () {
    const map = createPresenceMap();

    const mockPresence = (map as any).presence;
    mockPresence._synthesizeLeaves = (_items: any[]) => {};

    map.put(
      makePresenceMessage({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }),
    );

    map.startSync();

    // Re-confirm alice during sync
    map.put(
      makePresenceMessage({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }),
    );

    map.endSync();

    // Alice was re-confirmed, so she survives
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.values()).to.have.length(1);
  });

  /**
   * RTP2 - syncInProgress reflects sync state
   *
   * Verifies that syncInProgress is true between startSync() and endSync().
   */
  // UTS: realtime/unit/RTP2/clear-resets-state-3
  it('RTP2 - syncInProgress reflects sync state', function () {
    const map = createPresenceMap();

    expect(map.syncInProgress).to.equal(false);

    map.startSync();
    expect(map.syncInProgress).to.equal(true);

    map.endSync();
    expect(map.syncInProgress).to.equal(false);
  });

  /**
   * RTP2b2 - Stale message rejected during remove
   *
   * A LEAVE with an older id than the existing member is rejected.
   */
  // UTS: realtime/unit/RTP2b1/older-synth-leave-rejected-1.1
  it('RTP2b2 - stale LEAVE is rejected', function () {
    const map = createPresenceMap();

    map.put(
      makePresenceMessage({
        action: 'enter',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:5:0',
        timestamp: 1000,
        data: 'entered',
      }),
    );

    // Try to remove with an older id (msgSerial=3)
    const result = map.remove(
      makePresenceMessage({
        action: 'leave',
        clientId: 'client-1',
        connectionId: 'conn-1',
        id: 'conn-1:3:0',
        timestamp: 2000,
      }),
    );

    // Rejected because the existing entry (serial 5) is newer than the leave (serial 3)
    expect(result).to.equal(false);
    expect(map.get('conn-1:client-1')).to.not.be.undefined;
    expect(map.get('conn-1:client-1').data).to.equal('entered');
  });
});
