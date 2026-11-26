import { expect } from 'chai';
import type { RealtimeChannelPool, RealtimePublisherChannel } from '@ably/pubsub-server';
import type { Info } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import type { MockActivityEnvironment } from '@temporalio/testing';
import type { WorkflowStreamItem } from '@temporalio/workflow-streams/client';
import { ABLY_ERROR_TYPE } from '../../../src/platform/temporal/src/common/errors';
import { END_OF_STREAM, RELAY_ACTIVITY_NAME, RELAY_TOPIC, WAKE } from '../../../src/platform/temporal/src/common/relay';
import type {
  JsonValue,
  RelayActivityInput,
  RelayActivityResult,
  RelayCheckpointOptions,
  RelayRoute,
} from '../../../src/platform/temporal/src/common/relay';
import type {
  RelayAdaptor,
  RelayAdaptorFactory,
  RelayEvent,
} from '../../../src/platform/temporal/src/worker/relay/adaptor';
import { createRelayActivities } from '../../../src/platform/temporal/src/worker/relay/activity';
import type { RelaySource, RelaySubscription } from '../../../src/platform/temporal/src/worker/relay/activity';
import { activityEnvironment, rejection } from './worker-helpers';

/**
 * A source workflow's Workflow Stream: an append-only log of events that subscriptions read from an offset, filtered
 * by topic, waiting for new events as the real subscription does, and ending once the stream is closed.
 */
class FakeStream {
  private readonly log: WorkflowStreamItem<unknown>[] = [];
  private closed = false;
  private wake: (() => void)[] = [];
  /** The topics and offset of each subscription opened, in order. */
  readonly subscriptions: { topics: string[]; fromOffset: number }[] = [];
  /** How many subscriptions have ended, whether by reaching the end of the stream or by `return()`. */
  ended = 0;

  publish(topic: string, data: unknown): void {
    this.log.push({ topic, data, offset: this.log.length });
    this.notify();
  }

  endOfStream(): void {
    this.publish(RELAY_TOPIC, { type: END_OF_STREAM });
  }

  close(): void {
    this.closed = true;
    this.notify();
  }

  /**
   * An async generator, as the real subscription is, so that `return()` waits for a read in progress to settle.
   */
  async *subscribe(topics: string[], fromOffset: number): RelaySource {
    this.subscriptions.push({ topics, fromOffset });
    let offset = fromOffset;
    try {
      for (;;) {
        const item = this.log.slice(offset).find((candidate) => topics.includes(candidate.topic));
        if (item) {
          offset = item.offset + 1;
          yield item;
          continue;
        }
        offset = this.log.length;
        if (this.closed) {
          return;
        }
        await new Promise<void>((resolve) => this.wake.push(resolve));
      }
    } finally {
      this.ended++;
    }
  }

  /** Opens a subscription as the activity does, whose wake publishes a wake event to the relay topic. */
  open(topics: string[], fromOffset: number): RelaySubscription {
    return {
      events: this.subscribe(topics, fromOffset),
      wake: async () => {
        this.wakes++;
        this.publish(RELAY_TOPIC, { type: WAKE });
      },
    };
  }

  /** How many times an activity has woken the stream's held reads. */
  wakes = 0;

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
        this.written.push(event);
        (this.dataByChannel[channel.name] ??= []).push(event.data);
        count++;
      },
      flush: () => settle('flush'),
      close: () => settle('close'),
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
    checkpoint?: { offset: number; handoff: JsonValue | null },
    options?: RelayCheckpointOptions,
    routeOverride?: RelayRoute,
    env?: MockActivityEnvironment,
  ): Promise<RelayActivityResult>;
}

function harness(): Harness {
  const stream = new FakeStream();
  const adaptors = new RecordingAdaptors();
  const pool = new FakePool();
  const activities = createRelayActivities(
    pool.pool,
    { recording: adaptors.factory },
    async (_, workflowId, topics, offset) => {
      expect(workflowId).to.equal('source-1');
      return stream.open(topics, offset);
    },
  );
  return {
    stream,
    adaptors,
    pool,
    relay: (
      checkpoint = { offset: 0, handoff: null },
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

    expect(result).to.deep.equal({ status: 'completed', offset: 3, handoff: { count: 2 } });
    expect(adaptors.written).to.deep.equal([
      { topic: 'agent', offset: 0, data: 'a' },
      { topic: 'agent', offset: 1, data: 'b' },
    ]);
    expect(adaptors.calls).to.deep.equal(['close']);
    expect(adaptors.channels).to.deep.equal(['chat']);
    expect(pool.released).to.deep.equal(['chat']);
    expect(stream.subscriptions).to.deep.equal([{ topics: ['agent', RELAY_TOPIC], fromOffset: 0 }]);
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

    expect(result).to.deep.equal({ status: 'source-closed', offset: 1, handoff: { count: 1 } });
    expect(adaptors.calls).to.deep.equal(['close']);
    expect(pool.released).to.deep.equal(['chat']);
  });

  it('flushes and checkpoints once it has relayed checkpointBudget events', async function () {
    const { stream, adaptors, relay } = harness();
    for (const data of ['a', 'b', 'c', 'd']) {
      stream.publish('agent', data);
    }

    const result = await relay(undefined, { checkpointBudget: 3 });

    expect(result).to.deep.equal({ status: 'checkpoint', offset: 3, handoff: { count: 3 } });
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

    expect(result).to.deep.equal({ status: 'checkpoint', offset: 1, handoff: { count: 1 } });
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

    const result = await relay({ offset: 7, handoff: { count: 4 } }, undefined, undefined, env);

    // The margin for a 100 ms timeout is a fifth of it, so the activity returns after about 80 ms.
    expect(Date.now() - started).to.be.at.least(75);
    expect(result).to.deep.equal({ status: 'checkpoint', offset: 7, handoff: { count: 4 } });
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

    expect(first).to.deep.equal({ status: 'checkpoint', offset: 2, handoff: { count: 2 } });
    expect(second).to.deep.equal({ status: 'completed', offset: 4, handoff: { count: 3 } });
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
    const activities = createRelayActivities(pool.pool, { broken: notAFactory }, async (_, __, topics, offset) =>
      stream.open(topics, offset),
    );
    const input: RelayActivityInput = {
      sourceWorkflowId: 'source-1',
      route: { ...route, adaptor: 'broken' },
      checkpoint: { offset: 0, handoff: null },
    };

    const failure = (await rejection(
      activityEnvironment(relayInfo).run(activities[RELAY_ACTIVITY_NAME], input),
    )) as ApplicationFailure;

    expect(failure.type).to.equal('AblyRelayInvalidAdaptor');
    expect(failure.nonRetryable).to.equal(true);
    expect(pool.released).to.deep.equal(['chat']);
  });

  it('stops waiting for events once Temporal cancels it, and releases the channel', async function () {
    const { stream, pool, relay } = harness();
    const env = activityEnvironment(relayInfo);
    const relayed = relay(undefined, undefined, undefined, env);
    await tick();

    env.cancel();

    expect(await rejection(relayed)).to.be.instanceOf(CancelledFailure);
    expect(pool.released).to.deep.equal(['chat']);
    // The subscription's read was still waiting for the source, so the activity woke it, which ended the subscription.
    await tick();
    expect(stream.wakes).to.equal(1);
    expect(stream.ended).to.equal(1);
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
