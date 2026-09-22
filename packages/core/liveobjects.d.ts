/**
 * You are currently viewing the Ably LiveObjects plugin type definitions for the Ably JavaScript Client Library SDK.
 *
 * To get started with LiveObjects, follow the [Quickstart Guide](https://ably.com/docs/liveobjects/quickstart/javascript) or view the [Introduction to LiveObjects](https://ably.com/docs/liveobjects).
 *
 * @module
 */

/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import {
  ErrorInfo,
  EventCallback,
  RealtimeChannel,
  RealtimeClient,
  RestClient,
  StatusSubscription,
  Subscription,
  __livetype,
} from './ably';
import { BaseRealtime, BaseRest, Rest } from './modular';
/* eslint-enable no-unused-vars, @typescript-eslint/no-unused-vars */

/**
 * Blocks inferences to the contained type.
 * Polyfill for TypeScript's `NoInfer` utility type introduced in TypeScript 5.4.
 *
 * This works by leveraging deferred conditional types - the compiler can't
 * evaluate the conditional until it knows what T is, which prevents TypeScript
 * from digging into the type to find inference candidates.
 *
 * See:
 * - https://stackoverflow.com/questions/56687668
 * - https://www.typescriptlang.org/docs/handbook/utility-types.html#noinfertype
 */
type NoInfer<T> = [T][T extends any ? 0 : never];

/**
 * The `ObjectsEvents` namespace describes the possible values of the {@link ObjectsEvent} type.
 */
declare namespace ObjectsEvents {
  /**
   * The local copy of Objects on a channel is currently being synchronized with the Ably service.
   */
  type SYNCING = 'syncing';
  /**
   * The local copy of Objects on a channel has been synchronized with the Ably service.
   */
  type SYNCED = 'synced';
}

/**
 * Describes the events emitted by a {@link RealtimeObject} object.
 */
export type ObjectsEvent = ObjectsEvents.SYNCED | ObjectsEvents.SYNCING;

/**
 * The callback used for the events emitted by {@link RealtimeObject}.
 */
export type ObjectsEventCallback = () => void;

/**
 * A function passed to the {@link BatchOperations.batch | batch} method to group multiple Objects operations into a single channel message.
 *
 * The function must be synchronous.
 *
 * @param ctx - The {@link BatchContext} used to group operations together.
 */
export type BatchFunction<T extends LiveObject> = (ctx: BatchContext<T>) => void;

/**
 * Enables REST-based operations on Objects on a channel.
 */
