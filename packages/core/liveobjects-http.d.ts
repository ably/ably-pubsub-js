/**
 * The part of the LiveObjects type surface that only the stateless HTTP client uses: its objects
 * API, reached through the REST channel's `object` property. Kept apart from
 * ./liveobjects-types.d.ts for the reason given there.
 */

/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import {
  ErrorInfo,
  EventCallback,
  RealtimeChannel,
  PubSubRealtimeClient,
  PubSubHttpClient,
  StatusSubscription,
  Subscription,
  __livetype,
} from './ably';
import type {
  JsonArray,
  JsonObject,
  JsonScalar,
  LiveCounter,
  LiveMap,
  ObjectData,
  ObjectsMapSemantics,
  ObjectsMapSemanticsNamespace,
} from './liveobjects-types';
/* eslint-enable no-unused-vars, @typescript-eslint/no-unused-vars */

/**
 * Enables REST-based operations on Objects on a channel.
 */
export declare interface HttpObject {
  /**
   * Reads object data from the channel in compact object response format.
   * If no `objectId` is provided then the entire channel object is returned.
   *
   * Returns a {@link HttpObjectGetCompactResult} representing the logical structure of your data as a JSON-like value.
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
  get(params?: HttpObjectGetCompactParams): Promise<HttpObjectGetCompactResult>;
  /**
   * Reads object data from the channel in full object response format.
   * If no `objectId` is provided then the entire channel object is returned.
   *
   * Returns a {@link HttpObjectGetFullResult} with full object metadata and decoded object data values
   * (`bytes` decoded to `Buffer`/`ArrayBuffer`, `json` decoded to native objects/arrays).
   * If the path resolves to a leaf value in a map, returns the decoded {@link HttpObjectData | ObjectData} directly.
   *
   * Cyclic references are included as `{ objectId: string }` rather than including the same object instance
   * in the result more than once.
   *
   * @param params - Parameters specifying the object to fetch with `compact: false`.
   * @returns A promise which, upon success, will be fulfilled with the object data in full format. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  get(params: HttpObjectGetFullParams): Promise<HttpObjectGetFullResult>;
  /**
   * Reads object data from the channel.
   * If no `objectId` is provided then the entire channel object is returned.
   *
   * When `compact` is `true` (the default), returns a {@link HttpObjectGetCompactResult} representing the logical
   * structure of your data as a JSON-like value. {@link LiveMap} instances appear as JSON objects with their entries,
   * and {@link LiveCounter} instances appear as numbers. Binary values appear as base64 strings (JSON protocol) or
   * `Buffer`/`ArrayBuffer` (binary protocol). JSON-typed values remain as their JSON-encoded string representation.
   *
   * When `compact` is `false`, returns a {@link HttpObjectGetFullResult} with full object metadata
   * and decoded object data values (`bytes` decoded to `Buffer`/`ArrayBuffer`, `json` decoded to native objects/arrays).
   * If the path resolves to a leaf value in a map, returns the decoded {@link HttpObjectData | ObjectData} directly.
   *
   * For both formats, cyclic references in the channel object are included as `{ objectId: string }`
   * rather than including the same object instance in the result more than once.
   *
   * @param params - Optional parameters to specify the object to fetch and the format of the returned data.
   * @returns A promise which, upon success, will be fulfilled with the object data in the requested format. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  get(params?: HttpObjectGetParams): Promise<HttpObjectGetCompactResult | HttpObjectGetFullResult>;

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
   * @returns A promise which, upon success, will be fulfilled with a {@link HttpObjectPublishResult} containing information about the published operations. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  publish(op: HttpObjectOperation | HttpObjectOperation[]): Promise<HttpObjectPublishResult>;

  /**
   * Generates an object ID for a create operation. The returned ID, nonce, and initial value
   * can be used to construct a {@link HttpObjectOperationMapCreateWithObjectId} or
   * {@link HttpObjectOperationCounterCreateWithObjectId} operation for use with {@link publish}.
   *
   * Client-generated object IDs enable atomic batch operations with cross-references between
   * newly created objects. When publishing a batch of operations using {@link publish}, you
   * can reference an object by its pre-computed ID in the same batch - for example, creating
   * a map and assigning it to a key in another map in a single atomic publish call.
   *
   * @param createBody - The create operation body, either a {@link HttpObjectOperationMapCreateBody} or {@link HttpObjectOperationCounterCreateBody}.
   * @returns A promise which, upon success, will be fulfilled with a {@link HttpObjectGenerateIdResult}. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  generateObjectId(
    createBody: HttpObjectOperationMapCreateBody | HttpObjectOperationCounterCreateBody,
  ): Promise<HttpObjectGenerateIdResult>;
}

/**
 * Base interface for all REST object operations. Contains common fields shared across all operation types.
 */
export interface HttpObjectOperationBase {
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
export type AnyTargetHttpObjectOperationBase = HttpObjectOperationBase & (TargetByObjectId | TargetByPath);

/**
 * Represents a leaf data value used when publishing operations via {@link HttpObject.publish}.
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
 * Used as the body of {@link HttpObjectOperationMapCreate} and as input to {@link HttpObject.generateObjectId}.
 */
export interface HttpObjectOperationMapCreateBody {
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
export type HttpObjectOperationMapCreate = HttpObjectOperationBase &
  Partial<TargetByPath> &
  HttpObjectOperationMapCreateBody;

/**
 * Operation to create a new map object with a client-generated object ID and initial entries.
 * Use {@link HttpObject.generateObjectId} to generate the object ID, nonce, and initial value
 * needed for this operation.
 */
export type HttpObjectOperationMapCreateWithObjectId = HttpObjectOperationBase & {
  /**
   * The object ID for the new map object.
   * Use {@link HttpObject.generateObjectId} to generate this value along with the matching nonce and initial value.
   */
  objectId: string;
  /** The map creation parameters for a pre-computed object ID. */
  mapCreateWithObjectId: {
    /**
     * JSON-encoded string representation of the {@link HttpObjectOperationMapCreate.mapCreate} object.
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
export type HttpObjectOperationMapSet = AnyTargetHttpObjectOperationBase & {
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
export type HttpObjectOperationMapRemove = AnyTargetHttpObjectOperationBase & {
  /** The map remove parameters. */
  mapRemove: {
    /** The key to remove. */
    key: string;
  };
};

/**
 * The counter creation payload, specifying the initial count for a new counter object.
 * Used as the body of {@link HttpObjectOperationCounterCreate} and as input to {@link HttpObject.generateObjectId}.
 */
export interface HttpObjectOperationCounterCreateBody {
  /** The counter creation parameters. */
  counterCreate: {
    /** The initial value of the counter. */
    count: number;
  };
}

/**
 * Operation to create a new counter object at the specified path with an initial count value.
 */
export type HttpObjectOperationCounterCreate = HttpObjectOperationBase &
  Partial<TargetByPath> &
  HttpObjectOperationCounterCreateBody;

/**
 * Operation to create a new counter object with a client-generated object ID and an initial count value.
 * Use {@link HttpObject.generateObjectId} to generate the object ID, nonce, and initial value
 * needed for this operation.
 */
export type HttpObjectOperationCounterCreateWithObjectId = HttpObjectOperationBase & {
  /**
   * The object ID for the new counter object.
   * Use {@link HttpObject.generateObjectId} to generate this value along with the matching nonce and initial value.
   */
  objectId: string;
  /** The counter creation parameters for a pre-computed object ID. */
  counterCreateWithObjectId: {
    /**
     * JSON-encoded string representation of the {@link HttpObjectOperationCounterCreate.counterCreate} object.
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
export type HttpObjectOperationCounterInc = AnyTargetHttpObjectOperationBase & {
  /** The counter increment parameters. */
  counterInc: {
    /** The amount to increment by. Use a negative value to decrement. */
    number: number;
  };
};

/**
 * Union type representing all possible REST object operations.
 */
export type HttpObjectOperation =
  | HttpObjectOperationMapCreate
  | HttpObjectOperationMapCreateWithObjectId
  | HttpObjectOperationMapSet
  | HttpObjectOperationMapRemove
  | HttpObjectOperationCounterCreate
  | HttpObjectOperationCounterCreateWithObjectId
  | HttpObjectOperationCounterInc;

/**
 * Result returned after successfully publishing object operations via REST.
 * Contains information about the published message and affected object IDs.
 */
export interface HttpObjectPublishResult {
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
 * Result returned by {@link HttpObject.generateObjectId}, containing the generated object ID
 * and the values needed to construct a {@link HttpObjectOperationMapCreateWithObjectId}
 * or {@link HttpObjectOperationCounterCreateWithObjectId} operation.
 */
export interface HttpObjectGenerateIdResult {
  /** The generated object ID. */
  objectId: string;
  /** The nonce used in ID generation. */
  nonce: string;
  /** The JSON-encoded initial value used in ID generation. */
  initialValue: string;
}

/**
 * Request parameters for {@link HttpObject.get}.
 */
export interface HttpObjectGetParams {
  /** The unique identifier of the object instance to fetch. If omitted, fetches from the channel object. */
  objectId?: string;
  /** A dot-separated path to return a subset of the object. Evaluated relative to the channel object or the specified objectId. */
  path?: string;
  /** When true (default), returns a values-only representation. When false, includes object IDs and type metadata. */
  compact?: boolean;
}

/**
 * Parameters for {@link HttpObject.get} when requesting compact format (default).
 */
export type HttpObjectGetCompactParams = Omit<HttpObjectGetParams, 'compact'> & {
  /** Must be `true` or omitted for compact format. */
  compact?: true;
};

/**
 * Parameters for {@link HttpObject.get} when requesting full object response format.
 */
export type HttpObjectGetFullParams = Omit<HttpObjectGetParams, 'compact'> & {
  /** Must be `false` for full object response format. */
  compact: false;
};

// Note: this type does not include arrays as no LiveObject type currently compacts
// into one, and json-typed values remain as JSON-encoded strings rather than being parsed.
/**
 * Result of {@link HttpObject.get} when `compact` is `true` (default).
 * Represents a compacted view of the object on a channel or its leaf value.
 */
export type HttpObjectGetCompactResult =
  | JsonScalar
  | Buffer
  | ArrayBuffer
  | { [key: string]: HttpObjectGetCompactResult };

/**
 * Result of {@link HttpObject.get} when `compact` is `false`.
 *
 * One of:
 * - A {@link HttpLiveMap} or {@link HttpLiveCounter} with full object metadata and decoded data values.
 * - An {@link AnyHttpLiveObject} for unrecognized object types.
 * - A {@link HttpObjectData | ObjectData} leaf value when the path resolves to a primitive entry in a map.
 *
 * In all cases, `bytes` values are decoded to `Buffer`/`ArrayBuffer` and `json` values are decoded
 * to native objects/arrays.
 */
export type HttpObjectGetFullResult = HttpLiveObject | HttpObjectData;

/**
 * A full object structure including object IDs and type metadata, returned as part of {@link HttpObjectGetFullResult}.
 */
export type HttpLiveObject = HttpLiveMap | HttpLiveCounter | AnyHttpLiveObject;

/**
 * Full object structure of a map object with metadata.
 */
export interface HttpLiveMap {
  /** The ID of the map object. */
  objectId: string;
  /** Describes the value of a map object. */
  map: {
    /** The conflict-resolution semantics used by the map object, one of the {@link ObjectsMapSemantics} enum values. */
    semantics: ObjectsMapSemantics;
    /** The map entries, indexed by key. */
    entries: Record<string, HttpObjectDataMapEntry | HttpLiveObjectMapEntry>;
  };
}

/**
 * A map entry containing a primitive leaf value.
 */
export interface HttpObjectDataMapEntry {
  /** The decoded object data for this entry. */
  data: HttpObjectData;
}

/**
 * A map entry containing a nested LiveObject.
 */
export interface HttpLiveObjectMapEntry {
  /** The nested LiveObject at this entry. */
  data: HttpLiveObject;
}

/**
 * Full object structure of a counter object with metadata.
 */
export interface HttpLiveCounter {
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
export type AnyHttpLiveObject = {
  /** The ID of the object, available for all object types. */
  objectId: string;
};

/**
 * A decoded leaf data value in the full {@link HttpObject.get} responses.
 */
type HttpObjectData = Omit<ObjectData, 'value'>;

/**
 * Module augmentation to add the `object` property to `HttpChannel` when
 * importing from '@ably/pubsub-core/liveobjects'. This ensures all LiveObjects types come from
 * the same module (CJS or ESM), avoiding type incompatibility issues.
 *
 * It names '@ably/pubsub-core/http', the module that declares `HttpChannel`, rather than the
 * package root, for the reason given on the `RealtimeChannel` augmentation in
 * liveobjects-types.d.ts.
 */
declare module '@ably/pubsub-core/http' {
  interface HttpChannel {
    /**
     * A {@link HttpObject} object.
     */
    object: HttpObject;
  }
}
