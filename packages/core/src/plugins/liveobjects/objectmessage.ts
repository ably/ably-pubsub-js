import type BaseClient from 'common/lib/client/baseclient';
import type RealtimeChannel from 'common/lib/client/realtimechannel';
import type { MessageEncoding } from 'common/lib/types/basemessage';
import type * as Utils from 'common/lib/util/utils';
import type * as ObjectsApi from '../../../liveobjects';

export type EncodeObjectDataFunction<TData = ObjectData | WireObjectData> = (data: TData) => WireObjectData;

/** @spec OOP2 */
export enum ObjectOperationAction {
  MAP_CREATE = 0,
  MAP_SET = 1,
  MAP_REMOVE = 2,
  COUNTER_CREATE = 3,
  COUNTER_INC = 4,
  OBJECT_DELETE = 5,
  MAP_CLEAR = 6,
}

const operationActions: ObjectsApi.ObjectOperationAction[] = [
  'map.create',
  'map.set',
  'map.remove',
  'counter.create',
  'counter.inc',
  'object.delete',
  'map.clear',
];

export function decodeObjectOperationAction(action: ObjectOperationAction): ObjectsApi.ObjectOperationAction {
  return operationActions[action] || 'unknown';
}

/** @spec OMP2 */
export enum ObjectsMapSemantics {
  LWW = 0,
}

const mapSemantics: ObjectsApi.ObjectsMapSemantics[] = ['lww'];

export function encodeMapSemantics(semantics: ObjectsApi.ObjectsMapSemantics, client: BaseClient): ObjectsMapSemantics {
  const index = mapSemantics.indexOf(semantics);
  if (index === -1) {
    throw new client.ErrorInfo(`Unrecognized map semantics: ${semantics}`, 40003, 400);
  }
  return index;
}

export function decodeMapSemantics(semantics: ObjectsMapSemantics): ObjectsApi.ObjectsMapSemantics {
  return mapSemantics[semantics] ?? 'unknown';
}

/**
 * An ObjectData represents a decoded value in an object on a channel decoded from {@link WireObjectData}.
 * @spec OD1
 */
export interface ObjectData {
  /** A reference to another object, used to support composable object structures. Only one value field can be set. */
  objectId?: string; // OD2a
  /** A primitive boolean leaf value in the object graph. Only one value field can be set. */
  boolean?: boolean; // OD2c
  /** A decoded primitive binary leaf value in the object graph. Only one value field can be set. */
  bytes?: Buffer | ArrayBuffer; // OD2d
  /** A primitive number leaf value in the object graph. Only one value field can be set. */
  number?: number; // OD2e
  /** A primitive string leaf value in the object graph. Only one value field can be set. */
  string?: string; // OD2f
  /** A decoded JSON object leaf value in the object graph. Only one value field can be set. */
  json?: ObjectsApi.JsonObject | ObjectsApi.JsonArray; // OD2g
}

/**
 * Extracts the primitive value from an {@link ObjectData}'s typed fields.
 * Returns the first non-undefined typed field value, or `undefined` if none is set.
 */
export function getObjectDataPrimitive(data: ObjectData): ObjectsApi.Primitive | undefined {
  return data.boolean ?? data.bytes ?? data.number ?? data.string ?? data.json;
}

/**
 * Converts a {@link Primitive} value into an {@link ObjectData} with the appropriate typed field set.
 */
export function primitiveToObjectData(value: ObjectsApi.Primitive, client: BaseClient): ObjectData {
  if (client.Platform.BufferUtils.isBuffer(value)) return { bytes: value };
  if (typeof value === 'boolean') return { boolean: value };
  if (typeof value === 'number') return { number: value };
  if (typeof value === 'string') return { string: value };
  if (typeof value === 'object' && value !== null) return { json: value };
  return {};
}

/**
 * A WireObjectData represents a value in an object on a channel received from the server.
 * @spec OD1
 */
export interface WireObjectData {
  /** A reference to another object, used to support composable object structures. Only one value field can be set. */
  objectId?: string; // OD2a
  /** A primitive boolean leaf value in the object graph. Only one value field can be set. */
  boolean?: boolean; // OD2c
  /** A primitive binary leaf value in the object graph. Only one value field can be set. Represented as a Base64-encoded string in JSON protocol */
  bytes?: Buffer | ArrayBuffer | string; // OD2d
  /** A primitive number leaf value in the object graph. Only one value field can be set. */
  number?: number; // OD2e
  /** A primitive string leaf value in the object graph. Only one value field can be set. */
  string?: string; // OD2f
  /** A primitive JSON-encoded string leaf value in the object graph. Only one value field can be set. */
  json?: string; // OD2g
}

