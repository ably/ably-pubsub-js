// Tests of the relay workflow, startAblyRelay() and relay.complete() on a local Temporal server. The source workflows
// in ./workflows/relay.ts publish to a real Workflow Stream. The worker runs the real relay activity, which reads that
// stream, with a recording adaptor and a fake channel pool in place of Ably.

import { randomUUID } from 'crypto';
import * as path from 'path';
import { WorkflowFailedError, type WorkflowStartOptions } from '@temporalio/client';
import { ApplicationFailure } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, DefaultLogger, Worker, type WorkflowBundleWithSourceMap } from '@temporalio/worker';
import type { RealtimeChannelPool, RealtimePublisherChannel } from '@ably/pubsub-server';
import { expect } from 'chai';
import { ABLY_ERROR_TYPE, getAblyErrorDetails } from '../../../src/platform/temporal/src/common/errors';
import type { AblyRelayCompletion, JsonValue, RelayRoute } from '../../../src/platform/temporal/src/common/relay';
import type { RelayAdaptorFactory } from '../../../src/platform/temporal/src/worker/relay/adaptor';
import { unsupportedRelayEvent } from '../../../src/platform/temporal/src/worker/relay/adaptor';
import { createRelayActivities } from '../../../src/platform/temporal/src/worker/relay/activity';
import type { AblyRelayWorkflowInput } from '../../../src/platform/temporal/src/workflow/relay/workflow';
import { EventType, eventsOfType, historyEvents, installTestRuntime } from '../temporal-test-helpers';
import { pollUntil } from '../../uts/realtime/integration/sandbox';
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

/** A recording adaptor that rejects the event `'unsupported'` with `unsupportedRelayEvent()`. */
const picky: RelayAdaptorFactory = (channel, handoff) => {
  const adaptor = recording(channel, handoff);
  return {
    ...adaptor,
    write: (event) => {
      if (event.data === 'unsupported') {
        throw unsupportedRelayEvent('this adaptor has no encoding for it');
      }
      adaptor.write(event);
    },
  };
};

/** An adaptor that fails non-retryably on every event, as one with a fatal bug would. */
const poison: RelayAdaptorFactory = () => ({
  write: () => {
    throw ApplicationFailure.nonRetryable('this adaptor always fails', 'PoisonedAdaptor');
  },
  flush: async () => ({ handoff: null }),
  close: async () => ({ handoff: null }),
});

