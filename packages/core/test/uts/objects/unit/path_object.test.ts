/**
 * UTS: PathObject Read Operations Tests
 *
 * Spec points: RTPO1-14
 * Source: uts/objects/unit/path_object.md
 *
 * Tests PathObject navigation, value resolution, instance wrapping,
 * entries (RTPO9), keys (RTPO10), values (RTPO11) iteration, size, compact, and compactJson.
 */

import { expect } from 'chai';
import { restoreAll, pollUntil } from '../../helpers';
import { setupSyncedChannel, buildObjectMessage, buildMapSet } from '../helpers/standard_test_pool';

describe('uts/objects/unit/path_object', function () {
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTPO4/path-string-representation-0
  it('RTPO4 - path() returns dot-delimited string', async function () {
    const { root } = await setupSyncedChannel('test-RTPO4');

    expect(root.path()).to.equal('');
    expect(root.get('profile').path()).to.equal('profile');
    expect(root.get('profile').get('email').path()).to.equal('profile.email');
  });

  // UTS: objects/unit/RTPO4b/path-escapes-dots-0
  it('RTPO4b - path() escapes dots in segments', async function () {
    const { root } = await setupSyncedChannel('test-RTPO4b');

    const po = root.get('a.b').get('c');
    expect(po.path()).to.equal('a\\.b.c');
  });

  // UTS: objects/unit/RTPO5/get-appends-key-0
  it('RTPO5 - get() returns new PathObject with appended key', async function () {
    const { root } = await setupSyncedChannel('test-RTPO5');

    const child = root.get('profile');
    const grandchild = child.get('email');
    expect(child.path()).to.equal('profile');
    expect(grandchild.path()).to.equal('profile.email');
    expect(child).to.not.equal(root);
  });

  // UTS: objects/unit/RTPO5b/get-non-string-throws-0
  it('RTPO5b - get() throws on non-string key', async function () {
    const { root } = await setupSyncedChannel('test-RTPO5b');

    expect(() => (root as any).get(123))
      .to.throw()
      .with.property('code', 40003);
  });

  // UTS: objects/unit/RTPO6/at-parses-path-0
  it('RTPO6 - at() parses dot-delimited path', async function () {
    const { root } = await setupSyncedChannel('test-RTPO6');

    const po = root.at('profile.email');
    expect(po.path()).to.equal('profile.email');
    expect(po.value()).to.equal('alice@example.com');
  });

  // UTS: objects/unit/RTPO6/at-escaped-dots-0
  it('RTPO6 - at() respects escaped dots', async function () {
    const { root } = await setupSyncedChannel('test-RTPO6-esc');

    const po = root.at('a\\.b.c');
    expect(po.path()).to.equal('a\\.b.c');
  });

  // UTS: objects/unit/RTPO6b/at-non-string-throws-0
  it('RTPO6b - at() throws for non-string input', async function () {
    const { root } = await setupSyncedChannel('test-RTPO6b');

    expect(() => (root as any).at(123))
      .to.throw()
      .with.property('code', 40003);
  });

  // UTS: objects/unit/RTPO7/value-counter-0
  it('RTPO7 - value() returns counter numeric value', async function () {
    const { root } = await setupSyncedChannel('test-RTPO7-counter');

    expect(root.get('score').value()).to.equal(100);
  });

  // UTS: objects/unit/RTPO7/value-primitive-0
  it('RTPO7 - value() returns primitive value', async function () {
    const { root } = await setupSyncedChannel('test-RTPO7-prim');

    expect(root.get('name').value()).to.equal('Alice');
    expect(root.get('age').value()).to.equal(30);
    expect(root.get('active').value()).to.equal(true);
  });

  // UTS: objects/unit/RTPO7d/value-livemap-null-0
  it('RTPO7d - value() returns undefined for LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTPO7d');

    expect(root.get('profile').value()).to.be.undefined;
  });

  // UTS: objects/unit/RTPO7e/value-unresolvable-null-0
  it('RTPO7e - value() returns undefined on resolution failure', async function () {
    const { root } = await setupSyncedChannel('test-RTPO7e');

    expect(root.get('nonexistent').get('deep').value()).to.be.undefined;
  });

  // UTS: objects/unit/RTPO7/value-bytes-0
  it('RTPO7 - value() returns bytes for binary entry', async function () {
    const { root } = await setupSyncedChannel('test-RTPO7-bytes');

    const val = root.get('avatar').value();
    expect(val).to.exist;
    const bytes = new Uint8Array(val as ArrayBuffer);
    expect(Array.from(bytes)).to.deep.equal([1, 2, 3]);
  });

  // UTS: objects/unit/RTPO8/instance-live-object-0
  it('RTPO8 - instance() returns Instance for LiveObject', async function () {
    const { root } = await setupSyncedChannel('test-RTPO8');

    const counterInst = root.get('score').instance();
    expect(counterInst).to.exist;
    expect(counterInst!.id).to.equal('counter:score@1000');

    const mapInst = root.get('profile').instance();
    expect(mapInst).to.exist;
    expect(mapInst!.id).to.equal('map:profile@1000');
  });

  // UTS: objects/unit/RTPO8f/instance-primitive-wrapped-0
  it('RTPO8f - instance() returns Instance for primitive', async function () {
    const { root } = await setupSyncedChannel('test-RTPO8f');

    const nameInst = root.get('name').instance();
    expect(nameInst).to.exist;
    expect(nameInst!.id).to.be.undefined;
    expect(nameInst!.value()).to.equal('Alice');
  });

  // UTS: objects/unit/RTPO9/entries-yields-pairs-0
  it('RTPO9 - entries() yields [key, PathObject] pairs', async function () {
    const { root } = await setupSyncedChannel('test-RTPO9');

    const entries: Record<string, string> = {};
    for (const [key, pathObj] of root.entries()) {
      entries[key as string] = pathObj.path();
    }
    expect(entries['name']).to.equal('name');
    expect(entries['profile']).to.equal('profile');
    expect(Object.keys(entries)).to.have.length(7);
  });

  // UTS: objects/unit/RTPO9d/entries-non-map-empty-0
  it('RTPO9d - entries() returns empty iterator for non-LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTPO9d');

    const entries = [...root.get('score').entries()];
    expect(entries).to.have.length(0);
  });

  // UTS: objects/unit/RTPO10/keys-returns-array-0
  it('RTPO10 - keys() returns key strings for LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTPO10');

    const keys = [...root.keys()];
    expect(keys).to.be.an('array');
    expect(keys).to.have.length(7);
    expect(keys).to.include('name');
    expect(keys).to.include('profile');
    expect(keys).to.include('score');
  });

  // UTS: objects/unit/RTPO10d/keys-non-map-empty-0
  it('RTPO10d - keys() returns empty iterator for non-LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTPO10d');

    const keys = [...root.get('score').keys()];
    expect(keys).to.be.an('array');
    expect(keys).to.have.length(0);
  });

  // UTS: objects/unit/RTPO11/values-returns-array-0
  it('RTPO11 - values() returns PathObject children for LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTPO11');

    const vals = [...root.values()];
    expect(vals).to.be.an('array');
    expect(vals).to.have.length(7);
    const paths: Record<string, boolean> = {};
    for (const v of vals) {
      paths[v.path()] = true;
    }
    expect(paths['name']).to.equal(true);
    expect(paths['profile']).to.equal(true);
    expect(paths['score']).to.equal(true);
  });

  // UTS: objects/unit/RTPO11d/values-non-map-empty-0
  it('RTPO11d - values() returns empty iterator for non-LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTPO11d');

    const vals = [...root.get('score').values()];
    expect(vals).to.be.an('array');
    expect(vals).to.have.length(0);
  });

  // UTS: objects/unit/RTPO12/size-count-0
  it('RTPO12 - size() returns non-tombstoned count', async function () {
    const { root } = await setupSyncedChannel('test-RTPO12');

    expect(root.size()).to.equal(7);
    expect(root.get('profile').size()).to.equal(3);
  });

  // UTS: objects/unit/RTPO12c/size-non-map-null-0
  it('RTPO12c - size() returns undefined for non-LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTPO12c');

    expect(root.get('score').size()).to.be.undefined;
    expect(root.get('name').size()).to.be.undefined;
  });

  // UTS: objects/unit/RTPO13/compact-recursive-0
  it('RTPO13 - compact() recursively compacts LiveMap tree', async function () {
    const { root } = await setupSyncedChannel('test-RTPO13');

    const result = root.compact() as any;
    expect(result['name']).to.equal('Alice');
    expect(result['age']).to.equal(30);
    expect(result['active']).to.equal(true);
    expect(result['score']).to.equal(100);
    expect(result['data']).to.deep.equal({ tags: ['a', 'b'] });
    const avatarBytes = new Uint8Array(result['avatar']);
    expect(Array.from(avatarBytes)).to.deep.equal([1, 2, 3]);
    expect(result['profile']['email']).to.equal('alice@example.com');
    expect(result['profile']['nested_counter']).to.equal(5);
    expect(result['profile']['prefs']['theme']).to.equal('dark');
  });

  // UTS: objects/unit/RTPO13c5/compact-cycle-detection-0
  it('RTPO13c5 - compact() handles cycles via shared reference', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO13c5');

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO13c5', [
        buildMapSet('map:prefs@1000', 'back_ref', { objectId: 'map:profile@1000' }, 't:1', 'remote'),
      ]),
    );
    // Quiescence barrier (UTS RTPO13c5/RTPO14): the MAP_SET arrives as an inbound OBJECT message,
    // applied asynchronously — poll until it lands before the positive read.
    await pollUntil(() => [...root.get('profile').get('prefs').keys()].includes('back_ref'));

    const result = root.get('profile').compact() as any;
    expect(result['prefs']['back_ref']).to.equal(result);
  });

  // UTS: objects/unit/RTPO13c/compact-counter-0
  it('RTPO13c - compact() returns number for LiveCounter', async function () {
    const { root } = await setupSyncedChannel('test-RTPO13c');

    expect(root.get('score').compact()).to.equal(100);
  });

  // UTS: objects/unit/RTPO14/compact-json-0
  it('RTPO14 - compactJson() encodes cycles as objectId', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTPO14');

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTPO14', [
        buildMapSet('map:prefs@1000', 'back_ref', { objectId: 'map:profile@1000' }, 't:1', 'remote'),
      ]),
    );
    // Quiescence barrier (UTS RTPO13c5/RTPO14): the MAP_SET arrives as an inbound OBJECT message,
    // applied asynchronously — poll until it lands before the positive read.
    await pollUntil(() => [...root.get('profile').get('prefs').keys()].includes('back_ref'));

    const result = root.get('profile').compactJson() as any;
    expect(result['prefs']['back_ref']).to.deep.equal({ objectId: 'map:profile@1000' });
  });

  // UTS: objects/unit/RTPO14/compact-json-bytes-0
  it('RTPO14 - compactJson() encodes bytes as base64 string', async function () {
    const { root } = await setupSyncedChannel('test-RTPO14-bytes');

    const result = root.compactJson() as any;
    expect(result['avatar']).to.equal('AQID');
  });

  // UTS: objects/unit/RTPO3/path-resolution-walk-0
  it('RTPO3 - path resolution walks through LiveMaps', async function () {
    const { root } = await setupSyncedChannel('test-RTPO3');

    expect(root.value()).to.be.undefined;
    expect(root.get('profile').get('prefs').get('theme').value()).to.equal('dark');
  });

  // UTS: objects/unit/RTPO3a1/intermediate-not-map-0
  it('RTPO3a1 - resolution fails if intermediate is not LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTPO3a1');

    expect(root.get('score').get('something').value()).to.be.undefined;
  });

  // UTS: objects/unit/RTPO3c1/read-null-on-failure-0
  it('RTPO3c1 - read operations return undefined on resolution failure', async function () {
    const { root } = await setupSyncedChannel('test-RTPO3c1');

    expect(root.get('nonexistent').value()).to.be.undefined;
    expect(root.get('nonexistent').instance()).to.be.undefined;
    expect(root.get('nonexistent').size()).to.be.undefined;
    expect(root.get('nonexistent').compact()).to.be.undefined;
  });
});
