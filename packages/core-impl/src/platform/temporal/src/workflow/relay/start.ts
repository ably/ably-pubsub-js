// startAblyRelay() and relay.complete() run in the user's own workflow, so a worker that upgrades this package replays
// the user's running workflows on the new code. Change the commands they make (the child workflow and the timer) only
// behind patched(), so that those workflows still replay. relay-replay.test.ts in
// packages/core-impl/test/temporal/workflow/ replays histories recorded by earlier releases to check this.

import {
  ParentClosePolicy,
  condition,
  log,
  setHandler,
  startChild,
  workflowInfo,
  type ActivityOptions,
} from '@temporalio/workflow';
import type { WorkflowStream } from '@temporalio/workflow-streams/workflow';
import { END_OF_STREAM, RELAY_TOPIC } from '../../common/relay.js';
import type {
  AblyRelayCompletion,
  RelayCheckpointOptions,
  RelayRoute,
  RelayRouteOutcome,
  RelayTopicEvent,
} from '../../common/relay.js';
import { ablyFailure } from '../failure.js';
import { relayCompletedSignal } from './workflow.js';
import type { ablyRelayWorkflow } from './workflow.js';

/** Options for {@link startAblyRelay}. */
export interface AblyRelayOptions extends RelayCheckpointOptions {
  /** The routes to relay: which Workflow Stream topics go to which Ably channel, through which adaptor. */
  routes: RelayRoute[];
  /**
   * How long, in milliseconds, {@link AblyRelay.complete} waits for the relay to confirm that it has relayed every
   * event before it gives up. Defaults to 60000.
   */
  completeTimeoutMs?: number;
  /**
   * Options for the relay's activities, applied over its defaults: a `startToCloseTimeout` of 1 hour, a
   * `heartbeatTimeout` of 30 seconds, and retries without a limit on attempts, from 1 second to at most 1 minute
   * apart. The fields of `retry` are applied over the default policy one by one. Set `taskQueue` to run them on workers
   * other than the relay workflow's. Keep a `heartbeatTimeout`, so that Temporal notices a lost worker quickly.
   */
  activityOptions?: ActivityOptions;
}

/** A relay started by {@link startAblyRelay}. */
export interface AblyRelay {
  /**
   * Marks the end of the source workflow's stream, and waits until the relay reports how each route ended. Call it
   * once the workflow has published its last event, and before it returns, so that the relay is not cut off by the
   * workflow closing.
   *
   * It never throws. It resolves with the relay's outcome, which the workflow can act on, for example by telling its
   * clients that part of a response was lost:
   *
   * - `succeeded`: every route relayed every event published before `complete()`, apart from any its adaptor skipped as
   *   unsupported, which each route's `skipped` counts.
   * - `failed`: at least one route failed and stopped relaying. Each failed route has an `error`. The relay workflow
   *   ends as failed, and can be reset once the cause is fixed, while this workflow is still running.
   * - `timed-out`: the relay did not report within `completeTimeoutMs`, which also logs a warning. The relay carries
   *   on, but any events it hasn't relayed when this workflow closes are lost.
   */
  complete(): Promise<AblyRelayCompletion>;
}

const DEFAULT_COMPLETE_TIMEOUT_MS = 60_000;

/**
 * Starts relaying a Workflow Stream to Ably channels, from the workflow that owns the stream.
 *
 * On the workflow's first run, it starts `ablyRelayWorkflow` as a child workflow that outlives this workflow, and
 * waits for the child to start. The child's ID is `<workflowId>:ably:<firstExecutionRunId>`, unique to this chain of
 * runs. On a later run of the chain, after Continue-As-New or a retry, the relay is already running and following the
 * stream, so call `startAblyRelay()` again only to get the handle for `complete()`. The relay keeps the routes and
 * options it was started with, so those passed on a later run are checked but otherwise ignored.
 *
 * After a retry, the relay closes its adaptors, which ends whatever the failed attempt left open, and relays the retry's
 * stream from its start. Subscribers see the failed attempt's output, then the retry's.
 *
 * A workflow with a cron schedule cannot relay: each of its runs would end the relay with `complete()`. Use a Temporal
 * Schedule instead, which starts each run as a workflow of its own, with a relay of its own.
 *
 * The relay addresses this workflow by its run IDs, following each Continue-As-New, and never as the latest run with
 * its workflow ID. So another workflow can reuse the workflow ID as soon as this one has closed: it starts a relay of
 * its own, and neither relay reads the other's stream.
 *
 * The workers must register `ablyRelayWorkflow`, and `AblyRelayPlugin` from `@ably/pubsub-server/temporal` with the
 * adaptor that each route names.
 *
 * ```ts
 * import { WorkflowStream } from '@temporalio/workflow-streams/workflow';
 * import { startAblyRelay } from '@ably/pubsub-server/temporal/workflow';
 *
 * export async function agentWorkflow(input: AgentInput): Promise<void> {
 *   const stream = new WorkflowStream(input.streamState);
 *   const relay = await startAblyRelay(stream, {
 *     routes: [{ topics: ['agent'], adaptor: 'events', channel: `chat:${input.chatId}` }],
 *   });
 *   // ... publish events to stream.topic('agent')
 *   await relay.complete();
 * }
 * ```
 *
 * @param stream - The workflow's Workflow Stream.
 * @param options - The routes, and the relay's options.
 * @throws An `ApplicationFailure` of type `AblyError`, which fails the workflow, if `options` are invalid or the
 * workflow has a cron schedule.
 */
