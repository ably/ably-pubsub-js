import type {
  HttpObjectGetCompactParams,
  HttpObjectGetCompactResult,
  HttpObjectGetFullParams,
  HttpObjectGetFullResult,
  HttpObjectGetParams,
  HttpObjectOperation,
  HttpObjectPublishResult,
} from '@ably/pubsub-core/liveobjects';
import { ActivityNames } from '../common/activities.js';
import {
  base64ToBytes,
  bytesToBase64,
  isBinary,
  mapFullObjectBytes,
  mapOperationBytes,
  toBytes,
} from '../common/wire.js';
import { requireObject } from './arguments.js';
import { ablyFailure } from './failure.js';
import type { ActivityInvoker } from './invoker.js';

/** Options for {@link TemporalAblyHttpObject.publish}. */
export interface TemporalAblyHttpObjectPublishOptions {
  /**
   * Whether to publish the operations with IDs that Ably deduplicates a retried activity on. When set, it overrides
   * `TemporalAblyHttpClientOptions.idempotentPublishing` for this call. When `false`, the operations are published as
   * they are.
   */
  idempotentPublishing?: boolean;
}

/**
 * Reads and modifies the objects on a channel from workflow code. It mirrors the Ably `HttpObject`, and is obtained
 * from `TemporalAblyHttpChannel.object`.
 *
 * Each method runs as a Temporal activity, which fails unless the worker's Ably client has the LiveObjects plugin.
 * Binary values are published as `bytes` in a `Uint8Array`, an `ArrayBuffer` or another typed array. In a full-format
 * result, binary values are returned as `Uint8Array`. In a compact result, they are returned as base64 strings, as Ably
 * returns them over its JSON protocol.
 */
export class TemporalAblyHttpObject {
  /** @internal */
  constructor(
    private readonly invoker: ActivityInvoker,
    private readonly channel: string,
  ) {}

  /**
   * Reads object data from the channel in compact format. If no `objectId` is given, the entire channel object is
   * returned. Runs as a Temporal activity.
   *
   * @param params - Specifies the object to fetch.
   * @returns A promise which is fulfilled with the object data in compact format, with binary values as base64
   * strings.
   */
  get(params?: HttpObjectGetCompactParams): Promise<HttpObjectGetCompactResult>;
  /**
   * Reads object data from the channel in full format, with object IDs and type metadata. If no `objectId` is
   * given, the entire channel object is returned. Runs as a Temporal activity.
   *
   * @param params - Specifies the object to fetch, with `compact: false`.
   * @returns A promise which is fulfilled with the object data in full format, with binary values as `Uint8Array`.
   */
  get(params: HttpObjectGetFullParams): Promise<HttpObjectGetFullResult>;
  /**
   * Reads object data from the channel, in compact format unless `compact` is `false`. If no `objectId` is given,
   * the entire channel object is returned. Runs as a Temporal activity.
   *
   * @param params - Specifies the object to fetch and the format of the result.
   * @returns A promise which is fulfilled with the object data in the requested format.
   */
  get(params?: HttpObjectGetParams): Promise<HttpObjectGetCompactResult | HttpObjectGetFullResult>;
  async get(params?: HttpObjectGetParams): Promise<HttpObjectGetCompactResult | HttpObjectGetFullResult> {
    const result = await this.invoker.invoke(ActivityNames.objectGet, `object.get ${this.channel}`, {
      channel: this.channel,
      params,
    });
    return params?.compact === false ? mapFullObjectBytes(result, decodeBytes) : result;
  }

