import { __livetype } from '../../../ably';
import { LiveMap as PublicLiveMap, Primitive, Value } from '../../../liveobjects';
import { LiveCounterValueType } from './livecountervaluetype';
import { LiveMap, LiveMapObjectData, ObjectIdObjectData } from './livemap';
import { ObjectId } from './objectid';
import {
  encodePartialObjectOperationForWire,
  MapCreate,
  ObjectData,
  ObjectMessage,
  ObjectOperation,
  ObjectOperationAction,
  ObjectsMapEntry,
  ObjectsMapSemantics,
  primitiveToObjectData,
} from './objectmessage';
import { RealtimeObject } from './realtimeobject';

/**
 * A value type class that serves as a simple container for LiveMap data.
 * Contains sufficient information for the client to produce a MAP_CREATE operation
 * for the LiveMap object.
 *
 * Properties of this class are immutable after construction and the instance
 * will be frozen to prevent mutation.
 *
 * Note: We do not deep freeze or deep copy the entries data for the following reasons:
 * 1. It adds substantial complexity, especially for handling Buffer/ArrayBuffer values
 * 2. Cross-platform buffer copying would require reimplementing BufferUtils logic
 *    to handle browser vs Node.js environments and check availability of Buffer/ArrayBuffer
 * 3. The protection isn't critical - if users mutate the data after creating the value type,
 *    nothing breaks since we create separate live objects each time the value type is used
 * 4. This behavior should be documented and it's the user's responsibility to understand
 *    how they mutate their data when working with value type classes
 */
export class LiveMapValueType<T extends Record<string, Value> = Record<string, Value>> implements PublicLiveMap<T> {
  declare readonly [__livetype]: 'LiveMap'; // type-only, unique symbol to satisfy branded interfaces, no JS emitted
  private readonly _livetype = 'LiveMap'; // use a runtime property to provide a reliable cross-bundle type identification instead of `instanceof` operator
  private readonly _entries: T | undefined;

  private constructor(entries: T | undefined) {
    this._entries = entries;
    Object.freeze(this);
  }

  static create<T extends Record<string, Value>>(
    initialEntries?: T,
  ): PublicLiveMap<T extends Record<string, Value> ? T : {}> {
    // We can't directly import the ErrorInfo class from the core library into the plugin (as this would bloat the plugin size),
    // and, since we're in a user-facing static method, we can't expect a user to pass a client library instance, as this would make the API ugly.
    // Since we can't use ErrorInfo here, we won't do any validation at this step; instead, validation will happen in the mutation methods
    // when we try to create this object.

    return new LiveMapValueType(initialEntries);
  }

  /**
   * @internal
   */
  static instanceof(value: unknown): value is LiveMapValueType {
    return typeof value === 'object' && value !== null && (value as LiveMapValueType)._livetype === 'LiveMap';
  }

  /**
   * @internal
   */
  static async createMapCreateMessage(
    realtimeObject: RealtimeObject,
    value: LiveMapValueType,
  ): Promise<{ mapCreateMsg: ObjectMessage; nestedObjectsCreateMsgs: ObjectMessage[] }> {
    const client = realtimeObject.getClient();
    const entries = value._entries;

    if (entries !== undefined && (entries === null || typeof entries !== 'object')) {
      throw new client.ErrorInfo('Map entries should be a key-value object', 40003, 400);
    }

    Object.entries(entries ?? {}).forEach(([key, value]) => LiveMap.validateKeyValue(realtimeObject, key, value));

    const { mapCreate, nestedObjectsCreateMsgs } = await LiveMapValueType._getMapCreate(realtimeObject, entries); // RTO11f14
    const { mapCreate: encodedMapCreate } = encodePartialObjectOperationForWire(
      { mapCreate },
      client,
      client.Utils.Format.json,
    ); // RTO11f15a
    const initialValueJSONString = JSON.stringify(encodedMapCreate); // RTO11f15b
    const nonce = await ObjectId.generateNonce(client); // RTO11f6
    const msTimestamp = await client.getTimestamp(true); // RTO11f7

    // RTO11f8
    const objectId = ObjectId.fromInitialValue(
      client.Platform,
      'map',
      initialValueJSONString,
      nonce,
      msTimestamp,
    ).toString();

    const mapCreateMsg = ObjectMessage.fromValues(
      {
        operation: {
          action: ObjectOperationAction.MAP_CREATE, // RTO11f9
          objectId, // RTO11f10
          mapCreateWithObjectId: {
            nonce, // RTO11f16
            initialValue: initialValueJSONString, // RTO11f17
            // RTO11f18 - retain the source MapCreate for local use (size calculation and apply-on-ACK)
            _derivedFrom: mapCreate,
          },
        } as ObjectOperation<ObjectData>,
      },
      client.Utils,
      client.MessageEncoding,
    );

    return {
      mapCreateMsg,
      nestedObjectsCreateMsgs,
    };
  }

  private static async _getMapCreate(
    realtimeObject: RealtimeObject,
    entries?: Record<string, Value>,
  ): Promise<{
    mapCreate: MapCreate<ObjectData>;
    nestedObjectsCreateMsgs: ObjectMessage[];
  }> {
    const mapEntries: Record<string, ObjectsMapEntry<ObjectData>> = {}; // RTO11f14b - empty map by default
    const nestedObjectsCreateMsgs: ObjectMessage[] = [];

    // RTO11f14c
    for (const [key, value] of Object.entries(entries ?? {})) {
      let objectData: LiveMapObjectData;

      if (LiveMapValueType.instanceof(value)) {
        const { mapCreateMsg, nestedObjectsCreateMsgs: childNestedObjs } =
          await LiveMapValueType.createMapCreateMessage(realtimeObject, value);
        nestedObjectsCreateMsgs.push(...childNestedObjs, mapCreateMsg);
        const typedObjectData: ObjectIdObjectData = { objectId: mapCreateMsg.operation?.objectId! };
        objectData = typedObjectData;
      } else if (LiveCounterValueType.instanceof(value)) {
        const counterCreateMsg = await LiveCounterValueType.createCounterCreateMessage(realtimeObject, value);
        nestedObjectsCreateMsgs.push(counterCreateMsg);
        const typedObjectData: ObjectIdObjectData = { objectId: counterCreateMsg.operation?.objectId! };
        objectData = typedObjectData;
      } else {
        // RTO11f14c1b, RTO11f14c1c, RTO11f14c1d, RTO11f14c1e, RTO11f14c1f - Handle primitive values
        objectData = primitiveToObjectData(value as Primitive, realtimeObject.getClient());
      }

      // RTO11f14c1, RTO11f14c2
      mapEntries[key] = {
        data: objectData,
      };
    }

    const mapCreate: MapCreate<ObjectData> = {
      semantics: ObjectsMapSemantics.LWW, // RTO11f14a
      entries: mapEntries, // RTO11f14b, RTO11f14c
    };

    return {
      mapCreate,
      nestedObjectsCreateMsgs,
    };
  }
}
