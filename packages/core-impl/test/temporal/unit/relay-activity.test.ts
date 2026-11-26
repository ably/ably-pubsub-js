import { expect } from 'chai';
import type { RealtimeChannelPool, RealtimePublisherChannel } from '@ably/pubsub-server';
import type { Info } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure, WorkflowNotFoundError } from '@temporalio/common';
import type { MockActivityEnvironment } from '@temporalio/testing';
import type { WorkflowStreamItem } from '@temporalio/workflow-streams/client';
import { ABLY_ERROR_TYPE } from '../../../src/platform/temporal/src/common/errors';
import {
  END_OF_STREAM,
  RELAY_ACTIVITY_NAME,
  RELAY_TOPIC,
  RELAY_UNSUPPORTED_EVENT_TYPE,
  WAKE,
} from '../../../src/platform/temporal/src/common/relay';
import type {
  JsonValue,
  RelayActivityInput,
  RelayActivityResult,
  RelayCheckpointOptions,
  RelayRoute,
} from '../../../src/platform/temporal/src/common/relay';
import { unsupportedRelayEvent } from '../../../src/platform/temporal/src/worker/relay/adaptor';
import type {
  RelayAdaptor,
  RelayAdaptorFactory,
  RelayEvent,
} from '../../../src/platform/temporal/src/worker/relay/adaptor';
import { createRelayActivities } from '../../../src/platform/temporal/src/worker/relay/activity';
import type { RelayEvents, RelaySource } from '../../../src/platform/temporal/src/worker/relay/activity';
import { Ably } from '../../uts/helpers';
import { activityEnvironment, capturingActivityEnvironment, rejection } from './worker-helpers';

/** One run of the fake source workflow. */
interface FakeRun {
  id: string;
  /** The run's stream. A run that continued as new shares it with the next run; a retry starts a new one. */
  log: WorkflowStreamItem<unknown>[];
  /** The length of the log when the run closed, or `undefined` while it runs. */
  endsAt?: number;
  /** The run it led to, if any. */
  next?: { runId: string; freshStream: boolean };
}

/**
 * A source workflow's Workflow Stream across its runs: an append-only log of events that subscriptions to one run read
 * from an offset, filtered by topic. A subscription waits for new events as the real one does, and ends once its run
 * has closed and it has read everything the run published. The stream's state carries over Continue-As-New, so offsets
 * run on from one run to the next.
 */
class FakeStream {
  private readonly runs: FakeRun[] = [{ id: 'run-1', log: [] }];
  private wake: (() => void)[] = [];
  /** The run, topics and offset of each subscription opened, in order. */
  readonly subscriptions: { runId: string; topics: string[]; fromOffset: number }[] = [];
  /** How many subscriptions have ended, whether by reaching the end of their run or by `return()`. */
  ended = 0;
  /** How many times an activity has woken the stream's held reads. */
  wakes = 0;
  /**
   * Whether a subscription reports its run's close by rejecting with a `WorkflowNotFoundError`, as the real one can,
   * rather than by ending.
   */
  closeAsNotFound = false;

  /** The run that publishes now. */
  get currentRun(): string {
    return this.runs[this.runs.length - 1].id;
  }

  publish(topic: string, data: unknown): void {
    const { log } = this.runs[this.runs.length - 1];
    log.push({ topic, data, offset: log.length });
    this.notify();
  }

  endOfStream(): void {
    this.publish(RELAY_TOPIC, { type: END_OF_STREAM });
  }

  /** Closes the current run as Continue-As-New, and starts the next, which carries the stream on. */
  continueAsNew(): void {
    this.closeInto(false);
  }

  /** Fails the current run, and starts its retry, whose stream starts empty. */
  retry(): void {
    this.closeInto(true);
  }

  /** Closes the current run, and with it the source. */
  close(): void {
    const run = this.runs[this.runs.length - 1];
    run.endsAt = run.log.length;
    this.notify();
  }

