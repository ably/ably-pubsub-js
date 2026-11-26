// A worker that upgrades this package replays running relays on the new code, and a relay runs as long as its source.
// Change the commands ablyRelayWorkflow makes (its activities, the signal to the source, Continue-As-New and how it
// ends) only behind patched(), so that running relays still replay. Keep its input, including the state it carries
// across Continue-As-New, and the completion signal readable by both the old and the new code: a relay can continue as
// new onto a worker of another release, and signal a source running on one. relay-replay.test.ts in
// packages/core-impl/test/temporal/workflow/ replays histories recorded by earlier releases to check this.

import {
  ActivityFailure,
  ApplicationFailure,
  continueAsNew,
  defineSignal,
  getExternalWorkflowHandle,
  isCancellation,
  log,
  proxyActivities,
  workflowInfo,
  type ActivityOptions,
} from '@temporalio/workflow';
import { RELAY_ACTIVITY_NAME } from '../../common/relay.js';
import type {
  RelayActivities,
  RelayCheckpoint,
  RelayCheckpointOptions,
  RelayRoute,
  RelayRouteOutcome,
} from '../../common/relay.js';

/** What the relay tells the source workflow once no route is relaying any more. */
export interface RelayCompletedSignal {
  /** The first run ID of the source's chain, so that a later workflow with the same ID ignores the signal. */
  sourceRunId: string;
  /** How each route ended, in the order of the relay's routes. */
  routes: RelayRouteOutcome[];
}

/**
 * The signal that the relay sends to the source workflow once every route has either relayed the end-of-stream event
 * or failed. `relay.complete()` waits for it.
 */
export const relayCompletedSignal = defineSignal<[RelayCompletedSignal]>('ably.relay.completed');

/** The state of one route, which the relay carries across its own Continue-As-New. */
export interface RelayRouteState extends RelayCheckpoint {
  status: 'running' | 'completed' | 'source-closed' | 'failed';
  /** The route events skipped so far because the adaptor rejected them as unsupported. */
  skipped?: number;
  /** Why the route failed, when it did. */
  error?: { message: string; type?: string };
}

/** Input for {@link ablyRelayWorkflow}. `startAblyRelay()` builds it, so most applications never construct it. */
export interface AblyRelayWorkflowInput {
  /** The ID of the workflow whose Workflow Stream the relay reads. */
  sourceWorkflowId: string;
  /**
   * The first run ID of the source's workflow chain. The relay passes it in its completion signal, so that a later
   * workflow with the same ID ignores the signal.
   */
  sourceRunId: string;
  routes: RelayRoute[];
  checkpoints?: RelayCheckpointOptions;
  /**
   * Options for the relay activities, applied over {@link DEFAULT_RELAY_ACTIVITY_OPTIONS}. The fields of `retry` are
   * applied over the default policy one by one.
   */
  activityOptions?: ActivityOptions;
  /** The state of each route, in the order of `routes`. Absent when the relay starts, and set by its Continue-As-New. */
  state?: RelayRouteState[];
}

/**
 * The options the relay activities run with by default.
 *
 * - A long `startToCloseTimeout`. The activity checkpoints shortly before this deadline. An activity whose route
 *   publishes nothing returns only then, so it also bounds how long the relay's Continue-As-New waits for it.
 * - A short `heartbeatTimeout`, so that Temporal notices a lost worker quickly, and the activity learns quickly that it
 *   has been cancelled.
 * - A retry policy with no limit on attempts, so that a route resumes from its last checkpoint once the cause of a
 *   failure, such as a lost connection, has passed. Errors that a retry cannot fix fail the activity non-retryably.
 */
export const DEFAULT_RELAY_ACTIVITY_OPTIONS: ActivityOptions = {
  startToCloseTimeout: '1 hour',
  heartbeatTimeout: '30 seconds',
  retry: { initialInterval: '1 second', maximumInterval: '1 minute' },
};

/**
 * The relay workflow, started by `startAblyRelay()` as a child of the source workflow. It runs one chain of relay
 * activities for each route, concurrently, each from its route's last checkpoint, until every route has finished.
 *
 * Register it with your other workflows by re-exporting it from your workflows module:
 *
 * ```ts
 * export { ablyRelayWorkflow } from '@ably/pubsub-server/temporal/workflow';
 * ```
 *
 * Each route ends when it relays the end-of-stream event, finds that the source has closed, or fails. A route that
 * fails, because its activity failed without being retried, stops on its own: the other routes carry on. Once no
 * route is running, the relay signals the source with each route's outcome, so that `relay.complete()` returns it,
 * unless a route found that the source has closed. If any route failed, the relay then ends as failed, so that it
 * shows as failed in Temporal and can be reset once the cause is fixed.
 *
 * When Temporal suggests Continue-As-New, it waits for every activity that started before the suggestion to return,
 * then continues as new with every route's state. Until then, routes whose activities return keep relaying, so a
 * route that publishes nothing, whose activity returns only at its deadline, does not hold up the others.
 */