export declare interface RestObject {
  /**
   * Reads object data from the channel in compact object response format.
   * If no `objectId` is provided then the entire channel object is returned.
   *
   * Returns a {@link RestObjectGetCompactResult} representing the logical structure of your data as a JSON-like value.
   * {@link LiveMap} instances appear as JSON objects with their entries, and {@link LiveCounter} instances appear
   * as numbers. Binary values appear as base64 strings (JSON protocol) or `Buffer`/`ArrayBuffer` (binary protocol).
   * JSON-typed values remain as their JSON-encoded string representation.
   *
   * Cyclic references are included as `{ objectId: string }` rather than including the same object instance
   * in the result more than once.
   *
   * @param params - Optional parameters to specify the object to fetch.
   * @returns A promise which, upon success, will be fulfilled with the object data in compact format. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  get(params?: RestObjectGetCompactParams): Promise<RestObjectGetCompactResult>;
  /**
   * Reads object data from the channel in full object response format.
   * If no `objectId` is provided then the entire channel object is returned.
   *
   * Returns a {@link RestObjectGetFullResult} with full object metadata and decoded object data values
   * (`bytes` decoded to `Buffer`/`ArrayBuffer`, `json` decoded to native objects/arrays).
   * If the path resolves to a leaf value in a map, returns the decoded {@link RestObjectData | ObjectData} directly.
   *
   * Cyclic references are included as `{ objectId: string }` rather than including the same object instance
   * in the result more than once.
   *
   * @param params - Parameters specifying the object to fetch with `compact: false`.
   * @returns A promise which, upon success, will be fulfilled with the object data in full format. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  get(params: RestObjectGetFullParams): Promise<RestObjectGetFullResult>;
  /**
   * Reads object data from the channel.
   * If no `objectId` is provided then the entire channel object is returned.
   *
   * When `compact` is `true` (the default), returns a {@link RestObjectGetCompactResult} representing the logical
   * structure of your data as a JSON-like value. {@link LiveMap} instances appear as JSON objects with their entries,
   * and {@link LiveCounter} instances appear as numbers. Binary values appear as base64 strings (JSON protocol) or
   * `Buffer`/`ArrayBuffer` (binary protocol). JSON-typed values remain as their JSON-encoded string representation.
   *
   * When `compact` is `false`, returns a {@link RestObjectGetFullResult} with full object metadata
   * and decoded object data values (`bytes` decoded to `Buffer`/`ArrayBuffer`, `json` decoded to native objects/arrays).
   * If the path resolves to a leaf value in a map, returns the decoded {@link RestObjectData | ObjectData} directly.
   *
   * For both formats, cyclic references in the channel object are included as `{ objectId: string }`
   * rather than including the same object instance in the result more than once.
   *
   * @param params - Optional parameters to specify the object to fetch and the format of the returned data.
   * @returns A promise which, upon success, will be fulfilled with the object data in the requested format. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  get(params?: RestObjectGetParams): Promise<RestObjectGetCompactResult | RestObjectGetFullResult>;

  /**
   * Publishes one or more operations to modify objects on the channel.
   * When an array is provided, all operations are published as an atomic batch.
   *
   * Operations can target objects using `objectId`, `path`, or neither (for create operations that create standalone objects):
   * - `objectId`: The unique identifier of the object instance to create or update.
   * - `path`: The path to the object instance within the channel object.
   *
   * Use dot-separated notation for paths (for example `votes.up`), relative to the channel object.
   * An empty path `""` refers to the channel object itself.
   * Paths can contain wildcards (`*`) to target multiple objects at once. Wildcards match exactly one level
   * in the channel object and can appear at the end or middle of paths (for example `votes.*` or `posts.*.votes.up`).
   * If a key contains a dot, escape it with a backslash (for example `posts.post\\.123.votes.up`).
   *
   * When using path operations, the server resolves object IDs at the time it receives the request.
   * If the object instances at the specified path change due to concurrent updates before the server processes
   * the operation, the operation is not applied to the new object instances.
   *
   * @param op - A single operation or array of operations to publish.
   * @returns A promise which, upon success, will be fulfilled with a {@link RestObjectPublishResult} containing information about the published operations. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  publish(op: RestObjectOperation | RestObjectOperation[]): Promise<RestObjectPublishResult>;

  /**
   * Generates an object ID for a create operation. The returned ID, nonce, and initial value
   * can be used to construct a {@link RestObjectOperationMapCreateWithObjectId} or
   * {@link RestObjectOperationCounterCreateWithObjectId} operation for use with {@link publish}.
   *
   * Client-generated object IDs enable atomic batch operations with cross-references between
   * newly created objects. When publishing a batch of operations using {@link publish}, you
   * can reference an object by its pre-computed ID in the same batch - for example, creating
   * a map and assigning it to a key in another map in a single atomic publish call.
   *
   * @param createBody - The create operation body, either a {@link RestObjectOperationMapCreateBody} or {@link RestObjectOperationCounterCreateBody}.
   * @returns A promise which, upon success, will be fulfilled with a {@link RestObjectGenerateIdResult}. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  generateObjectId(
    createBody: RestObjectOperationMapCreateBody | RestObjectOperationCounterCreateBody,
  ): Promise<RestObjectGenerateIdResult>;
}

/**
 * Base interface for all REST object operations. Contains common fields shared across all operation types.
 */
export interface RestObjectOperationBase {
  /**
   * An ID associated with the message. Clients may set this field explicitly when publishing an operation to enable
   * idempotent publishing. If not set, this will be generated by the server.
   */
  id?: string;
}

// Enforce exactly one target at compile time using a union of the types below.
/**
 * Targets an object by its object ID.
 */
type TargetByObjectId = {
  /** The unique identifier of the object instance to target. */
  objectId: string;
  /** Not applicable when targeting by object ID. */
  path?: never;
};

/**
 * Targets an object by its location using the path.
 * Paths are expressed relative to the structure of the object as defined by the compact view of the channel object.
 */
type TargetByPath = {
  /**
   * Use dot-separated notation (for example `votes.up`), relative to the channel object.
   * An empty path `""` refers to the channel object itself.
   * Paths can contain wildcards (`*`) to target multiple objects at once. Wildcards match exactly one level
   * in the channel object and can appear at the end or middle of paths (for example `votes.*` or `posts.*.votes.up`).
   * If a key contains a dot, escape it with a backslash (for example `posts.post\\.123.votes.up`).
   */
  path: string;
  /** Not applicable when targeting by path. */
  objectId?: never;
};

/**
 * Base type for operations that can target objects either by object ID or by path.
 * Ensures that exactly one targeting method is specified.
 */
export type AnyTargetRestObjectOperationBase = RestObjectOperationBase & (TargetByObjectId | TargetByPath);

/**
 * Represents a leaf data value used when publishing operations via {@link RestObject.publish}.
 * Either a primitive value or a reference to another object. Exactly one property must be set, indicating the type.
 */
export type PublishObjectData =
  | {
      /** A string value. */
      string: string;
      /** Not applicable. */ number?: never;
      /** Not applicable. */ boolean?: never;
      /** Not applicable. */ bytes?: never;
      /** Not applicable. */ json?: never;
      /** Not applicable. */ objectId?: never;
    }
  | {
      /** A numeric value. */
      number: number;
      /** Not applicable. */ string?: never;
      /** Not applicable. */ boolean?: never;
      /** Not applicable. */ bytes?: never;
      /** Not applicable. */ json?: never;
      /** Not applicable. */ objectId?: never;
    }
  | {
      /** A boolean value. */
      boolean: boolean;
      /** Not applicable. */ string?: never;
      /** Not applicable. */ number?: never;
      /** Not applicable. */ bytes?: never;
      /** Not applicable. */ json?: never;
      /** Not applicable. */ objectId?: never;
    }
  | {
      /** A binary value. */
      bytes: Buffer | ArrayBuffer;
      /** Not applicable. */ string?: never;
      /** Not applicable. */ number?: never;
      /** Not applicable. */ boolean?: never;
      /** Not applicable. */ json?: never;
      /** Not applicable. */ objectId?: never;
    }
  | {
      /** A JSON value (array or object). */
      json: JsonArray | JsonObject;
      /** Not applicable. */ string?: never;
      /** Not applicable. */ number?: never;
      /** Not applicable. */ boolean?: never;
      /** Not applicable. */ bytes?: never;
      /** Not applicable. */ objectId?: never;
    }
  | {
      /** A reference to another object by its ID. */
      objectId: string;
      /** Not applicable. */ string?: never;
      /** Not applicable. */ number?: never;
      /** Not applicable. */ boolean?: never;
      /** Not applicable. */ bytes?: never;
      /** Not applicable. */ json?: never;
    };

/**
 * The map creation payload, specifying the semantics and initial entries for a new map object.
 * Used as the body of {@link RestObjectOperationMapCreate} and as input to {@link RestObject.generateObjectId}.
 */
export interface RestObjectOperationMapCreateBody {
  /** The map creation parameters. */
  mapCreate: {
    /** The conflict-resolution semantics for the map. */
    semantics: Exclude<ObjectsMapSemantics, ObjectsMapSemanticsNamespace.UNKNOWN>;
    /** Initial key-value pairs for the map. */
    entries: Record<
      string,
      {
        /**
         * The initial value for this key, which is either a primitive value or the ID of another LiveObject.
         */
        data: PublishObjectData;
      }
    >;
  };
}

/**
 * Operation to create a new map object at the specified path with initial entries.
 */
export type RestObjectOperationMapCreate = RestObjectOperationBase &
  Partial<TargetByPath> &
  RestObjectOperationMapCreateBody;

/**
 * Operation to create a new map object with a client-generated object ID and initial entries.
 * Use {@link RestObject.generateObjectId} to generate the object ID, nonce, and initial value
 * needed for this operation.
 */
export type RestObjectOperationMapCreateWithObjectId = RestObjectOperationBase & {
  /**
   * The object ID for the new map object.
   * Use {@link RestObject.generateObjectId} to generate this value along with the matching nonce and initial value.
   */
  objectId: string;
  /** The map creation parameters for a pre-computed object ID. */
  mapCreateWithObjectId: {
    /**
     * JSON-encoded string representation of the {@link RestObjectOperationMapCreate.mapCreate} object.
     * Binary values in entries must be Base64-encoded in this JSON string.
     * For example: `'{"semantics":"lww","entries":{"name":{"data":{"string":"Alice"}}}}'`.
     */
    initialValue: string;
    /** Random string used to generate the object ID. */
    nonce: string;
  };
};

/**
 * Operation to set a key to a specified value in an existing map object.
 * Can target the map by either object ID or path.
 */
export type RestObjectOperationMapSet = AnyTargetRestObjectOperationBase & {
  /** The map set parameters. */
  mapSet: {
    /** The key to set. */
    key: string;
    /** The value to assign to the key. */
    value: PublishObjectData;
  };
};

/**
 * Operation to remove a key from an existing map object.
 * Can target the map by either object ID or path.
 */
export type RestObjectOperationMapRemove = AnyTargetRestObjectOperationBase & {
  /** The map remove parameters. */
  mapRemove: {
    /** The key to remove. */
    key: string;
  };
};

/**
 * The counter creation payload, specifying the initial count for a new counter object.
 * Used as the body of {@link RestObjectOperationCounterCreate} and as input to {@link RestObject.generateObjectId}.
 */
export interface RestObjectOperationCounterCreateBody {
  /** The counter creation parameters. */
  counterCreate: {
    /** The initial value of the counter. */
    count: number;
  };
}

/**
 * Operation to create a new counter object at the specified path with an initial count value.
 */
export type RestObjectOperationCounterCreate = RestObjectOperationBase &
  Partial<TargetByPath> &
  RestObjectOperationCounterCreateBody;

/**
 * Operation to create a new counter object with a client-generated object ID and an initial count value.
 * Use {@link RestObject.generateObjectId} to generate the object ID, nonce, and initial value
 * needed for this operation.
 */
export type RestObjectOperationCounterCreateWithObjectId = RestObjectOperationBase & {
  /**
   * The object ID for the new counter object.
   * Use {@link RestObject.generateObjectId} to generate this value along with the matching nonce and initial value.
   */
  objectId: string;
  /** The counter creation parameters for a pre-computed object ID. */
  counterCreateWithObjectId: {
    /**
     * JSON-encoded string representation of the {@link RestObjectOperationCounterCreate.counterCreate} object.
     * For example: `'{"count":0}'`.
     */
    initialValue: string;
    /** Random string used to generate the object ID. */
    nonce: string;
  };
};

/**
 * Operation to increment (or decrement with negative values) an existing counter object.
 * Can target the counter by either object ID or path.
 */
export type RestObjectOperationCounterInc = AnyTargetRestObjectOperationBase & {
  /** The counter increment parameters. */
  counterInc: {
    /** The amount to increment by. Use a negative value to decrement. */
    number: number;
  };
};

/**
 * Union type representing all possible REST object operations.
 */
export type RestObjectOperation =
  | RestObjectOperationMapCreate
  | RestObjectOperationMapCreateWithObjectId
  | RestObjectOperationMapSet
  | RestObjectOperationMapRemove
  | RestObjectOperationCounterCreate
  | RestObjectOperationCounterCreateWithObjectId
  | RestObjectOperationCounterInc;

/**
 * Result returned after successfully publishing object operations via REST.
 * Contains information about the published message and affected object IDs.
 */
export interface RestObjectPublishResult {
  /** The ID of the message containing the published operations. */
  messageId: string;
  /** The name of the channel the object message was published to. */
  channel: string;
  /**
   * Array of object IDs that were affected by the operations.
   * May include multiple IDs for wildcard paths and batch operations.
   */
  objectIds: string[];
}

/**
 * Result returned by {@link RestObject.generateObjectId}, containing the generated object ID
 * and the values needed to construct a {@link RestObjectOperationMapCreateWithObjectId}
 * or {@link RestObjectOperationCounterCreateWithObjectId} operation.
 */
export interface RestObjectGenerateIdResult {
  /** The generated object ID. */
  objectId: string;
  /** The nonce used in ID generation. */
  nonce: string;
  /** The JSON-encoded initial value used in ID generation. */
  initialValue: string;
}

/**
 * Request parameters for {@link RestObject.get}.
 */
export interface RestObjectGetParams {
  /** The unique identifier of the object instance to fetch. If omitted, fetches from the channel object. */
  objectId?: string;
  /** A dot-separated path to return a subset of the object. Evaluated relative to the channel object or the specified objectId. */
  path?: string;
  /** When true (default), returns a values-only representation. When false, includes object IDs and type metadata. */
  compact?: boolean;
}

/**
 * Parameters for {@link RestObject.get} when requesting compact format (default).
 */
export type RestObjectGetCompactParams = Omit<RestObjectGetParams, 'compact'> & {
  /** Must be `true` or omitted for compact format. */
  compact?: true;
};

/**
 * Parameters for {@link RestObject.get} when requesting full object response format.
 */
export type RestObjectGetFullParams = Omit<RestObjectGetParams, 'compact'> & {
  /** Must be `false` for full object response format. */
  compact: false;
};

// Note: this type does not include arrays as no LiveObject type currently compacts
// into one, and json-typed values remain as JSON-encoded strings rather than being parsed.
/**
 * Result of {@link RestObject.get} when `compact` is `true` (default).
 * Represents a compacted view of the object on a channel or its leaf value.
 */
export type RestObjectGetCompactResult =
  | JsonScalar
  | Buffer
  | ArrayBuffer
  | { [key: string]: RestObjectGetCompactResult };

/**
 * Result of {@link RestObject.get} when `compact` is `false`.
 *
 * One of:
 * - A {@link RestLiveMap} or {@link RestLiveCounter} with full object metadata and decoded data values.
 * - An {@link AnyRestLiveObject} for unrecognized object types.
 * - A {@link RestObjectData | ObjectData} leaf value when the path resolves to a primitive entry in a map.
 *
 * In all cases, `bytes` values are decoded to `Buffer`/`ArrayBuffer` and `json` values are decoded
 * to native objects/arrays.
 */
export type RestObjectGetFullResult = RestLiveObject | RestObjectData;

/**
 * A full object structure including object IDs and type metadata, returned as part of {@link RestObjectGetFullResult}.
 */
export type RestLiveObject = RestLiveMap | RestLiveCounter | AnyRestLiveObject;

/**
 * Full object structure of a map object with metadata.
 */
export interface RestLiveMap {
  /** The ID of the map object. */
  objectId: string;
  /** Describes the value of a map object. */
  map: {
    /** The conflict-resolution semantics used by the map object, one of the {@link ObjectsMapSemantics} enum values. */
    semantics: ObjectsMapSemantics;
    /** The map entries, indexed by key. */
    entries: Record<string, RestObjectDataMapEntry | RestLiveObjectMapEntry>;
  };
}

/**
 * A map entry containing a primitive leaf value.
 */
export interface RestObjectDataMapEntry {
  /** The decoded object data for this entry. */
  data: RestObjectData;
}

/**
 * A map entry containing a nested LiveObject.
 */
export interface RestLiveObjectMapEntry {
  /** The nested LiveObject at this entry. */
  data: RestLiveObject;
}

/**
 * Full object structure of a counter object with metadata.
 */
export interface RestLiveCounter {
  /** The ID of the counter object. */
  objectId: string;
  /** Describes the value of a counter object. */
  counter: {
    /** Holds the value of the counter. */
    data: {
      /** The value of the counter. */
      number: number;
    };
  };
}

/**
 * Fallback type for compatibility with future object types.
 */
export type AnyRestLiveObject = {
  /** The ID of the object, available for all object types. */
  objectId: string;
};

/**
 * A decoded leaf data value in the full {@link RestObject.get} responses.
 */
type RestObjectData = Omit<ObjectData, 'value'>;

/**
 * Enables the Objects to be read, modified and subscribed to for a realtime channel.
 */
export declare interface RealtimeObject {
  /**
   * Retrieves a {@link PathObject} for the object on a channel.
   * Implicitly {@link RealtimeChannel.attach | attaches to the channel} if not already attached.
   *
   * A type parameter can be provided to describe the structure of the Objects on the channel.
   *
   * Example:
   *
   * ```typescript
   * import { LiveCounter } from '@ably/pubsub-core/liveobjects';
   *
   * type MyObject = {
   *   myTypedCounter: LiveCounter;
   * };
   *
   * const myTypedObject = await channel.object.get<MyObject>();
   * ```
   *
   * @returns A promise which, upon success, will be fulfilled with a {@link PathObject}. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  get<T extends Record<string, Value>>(): Promise<PathObject<LiveMap<T>>>;

  /**
   * Registers the provided listener for the specified event. If `on()` is called more than once with the same listener and event, the listener is added multiple times to its listener registry. Therefore, as an example, assuming the same listener is registered twice using `on()`, and an event is emitted once, the listener would be invoked twice.
   *
   * @param event - The named event to listen for.
   * @param callback - The event listener.
   * @returns A {@link StatusSubscription} object that allows the provided listener to be deregistered from future updates.
   */
  on(event: ObjectsEvent, callback: ObjectsEventCallback): StatusSubscription;