  private closeInto(freshStream: boolean): void {
    const run = this.runs[this.runs.length - 1];
    const runId = `run-${this.runs.length + 1}`;
    run.endsAt = run.log.length;
    run.next = { runId, freshStream };
    this.runs.push({ id: runId, log: freshStream ? [] : run.log });
    this.notify();
  }

  /** The source, as the activity opens it. */
  source(workflowId: string): RelaySource {
    expect(workflowId).to.equal('source-1');
    return {
      subscribe: async (runId, topics, fromOffset) => ({
        events: this.subscribe(this.run(runId), topics, fromOffset),
        wake: async () => {
          this.wakes++;
          this.publish(RELAY_TOPIC, { type: WAKE });
        },
      }),
      nextRun: async (runId) => this.run(runId).next,
    };
  }

  /**
   * An async generator, as the real subscription is, so that `return()` waits for a read in progress to settle.
   */
  private async *subscribe(run: FakeRun, topics: string[], fromOffset: number): RelayEvents {
    this.subscriptions.push({ runId: run.id, topics, fromOffset });
    let offset = fromOffset;
    try {
      for (;;) {
        const end = run.endsAt ?? run.log.length;
        const item = run.log.slice(offset, end).find((candidate) => topics.includes(candidate.topic));
        if (item) {
          offset = item.offset + 1;
          yield item;
          continue;
        }
        offset = end;
        if (run.endsAt !== undefined) {
          if (this.closeAsNotFound) {
            throw new WorkflowNotFoundError('run closed', 'source-1', run.id);
          }
          return;
        }
        await new Promise<void>((resolve) => this.wake.push(resolve));
      }
    } finally {
      this.ended++;
    }
  }

  private run(runId: string): FakeRun {
    const run = this.runs.find((candidate) => candidate.id === runId);
    expect(run, `no run ${runId}`).to.not.equal(undefined);
    return run!;
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = [];
    wake.forEach((resolve) => resolve());
  }
}

/**
 * An adaptor factory that records what each adaptor it creates is given. Its handoff counts the events written since
 * the route started, so a test can see that the handoff is carried from one activity to the next.
 */
class RecordingAdaptors {
  /** The events written to every adaptor, in order. */
  readonly written: RelayEvent[] = [];
  /** The handoff each adaptor was created with, in order. */
  readonly handoffs: (JsonValue | null)[] = [];
  /** The channel each adaptor was created with, in order. */
  readonly channels: string[] = [];
  /** The data of the events written, keyed by the channel of the adaptor they were written to. */
  readonly dataByChannel: Record<string, unknown[]> = {};
  readonly calls: string[] = [];
  /** An error for the next `flush()` or `close()` to reject with. */
  failWith: unknown;
  /** Called by `abort()`, before it records the call. */
  onAbort?: () => void;
  /** Event data that `write()` rejects with `unsupportedRelayEvent()`. */
  unsupported = new Set<unknown>();
  /** Event data for which `write()` throws a plain error. */
  broken = new Set<unknown>();
  /** Event data for which `write()` throws the given value. */
  throws = new Map<unknown, unknown>();

  readonly factory: RelayAdaptorFactory = (channel, handoff) => {
    this.channels.push(channel.name);
    this.handoffs.push(handoff);
    let count = (handoff as { count?: number } | null)?.count ?? 0;
    const settle = async (call: string) => {
      this.calls.push(call);
      if (this.failWith !== undefined) {
        throw this.failWith;
      }
      return { handoff: { count } };
    };
    const adaptor: RelayAdaptor = {
      write: (event) => {
        if (this.unsupported.has(event.data)) {
          throw unsupportedRelayEvent(`can't write ${String(event.data)}`);
        }
        if (this.broken.has(event.data)) {
          throw new Error(`broke on ${String(event.data)}`);
        }
        if (this.throws.has(event.data)) {
          throw this.throws.get(event.data);
        }
        this.written.push(event);
        (this.dataByChannel[channel.name] ??= []).push(event.data);
        count++;
      },
      flush: () => settle('flush'),
      close: () => settle('close'),
      abort: () => {
        this.onAbort?.();
        this.calls.push('abort');
      },
    };
    return adaptor;
  };
}