export async function ablyRelayWorkflow(input: AblyRelayWorkflowInput): Promise<void> {
  const { sourceWorkflowId, routes } = input;
  const state: RelayRouteState[] =
    input.state ??
    routes.map(
      () => ({ status: 'running', offset: 0, handoff: null, runId: input.sourceRunId }) satisfies RelayRouteState,
    );
  // The fields of `retry` are applied over the default policy one by one, so that setting one keeps the others.
  const activities = proxyActivities<RelayActivities>({
    ...DEFAULT_RELAY_ACTIVITY_OPTIONS,
    ...input.activityOptions,
    retry: { ...DEFAULT_RELAY_ACTIVITY_OPTIONS.retry, ...input.activityOptions?.retry },
  });

  // Activities are numbered as they start. Once Temporal suggests Continue-As-New, `suggestedAt` is the number of the
  // next one, and a route stops starting activities once none numbered below it is still running.
  let started = 0;
  let suggestedAt: number | undefined;
  const running = new Set<number>();
  const readyToContinue = (): boolean => {
    if (!workflowInfo().continueAsNewSuggested) {
      return false;
    }
    suggestedAt ??= started;
    return ![...running].some((activity) => activity < suggestedAt!);
  };

  await Promise.all(
    routes.map(async (route, index) => {
      while (state[index].status === 'running' && !readyToContinue()) {
        const activity = started++;
        running.add(activity);
        try {
          const result = await activities[RELAY_ACTIVITY_NAME]({
            sourceWorkflowId,
            route,
            checkpoint: { offset: state[index].offset, handoff: state[index].handoff, runId: state[index].runId },
            options: input.checkpoints,
          });
          state[index] = {
            status: result.status === 'checkpoint' ? 'running' : result.status,
            offset: result.offset,
            handoff: result.handoff,
            runId: result.runId,
            skipped: (state[index].skipped ?? 0) + result.skipped,
          };
        } catch (err) {
          // A route whose activity fails without being retried stops, and the other routes carry on. The failure is
          // reported to the source, and fails the relay once every route has finished.
          if (isCancellation(err) || !(err instanceof ActivityFailure)) {
            throw err;
          }
          const error = failureOf(err);
          state[index] = { ...state[index], status: 'failed', error };
          log.warn('Ably: a relay route failed, so the relay has stopped relaying it', {
            channel: route.channel,
            error: error.message,
          });
        } finally {
          running.delete(activity);
        }
      }
    }),
  );

  if (state.some((route) => route.status === 'running')) {
    await continueAsNew<typeof ablyRelayWorkflow>({ ...input, state });
  }
  const outcomes: RelayRouteOutcome[] = routes.map((route, index) => ({
    channel: route.channel,
    topics: route.topics,
    status: state[index].status === 'failed' ? 'failed' : 'completed',
    skipped: state[index].skipped ?? 0,
    ...(state[index].error ? { error: state[index].error } : {}),
  }));
  // A route that found the source closed means there's no source left to tell.
  if (!state.some((route) => route.status === 'source-closed')) {
    const signal: RelayCompletedSignal = { sourceRunId: input.sourceRunId, routes: outcomes };
    // A completed route read the end-of-stream event in the run that published it, so the signal goes to that run.
    // If every route failed, no run is known to be current, and the signal goes to the latest run, which ignores it
    // unless it belongs to this source's chain.
    const runIds = new Set(state.filter((route) => route.status === 'completed').map((route) => route.runId));
    for (const runId of runIds.size > 0 ? runIds : [undefined]) {
      await signalSource(sourceWorkflowId, runId, signal);
    }
  }
  const failed = outcomes.filter((route) => route.status === 'failed');
  if (failed.length > 0) {
    throw ApplicationFailure.create({
      type: 'AblyRelayRouteFailed',
      nonRetryable: true,
      message: `Ably: ${failed.length} of ${outcomes.length} relay routes failed. ${failed
        .map((route) => `Channel ${route.channel}: ${route.error?.message}`)
        .join(' ')}`,
      details: [outcomes],
    });
  }
}

/** The message and type of the error that a relay activity failed with. */
function failureOf(err: ActivityFailure): { message: string; type?: string } {
  const cause = err.cause;
  if (cause instanceof ApplicationFailure) {
    return { message: cause.message, ...(cause.type ? { type: cause.type } : {}) };
  }
  return { message: (cause ?? err).message };
}

/**
 * Tells the source workflow how each route ended. The run may have closed already, for example because
 * `relay.complete()` timed out, so a failure to signal it is logged rather than failing the relay.
 */
async function signalSource(
  sourceWorkflowId: string,
  runId: string | undefined,
  signal: RelayCompletedSignal,
): Promise<void> {
  try {
    await getExternalWorkflowHandle(sourceWorkflowId, runId).signal(relayCompletedSignal, signal);
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    log.warn('Ably: the relay could not tell the source workflow how its routes ended', {
      sourceWorkflowId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
