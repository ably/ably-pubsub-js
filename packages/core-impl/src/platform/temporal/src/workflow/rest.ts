import type { ActivityOptions, LocalActivityOptions } from '@temporalio/workflow';
import type * as Ably from '@ably/pubsub-core/api';
import { ActivityNames } from '../common/activities.js';
import type { PageParams } from '../common/wire.js';
import { TemporalRestChannels } from './channel.js';
import { requireString, requireStringArray } from './arguments.js';
import { ActivityInvoker } from './invoker.js';
import { TemporalRestPush } from './push.js';
import {
  httpPaginatedResponse,
  pageSummary,
  type PageRelation,
  type TemporalHttpPaginatedResponse,
} from './paginated.js';

/** Options for {@link TemporalRest}. */
export interface TemporalRestOptions {
  /**
   * The options for the activities that run Ably operations. They are applied on top of the defaults, which are a
   * `startToCloseTimeout` of 30 seconds and Temporal's default retry policy.
   *
   * Unless you set `summary`, each activity gets a summary for the Temporal UI that names the operation and
   * channel, such as `publish chat:123`.
   */
  activityOptions?: ActivityOptions;
  /**
   * When set, Ably operations run as local activities with these options, applied on top of a default
   * `startToCloseTimeout` of 30 seconds. Local activities have lower latency, which suits short operations such as
   * status updates. Cannot be set together with `activityOptions`.
   */
  localActivityOptions?: LocalActivityOptions;
  /**
   * Whether the workflow derives idempotency keys for calls that have none, so that Ably deduplicates a retried
   * activity. Each key is the same on every attempt of the activity and every replay of the workflow. The key is
   * sent in the form that each endpoint deduplicates on:
   *
   * - Message IDs for `TemporalRestChannel.publish()` and {@link TemporalRest.batchPublish}.
   * - The `idempotencyKey` option for `TemporalRestChannel.updateMessage()` and `deleteMessage()`.
   * - The annotation `id` for `TemporalRestAnnotations.publish()` and `delete()`.
   * - Operation IDs for `TemporalRestObject.publish()`.
   *
   * A call whose messages, annotation or operations already have an `id`, or whose options already have an
   * `idempotencyKey`, is sent as it is. When `false`, every call is sent as it is.
   *
   * @defaultValue `true`
   */
  idempotentPublishing?: boolean;
}

/**
 * An Ably HTTP client for workflow code. It mirrors the Ably `Rest` client, but each operation runs as a Temporal
 * activity on a worker that has the `AblyRestPlugin` from `@ably/pubsub-server/temporal`, which makes the request with its own
 * Ably HTTP client.
 *
 * Construct it at module scope or inside a workflow. Constructing it does not run an activity.
 *
 * If an operation fails, it rejects with the activity's `ActivityFailure`. Use `getAblyErrorDetails()` to get the
 * Ably error from it. Errors detected in workflow code, such as invalid arguments, are thrown as an
 * `ApplicationFailure` of type `AblyError`, which `getAblyErrorDetails()` also accepts.
 *
 * Binary values, such as message data, are sent as they are and returned as `Uint8Array`.
 *
 * @example
 * ```ts
 * import { workflowInfo } from '@temporalio/workflow';
 * import { TemporalRest } from '@ably/pubsub-server/temporal/workflow';
 *
 * const ably = new TemporalRest({ activityOptions: { retry: { maximumAttempts: 3 } } });
 *
 * export async function agentWorkflow(): Promise<void> {
 *   const channel = ably.channels.get(`chat:${workflowInfo().workflowId}`);
 *   await channel.publish('agent.status', { status: 'thinking' });
 * }
 * ```
 */
export class TemporalRest {
  /** Creates and caches the channels used from this client. */
  readonly channels: TemporalRestChannels;
  /** Manages push notification device registrations and channel subscriptions, and publishes push notifications. */
  readonly push: TemporalRestPush;
  private readonly invoker: ActivityInvoker;

  /**
   * @param options - Options for the activities that run Ably operations, and for idempotent publishing.
   * @throws `TypeError` if both `activityOptions` and `localActivityOptions` are set.
   */
  constructor(options: TemporalRestOptions = {}) {
    if (options.activityOptions && options.localActivityOptions) {
      throw new TypeError(
        'TemporalRestOptions cannot set both activityOptions and localActivityOptions. Set localActivityOptions to run Ably operations as local activities, or activityOptions to run them as regular activities.',
      );
    }
    this.invoker = new ActivityInvoker({
      activityOptions: options.activityOptions,
      localActivityOptions: options.localActivityOptions,
      idempotentPublishing: options.idempotentPublishing ?? true,
    });
    this.channels = new TemporalRestChannels(this.invoker);
    this.push = new TemporalRestPush(this.invoker);
  }

  /**
   * Retrieves the time from the Ably service. Runs as a Temporal activity.
   *
   * Use `Date.now()` for the current time in workflow logic. It is deterministic in a workflow, while this result
   * is recorded in the workflow history.
   *
   * @returns A promise which is fulfilled with the time as milliseconds since the Unix epoch.
   */
  async time(): Promise<number> {
    return this.invoker.invoke(ActivityNames.time, 'time');
  }