  /**
   * Removes all registrations that match both the specified listener and the specified event.
   *
   * @param event - The named event.
   * @param callback - The event listener.
   */
  off(event: ObjectsEvent, callback: ObjectsEventCallback): void;
}

/**
 * Primitive types that can be stored in collection types.
 * Includes JSON-serializable data so that maps and lists can hold plain JS values.
 */
export type Primitive =
  | string
  | number
  | boolean
  | Buffer
  | ArrayBuffer
  // JSON-serializable primitive values
  | JsonArray
  | JsonObject;

/**
 * Represents a JSON-encodable value.
 */
export type Json = JsonScalar | JsonArray | JsonObject;

/**
 * Represents a JSON-encodable scalar value.
 */
export type JsonScalar = null | boolean | number | string;

/**
 * Represents a JSON-encodable array.
 */
export type JsonArray = Json[];

/**
 * Represents a JSON-encodable object.
 */
export type JsonObject = { [prop: string]: Json | undefined };

// Branded interfaces that enables TypeScript to distinguish
// between LiveObject types even when they have identical structure (empty interfaces in this case).
// Enables PathObject<T> to dispatch to correct method sets via conditional types.
/**
 * A {@link LiveMap} is a collection type that maps string keys to values, which can be either primitive values or other LiveObjects.
 */
export interface LiveMap<_T extends Record<string, Value> = Record<string, Value>> {
  /** LiveMap type symbol */
  [__livetype]: 'LiveMap';
}

/**
 * A {@link LiveCounter} is a numeric type that supports atomic increment and decrement operations.
 */
export interface LiveCounter {
  /** LiveCounter type symbol */
  [__livetype]: 'LiveCounter';
}

/**
 * Type union that matches any LiveObject type that can be mutated, subscribed to, etc.
 */
export type LiveObject = LiveMap | LiveCounter;

/**
 * Type union that defines the base set of allowed types that can be stored in collection types.
 * Describes the set of all possible values that can parameterize PathObject.
 * This is the canonical union used when a narrower type cannot be inferred.
 */
export type Value = LiveObject | Primitive;

/**
 * CompactedValue transforms LiveObject types into in-memory JavaScript equivalents.
 * LiveMap becomes an object, LiveCounter becomes a number, primitive values remain unchanged.
 */
export type CompactedValue<T extends Value> =
  // LiveMap types
  [T] extends [LiveMap<infer U>]
    ? { [K in keyof U]: CompactedValue<U[K]> }
    : [T] extends [LiveMap<infer U> | undefined]
      ? { [K in keyof U]: CompactedValue<U[K]> } | undefined
      : // LiveCounter types
        [T] extends [LiveCounter]
        ? number
        : [T] extends [LiveCounter | undefined]
          ? number | undefined
          : // Other primitive types
            [T] extends [Primitive]
            ? T
            : [T] extends [Primitive | undefined]
              ? T
              : any;

/**
 * Represents a cyclic object reference in a JSON-serializable format.
 */
export interface ObjectIdReference {
  /** The referenced object Id. */
  objectId: string;
}

/**
 * CompactedJsonValue transforms LiveObject types into JSON-serializable equivalents.
 * LiveMap becomes an object, LiveCounter becomes a number, binary values become base64-encoded strings,
 * other primitives remain unchanged.
 *
 * Additionally, cyclic references are represented as `{ objectId: string }` instead of in-memory pointers to same objects.
 */
export type CompactedJsonValue<T extends Value> =
  // LiveMap types - note: cyclic references become ObjectIdReference
  [T] extends [LiveMap<infer U>]
    ? { [K in keyof U]: CompactedJsonValue<U[K]> } | ObjectIdReference
    : [T] extends [LiveMap<infer U> | undefined]
      ? { [K in keyof U]: CompactedJsonValue<U[K]> } | ObjectIdReference | undefined
      : // LiveCounter types
        [T] extends [LiveCounter]
        ? number
        : [T] extends [LiveCounter | undefined]
          ? number | undefined
          : // Binary types (converted to base64 strings)
            [T] extends [ArrayBuffer]
            ? string
            : [T] extends [ArrayBuffer | undefined]
              ? string | undefined
              : [T] extends [ArrayBufferView]
                ? string
                : [T] extends [ArrayBufferView | undefined]
                  ? string | undefined
                  : // Other primitive types
                    [T] extends [Primitive]
                    ? T
                    : [T] extends [Primitive | undefined]
                      ? T
                      : any;

/**
 * PathObjectBase defines the set of common methods on a PathObject
 * that are present regardless of the underlying type.
 */
interface PathObjectBase {
  /**
   * Get the fully-qualified path string for this PathObject.
   *
   * Path segments with dots in them are escaped with a backslash.
   * For example, a path with segments `['a', 'b.c', 'd']` will be represented as `a.b\.c.d`.
   */
  path(): string;

  /**
   * Registers a listener that is called each time the object or a primitive value at this path is updated.
   *
   * The provided listener receives a {@link PathObject} representing the path at which there was an object change,
   * and, if applicable, an {@link ObjectMessage} that carried the operation that led to the change.
   *
   * By default, subscriptions observe nested changes, but you can configure the observation depth
   * using the `options` parameter.
   *
   * A PathObject subscription observes whichever value currently exists at this path.
   * The subscription remains active even if the path temporarily does not resolve to any value
   * (for example, if an entry is removed from a map). If the object instance at this path changes,
   * the subscription automatically switches to observe the new instance and stops observing the old one.
   *
   * @param listener - An event listener function.
   * @param options - Optional subscription configuration.
   * @returns A {@link Subscription} object that allows the provided listener to be deregistered from future updates.
   */
  subscribe(
    listener: EventCallback<PathObjectSubscriptionEvent>,
    options?: PathObjectSubscriptionOptions,
  ): Subscription;

  /**
   * Registers a subscription listener and returns an async iterator that yields
   * subscription events each time the object or a primitive value at this path is updated.
   *
   * This method functions in the same way as the regular {@link PathObjectBase.subscribe | PathObject.subscribe()} method,
   * but instead returns an async iterator that can be used in a `for await...of` loop for convenience.
   *
   * @param options - Optional subscription configuration.
   * @returns An async iterator that yields {@link PathObjectSubscriptionEvent} objects.
   */
  subscribeIterator(options?: PathObjectSubscriptionOptions): AsyncIterableIterator<PathObjectSubscriptionEvent>;
}

/**
 * PathObjectCollectionMethods defines the set of common methods on a PathObject
 * that are present for any collection type, regardless of the specific underlying type.
 */
interface PathObjectCollectionMethods {
  /**
   * Collection types support obtaining a PathObject with a fully-qualified string path,
   * which is evaluated from the current path.
   * Using this method loses rich compile-time type information.
   *
   * @param path - A fully-qualified path string to navigate to, relative to the current path.
   * @returns A {@link PathObject} for the specified path.
   */
  at<T extends Value = Value>(path: string): PathObject<T>;
}

/**
 * Defines collection methods available on a {@link LiveMapPathObject}.
 */
interface LiveMapPathObjectCollectionMethods<T extends Record<string, Value> = Record<string, Value>> {
  /**
   * Returns an iterable of key-value pairs for each entry in the map at this path.
   * Each value is represented as a {@link PathObject} corresponding to its key.
   *
   * If the path does not resolve to a map object, returns an empty iterator.
   */
  entries(): IterableIterator<[keyof T, PathObject<T[keyof T]>]>;

  /**
   * Returns an iterable of keys in the map at this path.
   *
   * If the path does not resolve to a map object, returns an empty iterator.
   */
  keys(): IterableIterator<keyof T>;

  /**
   * Returns an iterable of values in the map at this path.
   * Each value is represented as a {@link PathObject}.
   *
   * If the path does not resolve to a map object, returns an empty iterator.
   */
  values(): IterableIterator<PathObject<T[keyof T]>>;

  /**
   * Returns the number of entries in the map at this path.
   *
   * If the path does not resolve to a map object, returns `undefined`.
   */
  size(): number | undefined;
}

/**
 * A PathObject representing a {@link LiveMap} instance at a specific path.
 * The type parameter T describes the expected structure of the map's entries.
 */
export interface LiveMapPathObject<T extends Record<string, Value> = Record<string, Value>>
  extends PathObjectBase,
    PathObjectCollectionMethods,
    LiveMapPathObjectCollectionMethods<T>,
    LiveMapOperations<T> {
  /**
   * Navigate to a child path within the map by obtaining a PathObject for that path.
   * The next path segment in a LiveMap is identified with a string key.
   *
   * @param key - A string key for the next path segment within the map.
   * @returns A {@link PathObject} for the specified key.
   */
  get<K extends keyof T & string>(key: K): PathObject<T[K]>;

  /**
   * Get the specific map instance currently at this path.
   * If the path does not resolve to any specific instance, returns `undefined`.
   *
   * @returns The {@link LiveMapInstance} at this path, or `undefined` if none exists.
   */
  instance(): LiveMapInstance<T> | undefined;

  /**
   * Get an in-memory JavaScript object representation of the map at this path.
   * Cyclic references are handled through memoization, returning shared compacted
   * object references for previously visited objects. This means the value returned
   * from `compact()` cannot be directly JSON-stringified if the object may contain cycles.
   *
   * If the path does not resolve to any specific instance, returns `undefined`.
   *
   * Use {@link LiveMapPathObject.compactJson | compactJson()} for a JSON-serializable representation.
   */
  compact(): CompactedValue<LiveMap<T>> | undefined;

  /**
   * Get a JSON-serializable representation of the map at this path.
   * Binary values are converted to base64-encoded strings.
   * Cyclic references are represented as `{ objectId: string }` instead of in-memory pointers,
   * making the result safe to pass to `JSON.stringify()`.
   *
   * If the path does not resolve to any specific instance, returns `undefined`.
   *
   * Use {@link LiveMapPathObject.compact | compact()} for an in-memory representation.
   */
  compactJson(): CompactedJsonValue<LiveMap<T>> | undefined;
}

/**
 * A PathObject representing a {@link LiveCounter} instance at a specific path.
 */
export interface LiveCounterPathObject extends PathObjectBase, LiveCounterOperations {
  /**
   * Get the current value of the counter instance currently at this path.
   * If the path does not resolve to any specific instance, returns `undefined`.
   */
  value(): number | undefined;