/** A channel pool that records which channels are taken and released. */
class FakePool {
  readonly taken: string[] = [];
  readonly released: string[] = [];

  readonly pool = {
    get: (name: string) => {
      this.taken.push(name);
      return { name, release: () => this.released.push(name) } as unknown as RealtimePublisherChannel;
    },
  } as unknown as RealtimeChannelPool;
}

/** The `Info` of the relay activity. Its start-to-close timeout is long enough not to affect a test. */
const relayInfo: Partial<Info> = {
  activityType: RELAY_ACTIVITY_NAME,
  startToCloseTimeoutMs: 60_000,
  scheduleToCloseTimeoutMs: 0,
};

const route: RelayRoute = { topics: ['agent'], adaptor: 'recording', channel: 'chat' };

interface Harness {
  stream: FakeStream;
  adaptors: RecordingAdaptors;
  pool: FakePool;
  relay(
    checkpoint?: { offset: number; handoff: JsonValue | null; runId: string },
    options?: RelayCheckpointOptions,
    routeOverride?: RelayRoute,
    env?: MockActivityEnvironment,
  ): Promise<RelayActivityResult>;
}

function harness(): Harness {
  const stream = new FakeStream();
  const adaptors = new RecordingAdaptors();
  const pool = new FakePool();
  const activities = createRelayActivities(pool.pool, { recording: adaptors.factory }, (_, workflowId) =>
    stream.source(workflowId),
  );
  return {
    stream,
    adaptors,
    pool,
    relay: (
      checkpoint = { offset: 0, handoff: null, runId: 'run-1' },
      options,
      routeOverride = route,
      env = activityEnvironment(relayInfo),
    ) => {
      const input: RelayActivityInput = { sourceWorkflowId: 'source-1', route: routeOverride, checkpoint, options };
      return env.run(activities[RELAY_ACTIVITY_NAME], input);
    },
  };
}

