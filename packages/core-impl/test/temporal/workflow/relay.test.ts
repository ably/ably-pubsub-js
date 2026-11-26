// Tests of the relay workflow, startAblyRelay() and relay.complete() on a local Temporal server. The source workflows
// in ./workflows/relay.ts publish to a real Workflow Stream. The worker runs the real relay activity, which reads that
// stream, with a recording adaptor and a fake channel pool in place of Ably.

import { randomUUID } from 'crypto';
import * as path from 'path';
import { WorkflowFailedError } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, DefaultLogger, Worker, type WorkflowBundleWithSourceMap } from '@temporalio/worker';
import type { RealtimeChannelPool, RealtimePublisherChannel } from '@ably/pubsub-server';
import { expect } from 'chai';
import { ABLY_ERROR_TYPE, getAblyErrorDetails } from '../../../src/platform/temporal/src/common/errors';
import type { JsonValue, RelayRoute } from '../../../src/platform/temporal/src/common/relay';
import type { RelayAdaptorFactory } from '../../../src/platform/temporal/src/worker/relay/adaptor';
import { createRelayActivities } from '../../../src/platform/temporal/src/worker/relay/activity';
import type { AblyRelayWorkflowInput } from '../../../src/platform/temporal/src/workflow/relay/workflow';
import { installTestRuntime } from '../temporal-test-helpers';
import type { RelaySourceInput } from './workflows/relay';

const TASK_QUEUE = 'ably-temporal-relay';

/** What the recording adaptors saw on one channel. */
interface ChannelRecord {
  /** The data of every event written, in order, across every adaptor on the channel. */
  data: unknown[];
  /** The handoff each adaptor on the channel was created with, in order. */
  handoffs: (JsonValue | null)[];
  /** The `flush` and `close` calls, in order. */
  calls: string[];
}

const channels = new Map<string, ChannelRecord>();
/** Channels whose next `flush()` fails, once, so that the activity is retried. */
const failNextFlush = new Set<string>();

function record(channel: string): ChannelRecord {
  let entry = channels.get(channel);
  if (!entry) {
    entry = { data: [], handoffs: [], calls: [] };
    channels.set(channel, entry);
  }
  return entry;
}

/** An adaptor whose handoff counts the events written to its channel since the route started. */
const recording: RelayAdaptorFactory = (channel, handoff) => {
  const entry = record(channel.name);
  entry.handoffs.push(handoff);
  let count = (handoff as { count?: number } | null)?.count ?? 0;
  return {
    write: (event) => {
      entry.data.push(event.data);
      count++;
    },
    flush: async () => {
      entry.calls.push('flush');
      if (failNextFlush.delete(channel.name)) {
        throw new Error('flush failed');
      }
      return { handoff: { count } };
    },
    close: async () => {
      entry.calls.push('close');
      return { handoff: { count } };
    },
  };
};

const pool = {
  get: (name: string) => ({ name, release: () => {} }) as unknown as RealtimePublisherChannel,
} as unknown as RealtimeChannelPool;

