/**
 * UTS: PublicAPI::ObjectMessage and PublicAPI::ObjectOperation Tests
 *
 * Spec points: PAOM1, PAOM2, PAOM3, PAOOP1, PAOOP2, PAOOP3
 * Source: uts/objects/unit/public_object_message.md
 *
 * Tests the construction of PublicAPI::ObjectMessage from an internal
 * ObjectMessage, and the construction of PublicAPI::ObjectOperation from
 * an internal ObjectOperation. These are user-facing types exposed to
 * subscription listeners so that user code can inspect the metadata of
 * the message that triggered an object change.
 *
 * Deviations from UTS spec:
 * - toUserFacingObjectData adds a deprecated 'value' convenience field to the
 *   public ObjectData (see deviations.md). The numeric-to-'lww' semantics
 *   mapping is the idiomatic JS rendering of the ObjectsMapSemantics.LWW enum
 *   member (OMP2) per the UTS enum-value convention (spec uts/README.md) —
 *   the spec pseudo-code's "LWW" is the symbolic enum name, not a string
 *   contract.
 * - ably-js omits undefined fields rather than setting null — the sanctioned
 *   null/undefined convention (spec uts/README.md). Assertions use
 *   .to.be.undefined instead of == null where appropriate.
 */

import { expect } from 'chai';
import { restoreAll } from '../../helpers';
import { setupSyncedChannel, OBJ_OP, MAP_SEMANTICS_LWW } from '../helpers/standard_test_pool';
import { ObjectMessage } from '../../../../src/plugins/liveobjects/objectmessage';

/**
 * Helper to create an ObjectMessage from raw values, using the client's Utils/MessageEncoding.
 */
function makeObjectMessage(client: any, values: any): ObjectMessage {
  return ObjectMessage.fromValues(values, client.Utils, client.MessageEncoding);
}