  /**
   * Get the specific counter instance currently at this path.
   * If the path does not resolve to any specific instance, returns `undefined`.
   *
   * @returns The {@link LiveCounterInstance} at this path, or `undefined` if none exists.
   */
  instance(): LiveCounterInstance | undefined;

  /**
   * Get a number representation of the counter at this path.
   * This is an alias for calling {@link LiveCounterPathObject.value | value()}.
   *
   * If the path does not resolve to any specific instance, returns `undefined`.
   */
  compact(): CompactedValue<LiveCounter> | undefined;

  /**
   * Get a number representation of the counter at this path.
   * This is an alias for calling {@link LiveCounterPathObject.value | value()}.
   *
   * If the path does not resolve to any specific instance, returns `undefined`.
   */
  compactJson(): CompactedJsonValue<LiveCounter> | undefined;
}

/**
 * A PathObject representing a primitive value at a specific path.
 */
export interface PrimitivePathObject<T extends Primitive = Primitive> extends PathObjectBase {
  /**
   * Get the current value of the primitive currently at this path.
   * If the path does not resolve to any specific entry, returns `undefined`.
   */
  value(): T | undefined;

  /**
   * Get a JavaScript object representation of the primitive value at this path.
   * This is an alias for calling {@link PrimitivePathObject.value | value()}.
   *
   * If the path does not resolve to any specific entry, returns `undefined`.
   */
  compact(): CompactedValue<T> | undefined;

  /**
   * Get a JSON-serializable representation of the primitive value at this path.
   * Binary values are converted to base64-encoded strings.
   *
   * If the path does not resolve to any specific entry, returns `undefined`.
   */
  compactJson(): CompactedJsonValue<T> | undefined;
}

/**
 * AnyPathObjectCollectionMethods defines all possible methods available on a PathObject
 * for the underlying collection types.
 */
interface AnyPathObjectCollectionMethods {
  // LiveMap collection methods

  /**
   * Returns an iterable of key-value pairs for each entry in the map, if the path resolves to a {@link LiveMap}.
   * Each value is represented as a {@link PathObject} corresponding to its key.
   *
   * If the path does not resolve to a map object, returns an empty iterator.
   */
  entries<T extends Record<string, Value>>(): IterableIterator<[keyof T, PathObject<T[keyof T]>]>;

  /**
   * Returns an iterable of keys in the map, if the path resolves to a {@link LiveMap}.
   *
   * If the path does not resolve to a map object, returns an empty iterator.
   */
  keys<T extends Record<string, Value>>(): IterableIterator<keyof T>;

  /**
   * Returns an iterable of values in the map, if the path resolves to a {@link LiveMap}.
   * Each value is represented as a {@link PathObject}.
   *
   * If the path does not resolve to a map object, returns an empty iterator.
   */
  values<T extends Record<string, Value>>(): IterableIterator<PathObject<T[keyof T]>>;

  /**
   * Returns the number of entries in the map, if the path resolves to a {@link LiveMap}.
   *
   * If the path does not resolve to a map object, returns `undefined`.
   */
  size(): number | undefined;
}

/**
 * Represents a {@link PathObject} when its underlying type is not known.
 * Provides a unified interface that includes all possible methods.
 *
 * Each method supports type parameters to specify the expected
 * underlying type when needed.
 */
export interface AnyPathObject
  extends PathObjectBase,
    PathObjectCollectionMethods,
    AnyPathObjectCollectionMethods,
    AnyOperations {
  /**
   * Navigate to a child path within the collection by obtaining a PathObject for that path.
   * The next path segment in a collection is identified with a string key.
   *
   * @param key - A string key for the next path segment within the collection.
   * @returns A {@link PathObject} for the specified key.
   */
  get<T extends Value = Value>(key: string): PathObject<T>;

  /**
   * Get the current value of the LiveCounter or primitive currently at this path.
   * If the path does not resolve to any specific entry, returns `undefined`.
   */
  value<T extends number | Primitive = number | Primitive>(): T | undefined;

  /**
   * Get an instance wrapping the value currently at this path, whether it is a
   * {@link LiveMap}, {@link LiveCounter} or a primitive value.
   * If the path does not resolve, returns `undefined`.
   *
   * @returns An {@link Instance} wrapping the value at this path, or `undefined` if the path does not resolve.
   */
  instance<T extends Value = Value>(): Instance<T> | undefined;

  /**
   * Get an in-memory JavaScript object representation of the object at this path.
   * For primitive types, this is an alias for calling {@link AnyPathObject.value | value()}.
   *
   * When compacting a {@link LiveMap}, cyclic references are handled through
   * memoization, returning shared compacted object references for previously
   * visited objects. This means the value returned from `compact()` cannot be
   * directly JSON-stringified if the object may contain cycles.
   *
   * If the path does not resolve to any specific entry, returns `undefined`.
   *
   * Use {@link AnyPathObject.compactJson | compactJson()} for a JSON-serializable representation.
   */
  compact<T extends Value = Value>(): CompactedValue<T> | undefined;

  /**
   * Get a JSON-serializable representation of the object at this path.
   * Binary values are converted to base64-encoded strings.
   *
   * When compacting a {@link LiveMap}, cyclic references are represented as `{ objectId: string }`
   * instead of in-memory pointers, making the result safe to pass to `JSON.stringify()`.
   *
   * If the path does not resolve to any specific entry, returns `undefined`.
   *
   * Use {@link AnyPathObject.compact | compact()} for an in-memory representation.
   */
  compactJson<T extends Value = Value>(): CompactedJsonValue<T> | undefined;
}

/**
 * PathObject wraps a reference to a path starting from the entrypoint object on a channel.
 * The type parameter specifies the underlying type defined at that path,
 * and is used to infer the correct set of methods available for that type.
 */
export type PathObject<T extends Value = Value> = [T] extends [LiveMap<infer U>]
  ? LiveMapPathObject<U>
  : [T] extends [LiveCounter]
    ? LiveCounterPathObject
    : [T] extends [Primitive]
      ? PrimitivePathObject<T>
      : AnyPathObject;

/**
 * BatchContextBase defines the set of common methods on a BatchContext
 * that are present regardless of the underlying type.
 */
interface BatchContextBase {
  /**
   * Get the object ID of the underlying instance.
   *
   * If the underlying instance at runtime is not a {@link LiveObject}, returns `undefined`.
   */
  readonly id: string | undefined;
}

/**
 * Defines collection methods available on a {@link LiveMapBatchContext}.
 */
interface LiveMapBatchContextCollectionMethods<T extends Record<string, Value> = Record<string, Value>> {
  /**
   * Returns an iterable of key-value pairs for each entry in the map.
   * Each value is represented as a {@link BatchContext} corresponding to its key.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  entries(): IterableIterator<[keyof T, BatchContext<T[keyof T]>]>;

  /**
   * Returns an iterable of keys in the map.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  keys(): IterableIterator<keyof T>;

  /**
   * Returns an iterable of values in the map.
   * Each value is represented as a {@link BatchContext}.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  values(): IterableIterator<BatchContext<T[keyof T]>>;

  /**
   * Returns the number of entries in the map.
   *
   * If the underlying instance at runtime is not a map, returns `undefined`.
   */
  size(): number | undefined;
}

/**
 * LiveMapBatchContext is a batch context wrapper for a LiveMap object.
 * The type parameter T describes the expected structure of the map's entries.
 */
export interface LiveMapBatchContext<T extends Record<string, Value> = Record<string, Value>>
  extends BatchContextBase,
    BatchContextLiveMapOperations<T>,
    LiveMapBatchContextCollectionMethods<T> {
  /**
   * Returns the value associated with a given key as a {@link BatchContext}.
   *
   * Returns `undefined` if the key doesn't exist in the map, if the referenced {@link LiveObject} has been deleted,
   * or if this map object itself has been deleted.
   *
   * @param key - The key to retrieve the value for.
   * @returns A {@link BatchContext} representing a {@link LiveObject}, a primitive type (string, number, boolean, JSON-serializable object or array, or binary data) or `undefined` if the key doesn't exist in a map or the referenced {@link LiveObject} has been deleted. Always `undefined` if this map object is deleted.
   */
  get<K extends keyof T & string>(key: K): BatchContext<T[K]> | undefined;

  /**
   * Get an in-memory JavaScript object representation of the map instance.
   * Cyclic references are handled through memoization, returning shared compacted
   * object references for previously visited objects. This means the value returned
   * from `compact()` cannot be directly JSON-stringified if the object may contain cycles.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   *
   * Use {@link LiveMapBatchContext.compactJson | compactJson()} for a JSON-serializable representation.
   */
  compact(): CompactedValue<LiveMap<T>> | undefined;

  /**
   * Get a JSON-serializable representation of the map instance.
   * Binary values are converted to base64-encoded strings.
   * Cyclic references are represented as `{ objectId: string }` instead of in-memory pointers,
   * making the result safe to pass to `JSON.stringify()`.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   *
   * Use {@link LiveMapBatchContext.compact | compact()} for an in-memory representation.
   */
  compactJson(): CompactedJsonValue<LiveMap<T>> | undefined;
}

/**
 * LiveCounterBatchContext is a batch context wrapper for a LiveCounter object.
 */
export interface LiveCounterBatchContext extends BatchContextBase, BatchContextLiveCounterOperations {
  /**
   * Get the current value of the counter instance.
   * If the underlying instance at runtime is not a counter, returns `undefined`.
   */
  value(): number | undefined;

