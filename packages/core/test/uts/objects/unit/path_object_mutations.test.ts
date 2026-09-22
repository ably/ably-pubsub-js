/**
 * UTS: PathObject Write Operations Tests
 *
 * Spec points: RTPO15-18, RTPO3c2
 * Source: uts/objects/unit/path_object_mutations.md
 *
 * Tests set, remove, increment, decrement on PathObject,
 * and error handling for unresolvable paths and type mismatches.
 */

import { expect } from 'chai';
import { restoreAll } from '../../helpers';
import { setupSyncedChannel } from '../helpers/standard_test_pool';

describe('uts/objects/unit/path_object_mutations', function () {
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTPO15/set-delegates-to-map-0
  it('RTPO15 - set() delegates to LiveMap#set', async function () {
    const { root } = await setupSyncedChannel('test-RTPO15');

    await root.set('name', 'Bob');
    expect(root.get('name').value()).to.equal('Bob');
  });

  // UTS: objects/unit/RTPO15/set-nested-path-0
  it('RTPO15 - set() on nested path', async function () {
    const { root } = await setupSyncedChannel('test-RTPO15-nested');

    await root.get('profile').set('email', 'bob@example.com');
    expect(root.get('profile').get('email').value()).to.equal('bob@example.com');
  });

  // UTS: objects/unit/RTPO15d/set-non-map-throws-0
  it('RTPO15d - set() on non-LiveMap throws 92007', async function () {
    const { root } = await setupSyncedChannel('test-RTPO15d');

    try {
      await root.get('score').set('key', 'value');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92007);
    }
  });

  // UTS: objects/unit/RTPO16/remove-delegates-to-map-0
  it('RTPO16 - remove() delegates to LiveMap#remove', async function () {
    const { root } = await setupSyncedChannel('test-RTPO16');

    await root.remove('name');
    expect(root.get('name').value()).to.be.undefined;
  });

  // UTS: objects/unit/RTPO16d/remove-non-map-throws-0
  it('RTPO16d - remove() on non-LiveMap throws 92007', async function () {
    const { root } = await setupSyncedChannel('test-RTPO16d');

    try {
      await root.get('score').remove('key');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92007);
    }
  });

  // UTS: objects/unit/RTPO17/increment-delegates-to-counter-0
  it('RTPO17 - increment() delegates to LiveCounter#increment', async function () {
    const { root } = await setupSyncedChannel('test-RTPO17');

    await root.get('score').increment(25);
    expect(root.get('score').value()).to.equal(125);
  });

  // UTS: objects/unit/RTPO17/increment-default-amount-0
  it('RTPO17 - increment() defaults to 1', async function () {
    const { root } = await setupSyncedChannel('test-RTPO17-default');

    await root.get('score').increment();
    expect(root.get('score').value()).to.equal(101);
  });

  // UTS: objects/unit/RTPO17d/increment-non-counter-throws-0
  it('RTPO17d - increment() on non-LiveCounter throws 92007', async function () {
    const { root } = await setupSyncedChannel('test-RTPO17d');

    try {
      await root.increment(5);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92007);
    }
  });

  // UTS: objects/unit/RTPO18/decrement-delegates-to-counter-0
  it('RTPO18 - decrement() delegates to LiveCounter#decrement', async function () {
    const { root } = await setupSyncedChannel('test-RTPO18');

    await root.get('score').decrement(10);
    expect(root.get('score').value()).to.equal(90);
  });

  // UTS: objects/unit/RTPO18/decrement-default-amount-0
  it('RTPO18 - decrement() defaults to 1', async function () {
    const { root } = await setupSyncedChannel('test-RTPO18-default');

    await root.get('score').decrement();
    expect(root.get('score').value()).to.equal(99);
  });

  // UTS: objects/unit/RTPO18d/decrement-non-counter-throws-0
  it('RTPO18d - decrement() on non-LiveCounter throws 92007', async function () {
    const { root } = await setupSyncedChannel('test-RTPO18d');

    try {
      await root.decrement(5);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92007);
    }
  });

  // UTS: objects/unit/RTPO3c2/set-unresolvable-throws-0
  it('RTPO3c2 - set() on unresolvable path throws 92005', async function () {
    const { root } = await setupSyncedChannel('test-RTPO3c2-set');

    try {
      await root.get('nonexistent').get('deep').set('key', 'value');
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92005);
      expect(err.statusCode).to.equal(400);
    }
  });

  // UTS: objects/unit/RTPO3c2/increment-unresolvable-throws-0
  it('RTPO3c2 - increment() on unresolvable path throws 92005', async function () {
    const { root } = await setupSyncedChannel('test-RTPO3c2-inc');

    try {
      await root.get('nonexistent').increment(5);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(92005);
      expect(err.statusCode).to.equal(400);
    }
  });
});