/**
 * An ObjectsMapEntry represents the value at a given key in a Map object.
 * @spec OME1
 */
export interface ObjectsMapEntry<TData> {
  /** Indicates whether the map entry has been removed. */
  tombstone?: boolean; // OME2a
  /**
   * The {@link ObjectMessage.serial} value of the last operation that was applied to the map entry.
   *
   * It is optional in a MAP_CREATE operation and might be missing, in which case the client should use a nullish value for it
   * and treat it as the "earliest possible" serial for comparison purposes.
   */
  timeserial?: string; // OME2b
  /** A timestamp from the {@link timeserial} field. Only present if {@link tombstone} is `true` */
  serialTimestamp?: number; // OME2d
  /** The data that represents the value of the map entry. */
  data?: TData; // OME2c
}

/**
 * An ObjectsMap object represents a map of key-value pairs.
 * @spec OMP1
 */
export interface ObjectsMap<TData> {
  /** The conflict-resolution semantics used by the map object. */
  semantics?: ObjectsMapSemantics; // OMP3a
  /** The map entries, indexed by key. */
  entries?: Record<string, ObjectsMapEntry<TData>>; // OMP3b
  /** The {@link ObjectMessage.serial} value of the last `MAP_CLEAR` operation applied to the map. If no `MAP_CLEAR` has been applied, this field is omitted */
  clearTimeserial?: string; // OMP3c
}

/**
 * An ObjectsCounter object represents an incrementable and decrementable value
 * @spec OCN1
 */
export interface ObjectsCounter {
  /** The value of the counter */
  count?: number; // OCN2a
}

/**
 * A MapCreate describes the payload for a MAP_CREATE operation on a map object
 * @spec MCR1
 */
export interface MapCreate<TData> {
  /** The conflict-resolution semantics used by the map object. */
  semantics: ObjectsMapSemantics; // MCR2a
  /** The map entries, indexed by key. */
  entries: Record<string, ObjectsMapEntry<TData>>; // MCR2b
}

/**
 * A MapSet describes the payload for a MAP_SET operation on a map object
 * @spec MST1
 */
export interface MapSet<TData> {
  /** The key to set. */
  key: string; // MST2a
  /** The value to set. */
  value: TData; // MST2b
}

/**
 * A MapRemove describes the payload for a MAP_REMOVE operation on a map object
 * @spec MRM1
 */
export interface MapRemove {
  /** The key to remove. */
  key: string; // MRM2a
}

/**
 * A CounterCreate describes the payload for a COUNTER_CREATE operation on a counter object
 * @spec CCR1
 */
export interface CounterCreate {
  /** The initial counter value */
  count: number; // CCR2a
}

/**
 * A CounterInc describes the payload for a COUNTER_INC operation on a counter object
 * @spec CIN1
 */
export interface CounterInc {
  /** The value to be added to the counter */
  number: number; // CIN2a
}

/**
 * An ObjectDelete describes the payload for an OBJECT_DELETE operation
 * @spec ODE1
 */
export interface ObjectDelete {
  // ODE2 - Empty message, OBJECT_DELETE requires no operation-specific data
}

/**
 * A MapCreateWithObjectId describes the payload for a MAP_CREATE operation with a client-specified object ID
 * @spec MCRO1
 */
export interface MapCreateWithObjectId<TData> {
  /**
   * The initial value of the object - an encoded {@link MapCreate} used to create a map represented as a JSON string.
   */
  initialValue: string; // MCRO2a
  /** The nonce used to generate the object ID */
  nonce: string; // MCRO2b
  /**
   * The source {@link MapCreate} from which this was derived. For local use only (message size
   * calculation and apply-on-ACK); not transmitted over the wire.
   * @spec RTO11f18
   * @internal
   */
  _derivedFrom?: MapCreate<TData>;
}

/**
 * A CounterCreateWithObjectId describes the payload for a COUNTER_CREATE operation with a client-specified object ID
 * @spec CCRO1
 */
export interface CounterCreateWithObjectId {
  /**
   * The initial value of the object - an encoded {@link CounterCreate} used to create a counter represented as a JSON string.
   */
  initialValue: string; // CCRO2a
  /** The nonce used to generate the object ID */
  nonce: string; // CCRO2b
  /**
   * The source {@link CounterCreate} from which this was derived. For local use only (message size
   * calculation and apply-on-ACK); not transmitted over the wire.
   * @spec RTO12f16
   * @internal
   */
  _derivedFrom?: CounterCreate;
}

/**
 * A MapClear describes the payload for a MAP_CLEAR operation
 * @spec MCL1
 */
export interface MapClear {
  // MCL2 - Empty message, MAP_CLEAR requires no operation-specific data
}