export async function startAblyRelay(stream: WorkflowStream, options: AblyRelayOptions): Promise<AblyRelay> {
  validateOptions(options);
  if (workflowInfo().cronSchedule) {
    throw invalidOption(
      'startAblyRelay() was called from a workflow with a cron schedule, whose runs the relay cannot follow',
      'Start the workflow from a Temporal Schedule instead of with cronSchedule. A Schedule starts each run as a workflow of its own, which gets a relay of its own.',
    );
  }
  const { routes, completeTimeoutMs = DEFAULT_COMPLETE_TIMEOUT_MS, activityOptions, ...checkpoints } = options;

  let outcomes: RelayRouteOutcome[] | undefined;
  const info = workflowInfo();
  setHandler(relayCompletedSignal, (signal) => {
    // A relay started for an earlier workflow with the same ID would name that workflow's first run.
    if (signal.sourceRunId === info.firstExecutionRunId) {
      outcomes = signal.routes;
    }
  });

  if (info.continuedFromExecutionRunId === undefined) {
    await startChild<typeof ablyRelayWorkflow>('ablyRelayWorkflow', {
      workflowId: `${info.workflowId}:ably:${info.firstExecutionRunId}`,
      parentClosePolicy: ParentClosePolicy.ABANDON,
      args: [
        {
          sourceWorkflowId: info.workflowId,
          sourceRunId: info.firstExecutionRunId,
          routes,
          checkpoints,
          activityOptions,
        },
      ],
    });
  }

  return {
    complete: async () => {
      const event: RelayTopicEvent = { type: END_OF_STREAM };
      stream.topic(RELAY_TOPIC).publish(event);
      if (!(await condition(() => outcomes !== undefined, completeTimeoutMs)) || !outcomes) {
        log.warn(
          'Ably: the relay did not confirm within completeTimeoutMs that it had relayed every event, so events may be lost when this workflow closes',
          { completeTimeoutMs },
        );
        return { status: 'timed-out', routes: [] };
      }
      const failed = outcomes.filter((route) => route.status === 'failed');
      if (failed.length > 0) {
        log.warn('Ably: relay routes failed, so their events after the failure were not relayed', {
          channels: failed.map((route) => route.channel),
        });
        return { status: 'failed', routes: outcomes };
      }
      return { status: 'succeeded', routes: outcomes };
    },
  };
}

function validateOptions(options: AblyRelayOptions): void {
  const routes: unknown = options?.routes;
  if (!Array.isArray(routes) || routes.length === 0) {
    throw invalidOption(
      'startAblyRelay() was called without any routes',
      'Pass at least one route in options.routes, such as { topics: ["agent"], adaptor: "events", channel: "chat:123" }.',
    );
  }
  routes.forEach((route: Partial<RelayRoute> | null, index) => {
    const topics: unknown = route?.topics;
    if (
      !Array.isArray(topics) ||
      topics.length === 0 ||
      !topics.every((topic) => typeof topic === 'string' && topic !== '')
    ) {
      throw invalidOption(
        `startAblyRelay() route ${index} has no topics, or a topic that is not a non-empty string`,
        'Set the route topics to the names of the Workflow Stream topics it relays, such as ["agent"].',
      );
    }
    if (topics.includes(RELAY_TOPIC)) {
      throw invalidOption(
        `startAblyRelay() route ${index} includes the topic ${RELAY_TOPIC}, which the relay reserves for itself`,
        `Publish your events to a topic other than ${RELAY_TOPIC}, and route that topic instead.`,
      );
    }
    for (const field of ['adaptor', 'channel'] as const) {
      if (typeof route?.[field] !== 'string' || route[field] === '') {
        throw invalidOption(
          `startAblyRelay() route ${index} has no ${field}, or one that is not a non-empty string`,
          field === 'adaptor'
            ? 'Set the route adaptor to the name of an adaptor registered in the adaptors option of AblyRelayPlugin.'
            : 'Set the route channel to the name of the Ably channel to publish to.',
        );
      }
    }
  });
  for (const field of ['checkpointBudget', 'idleCheckpointMs', 'completeTimeoutMs'] as const) {
    const value = options[field];
    if (value !== undefined && !(typeof value === 'number' && Number.isInteger(value) && value > 0)) {
      throw invalidOption(
        `startAblyRelay() option ${field} is not a positive integer`,
        `Set ${field} to a positive integer, or leave it out to use the default.`,
      );
    }
  }
}

function invalidOption(message: string, remediation: string) {
  return ablyFailure({ message, code: 40003, statusCode: 400, remediation });
}
