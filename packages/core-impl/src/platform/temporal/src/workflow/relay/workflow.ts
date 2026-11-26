import {
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
import type { RelayActivities, RelayCheckpoint, RelayCheckpointOptions, RelayRoute } from '../../common/relay.js';

/**
 * The signal that the relay sends to the source workflow once every route has relayed the end-of-stream event.
 * `relay.complete()` waits for it.
 */
export const relayCompletedSignal = defineSignal<[sourceRunId: string]>('ably.relay.completed');

/** The state of one route, which the relay carries across its own Continue-As-New. */
export interface RelayRouteState extends RelayCheckpoint {
  status: 'running' | 'completed' | 'source-closed';
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
 * Once every route has relayed the end-of-stream event, it signals the source workflow, so that `relay.complete()`
 * returns. If any route finds that the source has closed instead, it finishes without signalling.
 *
 * When Temporal suggests Continue-As-New, it waits for every activity that started before the suggestion to return,
 * then continues as new with every route's state. Until then, routes whose activities return keep relaying, so a
 * route that publishes nothing, whose activity returns only at its deadline, does not hold up the others.
 */
export async function ablyRelayWorkflow(input: AblyRelayWorkflowInput): Promise<void> {
  const { sourceWorkflowId, routes } = input;
  const state: RelayRouteState[] =
    input.state ?? routes.map(() => ({ status: 'running', offset: 0, handoff: null }) satisfies RelayRouteState);
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
          const { status, offset, handoff } = await activities[RELAY_ACTIVITY_NAME]({
            sourceWorkflowId,
            route,
            checkpoint: { offset: state[index].offset, handoff: state[index].handoff },
            options: input.checkpoints,
          });
          state[index] = { status: status === 'checkpoint' ? 'running' : status, offset, handoff };
        } finally {
          running.delete(activity);
        }
      }
    }),
  );

  if (state.some((route) => route.status === 'running')) {
    await continueAsNew<typeof ablyRelayWorkflow>({ ...input, state });
  }
  if (state.every((route) => route.status === 'completed')) {
    await signalSource(sourceWorkflowId, input.sourceRunId);
  }
}

/**
 * Tells the source workflow that every route has relayed its stream. The source may have closed already, for example
 * because `relay.complete()` timed out, so a failure to signal it is logged rather than failing the relay.
 */
async function signalSource(sourceWorkflowId: string, sourceRunId: string): Promise<void> {
  try {
    await getExternalWorkflowHandle(sourceWorkflowId).signal(relayCompletedSignal, sourceRunId);
  } catch (err) {
    if (isCancellation(err)) {
      throw err;
    }
    log.warn('Ably: the relay could not signal the source workflow that it has relayed every event', {
      sourceWorkflowId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
