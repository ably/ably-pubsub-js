/**
 * UTS: LiveObject Subscribe Tests
 *
 * Spec points: RTLO4b, RTLO4b3, RTLO4b4c1, RTLO4b4c3a, RTLO4b4c3c, RTLO4b4d, RTLO4b4e, RTLO4b6, RTLO4b7
 * Source: uts/objects/unit/live_object_subscribe.md
 *
 * Tests subscribe/unsubscribe on internal LiveObject (via Instance wrapper):
 * receiving data updates, noop suppression, Subscription model (subscribe returns
 * Subscription with unsubscribe), tombstone deregistration, objectMessage population,
 * tombstone flag, no side effects, LiveMap update events.
 */

import { expect } from 'chai';
import { restoreAll, flushAsync } from '../../helpers';
import {
  setupSyncedChannel,
  buildObjectMessage,
  buildCounterInc,
  buildMapSet,
  remoteSerial,
  buildObjectDelete,
  OBJ_OP,
} from '../helpers/standard_test_pool';

describe('uts/objects/unit/live_object_subscribe', function () {
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTLO4b/subscribe-receives-updates-0
  it('RTLO4b - subscribe receives data updates', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b');
    const updates: any[] = [];
    const instance = root.get('score').instance()!;
    const sub = instance.subscribe((event: any) => updates.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    expect(sub).to.have.property('unsubscribe');
    expect(updates).to.have.length(1);
  });

  // UTS: objects/unit/RTLO4b4c1/noop-no-trigger-0
  it('RTLO4b4c1 - noop update does not trigger listener', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b4c1');
    const updates: any[] = [];
    const instance = root.get('score').instance()!;
    instance.subscribe((event: any) => updates.push(event));

    // First: a real counter increment
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c1', [buildCounterInc('counter:score@1000', 5, '01', 'remote')]),
    );
    await flushAsync();

    expect(updates).to.have.length(1);

    // Second: a noop. Serial "02" passes the newness check (RTLO4a6) so the noop
    // path itself suppresses the event, not the site-serial dedup. An increment with
    // no `number` is the noop (RTLC9h) — a raw ObjectMessage with no `number` field is
    // used so it exercises the real RTLC9h/RTLO4b4c1 noop branch (a `number: 0` would
    // EXIST per RTLC9g and produce a non-noop update with amount 0).
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c1', [
        {
          serial: '02',
          siteCode: 'remote',
          operation: {
            action: OBJ_OP.COUNTER_INC,
            objectId: 'counter:score@1000',
            counterInc: {},
          },
        },
      ]),
    );
    await flushAsync();

    // Third: a real follow-up increment delivered through the same dispatch chain —
    // proves delivery still works after the noop (quiescence control per spec)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c1', [buildCounterInc('counter:score@1000', 3, '03', 'remote')]),
    );
    await flushAsync();

    // Exactly 2 events: the first inc and the follow-up inc — the noop fired nothing
    expect(updates).to.have.length(2);
    // The noop applied nothing: 100 from pool create + 5 + 3 from the two incs
    expect(root.get('score').value()).to.equal(108);
  });

  // UTS: objects/unit/RTLO4b6/subscribe-no-side-effects-0
  it('RTLO4b6 - subscribe has no side effects', async function () {
    const { channel, root } = await setupSyncedChannel('test-RTLO4b6');
    const stateBefore = channel.state;
    const instance = root.get('score').instance()!;

    instance.subscribe(() => {});

    expect(channel.state).to.equal(stateBefore);
  });

  // UTS: objects/unit/RTLO4b/subscribe-map-update-0
  it('RTLO4b - subscribe on LiveMap receives LiveMapUpdate', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b-map');
    const updates: any[] = [];
    const instance = root.instance()!;
    instance.subscribe((event: any) => updates.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b-map', [
        buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(updates).to.have.length(1);
  });

  // UTS: objects/unit/RTLO4b7/subscribe-returns-subscription-0
  it('RTLO4b7 - subscribe returns Subscription with unsubscribe method', async function () {
    const { root } = await setupSyncedChannel('test-RTLO4b7-sub');
    const instance = root.get('score').instance()!;

    const sub = instance.subscribe(() => {});

    expect(sub).to.be.an('object');
    expect(sub.unsubscribe).to.be.a('function');
  });

  // UTS: objects/unit/RTLO4b7/subscription-unsubscribe-stops-delivery-0
  it('RTLO4b7 - Subscription#unsubscribe stops delivery', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b7-unsub');
    const updates: any[] = [];
    const instance = root.get('score').instance()!;
    const sub = instance.subscribe((event: any) => updates.push(event));

    // First update should be received
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b7-unsub', [buildCounterInc('counter:score@1000', 5, '01', 'remote')]),
    );
    await flushAsync();

    expect(updates).to.have.length(1);

    // Unsubscribe
    sub.unsubscribe();

    // Second update should NOT be received
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b7-unsub', [buildCounterInc('counter:score@1000', 10, '02', 'remote')]),
    );
    await flushAsync();

    expect(updates).to.have.length(1);
  });

  // UTS: objects/unit/RTLO4b7/subscription-unsubscribe-idempotent-0
  it('RTLO4b7 - Subscription#unsubscribe is idempotent', async function () {
    const { root } = await setupSyncedChannel('test-RTLO4b7-idem');
    const instance = root.get('score').instance()!;
    const sub = instance.subscribe(() => {});

    // Calling unsubscribe twice should not throw
    sub.unsubscribe();
    sub.unsubscribe();
  });

  // UTS: objects/unit/RTLO4b4c3c/tombstone-deregisters-listeners-0
  // The tombstone flag is internal (RTLO4b4e); the tombstone is identified by the
  // OBJECT_DELETE operation and verified through the deregistration behaviour: both
  // listeners fire for the tombstone event, and subsequent updates do NOT fire.
  it('RTLO4b4c3c - tombstone update deregisters all Instance#subscribe listeners', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b4c3c');
    const updatesA: any[] = [];
    const updatesB: any[] = [];
    const instance = root.get('score').instance()!;
    instance.subscribe((event: any) => updatesA.push(event));
    instance.subscribe((event: any) => updatesB.push(event));

    // Send OBJECT_DELETE which causes a tombstone LiveObjectUpdate
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c3c', [buildObjectDelete('counter:score@1000', '50', 'remote')]),
    );
    await flushAsync();

    // Both listeners should have received the tombstone update
    expect(updatesA).to.have.length(1);
    expect(updatesB).to.have.length(1);

    // Send another update — listeners should have been deregistered by tombstone
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c3c', [buildCounterInc('counter:score@1000', 3, '51', 'remote')]),
    );
    await flushAsync();

    expect(updatesA).to.have.length(1);
    expect(updatesB).to.have.length(1);
  });

  // UTS: objects/unit/RTLO4b4c3c/tombstone-zero-value-counter-tears-down-0
  // Complements tombstone-deregisters-listeners-0 (which tombstones a populated counter). Here the
  // counter (100 in the standard pool) is first driven down to 0, so tombstoning it produces a
  // zero-delta diff. Per the RTLC14c tombstone carve-out this update is NOT a no-op (contrast
  // RTLO4b4c1 noop-no-trigger, where a genuine noop does not fire the listener at all): the
  // listeners still fire with the tombstone update and are then deregistered per RTLO4b4c3c.
  it('RTLO4b4c3c - tombstoning an already-zero counter still delivers the update and deregisters listeners', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b4c3c-zero');

    // Drive the counter down to 0 BEFORE registering the listeners under test, so they observe
    // only the tombstone. flushAsync is the quiescence barrier that the increment has been applied
    // before we subscribe, so the "-100" update is not seen by them.
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c3c-zero', [buildCounterInc('counter:score@1000', -100, '40', 'remote')]),
    );
    await flushAsync();
    expect(root.get('score').value()).to.equal(0);

    const updatesA: any[] = [];
    const updatesB: any[] = [];
    const instance = root.get('score').instance()!;
    instance.subscribe((event: any) => updatesA.push(event));
    instance.subscribe((event: any) => updatesB.push(event));

    // OBJECT_DELETE tombstones the already-zero counter (zero-delta diff, RTLC14c -> NOT a no-op)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c3c-zero', [buildObjectDelete('counter:score@1000', '50', 'remote')]),
    );
    await flushAsync();

    // Both listeners received the tombstone update even though the counter data did not change (0 -> 0)
    expect(updatesA).to.have.length(1);
    expect(updatesA[0].message.operation.action).to.equal('object.delete');
    expect(updatesB).to.have.length(1);
    expect(updatesB[0].message.operation.action).to.equal('object.delete');

    // Prove deregistration. A tombstoned object ignores further ops (RTLC7e), so neither the
    // deregistered listeners nor a fresh listener on counter:score@1000 could ever fire — use a
    // SEPARATE live object (map:profile@1000) as the quiescence barrier. Messages are processed in
    // order, so once the control fires, the follow-up "51" has also been processed.
    const control: any[] = [];
    const controlInstance = root.get('profile').instance()!;
    controlInstance.subscribe((event: any) => control.push(event));
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c3c-zero', [buildCounterInc('counter:score@1000', 3, '51', 'remote')]),
    );
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4c3c-zero', [
        buildMapSet('map:profile@1000', 'quiescence_probe', { string: 'x' }, '52', 'remote'),
      ]),
    );
    await flushAsync();

    // Control delivered, so any still-registered original listener would also have run: the
    // tombstone deregistered them per RTLO4b4c3c.
    expect(control.length).to.be.greaterThanOrEqual(1);
    expect(updatesA).to.have.length(1);
    expect(updatesB).to.have.length(1);
  });

  // UTS: objects/unit/RTLO4b4d/update-has-object-message-0
  it('RTLO4b4d - InstanceSubscriptionEvent.message is populated from source ObjectMessage', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b4d');
    const updates: any[] = [];
    const instance = root.get('score').instance()!;
    instance.subscribe((event: any) => updates.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4d', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    expect(updates).to.have.length(1);
    expect(updates[0].message).to.exist;
    expect(updates[0].message.serial).to.equal('99');
    expect(updates[0].message.siteCode).to.equal('remote');
    expect(updates[0].message.operation.action).to.equal('counter.inc');
    expect(updates[0].message.operation.objectId).to.equal('counter:score@1000');
  });

  // UTS: objects/unit/RTLO4b4e/tombstone-flag-true-0
  it('RTLO4b4e - tombstone update identified by OBJECT_DELETE action', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b4e-true');
    const updates: any[] = [];
    const instance = root.get('score').instance()!;
    instance.subscribe((event: any) => updates.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4e-true', [buildObjectDelete('counter:score@1000', '50', 'remote')]),
    );
    await flushAsync();

    expect(updates).to.have.length(1);
    expect(updates[0].message).to.exist;
    expect(updates[0].message.operation.action).to.equal('object.delete');
  });

  // UTS: objects/unit/RTLO4b4e/tombstone-flag-false-0
  it('RTLO4b4e - normal update carries non-tombstone action', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLO4b4e-false');
    const updates: any[] = [];
    const instance = root.get('score').instance()!;
    instance.subscribe((event: any) => updates.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLO4b4e-false', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    expect(updates).to.have.length(1);
    expect(updates[0].message).to.exist;
    expect(updates[0].message.operation.action).to.equal('counter.inc');
  });
});
