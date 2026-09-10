import { __livetype } from '../../../ably';
import { LiveCounter as PublicLiveCounter } from '../../../liveobjects';
import { LiveObject, LiveObjectData, LiveObjectUpdate, LiveObjectUpdateNoop } from './liveobject';
import { CounterInc, ObjectData, ObjectMessage, ObjectOperation, ObjectOperationAction } from './objectmessage';
import { ObjectsOperationSource, RealtimeObject } from './realtimeobject';

export interface LiveCounterData extends LiveObjectData {
  data: number; // RTLC3
}

export interface LiveCounterUpdate extends LiveObjectUpdate {
  update: { amount: number };
  _type: 'LiveCounterUpdate';
}

/** @spec RTLC1, RTLC2 */
export class LiveCounter extends LiveObject<LiveCounterData, LiveCounterUpdate> implements PublicLiveCounter {
  declare readonly [__livetype]: 'LiveCounter'; // type-only, unique symbol to satisfy branded interfaces, no JS emitted

  /**
   * Returns a {@link LiveCounter} instance with a 0 value.
   *
   * @internal
   * @spec RTLC4
   */
  static zeroValue(realtimeObject: RealtimeObject, objectId: string): LiveCounter {
    return new LiveCounter(realtimeObject, objectId);
  }

  /**
   * Returns a {@link LiveCounter} instance based on the provided object state.
   * The provided object state must hold a valid counter object data.
   *
   * @internal
   */
  static fromObjectState(realtimeObject: RealtimeObject, objectMessage: ObjectMessage): LiveCounter {
    const obj = new LiveCounter(realtimeObject, objectMessage.object!.objectId);
    obj.overrideWithObjectState(objectMessage);
    return obj;
  }

  /**
   * @internal
   */
  static createCounterIncMessage(realtimeObject: RealtimeObject, objectId: string, amount: number): ObjectMessage {
    const client = realtimeObject.getClient();

    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new client.ErrorInfo('Counter value increment should be a valid number', 40003, 400);
    }

    const msg = ObjectMessage.fromValues(
      {
        operation: {
          action: ObjectOperationAction.COUNTER_INC, // RTLC12e2
          objectId, // RTLC12e3
          counterInc: { number: amount }, // RTLC12e5
        } as ObjectOperation<ObjectData>,
      },
      client.Utils,
      client.MessageEncoding,
    );

