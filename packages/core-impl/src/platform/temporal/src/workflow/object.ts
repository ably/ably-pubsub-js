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
import { requireObject } from './arguments.js';
import type { ActivityInvoker } from './invoker.js';

/**
 * Reads and modifies the objects on a channel from workflow code. It mirrors the Ably `HttpObject`, and is obtained
 * from `TemporalRestChannel.object`.
 *
 * Each method runs as a Temporal activity, which fails unless the worker's Ably client has the LiveObjects plugin.
 * Binary values in results are returned as `Uint8Array`.
 */
export class TemporalRestObject {
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
   * @returns A promise which is fulfilled with the object data in compact format.
   */
  get(params?: HttpObjectGetCompactParams): Promise<HttpObjectGetCompactResult>;
  /**
   * Reads object data from the channel in full format, with object IDs and type metadata. If no `objectId` is
   * given, the entire channel object is returned. Runs as a Temporal activity.
   *
   * @param params - Specifies the object to fetch, with `compact: false`.
   * @returns A promise which is fulfilled with the object data in full format.
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
    return this.invoker.invoke(ActivityNames.objectGet, `object.get ${this.channel}`, {
      channel: this.channel,
      params,
    });
  }

  /**
   * Publishes one or more operations to modify objects on the channel. An array of operations is published as an
   * atomic batch. Runs as a Temporal activity.
   *
   * Unless idempotent publishing is disabled with `TemporalRestOptions.idempotentPublishing`, and provided that no
   * operation already has an `id`, each operation is assigned an ID that is the same on every attempt of the
   * activity and every replay of the workflow. Ably uses these IDs to discard an operation that a retried activity
   * publishes again, for up to 2 minutes after the first attempt.
   *
   * No IDs are assigned when any of the operations is a `mapCreate` or `counterCreate`, or has a `path` with a
   * wildcard, so a retried activity applies those operations again:
   *
   * - Ably rejects a client-specified ID on a create at a `path`, or on a wildcard `path`, because it expands such
   *   an operation into several object messages.
   * - When Ably discards a retried create by its ID, it responds with the ID of an object that it did not create.
   *   Without an ID, a retried create makes another object, and the result names an object that exists.
   *
   * A retried create at a `path` fails with error 92007 if the first attempt succeeded, because the path then holds
   * an object. `mapCreateWithObjectId` and `counterCreateWithObjectId` operations are assigned IDs.
   *
   * @param op - The operation, or array of operations, to publish.
   * @returns A promise which is fulfilled with the ID of the published message and the IDs of the affected objects.
   */
  async publish(op: HttpObjectOperation | HttpObjectOperation[]): Promise<HttpObjectPublishResult> {
    if (!Array.isArray(op)) {
      requireObject(
        'object.publish',
        'the operation',
        op,
        'Pass an operation object, such as { objectId: "counter:abc", counterInc: { number: 1 } }, or an array of operation objects.',
      );
    }
    const list = Array.isArray(op) ? op : [op];
    const withIds = list.some(publishedWithoutId) ? list : this.invoker.assignMessageIds(list);
    const operations = Array.isArray(op) ? withIds : withIds[0];
    return this.invoker.invoke(ActivityNames.objectPublish, `object.publish ${this.channel}`, {
      channel: this.channel,
      operations,
    });
  }
}

/**
 * Whether an operation must be published without an ID, which then applies to every operation in the publish, since
 * Ably needs all of them to have an ID or none.
 *
 * - A create operation, because when Ably discards a retried create by its ID, the response names the object that
 *   the retry would have created, which does not exist. A create at a path also gets error 40031 with an ID, because
 *   Ably expands it into the create and a set on the parent map.
 * - An operation whose path has a wildcard, because Ably expands it into one object message for each match, and
 *   rejects the publish with error 40031 if it has an ID.
 */
function publishedWithoutId(operation: unknown): boolean {
  if (operation === null || typeof operation !== 'object') {
    return false;
  }
  if ('mapCreate' in operation || 'counterCreate' in operation) {
    return true;
  }
  const path = (operation as { path?: unknown }).path;
  return typeof path === 'string' && path.includes('*');
}