/** Lets pending callbacks and timers that are already due run. */
function tick(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('temporal/worker/relay/activity', function () {
  it('relays route events until the end-of-stream event, then closes the adaptor and completes', async function () {
    const { stream, adaptors, pool, relay } = harness();
    stream.publish('agent', 'a');
    stream.publish('agent', 'b');
    stream.endOfStream();

    const result = await relay();

    expect(result).to.deep.equal({ status: 'completed', runId: 'run-1', offset: 3, handoff: { count: 2 }, skipped: 0 });
    expect(adaptors.written).to.deep.equal([
      { topic: 'agent', offset: 0, data: 'a' },
      { topic: 'agent', offset: 1, data: 'b' },
    ]);
    expect(adaptors.calls).to.deep.equal(['close']);
    expect(adaptors.channels).to.deep.equal(['chat']);
    expect(pool.released).to.deep.equal(['chat']);
    expect(stream.subscriptions).to.deep.equal([{ runId: 'run-1', topics: ['agent', RELAY_TOPIC], fromOffset: 0 }]);
  });

  it('relays only the route topics, and never passes relay topic events to the adaptor', async function () {
    const { stream, adaptors, relay } = harness();
    stream.publish('other', 'x');
    stream.publish('agent', 'a');
    stream.publish(RELAY_TOPIC, { type: WAKE });
    stream.publish('agent', 'b');
    stream.endOfStream();

    const result = await relay();

    expect(adaptors.written.map((event) => event.data)).to.deep.equal(['a', 'b']);
    expect(result.status).to.equal('completed');
    expect(result.offset).to.equal(5);
  });

  it('closes the adaptor and reports source-closed when the source closes without the end-of-stream event', async function () {
    const { stream, adaptors, pool, relay } = harness();
    stream.publish('agent', 'a');
    stream.close();

    const result = await relay();

    expect(result).to.deep.equal({
      status: 'source-closed',
      runId: 'run-1',
      offset: 1,
      handoff: { count: 1 },
      skipped: 0,
    });
    expect(adaptors.calls).to.deep.equal(['close']);
    expect(pool.released).to.deep.equal(['chat']);
  });

  it('flushes and checkpoints once it has relayed checkpointBudget events', async function () {
    const { stream, adaptors, relay } = harness();
    for (const data of ['a', 'b', 'c', 'd']) {
      stream.publish('agent', data);
    }

    const result = await relay(undefined, { checkpointBudget: 3 });

    expect(result).to.deep.equal({
      status: 'checkpoint',
      runId: 'run-1',
      offset: 3,
      handoff: { count: 3 },
      skipped: 0,
    });
    expect(adaptors.calls).to.deep.equal(['flush']);
    expect(adaptors.written).to.have.length(3);
    // It returned between reads, so it left no read to wake.
    expect(stream.wakes).to.equal(0);
  });

  it('checkpoints once the route has been quiet for idleCheckpointMs after an event, and wakes the read it leaves', async function () {
    const { stream, adaptors, relay } = harness();
    const relayed = relay(undefined, { idleCheckpointMs: 30 });
    // Before any event, a quiet route does not checkpoint, since it would record nothing new.
    await tick(60);
    expect(adaptors.calls).to.deep.equal([]);

    stream.publish('agent', 'a');
    const result = await relayed;

    expect(result).to.deep.equal({
      status: 'checkpoint',
      runId: 'run-1',
      offset: 1,
      handoff: { count: 1 },
      skipped: 0,
    });
    expect(adaptors.calls).to.deep.equal(['flush']);
    // It returned while reading, so it woke the read it left behind.
    await tick();
    expect(stream.wakes).to.equal(1);
    expect(stream.ended).to.equal(1);
  });

  it('checkpoints shortly before the start-to-close deadline, even if it has relayed nothing', async function () {
    const { stream, adaptors, relay } = harness();
    const env = activityEnvironment({ ...relayInfo, startToCloseTimeoutMs: 100 });
    const started = Date.now();

    const result = await relay({ offset: 7, handoff: { count: 4 }, runId: 'run-1' }, undefined, undefined, env);

    // The margin for a 100 ms timeout is a fifth of it, so the activity returns after about 80 ms.
    expect(Date.now() - started).to.be.at.least(75);
    expect(result).to.deep.equal({
      status: 'checkpoint',
      runId: 'run-1',
      offset: 7,
      handoff: { count: 4 },
      skipped: 0,
    });
    expect(adaptors.calls).to.deep.equal(['flush']);
    // It returned while reading, so it woke the read it left behind.
    expect(stream.wakes).to.equal(1);
  });

  it('keeps waiting when its deadline is further away than a timer can be set for', async function () {
    const { stream, relay } = harness();
    const env = activityEnvironment({ ...relayInfo, startToCloseTimeoutMs: 30 * 24 * 60 * 60 * 1000 });
    const relayed = relay(undefined, undefined, undefined, env);
    await tick(20);
    stream.endOfStream();

    expect((await relayed).status).to.equal('completed');
  });

  it('resumes from the checkpoint offset, with the checkpoint handoff', async function () {
    const { stream, adaptors, relay } = harness();
    for (const data of ['a', 'b', 'c']) {
      stream.publish('agent', data);
    }
    stream.endOfStream();

    const first = await relay(undefined, { checkpointBudget: 2 });
    const second = await relay(first, { checkpointBudget: 2 });

    expect(first).to.deep.equal({ status: 'checkpoint', runId: 'run-1', offset: 2, handoff: { count: 2 }, skipped: 0 });
    expect(second).to.deep.equal({ status: 'completed', runId: 'run-1', offset: 4, handoff: { count: 3 }, skipped: 0 });
    expect(adaptors.handoffs).to.deep.equal([null, { count: 2 }]);
    expect(stream.subscriptions.map((subscription) => subscription.fromOffset)).to.deep.equal([0, 2]);
    expect(adaptors.written.map((event) => event.data)).to.deep.equal(['a', 'b', 'c']);
  });

  it('fails retryably with the Ably error when the adaptor reports a transient channel error', async function () {
    const { stream, adaptors, pool, relay } = harness();
    stream.publish('agent', 'a');
    stream.close();
    adaptors.failWith = Object.assign(new Error('Connection suspended'), { code: 80002, statusCode: 500 });

    const failure = (await rejection(relay())) as ApplicationFailure;

    expect(failure).to.be.instanceOf(ApplicationFailure);
    expect(failure.type).to.equal(ABLY_ERROR_TYPE);
    expect(failure.nonRetryable).to.equal(false);
    expect(pool.released).to.deep.equal(['chat']);
  });

  it('aborts the adaptor before releasing its channel when the attempt fails', async function () {
    const { stream, adaptors, pool, relay } = harness();
    stream.publish('agent', 'a');
    stream.close();
    adaptors.failWith = new Error('flush failed');
    let releasedAtAbort: string[] | undefined;
    adaptors.onAbort = () => (releasedAtAbort = [...pool.released]);

    await rejection(relay());

    expect(adaptors.calls).to.deep.equal(['close', 'abort']);
    expect(releasedAtAbort).to.deep.equal([]);
  });

  it("fails with the attempt's own error when the adaptor throws from abort()", async function () {
    const { stream, adaptors, relay } = harness();
    stream.publish('agent', 'a');
    stream.close();
    adaptors.failWith = Object.assign(new Error('Connection suspended'), { code: 80002, statusCode: 500 });
    adaptors.onAbort = () => {
      throw new Error('abort failed');
    };

    const failure = (await rejection(relay())) as ApplicationFailure;

    expect(failure.type).to.equal(ABLY_ERROR_TYPE);
    expect(failure.message).to.equal('Connection suspended');
  });

  it('fails non-retryably when the route names an adaptor that is not registered', async function () {
    const { pool, relay } = harness();

    const failure = (await rejection(
      relay(undefined, undefined, { ...route, adaptor: 'vercel' }),
    )) as ApplicationFailure;

    expect(failure).to.be.instanceOf(ApplicationFailure);
    expect(failure.type).to.equal('AblyRelayUnknownAdaptor');
    expect(failure.nonRetryable).to.equal(true);
    expect(failure.message).to.contain('"vercel"').and.contain('AblyRelayPlugin').and.contain('recording');
    expect(pool.taken).to.deep.equal([]);
  });

  it('fails non-retryably when the adaptor factory returns no adaptor', async function () {
    const stream = new FakeStream();
    const pool = new FakePool();
    const notAFactory = (() => () => {}) as unknown as RelayAdaptorFactory;
    const activities = createRelayActivities(pool.pool, { broken: notAFactory }, (_, workflowId) =>
      stream.source(workflowId),
    );
    const input: RelayActivityInput = {
      sourceWorkflowId: 'source-1',
      route: { ...route, adaptor: 'broken' },
      checkpoint: { offset: 0, handoff: null, runId: 'run-1' },
    };

    const failure = (await rejection(
      activityEnvironment(relayInfo).run(activities[RELAY_ACTIVITY_NAME], input),
    )) as ApplicationFailure;

    expect(failure.type).to.equal('AblyRelayInvalidAdaptor');
    expect(failure.nonRetryable).to.equal(true);
    expect(pool.released).to.deep.equal(['chat']);
  });

  it('stops waiting for events once Temporal cancels it, aborts the adaptor and releases the channel', async function () {
    const { stream, adaptors, pool, relay } = harness();
    const env = activityEnvironment(relayInfo);
    const relayed = relay(undefined, undefined, undefined, env);
    await tick();

    env.cancel();

    expect(await rejection(relayed)).to.be.instanceOf(CancelledFailure);
    expect(pool.released).to.deep.equal(['chat']);
    expect(adaptors.calls).to.deep.equal(['abort']);
    // The subscription's read was still waiting for the source, so the activity woke it, which ended the subscription.
    await tick();
    expect(stream.wakes).to.equal(1);
    expect(stream.ended).to.equal(1);
  });

  it('follows the source across Continue-As-New, carrying on at the same offset in the next run', async function () {
    const { stream, adaptors, relay } = harness();
    stream.publish('agent', 'a');
    stream.continueAsNew();
    stream.publish('agent', 'b');
    stream.continueAsNew();
    stream.publish('agent', 'c');
    stream.endOfStream();

    const result = await relay();

    expect(adaptors.written.map((event) => event.data)).to.deep.equal(['a', 'b', 'c']);
    expect(result).to.deep.equal({ status: 'completed', runId: 'run-3', offset: 4, handoff: { count: 3 }, skipped: 0 });
    expect(stream.subscriptions.map(({ runId, fromOffset }) => ({ runId, fromOffset }))).to.deep.equal([
      { runId: 'run-1', fromOffset: 0 },
      { runId: 'run-2', fromOffset: 1 },
      { runId: 'run-3', fromOffset: 2 },
    ]);
  });

  it('follows Continue-As-New when the closed run is reported as not found', async function () {
    const { stream, adaptors, relay } = harness();
    stream.closeAsNotFound = true;
    stream.publish('agent', 'a');
    stream.continueAsNew();
    stream.publish('agent', 'b');
    stream.close();

    const result = await relay();

    expect(adaptors.written.map((event) => event.data)).to.deep.equal(['a', 'b']);
    expect(result).to.deep.equal({
      status: 'source-closed',
      runId: 'run-2',
      offset: 2,
      handoff: { count: 2 },
      skipped: 0,
    });
  });

  it('returns a checkpoint naming the run it was reading, and resumes from that run', async function () {
    const { stream, relay } = harness();
    stream.publish('agent', 'a');
    stream.continueAsNew();
    stream.publish('agent', 'b');
    stream.publish('agent', 'c');
    stream.endOfStream();

    const first = await relay(undefined, { checkpointBudget: 2 });
    const second = await relay(first);

    expect(first).to.deep.equal({ status: 'checkpoint', runId: 'run-2', offset: 2, handoff: { count: 2 }, skipped: 0 });
    expect(second).to.deep.include({ status: 'completed', runId: 'run-2', offset: 4 });
    expect(stream.subscriptions.at(-1)).to.deep.include({ runId: 'run-2', fromOffset: 2 });
  });

  it('follows a retry of the source by closing the adaptor and checkpointing at the start of its stream', async function () {
    const { stream, adaptors, relay } = harness();
    stream.publish('agent', 'The cat sa');
    stream.retry();
    stream.publish('agent', 'The cat sat on the mat.');
    stream.endOfStream();

    const first = await relay();
    const second = await relay(first);

    expect(first).to.deep.equal({ status: 'checkpoint', runId: 'run-2', offset: 0, handoff: null, skipped: 0 });
    expect(second).to.deep.equal({ status: 'completed', runId: 'run-2', offset: 2, handoff: { count: 1 }, skipped: 0 });
    // The failed attempt's adaptor was closed, ending what it left open, and the retry got a new one.
    expect(adaptors.calls).to.deep.equal(['close', 'close']);
    expect(adaptors.handoffs).to.deep.equal([null, null]);
    expect(adaptors.written.map((event) => event.data)).to.deep.equal(['The cat sa', 'The cat sat on the mat.']);
  });

  it('skips, logs and counts an event the adaptor rejects as unsupported, and relays the rest', async function () {
    const { stream, adaptors, relay } = harness();
    adaptors.unsupported.add('newer-chunk');
    stream.publish('agent', 'a');
    stream.publish('agent', 'newer-chunk');
    stream.publish('agent', 'b');
    stream.endOfStream();
    const { env, logger } = capturingActivityEnvironment(relayInfo);

    const result = await relay(undefined, undefined, undefined, env);

    expect(adaptors.written.map((event) => event.data)).to.deep.equal(['a', 'b']);
    expect(result).to.deep.equal({ status: 'completed', runId: 'run-1', offset: 4, handoff: { count: 2 }, skipped: 1 });
    const warning = logger.ablyEntries.find((entry) => entry.message.includes('skipped an event'));
    expect(warning?.level).to.equal('WARN');
    expect(warning?.meta).to.include({ channel: 'chat', topic: 'agent', offset: 1, reason: "can't write newer-chunk" });
  });

  it('skips an event rejected by any error whose type marks it unsupported, whatever its class', async function () {
    // An adaptor without a Temporal dependency can't create an ApplicationFailure, so it throws its own error.
    const { stream, adaptors, relay } = harness();
    const rejected = new Ably.ErrorInfo('unknown chunk type data-newer', 40003, 400);
    adaptors.throws.set('newer-chunk', Object.assign(rejected, { type: RELAY_UNSUPPORTED_EVENT_TYPE }));
    stream.publish('agent', 'a');
    stream.publish('agent', 'newer-chunk');
    stream.publish('agent', 'b');
    stream.endOfStream();
    const { env, logger } = capturingActivityEnvironment(relayInfo);

    const result = await relay(undefined, undefined, undefined, env);

    expect(adaptors.written.map((event) => event.data)).to.deep.equal(['a', 'b']);
    expect(result).to.include({ status: 'completed', skipped: 1 });
    const warning = logger.ablyEntries.find((entry) => entry.message.includes('skipped an event'));
    expect(warning?.meta).to.include({ offset: 1, reason: 'unknown chunk type data-newer' });
  });

  it('fails the activity for any other error from write()', async function () {
    const { stream, adaptors, relay } = harness();
    adaptors.broken.add('b');
    stream.publish('agent', 'a');
    stream.publish('agent', 'b');

    const failure = await rejection(relay());

    expect((failure as Error).message).to.equal('broke on b');
    expect(adaptors.calls).to.deep.equal(['abort']);
  });

  it('relays two routes of one stream independently, each from its own checkpoint', async function () {
    // The two-route example from the relay's design: routes a and b read one stream, each checkpointing on its own.
    const { stream, adaptors, relay } = harness();
    const routeA: RelayRoute = { topics: ['agent-a'], adaptor: 'recording', channel: 'a' };
    const routeB: RelayRoute = { topics: ['agent-b'], adaptor: 'recording', channel: 'b' };
    for (const [topic, data] of [
      ['agent-a', 'a1'],
      ['agent-b', 'b1'],
      ['agent-a', 'a2'],
      ['agent-a', 'a3'],
      ['agent-b', 'b2'],
      ['agent-b', 'b3'],
      ['agent-a', 'a4'],
    ]) {
      stream.publish(topic, data);
    }
    stream.endOfStream();

    const options = { checkpointBudget: 2 };
    const a1 = await relay(undefined, options, routeA);
    const b1 = await relay(undefined, options, routeB);
    const a2 = await relay(a1, options, routeA);
    const b2 = await relay(b1, options, routeB);
    const a3 = await relay(a2, options, routeA);

    expect([a1, a2, a3].map(({ status, offset }) => ({ status, offset }))).to.deep.equal([
      { status: 'checkpoint', offset: 3 },
      { status: 'checkpoint', offset: 7 },
      { status: 'completed', offset: 8 },
    ]);
    expect([b1, b2].map(({ status, offset }) => ({ status, offset }))).to.deep.equal([
      { status: 'checkpoint', offset: 5 },
      { status: 'completed', offset: 8 },
    ]);
    expect(adaptors.channels).to.deep.equal(['a', 'b', 'a', 'b', 'a']);
    expect(adaptors.dataByChannel).to.deep.equal({ a: ['a1', 'a2', 'a3', 'a4'], b: ['b1', 'b2', 'b3'] });
  });
});
