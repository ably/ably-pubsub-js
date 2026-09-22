import { __livetype } from '../../../ably';
import { LiveCounter } from '../../../liveobjects';
import { ObjectId } from './objectid';
import {
  CounterCreate,
  encodePartialObjectOperationForWire,
  ObjectData,
  ObjectMessage,
  ObjectOperation,
  ObjectOperationAction,
} from './objectmessage';
import { RealtimeObject } from './realtimeobject';

/**
 * A value type class that serves as a simple container for LiveCounter data.
 * Contains sufficient information for the client to produce a COUNTER_CREATE operation
 * for the LiveCounter object.
 *
 * Properties of this class are immutable after construction and the instance
 * will be frozen to prevent mutation.
 */
export class LiveCounterValueType implements LiveCounter {
  declare readonly [__livetype]: 'LiveCounter'; // type-only, unique symbol to satisfy branded interfaces, no JS emitted
  private readonly _livetype = 'LiveCounter'; // use a runtime property to provide a reliable cross-bundle type identification instead of `instanceof` operator
  private readonly _count: number;

  private constructor(count: number) {
    this._count = count;
    Object.freeze(this);
  }

  static create(initialCount: number = 0): LiveCounter {
    // We can't directly import the ErrorInfo class from the core library into the plugin (as this would bloat the plugin size),
    // and, since we're in a user-facing static method, we can't expect a user to pass a client library instance, as this would make the API ugly.
    // Since we can't use ErrorInfo here, we won't do any validation at this step; instead, validation will happen in the mutation methods
    // when we try to create this object.

    return new LiveCounterValueType(initialCount);
  }

  /**
   * @internal
   */
  static instanceof(value: unknown): value is LiveCounterValueType {
    return typeof value === 'object' && value !== null && (value as LiveCounterValueType)._livetype === 'LiveCounter';
  }

  /**
   * @internal
   */
  static async createCounterCreateMessage(
    realtimeObject: RealtimeObject,
    value: LiveCounterValueType,
  ): Promise<ObjectMessage> {
    const client = realtimeObject.getClient();
    const count = value._count;

    if (count !== undefined && (typeof count !== 'number' || !Number.isFinite(count))) {
      throw new client.ErrorInfo('Counter value should be a valid number', 40003, 400);
    }

    const counterCreate = LiveCounterValueType._getCounterCreate(count); // RTO12f12
    const { counterCreate: encodedCounterCreate } = encodePartialObjectOperationForWire(
      { counterCreate },
      client,
      client.Utils.Format.json,
    );
    const initialValueJSONString = JSON.stringify(encodedCounterCreate); // RTO12f13
    const nonce = await ObjectId.generateNonce(client); // RTO12f4
    const msTimestamp = await client.getTimestamp(true); // RTO12f5

    // RTO12f6
    const objectId = ObjectId.fromInitialValue(
      client.Platform,
      'counter',
      initialValueJSONString,
      nonce,
      msTimestamp,
    ).toString();

    const msg = ObjectMessage.fromValues(
      {
        operation: {
          action: ObjectOperationAction.COUNTER_CREATE, // RTO12f7
          objectId, // RTO12f8
          counterCreateWithObjectId: {
            nonce, // RTO12f14
            initialValue: initialValueJSONString, // RTO12f15
            // RTO12f16 - retain the source CounterCreate for local use (size calculation and apply-on-ACK)
            _derivedFrom: counterCreate,
          },
        } as ObjectOperation<ObjectData>,
      },
      client.Utils,
      client.MessageEncoding,
    );

    return msg;
  }

  private static _getCounterCreate(count?: number): CounterCreate {
    return {
      count: count ?? 0, // RTO12f12a, RTO12f12b
    };
  }
}