/**
 * An ObjectOperation describes an operation to be applied to an object on a channel.
 * @spec OOP1
 */
export interface ObjectOperation<TData> {
  /** Defines the operation to be applied to the object. */
  action: ObjectOperationAction; // OOP3a
  /** The object ID of the object on a channel to which the operation should be applied. */
  objectId: string; // OOP3b

  /**
   * The payload for MAP_CREATE operation when received from the server.
   * Contains the unmarshalled initial value for the Map object.
   */
  mapCreate?: MapCreate<TData>; // OOP3j
  /**
   * The payload for MAP_SET operation.
   */
  mapSet?: MapSet<TData>; // OOP3k
  /**
   * The payload for MAP_REMOVE operation.
   */
  mapRemove?: MapRemove; // OOP3l
  /**
   * The payload for COUNTER_CREATE operation when received from the server.
   * Contains the unmarshalled initial value for the Counter object.
   */
  counterCreate?: CounterCreate; // OOP3m
  /**
   * The payload for COUNTER_INC operation.
   */
  counterInc?: CounterInc; // OOP3n
  /**
   * The payload for OBJECT_DELETE operation.
   */
  objectDelete?: ObjectDelete; // OOP3o
  /**
   * The payload for MAP_CREATE operation when sending to the server.
   * Contains the nonce and JSON-encoded initial value from {@link MapCreate} for object ID verification.
   */
  mapCreateWithObjectId?: MapCreateWithObjectId<TData>; // OOP3p
  /**
   * The payload for COUNTER_CREATE operation when sending to the server.
   * Contains the nonce and JSON-encoded initial value from {@link CounterCreate} for object ID verification.
   */
  counterCreateWithObjectId?: CounterCreateWithObjectId; // OOP3q
  /**
   * The payload for MAP_CLEAR operation.
   */
  mapClear?: MapClear; // OOP3r
}

/**
 * An ObjectState describes the instantaneous state of an object on a channel.
 * @spec OST1
 */
export interface ObjectState<TData> {
  /** The identifier of the object. */
  objectId: string; // OST2a
  /** A map of serials keyed by a {@link ObjectMessage.siteCode}, representing the last operations applied to this object */
  siteTimeserials: Record<string, string>; // OST2b
  /** True if the object has been tombstoned. */
  tombstone: boolean; // OST2c
  /**
   * The operation that created the object.
   *
   * Can be missing if create operation for the object is not known at this point.
   */
  createOp?: ObjectOperation<TData>; // OST2d
  /**
   * The data that represents the result of applying all operations to a Map object
   * excluding the initial value from the create operation if it is a Map object type.
   */
  map?: ObjectsMap<TData>; // OST2e
  /**
   * The data that represents the result of applying all operations to a Counter object
   * excluding the initial value from the create operation if it is a Counter object type.
   */
  counter?: ObjectsCounter; // OST2f
}

function encode(
  message: ObjectMessage,
  utils: typeof Utils,
  messageEncoding: typeof MessageEncoding,
  encodeObjectDataFn: EncodeObjectDataFunction<ObjectData>,
): WireObjectMessage;
function encode(
  message: WireObjectMessage,
  utils: typeof Utils,
  messageEncoding: typeof MessageEncoding,
  encodeObjectDataFn: EncodeObjectDataFunction<WireObjectData>,
): WireObjectMessage;
function encode(
  message: ObjectMessage | WireObjectMessage,
  utils: typeof Utils,
  messageEncoding: typeof MessageEncoding,
  encodeObjectDataFn: EncodeObjectDataFunction<any>,
): WireObjectMessage {
  // deep copy the message to avoid mutating the original one.
  // buffer values won't be correctly copied, so we will need to use the original message when encoding.
  const result = Object.assign(new WireObjectMessage(utils, messageEncoding), copyMsg(message));

  // encode "object" field
  if (message.object?.map?.entries) {
    result.object!.map!.entries = encodeMapEntries(message.object.map.entries, encodeObjectDataFn);
  }

  if (message.object?.createOp?.mapCreate?.entries) {
    result.object!.createOp!.mapCreate!.entries = encodeMapEntries(
      message.object.createOp.mapCreate.entries,
      encodeObjectDataFn,
    );
  }

  // encode "operation" field
  if (message.operation?.mapCreate?.entries) {
    result.operation!.mapCreate!.entries = encodeMapEntries(message.operation.mapCreate.entries, encodeObjectDataFn);
  }

  if (message.operation?.mapSet?.value) {
    result.operation!.mapSet!.value = encodeObjectData(message.operation.mapSet.value, encodeObjectDataFn);
  }

  // encode _derivedFrom entries on *CreateWithObjectId - these hold ObjectData that needs
  // encoding to WireObjectData for correct message size calculation.
  if (message.operation?.mapCreateWithObjectId?._derivedFrom?.entries) {
    result.operation!.mapCreateWithObjectId!._derivedFrom!.entries = encodeMapEntries(
      message.operation.mapCreateWithObjectId._derivedFrom.entries,
      encodeObjectDataFn,
    );
  }

  return result;
}

