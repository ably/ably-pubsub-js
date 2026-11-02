import {
  getRandomStream,
  proxyActivities,
  proxyLocalActivities,
  type ActivityOptions,
  type LocalActivityOptions,
} from '@temporalio/workflow';
import type { AblyActivities, ActivityName } from '../common/activities.js';
import { toWireValue } from '../common/wire.js';
import { ablyFailure } from './failure.js';

/** The activity options applied beneath the caller's own options. */
export const DEFAULT_ACTIVITY_OPTIONS = { startToCloseTimeout: '30 seconds' } as const;

/** The name of the random stream that message IDs and idempotency keys are drawn from. */
const MESSAGE_ID_STREAM = 'ably.temporal.messageIds';

/**
 * Returns the random stream that message IDs and idempotency keys are drawn from. Named random streams were added
 * in `@temporalio/workflow` 1.18.0, so on an earlier version this throws, which fails the workflow task until the
 * worker is redeployed with a supported version.
 */
function messageIdStream() {
  if (typeof getRandomStream !== 'function') {
    throw new TypeError(
      'Idempotent publishing from workflow code requires @temporalio/workflow 1.18.0 or later. Upgrade the @temporalio packages used by your worker to 1.18.0 or later, or set TemporalAblyHttpClientOptions.idempotentPublishing to false.',
    );
  }
  return getRandomStream(MESSAGE_ID_STREAM);
}

type ActivityArgs<N extends ActivityName> = Parameters<AblyActivities[N]>;
type ActivityResult<N extends ActivityName> = Awaited<ReturnType<AblyActivities[N]>>;

/** Options for an {@link ActivityInvoker}, from `TemporalAblyHttpClientOptions`. */
export interface ActivityInvokerOptions {
  activityOptions?: ActivityOptions;
  localActivityOptions?: LocalActivityOptions;
  idempotentPublishing: boolean;
}

/** The name of the method that runs the activity `name`, for an error message, such as `object.publish`. */
function methodName(name: ActivityName): string {
  return name.replace(/^ably\.(channel\.)?/, '');
}

/**
 * Returns `arg` as it is sent to the activity, after checking that it contains no binary values. Binary data is only
 * sent where it is encoded as base64 before this, such as the `data` of a message, because Temporal's JSON payload
 * converter would otherwise serialise it as an object of numbered bytes.
 */
function activityArgument(name: ActivityName, arg: unknown): unknown {
  return toWireValue(arg, (_bytes, path) => {
    throw ablyFailure({
      message: `${methodName(name)}() was called with binary data at ${path || 'its argument'}, where workflow code cannot pass binary data to an Ably activity`,
      code: 40003,
      statusCode: 400,
      remediation:
        'Pass binary data only as the data of a message or annotation, or as the bytes of a LiveObjects value. Encode any other binary value, such as one nested inside an object, as a base64 string.',
    });
  });
}

/**
 * Runs Ably activities on behalf of a `TemporalAblyHttpClient` instance and the channels it creates.
 *
 * The activity proxy is created on each call rather than up front, because creating one is only allowed inside a
 * workflow, and `TemporalAblyHttpClient` can be constructed at module scope. This also lets each call carry its own summary.
 */
export class ActivityInvoker {
  constructor(private readonly options: ActivityInvokerOptions) {}

  /** Whether idempotent publishing is enabled for the client. */
  get idempotentPublishing(): boolean {
    return this.options.idempotentPublishing;
  }

  /**
   * Runs the activity `name`. Binary data in its arguments must already be encoded, as described in
   * ../common/wire.ts, and binary data in its result is returned encoded.
   *
   * @param summary - The summary shown for the activity in the Temporal UI, unless the caller set their own.
   * @throws An `ApplicationFailure` of type `AblyError` if the arguments contain a binary value.
   */
  async invoke<N extends ActivityName>(name: N, summary: string, ...args: ActivityArgs<N>): Promise<ActivityResult<N>> {
    const wireArgs = args.map((arg) => activityArgument(name, arg));
    const activity = this.proxy(summary)[name] as unknown as (...args: unknown[]) => Promise<unknown>;
    return (await activity(...wireArgs)) as ActivityResult<N>;
  }

  /**
   * Returns `messages` with an ID assigned to each message when idempotent publishing is enabled and no message
   * has an ID. The IDs are `<base>:<index>`, where `base` is a UUID drawn from a named random stream, so the IDs
   * are the same on every replay of the workflow and on every attempt of the activity.
   *
   * This applies to anything published with an `id` that Ably uses for deduplication, such as messages, annotations
   * and object operations. The caller's objects are never modified. Messages that need IDs are copied.
   *
   * @param idempotentPublishing - Whether idempotent publishing is enabled for this call. Defaults to the client's
   * option.
   */
  assignMessageIds<T extends { id?: string }>(
    messages: T[],
    idempotentPublishing: boolean = this.options.idempotentPublishing,
  ): T[] {
    if (!idempotentPublishing || messages.length === 0 || !messages.every((message) => !message?.id)) {
      return messages;
    }
    const base = messageIdStream().uuid4();
    return messages.map((message, index) => ({ ...message, id: `${base}:${index}` }));
  }

  /**
   * Returns `options` with an `idempotencyKey` when idempotent publishing is enabled and `options` has none. The key
   * is a UUID drawn from the same random stream as message IDs, so it is the same on every replay of the workflow
   * and on every attempt of the activity. Ably sends the key as the `idempotencyKey` query parameter, and returns
   * the result of the first attempt for a retry with the same key. The caller's object is never modified.
   */
  withIdempotencyKey<T extends Record<string, unknown>>(options: T | undefined): T | undefined {
    if (!this.options.idempotentPublishing || options?.idempotencyKey !== undefined) {
      return options;
    }
    return { ...options, idempotencyKey: messageIdStream().uuid4() } as unknown as T;
  }

  private proxy(summary: string) {
    const { activityOptions, localActivityOptions } = this.options;
    if (localActivityOptions) {
      return proxyLocalActivities<AblyActivities>({ ...DEFAULT_ACTIVITY_OPTIONS, summary, ...localActivityOptions });
    }
    return proxyActivities<AblyActivities>({ ...DEFAULT_ACTIVITY_OPTIONS, summary, ...activityOptions });
  }
}
