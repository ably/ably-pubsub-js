// Source workflows for the relay tests (see ../relay.test.ts). Each owns a Workflow Stream, starts a relay from it, and
// publishes the events it is given.

import { ApplicationFailure, sleep, workflowInfo } from '@temporalio/workflow';
import { WorkflowStream, type WorkflowStreamState } from '@temporalio/workflow-streams/workflow';
import type { RelayRoute } from '../../../../src/platform/temporal/src/common/relay.js';
import type { AblyRelayCompletion } from '../../../../src/platform/temporal/src/common/relay.js';
import { startAblyRelay, type AblyRelayOptions } from '../../../../src/platform/temporal/src/workflow/relay/start.js';

export { ablyRelayWorkflow } from '../../../../src/platform/temporal/src/workflow/relay/workflow.js';

export interface RelaySourceInput {
  routes: RelayRoute[];
  /** The events to publish, as `[topic, data]`, in order. */
  events: [string, unknown][];
  /** Continue as new once this many events have been published, with the rest still to publish. */
  continueAsNewAfter?: number;
  /** Fail instead of completing the relay, once every event has been published. */
  fail?: boolean;
  /** As `fail`, but only on the workflow's first attempt, so that its retry completes. */
  failFirstAttempt?: boolean;
  /** Return what `relay.complete()` resolved with, rather than `'done'`. */
  returnCompletion?: boolean;
  /** How long to wait, in milliseconds, after publishing every event and before completing the relay. */
  holdMs?: number;
  completeTimeoutMs?: number;
  activityOptions?: AblyRelayOptions['activityOptions'];
  checkpointBudget?: number;
  streamState?: WorkflowStreamState;
}

/** Publishes `input.events` and completes the relay, continuing as new or failing part way if the input says to. */
export async function relaySource(input: RelaySourceInput): Promise<string | AblyRelayCompletion> {
  const stream = new WorkflowStream(input.streamState);
  const relay = await startAblyRelay(stream, {
    routes: input.routes,
    completeTimeoutMs: input.completeTimeoutMs,
    activityOptions: input.activityOptions,
    checkpointBudget: input.checkpointBudget,
  });

  const events = [...input.events];
  let published = 0;
  while (events.length > 0) {
    const [topic, data] = events.shift()!;
    stream.topic(topic).publish(data);
    published++;
    // Space the events out, so that the relay reads them across several polls.
    await sleep(10);
    if (published === input.continueAsNewAfter) {
      await stream.continueAsNew<typeof relaySource>((streamState) => [
        { ...input, events, continueAsNewAfter: undefined, streamState },
      ]);
    }
  }

  if (input.holdMs) {
    await sleep(input.holdMs);
  }
  if (input.fail) {
    throw ApplicationFailure.nonRetryable('the source failed');
  }
  if (input.failFirstAttempt && workflowInfo().attempt === 1) {
    throw ApplicationFailure.retryable('the first attempt failed');
  }
  const completion = await relay.complete();
  return input.returnCompletion ? completion : 'done';
}
