import type { RealtimeChannelPool, RealtimePublisherChannel } from '@ably/pubsub-server';
import { asyncLocalStorage } from '@temporalio/activity';
import type { Context } from '@temporalio/activity';
import { ApplicationFailure, WorkflowNotFoundError } from '@temporalio/common';
import type { WorkflowStreamItem } from '@temporalio/workflow-streams/client';
import {
  DEFAULT_CHECKPOINT_BUDGET,
  DEFAULT_IDLE_CHECKPOINT_MS,
  END_OF_STREAM,
  RELAY_ACTIVITY_NAME,
  RELAY_TOPIC,
  RELAY_UNSUPPORTED_EVENT_TYPE,
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
import type { RelayAdaptor, RelayAdaptorFactory, RelayAdaptorResult } from './adaptor.js';

/** The events of one run of the source workflow's Workflow Stream, on the topics a route reads, from an offset. */
export type RelayEvents = AsyncIterator<WorkflowStreamItem<unknown>, void>;

/** A route's subscription to one run of the source workflow's Workflow Stream. */
export interface RelaySubscription {
  /** The run's events. They end, or reject with a `WorkflowNotFoundError`, once the run has closed. */
  events: RelayEvents;
  /**
   * Publishes a {@link WAKE} event to the run's {@link RELAY_TOPIC}, which ends every read that the run is holding for
   * a relay, this attempt's included.
   */
  wake(): Promise<void>;
}

/**
 * The source workflow, addressed one run at a time by its run ID, never as "the latest run with this workflow ID". A
 * later workflow that reuses the source's workflow ID is a different run, so the relay never reads it.
 */
export interface RelaySource {
  /** Subscribes to one run of the source, from an offset. */
  subscribe(runId: string, topics: string[], fromOffset: number): Promise<RelaySubscription>;
  /**
   * The run that a closed run led to, or `undefined` if it led to none, and so the source has closed.
   */
  nextRun(runId: string): Promise<RelayNextRun | undefined>;
}

/** The run that a closed run of the source led to. */
export interface RelayNextRun {
  runId: string;
  /**
   * Whether the run's stream starts empty, at offset 0. It does for a retry of the workflow, which starts again from
   * scratch. It doesn't for Continue-As-New, which carries the stream's state over, so offsets run on.
   */
  freshStream: boolean;
}

/** Opens the {@link RelaySource} for an activity attempt. */
export type OpenRelaySource = (activity: Context, sourceWorkflowId: string) => RelaySource;

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
  const source = openSource(activity, sourceWorkflowId);
  const topics = [...route.topics, RELAY_TOPIC];
  let adaptor: RelayAdaptor | undefined;
  try {
    run.subscription = await source.subscribe(run.runId, topics, run.offset);
    adaptor = createAdaptor(factory, channel, route.adaptor, checkpoint);
    const result = await relayUntilReturn(activity, source, topics, adaptor, run, input, deadline);
    activity.log.debug(`Ably: relay route ${result.status}`, {
      channel: route.channel,
      fromOffset: checkpoint.offset,
      offset: result.offset,
      runId: result.runId,
    });
    return result;
  } catch (err) {
    // The adaptor stops before its channel is released, so that nothing from it overwrites what the retry writes.
    abortAdaptor(activity, adaptor);
    if (activity.cancellationSignal.aborted) {
      throw activity.cancellationSignal.reason;
    }
    throw toActivityFailure(err);
  } finally {
    stopHeartbeating();
    channel.release();
    if (run.subscription) {
      endSubscription(activity, run.subscription, run.reading);
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
    typeof candidate.close !== 'function' ||
    (candidate.abort !== undefined && typeof candidate.abort !== 'function')
  ) {
    throw ApplicationFailure.create({
      message: `The relay adaptor factory registered as "${name}" returned no adaptor with write, flush and close methods, and an abort method if any. Register the factory itself in the \`adaptors\` option of AblyRelayPlugin, for example \`publishPerEvent()\` rather than \`publishPerEvent\`.`,
      type: 'AblyRelayInvalidAdaptor',
      nonRetryable: true,
    });
  }
  return candidate as RelayAdaptor;
}

/**
 * Stops the adaptor of an attempt that has failed or been cancelled, if it has an `abort()`. An error from `abort()`
 * is logged rather than thrown, so that the activity fails with the error that ended the attempt.
 */
function abortAdaptor(activity: Context, adaptor: RelayAdaptor | undefined): void {
  try {
    adaptor?.abort?.();
  } catch (err) {
    activity.log.warn('Ably: the relay adaptor threw from abort(), which it must not', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** The progress of one activity attempt along its route. */
class RouteRun {
  /** The offset after the last event read. */
  offset: number;
  /** The run of the source being read. */
  runId: string;
  /** The subscription to that run, once open. */
  subscription: RelaySubscription | undefined;
  /** The route events written in this attempt. */
  relayed = 0;
  /** The route events skipped in this attempt because the adaptor rejected them as unsupported. */
  skipped = 0;
  /** When the last route event was read. */
  lastEventAt = 0;
  /** Whether a read of the source is in progress. */
  reading = false;

  constructor(checkpoint: RelayCheckpoint) {
    this.offset = checkpoint.offset;
    this.runId = checkpoint.runId;
  }

  /** The checkpoint for this point, with the adaptor's handoff. */
  checkpoint(status: RelayActivityResult['status'], result: RelayAdaptorResult): RelayActivityResult {
    return { status, offset: this.offset, runId: this.runId, handoff: result.handoff, skipped: this.skipped };
  }
}

/**
 * Reads the route's events from the source into `adaptor` until the activity returns: once the route finishes, once
 * it has relayed `checkpointBudget` events, once the route has been quiet for `idleCheckpointMs` after an event, or
 * shortly before its deadline. Each checkpoint flushes the adaptor first.
 *
 * When the run being read closes, the activity looks up how. If it continued as new, the activity carries on in the
 * next run, from the same offset, since the stream's state carries over. If the workflow is retried, the activity
 * closes its adaptor and returns a checkpoint at the start of the retry's stream. Otherwise the source has closed.
 */
async function relayUntilReturn(
  activity: Context,
  source: RelaySource,
  topics: string[],
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
      return run.checkpoint('checkpoint', await adaptor.flush());
    }

    if (!read) {
      read = run.subscription!.events.next();
      run.reading = true;
    }
    const next = await nextOrClosed(read, checkpointAt - now, activity.cancellationSignal);
    if (next === TIMED_OUT) {
      // Either a checkpoint is due, or the timer was capped short of it. The loop checks which.
      continue;
    }
    read = undefined;
    run.reading = false;
    if (next.done) {
      const nextRun = await source.nextRun(run.runId);
      if (nextRun === undefined) {
        return run.checkpoint('source-closed', await adaptor.close());
      }
      if (nextRun.freshStream) {
        // A retry starts the work again in an empty stream. Whatever the failed attempt left open is dead, so the
        // adaptor closes, and the next activity reads the retry from its start with a new adaptor.
        await adaptor.close();
        return { status: 'checkpoint', offset: 0, handoff: null, runId: nextRun.runId, skipped: run.skipped };
      }
      endSubscription(activity, run.subscription!, false);
      run.runId = nextRun.runId;
      run.subscription = await source.subscribe(nextRun.runId, topics, run.offset);
      continue;
    }

    const event = next.value;
    run.offset = event.offset + 1;
    if (event.topic === RELAY_TOPIC) {
      if (isEndOfStream(event.data)) {
        return run.checkpoint('completed', await adaptor.close());
      }
      continue;
    }
    if (!writeOrSkip(activity, adaptor, event, input.route)) {
      run.skipped++;
      continue;
    }
    run.relayed++;
    run.lastEventAt = Date.now();
    if (run.relayed >= budget) {
      return run.checkpoint('checkpoint', await adaptor.flush());
    }
  }
}

/**
 * Writes a route event to the adaptor. Returns `false` if the adaptor rejected it with `unsupportedRelayEvent()`, in
 * which case the event is skipped and logged. Any other error from `write()` is thrown.
 */
function writeOrSkip(
  activity: Context,
  adaptor: RelayAdaptor,
  event: WorkflowStreamItem<unknown>,
  route: RelayActivityInput['route'],
): boolean {
  try {
    adaptor.write({ topic: event.topic, offset: event.offset, data: event.data });
    return true;
  } catch (err) {
    if (!isUnsupportedRelayEvent(err)) {
      throw err;
    }
    activity.log.warn("Ably: the relay skipped an event that the route's adaptor can't write", {
      channel: route.channel,
      adaptor: route.adaptor,
      topic: event.topic,
      offset: event.offset,
      reason: typeof err.message === 'string' ? err.message : undefined,
    });
    return false;
  }
}

/**
 * Whether `write()` threw an unsupported event. The check is structural, not `instanceof`, so an adaptor without a
 * Temporal dependency can throw any object, such as an `Ably.ErrorInfo`, whose `type` is
 * {@link RELAY_UNSUPPORTED_EVENT_TYPE}.
 */
function isUnsupportedRelayEvent(err: unknown): err is { type: string; message?: unknown } {
  return typeof err === 'object' && err !== null && (err as { type?: unknown }).type === RELAY_UNSUPPORTED_EVENT_TYPE;
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

/**
 * As {@link settledWithin}, except that a read rejected because the run has closed resolves as the end of the events.
 * A subscription pinned to one run reports its close either way.
 */
async function nextOrClosed(
  read: Promise<IteratorResult<WorkflowStreamItem<unknown>, void>>,
  waitMs: number,
  signal: AbortSignal,
): Promise<IteratorResult<WorkflowStreamItem<unknown>, void> | typeof TIMED_OUT> {
  try {
    return await settledWithin(read, waitMs, signal);
  } catch (err) {
    if (err instanceof WorkflowNotFoundError && !signal.aborted) {
      return { done: true, value: undefined };
    }
    throw err;
  }
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

/** `temporal.api.enums.v1.HistoryEventFilterType.HISTORY_EVENT_FILTER_TYPE_CLOSE_EVENT`, a fixed protobuf value. */
const CLOSE_EVENT_FILTER = 2;

/** The gRPC status code `NOT_FOUND`. */
const GRPC_NOT_FOUND = 5;

/**
 * Reads the source workflow through the worker's Temporal client, one run at a time.
 *
 * Each subscription is a `WorkflowStreamClient` built from a handle on one run, with its public constructor. Unlike
 * `WorkflowStreamClient.create()`, which addresses the latest run with the workflow ID and so could reach a later
 * workflow that reuses it, such a client reads only that run, and does not follow Continue-As-New. The relay follows it
 * instead, by reading the closed run's close event, which names the run it continued into, or the retry.
 *
 * Events are decoded with the client's payload converter, as `WorkflowStreamClient.create()` does.
 * `@temporalio/workflow-streams` is an optional peer dependency, so it is loaded only when a relay activity runs.
 */
const openWorkflowStream: OpenRelaySource = (activity, sourceWorkflowId) => ({
  async subscribe(runId, topics, fromOffset) {
    const { WorkflowStreamClient } = await import('@temporalio/workflow-streams/client');
    const stream = new WorkflowStreamClient(activity.client.workflow.getHandle(sourceWorkflowId, runId));
    const { payloadConverter } = activity.client.options.loadedDataConverter;
    return {
      events: decoded(stream.subscribe(topics, fromOffset), (payload) => payloadConverter.fromPayload(payload)),
      wake: async () => {
        const event: RelayTopicEvent = { type: WAKE };
        stream.topic(RELAY_TOPIC).publish(event);
        // Sends the event and stops the client's background flusher.
        await stream[Symbol.asyncDispose]();
      },
    };
  },

  async nextRun(runId) {
    try {
      const { history } = await activity.client.workflowService.getWorkflowExecutionHistory({
        namespace: activity.client.options.namespace,
        execution: { workflowId: sourceWorkflowId, runId },
        historyEventFilterType: CLOSE_EVENT_FILTER,
      });
      const closeEvent = history?.events?.[0];
      if (!closeEvent) {
        // Only reachable if the run has not closed, which the subscription ending says it has. A retry looks again.
        throw new Error(`Ably: the relay found no close event for run ${runId} of workflow ${sourceWorkflowId}`);
      }
      const nextRunId =
        closeEvent.workflowExecutionContinuedAsNewEventAttributes?.newExecutionRunId ||
        closeEvent.workflowExecutionFailedEventAttributes?.newExecutionRunId ||
        closeEvent.workflowExecutionTimedOutEventAttributes?.newExecutionRunId;
      if (!nextRunId) {
        return undefined;
      }
      // The close event alone can't say why there is a next run: for a run that is retried, this history call returns
      // a ContinuedAsNew event, although the run failed. The run's status can: CONTINUED_AS_NEW when the workflow
      // continued as new, which carries the stream's state over, and FAILED or TIMED_OUT when it is retried, which
      // starts the stream again. Any other status with a next run is a cron schedule, which startAblyRelay refuses.
      const { status } = await activity.client.workflow.getHandle(sourceWorkflowId, runId).describe();
      switch (status.name) {
        case 'CONTINUED_AS_NEW':
          return { runId: nextRunId, freshStream: false };
        case 'FAILED':
        case 'TIMED_OUT':
          return { runId: nextRunId, freshStream: true };
        default:
          return undefined;
      }
    } catch (err) {
      // The run's history is gone once the namespace's retention period has passed, so the relay cannot follow it.
      if ((err as { code?: unknown } | null)?.code === GRPC_NOT_FOUND) {
        return undefined;
      }
      throw err;
    }
  },
});

/** The items of `items`, with each item's data decoded by `decode`. */
async function* decoded<P>(
  items: AsyncIterable<WorkflowStreamItem<P>>,
  decode: (payload: P) => unknown,
): AsyncGenerator<WorkflowStreamItem<unknown>, void> {
  for await (const item of items) {
    yield { ...item, data: decode(item.data) };
  }
}