  /**
   * Publishes one or more operations to modify objects on the channel. An array of operations is published as an
   * atomic batch. Runs as a Temporal activity.
   *
   * When idempotent publishing is enabled, and provided that no operation already has an `id`, each operation is
   * assigned an ID that is the same on every attempt of the activity and every replay of the workflow. Ably uses these
   * IDs to discard an operation that a retried activity publishes again, for at least 2 minutes after the first
   * attempt. `TemporalAblyHttpClientOptions.idempotentPublishing` enables it, unless `options.idempotentPublishing`
   * sets it for this call.
   *
   * Ably cannot deduplicate a retry of a `mapCreate` or `counterCreate` operation, or of an operation whose `path` has
   * a wildcard, so a call that includes one throws when idempotent publishing is enabled and no operation has an `id`:
   *
   * - Ably rejects an ID on a create at a `path`, and on a wildcard `path`, because it expands such an operation into
   *   several object messages.
   * - When Ably discards a retried create by its ID, it responds with the ID of an object that it did not create.
   *
   * To publish such a call, pass `{ idempotentPublishing: false }`. A retried activity then applies every operation in
   * the call again. A create without a `path` creates another object. A create at a `path` fails with error 92007 if
   * the first attempt succeeded, because the path then holds an object. A wildcard operation is applied to each match
   * again. `mapCreateWithObjectId` and `counterCreateWithObjectId` operations can be deduplicated.
   *
   * @param op - The operation, or array of operations, to publish.
   * @param options - Options for this call.
   * @returns A promise which is fulfilled with the ID of the published message and the IDs of the affected objects.
   * @throws An `ApplicationFailure` of type `AblyError` with code 40003 if idempotent publishing is enabled, no
   * operation has an `id`, and an operation cannot be deduplicated.
   */
  async publish(
    op: HttpObjectOperation | HttpObjectOperation[],
    options?: TemporalAblyHttpObjectPublishOptions,
  ): Promise<HttpObjectPublishResult> {
    if (!Array.isArray(op)) {
      requireObject(
        'object.publish',
        'the operation',
        op,
        'Pass an operation object, such as { objectId: "counter:abc", counterInc: { number: 1 } }, or an array of operation objects.',
      );
    }
    const list = Array.isArray(op) ? op : [op];
    const idempotentPublishing = options?.idempotentPublishing ?? this.invoker.idempotentPublishing;
    if (idempotentPublishing && !list.some((operation) => operation?.id)) {
      const index = list.findIndex((operation) => notDeduplicatedReason(operation) !== undefined);
      if (index !== -1) {
        throw notDeduplicatedFailure(Array.isArray(op) ? `operations[${index}]` : 'the operation', list[index]);
      }
    }
    const withIds = this.invoker
      .assignMessageIds(list, idempotentPublishing)
      .map((operation) => mapOperationBytes(operation, encodeBytes));
    const operations = Array.isArray(op) ? withIds : withIds[0];
    return this.invoker.invoke(ActivityNames.objectPublish, `object.publish ${this.channel}`, {
      channel: this.channel,
      operations,
    });
  }
}

function encodeBytes(bytes: unknown): unknown {
  return isBinary(bytes) ? bytesToBase64(toBytes(bytes)) : bytes;
}

function decodeBytes(bytes: unknown): unknown {
  return typeof bytes === 'string' ? base64ToBytes(bytes) : bytes;
}

function isCreate(operation: object): boolean {
  return 'mapCreate' in operation || 'counterCreate' in operation;
}

/**
 * Why Ably cannot deduplicate a retry of `operation` by an ID, or `undefined` if it can. Ably needs every operation
 * in a publish to have an ID, or none, so one such operation applies to the whole call.
 *
 * - A create, because when Ably discards a retried create by its ID, the response names the object that the retry
 *   would have created, which does not exist. A create at a path also gets error 40031 with an ID, because Ably
 *   expands it into the create and a set on the parent map.
 * - An operation whose path has a wildcard, because Ably expands it into one object message for each match, and
 *   rejects the publish with error 40031 if it has an ID.
 */
function notDeduplicatedReason(operation: unknown): string | undefined {
  if (operation === null || typeof operation !== 'object') {
    return undefined;
  }
  const path = (operation as { path?: unknown }).path;
  if (isCreate(operation)) {
    return typeof path === 'string'
      ? 'Ably rejects an operation ID on a create at a path'
      : 'Ably responds to a retried create that it discards as a duplicate with the ID of an object that it did not create';
  }
  if (typeof path === 'string' && path.includes('*')) {
    return 'Ably rejects an operation ID on an operation whose path has a wildcard';
  }
  return undefined;
}

function notDeduplicatedFailure(description: string, operation: object) {
  return ablyFailure({
    message: `object.publish() cannot deduplicate a retry of ${description}, because ${notDeduplicatedReason(operation)}`,
    code: 40003,
    statusCode: 400,
    remediation: [
      'Pass { idempotentPublishing: false } as the second argument to object.publish() to publish without deduplication.',
      'A retried activity then applies every operation in the call again.',
      'Publish the operations that can be deduplicated in a separate call, so that they keep their IDs.',
      isCreate(operation)
        ? 'To create an object that a retry does not create again, generate its object ID with channel.object.generateObjectId() in an activity of your own, and publish a mapCreateWithObjectId or counterCreateWithObjectId operation instead.'
        : 'To deduplicate the operation, target each object by its objectId or by a path without a wildcard.',
    ].join(' '),
  });
}
