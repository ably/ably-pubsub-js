/**
 * UTS: ObjectId Generation Tests
 *
 * Spec points: RTO14
 * Source: uts/objects/unit/object_id.md
 *
 * Tests the ObjectId generation function: format validation,
 * SHA-256 hashing, base64url encoding, determinism, uniqueness.
 */

import { expect } from 'chai';
import '../../../../src/platform/nodejs';
import { DefaultRest } from '../../../../src/common/lib/client/defaultrest';
import { ObjectId } from '../../../../src/plugins/liveobjects/objectid';
import { restoreAll } from '../../helpers';

const Platform = DefaultRest.Platform;

describe('uts/objects/unit/object_id', function () {
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTO14/objectid-format-counter-0
  it('RTO14 - counter objectId has correct format', function () {
    const id = ObjectId.fromInitialValue(Platform, 'counter', 'test-initial-value', 'test-nonce', 1000);
    const str = id.toString();
    expect(str).to.match(/^counter:.+@1000$/);
    expect(id.type).to.equal('counter');
    expect(id.msTimestamp).to.equal(1000);
    expect(id.hash.length).to.be.greaterThan(0);
  });

  // UTS: objects/unit/RTO14/objectid-format-map-0
  it('RTO14 - map objectId has correct format', function () {
    const id = ObjectId.fromInitialValue(Platform, 'map', 'test-initial-value', 'test-nonce', 1000);
    const str = id.toString();
    expect(str).to.match(/^map:.+@1000$/);
    expect(id.type).to.equal('map');
  });

  // UTS: objects/unit/RTO14/deterministic-0
  it('RTO14 - same inputs produce same objectId', function () {
    const id1 = ObjectId.fromInitialValue(Platform, 'counter', 'value1', 'nonce1', 2000);
    const id2 = ObjectId.fromInitialValue(Platform, 'counter', 'value1', 'nonce1', 2000);
    expect(id1.toString()).to.equal(id2.toString());
  });

  // UTS: objects/unit/RTO14/different-nonce-0
  it('RTO14 - different nonce produces different objectId', function () {
    const id1 = ObjectId.fromInitialValue(Platform, 'counter', 'value1', 'nonce1', 2000);
    const id2 = ObjectId.fromInitialValue(Platform, 'counter', 'value1', 'nonce2', 2000);
    expect(id1.toString()).to.not.equal(id2.toString());
  });

  // UTS: objects/unit/RTO14b/base64url-encoding-0
  it('RTO14 - hash uses base64url encoding without padding', function () {
    const id = ObjectId.fromInitialValue(Platform, 'counter', 'test-value', 'test-nonce', 3000);
    expect(id.hash).to.not.match(/[+/=]/);
    expect(id.hash).to.match(/^[A-Za-z0-9_-]+$/);
  });
});
