// Source workflows for the relay sandbox test in ./relay-sandbox.test.ts. They import the built
// `@ably/pubsub-server/temporal/workflow` entry point, as an application would.

import { sleep } from '@temporalio/workflow';
import { WorkflowStream, type WorkflowStreamState } from '@temporalio/workflow-streams/workflow';
import { startAblyRelay, type AblyRelayOptions } from '@ably/pubsub-server/temporal/workflow';

export { ablyRelayWorkflow } from '@ably/pubsub-server/temporal/workflow';

export interface AgentInput {
  relay: AblyRelayOptions;
  /** The events to publish, as `[topic, data]`, in order. */
  events: [string, unknown][];
  /** Continue as new once this many events have been published. */
  continueAsNewAfter?: number;
  streamState?: WorkflowStreamState;
}

/** Publishes `input.events` to its Workflow Stream, continuing as new part way if asked, then completes the relay. */
export async function agentWorkflow(input: AgentInput): Promise<void> {
  const stream = new WorkflowStream(input.streamState);
  const relay = await startAblyRelay(stream, input.relay);

  const events = [...input.events];
  let published = 0;
  while (events.length > 0) {
    const [topic, data] = events.shift()!;
    stream.topic(topic).publish(data);
    published++;
    await sleep(20);
    if (published === input.continueAsNewAfter) {
      await stream.continueAsNew<typeof agentWorkflow>((streamState) => [
        { ...input, events, continueAsNewAfter: undefined, streamState },
      ]);
    }
  }
  await relay.complete();
}