  /**
   * Get a number representation of the counter instance.
   * This is an alias for calling {@link LiveCounterBatchContext.value | value()}.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   */
  compact(): CompactedValue<LiveCounter> | undefined;

  /**
   * Get a number representation of the counter instance.
   * This is an alias for calling {@link LiveCounterBatchContext.value | value()}.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   */
  compactJson(): CompactedJsonValue<LiveCounter> | undefined;
}

/**
 * PrimitiveBatchContext is a batch context wrapper for a primitive value (string, number, boolean, JSON-serializable object or array, or binary data).
 */
export interface PrimitiveBatchContext<T extends Primitive = Primitive> {
  /**
   * Get the underlying primitive value.
   * If the underlying instance at runtime is not a primitive value, returns `undefined`.
   */
  value(): T | undefined;

  /**
   * Get a JavaScript object representation of the primitive value.
   * This is an alias for calling {@link PrimitiveBatchContext.value | value()}.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   */
  compact(): CompactedValue<T> | undefined;

  /**
   * Get a JSON-serializable representation of the primitive value.
   * Binary values are converted to base64-encoded strings.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   */
  compactJson(): CompactedJsonValue<T> | undefined;
}

/**
 * AnyBatchContextCollectionMethods defines all possible methods available on an BatchContext object
 * for the underlying collection types.
 */
interface AnyBatchContextCollectionMethods {
  // LiveMap collection methods

  /**
   * Returns an iterable of key-value pairs for each entry in the map.
   * Each value is represented as an {@link BatchContext} corresponding to its key.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  entries<T extends Record<string, Value>>(): IterableIterator<[keyof T, BatchContext<T[keyof T]>]>;

  /**
   * Returns an iterable of keys in the map.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  keys<T extends Record<string, Value>>(): IterableIterator<keyof T>;

  /**
   * Returns an iterable of values in the map.
   * Each value is represented as a {@link BatchContext}.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  values<T extends Record<string, Value>>(): IterableIterator<BatchContext<T[keyof T]>>;

  /**
   * Returns the number of entries in the map.
   *
   * If the underlying instance at runtime is not a map, returns `undefined`.
   */
  size(): number | undefined;
}

/**
 * Represents a {@link BatchContext} when its underlying type is not known.
 * Provides a unified interface that includes all possible methods.
 *
 * Each method supports type parameters to specify the expected
 * underlying type when needed.
 */
export interface AnyBatchContext extends BatchContextBase, AnyBatchContextCollectionMethods, BatchContextAnyOperations {
  /**
   * Navigate to a child entry within the collection by obtaining the {@link BatchContext} at that entry.
   * The entry in a collection is identified with a string key.
   *
   * Returns `undefined` if:
   * - The underlying instance at runtime is not a collection object.
   * - The specified key does not exist in the collection.
   * - The referenced {@link LiveObject} has been deleted.
   * - This collection object itself has been deleted.
   *
   * @param key - The key to retrieve the value for.
   * @returns A {@link BatchContext} representing either a {@link LiveObject} or a primitive value (string, number, boolean, JSON-serializable object or array, or binary data), or `undefined` if the underlying instance at runtime is not a collection object, the key does not exist, the referenced {@link LiveObject} has been deleted, or this collection object itself has been deleted.
   */
  get<T extends Value = Value>(key: string): BatchContext<T> | undefined;

  /**
   * Get the current value of the underlying counter or primitive.
   *
   * If the underlying instance at runtime is neither a counter nor a primitive value, returns `undefined`.
   *
   * @returns The current value of the underlying primitive or counter, or `undefined` if the value cannot be retrieved.
   */
  value<T extends number | Primitive = number | Primitive>(): T | undefined;

  /**
   * Get an in-memory JavaScript object representation of the object instance.
   * For primitive types, this is an alias for calling {@link AnyBatchContext.value | value()}.
   *
   * When compacting a {@link LiveMap}, cyclic references are handled through
   * memoization, returning shared compacted object references for previously
   * visited objects. This means the value returned from `compact()` cannot be
   * directly JSON-stringified if the object may contain cycles.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   *
   * Use {@link AnyBatchContext.compactJson | compactJson()} for a JSON-serializable representation.
   */
  compact<T extends Value = Value>(): CompactedValue<T> | undefined;

  /**
   * Get a JSON-serializable representation of the object instance.
   * Binary values are converted to base64-encoded strings.
   *
   * When compacting a {@link LiveMap}, cyclic references are represented as `{ objectId: string }`
   * instead of in-memory pointers, making the result safe to pass to `JSON.stringify()`.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   *
   * Use {@link AnyBatchContext.compact | compact()} for an in-memory representation.
   */
  compactJson<T extends Value = Value>(): CompactedJsonValue<T> | undefined;
}

/**
 * BatchContext wraps a specific object instance or entry in a specific collection
 * object instance and provides synchronous operation methods that can be aggregated
 * and applied as a single batch operation.
 *
 * The type parameter specifies the underlying type of the instance,
 * and is used to infer the correct set of methods available for that type.
 */
export type BatchContext<T extends Value> = [T] extends [LiveMap<infer U>]
  ? LiveMapBatchContext<U>
  : [T] extends [LiveCounter]
    ? LiveCounterBatchContext
    : [T] extends [Primitive]
      ? PrimitiveBatchContext<T>
      : AnyBatchContext;

/**
 * Defines operations available on {@link LiveMapBatchContext}.
 */
interface BatchContextLiveMapOperations<T extends Record<string, Value> = Record<string, Value>> {
  /**
   * Adds an operation to the current batch to set a key to a specified value on the underlying
   * {@link LiveMapInstance}. All queued operations are sent together in a single message once the
   * batch function completes.
   *
   * If the underlying instance at runtime is not a map, this method throws an error.
   *
   * This does not modify the underlying data of the map. Instead, when the batch function returns, the
   * batched operations are sent to Ably. Once accepted, they are applied locally before the
   * promise returned by {@link BatchOperations.batch | batch()} resolves.
   *
   * @param key - The key to set the value for.
   * @param value - The value to assign to the key.
   */
  set<K extends keyof T & string>(key: K, value: T[K]): void;

  /**
   * Adds an operation to the current batch to remove a key from the underlying
   * {@link LiveMapInstance}. All queued operations are sent together in a single message once the
   * batch function completes.
   *
   * If the underlying instance at runtime is not a map, this method throws an error.
   *
   * This does not modify the underlying data of the map. Instead, when the batch function returns, the
   * batched operations are sent to Ably. Once accepted, they are applied locally before the
   * promise returned by {@link BatchOperations.batch | batch()} resolves.
   *
   * @param key - The key to remove.
   */
  remove(key: keyof T & string): void;
}

/**
 * Defines operations available on {@link LiveCounterBatchContext}.
 */
interface BatchContextLiveCounterOperations {
  /**
   * Adds an operation to the current batch to increment the value of the underlying
   * {@link LiveCounterInstance}. All queued operations are sent together in a single message once the
   * batch function completes.
   *
   * If the underlying instance at runtime is not a counter, this method throws an error.
   *
   * This does not modify the underlying data of the counter. Instead, when the batch function returns, the
   * batched operations are sent to Ably. Once accepted, they are applied locally before the
   * promise returned by {@link BatchOperations.batch | batch()} resolves.
   *
   * @param amount - The amount by which to increase the counter value. If not provided, defaults to 1.
   */
  increment(amount?: number): void;

  /**
   * An alias for calling {@link BatchContextLiveCounterOperations.increment | increment(-amount)}
   *
   * @param amount - The amount by which to decrease the counter value. If not provided, defaults to 1.
   */
  decrement(amount?: number): void;
}

/**
 * Defines all possible operations available on {@link BatchContext} objects.
 */
interface BatchContextAnyOperations {
  // LiveMap operations

  /**
   * Adds an operation to the current batch to set a key to a specified value on the underlying
   * {@link LiveMapInstance}. All queued operations are sent together in a single message once the
   * batch function completes.
   *
   * If the underlying instance at runtime is not a map, this method throws an error.
   *
   * This does not modify the underlying data of the map. Instead, when the batch function returns, the
   * batched operations are sent to Ably. Once accepted, they are applied locally before the
   * promise returned by {@link BatchOperations.batch | batch()} resolves.
   *
   * @param key - The key to set the value for.
   * @param value - The value to assign to the key.
   */
  set<T extends Record<string, Value> = Record<string, Value>>(key: keyof T & string, value: T[keyof T]): void;

  /**
   * Adds an operation to the current batch to remove a key from the underlying
   * {@link LiveMapInstance}. All queued operations are sent together in a single message once the
   * batch function completes.
   *
   * If the underlying instance at runtime is not a map, this method throws an error.
   *
   * This does not modify the underlying data of the map. Instead, when the batch function returns, the
   * batched operations are sent to Ably. Once accepted, they are applied locally before the
   * promise returned by {@link BatchOperations.batch | batch()} resolves.
   *
   * @param key - The key to remove.
   */
  remove<T extends Record<string, Value> = Record<string, Value>>(key: keyof T & string): void;

  // LiveCounter operations

  /**
   * Adds an operation to the current batch to increment the value of the underlying
   * {@link LiveCounterInstance}. All queued operations are sent together in a single message once the
   * batch function completes.
   *
   * If the underlying instance at runtime is not a counter, this method throws an error.
   *
   * This does not modify the underlying data of the counter. Instead, when the batch function returns, the
   * batched operations are sent to Ably. Once accepted, they are applied locally before the
   * promise returned by {@link BatchOperations.batch | batch()} resolves.
   *
   * @param amount - The amount by which to increase the counter value. If not provided, defaults to 1.
   */
  increment(amount?: number): void;

