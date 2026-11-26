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
import type { RelayCheckpointOptions, RelayRoute, RelayTopicEvent } from '../../common/relay.js';
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
   * Marks the end of the source workflow's stream, and waits until every route has relayed every event published
   * before it. Call it once the workflow has published its last event, and before it returns, so that the relay is
   * not cut off by the workflow closing.
   *
   * If the relay does not confirm within `completeTimeoutMs`, it logs a warning and returns. The relay carries on,
   * but any events still to relay when the source workflow closes are lost.
   */
  complete(): Promise<void>;
}

const DEFAULT_COMPLETE_TIMEOUT_MS = 60_000;

/**
 * Starts relaying a Workflow Stream to Ably channels, from the workflow that owns the stream.
 *
 * On the workflow's first run, it starts `ablyRelayWorkflow` as a child workflow, with the ID `<workflowId>:ably`,
 * that outlives this workflow, and waits for the child to start. On a later run of the same workflow, after
 * Continue-As-New, the relay is already running and following the stream, so call `startAblyRelay()` again only to
 * get the handle for `complete()`. The relay keeps the routes and options it was started with, so those passed on a
 * later run are checked but otherwise ignored. The relay is not started again when the workflow is retried or run on
 * a cron schedule either, so use it only in workflows that do neither.
 *
 * The relay finds the source by its workflow ID. Do not start another workflow with the same ID until the relay has
 * finished: the relay would read that workflow's stream instead, and starting that workflow's own relay would fail.
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
 * @throws An `ApplicationFailure` of type `AblyError`, which fails the workflow, if `options` are invalid.
 */
export async function startAblyRelay(stream: WorkflowStream, options: AblyRelayOptions): Promise<AblyRelay> {
  validateOptions(options);
  const { routes, completeTimeoutMs = DEFAULT_COMPLETE_TIMEOUT_MS, activityOptions, ...checkpoints } = options;

  let relayed = false;
  const info = workflowInfo();
  setHandler(relayCompletedSignal, (sourceRunId) => {
    // A relay started by an earlier workflow with the same ID would name that workflow's run.
    if (sourceRunId === info.firstExecutionRunId) {
      relayed = true;
    }
  });

  if (info.continuedFromExecutionRunId === undefined) {
    await startChild<typeof ablyRelayWorkflow>('ablyRelayWorkflow', {
      workflowId: `${info.workflowId}:ably`,
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
      if (!(await condition(() => relayed, completeTimeoutMs))) {
        log.warn(
          'Ably: the relay did not confirm within completeTimeoutMs that it had relayed every event, so events may be lost when this workflow closes',
          { completeTimeoutMs },
        );
      }
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