function encodeMapEntries(
  mapEntries: Record<string, ObjectsMapEntry<ObjectData | WireObjectData>>,
  encodeFn: EncodeObjectDataFunction,
): Record<string, ObjectsMapEntry<WireObjectData>> {
  return Object.entries(mapEntries).reduce(
    (acc, v) => {
      const [key, entry] = v;
      const encodedData = entry.data ? encodeObjectData(entry.data, encodeFn) : undefined;
      acc[key] = {
        ...entry,
        data: encodedData,
      };
      return acc;
    },
    {} as Record<string, ObjectsMapEntry<WireObjectData>>,
  );
}

/** @spec OD4 */
function encodeObjectData(data: ObjectData | WireObjectData, encodeFn: EncodeObjectDataFunction): WireObjectData {
  const encodedData = encodeFn(data);
  return encodedData;
}

/**
 * Encodes a partial {@link ObjectOperation} for wire transmission.
 *
 * This is used in multiple contexts:
 * - During realtime *_CREATE operations to produce the wire-safe representation that will be
 *   JSON-stringified and set as the `initialValue` field in
 *   {@link MapCreateWithObjectId} or {@link CounterCreateWithObjectId}.
 * - In the REST SDK to get an encoded initial value for an object to generate
 *   a client-side object ID.
 * - In the REST SDK publish path to encode user-provided operation data for transmission.
 *
 * The provided operation may contain user-provided data that requires encoding
 * (e.g. buffers must be encoded for JSON wire format).
 */
export function encodePartialObjectOperationForWire(
  operation: Partial<ObjectOperation<ObjectData>>,
  client: BaseClient,
  format: Utils.Format,
): Partial<ObjectOperation<WireObjectData>> {
  const msg = ObjectMessage.fromValues(
    // cast to ObjectOperation here, even though provided operation may lack some properties
    // that are usually present on the ObjectOperation.
    // this ObjectMessage instance is only used to get the encoded body,
    // so it's ok for the operation field to be incomplete in this context.
    // doing the type assertion here avoids the need to define a separate ObjectMessage
    // type that supports a fully optional ObjectOperation.
    { operation: operation as ObjectOperation<ObjectData> },
    client.Utils,
    client.MessageEncoding,
  );
  const wireMsg = msg.encode();

  // get the encoded operation that is safe to be sent over the wire.
  const { operation: encodedOperation } = wireMsg.encodeForWire(format);
  return encodedOperation!;
}

/** @spec OD5 */
export function decodeWireObjectData(
  wireData: WireObjectData,
  client: BaseClient,
  format: Utils.Format | undefined,
): ObjectData {
  try {
    if (wireData.objectId != null) {
      return { objectId: wireData.objectId };
    }

    if (wireData.bytes != null) {
      const decodedBytes =
        format === 'msgpack'
          ? // OD5a1 - connection is using msgpack protocol, bytes are already a buffer
            (wireData.bytes as Buffer | ArrayBuffer)
          : // OD5b2 - connection is using JSON protocol, Base64-decode bytes value
            client.Platform.BufferUtils.base64Decode(String(wireData.bytes));
      return { bytes: decodedBytes };
    }

    if (wireData.json != null) {
      return { json: JSON.parse(wireData.json) }; // OD5a2, OD5b3
    }

    if (wireData.boolean != null) {
      return { boolean: wireData.boolean };
    }

    if (wireData.number != null) {
      return { number: wireData.number };
    }

    if (wireData.string != null) {
      return { string: wireData.string };
    }

    // unrecognized ObjectData shape - pass through as-is so we don't lose any data
    client.Logger.logAction(
      client.logger,
      client.Logger.LOG_MINOR,
      'decodeWireObjectData()',
      'Unrecognized wire ObjectData shape, keys: ' + Object.keys(wireData).join(', '),
    );
    return { ...wireData } as ObjectData;
  } catch (error) {
    client.Logger.logAction(
      client.logger,
      client.Logger.LOG_ERROR,
      'decodeWireObjectData()',
      client.Utils.inspectError(error),
    );
    // object data decoding has failed, return the data as is.
    return {
      ...wireData,
    } as ObjectData;
  }
}