  /**
   * An alias for calling {@link BatchContextAnyOperations.increment | increment(-amount)}
   *
   * @param amount - The amount by which to decrease the counter value. If not provided, defaults to 1.
   */
  decrement(amount?: number): void;
}

/**
 * Defines batch operations available on {@link LiveObject | LiveObjects}.
 */
interface BatchOperations<T extends LiveObject> {
  /**
   * Batch multiple operations together using a batch context, which
   * wraps the underlying {@link PathObject} or {@link Instance} from which the batch was called.
   * The batch context always contains a resolved instance, even when called from a {@link PathObject}.
   * If an instance cannot be resolved from the referenced path, or if the instance is not a {@link LiveObject},
   * this method throws an error.
   *
   * Batching enables you to group multiple operations together and send them to the Ably service in a single channel message.
   * As a result, other clients will receive the changes in a single channel message once the batch function has completed.
   *
   * The objects' data is not modified inside the batch function. The batched operations are sent to Ably
   * and, once accepted, applied locally. The returned promise resolves after all operations have been applied.
   *
   * @param fn - A synchronous function that receives a {@link BatchContext} used to group operations together.
   * @returns A promise which resolves after all batched operations have been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  batch(fn: BatchFunction<T>): Promise<void>;
}

/**
 * Defines operations available on {@link LiveMap} objects.
 */
interface LiveMapOperations<T extends Record<string, Value> = Record<string, Value>>
  extends BatchOperations<LiveMap<T>> {
  /**
   * Sends an operation to the Ably system to set a key to a specified value on a given {@link LiveMapInstance},
   * or on the map instance resolved from the path when using {@link LiveMapPathObject}.
   *
   * If called via {@link LiveMapInstance} and the underlying instance at runtime is not a map,
   * or if called via {@link LiveMapPathObject} and the map instance at the specified path cannot
   * be resolved at the time of the call, this method throws an error.
   *
   * The operation is sent to Ably and, once accepted, applied locally. The returned promise resolves
   * after the operation has been applied.
   *
   * @param key - The key to set the value for.
   * @param value - The value to assign to the key.
   * @returns A promise which resolves after the operation has been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  set<K extends keyof T & string>(key: K, value: T[K]): Promise<void>;

  /**
   * Sends an operation to the Ably system to remove a key from a given {@link LiveMapInstance},
   * or from the map instance resolved from the path when using {@link LiveMapPathObject}.
   *
   * If called via {@link LiveMapInstance} and the underlying instance at runtime is not a map,
   * or if called via {@link LiveMapPathObject} and the map instance at the specified path cannot
   * be resolved at the time of the call, this method throws an error.
   *
   * The operation is sent to Ably and, once accepted, applied locally. The returned promise resolves
   * after the operation has been applied.
   *
   * @param key - The key to remove.
   * @returns A promise which resolves after the operation has been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  remove(key: keyof T & string): Promise<void>;
}

/**
 * Defines operations available on {@link LiveCounter} objects.
 */
interface LiveCounterOperations extends BatchOperations<LiveCounter> {
  /**
   * Sends an operation to the Ably system to increment the value of a given {@link LiveCounterInstance},
   * or of the counter instance resolved from the path when using {@link LiveCounterPathObject}.
   *
   * If called via {@link LiveCounterInstance} and the underlying instance at runtime is not a counter,
   * or if called via {@link LiveCounterPathObject} and the counter instance at the specified path cannot
   * be resolved at the time of the call, this method throws an error.
   *
   * The operation is sent to Ably and, once accepted, applied locally. The returned promise resolves
   * after the operation has been applied.
   *
   * @param amount - The amount by which to increase the counter value. If not provided, defaults to 1.
   * @returns A promise which resolves after the operation has been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  increment(amount?: number): Promise<void>;

  /**
   * An alias for calling {@link LiveCounterOperations.increment | increment(-amount)}
   *
   * @param amount - The amount by which to decrease the counter value. If not provided, defaults to 1.
   * @returns A promise which resolves after the operation has been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  decrement(amount?: number): Promise<void>;
}

/**
 * Defines all possible operations available on {@link LiveObject | LiveObjects}.
 */
interface AnyOperations {
  /**
   * Batch multiple operations together using a batch context, which
   * wraps the underlying {@link PathObject} or {@link Instance} from which the batch was called.
   * The batch context always contains a resolved instance, even when called from a {@link PathObject}.
   * If an instance cannot be resolved from the referenced path, or if the instance is not a {@link LiveObject},
   * this method throws an error.
   *
   * Batching enables you to group multiple operations together and send them to the Ably service in a single channel message.
   * As a result, other clients will receive the changes in a single channel message once the batch function has completed.
   *
   * The objects' data is not modified inside the batch function. The batched operations are sent to Ably
   * and, once accepted, applied locally. The returned promise resolves after all operations have been applied.
   *
   * @param fn - A synchronous function that receives a {@link BatchContext} used to group operations together.
   * @returns A promise which resolves after all batched operations have been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  batch<T extends LiveObject = LiveObject>(fn: BatchFunction<T>): Promise<void>;

  // LiveMap operations

  /**
   * Sends an operation to the Ably system to set a key to a specified value on the underlying map when using {@link AnyInstance},
   * or on the map instance resolved from the path when using {@link AnyPathObject}.
   *
   * If called via {@link AnyInstance} and the underlying instance at runtime is not a map,
   * or if called via {@link AnyPathObject} and the map instance at the specified path cannot
   * be resolved at the time of the call, this method throws an error.
   *
   * The operation is sent to Ably and, once accepted, applied locally. The returned promise resolves
   * after the operation has been applied.
   *
   * @param key - The key to set the value for.
   * @param value - The value to assign to the key.
   * @returns A promise which resolves after the operation has been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  set<T extends Record<string, Value> = Record<string, Value>>(key: keyof T & string, value: T[keyof T]): Promise<void>;

  /**
   * Sends an operation to the Ably system to remove a key from the underlying map when using {@link AnyInstance},
   * or from the map instance resolved from the path when using {@link AnyPathObject}.
   *
   * If called via {@link AnyInstance} and the underlying instance at runtime is not a map,
   * or if called via {@link AnyPathObject} and the map instance at the specified path cannot
   * be resolved at the time of the call, this method throws an error.
   *
   * The operation is sent to Ably and, once accepted, applied locally. The returned promise resolves
   * after the operation has been applied.
   *
   * @param key - The key to remove.
   * @returns A promise which resolves after the operation has been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  remove<T extends Record<string, Value> = Record<string, Value>>(key: keyof T & string): Promise<void>;

  // LiveCounter operations

  /**
   * Sends an operation to the Ably system to increment the value of the underlying counter when using {@link AnyInstance},
   * or of the counter instance resolved from the path when using {@link AnyPathObject}.
   *
   * If called via {@link AnyInstance} and the underlying instance at runtime is not a counter,
   * or if called via {@link AnyPathObject} and the counter instance at the specified path cannot
   * be resolved at the time of the call, this method throws an error.
   *
   * The operation is sent to Ably and, once accepted, applied locally. The returned promise resolves
   * after the operation has been applied.
   *
   * @param amount - The amount by which to increase the counter value. If not provided, defaults to 1.
   * @returns A promise which resolves after the operation has been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  increment(amount?: number): Promise<void>;

  /**
   * An alias for calling {@link AnyOperations.increment | increment(-amount)}
   *
   * @param amount - The amount by which to decrease the counter value. If not provided, defaults to 1.
   * @returns A promise which resolves after the operation has been accepted by Ably and applied locally, or rejects with an {@link ErrorInfo} object upon failure.
   */
  decrement(amount?: number): Promise<void>;
}

/**
 * InstanceBase defines the set of common methods on an Instance
 * that are present regardless of the underlying type specified in the type parameter T.
 */
interface InstanceBase<T extends Value> {
  /**
   * Get the object ID of the underlying instance.
   *
   * If the underlying instance at runtime is not a {@link LiveObject}, returns `undefined`.
   */
  readonly id: string | undefined;

  /**
   * Registers a listener that is called each time this instance is updated.
   *
   * If the underlying instance at runtime is not a {@link LiveObject}, this method throws an error.
   *
   * The provided listener receives an {@link Instance} representing the updated object,
   * and, if applicable, an {@link ObjectMessage} that carried the operation that led to the change.
   *
   * Instance subscriptions track a specific object instance regardless of its location.
   * The subscription follows the instance if it is moved within the broader structure
   * (for example, between map entries).
   *
   * If the instance is deleted from the channel object entirely (i.e., tombstoned),
   * the listener is called with the corresponding delete operation before
   * automatically deregistering.
   *
   * @param listener - An event listener function.
   * @returns A {@link Subscription} object that allows the provided listener to be deregistered from future updates.
   */
  subscribe(listener: EventCallback<InstanceSubscriptionEvent<T>>): Subscription;

  /**
   * Registers a subscription listener and returns an async iterator that yields
   * subscription events each time this instance is updated.
   *
   * This method functions in the same way as the regular {@link InstanceBase.subscribe | Instance.subscribe()} method,
   * but instead returns an async iterator that can be used in a `for await...of` loop for convenience.
   *
   * @returns An async iterator that yields {@link InstanceSubscriptionEvent} objects.
   */
  subscribeIterator(): AsyncIterableIterator<InstanceSubscriptionEvent<T>>;
}

/**
 * Defines collection methods available on a {@link LiveMapInstance}.
 */
interface LiveMapInstanceCollectionMethods<T extends Record<string, Value> = Record<string, Value>> {
  /**
   * Returns an iterable of key-value pairs for each entry in the map.
   * Each value is represented as an {@link Instance} corresponding to its key.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  entries(): IterableIterator<[keyof T, Instance<T[keyof T]>]>;

  /**
   * Returns an iterable of keys in the map.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  keys(): IterableIterator<keyof T>;

  /**
   * Returns an iterable of values in the map.
   * Each value is represented as an {@link Instance}.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  values(): IterableIterator<Instance<T[keyof T]>>;

  /**
   * Returns the number of entries in the map.
   *
   * If the underlying instance at runtime is not a map, returns `undefined`.
   */
  size(): number | undefined;
}

/**
 * LiveMapInstance represents an Instance of a LiveMap object.
 * The type parameter T describes the expected structure of the map's entries.
 */
export interface LiveMapInstance<T extends Record<string, Value> = Record<string, Value>>
  extends InstanceBase<LiveMap<T>>,
    LiveMapInstanceCollectionMethods<T>,
    LiveMapOperations<T> {
  /**
   * Returns the value associated with a given key as an {@link Instance}.
   *
   * If the associated value is a primitive, returns a {@link PrimitiveInstance}
   * that serves as a snapshot of the primitive value and does not reflect subsequent
   * changes to the value at that key.
   *
   * Returns `undefined` if the key doesn't exist in the map, if the referenced {@link LiveObject} has been deleted,
   * or if this map object itself has been deleted.
   *
   * @param key - The key to retrieve the value for.
   * @returns An {@link Instance} representing a {@link LiveObject}, a primitive type (string, number, boolean, JSON-serializable object or array, or binary data) or `undefined` if the key doesn't exist in a map or the referenced {@link LiveObject} has been deleted. Always `undefined` if this map object is deleted.
   */
  get<K extends keyof T & string>(key: K): Instance<T[K]> | undefined;

  /**
   * Get an in-memory JavaScript object representation of the map instance.
   * Cyclic references are handled through memoization, returning shared compacted
   * object references for previously visited objects. This means the value returned
   * from `compact()` cannot be directly JSON-stringified if the object may contain cycles.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   *
   * Use {@link LiveMapInstance.compactJson | compactJson()} for a JSON-serializable representation.
   */
  compact(): CompactedValue<LiveMap<T>> | undefined;

  /**
   * Get a JSON-serializable representation of the map instance.
   * Binary values are converted to base64-encoded strings.
   * Cyclic references are represented as `{ objectId: string }` instead of in-memory pointers,
   * making the result safe to pass to `JSON.stringify()`.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   *
   * Use {@link LiveMapInstance.compact | compact()} for an in-memory representation.
   */
  compactJson(): CompactedJsonValue<LiveMap<T>> | undefined;
}

/**
 * LiveCounterInstance represents an Instance of a LiveCounter object.
 */
export interface LiveCounterInstance extends InstanceBase<LiveCounter>, LiveCounterOperations {
  /**
   * Get the current value of the counter instance.
   * If the underlying instance at runtime is not a counter, returns `undefined`.
   */
  value(): number | undefined;

  /**
   * Get a number representation of the counter instance.
   * This is an alias for calling {@link LiveCounterInstance.value | value()}.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   */
  compact(): CompactedValue<LiveCounter> | undefined;

  /**
   * Get a number representation of the counter instance.
   * This is an alias for calling {@link LiveCounterInstance.value | value()}.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   */
  compactJson(): CompactedJsonValue<LiveCounter> | undefined;
}

/**
 * PrimitiveInstance represents a snapshot of a primitive value (string, number, boolean, JSON-serializable object or array, or binary data)
 * that was stored at a key within a collection type.
 */
export interface PrimitiveInstance<T extends Primitive = Primitive> {
  /**
   * Get the primitive value represented by this instance.
   * This reflects the value at the corresponding key in the collection at the time this instance was obtained.
   *
   * If the underlying instance at runtime is not a primitive value, returns `undefined`.
   */
  value(): T | undefined;

  /**
   * Get a JavaScript object representation of the primitive value.
   * This is an alias for calling {@link PrimitiveInstance.value | value()}.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   */
  compact(): CompactedValue<T> | undefined;

  /**
   * Get a JSON-serializable representation of the primitive value.
   * Binary values are converted to base64-encoded strings.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   */
  compactJson(): CompactedJsonValue<T> | undefined;
}

/**
 * AnyInstanceCollectionMethods defines all possible methods available on an Instance
 * for the underlying collection types.
 */
interface AnyInstanceCollectionMethods {
  // LiveMap collection methods

  /**
   * Returns an iterable of key-value pairs for each entry in the map.
   * Each value is represented as an {@link Instance} corresponding to its key.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  entries<T extends Record<string, Value>>(): IterableIterator<[keyof T, Instance<T[keyof T]>]>;

  /**
   * Returns an iterable of keys in the map.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  keys<T extends Record<string, Value>>(): IterableIterator<keyof T>;

  /**
   * Returns an iterable of values in the map.
   * Each value is represented as a {@link Instance}.
   *
   * If the underlying instance at runtime is not a map, returns an empty iterator.
   */
  values<T extends Record<string, Value>>(): IterableIterator<Instance<T[keyof T]>>;

  /**
   * Returns the number of entries in the map.
   *
   * If the underlying instance at runtime is not a map, returns `undefined`.
   */
  size(): number | undefined;
}

/**
 * Represents an {@link Instance} when its underlying type is not known.
 * Provides a unified interface that includes all possible methods.
 *
 * Each method supports type parameters to specify the expected
 * underlying type when needed.
 */
export interface AnyInstance<T extends Value> extends InstanceBase<T>, AnyInstanceCollectionMethods, AnyOperations {
  /**
   * Navigate to a child entry within the collection by obtaining the {@link Instance} at that entry.
   * The entry in a collection is identified with a string key.
   *
   * Returns `undefined` if:
   * - The underlying instance at runtime is not a collection object.
   * - The specified key does not exist in the collection.
   * - The referenced {@link LiveObject} has been deleted.
   * - This collection object itself has been deleted.
   *
   * @param key - The key to get the child entry for.
   * @returns An {@link Instance} representing either a {@link LiveObject} or a primitive value (string, number, boolean, JSON-serializable object or array, or binary data), or `undefined` if the underlying instance at runtime is not a collection object, the key does not exist, the referenced {@link LiveObject} has been deleted, or this collection object itself has been deleted.
   */
  get<T extends Value = Value>(key: string): Instance<T> | undefined;

  /**
   * Get the current value of the underlying counter or primitive.
   *
   * If the underlying value is a primitive, this reflects the value at the corresponding key
   * in the collection at the time this instance was obtained.
   *
   * If the underlying instance at runtime is neither a counter nor a primitive value, returns `undefined`.
   */
  value<T extends number | Primitive = number | Primitive>(): T | undefined;

  /**
   * Get an in-memory JavaScript object representation of the object instance.
   * For primitive types, this is an alias for calling {@link AnyInstance.value | value()}.
   *
   * When compacting a {@link LiveMap}, cyclic references are handled through
   * memoization, returning shared compacted object references for previously
   * visited objects. This means the value returned from `compact()` cannot be
   * directly JSON-stringified if the object may contain cycles.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   *
   * Use {@link AnyInstance.compactJson | compactJson()} for a JSON-serializable representation.
   */
  compact<T extends Value = Value>(): CompactedValue<T> | undefined;

  /**
   * Get a JSON-serializable representation of the object instance.
   * Binary values are converted to base64-encoded strings.
   *
   * When compacting a {@link LiveMap}, cyclic references are represented as `{ objectId: string }`
   * instead of in-memory pointers, making the result safe to pass to `JSON.stringify()`.
   *
   * If the underlying instance's value is not of the expected type at runtime, returns `undefined`.
   *
   * Use {@link AnyInstance.compact | compact()} for an in-memory representation.
   */
  compactJson<T extends Value = Value>(): CompactedJsonValue<T> | undefined;
}

/**
 * Instance wraps a specific object instance or entry in a specific collection object instance.
 * The type parameter specifies the underlying type of the instance,
 * and is used to infer the correct set of methods available for that type.
 */
export type Instance<T extends Value> = [T] extends [LiveMap<infer U>]
  ? LiveMapInstance<U>
  : [T] extends [LiveCounter]
    ? LiveCounterInstance
    : [T] extends [Primitive]
      ? PrimitiveInstance<T>
      : AnyInstance<T>;

/**
 * The event object passed to a {@link PathObject} subscription listener.
 */
export type PathObjectSubscriptionEvent = {
  /** The {@link PathObject} representing the path at which there was an object change. */
  object: PathObject;
  /** The {@link ObjectMessage} that carried the operation that led to the change, if applicable. */
  message?: ObjectMessage;
};

/**
 * Options that can be provided to {@link PathObjectBase.subscribe | PathObject.subscribe}.
 */
export interface PathObjectSubscriptionOptions {
  /**
   * The number of levels deep to observe changes in nested children.
   *
   * - If `undefined` (default), there is no depth limit, and changes at any depth
   * within nested children will be observed.
   * - A depth of `1` (the minimum) means that only changes to the object at the subscribed path
   * itself will be observed, not changes to its children.
   */
  depth?: number;
}

/**
 * The event object passed to an {@link Instance} subscription listener.
 */
export type InstanceSubscriptionEvent<T extends Value> = {
  /** The {@link Instance} representing the updated object. */
  object: Instance<T>;
  /** The {@link ObjectMessage} that carried the operation that led to the change, if applicable. */
  message?: ObjectMessage;
};

/**
 * The namespace containing the different types of object operation actions.
 */
declare namespace ObjectOperationActions {
  /**
   * Object operation action for a creating a map object.
   */
  type MAP_CREATE = 'map.create';
  /**
   * Object operation action for setting a key pair in a map object.
   */
  type MAP_SET = 'map.set';
  /**
   * Object operation action for removing a key from a map object.
   */
  type MAP_REMOVE = 'map.remove';
  /**
   * Object operation action for creating a counter object.
   */
  type COUNTER_CREATE = 'counter.create';
  /**
   * Object operation action for incrementing a counter object.
   */
  type COUNTER_INC = 'counter.inc';
  /**
   * Object operation action for deleting an object.
   */
  type OBJECT_DELETE = 'object.delete';
  /**
   * Object operation action for clearing a map object.
   */
  type MAP_CLEAR = 'map.clear';
  /**
   * Unrecognized object operation action received from the server.
   */
  type UNKNOWN = 'unknown';
}

/**
 * The possible values of the `action` field of an {@link ObjectOperation}.
 */
export type ObjectOperationAction =
  | ObjectOperationActions.MAP_CREATE
  | ObjectOperationActions.MAP_SET
  | ObjectOperationActions.MAP_REMOVE
  | ObjectOperationActions.COUNTER_CREATE
  | ObjectOperationActions.COUNTER_INC
  | ObjectOperationActions.OBJECT_DELETE
  | ObjectOperationActions.MAP_CLEAR
  | ObjectOperationActions.UNKNOWN;

/**
 * The namespace containing the different types of map object semantics.
 */
declare namespace ObjectsMapSemanticsNamespace {
  /**
   * Last-write-wins conflict-resolution semantics.
   */
  type LWW = 'lww';
  /**
   * Unrecognized semantics value received from the server.
   */
  type UNKNOWN = 'unknown';
}

/**
 * The possible values of the `semantics` field of an {@link ObjectsMap}.
 */
export type ObjectsMapSemantics = ObjectsMapSemanticsNamespace.LWW | ObjectsMapSemanticsNamespace.UNKNOWN;

/**
 * An object message that carried an operation.
 */
export interface ObjectMessage {
  /**
   * Unique ID assigned by Ably to this object message.
   */
  id?: string;
  /**
   * The client ID of the publisher of this object message (if any).
   */
  clientId?: string;
  /**
   * The connection ID of the publisher of this object message (if any).
   */
  connectionId?: string;
  /**
   * Timestamp of when the object message was received by Ably, as milliseconds since the Unix epoch.
   */
  timestamp?: number;
  /**
   * The name of the channel the object message was published to.
   */
  channel: string;
  /**
   * Describes an operation that was applied to an object.
   */
  operation: ObjectOperation;
  /**
   * An opaque string that uniquely identifies this object message.
   */
  serial?: string;
  /**
   * A timestamp from the {@link serial} field.
   */
  serialTimestamp?: number;
  /**
   * An opaque string that uniquely identifies the Ably site the object message was published to.
   */
  siteCode?: string;
  /**
   * A JSON object of arbitrary key-value pairs that may contain metadata, and/or ancillary payloads. Valid payloads include `headers`.
   */
  extras?: {
    /**
     * A set of key–value pair headers included with this object message.
     */
    headers?: Record<string, string>;
    [key: string]: any;
  };
}

/**
 * An operation that was applied to an object on a channel.
 */
export interface ObjectOperation {
  /** The operation action, one of the {@link ObjectOperationAction} enum values. */
  action: ObjectOperationAction;
  /** The ID of the object the operation was applied to. */
  objectId: string;

  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.MAP_CREATE}.
   * Defines the initial value of the map object.
   */
  mapCreate?: MapCreate;
  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.MAP_SET}.
   * Describes the key and value to set on the map object.
   */
  mapSet?: MapSet;
  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.MAP_REMOVE}.
   * Describes the key to remove from the map object.
   */
  mapRemove?: MapRemove;
  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.COUNTER_CREATE}.
   * Defines the initial value of the counter object.
   */
  counterCreate?: CounterCreate;
  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.COUNTER_INC}.
   * Describes the value to add to the counter.
   */
  counterInc?: CounterInc;
  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.OBJECT_DELETE}.
   */
  objectDelete?: ObjectDelete;
  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.MAP_CLEAR}.
   */
  mapClear?: MapClear;

  /**
   * The payload for the operation if it is a mutation operation on a map object.
   *
   * @deprecated This property is deprecated and will be removed in a future major version. Use {@link mapSet} and {@link mapRemove} instead.
   */
  mapOp?: ObjectsMapOp;
  /**
   * The payload for the operation if it is a mutation operation on a counter object.
   *
   * @deprecated This property is deprecated and will be removed in a future major version. Use {@link counterInc} instead.
   */
  counterOp?: ObjectsCounterOp;
  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.MAP_CREATE}.
   * Defines the initial value of the map object.
   *
   * @deprecated This property is deprecated and will be removed in a future major version. Use {@link mapCreate} instead.
   */
  map?: ObjectsMap;
  /**
   * The payload for the operation if the action is {@link ObjectOperationActions.COUNTER_CREATE}.
   * Defines the initial value of the counter object.
   *
   * @deprecated This property is deprecated and will be removed in a future major version. Use {@link counterCreate} instead.
   */
  counter?: ObjectsCounter;
}

