// The source workflow whose recorded histories ../relay-replay.test.ts replays (see ../histories/relay/). Those
// histories hold the commands this workflow made when they were recorded, so changing what it does breaks them. Leave
// it as it is, and add another workflow for a new case.

import { sleep } from '@temporalio/workflow';
import { WorkflowStream, type WorkflowStreamState } from '@temporalio/workflow-streams/workflow';
import type { AblyRelayCompletion, RelayRoute } from '../../../../src/platform/temporal/src/common/relay.js';
import { startAblyRelay } from '../../../../src/platform/temporal/src/workflow/relay/start.js';

export { ablyRelayWorkflow } from '../../../../src/platform/temporal/src/workflow/relay/workflow.js';

export interface RelayReplaySourceInput {
  routes: RelayRoute[];
  /** The events to publish, as `[topic, data]`, in order. */
  events: [string, unknown][];
  /** Continue as new once this many events have been published, with the rest still to publish. */
  continueAsNewAfter?: number;
  completeTimeoutMs?: number;
  streamState?: WorkflowStreamState;
}

/** Publishes `input.events`, continuing as new part way if the input says to, then completes the relay. */
export async function relayReplaySource(input: RelayReplaySourceInput): Promise<AblyRelayCompletion> {
  const stream = new WorkflowStream(input.streamState);
  const relay = await startAblyRelay(stream, { routes: input.routes, completeTimeoutMs: input.completeTimeoutMs });

  const events = [...input.events];
  let published = 0;
  while (events.length > 0) {
    const [topic, data] = events.shift()!;
    stream.topic(topic).publish(data);
    published++;
    await sleep(10);
    if (published === input.continueAsNewAfter) {
      await stream.continueAsNew<typeof relayReplaySource>((streamState) => [
        { ...input, events, continueAsNewAfter: undefined, streamState },
      ]);
    }
  }
  return relay.complete();
}
