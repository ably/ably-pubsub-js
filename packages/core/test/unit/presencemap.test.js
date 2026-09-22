'use strict';

define(['chai', 'ably'], function (chai, Ably) {
  const { assert } = chai;
  const PresenceMap = Ably.Realtime._PresenceMap;

  class MockRealtimePresence {}

  describe('PresenceMap', () => {
    let presenceMap;

    // Helper function to create a presence message
    const createPresenceMessage = (clientId, connectionId, action, timestamp) => ({
      clientId,
      connectionId,
      timestamp,
      action,
    });

    beforeEach(() => {
      // Initialize with a simple memberKey function that uses clientId as the key
      presenceMap = new PresenceMap(
        new MockRealtimePresence(),
        (item) => item.clientId + ':' + item.connectionId,
        (i, j) => i.timestamp > j.timestamp,
      );
    });

    describe('remove()', () => {
      it('should return false when no matching member present', () => {
        const incoming = createPresenceMessage('client1', 'conn1', 'leave', 100);
        assert.isFalse(presenceMap.remove(incoming));
      });

      it('should return true when removing an (older) matching member', () => {
        const original = createPresenceMessage('client1', 'conn1', 'present', 100);
        presenceMap.put(original);
        const incoming = createPresenceMessage('client1', 'conn1', 'leave', 150);
        assert.isTrue(presenceMap.remove(incoming));
      });

      it('should return false when trying to remove a newer matching member', () => {
        const original = createPresenceMessage('client1', 'conn1', 'present', 100);
        presenceMap.put(original);
        const incoming = createPresenceMessage('client1', 'conn1', 'leave', 50);
        assert.isFalse(presenceMap.remove(incoming));
      });
    });
  });
});