/**
 * Describes an operation that was applied to a map object.
 */
export interface ObjectsMapOp {
  /** The key that the operation was applied to. */
  key: string;
  /** The data assigned to the key if the operation is {@link ObjectOperationActions.MAP_SET}. */
  data?: ObjectData;
}

/**
 * Describes an operation that was applied to a counter object.
 */
export interface ObjectsCounterOp {
  /** The value added to the counter. */
  amount: number;
}

/**
 * Describes the initial value of a map object.
 */
export interface ObjectsMap {
  /** The conflict-resolution semantics used by the map object, one of the {@link ObjectsMapSemantics} enum values. */
  semantics?: ObjectsMapSemantics;
  /** The map entries, indexed by key. */
  entries?: Record<string, ObjectsMapEntry>;
}

/**
 * Describes a value at a specific key in a map object.
 */
export interface ObjectsMapEntry {
  /** Indicates whether the map entry has been removed. */
  tombstone?: boolean;
  /** The {@link ObjectMessage.serial} value of the last operation applied to the map entry. */
  timeserial?: string;
  /** A timestamp derived from the {@link timeserial} field. Present only if {@link tombstone} is `true`. */
  serialTimestamp?: number;
  /** The value associated with this map entry. */
  data?: ObjectData;
}

/**
 * Describes the initial value of a counter object.
 */
