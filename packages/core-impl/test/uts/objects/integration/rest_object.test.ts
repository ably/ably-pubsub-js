/**
 * UTS Integration: RestObject Tests
 *
 * Spec points: RSL16, RSO2, RSO2g, RSO3, RSO3c, RSO4, RSO5, RSO5a1, RSO5c3, RSO5d, RSO5e, RSO5f,
 * RSO5g2, RSO5h, RSO5i, RSO5j, RSO6, RSO7, RSO9, RSO10, RSO13, RSO14, RSO15
 * Source: uts/objects/integration/rest_object_test.md
 *
 * End-to-end verification that HttpObject#publish, HttpObject#get and HttpObject#generateObjectId
 * (RestObject in the spec) interoperate with the real service: the wire encodings the SDK produces
 * are accepted, the responses the service returns are decoded into the documented types, and
 * locally generated object IDs are accepted by the server.
 *
 * Server-defined behaviour (compact formatting of bytes and JSON leaves, path syntax, error codes
 * for unresolvable targets) is deliberately not asserted beyond what the SDK spec requires.
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
  pollUntilSuccess,
} from '../../realtime/integration/sandbox';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';
import { describeWithProtocols } from './protocol_variants';

const MAX_EXACT_INT = 9007199254740991; // 2^53 - 1

function expectBuffer(actual: any, expected: number[]): void {
  expect(Buffer.isBuffer(actual), 'expected a Buffer').to.be.true;
  expect(Buffer.compare(actual, Buffer.from(expected))).to.equal(0);
}

describeWithProtocols('uts/objects/integration/rest_object', function (useBinaryProtocol) {
  this.timeout(60000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  function createRestChannel(testName: string): { client: any; channel: any } {
    const client = new Ably.Http({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);
    const channel = client.channels.get(uniqueChannelName('objects-rest-' + testName));
    return { client, channel };
  }

  // UTS: objects/integration/RSO3/mapset-primitives-roundtrip-0
  it('RSO3, RSO2 - mapSet primitives on the channel object, read back in compact and full modes', async function () {
    const { channel } = createRestChannel('RSO3-primitives');

    const publishResult = await channel.object.publish([
      { objectId: 'root', mapSet: { key: 'str', value: { string: 'hello' } } },
      { objectId: 'root', mapSet: { key: 'num', value: { number: 42.5 } } },
      { objectId: 'root', mapSet: { key: 'bool', value: { boolean: true } } },
      { objectId: 'root', mapSet: { key: 'bin', value: { bytes: Buffer.from([0x01, 0x02, 0x03]) } } },
      { objectId: 'root', mapSet: { key: 'jobj', value: { json: { a: [1, 2] } } } },
      { objectId: 'root', mapSet: { key: 'jarr', value: { json: ['x', 1] } } },
    ]);

    const compact = await pollUntilSuccess(async () => {
      const c = await channel.object.get();
      return c['jarr'] != null ? c : null;
    });

    const full = await channel.object.get({ compact: false });

    expect(publishResult.messageId).to.be.a('string');
    expect(publishResult.messageId.length).to.be.greaterThan(0);
    expect(publishResult.channel).to.equal(channel.name);
    expect(publishResult.objectIds).to.be.an('array');

    expect(compact['str']).to.equal('hello');
    expect(compact['num']).to.equal(42.5);
    expect(compact['bool']).to.equal(true);

    expect(full).to.have.property('map');
    expect(full.objectId).to.equal('root');
    expect(full.map.semantics).to.equal('lww');
    expect(full.map.entries['str'].data.string).to.equal('hello');
    expect(full.map.entries['num'].data.number).to.equal(42.5);
    expect(full.map.entries['bool'].data.boolean).to.equal(true);
    expectBuffer(full.map.entries['bin'].data.bytes, [0x01, 0x02, 0x03]);
    expect(full.map.entries['jobj'].data.json).to.deep.equal({ a: [1, 2] });
    expect(full.map.entries['jarr'].data.json).to.deep.equal(['x', 1]);
  });

  // UTS: objects/integration/RSO3/mapset-edge-values-roundtrip-1
  it('RSO3, RSO2 - edge-case leaf values round-trip without being dropped or altered', async function () {
    const { channel } = createRestChannel('RSO3-edge-values');

    await channel.object.publish([
      { objectId: 'root', mapSet: { key: 'emptyStr', value: { string: '' } } },
      { objectId: 'root', mapSet: { key: 'emptyBin', value: { bytes: Buffer.from([]) } } },
      { objectId: 'root', mapSet: { key: 'zero', value: { number: 0 } } },
      { objectId: 'root', mapSet: { key: 'maxInt', value: { number: MAX_EXACT_INT } } },
      { objectId: 'root', mapSet: { key: 'minInt', value: { number: -MAX_EXACT_INT } } },
      { objectId: 'root', mapSet: { key: 'no', value: { boolean: false } } },
    ]);

    const compact = await pollUntilSuccess(async () => {
      const c = await channel.object.get();
      return 'no' in c ? c : null;
    });

    const full = await channel.object.get({ compact: false });

    expect(compact['emptyStr']).to.equal('');
    expect(compact['zero']).to.equal(0);
    expect(compact['maxInt']).to.equal(MAX_EXACT_INT);
    expect(compact['minInt']).to.equal(-MAX_EXACT_INT);
    expect(compact['no']).to.equal(false);

    expect(full.map.entries['emptyStr'].data.string).to.equal('');
    expectBuffer(full.map.entries['emptyBin'].data.bytes, []);
    expect(full.map.entries['zero'].data.number).to.equal(0);
    expect(full.map.entries['maxInt'].data.number).to.equal(MAX_EXACT_INT);
    expect(full.map.entries['minInt'].data.number).to.equal(-MAX_EXACT_INT);
    expect(full.map.entries['no'].data.boolean).to.equal(false);
  });

  // UTS: objects/integration/RSO2g3/full-leaf-via-path-0
  it('RSO2g3 - full-mode get of a leaf value via path', async function () {
    const { channel } = createRestChannel('RSO2g3-leaf');

    await channel.object.publish([
      { objectId: 'root', mapSet: { key: 'bin', value: { bytes: Buffer.from([0xff, 0x00]) } } },
      { objectId: 'root', mapSet: { key: 'prefs', value: { json: { theme: 'dark' } } } },
    ]);

    const binLeaf = await pollUntilSuccess(() => channel.object.get({ path: 'bin', compact: false }));
    const jsonLeaf = await pollUntilSuccess(() => channel.object.get({ path: 'prefs', compact: false }));

    expectBuffer(binLeaf.bytes, [0xff, 0x00]);
    expect(binLeaf.encoding).to.not.exist;

    expect(jsonLeaf.json).to.deep.equal({ theme: 'dark' });
    expect(jsonLeaf.encoding).to.not.exist;
  });

  // UTS: objects/integration/RSO5i/counter-create-increment-0
  it('RSO5g2, RSO5i, RSO15 - counterCreate at a path, counterInc via path and objectId', async function () {
    const { channel } = createRestChannel('RSO5i-counter');

    const createResult = await channel.object.publish({ path: 'visits', counterCreate: { count: 10 } });
    const counterId = createResult.objectIds.find((id: string) => id.startsWith('counter:'));
    expect(counterId).to.exist;

    await channel.object.publish({ path: 'visits', counterInc: { number: 5 } });
    await channel.object.publish({ objectId: counterId, counterInc: { number: -3 } });

    await pollUntilSuccess(async () => (await channel.object.get({ path: 'visits' })) === 12);

    const full = await channel.object.get({ objectId: counterId, compact: false });

    expect(full).to.have.property('counter');
    expect(full.objectId).to.equal(counterId);
    expect(full.counter.data.number).to.equal(12);
  });

  // UTS: objects/integration/RSO5g2/standalone-counter-create-1
  it('RSO5g2, RSO5j - standalone counterCreate returns a server-generated objectId', async function () {
    const { channel } = createRestChannel('RSO5g2-standalone');

    const result = await channel.object.publish({ counterCreate: { count: 42 } });
    const counterId = result.objectIds[0];

    const full = await pollUntilSuccess(() => channel.object.get({ objectId: counterId, compact: false }));

    expect(result.objectIds).to.have.length(1);
    expect(counterId.startsWith('counter:')).to.be.true;

    expect(full).to.have.property('counter');
    expect(full.objectId).to.equal(counterId);
    expect(full.counter.data.number).to.equal(42);
  });

  // UTS: objects/integration/RSO5j/standalone-map-create-0
  it('RSO5c3, RSO5j - standalone mapCreate returns a server-generated objectId', async function () {
    const { channel } = createRestChannel('RSO5j-standalone');

    const result = await channel.object.publish({
      mapCreate: {
        semantics: 'lww',
        entries: {
          name: { data: { string: 'Alice' } },
          age: { data: { number: 30 } },
          active: { data: { boolean: true } },
          avatar: { data: { bytes: Buffer.from([0x0a, 0x0b]) } },
          prefs: { data: { json: { theme: 'dark' } } },
          tags: { data: { json: ['a', 'b'] } },
        },
      },
    });
    const mapId = result.objectIds[0];

    const full = await pollUntilSuccess(() => channel.object.get({ objectId: mapId, compact: false }));

    expect(result.objectIds).to.have.length(1);
    expect(mapId.startsWith('map:')).to.be.true;

    expect(full).to.have.property('map');
    expect(full.objectId).to.equal(mapId);
    expect(full.map.entries['name'].data.string).to.equal('Alice');
    expect(full.map.entries['age'].data.number).to.equal(30);
    expect(full.map.entries['active'].data.boolean).to.equal(true);
    expectBuffer(full.map.entries['avatar'].data.bytes, [0x0a, 0x0b]);
    expect(full.map.entries['prefs'].data.json).to.deep.equal({ theme: 'dark' });
    expect(full.map.entries['tags'].data.json).to.deep.equal(['a', 'b']);
  });

  // UTS: objects/integration/RSO5c3/map-create-at-path-0
  it('RSO5c3, RSO2g1 - mapCreate at a path is reachable from the channel object', async function () {
    const { channel } = createRestChannel('RSO5c3-path');

    await channel.object.publish({
      path: 'profile',
      mapCreate: { semantics: 'lww', entries: { nickname: { data: { string: 'ally' } } } },
    });

    const rootFull = await pollUntilSuccess(async () => {
      const r = await channel.object.get({ compact: false });
      return 'profile' in r.map.entries ? r : null;
    });

    const profile = rootFull.map.entries['profile'].data;
    const nicknameViaPath = await channel.object.get({ path: 'profile.nickname' });
    const nicknameViaId = await channel.object.get({ objectId: profile.objectId, path: 'nickname' });

    expect(profile).to.have.property('map');
    expect(profile.objectId.startsWith('map:')).to.be.true;
    expect(profile.map.entries['nickname'].data.string).to.equal('ally');

    expect(nicknameViaPath).to.equal('ally');
    expect(nicknameViaId).to.equal('ally');
  });

  // UTS: objects/integration/RSO5e/mapset-nested-path-0
  it('RSO5e, RSO6 - mapSet targeted by a nested path', async function () {
    const { channel } = createRestChannel('RSO5e-nested-path');

    await channel.object.publish({ path: 'outer', mapCreate: { semantics: 'lww', entries: {} } });
    await pollUntilSuccess(async () => (await channel.object.get({ path: 'outer' })) != null);

    await channel.object.publish({ path: 'outer.inner', mapCreate: { semantics: 'lww', entries: {} } });
    await pollUntilSuccess(async () => (await channel.object.get({ path: 'outer.inner' })) != null);

    await channel.object.publish([
      { path: 'outer', mapSet: { key: 'shallow', value: { number: 1 } } },
      { path: 'outer.inner', mapSet: { key: 'deep', value: { string: 'value' } } },
    ]);

    const compact = await pollUntilSuccess(async () => {
      const c = await channel.object.get();
      return c['outer']?.['shallow'] === 1 && c['outer']?.['inner']?.['deep'] === 'value' ? c : null;
    });

    expect(compact['outer']).to.deep.equal({ shallow: 1, inner: { deep: 'value' } });
  });

  // UTS: objects/integration/RSO5e/mapset-object-reference-1
  it('RSO5e, RSO7 - mapSet with an objectId reference to an existing object', async function () {
    const { channel } = createRestChannel('RSO5e-object-ref');

    const createResult = await channel.object.publish({ path: 'first', counterCreate: { count: 5 } });
    const counterId = createResult.objectIds.find((id: string) => id.startsWith('counter:'));
    expect(counterId).to.exist;

    await pollUntilSuccess(async () => (await channel.object.get({ path: 'first' })) === 5);

    const setResult = await channel.object.publish({
      objectId: 'root',
      mapSet: { key: 'second', value: { objectId: counterId } },
    });

    const full = await pollUntilSuccess(async () => {
      const r = await channel.object.get({ compact: false });
      return 'second' in r.map.entries ? r : null;
    });

    const counter = await channel.object.get({ objectId: counterId, compact: false });

    expect(setResult.messageId).to.be.a('string');
    expect(setResult.messageId.length).to.be.greaterThan(0);
    expect(setResult.channel).to.equal(channel.name);
    expect(setResult.objectIds).to.be.an('array');

    // The server may inline a multiply-referenced object under only one key, so only objectIds are compared
    expect(full.map.entries['first'].data.objectId).to.equal(counterId);
    expect(full.map.entries['second'].data.objectId).to.equal(counterId);

    expect(counter).to.have.property('counter');
    expect(counter.counter.data.number).to.equal(5);
  });

  // UTS: objects/integration/RSO5f/map-remove-0
  it('RSO5f - mapRemove via path and via objectId', async function () {
    const { channel } = createRestChannel('RSO5f-remove');

    await channel.object.publish([
      {
        path: 'settings',
        mapCreate: { semantics: 'lww', entries: { a: { data: { number: 1 } }, b: { data: { number: 2 } } } },
      },
      { objectId: 'root', mapSet: { key: 'keep', value: { string: 'x' } } },
      { objectId: 'root', mapSet: { key: 'drop', value: { string: 'y' } } },
    ]);

    await channel.object.publish([
      { path: 'settings', mapRemove: { key: 'a' } },
      { objectId: 'root', mapRemove: { key: 'drop' } },
    ]);

    const compact = await pollUntilSuccess(async () => {
      const c = await channel.object.get();
      return !('drop' in c) && c['settings'] != null && !('a' in c['settings']) ? c : null;
    });

    expect(compact['keep']).to.equal('x');
    expect(compact).to.not.have.property('drop');
    expect(compact['settings']).to.deep.equal({ b: 2 });
  });

  // UTS: objects/integration/RSO6/wildcard-path-passthrough-0
  it('RSO6 - wildcard path passed through to the server', async function () {
    const { channel } = createRestChannel('RSO6-wildcard');

    await channel.object.publish({ path: 'items', mapCreate: { semantics: 'lww', entries: {} } });
    await pollUntilSuccess(async () => (await channel.object.get({ path: 'items' })) != null);

    await channel.object.publish([
      { path: 'items.one', mapCreate: { semantics: 'lww', entries: {} } },
      { path: 'items.two', mapCreate: { semantics: 'lww', entries: {} } },
    ]);
    await pollUntilSuccess(async () => {
      const i = await channel.object.get({ path: 'items' });
      return 'one' in i && 'two' in i;
    });

    await channel.object.publish({ path: 'items.*', mapSet: { key: 'flag', value: { boolean: true } } });

    const items = await pollUntilSuccess(async () => {
      const i = await channel.object.get({ path: 'items' });
      return i['one']?.['flag'] === true && i['two']?.['flag'] === true ? i : null;
    });

    expect(items['one']['flag']).to.equal(true);
    expect(items['two']['flag']).to.equal(true);
  });

  // UTS: objects/integration/RSO6/wildcard-remove-increment-1
  it('RSO6, RSO5f, RSO5i - wildcard path with mapRemove and counterInc', async function () {
    const { channel } = createRestChannel('RSO6-wildcard-ops');

    await channel.object.publish([
      { path: 'maps', mapCreate: { semantics: 'lww', entries: {} } },
      { path: 'counters', mapCreate: { semantics: 'lww', entries: {} } },
    ]);
    await pollUntilSuccess(async () => {
      const c = await channel.object.get();
      return 'maps' in c && 'counters' in c;
    });

    await channel.object.publish([
      {
        path: 'maps.one',
        mapCreate: { semantics: 'lww', entries: { foo: { data: { string: 'a' } }, keep: { data: { number: 1 } } } },
      },
      {
        path: 'maps.two',
        mapCreate: { semantics: 'lww', entries: { foo: { data: { string: 'b' } }, keep: { data: { number: 2 } } } },
      },
      { path: 'counters.c1', counterCreate: { count: 10 } },
      { path: 'counters.c2', counterCreate: { count: 20 } },
    ]);
    await pollUntilSuccess(async () => {
      const c = await channel.object.get();
      return 'one' in c['maps'] && 'two' in c['maps'] && 'c1' in c['counters'] && 'c2' in c['counters'];
    });

    await channel.object.publish([
      { path: 'maps.*', mapRemove: { key: 'foo' } },
      { path: 'counters.*', counterInc: { number: 5 } },
    ]);

    const compact = await pollUntilSuccess(async () => {
      const c = await channel.object.get();
      return !('foo' in c['maps']['one']) &&
        !('foo' in c['maps']['two']) &&
        c['counters']['c1'] === 15 &&
        c['counters']['c2'] === 25
        ? c
        : null;
    });

    expect(compact['maps']['one']).to.deep.equal({ keep: 1 });
    expect(compact['maps']['two']).to.deep.equal({ keep: 2 });
    expect(compact['counters']['c1']).to.equal(15);
    expect(compact['counters']['c2']).to.equal(25);
  });

  // UTS: objects/integration/RSO4/generated-ids-batch-0
  it('RSO4, RSO5d, RSO5h - locally generated object IDs accepted in a single batch', async function () {
    const { channel } = createRestChannel('RSO4-generated');

    const counter = await channel.object.generateObjectId({ counterCreate: { count: 7 } });
    const map = await channel.object.generateObjectId({
      mapCreate: {
        semantics: 'lww',
        entries: {
          visits: { data: { objectId: counter.objectId } },
          label: { data: { string: 'stats' } },
          raw: { data: { bytes: Buffer.from([0x01]) } },
        },
      },
    });

    const result = await channel.object.publish([
      {
        objectId: counter.objectId,
        counterCreateWithObjectId: { initialValue: counter.initialValue, nonce: counter.nonce },
      },
      {
        objectId: map.objectId,
        mapCreateWithObjectId: { initialValue: map.initialValue, nonce: map.nonce },
      },
      { objectId: 'root', mapSet: { key: 'stats', value: { objectId: map.objectId } } },
    ]);

    const stats = await pollUntilSuccess(() => channel.object.get({ path: 'stats', compact: false }));

    expect(counter.objectId.startsWith('counter:')).to.be.true;
    expect(map.objectId.startsWith('map:')).to.be.true;
    expect(result.objectIds).to.include(counter.objectId);
    expect(result.objectIds).to.include(map.objectId);

    expect(stats).to.have.property('map');
    expect(stats.objectId).to.equal(map.objectId);
    expect(stats.map.entries['label'].data.string).to.equal('stats');
    expectBuffer(stats.map.entries['raw'].data.bytes, [0x01]);

    const visits = stats.map.entries['visits'].data;
    expect(visits).to.have.property('counter');
    expect(visits.objectId).to.equal(counter.objectId);
    expect(visits.counter.data.number).to.equal(7);
  });

  // UTS: objects/integration/RSO5a1/idempotent-operation-id-0
  it('RSO5a1 - operation id makes a publish idempotent', async function () {
    const { channel } = createRestChannel('RSO5a1-idempotent');

    await channel.object.publish({ path: 'count', counterCreate: { count: 0 } });
    await pollUntilSuccess(async () => (await channel.object.get({ path: 'count' })) === 0);

    const opId = 'idem-' + Math.random().toString(36).substring(2, 10);

    await channel.object.publish({ id: opId, path: 'count', counterInc: { number: 1 } });
    await channel.object.publish({ id: opId, path: 'count', counterInc: { number: 1 } });

    // Marker write published after both increments; once it is visible, both increments have been processed
    await channel.object.publish({ objectId: 'root', mapSet: { key: 'marker', value: { boolean: true } } });
    const compact = await pollUntilSuccess(async () => {
      const c = await channel.object.get();
      return c['marker'] === true ? c : null;
    });

    expect(compact['count']).to.equal(1);
  });

  // UTS: objects/integration/RSL16/realtime-write-rest-read-0
  it('RSL16, RSO2g - state written by a realtime client is readable via REST', async function () {
    const channelName = uniqueChannelName('objects-rest-RSL16-interop');

    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(realtime);
    await connectAndWait(realtime);

    const realtimeChannel = realtime.channels.get(channelName, { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await realtimeChannel.object.get();

    const rest = new Ably.Http({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(rest);
    const channel = rest.channels.get(channelName) as any;

    await root.set('str', 'hello');
    await root.set('bin', Buffer.from([0x01, 0x02, 0x03]));
    await root.set('prefs', { theme: 'dark' });
    await root.set('visits', LiveObjectsPlugin.LiveCounter.create(7));
    await root.set('profile', LiveObjectsPlugin.LiveMap.create({ nickname: 'ally' }));

    const full = await pollUntilSuccess(async () => {
      const r = await channel.object.get({ compact: false });
      return 'profile' in r.map.entries ? r : null;
    });
    const compact = await channel.object.get();

    expect(compact['str']).to.equal('hello');
    expect(compact['visits']).to.equal(7);
    expect(compact['profile']['nickname']).to.equal('ally');

    expect(full).to.have.property('map');
    expect(full.objectId).to.equal('root');
    expect(full.map.entries['str'].data.string).to.equal('hello');
    expectBuffer(full.map.entries['bin'].data.bytes, [0x01, 0x02, 0x03]);
    expect(full.map.entries['prefs'].data.json).to.deep.equal({ theme: 'dark' });

    const visits = full.map.entries['visits'].data;
    expect(visits).to.have.property('counter');
    expect(visits.objectId.startsWith('counter:')).to.be.true;
    expect(visits.counter.data.number).to.equal(7);

    const profile = full.map.entries['profile'].data;
    expect(profile).to.have.property('map');
    expect(profile.objectId.startsWith('map:')).to.be.true;
    expect(profile.map.entries['nickname'].data.string).to.equal('ally');

    await closeAndWait(realtime);
  });

  // UTS: objects/integration/RSO2h/unresolvable-target-error-0
  it('RSO2h - server error for an unresolvable target surfaced as ErrorInfo', async function () {
    const { channel } = createRestChannel('RSO2h-errors');

    let error: any;
    try {
      await channel.object.get({ objectId: 'map:doesNotExistAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA@1700000000000' });
      expect.fail('expected get to reject');
    } catch (err) {
      error = err;
    }
    expect(error).to.be.instanceOf(Ably.ErrorInfo);
    expect(error.statusCode).to.be.at.least(400).and.below(500);

    let pathError: any;
    try {
      await channel.object.get({ path: 'no.such.path' });
      expect.fail('expected get to reject');
    } catch (err) {
      pathError = err;
    }
    expect(pathError).to.be.instanceOf(Ably.ErrorInfo);
    expect(pathError.statusCode).to.be.at.least(400).and.below(500);
  });
});
