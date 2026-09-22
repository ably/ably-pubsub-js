/**
 * UTS: PathObject Subscribe Tests
 *
 * Spec points: RTPO19, RTO24, RTO25
 * Source: uts/objects/unit/path_object_subscribe.md
 *
 * Tests PathObject subscription lifecycle, depth filtering,
 * path-following semantics, event bubbling, and listener exception isolation.
 */

import { expect } from 'chai';
import { Ably, restoreAll, installMockWebSocket, trackClient, flushAsync, pollUntil } from '../../helpers';
import { MockWebSocket } from '../../mock_websocket';
import {
  setupSyncedChannel,
  buildObjectMessage,
  buildObjectSyncMessage,
  buildObjectState,
  buildCounterInc,
  buildMapSet,
  remoteSerial,
  buildMapClear,
  PM_ACTION,
} from '../helpers/standard_test_pool';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';

describe('uts/objects/unit/path_object_subscribe', function () {
  // test:uts runs mocha with --no-config, so the shared root-hooks timeout does not apply; raise
  // the 2s default so pollUntil's 5s quiescence deadline can elapse and fail on the real assertion.
  this.timeout(6000);
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTPO19/subscribe-receives-events-0
  it('RTPO19 - subscribe() returns Subscription and receives events', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19');

    const events: any[] = [];
    const sub = root.get('score').subscribe((event: any) => events.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    expect(sub).to.have.property('unsubscribe');
    expect(events).to.have.length(1);
    expect(events[0].object).to.exist;
    expect(events[0].object.path()).to.equal('score');
    expect(events[0].message).to.exist;
  });

  // UTS: objects/unit/RTPO19b/subscribe-precondition-detached-0
  it('RTPO19b - subscribe() checks RTO25 access API preconditions on DETACHED channel', async function () {
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
            siteCode: 'test-site',
            objectsGCGracePeriod: 86400000,
          },
        } as any);
      },
      onMessageFromClient: (msg: any) => {
        if (msg.action === PM_ACTION.ATTACH) {
          mockWs.active_connection!.send_to_client({
            action: PM_ACTION.ATTACHED,
            channel: msg.channel,
            channelSerial: 'sync1:',
            flags: 128, // HAS_OBJECTS
          });
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', [
              buildObjectState(
                'root',
                { aaa: 't:0' },
                {
                  map: {
                    semantics: 0,
                    entries: {
                      score: { data: { objectId: 'counter:score@1000' }, timeserial: 't:0' },
                    },
                  },
                  createOp: { action: 0, objectId: 'root', mapCreate: { semantics: 0, entries: {} } },
                },
              ),
              buildObjectState(
                'counter:score@1000',
                { aaa: 't:0' },
                {
                  counter: { count: 0 },
                  createOp: { action: 3, objectId: 'counter:score@1000', counterCreate: { count: 0 } },
                },
              ),
            ]),
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

    const channel = client.channels.get('test-precondition', {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    // First get the channel to attached state and obtain root
    const rootPath = await channel.object.get();

    // Detach the channel client-side (a server-injected DETACHED would trigger an
    // RTL13a re-attach and the channel would not stay DETACHED)
    await channel.detach();
    await flushAsync();
    expect(channel.state).to.equal('detached');

    try {
      rootPath.subscribe(() => {});
      expect.fail('Expected subscribe() to throw on DETACHED channel');
    } catch (error: any) {
      expect(error.code).to.equal(90001);
      expect(error.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTPO19c1a/subscribe-non-positive-depth-throws-0
  it('RTPO19c1a - subscribe() with depth 0 throws 40003', async function () {
    const { root } = await setupSyncedChannel('test-RTPO19c1a-zero');

    expect(() => root.subscribe(() => {}, { depth: 0 }))
      .to.throw()
      .with.property('code', 40003);
  });

  // UTS: objects/unit/RTPO19c1a/subscribe-negative-depth-throws-0
  it('RTPO19c1a - subscribe() with negative depth throws 40003', async function () {
    const { root } = await setupSyncedChannel('test-RTPO19c1a-neg');

    expect(() => root.subscribe(() => {}, { depth: -1 }))
      .to.throw()
      .with.property('code', 40003);
  });

  // UTS: objects/unit/RTPO19c1/subscribe-depth-1-self-only-0
  it('RTPO19c1 - subscribe() with depth 1 only receives self events', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19c1-d1');

    const events: any[] = [];
    root.subscribe((event: any) => events.push(event), { depth: 1 });

    // Self event: MAP_SET on root map
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19c1-d1', [
        buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(events).to.have.length(1);

    // Child event: counter increment at depth 2 (should NOT be received)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19c1-d1', [buildCounterInc('counter:score@1000', 7, '100', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length(1);
  });

  // UTS: objects/unit/RTPO19c1/subscribe-depth-2-children-0
  it('RTPO19c1 - subscribe() with depth 2 receives self and children only', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19c1-d2');

    const events: any[] = [];
    root.subscribe((event: any) => events.push(event), { depth: 2 });

    // Quiescence control: unlimited-depth listener sees every dispatch
    const controlEvents: any[] = [];
    root.subscribe((event: any) => controlEvents.push(event));

    // Self event: MAP_SET on root map (depth calc: 0-0+1=1 <= 2)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19c1-d2', [
        buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(events).to.have.length(1);

    // Child event: counter at path ['score'] (depth calc: 1-0+1=2 <= 2)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19c1-d2', [buildCounterInc('counter:score@1000', 7, '100', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length(2);

    // Grandchild event: nested counter at ['profile', 'nested_counter'] (depth calc:
    // 2-0+1=3 > 2) -- a single-candidate COUNTER_INC, so NOT received at depth 2
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19c1-d2', [buildCounterInc('counter:nested@1000', 1, '101', 'remote')]),
    );

    // Quiescence: the control listener proves the grandchild dispatch happened
    await pollUntil(() => controlEvents.length >= 3);
    expect(controlEvents).to.have.length(3);

    expect(events).to.have.length(2);
  });

  // UTS: objects/unit/RTPO19c1/subscribe-unlimited-depth-0
  it('RTPO19c1 - subscribe() with no depth receives all descendants', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19c1-all');

    const events: any[] = [];
    root.subscribe((event: any) => events.push(event));

    // Self event on root
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19c1-all', [
        buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(events).to.have.length.greaterThanOrEqual(1);

    // Child event (counter at depth 2)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19c1-all', [buildCounterInc('counter:score@1000', 7, '100', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length.greaterThanOrEqual(2);

    // Deep descendant event (prefs.theme at depth 4)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19c1-all', [
        buildMapSet('map:prefs@1000', 'theme', { string: 'light' }, remoteSerial(1), 'remote'),
      ]),
    );
    await flushAsync();

    expect(events).to.have.length.greaterThanOrEqual(3);
  });

  // UTS: objects/unit/RTPO19d/subscribe-returns-subscription-0
  it('RTPO19d - unsubscribe() deregisters listener', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19d');

    const events: any[] = [];
    const sub = root.get('score').subscribe((event: any) => events.push(event));

    expect(sub).to.have.property('unsubscribe');
    sub.unsubscribe();

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19d', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length(0);
  });

  // UTS: objects/unit/RTPO19e1/event-path-object-correct-0
  it('RTPO19e1 - subscribe() event provides correct PathObject', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19e1');

    const events: any[] = [];
    root.subscribe((event: any) => events.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19e1', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length.greaterThanOrEqual(1);
    expect(events[0].object.path()).to.equal('score');
    expect(events[0].object.value()).to.equal(107);
  });

  // UTS: objects/unit/RTPO19e2/event-message-delivery-0
  it('RTPO19e2 - subscribe() event delivers PublicAPI::ObjectMessage for operations', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19e2');

    const events: any[] = [];
    root.get('score').subscribe((event: any) => events.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19e2', [buildCounterInc('counter:score@1000', 42, 'serial-1', 'site-a')]),
    );
    await flushAsync();

    expect(events).to.have.length(1);
    expect(events[0].message).to.exist;
    expect(events[0].message.channel).to.equal('test-RTPO19e2');
    expect(events[0].message.serial).to.equal('serial-1');
    expect(events[0].message.siteCode).to.equal('site-a');
    expect(events[0].message.operation).to.exist;
    expect(events[0].message.operation.action).to.equal('counter.inc');
    expect(events[0].message.operation.objectId).to.equal('counter:score@1000');
    expect(events[0].message.operation.counterInc.number).to.equal(42);
  });

  // UTS: objects/unit/RTPO19e2/event-message-omitted-no-operation-0
  // Sync-triggered updates (OBJECT_SYNC with changed state) DO fire path subscription events
  // (realtimeobject.ts _applySync -> notifyUpdated); the event's `message` is omitted because the
  // source ObjectMessage carries no `operation` field (liveobject.ts).
  it('RTPO19e2 - subscribe() event omits message when objectMessage has no operation', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19e2-no-op');

    const events: any[] = [];
    root.subscribe((event: any) => events.push(event));

    // Send an OBJECT_SYNC that changes counter:score@1000's state without an operation field —
    // an update via replaceData which has no objectMessage.operation. The sync intentionally
    // omits root: per RTO5c2a root is never removed from the pool, so it is retained and still
    // references "score" — counter:score stays reachable and its sync-triggered update dispatches
    // to the root subscription (message omitted).
    mockWs.active_connection!.send_to_client({
      action: PM_ACTION.OBJECT_SYNC,
      channel: 'test-RTPO19e2-no-op',
      channelSerial: 'sync2:',
      state: [
        buildObjectState(
          'counter:score@1000',
          { aaa: 't:1' },
          {
            counter: { count: 0 },
            createOp: { action: 3, objectId: 'counter:score@1000', counterCreate: { count: 200 } },
          },
        ),
      ],
    });
    await flushAsync();

    expect(events).to.have.length.greaterThanOrEqual(1);
    // Events from sync-triggered updates should have no message
    for (const event of events) {
      expect(event.message).to.not.exist;
    }
  });

  // UTS: objects/unit/RTPO19f/subscribe-follows-path-0
  it('RTPO19f - subscribe() follows path not identity', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19f');

    const events: any[] = [];
    root.get('score').subscribe((event: any) => events.push(event));

    // Replace the counter at "score" with a new counter
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19f', [
        buildMapSet('root', 'score', { objectId: 'counter:new@2000' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    // Increment the NEW counter at "score"
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19f', [buildCounterInc('counter:new@2000', 10, '100', 'remote')]),
    );
    await flushAsync();

    // Should receive event for the new counter, since subscription follows path
    const foundNew = events.some((event) => event.object.path() === 'score');
    expect(foundNew).to.be.true;
  });

  // UTS: objects/unit/RTPO19g/subscribe-no-side-effects-0
  it('RTPO19g - subscribe() has no side effects', async function () {
    const { root, channel } = await setupSyncedChannel('test-RTPO19g');

    const stateBefore = channel.state;

    root.get('score').subscribe(() => {});

    expect(channel.state).to.equal(stateBefore);
  });

  // UTS: objects/unit/RTPO19/subscribe-primitive-path-0
  it('RTPO19 - subscribe() on primitive path receives change events', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19-prim');

    const events: any[] = [];
    root.get('name').subscribe((event: any) => events.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19-prim', [
        buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(events).to.have.length(1);
    expect(events[0].object.path()).to.equal('name');
  });

  // UTS: objects/unit/RTPO19/map-clear-triggers-child-events-0
  it('RTPO19 - MAP_CLEAR triggers subscription events on child paths', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19-clear');

    const events: any[] = [];
    root.subscribe((event: any) => events.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19-clear', [buildMapClear('root', 't:1', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length.greaterThanOrEqual(1);
  });

  // UTS: objects/unit/RTPO19/child-events-bubble-0
  it('RTPO19 - child events bubble up to parent subscription', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO19-bubble');

    const events: any[] = [];
    root.get('profile').subscribe((event: any) => events.push(event));

    // Self event on profile map
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19-bubble', [
        buildMapSet('map:profile@1000', 'email', { string: 'bob@example.com' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(events).to.have.length.greaterThanOrEqual(1);

    // Child event (nested counter)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO19-bubble', [buildCounterInc('counter:nested@1000', 3, '100', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length.greaterThanOrEqual(2);
  });

  // UTS: objects/unit/RTO24c1/depth-filtering-formula-0
  it('RTO24c1 - depth filtering formula with depth 2 at profile', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24c1');

    // Seed a counter at profile.prefs.deep BEFORE subscribing (RTO6 zero-value-creates
    // counter:deep@3000), so a later grandchild update yields a single candidate path
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1', [
        buildMapSet('map:prefs@1000', 'deep', { objectId: 'counter:deep@3000' }, '50', 'remote'),
      ]),
    );
    await flushAsync();

    const events: any[] = [];
    root.get('profile').subscribe((event: any) => events.push(event), { depth: 2 });

    // Quiescence control: unlimited-depth listener at root sees every dispatch
    const controlEvents: any[] = [];
    root.subscribe((event: any) => controlEvents.push(event));

    // Self event: MAP_SET on profile (depth calc: 1-1+1=1 <= 2)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1', [
        buildMapSet('map:profile@1000', 'email', { string: 'bob@example.com' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(events).to.have.length(1);

    // Child event: nested counter at ['profile', 'nested_counter'] (depth calc: 2-1+1=2 <= 2)
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1', [buildCounterInc('counter:nested@1000', 3, '100', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length(2);

    // Grandchild event: counter:deep at ['profile', 'prefs', 'deep'] (depth calc:
    // 3-1+1=3 > 2) -- a single-candidate COUNTER_INC, so NOT received at depth 2
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1', [buildCounterInc('counter:deep@3000', 1, '101', 'remote')]),
    );

    // Quiescence: the root control listener proves the grandchild dispatch happened
    await pollUntil(() => controlEvents.length >= 3);
    expect(controlEvents).to.have.length(3);

    expect(events).to.have.length(2);
  });

  // Additional depth formula test: depth 1 at profile excludes children
  it('RTO24c1 - depth 1 at profile excludes child events', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24c1-d1');

    const events: any[] = [];
    root.get('profile').subscribe((event: any) => events.push(event), { depth: 1 });

    // Self event: MAP_SET on profile (depth calc: 1-1+1=1 <= 1) YES
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1-d1', [
        buildMapSet('map:profile@1000', 'email', { string: 'bob@example.com' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(events).to.have.length(1);

    // Child event: nested counter at ['profile', 'nested_counter'] (depth calc: 2-1+1=2 > 1) NO
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1-d1', [buildCounterInc('counter:nested@1000', 3, '100', 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length(1);
  });

  // UTS: objects/unit/RTO24c1/prefix-mismatch-0
  it('RTO24c1 - prefix mismatch does not trigger subscription', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24c1-prefix');

    const profileEvents: any[] = [];
    root.get('profile').subscribe((event: any) => profileEvents.push(event));
    // Quiescence control: an unlimited-depth root listener covers the out-of-scope paths below,
    // so it fires on both sends and gives us a delivery to await before asserting profileEvents
    // is unchanged (Negative-assertion quiescence, helpers/standard_test_pool).
    const controlEvents: any[] = [];
    root.subscribe((event: any) => controlEvents.push(event));

    // Change at "score" — "profile" is not a prefix of "score"
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1-prefix', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    // Change at "name" — "profile" is not a prefix of "name". Serial "t:1" sorts after the pool
    // baseline "t:0", so this MAP_SET genuinely applies (with a stale sub-"t:0" serial it would be
    // rejected and this half of the negative assertion would be vacuous).
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24c1-prefix', [
        buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote'),
      ]),
    );

    // Quiescence: await the control listener (fires for both sends) so any profileEvents callback
    // would also have run, THEN assert the out-of-scope subscription stayed silent.
    await pollUntil(() => controlEvents.length >= 2);
    expect(controlEvents).to.have.length(2);
    expect(profileEvents).to.have.length(0);
  });

  // UTS: objects/unit/RTO24b2a/candidate-paths-map-keys-0
  // For a LiveMapUpdate, candidate paths include pathToThis extended by each updated key
  // (RTO24b2a2), so a MAP_SET on root key "score" fires the ["score"] child subscription
  // (liveobject.ts candidate-path construction).
  it('RTO24b2a - candidate path construction includes map update keys', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24b2a');

    const scoreEvents: any[] = [];
    const rootEvents: any[] = [];
    // Subscribe at the child path "score" (pathToThis=[""] + key "score" = ["score"])
    root.get('score').subscribe((event: any) => scoreEvents.push(event));
    // Subscribe at root path (pathToThis=[""])
    root.subscribe((event: any) => rootEvents.push(event));

    // MAP_SET on root with key "score" — generates candidates:
    //   1. pathToThis = [] (root itself)
    //   2. [] + "score" = ["score"] (from the map update key)
    // Both subscriptions should fire
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24b2a', [
        buildMapSet('root', 'score', { objectId: 'counter:new@2000' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    expect(scoreEvents).to.have.length(1);
    expect(scoreEvents[0].object.path()).to.equal('score');
    expect(rootEvents).to.have.length(1);
  });

  // UTS: objects/unit/RTO24b2c/listener-exception-caught-0
  it('RTO24b2c - listener exception does not affect other listeners', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24b2c');

    const events: any[] = [];
    root.subscribe(() => {
      throw new Error('boom');
    });
    root.subscribe((event: any) => events.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24b2c', [buildMapSet('root', 'name', { string: 'Bob' }, remoteSerial(0), 'remote')]),
    );
    await flushAsync();

    expect(events).to.have.length(1);
  });

  // UTS: objects/unit/RTO24b1/multi-path-dispatch-0
  it('RTO24b1 - dispatch via getFullPaths for multi-path objects', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24b1');

    const eventsScore: any[] = [];
    const eventsAlias: any[] = [];

    // "score" already points to counter:score@1000.
    // Add a second reference "alias" -> counter:score@1000 so it has two paths.
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24b1', [
        buildMapSet('root', 'alias', { objectId: 'counter:score@1000' }, '98', 'remote'),
      ]),
    );
    await flushAsync();

    root.get('score').subscribe((event: any) => eventsScore.push(event));
    root.get('alias').subscribe((event: any) => eventsAlias.push(event));

    // Increment counter:score@1000 — getFullPaths returns ["score"] and ["alias"]
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24b1', [buildCounterInc('counter:score@1000', 5, '99', 'remote')]),
    );
    await flushAsync();

    expect(eventsScore).to.have.length(1);
    expect(eventsScore[0].object.path()).to.equal('score');
    expect(eventsAlias).to.have.length(1);
    expect(eventsAlias[0].object.path()).to.equal('alias');
  });

  // UTS: objects/unit/RTO24b2b/fires-once-per-dispatch-0
  // A MAP_SET on root key "score" pointing to a new objectId generates candidate paths [] and
  // ["score"]; each subscription fires exactly once for the first covered candidate
  // (pathobjectsubscriptionregister.ts notifyPathEvent).
  it('RTO24b2b - subscription fires exactly once per dispatch', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTO24b2b');

    const events: any[] = [];
    // Subscribe at root (unlimited depth) — covers both [] and ["score"]
    root.subscribe((event: any) => events.push(event));

    // MAP_SET on root with key "score" — candidates are [] and ["score"]
    // Root subscription covers both, but should fire exactly once with
    // the first candidate (pathToThis = [])
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24b2b', [
        buildMapSet('root', 'score', { objectId: 'counter:new@2000' }, remoteSerial(0), 'remote'),
      ]),
    );
    await flushAsync();

    // Single-candidate control dispatch: COUNTER_INC on the just-created object —
    // exactly one further event, proving delivery continued past the first dispatch
    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTO24b2b', [buildCounterInc('counter:new@2000', 1, '100', 'remote')]),
    );
    await flushAsync();

    // Exactly one event per dispatch, even though the first had multiple candidates
    expect(events).to.have.length(2);
  });
});