export interface ObjectsCounter {
  /** The value of the counter. */
  count?: number;
}

/**
 * Describes the payload for a MAP_CREATE operation.
 */
export interface MapCreate {
  /** The conflict-resolution semantics used by the map object, one of the {@link ObjectsMapSemantics} enum values. */
  semantics: ObjectsMapSemantics;
  /** The map entries, indexed by key. */
  entries: Record<string, ObjectsMapEntry>;
}

/**
 * Describes the payload for a MAP_SET operation on a map object.
 */
export interface MapSet {
  /** The key to set. */
  key: string;
  /** The value to set. */
  value: ObjectData;
}

/**
 * Describes the payload for a MAP_REMOVE operation on a map object.
 */
export interface MapRemove {
  /** The key to remove. */
  key: string;
}

/**
 * Describes the payload for a COUNTER_CREATE operation.
 */
export interface CounterCreate {
  /** The initial counter value. */
  count: number;
}

/**
 * Describes the payload for a COUNTER_INC operation on a counter object.
 */
export interface CounterInc {
  /** The value to be added to the counter. */
  number: number;
}

/**
 * Describes the payload for an OBJECT_DELETE operation.
 */
export interface ObjectDelete {}

/**
 * Describes the payload for a MAP_CLEAR operation.
 */
export interface MapClear {}

/**
 * Represents a value in an object on a channel.
 */
export interface ObjectData {
  /** A reference to another object. */
  objectId?: string;
  /** A boolean leaf value in the object. */
  boolean?: boolean;
  /** A decoded binary leaf value in the object. */
  bytes?: Buffer | ArrayBuffer;
  /** A number leaf value in the object. */
  number?: number;
  /** A string leaf value in the object. */
  string?: string;
  /** A decoded JSON leaf value in the object. */
  json?: JsonObject | JsonArray;

  /**
   * A decoded primitive value.
   *
   * @deprecated This property is deprecated and will be removed in a future major version. Use one of the typed {@link boolean}, {@link bytes}, {@link number}, {@link string} or {@link json} fields instead.
   */
  value?: Primitive;
}

/**
 * Static utilities related to LiveMap instances.
 */
export class LiveMap {
  /**
   * Creates a {@link LiveMap} value type that can be passed to mutation methods
   * (such as {@link LiveMapOperations.set}) to assign a new LiveMap to the channel object.
   *
   * @param initialEntries - Optional initial entries for the new LiveMap object.
   * @returns A {@link LiveMap} value type representing the initial state of the new LiveMap.
   */
  static create<T extends Record<string, Value>>(
    // block TypeScript from inferring T from the initialEntries argument, so instead it is inferred
    // from the contextual type in a LiveMap.set call
    initialEntries?: NoInfer<T>,
  ): LiveMap<T extends Record<string, Value> ? T : {}>;
}

/**
 * Static utilities related to LiveCounter instances.
 */
export class LiveCounter {
  /**
   * Creates a {@link LiveCounter} value type that can be passed to mutation methods
   * (such as {@link LiveMapOperations.set}) to assign a new LiveCounter to the channel object.
   *
   * @param initialCount - Optional initial count for the new LiveCounter object.
   * @returns A {@link LiveCounter} value type representing the initial state of the new LiveCounter.
   */
  static create(initialCount?: number): LiveCounter;
}

/**
 * The LiveObjects plugin that provides a {@link RestClient} or {@link RealtimeClient} instance with the ability to use LiveObjects functionality.
 *
 * To create a client that includes this plugin, include it in the client options that you pass to the {@link RestClient.constructor} or {@link RealtimeClient.constructor}:
 *
 * ```javascript
 * import { Realtime } from '@ably/pubsub-core';
 * import { LiveObjects } from '@ably/pubsub-core/liveobjects';
 * const realtime = new Realtime({ ...options, plugins: { LiveObjects } });
 * ```
 *
 * The LiveObjects plugin can also be used with a {@link BaseRest} or {@link BaseRealtime} client.
 *
 * ```javascript
 * import { BaseRealtime, BaseRest, WebSocketTransport, FetchRequest } from '@ably/pubsub-core/modular';
 * import { LiveObjects } from '@ably/pubsub-core/liveobjects';
 * const realtime = new BaseRealtime({ ...options, plugins: { WebSocketTransport, FetchRequest, LiveObjects } });
 * const rest = new BaseRest({ ...options, plugins: { FetchRequest, LiveObjects } });
 * ```
 *
 * You can also import individual utilities alongside the plugin:
 *
 * ```javascript
 * import { LiveObjects, LiveCounter, LiveMap } from '@ably/pubsub-core/liveobjects';
 * ```
 */
export declare const LiveObjects: any;

/**
 * Module augmentation to add the `object` property to `RealtimeChannel` when
 * importing from '@ably/pubsub-core/liveobjects'. This ensures all LiveObjects types come from
 * the same module (CJS or ESM), avoiding type incompatibility issues.
 */
declare module '@ably/pubsub-core' {
  interface RealtimeChannel {
    /**
     * A {@link RealtimeObject} object.
     */
    object: RealtimeObject;
  }
}

/**
 * Module augmentation to add the `object` property to `Channel` (REST) when
 * importing from '@ably/pubsub-core/liveobjects'. This ensures all LiveObjects types come from
 * the same module (CJS or ESM), avoiding type incompatibility issues.
 */
declare module '@ably/pubsub-core' {
  interface Channel {
    /**
     * A {@link RestObject} object.
     */
    object: RestObject;
  }
}
