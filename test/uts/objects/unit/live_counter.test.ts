/**
 * UTS: LiveCounter Tests
 *
 * Spec points: RTLC1, RTLC3, RTLC4, RTLC6, RTLC7, RTLC8, RTLC9, RTLC14, RTLC16, RTLO3, RTLO4a, RTLO4b4d, RTLO4b4e, RTLO4e, RTLO5, RTLO6
 * Source: uts/objects/unit/live_counter.md
 *
 * Tests the LiveCounter CRDT data structure: increment, create merge,
 * replaceData, tombstoning, serial-based newness checks, and diff calculation.
 */

import { expect } from 'chai';
import { restoreAll, flushAsync } from '../../helpers';
import {
  setupSyncedChannel,
  buildObjectMessage,
  buildObjectSyncMessage,
  buildCounterInc,
  buildCounterCreate,
  buildObjectState,
  buildObjectDelete,
  OBJ_OP,
  PM_ACTION,
  HAS_OBJECTS,
} from '../helpers/standard_test_pool';
import { LiveCounter } from '../../../../src/plugins/liveobjects/livecounter';
import { ObjectMessage } from '../../../../src/plugins/liveobjects/objectmessage';
import { ObjectsOperationSource } from '../../../../src/plugins/liveobjects/realtimeobject';

/**
 * Helper to get the RealtimeObject from a channel.
 */
function getRealtimeObject(channel: any): any {
  return channel._object;
}

/**
 * Helper to get a LiveObject from the pool by objectId.
 */
function getFromPool(channel: any, objectId: string): any {
  return getRealtimeObject(channel).getPool().get(objectId);
}

/**
 * Helper to create a zero-value LiveCounter with a given objectId.
 * Uses the RealtimeObject from the channel to satisfy the constructor requirement.
 */
function createZeroCounter(channel: any, objectId: string): LiveCounter {
  const realtimeObject = getRealtimeObject(channel);
  return LiveCounter.zeroValue(realtimeObject, objectId);
}

/**
 * Helper to create an ObjectMessage from values, using the client's Utils/MessageEncoding.
 */
function makeObjectMessage(client: any, values: any): ObjectMessage {
  return ObjectMessage.fromValues(values, client.Utils, client.MessageEncoding);
}

/**
 * Helper to capture the update passed to notifyUpdated() during applyOperation().
 * Since applyOperation() returns boolean, we intercept notifyUpdated to capture the
 * internal update object for assertions on objectMessage, tombstone, etc.
 */
function captureNotifyUpdated(counter: LiveCounter): { getUpdate: () => any } {
  let capturedUpdate: any = undefined;
  const origNotify = (counter as any).notifyUpdated.bind(counter);
  (counter as any).notifyUpdated = (update: any) => {
    capturedUpdate = update;
    origNotify(update);
  };
  return {
    getUpdate: () => capturedUpdate,
  };
}