/** An adaptor whose flush and close always fail retryably, so that its route retries forever and never reports. */
const stalled: RelayAdaptorFactory = () => ({
  write: () => {},
  flush: async () => {
    throw new Error('stalled');
  },
  close: async () => {
    throw new Error('stalled');
  },
});

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
      activities: createRelayActivities(pool, { recording, picky, poison, stalled }),
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

  function startSource(
    input: RelaySourceInput,
    workflowId = `source-${randomUUID()}`,
    options: Pick<WorkflowStartOptions, 'retry' | 'cronSchedule'> = {},
  ) {
    return env.client.workflow.start('relaySource', { taskQueue: TASK_QUEUE, workflowId, args: [input], ...options });
  }

  /** The relay that a source started, whose ID names the source's first run. */
  function relayOf(source: { workflowId: string; firstExecutionRunId: string }) {
    return env.client.workflow.getHandle(`${source.workflowId}:ably:${source.firstExecutionRunId}`);
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
    await relayOf(source).result();
    expect(record(channel).calls.at(-1)).to.equal('close');
  });

  it('keeps one relay, and its offset, across the source continuing as new', async function () {
    const channel = uniqueChannel('chat');
    const events: [string, unknown][] = ['a', 'b', 'c', 'd', 'e'].map((data) => ['agent', data]);

    const source = await startSource({ routes: [route(channel)], events, continueAsNewAfter: 2 });
    expect(await source.result()).to.equal('done');

    expect(record(channel).data).to.deep.equal(['a', 'b', 'c', 'd', 'e']);
    // A second relay would have started from offset 0, and relayed a and b again.
    await relayOf(source).result();
  });

  it('finishes as source-closed, without signalling, when the source fails without completing', async function () {
    const channel = uniqueChannel('chat');
    const source = await startSource({ routes: [route(channel)], events: [['agent', 'a']], fail: true });

    const err = await source.result().catch((e: unknown) => e);
    expect(err).to.be.instanceOf(WorkflowFailedError);

    await relayOf(source).result();
    expect(record(channel).data).to.deep.equal(['a']);
    expect(record(channel).calls.at(-1)).to.equal('close');
  });

  it('resolves complete() as timed-out after completeTimeoutMs when the relay does not report', async function () {
    const source = await startSource({
      // The route retries forever, so the relay never reports.
      routes: [{ topics: ['agent'], adaptor: 'stalled', channel: uniqueChannel('chat') }],
      events: [['agent', 'a']],
      completeTimeoutMs: 1000,
      returnCompletion: true,
    });
    try {
      const started = Date.now();
      expect(await source.result()).to.deep.equal({ status: 'timed-out', routes: [] });
      expect(Date.now() - started).to.be.at.least(1000);
    } finally {
      await relayOf(source)
        .terminate()
        .catch(() => {});
    }
  });

  it('stops only the route that fails, and reports it through complete(), without waiting for the timeout', async function () {
    const healthy = uniqueChannel('healthy');
    const broken = uniqueChannel('broken');
    const started = Date.now();
    const source = await startSource({
      routes: [{ topics: ['bad'], adaptor: 'poison', channel: broken }, route(healthy, ['agent'])],
      events: [
        ['agent', 'a'],
        ['bad', 'x'],
        ['agent', 'b'],
      ],
      completeTimeoutMs: 30_000,
      returnCompletion: true,
    });

    const completion = (await source.result()) as AblyRelayCompletion;

    expect(Date.now() - started).to.be.below(20_000);
    expect(completion.status).to.equal('failed');
    expect(completion.routes).to.deep.equal([
      {
        channel: broken,
        topics: ['bad'],
        status: 'failed',
        skipped: 0,
        error: { message: 'this adaptor always fails', type: 'PoisonedAdaptor' },
      },
      { channel: healthy, topics: ['agent'], status: 'completed', skipped: 0 },
    ]);
    // The other route relayed every event.
    expect(record(healthy).data).to.deep.equal(['a', 'b']);
    // The relay ends as failed, so it shows in Temporal and can be reset.
    const err = await relayOf(source)
      .result()
      .catch((e: unknown) => e);
    expect(err).to.be.instanceOf(WorkflowFailedError);
    expect(((err as WorkflowFailedError).cause as ApplicationFailure).type).to.equal('AblyRelayRouteFailed');
  });

  it('skips an event the adaptor rejects as unsupported, and counts it in complete()', async function () {
    const channel = uniqueChannel('chat');
    const source = await startSource({
      routes: [{ topics: ['agent'], adaptor: 'picky', channel }],
      events: [
        ['agent', 'a'],
        ['agent', 'unsupported'],
        ['agent', 'b'],
      ],
      returnCompletion: true,
    });

    expect(await source.result()).to.deep.equal({
      status: 'succeeded',
      routes: [{ channel, topics: ['agent'], status: 'completed', skipped: 1 }],
    });
    expect(record(channel).data).to.deep.equal(['a', 'b']);
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

    // The retry option set only initialInterval, so the default maximumInterval still applies.
    const scheduled = eventsOfType(await historyEvents(relayOf(source)), EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED);
    const retryPolicy = scheduled[0].activityTaskScheduledEventAttributes?.retryPolicy;
    expect(Number(retryPolicy?.initialInterval?.nanos)).to.equal(100_000_000);
    expect(Number(retryPolicy?.maximumInterval?.seconds)).to.equal(60);
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

  it('keeps a relay to its own source when a later workflow reuses the workflow ID', async function () {
    const workflowId = `source-${randomUUID()}`;
    const first = uniqueChannel('first');
    const second = uniqueChannel('second');
    // The first relay's activity fails its first flush and waits 3 s to retry, so it is still running when the first
    // source has failed and a second source has started with the same workflow ID.
    failNextFlush.add(first);
    const firstSource = await startSource(
      {
        routes: [route(first)],
        events: [['agent', 'a']],
        checkpointBudget: 1,
        fail: true,
        activityOptions: { retry: { initialInterval: '3 seconds' } },
      },
      workflowId,
    );
    await firstSource.result().catch(() => {});

    const secondSource = await startSource(
      {
        routes: [route(second)],
        events: [
          ['agent', 'x'],
          ['agent', 'y'],
        ],
      },
      workflowId,
    );
    expect(await secondSource.result()).to.equal('done');
    await relayOf(firstSource).result();

    // The second source started its own relay, and each relay read only its own source.
    expect(record(second).data).to.deep.equal(['x', 'y']);
    expect(record(first).data).to.deep.equal(['a']);
  });

  it("follows a retry of the source, relaying the failed attempt's events and then the retry's", async function () {
    const channel = uniqueChannel('chat');
    const started = Date.now();
    const source = await startSource(
      {
        routes: [route(channel)],
        events: [
          ['agent', 'a'],
          ['agent', 'b'],
        ],
        failFirstAttempt: true,
        // A closed run's stream can't be read, so each attempt waits long enough for the relay to read it first.
        holdMs: 3000,
        completeTimeoutMs: 30_000,
      },
      undefined,
      { retry: { maximumAttempts: 2, initialInterval: '100 milliseconds' } },
    );

    expect(await source.result()).to.equal('done');
    // The relay signalled the retry, so complete() returned well before its timeout. That signal only matches if the
    // retry keeps the chain's first run ID.
    expect(Date.now() - started).to.be.below(25_000);
    await relayOf(source).result();
    expect(record(channel).data).to.deep.equal(['a', 'b', 'a', 'b']);
    // The failed attempt's adaptor was closed when the relay moved to the retry, and the retry's when it completed.
    expect(record(channel).calls.filter((call) => call === 'close')).to.have.length(2);
  });

  it('fails a source that has a cron schedule, pointing to Temporal Schedules', async function () {
    const source = await startSource({ routes: [route(uniqueChannel('chat'))], events: [] }, undefined, {
      cronSchedule: '@every 1s',
    });
    try {
      // A failed cron run is followed by the next scheduled run, so the client reports it as continued. Its history
      // records the failure.
      const firstRun = env.client.workflow.getHandle(source.workflowId, source.firstExecutionRunId);
      const failed = await pollUntil(async () => {
        const events = eventsOfType(await historyEvents(firstRun), EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED);
        return events[0] ?? null;
      });
      const failure = failed.workflowExecutionFailedEventAttributes?.failure;

      expect(failure?.applicationFailureInfo?.type).to.equal(ABLY_ERROR_TYPE);
      expect(failure?.message).to.contain('cron schedule');
    } finally {
      await source.terminate().catch(() => {});
    }
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
    // with the state that a Continue-As-New would pass on. The source's own relay never reports, since its route
    // retries forever, so the source waits in complete() until the relay started here reports.
    const finished = uniqueChannel('finished');
    const running = uniqueChannel('running');
    const source = await startSource({
      routes: [{ topics: ['agent'], adaptor: 'stalled', channel: uniqueChannel('chat') }],
      events: [
        ['agent', 'a'],
        ['agent', 'b'],
        ['agent', 'c'],
      ],
      completeTimeoutMs: 60_000,
    });

    const input: AblyRelayWorkflowInput = {
      sourceWorkflowId: source.workflowId,
      sourceRunId: source.firstExecutionRunId,
      routes: [route(finished), route(running)],
      state: [
        { status: 'completed', offset: 3, handoff: { count: 9 }, runId: source.firstExecutionRunId },
        { status: 'running', offset: 1, handoff: { count: 1 }, runId: source.firstExecutionRunId },
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
    await relayOf(source)
      .terminate()
      .catch(() => {});
  });
});