function strMsg(msg: any, className: string) {
  let result = '[' + className;

  for (const attr in msg) {
    if (msg[attr] === undefined || attr === '_utils' || attr === '_messageEncoding') {
      continue;
    }

    if (attr === 'operation' || attr === 'object' || attr === 'extras') {
      result += `; ${attr}=${JSON.stringify(msg[attr])}`;
    } else {
      result += `; ${attr}=${msg[attr]}`;
    }
  }

  result += ']';
  return result;
}

/**
 * Deep copy public properties of an object message, using `JSON.parse(JSON.stringify(object))` for nested object fields like `operation` and `object`.
 *
 * Important: Buffer instances are not copied correctly using `JSON.parse(JSON.stringify(object))`, as they lose their type and become plain objects.
 * If you need access to the original Buffer values, use the original message instance instead.
 */

function copyMsg(
  msg: Utils.Properties<ObjectMessage | WireObjectMessage>,
): Utils.Properties<ObjectMessage | WireObjectMessage> {
  const result: Utils.Properties<ObjectMessage | WireObjectMessage> = {
    id: msg.id,
    clientId: msg.clientId,
    connectionId: msg.connectionId,
    timestamp: msg.timestamp,
    serial: msg.serial,
    serialTimestamp: msg.serialTimestamp,
    siteCode: msg.siteCode,
  };

  if (msg.operation) {
    result.operation = JSON.parse(JSON.stringify(msg.operation));
  }
  if (msg.object) {
    result.object = JSON.parse(JSON.stringify(msg.object));
  }
  if (msg.extras) {
    result.extras = JSON.parse(JSON.stringify(msg.extras));
  }

  return result;
}

function toUserFacingObjectData(data: ObjectData): ObjectsApi.ObjectData {
  if (data.objectId != null) {
    return { objectId: data.objectId };
  }

  return {
    ...data,
    // deprecated field for backwards compatibility
    value: getObjectDataPrimitive(data),
  };
}

function toUserFacingMapEntry(entry: ObjectsMapEntry<ObjectData>): ObjectsApi.ObjectsMapEntry {
  return {
    ...entry,
    data: entry.data ? toUserFacingObjectData(entry.data) : undefined,
  };
}

function toUserFacingObjectOperation(operation: ObjectOperation<ObjectData>): ObjectsApi.ObjectOperation {
  const { mapSet: internalMapSet, mapRemove, counterInc, objectDelete, mapClear } = operation;

  // resolve *Create from direct property or from *CreateWithObjectId._derivedFrom
  const internalMapCreate = operation.mapCreate ?? operation.mapCreateWithObjectId?._derivedFrom;
  const counterCreate = operation.counterCreate ?? operation.counterCreateWithObjectId?._derivedFrom;

  let mapCreate: ObjectsApi.MapCreate | undefined;
  if (internalMapCreate) {
    mapCreate = {
      ...internalMapCreate,
      semantics: decodeMapSemantics(internalMapCreate.semantics),
      entries: Object.fromEntries(
        Object.entries(internalMapCreate.entries).map(([key, entry]) => [key, toUserFacingMapEntry(entry)]),
      ),
    };
  }

  let mapSet: ObjectsApi.MapSet | undefined;
  if (internalMapSet) {
    mapSet = {
      ...internalMapSet,
      value: toUserFacingObjectData(internalMapSet.value),
    };
  }

  // ObjectOperation deprecated fields for backwards compatibility
  let mapOp: ObjectsApi.ObjectsMapOp | undefined;
  if (mapSet) {
    mapOp = {
      key: mapSet.key,
      data: mapSet.value,
    };
  } else if (mapRemove) {
    mapOp = { key: mapRemove.key };
  }

  let counterOp: ObjectsApi.ObjectsCounterOp | undefined;
  if (counterInc) {
    counterOp = { amount: counterInc.number };
  }

  return {
    action: decodeObjectOperationAction(operation.action),
    objectId: operation.objectId,
    mapCreate,
    mapSet,
    mapRemove,
    counterCreate,
    counterInc,
    objectDelete,
    mapClear,
    // deprecated fields
    mapOp,
    counterOp,
    map: mapCreate,
    counter: counterCreate,
  };
}

/**
 * A decoded {@link WireObjectMessage} message
 * @spec OM1
 * @internal
 */
