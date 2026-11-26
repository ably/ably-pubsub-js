import type { RealtimeChannelPool, RealtimePublisherChannel } from '@ably/pubsub-server';
import { asyncLocalStorage } from '@temporalio/activity';
import type { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import type { WorkflowStreamItem } from '@temporalio/workflow-streams/client';
import {
  DEFAULT_CHECKPOINT_BUDGET,
  DEFAULT_IDLE_CHECKPOINT_MS,
  END_OF_STREAM,
  RELAY_ACTIVITY_NAME,
  RELAY_TOPIC,
  WAKE,
} from '../../common/relay.js';
import type {
  RelayActivities,
  RelayActivityInput,
  RelayActivityResult,
  RelayCheckpoint,
  RelayTopicEvent,
} from '../../common/relay.js';
import { heartbeatUntilSettled } from '../activities.js';
import { toActivityFailure } from '../errors.js';
import type { RelayAdaptor, RelayAdaptorFactory } from './adaptor.js';

/** The events of a source workflow's Workflow Stream, on the topics a route reads, from an offset. */
export type RelaySource = AsyncIterator<WorkflowStreamItem<unknown>, void>;

/** A route's subscription to the source workflow's Workflow Stream, for one activity attempt. */
export interface RelaySubscription {
  events: RelaySource;
  /**
   * Publishes a {@link WAKE} event to the source's {@link RELAY_TOPIC}, which ends every read that the source is
   * holding for a relay, this attempt's included.
   */
  wake(): Promise<void>;
}

/** Opens a {@link RelaySubscription} for an activity attempt. */
export type OpenRelaySource = (
  activity: Context,
  sourceWorkflowId: string,
  topics: string[],
  fromOffset: number,
) => Promise<RelaySubscription>;

/**
 * How long before the attempt's deadline the activity stops reading and flushes its adaptor, so that the flush can
 * settle before Temporal times the attempt out. A short timeout gets a fifth of its length instead.
 */
const DEADLINE_MARGIN_MS = 10_000;

/**
 * Creates the relay activity, which relays one route of a source workflow's Workflow Stream to Ably, from a checkpoint
 * until it returns the next checkpoint or the route finishes.
 *
 * @param pool - The pool that the activity borrows each route's channel from.
 * @param adaptors - The adaptor factories, keyed by the names that routes refer to them by.
 * @param openSource - Opens the Workflow Stream subscription. Tests replace it.
 */
export function createRelayActivities(
  pool: RealtimeChannelPool,
  adaptors: Readonly<Record<string, RelayAdaptorFactory>>,
  openSource: OpenRelaySource = openWorkflowStream,
): RelayActivities {
  return {
    [RELAY_ACTIVITY_NAME]: (input) => relayRoute(input, pool, adaptors, openSource),
  };
}

async function relayRoute(
  input: RelayActivityInput,
  pool: RealtimeChannelPool,
  adaptors: Readonly<Record<string, RelayAdaptorFactory>>,
  openSource: OpenRelaySource,
): Promise<RelayActivityResult> {
  const activity = asyncLocalStorage.getStore();
  if (!activity) {
    // Only reachable by calling the activity function directly, outside a worker.
    throw new Error('The Ably relay activity must run as a Temporal activity.');
  }
  const { sourceWorkflowId, route } = input;
  const factory = Object.prototype.hasOwnProperty.call(adaptors, route.adaptor) ? adaptors[route.adaptor] : undefined;
  if (!factory) {
    throw ApplicationFailure.create({
      message: `No relay adaptor is registered under the name "${route.adaptor}", which the route to channel "${route.channel}" uses. Register it in the \`adaptors\` option of AblyRelayPlugin on every worker that polls this task queue, or name one of the registered adaptors in the route: ${Object.keys(adaptors).join(', ')}.`,
      type: 'AblyRelayUnknownAdaptor',
      nonRetryable: true,
    });
  }

  const { checkpoint } = input;
  const deadline = attemptDeadline(activity);
  const run = new RouteRun(checkpoint);
  const stopHeartbeating = heartbeatUntilSettled(activity);
  const channel = pool.get(route.channel);
  let subscription: RelaySubscription | undefined;
  try {
    subscription = await openSource(activity, sourceWorkflowId, [...route.topics, RELAY_TOPIC], checkpoint.offset);
    const adaptor = createAdaptor(factory, channel, route.adaptor, checkpoint);
    const result = await relayUntilReturn(activity, subscription.events, adaptor, run, input, deadline);
    activity.log.debug(`Ably: relay route ${result.status}`, {
      channel: route.channel,
      fromOffset: checkpoint.offset,
      offset: result.offset,
    });
    return result;
  } catch (err) {
    if (activity.cancellationSignal.aborted) {
      throw activity.cancellationSignal.reason;
    }
    throw toActivityFailure(err);
  } finally {
    stopHeartbeating();
    channel.release();
    if (subscription) {
      endSubscription(activity, subscription, run.reading);
    }
  }
}

/**
 * Creates the route's adaptor, failing the activity non-retryably if the factory returns something else, since a retry
 * would meet the same factory.
 */
function createAdaptor(
  factory: RelayAdaptorFactory,
  channel: RealtimePublisherChannel,
  name: string,
  checkpoint: RelayCheckpoint,
): RelayAdaptor {
  const adaptor: unknown = factory(channel, checkpoint.handoff);
  const candidate = adaptor as Partial<RelayAdaptor> | null | undefined;
  if (
    typeof candidate?.write !== 'function' ||
    typeof candidate.flush !== 'function' ||
    typeof candidate.close !== 'function'
  ) {
    throw ApplicationFailure.create({
      message: `The relay adaptor factory registered as "${name}" returned no adaptor with write, flush and close methods. Register the factory itself in the \`adaptors\` option of AblyRelayPlugin, for example \`publishPerEvent()\` rather than \`publishPerEvent\`.`,
      type: 'AblyRelayInvalidAdaptor',
      nonRetryable: true,
    });
  }
  return candidate as RelayAdaptor;
}

/** The progress of one activity attempt along its route. */
class RouteRun {
  /** The offset after the last event read. */
  offset: number;
  /** The route events written in this attempt. */
  relayed = 0;
  /** When the last route event was read. */
  lastEventAt = 0;
  /** Whether a read of the source is in progress. */
  reading = false;

  constructor(checkpoint: RelayCheckpoint) {
    this.offset = checkpoint.offset;
  }
}

/**
 * Reads the route's events from `source` into `adaptor` until the activity returns: once the route finishes, once it
 * has relayed `checkpointBudget` events, once the route has been quiet for `idleCheckpointMs` after an event, or
 * shortly before its deadline. Each checkpoint flushes the adaptor first.
 */
async function relayUntilReturn(
  activity: Context,
  source: RelaySource,
  adaptor: RelayAdaptor,
  run: RouteRun,
  input: RelayActivityInput,
  deadline: number,
): Promise<RelayActivityResult> {
  const budget = input.options?.checkpointBudget ?? DEFAULT_CHECKPOINT_BUDGET;
  const idleMs = input.options?.idleCheckpointMs ?? DEFAULT_IDLE_CHECKPOINT_MS;
  let read: Promise<IteratorResult<WorkflowStreamItem<unknown>, void>> | undefined;

  for (;;) {
    // Before the first event, a checkpoint would record nothing new, so the activity waits for the route's next event
    // however long that takes, until its deadline.
    const checkpointAt = Math.min(deadline, run.relayed > 0 ? run.lastEventAt + idleMs : Infinity);
    const now = Date.now();
    if (now >= checkpointAt) {
      return { status: 'checkpoint', offset: run.offset, ...(await adaptor.flush()) };
    }

    if (!read) {
      read = source.next();
      run.reading = true;
    }
    const next = await settledWithin(read, checkpointAt - now, activity.cancellationSignal);
    if (next === TIMED_OUT) {
      // Either a checkpoint is due, or the timer was capped short of it. The loop checks which.
      continue;
    }
    read = undefined;
    run.reading = false;
    if (next.done) {
      return { status: 'source-closed', offset: run.offset, ...(await adaptor.close()) };
    }

    const event = next.value;
    run.offset = event.offset + 1;
    if (event.topic === RELAY_TOPIC) {
      if (isEndOfStream(event.data)) {
        return { status: 'completed', offset: run.offset, ...(await adaptor.close()) };
      }
      continue;
    }
    adaptor.write({ topic: event.topic, offset: event.offset, data: event.data });
    run.relayed++;
    run.lastEventAt = Date.now();
    if (run.relayed >= budget) {
      return { status: 'checkpoint', offset: run.offset, ...(await adaptor.flush()) };
    }
  }
}

const TIMED_OUT = Symbol('timed out');

/** The longest delay that `setTimeout` honours. Node fires a timer with a longer delay after 1 ms. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Waits for `read` to settle, for at most `waitMs`, and resolves with {@link TIMED_OUT} if it has not. Rejects with
 * the signal's reason once `signal` aborts. `read` itself is left as it is, so the caller can wait on it again.
 */
function settledWithin<T>(read: Promise<T>, waitMs: number, signal: AbortSignal): Promise<T | typeof TIMED_OUT> {
  return new Promise((resolve, reject) => {
    const timer = Number.isFinite(waitMs)
      ? setTimeout(() => settle(() => resolve(TIMED_OUT)), Math.min(waitMs, MAX_TIMER_MS))
      : undefined;
    const onAbort = () => settle(() => reject(signal.reason));
    const settle = (action: () => void) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      action();
    };
    if (signal.aborted) {
      onAbort();
    } else {
      signal.addEventListener('abort', onAbort);
    }
    read.then(
      (result) => settle(() => resolve(result)),
      (err: unknown) => settle(() => reject(err)),
    );
  });
}

