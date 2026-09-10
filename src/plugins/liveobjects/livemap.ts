import { dequal } from 'dequal';

import { __livetype } from '../../../ably';
import {
  CompactedJsonValue,
  CompactedValue,
  LiveMap as PublicLiveMap,
  LiveObject as PublicLiveObject,
  Primitive,
  Value,
} from '../../../liveobjects';
import { LiveCounter } from './livecounter';
import { LiveCounterValueType } from './livecountervaluetype';
import { LiveMapValueType } from './livemapvaluetype';
import { LiveObject, LiveObjectData, LiveObjectUpdate, LiveObjectUpdateNoop } from './liveobject';
import {
  getObjectDataPrimitive,
  MapRemove,
  MapSet,
  ObjectData,
  ObjectMessage,
  ObjectOperation,
  ObjectOperationAction,
  ObjectsMapEntry,
  ObjectsMapSemantics,
  primitiveToObjectData,
} from './objectmessage';
import { ObjectsOperationSource, RealtimeObject } from './realtimeobject';

export interface ObjectIdObjectData {
  /** A reference to another object, used to support composable object structures. */
  objectId: string;
}

export type LiveMapObjectData = ObjectIdObjectData | Omit<ObjectData, 'objectId'>;

export interface LiveMapEntry {
  tombstone: boolean;
  tombstonedAt: number | undefined;
  timeserial: string | undefined;
  data: LiveMapObjectData | undefined;
}

export interface LiveMapData extends LiveObjectData {
  data: Map<string, LiveMapEntry>; // RTLM3
}

export interface LiveMapUpdate<T extends Record<string, Value>> extends LiveObjectUpdate {
  update: { [keyName in keyof T & string]?: 'updated' | 'removed' };
  _type: 'LiveMapUpdate';
}