export class ObjectMessage {
  id?: string; // OM2a
  clientId?: string; // OM2b
  connectionId?: string; // OM2c
  extras?: any; // OM2d
  timestamp?: number; // OM2e
  /**
   * Describes an operation to be applied to an object.
   *
   * Mutually exclusive with the `object` field. This field is only set on object messages if the `action` field of the `ProtocolMessage` encapsulating it is `OBJECT`.
   */
  operation?: ObjectOperation<ObjectData>; // OM2f
  /**
   * Describes the instantaneous state of an object.
   *
   * Mutually exclusive with the `operation` field. This field is only set on object messages if the `action` field of the `ProtocolMessage` encapsulating it is `OBJECT_SYNC`.
   */
  object?: ObjectState<ObjectData>; // OM2g
  /** An opaque string that uniquely identifies this object message. */
  serial?: string; // OM2h
  /** A timestamp from the {@link serial} field. */
  serialTimestamp?: number; // OM2j
  /** An opaque string used as a key to update the map of serial values on an object. */
  siteCode?: string; // OM2i

  constructor(
    private _utils: typeof Utils,
    private _messageEncoding: typeof MessageEncoding,
  ) {}

  static fromValues(
    values: Utils.Properties<ObjectMessage>,
    utils: typeof Utils,
    messageEncoding: typeof MessageEncoding,
  ): ObjectMessage {
    return Object.assign(new ObjectMessage(utils, messageEncoding), values);
  }

  static fromValuesArray(
    values: Utils.Properties<ObjectMessage>[],
    utils: typeof Utils,
    messageEncoding: typeof MessageEncoding,
  ): ObjectMessage[] {
    return values.map((x) => ObjectMessage.fromValues(x, utils, messageEncoding));
  }

  /**
   * Protocol agnostic encoding of this ObjectMessage. Returns a new {@link WireObjectMessage} instance.
   *
   * Uses encoding functions from regular `Message` processing.
   *
   * @spec OM4
   */
  encode(): WireObjectMessage {
    const encodeObjectDataFn: EncodeObjectDataFunction<ObjectData> = (data) => {
      const encodedObjectData: WireObjectData = {
        // bytes encoding happens later when WireObjectMessage is encoded for wire transmission, so we just copy all fields except json for now.
        // OD4c1, OD4d1, OD4c3, OD4d3, OD4c4, OD4d4
        ...data,
        json: data.json != null ? JSON.stringify(data.json) : undefined, // OD4c5, OD4d5
      };

      return encodedObjectData;
    };

    return encode(this, this._utils, this._messageEncoding, encodeObjectDataFn);
  }

  toString(): string {
    return strMsg(this, 'ObjectMessage');
  }

  isOperationMessage(): boolean {
    return this.operation != null;
  }

  isSyncMessage(): boolean {
    return this.object != null;
  }

  toUserFacingMessage(channel: RealtimeChannel): ObjectsApi.ObjectMessage {
    return {
      id: this.id,
      clientId: this.clientId,
      connectionId: this.connectionId,
      timestamp: this.timestamp,
      channel: channel.name,
      // we expose only operation messages to users, so operation field is always present
      operation: toUserFacingObjectOperation(this.operation!),
      serial: this.serial,
      serialTimestamp: this.serialTimestamp,
      siteCode: this.siteCode,
      extras: this.extras,
    };
  }
}

/**
 * An individual object message to be sent or received via the Ably Realtime service.
 * @spec OM1
 * @internal
 */
export class WireObjectMessage {
  id?: string; // OM2a
  clientId?: string; // OM2b
  connectionId?: string; // OM2c
  extras?: any; // OM2d
  timestamp?: number; // OM2e
  /**
   * Describes an operation to be applied to an object.
   *
   * Mutually exclusive with the `object` field. This field is only set on object messages if the `action` field of the `ProtocolMessage` encapsulating it is `OBJECT`.
   */
  operation?: ObjectOperation<WireObjectData>; // OM2f
  /**
   * Describes the instantaneous state of an object.
   *
   * Mutually exclusive with the `operation` field. This field is only set on object messages if the `action` field of the `ProtocolMessage` encapsulating it is `OBJECT_SYNC`.
   */
  object?: ObjectState<WireObjectData>; // OM2g
  /** An opaque string that uniquely identifies this object message. */
  serial?: string; // OM2h
  /** A timestamp from the {@link serial} field. */
  serialTimestamp?: number; // OM2j
  /** An opaque string used as a key to update the map of serial values on an object. */
  siteCode?: string; // OM2i

  constructor(
    private _utils: typeof Utils,
    private _messageEncoding: typeof MessageEncoding,
  ) {}

  static fromValues(
    values: Utils.Properties<WireObjectMessage>,
    utils: typeof Utils,
    messageEncoding: typeof MessageEncoding,
  ): WireObjectMessage {
    return Object.assign(new WireObjectMessage(utils, messageEncoding), values);
  }

  static fromValuesArray(
    values: Utils.Properties<WireObjectMessage>[],
    utils: typeof Utils,
    messageEncoding: typeof MessageEncoding,
  ): WireObjectMessage[] {
    return values.map((x) => WireObjectMessage.fromValues(x, utils, messageEncoding));
  }