    return msg;
  }

  /** @spec RTLC5 */
  value(): number {
    return this._dataRef.data; // RTLC5c
  }

  /**
   * Send a COUNTER_INC operation to the realtime system to increment a value on this LiveCounter object.
   *
   * The change will be applied locally when the ACK is received from Realtime.
   *
   * @returns A promise which resolves upon receiving the ACK message for the published operation message
   * and applying the operation locally.
   * @spec RTLC12
   */
  async increment(amount: number): Promise<void> {
    const msg = LiveCounter.createCounterIncMessage(this._realtimeObject, this.getObjectId(), amount);
    return this._realtimeObject.publishAndApply([msg]);
  }

  /**
   * An alias for calling {@link LiveCounter.increment | LiveCounter.increment(-amount)}
   */
  async decrement(amount: number): Promise<void> {
    // do an explicit type safety check here before negating the amount value,
    // so we don't unintentionally change the type sent by a user
    if (typeof amount !== 'number' || !Number.isFinite(amount)) {
      throw new this._client.ErrorInfo('Counter value decrement should be a valid number', 40003, 400);
    }

    return this.increment(-amount);
  }

  /**
   * @internal
   * @spec RTLC7
   */
  applyOperation(op: ObjectOperation<ObjectData>, msg: ObjectMessage, source: ObjectsOperationSource): boolean {
    if (op.objectId !== this.getObjectId()) {
      throw new this._client.ErrorInfo(
        `Cannot apply object operation with objectId=${op.objectId}, to this LiveCounter with objectId=${this.getObjectId()}`,
        92000,
        400,
      );
    }

    const opSerial = msg.serial!;
    const opSiteCode = msg.siteCode!;
    if (!this._canApplyOperation(opSerial, opSiteCode)) {
      // _canApplyOperation already logs a warning for malformed serial values; only log
      // the newness-check skip when the serials are well-formed
      if (opSerial && opSiteCode) {
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MICRO,
          'LiveCounter.applyOperation()',
          `skipping ${op.action} op: op serial ${opSerial} <= site serial ${this._siteTimeserials[opSiteCode]}; objectId=${this.getObjectId()}`,
        );
      }
      return false; // RTLC7b
    }

    // RTLC7c
    if (source === ObjectsOperationSource.channel) {
      // should update stored site serial immediately. doesn't matter if we successfully apply the op,
      // as it's important to mark that the op was processed by the object
      this._siteTimeserials[opSiteCode] = opSerial;
    }

    if (this.isTombstoned()) {
      // this object is tombstoned so the operation cannot be applied
      return false; // RTLC7e
    }

    let update: LiveCounterUpdate | LiveObjectUpdateNoop;
    switch (op.action) {
      case ObjectOperationAction.COUNTER_CREATE:
        // RTLC7d1
        update = this._applyCounterCreate(op, msg);
        break;

      case ObjectOperationAction.COUNTER_INC:
        if (this._client.Utils.isNil(op.counterInc)) {
          this._logNoPayloadWarning(op);
          return false;
        }
        // RTLC7d5
        update = this._applyCounterInc(op.counterInc, msg);
        break;

      case ObjectOperationAction.OBJECT_DELETE:
        // RTLC7d4
        update = this._applyObjectDelete(msg);
        break;

      default:
        // RTLC7d3 - log a warning and discard the message without taking any further action
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MAJOR,
          'LiveCounter.applyOperation()',
          `object operation message received with unsupported action, skipping message; action=${op.action}, objectId=${this.getObjectId()}`,
        );
        return false;
    }

    this.notifyUpdated(update); // RTLC7d1a, RTLC7d5a, RTLC7d4a
    return true; // RTLC7d1b, RTLC7d5b, RTLC7d4b
  }

  /**
   * @internal
   * @spec RTLC6
   */
  overrideWithObjectState(objectMessage: ObjectMessage): LiveCounterUpdate | LiveObjectUpdateNoop {
    const objectState = objectMessage.object;
    if (objectState == null) {
      throw new this._client.ErrorInfo(`Missing object state; LiveCounter objectId=${this.getObjectId()}`, 92000, 400);
    }

    if (objectState.objectId !== this.getObjectId()) {
      throw new this._client.ErrorInfo(
        `Invalid object state: object state objectId=${objectState.objectId}; LiveCounter objectId=${this.getObjectId()}`,
        92000,
        400,
      );
    }

    if (!this._client.Utils.isNil(objectState.createOp)) {
      // it is expected that create operation can be missing in the object state, so only validate it when it exists
      if (objectState.createOp.objectId !== this.getObjectId()) {
        throw new this._client.ErrorInfo(
          `Invalid object state: object state createOp objectId=${objectState.createOp?.objectId}; LiveCounter objectId=${this.getObjectId()}`,
          92000,
          400,
        );
      }

      if (objectState.createOp.action !== ObjectOperationAction.COUNTER_CREATE) {
        throw new this._client.ErrorInfo(
          `Invalid object state: object state createOp action=${objectState.createOp?.action}; LiveCounter objectId=${this.getObjectId()}`,
          92000,
          400,
        );
      }
    }

    // object's site serials are still updated even if it is tombstoned, so always use the site serials received from the operation.
    // should default to empty map if site serials do not exist on the object state, so that any future operation may be applied to this object.
    this._siteTimeserials = objectState.siteTimeserials ?? {}; // RTLC6a

    if (this.isTombstoned()) {
      // this object is tombstoned. this is a terminal state which can't be overridden. skip the rest of object state message processing
      return { noop: true };
    }

    if (objectState.tombstone) {
      // tombstone this object and ignore the data from the object state message
      return this.tombstone(objectMessage);
    }

    // otherwise override data for this object with data from the object state
    const previousDataRef = this._dataRef;
    this._createOperationIsMerged = false; // RTLC6b
    this._dataRef = { data: objectState.counter?.count ?? 0 }; // RTLC6c
    // RTLC6d
    if (!this._client.Utils.isNil(objectState.createOp)) {
      this._mergeInitialDataFromCreateOperation(objectState.createOp, objectMessage);
    }

    // update will contain the diff between previous value and new value from object state
    const update = this._updateFromDataDiff(previousDataRef, this._dataRef);
    update.objectMessage = objectMessage;

    return update;
  }

  /**
   * @internal
   */
  onGCInterval(): void {
    // nothing to GC for a counter object
    return;
  }

  /** @spec RTLC4 */
  protected _getZeroValueData(): LiveCounterData {
    return { data: 0 };
  }

  protected _updateFromDataDiff(prevDataRef: LiveCounterData, newDataRef: LiveCounterData): LiveCounterUpdate {
    const counterDiff = newDataRef.data - prevDataRef.data;
    return { update: { amount: counterDiff }, _type: 'LiveCounterUpdate' };
  }

  protected _mergeInitialDataFromCreateOperation(
    objectOperation: ObjectOperation<ObjectData>,
    msg: ObjectMessage,
  ): LiveCounterUpdate | LiveObjectUpdateNoop {
    // RTLC16 - resolve counterCreate from either the direct property or the one from which counterCreateWithObjectId was derived
    const counterCreate = objectOperation.counterCreate ?? objectOperation.counterCreateWithObjectId?._derivedFrom;
    const count = counterCreate?.count;

    // RTLC16b - the create op counts as merged even when it carries no count; RTLC8's
    // duplicate-create skip relies on this flag being set once the op has been processed
    this._createOperationIsMerged = true;

    if (this._client.Utils.isNil(count)) {
      // RTLC16d - a create operation without an initial count is a noop (nothing to add per RTLC16a)
      return { noop: true };
    }

    // note that it is intentional to SUM the incoming count from the create op.
    // if we got here, it means that current counter instance is missing the initial value in its data reference,
    // which we're going to add now.
    this._dataRef.data += count; // RTLC16a

    // RTLC16c
    return {
      update: { amount: count },
      objectMessage: msg,
      _type: 'LiveCounterUpdate',
    };
  }

  private _logNoPayloadWarning(op: ObjectOperation<ObjectData>): void {
    // a message with a missing operation payload is malformed; log a warning and discard
    // it without aborting the processing of sibling operations in the same ProtocolMessage
    this._client.Logger.logAction(
      this._client.logger,
      this._client.Logger.LOG_MAJOR,
      'LiveCounter.applyOperation()',
      `no payload found for ${op.action} op, skipping message; objectId=${this.getObjectId()}`,
    );
  }

  private _applyCounterCreate(
    op: ObjectOperation<ObjectData>,
    msg: ObjectMessage,
  ): LiveCounterUpdate | LiveObjectUpdateNoop {
    if (this._createOperationIsMerged) {
      // There can't be two different create operation for the same object id, because the object id
      // fully encodes that operation. This means we can safely ignore any new incoming create operations
      // if we already merged it once.
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MICRO,
        'LiveCounter._applyCounterCreate()',
        `skipping applying COUNTER_CREATE op on a counter instance as it was already applied before; objectId=${this.getObjectId()}`,
      );
      return { noop: true };
    }

    return this._mergeInitialDataFromCreateOperation(op, msg);
  }

  /** @spec RTLC9, RTLC9a2 */
  private _applyCounterInc(op: CounterInc, msg: ObjectMessage): LiveCounterUpdate | LiveObjectUpdateNoop {
    if (this._client.Utils.isNil(op.number)) {
      // RTLC9h - a COUNTER_INC without a number is a noop
      return { noop: true };
    }

    this._dataRef.data += op.number; // RTLC9f
    return {
      update: { amount: op.number }, // RTLC9g
      objectMessage: msg,
      _type: 'LiveCounterUpdate',
    };
  }
}