/** @spec RTLM1, RTLM2 */
export class LiveMap<T extends Record<string, Value> = Record<string, Value>>
  extends LiveObject<LiveMapData, LiveMapUpdate<T>>
  implements PublicLiveMap<T>
{
  declare readonly [__livetype]: 'LiveMap'; // type-only, unique symbol to satisfy branded interfaces, no JS emitted
  private _clearTimeserial?: string; // RTLM25

  constructor(
    realtimeObject: RealtimeObject,
    private _semantics: ObjectsMapSemantics,
    objectId: string,
  ) {
    super(realtimeObject, objectId);
  }

  /**
   * Returns a {@link LiveMap} instance with an empty map data.
   *
   * @internal
   * @spec RTLM4
   */
  static zeroValue(realtimeObject: RealtimeObject, objectId: string): LiveMap {
    return new LiveMap(realtimeObject, ObjectsMapSemantics.LWW, objectId);
  }

  /**
   * Returns a {@link LiveMap} instance based on the provided object state.
   * The provided object state must hold a valid map object data.
   *
   * @internal
   */
  static fromObjectState(realtimeObject: RealtimeObject, objectMessage: ObjectMessage): LiveMap {
    const obj = new LiveMap(realtimeObject, objectMessage.object!.map!.semantics!, objectMessage.object!.objectId);
    obj.overrideWithObjectState(objectMessage);
    return obj;
  }

  /**
   * @internal
   */
  static async createMapSetMessage(
    realtimeObject: RealtimeObject,
    objectId: string,
    key: string,
    value: Value,
  ): Promise<ObjectMessage[]> {
    const client = realtimeObject.getClient();

    LiveMap.validateKeyValue(realtimeObject, key, value);

    let objectData: LiveMapObjectData;
    let createValueTypesMessages: ObjectMessage[] = [];

    if (LiveCounterValueType.instanceof(value)) {
      const counterCreateMsg = await LiveCounterValueType.createCounterCreateMessage(realtimeObject, value);
      createValueTypesMessages = [counterCreateMsg];

      const typedObjectData: ObjectIdObjectData = { objectId: counterCreateMsg.operation?.objectId! };
      objectData = typedObjectData;
    } else if (LiveMapValueType.instanceof(value)) {
      const { mapCreateMsg, nestedObjectsCreateMsgs } = await LiveMapValueType.createMapCreateMessage(
        realtimeObject,
        value,
      );
      createValueTypesMessages = [...nestedObjectsCreateMsgs, mapCreateMsg];

      const typedObjectData: ObjectIdObjectData = { objectId: mapCreateMsg.operation?.objectId! };
      objectData = typedObjectData;
    } else {
      // RTLM20e7b, RTLM20e7c, RTLM20e7d, RTLM20e7e, RTLM20e7f
      objectData = primitiveToObjectData(value as Primitive, client);
    }

    const mapSetMsg = ObjectMessage.fromValues(
      {
        operation: {
          action: ObjectOperationAction.MAP_SET, // RTLM20e2
          objectId, // RTLM20e3
          mapSet: {
            key, // RTLM20e6
            value: objectData, // RTLM20e7
          },
        } as ObjectOperation<ObjectData>,
      },
      client.Utils,
      client.MessageEncoding,
    );

    return [...createValueTypesMessages, mapSetMsg];
  }

  /**
   * @internal
   */
  static createMapRemoveMessage(realtimeObject: RealtimeObject, objectId: string, key: string): ObjectMessage {
    const client = realtimeObject.getClient();

    if (typeof key !== 'string') {
      throw new client.ErrorInfo('Map key should be string', 40003, 400);
    }

    const msg = ObjectMessage.fromValues(
      {
        operation: {
          action: ObjectOperationAction.MAP_REMOVE, // RTLM21e2
          objectId, // RTLM21e3
          mapRemove: { key }, // RTLM21e5
        } as ObjectOperation<ObjectData>,
      },
      client.Utils,
      client.MessageEncoding,
    );

    return msg;
  }

  /**
   * @internal
   */
  static validateKeyValue(realtimeObject: RealtimeObject, key: string, value: Value): void {
    const client = realtimeObject.getClient();

    if (typeof key !== 'string') {
      throw new client.ErrorInfo('Map key should be string', 40003, 400);
    }

    if (
      value === null ||
      (typeof value !== 'string' &&
        typeof value !== 'number' &&
        typeof value !== 'boolean' &&
        typeof value !== 'object')
    ) {
      throw new client.ErrorInfo('Map value data type is unsupported', 40013, 400); // OD4a
    }
  }

  /**
   * Returns the value associated with the specified key in the underlying Map object.
   *
   * - If this map object is tombstoned (deleted), `undefined` is returned.
   * - If no entry is associated with the specified key, `undefined` is returned.
   * - If map entry is tombstoned (deleted), `undefined` is returned.
   * - If the value associated with the provided key is an objectId string of another LiveObject, a reference to that LiveObject
   * is returned, provided it exists in the local pool and is not tombstoned. Otherwise, `undefined` is returned.
   * - If the value is not an objectId, then that value is returned.
   *
   * @spec RTLM5, RTLM5a
   */
  // force the key to be of type string as we only allow strings as key in a map
  get<TKey extends keyof T & string>(key: TKey): T[TKey] | undefined {
    if (this.isTombstoned()) {
      return undefined;
    }

    const element = this._dataRef.data.get(key);

    // RTLM5d1
    if (element === undefined) {
      return undefined;
    }

    // RTLM5d2a
    if (element.tombstone === true) {
      return undefined;
    }

    // data always exists for non-tombstoned elements
    return this._getResolvedValueFromObjectData(element.data!) as T[TKey];
  }

  size(): number {
    let size = 0;
    for (const value of this._dataRef.data.values()) {
      if (this._isMapEntryTombstoned(value)) {
        // should not count tombstoned entries
        continue;
      }

      size++;
    }

    return size;
  }

  *entries<TKey extends keyof T & string>(): IterableIterator<[TKey, T[TKey]]> {
    for (const [key, entry] of this._dataRef.data.entries()) {
      if (this._isMapEntryTombstoned(entry)) {
        // do not return tombstoned entries
        continue;
      }

      // data always exists for non-tombstoned elements
      const value = this._getResolvedValueFromObjectData(entry.data!) as T[TKey];
      yield [key as TKey, value];
    }
  }

  *keys<TKey extends keyof T & string>(): IterableIterator<TKey> {
    for (const [key] of this.entries<TKey>()) {
      yield key;
    }
  }

  *values<TKey extends keyof T & string>(): IterableIterator<T[TKey]> {
    for (const [_, value] of this.entries<TKey>()) {
      yield value;
    }
  }

  /**
   * Send a MAP_SET operation to the realtime system to set a key on this LiveMap object to a specified value.
   *
   * The change will be applied locally when the ACK is received from Realtime.
   *
   * @returns A promise which resolves upon receiving the ACK message for the published operation message
   * and applying the operation locally.
   * @spec RTLM20
   */
  async set<TKey extends keyof T & string>(
    key: TKey,
    value: T[TKey] | LiveCounterValueType | LiveMapValueType,
  ): Promise<void> {
    const msgs = await LiveMap.createMapSetMessage(this._realtimeObject, this.getObjectId(), key, value);
    return this._realtimeObject.publishAndApply(msgs);
  }

  /**
   * Send a MAP_REMOVE operation to the realtime system to tombstone a key on this LiveMap object.
   *
   * The change will be applied locally when the ACK is received from Realtime.
   *
   * @returns A promise which resolves upon receiving the ACK message for the published operation message
   * and applying the operation locally.
   * @spec RTLM21
   */
  async remove<TKey extends keyof T & string>(key: TKey): Promise<void> {
    const msg = LiveMap.createMapRemoveMessage(this._realtimeObject, this.getObjectId(), key);
    return this._realtimeObject.publishAndApply([msg]);
  }

  /**
   * @internal
   * @spec RTLM15
   */
  applyOperation(op: ObjectOperation<ObjectData>, msg: ObjectMessage, source: ObjectsOperationSource): boolean {
    if (op.objectId !== this.getObjectId()) {
      throw new this._client.ErrorInfo(
        `Cannot apply object operation with objectId=${op.objectId}, to this LiveMap with objectId=${this.getObjectId()}`,
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
          'LiveMap.applyOperation()',
          `skipping ${op.action} op: op serial ${opSerial} <= site serial ${this._siteTimeserials[opSiteCode]}; objectId=${this.getObjectId()}`,
        );
      }
      return false; // RTLM15b
    }

    // RTLM15c
    if (source === ObjectsOperationSource.channel) {
      // should update stored site serial immediately. doesn't matter if we successfully apply the op,
      // as it's important to mark that the op was processed by the object
      this._siteTimeserials[opSiteCode] = opSerial;
    }

    if (this.isTombstoned()) {
      // this object is tombstoned so the operation cannot be applied
      return false; // RTLM15e
    }

    let update: LiveMapUpdate<T> | LiveObjectUpdateNoop;
    switch (op.action) {
      case ObjectOperationAction.MAP_CREATE:
        // RTLM15d1
        update = this._applyMapCreate(op, msg);
        break;

      case ObjectOperationAction.MAP_SET:
        if (this._client.Utils.isNil(op.mapSet)) {
          this._logNoPayloadWarning(op);
          return false;
        }
        // RTLM15d6
        update = this._applyMapSet(op.mapSet, opSerial, msg);
        break;

      case ObjectOperationAction.MAP_REMOVE:
        if (this._client.Utils.isNil(op.mapRemove)) {
          this._logNoPayloadWarning(op);
          return false;
        }
        // RTLM15d7
        update = this._applyMapRemove(op.mapRemove, opSerial, msg.serialTimestamp, msg);
        break;

      case ObjectOperationAction.OBJECT_DELETE:
        // RTLM15d5
        update = this._applyObjectDelete(msg);
        break;

      case ObjectOperationAction.MAP_CLEAR:
        // RTLM15d8
        update = this._applyMapClear(msg);
        break;

      default:
        // RTLM15d4 - log a warning and discard the message without taking any further action
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MAJOR,
          'LiveMap.applyOperation()',
          `object operation message received with unsupported action, skipping message; action=${op.action}, objectId=${this.getObjectId()}`,
        );
        return false;
    }

    this.notifyUpdated(update); // RTLM15d1a, RTLM15d6a, RTLM15d7a, RTLM15d5a, RTLM15d8a
    return true; // RTLM15d1b, RTLM15d6b, RTLM15d7b, RTLM15d5b, RTLM15d8b
  }

  /**
   * @internal
   * @spec RTLM6
   */
  overrideWithObjectState(objectMessage: ObjectMessage): LiveMapUpdate<T> | LiveObjectUpdateNoop {
    const objectState = objectMessage.object;
    if (objectState == null) {
      throw new this._client.ErrorInfo(`Missing object state; LiveMap objectId=${this.getObjectId()}`, 92000, 400);
    }

    if (objectState.objectId !== this.getObjectId()) {
      throw new this._client.ErrorInfo(
        `Invalid object state: object state objectId=${objectState.objectId}; LiveMap objectId=${this.getObjectId()}`,
        92000,
        400,
      );
    }

    if (objectState.map?.semantics !== this._semantics) {
      throw new this._client.ErrorInfo(
        `Invalid object state: object state map semantics=${objectState.map?.semantics}; LiveMap semantics=${this._semantics}`,
        92000,
        400,
      );
    }

    if (!this._client.Utils.isNil(objectState.createOp)) {
      // it is expected that create operation can be missing in the object state, so only validate it when it exists
      if (objectState.createOp.objectId !== this.getObjectId()) {
        throw new this._client.ErrorInfo(
          `Invalid object state: object state createOp objectId=${objectState.createOp?.objectId}; LiveMap objectId=${this.getObjectId()}`,
          92000,
          400,
        );
      }

      if (objectState.createOp.action !== ObjectOperationAction.MAP_CREATE) {
        throw new this._client.ErrorInfo(
          `Invalid object state: object state createOp action=${objectState.createOp?.action}; LiveMap objectId=${this.getObjectId()}`,
          92000,
          400,
        );
      }

      if (objectState.createOp.mapCreate?.semantics !== this._semantics) {
        throw new this._client.ErrorInfo(
          `Invalid object state: object state createOp map semantics=${objectState.createOp.mapCreate?.semantics}; LiveMap semantics=${this._semantics}`,
          92000,
          400,
        );
      }
    }

    // object's site serials are still updated even if it is tombstoned, so always use the site serials received from the op.
    // should default to empty map if site serials do not exist on the object state, so that any future operation may be applied to this object.
    this._siteTimeserials = objectState.siteTimeserials ?? {}; // RTLM6a

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
    this._createOperationIsMerged = false; // RTLM6b
    this._clearTimeserial = objectState.map?.clearTimeserial; // RTLM6i
    this._dataRef = this._liveMapDataFromMapEntries(objectState.map?.entries ?? {}); // RTLM6c
    // RTLM6d
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
    // should remove any tombstoned entries from the underlying map data that have exceeded the GC grace period

    const keysToDelete: string[] = [];
    for (const [key, value] of this._dataRef.data.entries()) {
      if (value.tombstone === true && Date.now() - value.tombstonedAt! >= this._realtimeObject.gcGracePeriod) {
        keysToDelete.push(key);
      }
    }

    keysToDelete.forEach((x) => this._dataRef.data.delete(x));
  }

  /**
   * Override clearData to handle parent reference cleanup when this LiveMap is tombstoned.
   *
   * @internal
   */
  clearData(): LiveMapUpdate<T> {
    // Remove all parent references for objects this map was referencing
    for (const [key, entry] of this._dataRef.data.entries()) {
      if (entry.data && 'objectId' in entry.data) {
        const referencedObject = this._realtimeObject.getPool().get(entry.data.objectId);
        if (referencedObject) {
          referencedObject.removeParentReference(this, key);
        }
      }
    }

    // RTLM4 - Reset clearTimeserial to null for zero-value LiveMap
    this._clearTimeserial = undefined;

    // Call the parent clearData method
    return super.clearData();
  }

  /**
   * Returns an in-memory JavaScript object representation of this LiveMap.
   * LiveMap values are recursively compacted using their own compact methods.
   * Compacted LiveMaps are memoized to handle cyclic references (returned as in-memory pointers).
   *
   * Use compactJson() for a JSON-serializable representation.
   *
   * @internal
   */
  compact(visitedObjects?: Map<string, Record<string, any>>): CompactedValue<PublicLiveMap<T>> {
    const visited = visitedObjects ?? new Map<string, Record<string, any>>();
    const result: Record<keyof T, any> = {} as Record<keyof T, any>;

    // Memoize the compacted result to handle circular references
    visited.set(this.getObjectId(), result);

    // Use public entries() method to ensure we only include publicly exposed properties
    for (const [key, value] of this.entries()) {
      if (value instanceof LiveMap) {
        if (visited.has(value.getObjectId())) {
          // If the LiveMap has already been visited, just reference it to avoid infinite loops
          result[key] = visited.get(value.getObjectId());
        } else {
          // Otherwise, compact it
          result[key] = value.compact(visited);
        }
        continue;
      }

      if (value instanceof LiveCounter) {
        result[key] = value.value();
        continue;
      }

      // other values are returned as-is
      result[key] = value;
    }

    return result;
  }

  /**
   * Returns a JSON-serializable representation of this LiveMap.
   * LiveMap values are recursively compacted using their own compactJson methods.
   * Cyclic references are represented as `{ objectId: string }` instead of in-memory pointers.
   * Buffers are converted to base64 strings.
   *
   * Use compact() for an in-memory representation.
   *
   * @internal
   */
  compactJson(visitedObjectIds?: Set<string>): CompactedJsonValue<PublicLiveMap<T>> {
    const visited = visitedObjectIds ?? new Set<string>();
    const result: Record<keyof T, any> = {} as Record<keyof T, any>;

    // Mark this object ID as visited to handle circular references
    visited.add(this.getObjectId());

    // Use public entries() method to ensure we only include publicly exposed properties
    for (const [key, value] of this.entries()) {
      if (value instanceof LiveMap) {
        if (visited.has(value.getObjectId())) {
          // If the LiveMap has already been visited, return its objectId to avoid infinite loops
          result[key] = { objectId: value.getObjectId() };
        } else {
          // Otherwise, compact it
          result[key] = value.compactJson(visited);
        }
        continue;
      }

      if (value instanceof LiveCounter) {
        result[key] = value.value();
        continue;
      }

      // Convert buffers to base64 strings
      if (this._client.Platform.BufferUtils.isBuffer(value)) {
        result[key] = this._client.Platform.BufferUtils.base64Encode(value);
        continue;
      }

      // Other values return as is
      result[key] = value;
    }

    return result;
  }

  /** @spec RTLM4 */
  protected _getZeroValueData(): LiveMapData {
    return { data: new Map<string, LiveMapEntry>() };
  }

  protected _updateFromDataDiff(prevDataRef: LiveMapData, newDataRef: LiveMapData): LiveMapUpdate<T> {
    const update: LiveMapUpdate<T> = { update: {}, _type: 'LiveMapUpdate' };

    for (const [key, currentEntry] of prevDataRef.data.entries()) {
      const typedKey: keyof T & string = key;
      // any non-tombstoned properties that exist on a current map, but not in the new data - got removed
      if (currentEntry.tombstone === false && !newDataRef.data.has(typedKey)) {
        update.update[typedKey] = 'removed';
      }
    }

    for (const [key, newEntry] of newDataRef.data.entries()) {
      const typedKey: keyof T & string = key;
      if (!prevDataRef.data.has(typedKey)) {
        // if property does not exist in the current map, but new data has it as a non-tombstoned property - got updated
        if (newEntry.tombstone === false) {
          update.update[typedKey] = 'updated';
          continue;
        }

        // otherwise, if new data has this prop tombstoned - do nothing, as property didn't exist anyway
        if (newEntry.tombstone === true) {
          continue;
        }
      }

      // properties that exist both in current and new map data need to have their values compared to decide on the update type
      const currentEntry = prevDataRef.data.get(typedKey)!;

      // compare tombstones first
      if (currentEntry.tombstone === true && newEntry.tombstone === false) {
        // current prop is tombstoned, but new is not. it means prop was updated to a meaningful value
        update.update[typedKey] = 'updated';
        continue;
      }
      if (currentEntry.tombstone === false && newEntry.tombstone === true) {
        // current prop is not tombstoned, but new is. it means prop was removed
        update.update[typedKey] = 'removed';
        continue;
      }
      if (currentEntry.tombstone === true && newEntry.tombstone === true) {
        // both props are tombstoned - treat as noop, as there is no data to compare.
        continue;
      }

      // both props exist and are not tombstoned, need to compare values with deep equals to see if it was changed
      const valueChanged = !dequal(currentEntry.data, newEntry.data);
      if (valueChanged) {
        update.update[typedKey] = 'updated';
        continue;
      }
    }

    return update;
  }

  protected _mergeInitialDataFromCreateOperation(
    objectOperation: ObjectOperation<ObjectData>,
    msg: ObjectMessage,
  ): LiveMapUpdate<T> {
    // RTLM23 - resolve mapCreate from either the direct property or the one from which mapCreateWithObjectId was derived
    const mapCreate = objectOperation.mapCreate ?? objectOperation.mapCreateWithObjectId?._derivedFrom;

    if (this._client.Utils.isNil(mapCreate)) {
      // if a map object is missing for the MAP_CREATE op, the initial value is implicitly an empty map.
      // in this case there is nothing to merge into the current map, so we can just end processing the op.
      return { update: {}, objectMessage: msg, _type: 'LiveMapUpdate' };
    }

    const aggregatedUpdate: LiveMapUpdate<T> = {
      update: {},
      objectMessage: msg,
      _type: 'LiveMapUpdate',
    };
    // RTLM23a
    // in order to apply MAP_CREATE op for an existing map, we should merge their underlying entries keys.
    // we can do this by iterating over entries from MAP_CREATE op and apply changes on per-key basis as if we had MAP_SET, MAP_REMOVE operations.
    Object.entries(mapCreate.entries ?? {}).forEach(([key, entry]) => {
      // for a MAP_CREATE operation we must use the serial value available on an entry, instead of a serial on a message
      const opSerial = entry.timeserial;
      let update: LiveMapUpdate<T> | LiveObjectUpdateNoop;
      if (entry.tombstone === true) {
        // RTLM23a2 - entry in MAP_CREATE op is removed, try to apply MAP_REMOVE op
        update = this._applyMapRemove({ key }, opSerial, entry.serialTimestamp, msg);
      } else {
        // RTLM23a1 - entry in MAP_CREATE op is not removed, try to set it via MAP_SET op
        update = this._applyMapSet({ key, value: entry.data! }, opSerial, msg);
      }

      // skip noop updates
      if ((update as LiveObjectUpdateNoop).noop) {
        return;
      }

      // otherwise copy update data to aggregated update
      Object.assign(aggregatedUpdate.update, update.update);
    });

    this._createOperationIsMerged = true; // RTLM23b

    return aggregatedUpdate; // RTLM23c
  }

  private _logNoPayloadWarning(op: ObjectOperation<ObjectData>): void {
    // a message with a missing operation payload is malformed; log a warning and discard
    // it without aborting the processing of sibling operations in the same ProtocolMessage
    this._client.Logger.logAction(
      this._client.logger,
      this._client.Logger.LOG_MAJOR,
      'LiveMap.applyOperation()',
      `no payload found for ${op.action} op, skipping message; objectId=${this.getObjectId()}`,
    );
  }

  private _applyMapCreate(
    op: ObjectOperation<ObjectData>,
    msg: ObjectMessage,
  ): LiveMapUpdate<T> | LiveObjectUpdateNoop {
    if (this._createOperationIsMerged) {
      // There can't be two different create operation for the same object id, because the object id
      // fully encodes that operation. This means we can safely ignore any new incoming create operations
      // if we already merged it once.
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MICRO,
        'LiveMap._applyMapCreate()',
        `skipping applying MAP_CREATE op on a map instance as it was already applied before; objectId=${this.getObjectId()}`,
      );
      return { noop: true };
    }

    // RTLM23 - resolve mapCreate from either the direct property or the one from which mapCreateWithObjectId was derived
    const mapCreate = op.mapCreate ?? op.mapCreateWithObjectId?._derivedFrom;

    if (this._semantics !== mapCreate?.semantics) {
      throw new this._client.ErrorInfo(
        `Cannot apply MAP_CREATE op on LiveMap objectId=${this.getObjectId()}; map's semantics=${this._semantics}, but op expected ${mapCreate?.semantics}`,
        92000,
        400,
      );
    }

    return this._mergeInitialDataFromCreateOperation(op, msg);
  }

  /** @spec RTLM7, RTLM7d3 */
  private _applyMapSet(
    op: MapSet<ObjectData>,
    opSerial: string | undefined,
    msg: ObjectMessage,
  ): LiveMapUpdate<T> | LiveObjectUpdateNoop {
    const { ErrorInfo, Utils } = this._client;

    // RTLM7h - Check operation's serial against clearTimeserial first
    if (this._clearTimeserial && (!opSerial || this._clearTimeserial >= opSerial)) {
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MICRO,
        'LiveMap._applyMapSet()',
        `skipping update for key="${op.key}": op serial ${opSerial} <= clear serial ${this._clearTimeserial}; objectId=${this.getObjectId()}`,
      );
      return { noop: true };
    }

    const existingEntry = this._dataRef.data.get(op.key);
    // RTLM7a
    if (existingEntry && !this._canApplyMapEntryOperation(existingEntry.timeserial, opSerial)) {
      // RTLM7a1 - the operation's serial <= the entry's serial, ignore the operation.
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MICRO,
        'LiveMap._applyMapSet()',
        `skipping update for key="${op.key}": op serial ${opSerial?.toString()} <= entry serial ${existingEntry.timeserial?.toString()}; objectId=${this.getObjectId()}`,
      );
      return { noop: true };
    }

    if (Utils.isNil(op.value) || (Utils.isNil(op.value.objectId) && Utils.isNil(getObjectDataPrimitive(op.value)))) {
      throw new ErrorInfo(
        `Invalid object data for MAP_SET op on objectId=${this.getObjectId()} on key="${op.key}"`,
        92000,
        400,
      );
    }

    let liveData: LiveMapObjectData;
    // RTLM7g
    if (!Utils.isNil(op.value.objectId)) {
      liveData = { objectId: op.value.objectId } as ObjectIdObjectData;
      // this MAP_SET op is setting a key to point to another object via its object id,
      // but it is possible that we don't have the corresponding object in the pool yet (for example, we haven't seen the *_CREATE op for it).
      // we don't want to return undefined from this map's .get() method even if we don't have the object,
      // so instead we create a zero-value object for that object id if it not exists.
      this._realtimeObject.getPool().createZeroValueObjectIfNotExists(op.value.objectId); // RTLM7g1
    } else {
      liveData = op.value;
    }

    if (existingEntry) {
      // If there was an existing entry, we need to handle parent reference changes
      if (existingEntry.data && 'objectId' in existingEntry.data) {
        // Remove parent reference from the old object
        const oldReferencedObject = this._realtimeObject.getPool().get(existingEntry.data.objectId);
        if (oldReferencedObject) {
          oldReferencedObject.removeParentReference(this, op.key);
        }
      }

      // RTLM7a2
      existingEntry.tombstone = false; // RTLM7a2c
      existingEntry.tombstonedAt = undefined; // RTLM7a2d
      existingEntry.timeserial = opSerial; // RTLM7a2b
      existingEntry.data = liveData; // RTLM7a2e
    } else {
      // RTLM7b, RTLM7b4
      const newEntry: LiveMapEntry = {
        tombstone: false, // RTLM7b2
        tombstonedAt: undefined, // RTLM7b3
        timeserial: opSerial,
        data: liveData,
      };
      this._dataRef.data.set(op.key, newEntry);
    }

    // Add parent reference to the new object (if it's an object reference)
    if ('objectId' in liveData) {
      const newReferencedObject = this._realtimeObject.getPool().get(liveData.objectId);
      if (newReferencedObject) {
        newReferencedObject.addParentReference(this, op.key);
      }
    }

    const update: LiveMapUpdate<T> = {
      update: {},
      objectMessage: msg,
      _type: 'LiveMapUpdate',
    };
    const typedKey: keyof T & string = op.key;
    update.update[typedKey] = 'updated';

    return update;
  }

  /** @spec RTLM8, RTLM8c4 */
  private _applyMapRemove(
    op: MapRemove,
    opSerial: string | undefined,
    opTimestamp: number | undefined,
    msg: ObjectMessage,
  ): LiveMapUpdate<T> | LiveObjectUpdateNoop {
    // RTLM8g - Check operation's serial against clearTimeserial first
    if (this._clearTimeserial && (!opSerial || this._clearTimeserial >= opSerial)) {
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MICRO,
        'LiveMap._applyMapRemove()',
        `skipping remove for key="${op.key}": op serial ${opSerial} <= clear serial ${this._clearTimeserial}; objectId=${this.getObjectId()}`,
      );
      return { noop: true };
    }

    const existingEntry = this._dataRef.data.get(op.key);
    // RTLM8a
    if (existingEntry && !this._canApplyMapEntryOperation(existingEntry.timeserial, opSerial)) {
      // RTLM8a1 - the operation's serial <= the entry's serial, ignore the operation.
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MICRO,
        'LiveMap._applyMapRemove()',
        `skipping remove for key="${op.key}": op serial ${opSerial?.toString()} <= entry serial ${existingEntry.timeserial?.toString()}; objectId=${this.getObjectId()}`,
      );
      return { noop: true };
    }

    if (existingEntry) {
      // Handle parent reference removal for object references
      if (existingEntry.data && 'objectId' in existingEntry.data) {
        // Remove parent reference from the object that was being referenced
        const referencedObject = this._realtimeObject.getPool().get(existingEntry.data.objectId);
        if (referencedObject) {
          referencedObject.removeParentReference(this, op.key);
        }
      }

      // RTLM8a2
      existingEntry.tombstone = true; // RTLM8a2c
      existingEntry.tombstonedAt = this._calculateTombstonedAt(
        opTimestamp,
        'LiveMap._applyMapRemove()',
        `key="${op.key}", objectId=${this.getObjectId()}`,
      ); // RTLM8a2d
      existingEntry.timeserial = opSerial; // RTLM8a2b
      existingEntry.data = undefined; // RTLM8a2a
    } else {
      // RTLM8b, RTLM8b1
      const newEntry: LiveMapEntry = {
        tombstone: true, // RTLM8b2
        tombstonedAt: this._calculateTombstonedAt(
          opTimestamp,
          'LiveMap._applyMapRemove()',
          `key="${op.key}", objectId=${this.getObjectId()}`,
        ), // RTLM8b3
        timeserial: opSerial,
        data: undefined,
      };
      this._dataRef.data.set(op.key, newEntry);
    }

    const update: LiveMapUpdate<T> = {
      update: {},
      objectMessage: msg,
      _type: 'LiveMapUpdate',
    };
    const typedKey: keyof T & string = op.key;
    update.update[typedKey] = 'removed';

    return update;
  }

  /** @spec RTLM24 */
  private _applyMapClear(objectMessage: ObjectMessage): LiveMapUpdate<T> | LiveObjectUpdateNoop {
    const opSerial = objectMessage.serial!;

    if (this._clearTimeserial != null && this._clearTimeserial > opSerial) {
      // RTLM24c
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MICRO,
        'LiveMap._applyMapClear()',
        `skipping MAP_CLEAR: op serial ${opSerial} < current clear serial ${this._clearTimeserial}; objectId=${this.getObjectId()}`,
      );
      return { noop: true };
    }

    // RTLM24d
    this._client.Logger.logAction(
      this._client.logger,
      this._client.Logger.LOG_MICRO,
      'LiveMap._applyMapClear()',
      `updating clearTimeserial; previous=${this._clearTimeserial}, new=${opSerial}; objectId=${this.getObjectId()}`,
    );
    this._clearTimeserial = opSerial;

    const update: LiveMapUpdate<T> = {
      update: {},
      objectMessage,
      _type: 'LiveMapUpdate',
    };

    // RTLM24e
    for (const [key, entry] of this._dataRef.data.entries()) {
      const entrySerial = entry.timeserial;
      // RTLM24e1
      if (entrySerial == null || this._clearTimeserial > entrySerial) {
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MICRO,
          'LiveMap._applyMapClear()',
          `clearing entry; key="${key}", entry serial=${entrySerial}, clear serial=${this._clearTimeserial}, objectId=${this.getObjectId()}`,
        );

        // Handle parent reference removal for object references
        if (entry.data && 'objectId' in entry.data) {
          // Remove parent reference from the object that was being referenced
          const referencedObject = this._realtimeObject.getPool().get(entry.data.objectId);
          if (referencedObject) {
            referencedObject.removeParentReference(this, key);
          }
        }

        // RTLM24e1a - Remove the entry from the internal data map entirely
        this._dataRef.data.delete(key);

        const typedKey: keyof T & string = key;
        update.update[typedKey] = 'removed'; // RTLM24e1b
      } else {
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MICRO,
          'LiveMap._applyMapClear()',
          `skipping clearing entry; key="${key}", entry serial=${entrySerial}, clear serial=${this._clearTimeserial}, objectId=${this.getObjectId()}`,
        );
      }
    }

    return update; // RTLM24f
  }

  /**
   * Returns true if the serials of the given operation and entry indicate that
   * the operation should be applied to the entry, following the CRDT semantics of this LiveMap.
   * @spec RTLM9
   */
  private _canApplyMapEntryOperation(mapEntrySerial: string | undefined, opSerial: string | undefined): boolean {
    // for LWW CRDT semantics (the only supported LiveMap semantic) an operation
    // should only be applied if its serial is strictly greater ("after") than an entry's serial.

    if (!mapEntrySerial && !opSerial) {
      // RTLM9b - if both serials are nullish or empty strings, we treat them as the "earliest possible" serials,
      // in which case they are "equal", so the operation should not be applied
      return false;
    }

    if (!mapEntrySerial) {
      // RTLM9d - any operation serial is greater than non-existing entry serial
      return true;
    }

    if (!opSerial) {
      // RTLM9c - non-existing operation serial is lower than any entry serial
      return false;
    }

    // RTLM9e - if both serials exist, compare them lexicographically
    return opSerial > mapEntrySerial;
  }

  private _liveMapDataFromMapEntries(entries: Record<string, ObjectsMapEntry<ObjectData>>): LiveMapData {
    const liveMapData: LiveMapData = {
      data: new Map<string, LiveMapEntry>(),
    };

    // need to iterate over entries to correctly process optional parameters
    Object.entries(entries ?? {}).forEach(([key, entry]) => {
      let liveData: LiveMapObjectData | undefined = undefined;

      if (!this._client.Utils.isNil(entry.data)) {
        if (!this._client.Utils.isNil(entry.data.objectId)) {
          liveData = { objectId: entry.data.objectId } as ObjectIdObjectData;
        } else {
          liveData = entry.data;
        }
      }

      const liveDataEntry: LiveMapEntry = {
        timeserial: entry.timeserial,
        data: liveData,
        // consider object as tombstoned only if we received an explicit flag stating that. otherwise it exists
        tombstone: entry.tombstone === true,
        tombstonedAt:
          entry.tombstone === true
            ? this._calculateTombstonedAt(
                entry.serialTimestamp,
                'LiveMap._liveMapDataFromMapEntries()',
                `key="${key}", objectId=${this.getObjectId()}`,
              )
            : undefined, // RTLM6c1
      };

      liveMapData.data.set(key, liveDataEntry);
    });

    return liveMapData;
  }

  /**
   * Returns value as is if object data stores a primitive type, or a reference to another LiveObject from the pool if it stores an objectId.
   */
  private _getResolvedValueFromObjectData(data: LiveMapObjectData): Value | undefined {
    // if object data stores primitive value, just return it as is.
    const primitiveValue = getObjectDataPrimitive(data);
    if (primitiveValue != null) {
      return primitiveValue; // RTLM5d2b, RTLM5d2c, RTLM5d2d, RTLM5d2e
    }

    // RTLM5d2f - if object data has an objectId reference, get the actual object from the pool
    if ('objectId' in data) {
      const refObject: LiveObject | undefined = this._realtimeObject.getPool().get(data.objectId);
      if (!refObject) {
        return undefined; // RTLM5d2f1
      }

      if (refObject.isTombstoned()) {
        // tombstoned objects must not be surfaced to the end users
        return undefined;
      }

      return refObject as unknown as PublicLiveObject; // RTLM5d2f2
    }

    return undefined; // RTLM5d2g
  }

  private _isMapEntryTombstoned(entry: LiveMapEntry): boolean {
    if (entry.tombstone === true) {
      return true;
    }

    // data always exists for non-tombstoned entries
    const data = entry.data!;
    if ('objectId' in data) {
      const refObject = this._realtimeObject.getPool().get(data.objectId);

      if (refObject?.isTombstoned()) {
        // entry that points to tombstoned object should be considered tombstoned as well
        return true;
      }
    }

    return false;
  }
}