  /**
   * Encodes WireObjectMessage for wire transmission. Does not mutate the provided WireObjectMessage.
   *
   * Uses encoding functions from regular `Message` processing.
   */
  encodeForWire(format: Utils.Format): WireObjectMessage {
    const encodeObjectDataFn: EncodeObjectDataFunction<WireObjectData> = (data) => {
      if (data.bytes != null) {
        // OD4c2, OD4d2
        const result = this._messageEncoding.encodeDataForWire(data.bytes, null, format);
        // no need to set the encoding
        return { ...data, bytes: result.data };
      }

      return { ...data };
    };

    const result = encode(this, this._utils, this._messageEncoding, encodeObjectDataFn);

    // Strip _derivedFrom from *CreateWithObjectId — it is for local use only and must not be sent over the wire.
    if (result.operation?.mapCreateWithObjectId) {
      delete result.operation.mapCreateWithObjectId._derivedFrom;
    }
    if (result.operation?.counterCreateWithObjectId) {
      delete result.operation.counterCreateWithObjectId._derivedFrom;
    }

    return result;
  }

  /**
   * Decodes this WireObjectMessage and returns a new {@link ObjectMessage} instance.
   *
   * Format is used to decode the bytes value as it's implicitly encoded depending on the protocol used:
   * - json: bytes are Base64-encoded string
   * - msgpack: bytes have a binary representation and don't need to be decoded
   *
   * @spec OM5
   */
  decode(client: BaseClient, format: Utils.Format | undefined): ObjectMessage {
    // deep copy the message to avoid mutating the original one.
    // buffer values won't be correctly copied, so we will need to use the original message when decoding.
    const result = Object.assign(new ObjectMessage(this._utils, this._messageEncoding), copyMsg(this));

    try {
      // decode "object" field
      if (this.object?.map?.entries) {
        result.object!.map!.entries = this._decodeMapEntries(this.object.map.entries, client, format);
      }

      if (this.object?.createOp?.mapCreate?.entries) {
        result.object!.createOp!.mapCreate!.entries = this._decodeMapEntries(
          this.object.createOp.mapCreate.entries,
          client,
          format,
        );
      }

      // decode "operation" field
      if (this.operation?.mapCreate?.entries) {
        result.operation!.mapCreate!.entries = this._decodeMapEntries(this.operation.mapCreate.entries, client, format);
      }

      if (this.operation?.mapSet?.value) {
        result.operation!.mapSet!.value = decodeWireObjectData(this.operation.mapSet.value, client, format);
      }
    } catch (error) {
      client.Logger.logAction(
        client.logger,
        client.Logger.LOG_ERROR,
        'WireObjectMessage.decode()',
        this._utils.inspectError(error),
      );
    }

    return result;
  }

  /**
   * Overload toJSON() to intercept JSON.stringify().
   *
   * This will prepare the message to be transmitted over the wire to Ably.
   * It will encode the data payload according to the wire protocol used on the client.
   */
  toJSON() {
    // we can infer the format used by client by inspecting with what arguments this method was called.
    // if JSON protocol is being used, the JSON.stringify() will be called and this toJSON() method will have a non-empty arguments list.
    // MSGPack protocol implementation also calls toJSON(), but with an empty arguments list.
    const format = arguments.length > 0 ? this._utils.Format.json : this._utils.Format.msgpack;
    const { _utils, _messageEncoding, ...publicProps } = this.encodeForWire(format);
    return publicProps;
  }

  toString(): string {
    return strMsg(this, 'WireObjectMessage');
  }

  /** @spec OM3 */
  getMessageSize(): number {
    let size = 0;

    // OM3a
    size += this.clientId?.length ?? 0; // OM3f
    if (this.operation) {
      size += this._getObjectOperationSize(this.operation); // OM3b
    }
    if (this.object) {
      size += this._getObjectStateSize(this.object); // OM3c
    }
    if (this.extras) {
      size += JSON.stringify(this.extras).length; // OM3d
    }

    return size;
  }

