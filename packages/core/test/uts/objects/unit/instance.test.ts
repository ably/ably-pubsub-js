/**
 * UTS: Instance Tests
 *
 * Spec points: RTINS1-16
 * Source: uts/objects/unit/instance.md
 *
 * Tests Instance wrapping of LiveObjects: id, value, get, entries,
 * size, compact, set, remove, increment, decrement, subscribe,
 * InstanceSubscriptionEvent message fields, Subscription model.
 *
 * Instance `id` is a getter property; the spec pseudo-code's `id()` call syntax maps
 * to property access per the pseudocode conventions (spec uts/README.md) — the features
 * spec defines `Instance#id` as a property (RTINS3).
 */

import { expect } from 'chai';
import { restoreAll, flushAsync, pollUntil } from '../../helpers';
import {
  setupSyncedChannel,
  buildObjectMessage,
  buildCounterInc,
  buildMapSet,
  remoteSerial,
} from '../helpers/standard_test_pool';

describe('uts/objects/unit/instance', function () {
  // test:uts runs mocha with --no-config, so the shared root-hooks timeout does not apply; raise
  // the 2s default so pollUntil's 5s quiescence deadline can elapse and fail on the real assertion.
  this.timeout(6000);
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTINS3/id-returns-objectid-0
  it('RTINS3 - id property returns objectId', async function () {
    const { root } = await setupSyncedChannel('test-RTINS3');

    const counterInst = root.get('score').instance();
    expect(counterInst!.id).to.equal('counter:score@1000');

    const mapInst = root.get('profile').instance();
    expect(mapInst!.id).to.equal('map:profile@1000');
  });

  // UTS: objects/unit/RTINS4/value-counter-0
  it('RTINS4 - value() returns counter number or undefined for map', async function () {
    const { root } = await setupSyncedChannel('test-RTINS4');

    const counterInst = root.get('score').instance();
    expect(counterInst!.value()).to.equal(100);

    const mapInst = root.instance();
    expect(mapInst!.value()).to.be.undefined;
  });

  // UTS: objects/unit/RTINS5/get-wraps-entry-0
  it('RTINS5 - get() returns Instance wrapping entry value', async function () {
    const { root } = await setupSyncedChannel('test-RTINS5');

    const rootInst = root.instance()!;

    const nameInst = rootInst.get('name');
    expect(nameInst).to.exist;
    expect(nameInst!.value()).to.equal('Alice');

    const scoreInst = rootInst.get('score');
    expect(scoreInst!.id).to.equal('counter:score@1000');

    const nullInst = rootInst.get('nonexistent');
    expect(nullInst).to.be.undefined;
  });

  // UTS: objects/unit/RTINS6/entries-yields-instances-0
  it('RTINS6 - entries() yields [key, Instance] pairs', async function () {
    const { root } = await setupSyncedChannel('test-RTINS6');

    const rootInst = root.instance()!;
    const entries: Record<string, any> = {};
    for (const [key, inst] of rootInst.entries()) {
      entries[key as string] = inst;
    }
    expect(Object.keys(entries)).to.have.length(7);
    expect(entries['name']).to.exist;
    expect(entries['name'].value()).to.equal('Alice');
  });

  // UTS: objects/unit/RTINS9/size-0
  it('RTINS9 - size() returns non-tombstoned count', async function () {
    const { root } = await setupSyncedChannel('test-RTINS9');

    const rootInst = root.instance()!;
    expect(rootInst.size()).to.equal(7);

    const counterInst = root.get('score').instance()!;
    expect(counterInst.size()).to.be.undefined;
  });

  // UTS: objects/unit/RTINS10/compact-0
  it('RTINS10 - compact() recursively compacts', async function () {
    const { root } = await setupSyncedChannel('test-RTINS10');

    const rootInst = root.instance()!;
    const result = rootInst.compact() as any;
    expect(result['name']).to.equal('Alice');
    expect(result['score']).to.equal(100);
    expect(result['profile']['email']).to.equal('alice@example.com');
  });

  // UTS: objects/unit/RTINS12/set-delegates-0
  it('RTINS12 - set() delegates to LiveMap#set', async function () {
    const { root } = await setupSyncedChannel('test-RTINS12');

    const rootInst = root.instance()!;
    await rootInst.set('name', 'Bob');
    expect(root.get('name').value()).to.equal('Bob');
  });

  // UTS: objects/unit/RTINS12d/set-non-map-throws-0
  it('RTINS12d - set() on non-LiveMap throws 92007', async function () {
    const { root } = await setupSyncedChannel('test-RTINS12d');

    const counterInst = root.get('score').instance()!;
    try {
      await counterInst.set('key', 'value');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92007);
    }
  });

  // UTS: objects/unit/RTINS13/remove-delegates-0
  it('RTINS13 - remove() delegates to LiveMap#remove', async function () {
    const { root } = await setupSyncedChannel('test-RTINS13');

    const rootInst = root.instance()!;
    await rootInst.remove('name');
    expect(root.get('name').value()).to.be.undefined;
  });

  // UTS: objects/unit/RTINS14/increment-delegates-0
  it('RTINS14 - increment() delegates to LiveCounter#increment', async function () {
    const { root } = await setupSyncedChannel('test-RTINS14');

    const counterInst = root.get('score').instance()!;
    await counterInst.increment(25);
    expect(root.get('score').value()).to.equal(125);
  });

  // UTS: objects/unit/RTINS14d/increment-non-counter-throws-0
  it('RTINS14d - increment() on non-LiveCounter throws 92007', async function () {
    const { root } = await setupSyncedChannel('test-RTINS14d');

    const mapInst = root.instance()!;
    try {
      await mapInst.increment(5);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92007);
    }
  });

  // UTS: objects/unit/RTINS15/decrement-delegates-0
  it('RTINS15 - decrement() delegates to LiveCounter#decrement', async function () {
    const { root } = await setupSyncedChannel('test-RTINS15');

    const counterInst = root.get('score').instance()!;
    await counterInst.decrement(10);
    expect(root.get('score').value()).to.equal(90);
  });

  // UTS: objects/unit/RTINS14a/increment-default-0
  it('RTINS14a - increment() defaults to 1', async function () {
    const { root } = await setupSyncedChannel('test-RTINS14a');

    const counterInst = root.get('score').instance()!;
    await counterInst.increment();
    expect(root.get('score').value()).to.equal(101);
  });

  // UTS: objects/unit/RTINS15a/decrement-default-0
  it('RTINS15a - decrement() defaults to 1', async function () {
    const { root } = await setupSyncedChannel('test-RTINS15a');

    const counterInst = root.get('score').instance()!;
    await counterInst.decrement();
    expect(root.get('score').value()).to.equal(99);
  });

  // UTS: objects/unit/RTINS16/subscribe-receives-events-0
  it('RTINS16 - subscribe() receives InstanceSubscriptionEvent', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTINS16');

    const counterInst = root.get('score').instance()!;
    const events: any[] = [];
    const sub = counterInst.subscribe((event: any) => events.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTINS16', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    expect(sub).to.have.property('unsubscribe');
    expect(events).to.have.length(1);
    expect(events[0].object).to.exist;
    expect(events[0].object.id).to.equal('counter:score@1000');
  });

  // UTS: objects/unit/RTINS16c/subscribe-primitive-throws-0
  it('RTINS16c - subscribe() on primitive throws 92007', async function () {
    const { root } = await setupSyncedChannel('test-RTINS16c');

    const nameInst = root.instance()!.get('name')!;
    expect(() => nameInst.subscribe(() => {}))
      .to.throw()
      .with.property('code', 92007);
  });

  // UTS: objects/unit/RTINS16e2/subscription-event-message-0
  it('RTINS16e2 - InstanceSubscriptionEvent contains PublicAPI::ObjectMessage', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTINS16e2');

    const rootInst = root.instance()!;
    const events: any[] = [];
    rootInst.subscribe((event: any) => events.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTINS16e2', [buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length(1);
    expect(events[0].object).to.exist;
    expect(events[0].object.id).to.equal('root');
    expect(events[0].message).to.exist;
    expect(events[0].message.channel).to.equal('test-RTINS16e2');
    expect(events[0].message.operation.action).to.equal('map.set');
    expect(events[0].message.operation.objectId).to.equal('root');
    expect(events[0].message.operation.mapSet.key).to.equal('name');
  });

  // UTS: objects/unit/RTINS16f/subscribe-returns-subscription-0
  it('RTINS16f - subscribe() returns Subscription for deregistration', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTINS16f');

    const counterInst = root.get('score').instance()!;
    const events: any[] = [];
    const sub = counterInst.subscribe((event: any) => events.push(event));
    sub.unsubscribe();

    // Quiescence control: a still-subscribed listener on the same counter proves
    // the dispatch actually happened before asserting the unsubscribed one stayed silent
    const controlEvents: any[] = [];
    counterInst.subscribe((event: any) => controlEvents.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTINS16f', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );

    await pollUntil(() => controlEvents.length >= 1);
    expect(controlEvents).to.have.length(1);

    expect(events).to.have.length(0);
  });

  // UTS: objects/unit/RTINS16g/subscription-follows-identity-0
  it('RTINS16g - Instance subscription follows identity not path', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTINS16g');

    const counterInst = root.get('score').instance()!;
    const events: any[] = [];
    counterInst.subscribe((event: any) => events.push(event));

    // Replace score with a new counter
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTINS16g', [
        buildMapSet('root', 'score', { objectId: 'counter:new@2000' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    // Increment the ORIGINAL counter
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTINS16g', [buildCounterInc('counter:score@1000', 10, '100', 'remote')]),
    );
    await flushAsync();

    expect(events.length).to.be.greaterThanOrEqual(1);
    // RTINS16e1: the delivered event's object is the ORIGINAL counter instance —
    // asserting on the event (not the pre-existing handle) proves identity tracking
    expect(events[0].object).to.exist;
    expect(events[0].object.id).to.equal('counter:score@1000');
  });

  // UTS: objects/unit/RTINS16h/subscribe-no-side-effects-0
  it('RTINS16h - subscribe() has no side effects', async function () {
    const { channel, root } = await setupSyncedChannel('test-RTINS16h');

    const counterInst = root.get('score').instance()!;
    const channelStateBefore = channel.state;

    counterInst.subscribe(() => {});

    expect(channel.state).to.equal(channelStateBefore);
  });
});