  /**
   * Makes a request to an Ably REST API endpoint, for functionality this client does not wrap. Runs as a Temporal
   * activity.
   *
   * @param method - The request method, such as `GET` or `POST`.
   * @param path - The request path.
   * @param version - The version of the Ably REST API to use.
   * @param params - The parameters to include in the URL query of the request.
   * @param body - The JSON body of the request.
   * @param headers - Additional HTTP headers to include in the request.
   * @returns A promise which is fulfilled with the first page of the response. An error response from Ably is
   * returned with `success` set to `false`, rather than rejected.
   */
  async request<T = any>(
    method: string,
    path: string,
    version: number,
    params?: any,
    body?: any[] | any,
    headers?: any,
  ): Promise<TemporalHttpPaginatedResponse<T>> {
    requireString('request', 'method', method);
    requireString('request', 'path', path);
    const summary = `request ${method.toUpperCase()} ${path}`;
    const fetchPage = async (
      pageParams: PageParams,
      relation: PageRelation,
    ): Promise<TemporalHttpPaginatedResponse<T>> => {
      const page = await this.invoker.invoke(ActivityNames.request, pageSummary(summary, relation), {
        method: 'get',
        path,
        version,
        params: pageParams,
        headers,
      });
      return httpPaginatedResponse<T>(page, fetchPage);
    };
    const page = await this.invoker.invoke(ActivityNames.request, summary, {
      method,
      path,
      version,
      params,
      body,
      headers,
    });
    return httpPaginatedResponse<T>(page, fetchPage);
  }

  /**
   * Publishes messages to one or more channels, up to a maximum of 100 channels. Runs as a Temporal activity.
   *
   * When idempotent publishing is enabled (see {@link TemporalRestOptions.idempotentPublishing}) and none of the
   * spec's messages has an `id`, the messages are published with deterministic IDs, as for
   * `TemporalRestChannel.publish()`. The objects passed in are not modified.
   *
   * @param spec - The messages to publish, and the channels to publish them to.
   * @returns A promise which is fulfilled with the result of the publish to each channel. The `error` of a failure
   * result is a plain object with the fields of an `ErrorInfo`.
   */
  batchPublish(
    spec: Ably.BatchPublishSpec,
  ): Promise<Ably.BatchResult<Ably.BatchPublishSuccessResult | Ably.BatchPublishFailureResult>>;
  /**
   * Publishes messages to one or more channels, up to a maximum of 100 channels. Runs as a Temporal activity.
   *
   * When idempotent publishing is enabled (see {@link TemporalRestOptions.idempotentPublishing}), the messages of
   * each spec in which no message has an `id` are published with deterministic IDs, as for
   * `TemporalRestChannel.publish()`. Each spec gets its own ID base. The objects passed in are not modified.
   *
   * @param specs - The messages to publish, and the channels to publish them to.
   * @returns A promise which is fulfilled with an array of results, in the same order as `specs`. The `error` of a
   * failure result is a plain object with the fields of an `ErrorInfo`.
   */
  batchPublish(
    specs: Ably.BatchPublishSpec[],
  ): Promise<Ably.BatchResult<Ably.BatchPublishSuccessResult | Ably.BatchPublishFailureResult>[]>;
  async batchPublish(
    specOrSpecs: Ably.BatchPublishSpec | Ably.BatchPublishSpec[],
  ): Promise<
    | Ably.BatchResult<Ably.BatchPublishSuccessResult | Ably.BatchPublishFailureResult>
    | Ably.BatchResult<Ably.BatchPublishSuccessResult | Ably.BatchPublishFailureResult>[]
  > {
    const withIds = (spec: Ably.BatchPublishSpec): Ably.BatchPublishSpec => {
      // The batch publish endpoint also accepts a single message object in place of an array.
      const messages: Ably.Message[] | Ably.Message | undefined = spec?.messages;
      if (Array.isArray(messages)) {
        return { ...spec, messages: this.invoker.assignMessageIds(messages) };
      }
      if (messages !== null && typeof messages === 'object') {
        return { ...spec, messages: this.invoker.assignMessageIds([messages])[0] as unknown as Ably.Message[] };
      }
      return spec;
    };
    const specs = Array.isArray(specOrSpecs) ? specOrSpecs.map(withIds) : withIds(specOrSpecs);
    const channels = new Set((Array.isArray(specs) ? specs : [specs]).flatMap((spec) => spec?.channels ?? []));
    return this.invoker.invoke(ActivityNames.batchPublish, `batchPublish (${channelCount(channels.size)})`, {
      specs,
    });
  }

  /**
   * Retrieves the presence members of one or more channels, up to a maximum of 100 channels. Runs as a Temporal
   * activity.
   *
   * @param channels - The names of the channels.
   * @returns A promise which is fulfilled with the result for each channel. The `error` of a failure result is a
   * plain object with the fields of an `ErrorInfo`.
   */
  async batchPresence(
    channels: string[],
  ): Promise<Ably.BatchResult<Ably.BatchPresenceSuccessResult | Ably.BatchPresenceFailureResult>[]> {
    requireStringArray('batchPresence', 'channels', channels);
    return this.invoker.invoke(ActivityNames.batchPresence, `batchPresence (${channelCount(channels.length)})`, {
      channels,
    });
  }
}

function channelCount(count: number): string {
  return count === 1 ? '1 channel' : `${count} channels`;
}