function isEndOfStream(data: unknown): boolean {
  return typeof data === 'object' && data !== null && (data as { type?: unknown }).type === END_OF_STREAM;
}

/**
 * When the activity stops reading to checkpoint: {@link DEADLINE_MARGIN_MS} before the earlier of the attempt's
 * start-to-close deadline and the activity's schedule-to-close deadline, or never if neither is set.
 */
function attemptDeadline(activity: Context): number {
  const { startToCloseTimeoutMs, scheduleToCloseTimeoutMs, scheduledTimestampMs } = activity.info;
  const deadlines: number[] = [];
  if (startToCloseTimeoutMs > 0) {
    deadlines.push(Date.now() + startToCloseTimeoutMs - margin(startToCloseTimeoutMs));
  }
  if (scheduleToCloseTimeoutMs > 0) {
    deadlines.push(scheduledTimestampMs + scheduleToCloseTimeoutMs - margin(scheduleToCloseTimeoutMs));
  }
  return Math.min(Infinity, ...deadlines);
}

function margin(timeoutMs: number): number {
  return Math.min(DEADLINE_MARGIN_MS, timeoutMs / 5);
}

/**
 * Ends the attempt's subscription. A read still in progress is a poll that the source workflow holds until its next
 * event on the route's topics or until it closes, and Temporal cannot cancel it. Left alone, held polls from attempts
 * on a quiet route accumulate in the source, which accepts only a limited number of updates in flight. So the
 * activity wakes them with an event on the relay topic, which every relay ignores. It does not wait for the wake, so
 * that the attempt returns promptly. If the source has closed, its polls have ended already, and the wake fails
 * harmlessly.
 */
function endSubscription(activity: Context, subscription: RelaySubscription, reading: boolean): void {
  if (reading) {
    subscription.wake().catch((err: unknown) =>
      activity.log.debug('Ably: the relay could not wake the source workflow', {
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
  // An async generator's return() takes effect once its read in progress settles.
  subscription.events.return?.().catch(() => {});
}

/**
 * Subscribes to the source workflow's Workflow Stream through the worker's Temporal client, following the source
 * across Continue-As-New. `@temporalio/workflow-streams` is an optional peer dependency, so it is loaded only when a
 * relay activity runs.
 */
const openWorkflowStream: OpenRelaySource = async (activity, sourceWorkflowId, topics, fromOffset) => {
  const { WorkflowStreamClient } = await import('@temporalio/workflow-streams/client');
  const stream = WorkflowStreamClient.create(activity.client, sourceWorkflowId);
  return {
    events: stream.subscribe<unknown>(topics, fromOffset, { resultType: true }),
    wake: async () => {
      const event: RelayTopicEvent = { type: WAKE };
      stream.topic(RELAY_TOPIC).publish(event);
      // Sends the event and stops the client's background flusher.
      await stream[Symbol.asyncDispose]();
    },
  };
};
