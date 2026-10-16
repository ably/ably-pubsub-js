import {
  getRandomStream,
  proxyActivities,
  proxyLocalActivities,
  type ActivityOptions,
  type LocalActivityOptions,
} from '@temporalio/workflow';
import type { AblyActivities, ActivityName } from '../common/activities.js';
import { decodeFromWire, encodeForWire } from '../common/wire.js';

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
      'Idempotent publishing from workflow code requires @temporalio/workflow 1.18.0 or later. Upgrade the @temporalio packages used by your worker to 1.18.0 or later, or set TemporalRestOptions.idempotentPublishing to false.',
    );
  }
  return getRandomStream(MESSAGE_ID_STREAM);
}

type ActivityArgs<N extends ActivityName> = Parameters<AblyActivities[N]>;
type ActivityResult<N extends ActivityName> = Awaited<ReturnType<AblyActivities[N]>>;

/** Options for an {@link ActivityInvoker}, from `TemporalRestOptions`. */
export interface ActivityInvokerOptions {
  activityOptions?: ActivityOptions;
  localActivityOptions?: LocalActivityOptions;
  idempotentPublishing: boolean;
}

/**
 * Runs Ably activities on behalf of a `TemporalRest` instance and the channels it creates.
 *
 * The activity proxy is created on each call rather than up front, because creating one is only allowed inside a
 * workflow, and `TemporalRest` can be constructed at module scope. This also lets each call carry its own summary.
 */
export class ActivityInvoker {
  constructor(private readonly options: ActivityInvokerOptions) {}

  /**
   * Runs the activity `name`, encoding its arguments for the activity boundary and decoding its result.
   *
   * @param summary - The summary shown for the activity in the Temporal UI, unless the caller set their own.
   */
  async invoke<N extends ActivityName>(name: N, summary: string, ...args: ActivityArgs<N>): Promise<ActivityResult<N>> {
    const activity = this.proxy(summary)[name] as unknown as (...args: unknown[]) => Promise<unknown>;
    const result = await activity(...args.map(encodeForWire));
    return decodeFromWire(result) as ActivityResult<N>;
  }

  /**
   * Returns `messages` with an ID assigned to each message when idempotent publishing is enabled and no message
   * has an ID. The IDs are `<base>:<index>`, where `base` is a UUID drawn from a named random stream, so the IDs
   * are the same on every replay of the workflow and on every attempt of the activity.
   *
   * This applies to anything published with an `id` that Ably uses for deduplication, such as messages, annotations
   * and object operations. The caller's objects are never modified. Messages that need IDs are copied.
   */
  assignMessageIds<T extends { id?: string }>(messages: T[]): T[] {
    if (!this.options.idempotentPublishing || messages.length === 0 || !messages.every((message) => !message?.id)) {
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