function uniqueChannel(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

describe('temporal relay workflow', function () {
  this.timeout(180_000);

  let env: TestWorkflowEnvironment;
  let workflowBundle: WorkflowBundleWithSourceMap;
  let worker: Worker;
  let workerRun: Promise<void>;

  before(async function () {
    installTestRuntime();
    env = await TestWorkflowEnvironment.createLocal();
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.join(__dirname, 'workflows', 'relay.ts'),
      logger: new DefaultLogger('WARN'),
    });
    worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace ?? 'default',
      taskQueue: TASK_QUEUE,
      workflowBundle,
      activities: createRelayActivities(pool, { recording }),
    });
    workerRun = worker.run();
  });

  after(async function () {
    worker?.shutdown();
    await workerRun;
    await env?.teardown();
  });

  afterEach(function () {
    channels.clear();
    failNextFlush.clear();
  });

  function startSource(input: RelaySourceInput) {
    return env.client.workflow.start('relaySource', {
      taskQueue: TASK_QUEUE,
      workflowId: `source-${randomUUID()}`,
      args: [input],
    });
  }

  function relayOf(sourceWorkflowId: string) {
    return env.client.workflow.getHandle(`${sourceWorkflowId}:ably`);
  }

  function route(channel: string, topics = ['agent']): RelayRoute {
    return { topics, adaptor: 'recording', channel };
  }

  it('relays every event before the source returns, then finishes', async function () {
    const channel = uniqueChannel('chat');
    const events: [string, unknown][] = [
      ['agent', 'a'],
      ['status', 'ignored'],
      ['agent', { text: 'b' }],
      ['agent', 'c'],
    ];

    const source = await startSource({ routes: [route(channel)], events });
    expect(await source.result()).to.equal('done');

    expect(record(channel).data).to.deep.equal(['a', { text: 'b' }, 'c']);
    await relayOf(source.workflowId).result();
    expect(record(channel).calls.at(-1)).to.equal('close');
  });

  it('keeps one relay, and its offset, across the source continuing as new', async function () {
    const channel = uniqueChannel('chat');
    const events: [string, unknown][] = ['a', 'b', 'c', 'd', 'e'].map((data) => ['agent', data]);

    const source = await startSource({ routes: [route(channel)], events, continueAsNewAfter: 2 });
    expect(await source.result()).to.equal('done');

    expect(record(channel).data).to.deep.equal(['a', 'b', 'c', 'd', 'e']);
    // A second relay would have started from offset 0, and relayed a and b again.
    await relayOf(source.workflowId).result();
  });

  it('finishes as source-closed, without signalling, when the source fails without completing', async function () {
    const channel = uniqueChannel('chat');
    const source = await startSource({ routes: [route(channel)], events: [['agent', 'a']], fail: true });

    const err = await source.result().catch((e: unknown) => e);
    expect(err).to.be.instanceOf(WorkflowFailedError);

    await relayOf(source.workflowId).result();
    expect(record(channel).data).to.deep.equal(['a']);
    expect(record(channel).calls.at(-1)).to.equal('close');
  });

  it('returns from complete() after completeTimeoutMs when the relay does not confirm', async function () {
    const source = await startSource({
      // The relay fails at once, since no adaptor is registered under this name, so it never confirms.
      routes: [{ topics: ['agent'], adaptor: 'unregistered', channel: uniqueChannel('chat') }],
      events: [['agent', 'a']],
      completeTimeoutMs: 1000,
    });

    const started = Date.now();
    expect(await source.result()).to.equal('done');
    expect(Date.now() - started).to.be.at.least(1000);
    const err = await relayOf(source.workflowId)
      .result()
      .catch((e: unknown) => e);
    expect(err).to.be.instanceOf(WorkflowFailedError);
  });

  it('resumes a failed activity from its checkpoint, with the stored handoff', async function () {
    const channel = uniqueChannel('chat');
    failNextFlush.add(channel);
    const events: [string, unknown][] = ['a', 'b', 'c', 'd', 'e'].map((data) => ['agent', data]);

    const source = await startSource({
      routes: [route(channel)],
      events,
      checkpointBudget: 2,
      activityOptions: { retry: { initialInterval: '100 milliseconds' } },
    });
    expect(await source.result()).to.equal('done');

    // The first activity relayed a and b, then failed to flush, so its retry relayed them again from the start.
    const { data, handoffs } = record(channel);
    expect(data).to.deep.equal(['a', 'b', 'a', 'b', 'c', 'd', 'e']);
    expect(handoffs).to.deep.equal([null, null, { count: 2 }, { count: 4 }]);
  });

  it('fails the source with an AblyError when a route is invalid', async function () {
    const source = await startSource({ routes: [{ topics: [], adaptor: 'recording', channel: 'chat' }], events: [] });

    const err = await source.result().catch((e: unknown) => e);

    expect(err).to.be.instanceOf(WorkflowFailedError);
    const cause = (err as WorkflowFailedError).cause as ApplicationFailure;
    expect(cause).to.be.instanceOf(ApplicationFailure);
    expect(cause.type).to.equal(ABLY_ERROR_TYPE);
    expect(cause.message).to.contain('route 0');
    expect(getAblyErrorDetails(cause)?.code).to.equal(40003);
  });

  it('wakes the reads it leaves held in the source when an activity returns at its deadline', async function () {
    const channel = uniqueChannel('chat');
    const source = await startSource({
      routes: [route(channel)],
      events: [['agent', 'a']],
      holdMs: 7000,
      // The activity returns 2.4 s into each attempt while the source holds.
      activityOptions: { startToCloseTimeout: '3 seconds' },
    });
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // The stream holds the event and at least one wake, from the activity that returned at its deadline.
    expect(await source.query<number>('__temporal_workflow_stream_offset')).to.be.at.least(2);
    expect(await source.result()).to.equal('done');
    // Relays ignore wake events.
    expect(record(channel).data).to.deep.equal(['a']);
  });

  it('relays two routes independently, each to its own channel', async function () {
    const channelA = uniqueChannel('a');
    const channelB = uniqueChannel('b');
    const events: [string, unknown][] = [
      ['agent-a', 'a1'],
      ['agent-b', 'b1'],
      ['agent-a', 'a2'],
      ['agent-b', 'b2'],
      ['agent-b', 'b3'],
    ];

    const source = await startSource({
      routes: [route(channelA, ['agent-a']), route(channelB, ['agent-b'])],
      events,
      checkpointBudget: 2,
    });
    expect(await source.result()).to.equal('done');

    expect(record(channelA).data).to.deep.equal(['a1', 'a2']);
    expect(record(channelB).data).to.deep.equal(['b1', 'b2', 'b3']);
  });

  it('carries route state across its own Continue-As-New, without restarting a finished route', async function () {
    // The relay continues as new only when Temporal suggests it, which a test cannot arrange, so this starts it
    // with the state that a Continue-As-New would pass on. The source's own relay fails at once, since its adaptor is
    // not registered, so the source waits in complete() until the relay started here confirms.
    const finished = uniqueChannel('finished');
    const running = uniqueChannel('running');
    const source = await startSource({
      routes: [{ topics: ['agent'], adaptor: 'unregistered', channel: uniqueChannel('chat') }],
      events: [
        ['agent', 'a'],
        ['agent', 'b'],
        ['agent', 'c'],
      ],
      completeTimeoutMs: 60_000,
    });
    await relayOf(source.workflowId)
      .result()
      .catch(() => {});

    const input: AblyRelayWorkflowInput = {
      sourceWorkflowId: source.workflowId,
      sourceRunId: source.firstExecutionRunId,
      routes: [route(finished), route(running)],
      state: [
        { status: 'completed', offset: 3, handoff: { count: 9 } },
        { status: 'running', offset: 1, handoff: { count: 1 } },
      ],
    };
    await env.client.workflow.execute('ablyRelayWorkflow', {
      taskQueue: TASK_QUEUE,
      workflowId: `relay-${randomUUID()}`,
      args: [input],
    });

    expect(channels.has(finished)).to.equal(false);
    expect(record(running).handoffs).to.deep.equal([{ count: 1 }]);
    expect(record(running).data).to.deep.equal(['b', 'c']);
    // Both routes have completed, so the relay signalled the source, whose complete() returned.
    expect(await source.result()).to.equal('done');
  });
});
