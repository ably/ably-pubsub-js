/**
 * UTS Integration: Objects GC Tests
 *
 * Spec points: RTO10, RTLM19, RTLM5d2h, RTLM7
 * Source: specification/uts/objects/integration/objects_gc_test.md
 *
 * Behavioral verification of tombstone semantics at the integration tier:
 * removing a map entry tombstones it (RTLM7), tombstoned entries read back
 * as undefined/null (RTLM5d2h), and the key is recreatable with a fresh
 * server-assigned objectId — safe because tombstoned state is retained for
 * the GC grace period (RTO10).
 *
 * The timer-based GC sweep itself (RTO10a-c, RTLM19) is verified at the
 * unit tier (RTO10/RTO10b1 in test/uts/objects/unit/realtime_object.test.ts,
 * RTLM19 in test/uts/objects/unit/live_map.test.ts): integration
 * tests run on wall-clock time against a real server, and the sweep's
 * cadence (RTO10a, ~5 minutes) with the server-provided grace period
 * (RTO10b, default 24h) is not observable within test timeouts. The
 * spec's undefined/null (RTLM5d2h) maps to `undefined` in ably-js.
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  trackClient,
  connectAndWait,
  closeAndWait,
  uniqueChannelName,
  pollUntil,
} from '../../realtime/integration/sandbox';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';
import { describeWithProtocols } from './protocol_variants';

describeWithProtocols('uts/objects/integration/objects_gc', function (useBinaryProtocol) {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTO10 - Tombstoned object is recreatable with new objectId
   *
   * After an object is tombstoned (removed from map), a new object can be
   * created at the same map key. The new object gets a different
   * server-assigned objectId, confirming the old object is gone.
   */
  // UTS: objects/integration/RTO10/tombstoned-object-gc-recreate-0
  it('RTO10 - tombstoned object is recreatable with new objectId', async function () {
    const channelName = uniqueChannelName('objects-gc-object');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    // Create a counter
    await root.set('counter', LiveObjectsPlugin.LiveCounter.create(42));

    await pollUntil(() => (root.get('counter').value() === 42 ? true : null));

    expect(root.get('counter').value()).to.equal(42);
    const counterId = root.get('counter').instance().id;

    // Remove it (tombstones the entry and the object)
    await root.remove('counter');

    // RTLM5d2h: tombstoned entries read back as undefined/null (undefined in ably-js)
    await pollUntil(() => (root.get('counter').value() === undefined ? true : null));

    expect(root.get('counter').value()).to.be.undefined;

    // Create a new counter at the same key
    await root.set('counter', LiveObjectsPlugin.LiveCounter.create(99));

    await pollUntil(() => (root.get('counter').value() === 99 ? true : null));

    expect(root.get('counter').value()).to.equal(99);
    const newCounterId = root.get('counter').instance().id;
    expect(newCounterId).to.not.equal(counterId);

    await closeAndWait(client);
  });

  /**
   * RTLM19 - Tombstoned map entry is re-settable
   *
   * After a map entry is tombstoned (removed, RTLM7), the entry can be
   * re-set. The subsequent MAP_SET succeeds because the server assigns a
   * newer serial than the removal's.
   */
  // UTS: objects/integration/RTLM19/tombstoned-entry-gc-reset-0
  it('RTLM19 - tombstoned map entry is re-settable', async function () {
    const channelName = uniqueChannelName('objects-gc-entry');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    // Set then remove a key
    await root.set('ephemeral', 'temporary');

    await pollUntil(() => (root.get('ephemeral').value() === 'temporary' ? true : null));

    expect(root.get('ephemeral').value()).to.equal('temporary');

    await root.remove('ephemeral');

    // RTLM5d2h: tombstoned entries read back as undefined/null (undefined in ably-js)
    await pollUntil(() => (root.get('ephemeral').value() === undefined ? true : null));

    expect(root.get('ephemeral').value()).to.be.undefined;

    // Set the same key again
    await root.set('ephemeral', 'revived');

    await pollUntil(() => (root.get('ephemeral').value() === 'revived' ? true : null));

    expect(root.get('ephemeral').value()).to.equal('revived');

    await closeAndWait(client);
  });
});
