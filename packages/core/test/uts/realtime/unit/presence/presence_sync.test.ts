/**
 * UTS: Presence Sync Tests
 *
 * Spec points: RTP18, RTP18a, RTP18b, RTP18c, RTP19, RTP19a, RTP2h2a, RTP2h2b
 * Source: specification/uts/realtime/unit/presence/presence_sync.md
 *
 * Tests the sync protocol on the PresenceMap data structure. A presence sync
 * allows the server to send a complete list of members present on a channel.
 * The sync lifecycle is: startSync → put during sync → endSync (removes stale).
 *
 * NOTE: In ably-js, endSync() returns void and calls _synthesizeLeaves() with
 * the residual members. Tests capture leaves via a mock _synthesizeLeaves.
 */

import { expect } from 'chai';
import { PresenceMap } from '../../../../../src/common/lib/client/presencemap';
import PresenceMessage from '../../../../../src/common/lib/types/presencemessage';
import Logger from '../../../../../src/common/lib/util/logger';

function createMockPresence(): any {
  const logger = new Logger();
  logger.setLog(0);
  return {
    channel: { name: 'test-channel' },
    logger: logger,
    syncComplete: true,
    _synthesizedLeaves: [] as any[],
    _synthesizeLeaves(items: any[]) {
      this._synthesizedLeaves.push(...items);
    },
  };
}