describe('uts/objects/unit/live_counter', function () {
  afterEach(function () {
    restoreAll();
  });

  // =========================================================================
  // RTLC4 - Zero-value LiveCounter
  // =========================================================================

  // UTS: objects/unit/RTLC4/zero-value-0
  it('RTLC4 - zero value state', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC4');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    expect((counter as any)._dataRef.data).to.equal(0);
    expect(counter.getObjectId()).to.equal('counter:abc@1000');
    expect(counter.isTombstoned()).to.equal(false);
    expect(counter.tombstonedAt()).to.be.undefined;
    expect((counter as any)._createOperationIsMerged).to.equal(false);
    expect((counter as any)._siteTimeserials).to.deep.equal({});
  });

  // =========================================================================
  // RTLC9 - COUNTER_INC operations
  // =========================================================================

  // UTS: objects/unit/RTLC9/counter-inc-basic-0
  it('RTLC9 - COUNTER_INC adds number to data', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC9-basic');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    const capture = captureNotifyUpdated(counter);
    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect((counter as any)._dataRef.data).to.equal(5);
    expect(result).to.equal(true);
    const update = capture.getUpdate();
    expect(update.noop).to.not.equal(true);
    expect(update.update.amount).to.equal(5);
    expect(update.objectMessage).to.equal(msg);
  });

  // UTS: objects/unit/RTLC9/counter-inc-negative-0
  it('RTLC9 - COUNTER_INC with negative number', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC9-neg');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    const capture = captureNotifyUpdated(counter);
    // Pre-set state
    (counter as any)._dataRef.data = 10;
    (counter as any)._siteTimeserials = { site1: '00' };

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: -3 },
      },
    });

    counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect((counter as any)._dataRef.data).to.equal(7);
    const update = capture.getUpdate();
    expect(update.update.amount).to.equal(-3);
    expect(update.objectMessage).to.equal(msg);
  });

  // UTS: objects/unit/RTLC9/counter-inc-missing-number-0
  it('RTLC9 - COUNTER_INC with missing number is a noop', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC9-missing');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    (counter as any)._dataRef.data = 10;
    const capture = captureNotifyUpdated(counter);

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: {},
      },
    });

    counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    // RTLC9h - the operation is a noop: data unchanged, noop update emitted
    expect((counter as any)._dataRef.data).to.equal(10);
    expect(capture.getUpdate().noop).to.equal(true);
  });

  // UTS: objects/unit/RTLC9/counter-inc-accumulate-0
  it('RTLC9 - Multiple COUNTER_INC operations accumulate', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC9-accum');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const msgs = [
      { serial: '01', siteCode: 'site1', amount: 10 },
      { serial: '02', siteCode: 'site1', amount: 20 },
      { serial: '01', siteCode: 'site2', amount: -5 },
    ];

    for (const m of msgs) {
      const msg = makeObjectMessage(client, {
        serial: m.serial,
        siteCode: m.siteCode,
        operation: {
          action: OBJ_OP.COUNTER_INC,
          objectId: 'counter:abc@1000',
          counterInc: { number: m.amount },
        },
      });
      counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);
    }

    expect((counter as any)._dataRef.data).to.equal(25);
  });

  // =========================================================================
  // RTLC8, RTLC16 - COUNTER_CREATE operations
  // =========================================================================

  // UTS: objects/unit/RTLC8/counter-create-merge-0
  it('RTLC8 - COUNTER_CREATE merges initial count', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC8-merge');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    const capture = captureNotifyUpdated(counter);

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_CREATE,
        objectId: 'counter:abc@1000',
        counterCreate: { count: 42 },
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect((counter as any)._dataRef.data).to.equal(42);
    expect((counter as any)._createOperationIsMerged).to.equal(true);
    expect(result).to.equal(true);
    const update = capture.getUpdate();
    expect(update.update.amount).to.equal(42);
    expect(update.objectMessage).to.equal(msg);
  });

  // UTS: objects/unit/RTLC8/counter-create-already-merged-0
  it('RTLC8 - COUNTER_CREATE noop when already merged', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC8-already');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    const capture = captureNotifyUpdated(counter);
    (counter as any)._dataRef.data = 42;
    (counter as any)._createOperationIsMerged = true;
    (counter as any)._siteTimeserials = { site1: '00' };

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_CREATE,
        objectId: 'counter:abc@1000',
        counterCreate: { count: 99 },
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect((counter as any)._dataRef.data).to.equal(42);
    // applyOperation returns true even for noop (the noop is internal to notifyUpdated)
    // The operation was "processed" (serial check passed), even if the create was skipped
    expect(result).to.equal(true);
    expect(capture.getUpdate()).to.deep.equal({ noop: true });
  });

  // UTS: objects/unit/RTLC16/counter-create-no-count-0
  it('RTLC16 - COUNTER_CREATE with missing count is a noop', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC16-no-count');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    const capture = captureNotifyUpdated(counter);

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_CREATE,
        objectId: 'counter:abc@1000',
        counterCreate: {},
      },
    });

    counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    // RTLC16d - data unchanged, create op still marked merged (RTLC16b), noop update emitted
    expect((counter as any)._dataRef.data).to.equal(0);
    expect((counter as any)._createOperationIsMerged).to.equal(true);
    expect(capture.getUpdate().noop).to.equal(true);
  });

  // =========================================================================
  // RTLO4a - canApplyOperation serial checks
  // =========================================================================

  // UTS: objects/unit/RTLO4a/apply-empty-site-serial-0
  it('RTLO4a - canApplyOperation allows when siteSerial is empty', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLO4a-empty');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect(result).to.not.equal(false);
    expect((counter as any)._dataRef.data).to.equal(5);
  });

  // UTS: objects/unit/RTLO4a/reject-stale-serial-0
  it('RTLO4a - canApplyOperation rejects stale serial', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLO4a-stale');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    (counter as any)._siteTimeserials = { site1: '05' };
    (counter as any)._dataRef.data = 10;

    const msg = makeObjectMessage(client, {
      serial: '03',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 99 },
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect(result).to.equal(false);
    expect((counter as any)._dataRef.data).to.equal(10);
  });

  // UTS: objects/unit/RTLO4a/reject-equal-serial-0
  it('RTLO4a - canApplyOperation rejects equal serial', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLO4a-equal');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    (counter as any)._siteTimeserials = { site1: '05' };
    (counter as any)._dataRef.data = 10;

    const msg = makeObjectMessage(client, {
      serial: '05',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 99 },
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect(result).to.equal(false);
    expect((counter as any)._dataRef.data).to.equal(10);
  });

  // UTS: objects/unit/RTLO4a/warn-invalid-serial-0
  it('RTLO4a - operations with empty serial or siteCode are not applied', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLO4a-invalid');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    // Empty serial
    const msg1 = makeObjectMessage(client, {
      serial: '',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    const result1 = counter.applyOperation(msg1.operation!, msg1, ObjectsOperationSource.channel);

    // Empty siteCode
    const msg2 = makeObjectMessage(client, {
      serial: '01',
      siteCode: '',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    const result2 = counter.applyOperation(msg2.operation!, msg2, ObjectsOperationSource.channel);

    // RTLO4a3 - invalid serial values: log a warning and do not apply
    expect(result1).to.equal(false);
    expect(result2).to.equal(false);
    expect((counter as any)._dataRef.data).to.equal(0);
  });

  // =========================================================================
  // RTLC7c - Source-dependent siteTimeserials updates
  // =========================================================================

  // UTS: objects/unit/RTLC7c/channel-source-updates-serials-0
  it('RTLC7c - CHANNEL source updates siteTimeserials', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC7c-channel');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect((counter as any)._siteTimeserials['site1']).to.equal('01');
  });

  // UTS: objects/unit/RTLC7c/local-source-no-serial-update-0
  it('RTLC7c - LOCAL source does not update siteTimeserials', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC7c-local');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.local);

    expect((counter as any)._siteTimeserials).to.deep.equal({});
    expect((counter as any)._dataRef.data).to.equal(5);
  });

  // =========================================================================
  // RTLC7g - applyOperation return value
  // =========================================================================

  // UTS: objects/unit/RTLC7g/apply-returns-true-0
  it('RTLC7g - applyOperation returns true on success', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC7g');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);
    expect(result).to.equal(true);
  });

  // =========================================================================
  // RTLO4e, RTLO5 - OBJECT_DELETE tombstones counter
  // =========================================================================

  // UTS: objects/unit/RTLO5/object-delete-tombstones-0
  it('RTLO5 - OBJECT_DELETE tombstones counter', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLO5');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    const capture = captureNotifyUpdated(counter);
    (counter as any)._dataRef.data = 42;
    (counter as any)._siteTimeserials = { site1: '00' };

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      serialTimestamp: 1700000000000,
      operation: {
        action: OBJ_OP.OBJECT_DELETE,
        objectId: 'counter:abc@1000',
        objectDelete: {},
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect(counter.isTombstoned()).to.equal(true);
    expect((counter as any)._dataRef.data).to.equal(0);
    expect(counter.tombstonedAt()).to.equal(1700000000000);
    expect(result).to.equal(true);
    const update = capture.getUpdate();
    expect(update.update.amount).to.equal(-42);
    expect(update.tombstone).to.equal(true);
    expect(update.objectMessage).to.equal(msg);
  });

  // UTS: objects/unit/RTLO5/tombstone-zero-value-counter-emits-update-0
  // Complements object-delete-tombstones-0 (which tombstones a populated counter). Here the
  // counter data is already 0, so the tombstone diff (previousData 0, newData 0) is a zero delta.
  // Per the RTLC14c tombstone carve-out (RTLO4e5) this update must NOT be marked as a no-op — it
  // must still be delivered so the RTLO4b4c3c listener teardown runs.
  it('RTLO5 - OBJECT_DELETE on an already-zero counter emits a non-noop tombstone update', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLO5-zero');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    const capture = captureNotifyUpdated(counter);
    (counter as any)._dataRef.data = 0;
    (counter as any)._siteTimeserials = { site1: '00' };

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      serialTimestamp: 1700000000000,
      operation: {
        action: OBJ_OP.OBJECT_DELETE,
        objectId: 'counter:abc@1000',
        objectDelete: {},
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect(counter.isTombstoned()).to.equal(true);
    expect((counter as any)._dataRef.data).to.equal(0);
    expect(result).to.equal(true);
    const update = capture.getUpdate();
    // RTLC14c carve-out: the zero-delta tombstone update is NOT a no-op
    expect((update as any).noop).to.not.equal(true);
    expect(update.tombstone).to.equal(true);
    expect(update.update.amount).to.equal(0);
    expect(update.objectMessage).to.equal(msg);
  });

  // =========================================================================
  // RTLC7e - Operations on tombstoned counter are rejected
  // =========================================================================

  // UTS: objects/unit/RTLC7e/tombstoned-reject-ops-0
  it('RTLC7e - Operations on tombstoned counter are rejected', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC7e');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    // Tombstone the counter first
    const deleteMsg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      serialTimestamp: 1700000000000,
      operation: {
        action: OBJ_OP.OBJECT_DELETE,
        objectId: 'counter:abc@1000',
        objectDelete: {},
      },
    });
    counter.applyOperation(deleteMsg.operation!, deleteMsg, ObjectsOperationSource.channel);
    expect(counter.isTombstoned()).to.equal(true);

    // Now try to increment
    const incMsg = makeObjectMessage(client, {
      serial: '02',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 5 },
      },
    });

    const result = counter.applyOperation(incMsg.operation!, incMsg, ObjectsOperationSource.channel);

    expect(result).to.equal(false);
    expect((counter as any)._dataRef.data).to.equal(0);
  });

  // =========================================================================
  // RTLO6 - tombstonedAt
  // =========================================================================

  // UTS: objects/unit/RTLO6/tombstoned-at-from-serial-timestamp-0
  it('RTLO6 - tombstonedAt from serialTimestamp', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLO6-serial');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      serialTimestamp: 1700000050000,
      operation: {
        action: OBJ_OP.OBJECT_DELETE,
        objectId: 'counter:abc@1000',
        objectDelete: {},
      },
    });

    counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    expect(counter.tombstonedAt()).to.equal(1700000050000);
  });

  // UTS: objects/unit/RTLO6/tombstoned-at-local-clock-0
  it('RTLO6 - tombstonedAt from local clock when no serialTimestamp', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLO6-clock');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const beforeTime = Date.now();

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      // No serialTimestamp
      operation: {
        action: OBJ_OP.OBJECT_DELETE,
        objectId: 'counter:abc@1000',
        objectDelete: {},
      },
    });

    counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    const afterTime = Date.now();

    expect(counter.tombstonedAt()).to.be.at.least(beforeTime);
    expect(counter.tombstonedAt()).to.be.at.most(afterTime);
  });

  // =========================================================================
  // RTLC7d3 - Unsupported action
  // =========================================================================

  // UTS: objects/unit/RTLC7d3/unsupported-action-0
  it('RTLC7d3 - Unsupported action is discarded without applying', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC7d3');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const msg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.MAP_SET,
        objectId: 'counter:abc@1000',
        mapSet: { key: 'x', value: { string: 'y' } },
      },
    });

    const result = counter.applyOperation(msg.operation!, msg, ObjectsOperationSource.channel);

    // RTLC7d3 - log a warning and discard the message; no data update
    expect(result).to.equal(false);
    expect((counter as any)._dataRef.data).to.equal(0);
  });

  // =========================================================================
  // RTLC6 - replaceData (overrideWithObjectState)
  // =========================================================================

  // UTS: objects/unit/RTLC6/replace-data-basic-0
  it('RTLC6 - replaceData sets data from ObjectState', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC6-basic');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    (counter as any)._dataRef.data = 10;
    (counter as any)._createOperationIsMerged = true;
    (counter as any)._siteTimeserials = { site1: '00' };

    const stateMsg = makeObjectMessage(client, {
      object: {
        objectId: 'counter:abc@1000',
        siteTimeserials: { site2: '05' },
        tombstone: false,
        counter: { count: 50 },
      },
    });

    const update = counter.overrideWithObjectState(stateMsg);

    expect((counter as any)._dataRef.data).to.equal(50);
    expect((counter as any)._siteTimeserials).to.deep.equal({ site2: '05' });
    expect((counter as any)._createOperationIsMerged).to.equal(false);
    expect((update as any).update.amount).to.equal(40);
    expect((update as any).objectMessage).to.equal(stateMsg);
  });

  // UTS: objects/unit/RTLC6/replace-data-with-create-op-0
  it('RTLC6 - replaceData with createOp merges initial value', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC6-create');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const stateMsg = makeObjectMessage(client, {
      object: {
        objectId: 'counter:abc@1000',
        siteTimeserials: { site1: '01' },
        tombstone: false,
        counter: { count: 100 },
        createOp: {
          action: OBJ_OP.COUNTER_CREATE,
          objectId: 'counter:abc@1000',
          counterCreate: { count: 50 },
        },
      },
    });

    const update = counter.overrideWithObjectState(stateMsg);

    expect((counter as any)._dataRef.data).to.equal(150);
    expect((counter as any)._createOperationIsMerged).to.equal(true);
    expect((update as any).update.amount).to.equal(150);
    expect((update as any).objectMessage).to.equal(stateMsg);
  });

  // UTS: objects/unit/RTLC6e/replace-data-tombstoned-noop-0
  it('RTLC6e - replaceData on tombstoned counter is noop', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC6e');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    // Tombstone the counter
    const deleteMsg = makeObjectMessage(client, {
      serial: '00',
      siteCode: 'site1',
      serialTimestamp: 1700000000000,
      operation: {
        action: OBJ_OP.OBJECT_DELETE,
        objectId: 'counter:abc@1000',
        objectDelete: {},
      },
    });
    counter.applyOperation(deleteMsg.operation!, deleteMsg, ObjectsOperationSource.channel);
    expect(counter.isTombstoned()).to.equal(true);

    const stateMsg = makeObjectMessage(client, {
      object: {
        objectId: 'counter:abc@1000',
        siteTimeserials: { site1: '01' },
        tombstone: false,
        counter: { count: 999 },
      },
    });

    const update = counter.overrideWithObjectState(stateMsg);

    expect((counter as any)._dataRef.data).to.equal(0);
    expect((update as any).noop).to.equal(true);
  });

  // UTS: objects/unit/RTLC6f/replace-data-tombstone-flag-0
  it('RTLC6f - replaceData with tombstone flag tombstones counter', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC6f');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    (counter as any)._dataRef.data = 30;

    const stateMsg = makeObjectMessage(client, {
      object: {
        objectId: 'counter:abc@1000',
        siteTimeserials: { site1: '01' },
        tombstone: true,
        counter: { count: 0 },
      },
    });

    const update = counter.overrideWithObjectState(stateMsg);

    expect(counter.isTombstoned()).to.equal(true);
    expect((counter as any)._dataRef.data).to.equal(0);
    expect((update as any).update.amount).to.equal(-30);
    expect((update as any).tombstone).to.equal(true);
    expect((update as any).objectMessage).to.equal(stateMsg);
  });

  // UTS: objects/unit/RTLC6/replace-data-missing-count-0
  it('RTLC6 - replaceData with missing counter.count defaults to 0', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC6-missing');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    (counter as any)._dataRef.data = 42;

    const stateMsg = makeObjectMessage(client, {
      object: {
        objectId: 'counter:abc@1000',
        siteTimeserials: { site1: '01' },
        tombstone: false,
        counter: {},
      },
    });

    const update = counter.overrideWithObjectState(stateMsg);

    expect((counter as any)._dataRef.data).to.equal(0);
    expect((update as any).update.amount).to.equal(-42);
    expect((update as any).objectMessage).to.equal(stateMsg);
  });

  // =========================================================================
  // RTLC14 - Diff calculation
  // =========================================================================

  // UTS: objects/unit/RTLC14/diff-calculation-0
  it('RTLC14 - Diff calculation', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC14');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    (counter as any)._dataRef.data = 20;

    const stateMsg = makeObjectMessage(client, {
      object: {
        objectId: 'counter:abc@1000',
        siteTimeserials: { site1: '01' },
        tombstone: false,
        counter: { count: 75 },
      },
    });

    const update = counter.overrideWithObjectState(stateMsg);

    expect((update as any).update.amount).to.equal(55);
    expect((update as any).objectMessage).to.equal(stateMsg);
  });

  // UTS: objects/unit/RTLC14c/zero-delta-diff-is-noop-0
  it('RTLC14c - Zero-delta diff is a no-op', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC14c');

    const counter = createZeroCounter(channel, 'counter:abc@1000');
    (counter as any)._dataRef.data = 100;

    const stateMsg = makeObjectMessage(client, {
      object: {
        objectId: 'counter:abc@1000',
        siteTimeserials: { site1: '01' },
        tombstone: false,
        counter: { count: 100 },
      },
    });

    const update = counter.overrideWithObjectState(stateMsg);

    // RTLC14c - the computed delta is 0, so the diff collapses to a no-op update
    expect((update as any).noop).to.equal(true);
    expect((counter as any)._dataRef.data).to.equal(100);
  });

  // =========================================================================
  // RTLC8, RTLC16 - COUNTER_CREATE then COUNTER_INC accumulates
  // =========================================================================

  // UTS: objects/unit/RTLC8/create-then-inc-0
  it('RTLC8 - COUNTER_CREATE then COUNTER_INC accumulates', async function () {
    const { channel, client } = await setupSyncedChannel('test-RTLC8-seq');

    const counter = createZeroCounter(channel, 'counter:abc@1000');

    const createMsg = makeObjectMessage(client, {
      serial: '01',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_CREATE,
        objectId: 'counter:abc@1000',
        counterCreate: { count: 100 },
      },
    });
    counter.applyOperation(createMsg.operation!, createMsg, ObjectsOperationSource.channel);

    const incMsg = makeObjectMessage(client, {
      serial: '02',
      siteCode: 'site1',
      operation: {
        action: OBJ_OP.COUNTER_INC,
        objectId: 'counter:abc@1000',
        counterInc: { number: 25 },
      },
    });
    counter.applyOperation(incMsg.operation!, incMsg, ObjectsOperationSource.channel);

    expect((counter as any)._dataRef.data).to.equal(125);
    expect((counter as any)._createOperationIsMerged).to.equal(true);
  });

  // =========================================================================
  // RTLO3 - LiveObject properties initialized correctly
  // =========================================================================

  // UTS: objects/unit/RTLO3/live-object-init-properties-0
  it('RTLO3 - LiveObject properties initialized correctly', async function () {
    const { channel } = await setupSyncedChannel('test-RTLO3');

    const counter = createZeroCounter(channel, 'counter:test@2000');

    expect(counter.getObjectId()).to.equal('counter:test@2000');
    expect((counter as any)._siteTimeserials).to.deep.equal({});
    expect((counter as any)._createOperationIsMerged).to.equal(false);
    expect(counter.isTombstoned()).to.equal(false);
    expect(counter.tombstonedAt()).to.be.undefined;
  });
});
