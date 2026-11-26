// Integration test of the built Workflow Streams relay against an Ably sandbox app and a local Temporal server. A
// source workflow in ./relay-workflows.ts publishes to its Workflow Stream, and a worker with the built
// `AblyRelayPlugin` relays it through a realtime channel pool with `publishPerEvent()`. A subscriber on the channel,
// and the channel's history, show what reached Ably.
//
// Run `npm run build:packages` first. Needs network access to the Ably sandbox.

import { randomUUID } from 'crypto';
import * as path from 'path';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, DefaultLogger, Worker } from '@temporalio/worker';
import * as Ably from '@ably/pubsub-server';
import { AblyRelayPlugin, publishPerEvent, type RelayAdaptorFactory } from '@ably/pubsub-server/temporal';
import { expect } from 'chai';
import {
  getSandboxApp,
  pollUntil,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
} from '../../uts/realtime/integration/sandbox';
import { causeChain, installTestRuntime } from '../temporal-test-helpers';
import type { AgentInput } from './relay-workflows';

const TASK_QUEUE = 'ably-temporal-relay-sandbox';

/** Channels whose next flush fails, once, so that the relay activity is retried from its last checkpoint. */
const failNextFlush = new Set<string>();

/** `publishPerEvent()`, except that a flush fails once on a channel in {@link failNextFlush}. */
const flaky: RelayAdaptorFactory = (channel, handoff) => {
  const adaptor = publishPerEvent()(channel, handoff);
  return {
    write: (event) => adaptor.write(event),
    flush: async () => {
      const result = await adaptor.flush();
      if (failNextFlush.delete(channel.name)) {
        throw new Error('injected flush failure');
      }
      return result;
    },
    close: () => adaptor.close(),
  };
};

describe('temporal relay sandbox integration', function () {
  this.timeout(180_000);

  let env: TestWorkflowEnvironment;
  let pool: Ably.RealtimeChannelPool;
  let subscriber: Ably.PubSubRealtimeClient;
  let rest: Ably.PubSubHttpClient;
  let worker: Worker;
  let workerRun: Promise<void>;

  before(async function () {
    try {
      await setupSandbox();
    } catch (err) {
      throw new Error(
        `Could not provision an Ably sandbox app at ${SANDBOX_ENDPOINT}. These tests need network access to the Ably sandbox. Cause: ${causeChain(err)}`,
      );
    }
    const key = getSandboxApp().keys[0].keyStr;
    pool = Ably.createRealtimeChannelPool({ key, endpoint: SANDBOX_ENDPOINT }, { size: 2 });
    await pool.open();
    subscriber = Ably.createRealtimeClient({ key, endpoint: SANDBOX_ENDPOINT });
    rest = Ably.createHttpClient({ key, endpoint: SANDBOX_ENDPOINT });

    installTestRuntime();
    env = await TestWorkflowEnvironment.createLocal();
    worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace ?? 'default',
      taskQueue: TASK_QUEUE,
      workflowBundle: await bundleWorkflowCode({
        workflowsPath: path.join(__dirname, 'relay-workflows.ts'),
        logger: new DefaultLogger('WARN'),
      }),
      plugins: [new AblyRelayPlugin({ pool, adaptors: { events: publishPerEvent(), flaky } })],
    });
    workerRun = worker.run();
  });

  after(async function () {
    try {
      worker?.shutdown();
      await workerRun;
      await env?.teardown();
      subscriber?.close();
      await pool?.close();
    } finally {
      await teardownSandbox();
    }
  });

  function runAgent(input: AgentInput): Promise<void> {
    return env.client.workflow.execute('agentWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId: `agent-${randomUUID()}`,
      args: [input],
      workflowExecutionTimeout: '90 seconds',
    });
  }

  it('relays every event on the routed topics to the channel, in order, across Continue-As-New', async function () {
    const channel = `relay:${randomUUID()}`;
    const received: { name?: string; data: unknown }[] = [];
    await subscriber.channels.get(channel).subscribe((message) => {
      received.push({ name: message.name, data: message.data });
    });
    const events: [string, unknown][] = [
      ['agent', { text: 'hello' }],
      ['status', 'thinking'],
      ['ignored', 'not routed'],
      ['agent', { text: 'world' }],
      ['status', 'done'],
    ];

    await runAgent({
      relay: { routes: [{ topics: ['agent', 'status'], adaptor: 'events', channel }], checkpointBudget: 2 },
      events,
      continueAsNewAfter: 2,
    });

    const expected = events.filter(([topic]) => topic !== 'ignored').map(([name, data]) => ({ name, data }));
    // complete() returned, so every event is on the channel. The subscriber may still be receiving the last.
    await pollUntil(async () => (received.length >= expected.length ? true : null), { interval: 100, timeout: 10_000 });
    expect(received).to.deep.equal(expected);
  });

  it('delivers every event at least once, in order from the last checkpoint, when an activity fails', async function () {
    const channel = `relay:${randomUUID()}`;
    failNextFlush.add(channel);
    const events: [string, unknown][] = ['a', 'b', 'c', 'd', 'e'].map((data) => ['agent', data]);

    await runAgent({
      relay: {
        routes: [{ topics: ['agent'], adaptor: 'flaky', channel }],
        checkpointBudget: 2,
        activityOptions: { retry: { initialInterval: '200 milliseconds' } },
      },
      events,
    });

    // History can lag publishing briefly, so wait until it holds every message.
    const items = await pollUntil(
      async () => {
        const page = await rest.channels.get(channel).history({ direction: 'forwards' });
        return page.items.length >= 7 ? page.items : null;
      },
      { interval: 500, timeout: 15_000 },
    );
    // The first activity published a and b, then failed to flush, so its retry published them again from the start.
    expect(items.map((message) => message.data)).to.deep.equal(['a', 'b', 'a', 'b', 'c', 'd', 'e']);
  });
});