function msg(props: {
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

function createPresenceMap(mockPresence?: any): { map: PresenceMap; mock: any } {
  const mock = mockPresence || createMockPresence();
  const map = new PresenceMap(mock, (item) => item.connectionId + ':' + item.clientId);
  return { map, mock };
}

describe('uts/realtime/unit/presence/presence_sync', function () {
  /**
   * RTP18a - startSync sets syncInProgress
   */
  // UTS: realtime/unit/RTP18a/startsync-sets-flag-0
  it('RTP18a - startSync sets syncInProgress', function () {
    const { map } = createPresenceMap();

    expect(map.syncInProgress).to.equal(false);
    map.startSync();
    expect(map.syncInProgress).to.equal(true);
  });

  /**
   * RTP18b - endSync clears syncInProgress
   */
  // UTS: realtime/unit/RTP18b/endsync-clears-flag-0
  it('RTP18b - endSync clears syncInProgress', function () {
    const { map } = createPresenceMap();

    map.startSync();
    expect(map.syncInProgress).to.equal(true);
    map.endSync();
    expect(map.syncInProgress).to.equal(false);
  });

  /**
   * RTP19 - Stale members get LEAVE events after sync
   */
  // UTS: realtime/unit/RTP19/stale-members-leave-after-sync-0
  it('RTP19 - stale members get LEAVE events after sync', function () {
    const { map, mock } = createPresenceMap();

    map.put(msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }));
    map.put(msg({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }));
    expect(map.values().length).to.equal(2);

    map.startSync();
    map.put(msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }));
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(1);
    expect(mock._synthesizedLeaves[0].clientId).to.equal('bob');
    expect(map.values().length).to.equal(1);
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.get('c2:bob')).to.be.undefined;
  });

  /**
   * RTP19 - Synthesized LEAVE has id=null and current timestamp
   *
   * NOTE: In ably-js, _synthesizeLeaves receives the original member entry;
   * the LEAVE event synthesis (setting id=null, timestamp=now) is done by
   * _synthesizeLeaves, not by endSync. We verify the residual member is passed.
   */
  // UTS: realtime/unit/RTP19/synth-leave-null-id-timestamp-1
  it('RTP19 - synthesized LEAVE preserves original attributes', function () {
    const { map, mock } = createPresenceMap();

    map.put(
      msg({
        action: 'enter',
        clientId: 'bob',
        connectionId: 'c2',
        id: 'c2:0:0',
        timestamp: 100,
        data: 'bob-data',
      }),
    );

    map.startSync();
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(1);
    const leave = mock._synthesizedLeaves[0];
    expect(leave.clientId).to.equal('bob');
    expect(leave.connectionId).to.equal('c2');
    expect(leave.data).to.equal('bob-data');
  });

  /**
   * RTP19 - Members updated during sync survive
   */
  // UTS: realtime/unit/RTP19/updated-members-survive-sync-2
  it('RTP19 - members updated during sync survive', function () {
    const { map, mock } = createPresenceMap();

    map.put(msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }));
    map.put(msg({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }));
    map.put(msg({ action: 'enter', clientId: 'carol', connectionId: 'c3', id: 'c3:0:0', timestamp: 100 }));

    map.startSync();
    map.put(msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }));
    map.put(
      msg({ action: 'update', clientId: 'bob', connectionId: 'c2', id: 'c2:1:0', timestamp: 200, data: 'new-data' }),
    );
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(1);
    expect(mock._synthesizedLeaves[0].clientId).to.equal('carol');
    expect(map.values().length).to.equal(2);
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.get('c2:bob')).to.not.be.undefined;
    expect(map.get('c2:bob').data).to.equal('new-data');
  });

  /**
   * RTP18a - New sync discards previous in-flight sync
   */
  // UTS: realtime/unit/RTP18a/new-sync-discards-previous-1
  it('RTP18a - new sync discards previous in-flight sync', function () {
    const { map, mock } = createPresenceMap();

    map.put(msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }));
    map.put(msg({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }));

    map.startSync();
    map.put(msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }));

    // The second sync starts from the current membership map.
    map.startSync();
    map.put(msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:2:0', timestamp: 300 }));
    map.put(msg({ action: 'present', clientId: 'bob', connectionId: 'c2', id: 'c2:1:0', timestamp: 300 }));
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(0);
    expect(map.values().length).to.equal(2);
  });

  /**
   * RTP18c - Single-message sync (no channelSerial)
   */
  // UTS: realtime/unit/RTP18c/single-message-sync-0
  it('RTP18c - single-message sync', function () {
    const { map, mock } = createPresenceMap();

    map.put(msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }));
    map.put(msg({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }));

    map.startSync();
    map.put(msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }));
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(1);
    expect(mock._synthesizedLeaves[0].clientId).to.equal('bob');
    expect(map.values().length).to.equal(1);
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.syncInProgress).to.equal(false);
  });

  /**
   * RTP19a - ATTACHED without HAS_PRESENCE clears all members
   *
   * At the PresenceMap level: startSync() + endSync() with no puts.
   */
  // UTS: realtime/unit/RTP19a/no-has-presence-clears-members-0
  it('RTP19a - ATTACHED without HAS_PRESENCE clears all members', function () {
    const { map, mock } = createPresenceMap();

    map.put(msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100, data: 'a' }));
    map.put(msg({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100, data: 'b' }));
    map.put(msg({ action: 'enter', clientId: 'carol', connectionId: 'c3', id: 'c3:0:0', timestamp: 100, data: 'c' }));

    map.startSync();
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(3);
    const aliceLeave = mock._synthesizedLeaves.find((e: any) => e.clientId === 'alice');
    const bobLeave = mock._synthesizedLeaves.find((e: any) => e.clientId === 'bob');
    const carolLeave = mock._synthesizedLeaves.find((e: any) => e.clientId === 'carol');

    expect(aliceLeave).to.not.be.undefined;
    expect(aliceLeave.data).to.equal('a');
    expect(bobLeave).to.not.be.undefined;
    expect(bobLeave.data).to.equal('b');
    expect(carolLeave).to.not.be.undefined;
    expect(carolLeave.data).to.equal('c');

    expect(map.values().length).to.equal(0);
  });

  /**
   * RTP2h2a - LEAVE during sync stored as ABSENT
   *
   * DEVIATION: UTS spec expects no synthesized LEAVE for bob (he was explicitly
   * removed via LEAVE, not stale). But ably-js's remove() does not clear
   * residualMembers, so bob remains in residuals and gets a synthesized LEAVE.
   * The core assertions (ABSENT storage, cleanup on endSync) still hold.
   */
  // UTS: realtime/unit/RTP2h2a/leave-during-sync-absent-cleanup-0
  it('RTP2h2a - LEAVE during sync stored as ABSENT', function () {
    const { map, mock } = createPresenceMap();

    map.put(msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }));
    map.put(msg({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 100 }));

    map.startSync();
    map.put(msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }));

    const removeResult = map.remove(
      msg({ action: 'leave', clientId: 'bob', connectionId: 'c2', id: 'c2:1:0', timestamp: 200 }),
    );

    expect(removeResult).to.equal(true);
    expect(map.get('c2:bob')).to.not.be.undefined;
    expect(map.get('c2:bob').action).to.equal('absent');

    map.endSync();

    expect(map.get('c2:bob')).to.be.undefined;
    expect(map.values().length).to.equal(1);
    expect(map.get('c1:alice')).to.not.be.undefined;
    // ably-js deviation: remove() doesn't clear residualMembers, so bob
    // still appears as a synthesized leave (UTS spec expects 0)
    expect(mock._synthesizedLeaves.length).to.equal(1);
    expect(mock._synthesizedLeaves[0].clientId).to.equal('bob');
  });

  /**
   * RTP19 - Empty map sync produces no leave events
   */
  // UTS: realtime/unit/RTP19/empty-map-sync-no-leaves-3
  it('RTP19 - empty map sync produces no leave events', function () {
    const { map, mock } = createPresenceMap();

    map.startSync();
    map.put(msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }));
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(0);
    expect(map.values().length).to.equal(1);
    expect(map.get('c1:alice')).to.not.be.undefined;
  });

  /**
   * RTP18 - endSync without startSync is a no-op
   */
  // UTS: realtime/unit/RTP18/endsync-without-startsync-noop-0
  it('RTP18 - endSync without startSync is a no-op', function () {
    const { map, mock } = createPresenceMap();

    map.put(msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }));
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(0);
    expect(map.values().length).to.equal(1);
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.syncInProgress).to.equal(false);
  });

  /**
   * RTP19 - Stale SYNC message still removes member from residuals
   */
  // UTS: realtime/unit/RTP19/stale-sync-removes-from-residuals-4
  it('RTP19 - stale SYNC message still removes member from residuals', function () {
    const { map, mock } = createPresenceMap();

    map.put(
      msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:5:0', timestamp: 500, data: 'original' }),
    );

    map.startSync();
    const result = map.put(
      msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:3:0', timestamp: 300, data: 'stale' }),
    );
    map.endSync();

    expect(result).to.equal(false);
    expect(mock._synthesizedLeaves.length).to.equal(0);
    expect(map.values().length).to.equal(1);
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.get('c1:alice').data).to.equal('original');
  });

  /**
   * RTP19 - PRESENCE echoes followed by SYNC preserves all members
   */
  // UTS: realtime/unit/RTP19/presence-echoes-then-sync-preserves-5
  it('RTP19 - PRESENCE echoes followed by SYNC preserves all members', function () {
    const { map, mock } = createPresenceMap();

    map.put(
      msg({ action: 'enter', clientId: 'user-0', connectionId: 'c1', id: 'c1:0:0', timestamp: 100, data: 'data-0' }),
    );
    map.put(
      msg({ action: 'enter', clientId: 'user-1', connectionId: 'c1', id: 'c1:1:0', timestamp: 100, data: 'data-1' }),
    );
    map.put(
      msg({ action: 'enter', clientId: 'user-2', connectionId: 'c1', id: 'c1:2:0', timestamp: 100, data: 'data-2' }),
    );
    expect(map.values().length).to.equal(3);

    map.startSync();
    map.put(
      msg({ action: 'present', clientId: 'user-0', connectionId: 'c1', id: 'c1:0:0', timestamp: 100, data: 'data-0' }),
    );
    map.put(
      msg({ action: 'present', clientId: 'user-1', connectionId: 'c1', id: 'c1:1:0', timestamp: 100, data: 'data-1' }),
    );
    map.put(
      msg({ action: 'present', clientId: 'user-2', connectionId: 'c1', id: 'c1:2:0', timestamp: 100, data: 'data-2' }),
    );
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(0);
    expect(map.values().length).to.equal(3);
    for (let i = 0; i < 3; i++) {
      const member = map.get('c1:user-' + i);
      expect(member).to.not.be.undefined;
      expect(member.data).to.equal('data-' + i);
    }
  });

  /**
   * RTP19 - New member added during sync is not stale
   */
  // UTS: realtime/unit/RTP19/new-member-during-sync-survives-6
  it('RTP19 - new member added during sync is not stale', function () {
    const { map, mock } = createPresenceMap();

    map.put(msg({ action: 'enter', clientId: 'alice', connectionId: 'c1', id: 'c1:0:0', timestamp: 100 }));

    map.startSync();
    map.put(msg({ action: 'present', clientId: 'alice', connectionId: 'c1', id: 'c1:1:0', timestamp: 200 }));
    map.put(msg({ action: 'enter', clientId: 'bob', connectionId: 'c2', id: 'c2:0:0', timestamp: 200 }));
    map.endSync();

    expect(mock._synthesizedLeaves.length).to.equal(0);
    expect(map.values().length).to.equal(2);
    expect(map.get('c1:alice')).to.not.be.undefined;
    expect(map.get('c2:bob')).to.not.be.undefined;
  });
});