  /** @spec OOP4 */
  private _getObjectOperationSize(operation: ObjectOperation<WireObjectData>): number {
    let size = 0;

    // OOP4h - map create size: from mapCreate if present (OOP4h1), else from mapCreateWithObjectId._derivedFrom (OOP4h2)
    const mapCreate = operation.mapCreate ?? operation.mapCreateWithObjectId?._derivedFrom;
    if (mapCreate) {
      size += this._getMapCreateSize(mapCreate);
    }
    if (operation.mapSet) {
      size += this._getMapSetSize(operation.mapSet); // OOP4i
    }
    if (operation.mapRemove) {
      size += this._getMapRemoveSize(operation.mapRemove); // OOP4j
    }
    // OOP4k - counter create size: from counterCreate if present (OOP4k1), else from counterCreateWithObjectId._derivedFrom (OOP4k2)
    const counterCreate = operation.counterCreate ?? operation.counterCreateWithObjectId?._derivedFrom;
    if (counterCreate) {
      size += this._getCounterCreateSize(counterCreate);
    }
    if (operation.counterInc) {
      size += this._getCounterIncSize(operation.counterInc); // OOP4l
    }

    return size;
  }

  /** @spec OST3 */
  private _getObjectStateSize(obj: ObjectState<WireObjectData>): number {
    let size = 0;

    // OST3a
    if (obj.map) {
      size += this._getObjectMapSize(obj.map); // OST3b
    }
    if (obj.counter) {
      size += this._getObjectCounterSize(obj.counter); // OST3c
    }
    if (obj.createOp) {
      size += this._getObjectOperationSize(obj.createOp); // OST3d
    }

    return size;
  }

  /** @spec OMP4 */
  private _getObjectMapSize(map: ObjectsMap<WireObjectData>): number {
    let size = 0;

    // OMP4a
    Object.entries(map.entries ?? {}).forEach(([key, entry]) => {
      size += key?.length ?? 0; // OMP4a1
      if (entry) {
        size += this._getMapEntrySize(entry); // OMP4a2
      }
    });

    return size;
  }

  /** @spec OCN3 */
  private _getObjectCounterSize(counter: ObjectsCounter): number {
    // OCN3b
    if (counter.count == null) {
      return 0;
    }

    // OCN3a
    return 8;
  }

  /** @spec OME3 */
  private _getMapEntrySize(entry: ObjectsMapEntry<WireObjectData>): number {
    let size = 0;

    // OME3a
    if (entry.data) {
      size += this._getObjectDataSize(entry.data); // OME3b
    }

    return size;
  }

  /** @spec MCR3 */
  private _getMapCreateSize(mapCreate: MapCreate<WireObjectData>): number {
    let size = 0;

    // MCR3a
    Object.entries(mapCreate.entries ?? {}).forEach(([key, entry]) => {
      size += key?.length ?? 0; // MCR3a1
      if (entry) {
        size += this._getMapEntrySize(entry); // MCR3a2
      }
    });

    return size;
  }

  /** @spec MST3 */
  private _getMapSetSize(mapSet: MapSet<WireObjectData>): number {
    let size = 0;

    size += mapSet.key?.length ?? 0; // MST3c
    if (mapSet.value) {
      size += this._getObjectDataSize(mapSet.value); // MST3b
    }

    return size;
  }

  /** @spec MRM3 */
  private _getMapRemoveSize(mapRemove: MapRemove): number {
    return mapRemove.key.length ?? 0; // MRM3a
  }

  /** @spec CCR3 */
  private _getCounterCreateSize(counterCreate: CounterCreate): number {
    if (counterCreate.count == null) {
      return 0; // CCR3b
    }

    return 8; // CCR3a
  }

  /** @spec CIN3 */
  private _getCounterIncSize(counterInc: CounterInc): number {
    if (counterInc.number == null) {
      return 0; // CIN3b
    }

    return 8; // CIN3a
  }

  /** @spec OD3 */
  private _getObjectDataSize(data: WireObjectData): number {
    let size = 0;

    // OD3a
    if (data.boolean != null) {
      size += this._utils.dataSizeBytes(data.boolean); // OD3b
    }
    if (data.bytes != null) {
      size += this._utils.dataSizeBytes(data.bytes); // OD3c
    }
    if (data.number != null) {
      size += this._utils.dataSizeBytes(data.number); // OD3d
    }
    if (data.string != null) {
      size += this._utils.dataSizeBytes(data.string); // OD3e
    }
    if (data.json != null) {
      size += this._utils.dataSizeBytes(data.json);
    }

    return size;
  }

  private _decodeMapEntries(
    mapEntries: Record<string, ObjectsMapEntry<WireObjectData>>,
    client: BaseClient,
    format: Utils.Format | undefined,
  ): Record<string, ObjectsMapEntry<ObjectData>> {
    return Object.entries(mapEntries).reduce(
      (acc, v) => {
        const [key, entry] = v;
        const decodedData = entry.data ? decodeWireObjectData(entry.data, client, format) : undefined;
        acc[key] = {
          ...entry,
          data: decodedData,
        };
        return acc;
      },
      {} as Record<string, ObjectsMapEntry<ObjectData>>,
    );
  }
}