describe('uts/objects/unit/public_object_message', function () {
  afterEach(function () {
    restoreAll();
  });

  // =========================================================================
  // PAOM3 - Construction copies all fields from source ObjectMessage
  // =========================================================================

  // UTS: objects/unit/PAOM3/construction-all-fields-0
  it('PAOM3 - construction copies all fields from source ObjectMessage', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOM3-all-fields');

    const source = makeObjectMessage(client, {
      id: 'msg-id-1',
      clientId: 'client-1',
      connectionId: 'conn-1',
      timestamp: 1700000000000,
      serial: '01',
      serialTimestamp: 1700000001000,
      siteCode: 'site1',
      extras: { key: 'value' },
      operation: {
        action: OBJ_OP.MAP_SET,
        objectId: 'map:abc@1000',
        mapSet: { key: 'name', value: { string: 'Alice' } },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);

    expect(publicMsg.id).to.equal('msg-id-1');
    expect(publicMsg.clientId).to.equal('client-1');
    expect(publicMsg.connectionId).to.equal('conn-1');
    expect(publicMsg.timestamp).to.equal(1700000000000);
    expect(publicMsg.channel).to.equal('test-PAOM3-all-fields');
    expect(publicMsg.serial).to.equal('01');
    expect(publicMsg.serialTimestamp).to.equal(1700000001000);
    expect(publicMsg.siteCode).to.equal('site1');
    expect(publicMsg.extras).to.deep.equal({ key: 'value' });
    expect(publicMsg.operation).to.not.be.undefined;
    expect(publicMsg.operation.action).to.equal('map.set');
    expect(publicMsg.operation.objectId).to.equal('map:abc@1000');
    expect(publicMsg.operation.mapSet!.key).to.equal('name');
    expect(publicMsg.operation.mapSet!.value.string).to.equal('Alice');
  });

  // UTS: objects/unit/PAOM3/construction-optional-fields-missing-0
  it('PAOM3 - construction with optional fields missing', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOM3-optional');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);

    expect(publicMsg.id).to.be.undefined;
    expect(publicMsg.clientId).to.be.undefined;
    expect(publicMsg.connectionId).to.be.undefined;
    expect(publicMsg.timestamp).to.be.undefined;
    expect(publicMsg.channel).to.equal('test-PAOM3-optional');
    expect(publicMsg.serial).to.be.undefined;
    expect(publicMsg.serialTimestamp).to.be.undefined;
    expect(publicMsg.siteCode).to.be.undefined;
    expect(publicMsg.extras).to.be.undefined;
    expect(publicMsg.operation).to.not.be.undefined;
    expect(publicMsg.operation.action).to.equal('counter.inc');
  });

  // UTS: objects/unit/PAOM3/channel-from-channel-name-0
  it('PAOM3b - channel is set from channel.name, not from ObjectMessage', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOM3-channel');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.OBJECT_DELETE,
        objectId: 'counter:abc@1000',
        objectDelete: {},
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);

    expect(publicMsg.channel).to.equal('test-PAOM3-channel');
  });

  // =========================================================================
  // PAOOP3a - Operation field copying per action type
  // =========================================================================

  // UTS: objects/unit/PAOOP3/map-set-copies-fields-0
  it('PAOOP3a - MAP_SET copies mapSet, omits unrelated fields', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-mapset');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.MAP_SET,
        objectId: 'map:abc@1000',
        mapSet: { key: 'color', value: { string: 'blue' } },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('map.set');
    expect(publicOp.objectId).to.equal('map:abc@1000');
    expect(publicOp.mapSet!.key).to.equal('color');
    expect(publicOp.mapSet!.value.string).to.equal('blue');
    expect(publicOp.mapCreate).to.be.undefined;
    expect(publicOp.mapRemove).to.be.undefined;
    expect(publicOp.counterCreate).to.be.undefined;
    expect(publicOp.counterInc).to.be.undefined;
    expect(publicOp.objectDelete).to.be.undefined;
    expect(publicOp.mapClear).to.be.undefined;
  });

  // UTS: objects/unit/PAOOP3/map-remove-copies-fields-0
  it('PAOOP3a - MAP_REMOVE copies mapRemove, omits unrelated fields', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-mapremove');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.MAP_REMOVE,
        objectId: 'map:abc@1000',
        mapRemove: { key: 'old-key' },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('map.remove');
    expect(publicOp.objectId).to.equal('map:abc@1000');
    expect(publicOp.mapRemove!.key).to.equal('old-key');
    expect(publicOp.mapCreate).to.be.undefined;
    expect(publicOp.mapSet).to.be.undefined;
    expect(publicOp.counterCreate).to.be.undefined;
    expect(publicOp.counterInc).to.be.undefined;
    expect(publicOp.objectDelete).to.be.undefined;
    expect(publicOp.mapClear).to.be.undefined;
  });

  // UTS: objects/unit/PAOOP3/counter-inc-copies-fields-0
  it('PAOOP3a - COUNTER_INC copies counterInc, omits unrelated fields', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-counterinc');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 42 },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('counter.inc');
    expect(publicOp.objectId).to.equal('counter:abc@1000');
    expect(publicOp.counterInc!.number).to.equal(42);
    expect(publicOp.mapCreate).to.be.undefined;
    expect(publicOp.mapSet).to.be.undefined;
    expect(publicOp.mapRemove).to.be.undefined;
    expect(publicOp.counterCreate).to.be.undefined;
    expect(publicOp.objectDelete).to.be.undefined;
    expect(publicOp.mapClear).to.be.undefined;
  });

  // UTS: objects/unit/PAOOP3/object-delete-copies-fields-0
  it('PAOOP3a - OBJECT_DELETE copies objectDelete, omits unrelated fields', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-objdelete');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.OBJECT_DELETE,
        objectId: 'counter:abc@1000',
        objectDelete: {},
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('object.delete');
    expect(publicOp.objectId).to.equal('counter:abc@1000');
    expect(publicOp.objectDelete).to.not.be.undefined;
    expect(publicOp.mapCreate).to.be.undefined;
    expect(publicOp.mapSet).to.be.undefined;
    expect(publicOp.mapRemove).to.be.undefined;
    expect(publicOp.counterCreate).to.be.undefined;
    expect(publicOp.counterInc).to.be.undefined;
    expect(publicOp.mapClear).to.be.undefined;
  });

  // UTS: objects/unit/PAOOP3/map-clear-copies-fields-0
  it('PAOOP3a - MAP_CLEAR copies mapClear, omits unrelated fields', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-mapclear');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.MAP_CLEAR,
        objectId: 'map:abc@1000',
        mapClear: {},
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('map.clear');
    expect(publicOp.objectId).to.equal('map:abc@1000');
    expect(publicOp.mapClear).to.not.be.undefined;
    expect(publicOp.mapCreate).to.be.undefined;
    expect(publicOp.mapSet).to.be.undefined;
    expect(publicOp.mapRemove).to.be.undefined;
    expect(publicOp.counterCreate).to.be.undefined;
    expect(publicOp.counterInc).to.be.undefined;
    expect(publicOp.objectDelete).to.be.undefined;
  });

  // =========================================================================
  // PAOOP3b/c - Create payload resolution
  // =========================================================================

  // UTS: objects/unit/PAOOP3/map-create-direct-0
  it('PAOOP3b1 - MAP_CREATE with mapCreate directly present', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-mapcreate-direct');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.MAP_CREATE,
        objectId: 'map:new@2000',
        mapCreate: {
          semantics: MAP_SEMANTICS_LWW,
          entries: { key1: { data: { string: 'val1' } } },
        },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('map.create');
    expect(publicOp.objectId).to.equal('map:new@2000');
    expect(publicOp.mapCreate).to.not.be.undefined;
    // ably-js decodes numeric semantics (0) to string ('lww')
    expect(publicOp.mapCreate!.semantics).to.equal('lww');
    expect(publicOp.mapCreate!.entries['key1'].data!.string).to.equal('val1');
    expect(publicOp.counterCreate).to.be.undefined;
  });

  // UTS: objects/unit/PAOOP3/map-create-from-with-object-id-0
  it('PAOOP3b2 - MAP_CREATE resolved from mapCreateWithObjectId', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-mapcreate-derived');

    const derivedMapCreate = {
      semantics: MAP_SEMANTICS_LWW,
      entries: { x: { data: { number: 10 } } },
    };

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.MAP_CREATE,
        objectId: 'map:derived@3000',
        mapCreateWithObjectId: {
          objectId: 'map:derived@3000',
          initialValue: JSON.stringify({ map: derivedMapCreate }),
          nonce: 'test-nonce',
          _derivedFrom: derivedMapCreate,
        },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('map.create');
    expect(publicOp.objectId).to.equal('map:derived@3000');
    expect(publicOp.mapCreate).to.not.be.undefined;
    // ably-js decodes numeric semantics (0) to string ('lww')
    expect(publicOp.mapCreate!.semantics).to.equal('lww');
    expect(publicOp.mapCreate!.entries['x'].data!.number).to.equal(10);
    expect(publicOp.counterCreate).to.be.undefined;
  });

  // UTS: objects/unit/PAOOP3/counter-create-from-with-object-id-0
  it('PAOOP3c2 - COUNTER_CREATE resolved from counterCreateWithObjectId', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-countercreate-derived');

    const derivedCounterCreate = { count: 100 };

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.COUNTER_CREATE,
        objectId: 'counter:derived@3000',
        counterCreateWithObjectId: {
          objectId: 'counter:derived@3000',
          initialValue: JSON.stringify({ counter: derivedCounterCreate }),
          nonce: 'test-nonce',
          _derivedFrom: derivedCounterCreate,
        },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('counter.create');
    expect(publicOp.objectId).to.equal('counter:derived@3000');
    expect(publicOp.counterCreate).to.not.be.undefined;
    expect(publicOp.counterCreate!.count).to.equal(100);
    expect(publicOp.mapCreate).to.be.undefined;
  });

  // =========================================================================
  // PAOOP3b3, PAOOP3c3 - Create payloads omitted when neither variant present
  // =========================================================================

  // UTS: objects/unit/PAOOP3/create-payloads-omitted-0
  it('PAOOP3b3/c3 - create payloads omitted when neither variant is present', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-create-omitted');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.MAP_SET,
        objectId: 'map:abc@1000',
        mapSet: { key: 'k', value: { string: 'v' } },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.mapCreate).to.be.undefined;
    expect(publicOp.counterCreate).to.be.undefined;
  });

  // =========================================================================
  // PAOOP3 - Mutual exclusivity: only relevant field per action type
  // =========================================================================

  // UTS: objects/unit/PAOOP3/only-relevant-field-per-action-0
  it('PAOOP3 - only relevant operation field is present per action type', async function () {
    const { channel, client } = await setupSyncedChannel('test-PAOOP3-mutual-exclusivity');

    const source = makeObjectMessage(client, {
      operation: {
        action: OBJ_OP.COUNTER_CREATE,
        objectId: 'counter:new@2000',
        counterCreate: { count: 50 },
      },
    });

    const publicMsg = source.toUserFacingMessage(channel);
    const publicOp = publicMsg.operation;

    expect(publicOp.action).to.equal('counter.create');
    expect(publicOp.objectId).to.equal('counter:new@2000');
    expect(publicOp.counterCreate).to.not.be.undefined;
    expect(publicOp.counterCreate!.count).to.equal(50);
    expect(publicOp.mapCreate).to.be.undefined;
    expect(publicOp.mapSet).to.be.undefined;
    expect(publicOp.mapRemove).to.be.undefined;
    expect(publicOp.counterInc).to.be.undefined;
    expect(publicOp.objectDelete).to.be.undefined;
    expect(publicOp.mapClear).to.be.undefined;
  });
});
