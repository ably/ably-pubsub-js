// Integration tests of the built plugin against an Ably sandbox app and a local Temporal server. The workflows in
// ./workflows.ts import the built `@ably/pubsub-server/temporal/workflow`, and run on workers with the built `AblyHttpPlugin`, each
// given an HTTP client from the built `@ably/pubsub-server` package. A separate client reads back what reached Ably.
//
// These tests check the assumptions the plugin makes about the Ably service:
//
// - that it accepts the plugin's `extras.headers`;
// - that it accepts the message IDs the plugin generates for `publish` and `batchPublish`, and the operation IDs it
//   generates for `object.publish`;
// - that it deduplicates a retried `publish` or `batchPublish` by message ID, even when the retry's headers differ;
// - that it deduplicates a retried `object.publish` by operation ID;
// - that it responds to a create discarded as a duplicate with an object that does not exist, which is why create
//   operations are published without IDs;
// - that a repeated create at a path fails;
// - that it deduplicates a retried `updateMessage` or `deleteMessage` by `idempotencyKey`, and a retried annotation by
//   its ID;
// - that it accepts the plugin's operation metadata;
// - and that the push admin calls work from a workflow, with the workflow's retry policy.
//
// Run `npm run build:node && npm run build:liveobjects && npm run build:temporal` first. Needs network access to the
// Ably sandbox.

import { randomUUID } from 'crypto';
import * as path from 'path';
import { isDeepStrictEqual } from 'util';
import type { WorkflowHandle } from '@temporalio/client';
import { MockActivityEnvironment, TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, DefaultLogger, Worker, type WorkflowBundleWithSourceMap } from '@temporalio/worker';
import * as Ably from '@ably/pubsub-server';
import { LiveObjects, type HttpObjectOperation, type HttpObjectPublishResult } from '@ably/pubsub-server/liveobjects';
import { AblyHttpPlugin, createActivities, type AblyActivities, type ActivityName } from '@ably/pubsub-server/temporal';
import { expect } from 'chai';
import {
  getSandboxApp,
  pollUntil,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
} from '../../uts/realtime/integration/sandbox';
import {
  causeChain,
  EventType,
  eventsOfType,
  expectedHeaders,
  expectedOperationMetadata,
  expectGeneratedIds,
  historyActivities,
  historyEvents,
  installTestRuntime,
  RetryState,
  type HistoryEvent,
} from '../temporal-test-helpers';
import type { CapturedError } from './workflows';

const TASK_QUEUE = 'ably-temporal-sandbox';
const RESTRICTED_TASK_QUEUE = 'ably-temporal-sandbox-subscribe-only';

/** The API key of the sandbox app whose capability is `capability`. */
function keyWithCapability(capability: Record<string, string[]>): string {
  const key = getSandboxApp().keys.find(
    (candidate) => JSON.stringify(JSON.parse(candidate.capability)) === JSON.stringify(capability),
  );
  if (!key) {
    throw new Error(`The sandbox app has no key with the capability ${JSON.stringify(capability)}`);
  }
  return key.keyStr;
}

function uniqueChannel(prefix: string): string {
  return `${prefix}:temporal-${randomUUID()}`;
}

type ActivityResult<N extends ActivityName> = Awaited<ReturnType<AblyActivities[N]>>;
type BatchPublishResult = Ably.BatchResult<Ably.BatchPublishSuccessResult | Ably.BatchPublishFailureResult>;

/** The compact form of the channel object in the LiveObjects tests. */
interface CompactObject {
  counter?: number;
  greeting?: string;
  [key: string]: unknown;
}

/**
 * Added to the counter at `counter` after the operations under test, so that a test can tell when they have all been
 * applied.
 */
const SENTINEL_INCREMENT = 1000;

describe('temporal sandbox integration', function () {
  this.timeout(180_000);

  let env: TestWorkflowEnvironment;
  let namespace: string;
  let workflowBundle: WorkflowBundleWithSourceMap;
  /** A client with every capability and the LiveObjects plugin, used to set up and read back what the tests publish. */
  let rest: Ably.PubSubHttpClient;
  const workers: Worker[] = [];
  const workerRuns: Promise<void>[] = [];

  before(async function () {
    try {
      await setupSandbox();
    } catch (err) {
      throw new Error(
        `Could not provision an Ably sandbox app at ${SANDBOX_ENDPOINT}. These tests need network access to the Ably sandbox. Cause: ${causeChain(err)}`,
      );
    }
    const key = keyWithCapability({ '*': ['*'] });
    rest = Ably.createHttpClient({ key, endpoint: SANDBOX_ENDPOINT, plugins: { LiveObjects } });

    installTestRuntime();
    env = await TestWorkflowEnvironment.createLocal();
    namespace = env.namespace ?? 'default';
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.join(__dirname, 'workflows.ts'),
      logger: new DefaultLogger('WARN'),
    });
    for (const [taskQueue, workerKey] of [
      [TASK_QUEUE, key],
      [RESTRICTED_TASK_QUEUE, keyWithCapability({ '*': ['subscribe'] })],
    ]) {
      const worker = await Worker.create({
        connection: env.nativeConnection,
        namespace,
        taskQueue,
        workflowBundle,
        plugins: [
          new AblyHttpPlugin({
            client: Ably.createHttpClient({ key: workerKey, endpoint: SANDBOX_ENDPOINT, plugins: { LiveObjects } }),
          }),
        ],
      });
      workers.push(worker);
      workerRuns.push(worker.run());
    }
  });

  after(async function () {
    for (const worker of workers) {
      worker.shutdown();
    }
    try {
      await Promise.all(workerRuns);
      await env?.teardown();
    } finally {
      await teardownSandbox();
    }
  });

  async function execute(
    taskQueue: string,
    workflow: string,
    ...args: unknown[]
  ): Promise<{ result: any; handle: WorkflowHandle; events: HistoryEvent[] }> {
    const handle = await env.client.workflow.start(workflow, {
      taskQueue,
      workflowId: `${workflow}-${randomUUID()}`,
      args,
      workflowExecutionTimeout: '90 seconds',
    });
    let result: unknown;
    try {
      result = await handle.result();
    } catch (err) {
      throw new Error(`Workflow ${workflow} failed: ${causeChain(err)}`);
    }
    return { result, handle, events: await historyEvents(handle) };
  }

  /** Reads the channel's history, oldest first, once it has at least `count` messages. */
  async function historyOf(channel: string, count: number): Promise<Ably.InboundMessage[]> {
    return pollUntil(
      async () => {
        const page = await rest.channels.get(channel).history({ direction: 'forwards' });
        return page.items.length >= count ? page.items : null;
      },
      { interval: 500, timeout: 15_000 },
    );
  }

  /**
   * Publishes a sentinel message, and returns the messages in the channel's history before it once it is visible,
   * so that a duplicate published before the sentinel has had as long to appear.
   */
  async function historyBeforeSentinel(channel: string): Promise<Ably.InboundMessage[]> {
    await rest.channels.get(channel).publish('sentinel', 'end');
    return pollUntil(
      async () => {
        const { items } = await rest.channels.get(channel).history({ direction: 'forwards' });
        const index = items.findIndex((item) => item.name === 'sentinel');
        return index === -1 ? null : items.slice(0, index);
      },
      { interval: 500, timeout: 15_000 },
    );
  }

  /**
   * Runs the activity `name` with `input` as attempt 1 and then as attempt 2 of the same activity, outside a
   * workflow, as Temporal does when the first attempt reached Ably but its result was lost. `input` can be a function
   * of the attempt number, for a test that sends different content on each attempt. `beforeRetry` runs between the
   * two attempts.
   */
  async function runTwice<N extends ActivityName>(
    name: N,
    input: Parameters<AblyActivities[N]>[0] | ((attempt: number) => Parameters<AblyActivities[N]>[0]),
    beforeRetry?: () => Promise<unknown>,
  ): Promise<ActivityResult<N>[]> {
    const activity = createActivities(rest)[name] as unknown as (input: unknown) => Promise<ActivityResult<N>>;
    const info = {
      namespace: 'default',
      activityId: '1',
      activityType: name,
      isLocal: false,
      inWorkflow: true,
      workflowType: 'sandboxDedupe',
      workflowExecution: { workflowId: `sandboxDedupe-${randomUUID()}`, runId: randomUUID() },
    };
    const results: ActivityResult<N>[] = [];
    for (const attempt of [1, 2]) {
      if (attempt === 2) {
        await beforeRetry?.();
      }
      const activityEnv = new MockActivityEnvironment({ ...info, attempt }, { logger: new DefaultLogger('ERROR') });
      results.push(await activityEnv.run(activity, typeof input === 'function' ? input(attempt) : input));
    }
    return results;
  }

  /**
   * Creates a channel whose channel object has a counter with a count of 0 at `counter`, and returns the channel
   * name and the counter's object ID. The create operation has no ID, so that Ably accepts it (see the test of
   * operations that Ably expands into several messages).
   */
  async function channelWithCounter(): Promise<{ channel: string; counterId: string }> {
    const channel = uniqueChannel('liveobjects');
    const { objectIds } = await rest.channels.get(channel).object.publish({
      path: 'counter',
      counterCreate: { count: 0 },
    });
    const counterId = objectIds.find((objectId) => objectId.startsWith('counter:'));
    expect(counterId, `the objects affected by creating the counter: ${JSON.stringify(objectIds)}`).to.be.a('string');
    return { channel, counterId: counterId! };
  }

  /**
   * Increments the counter at `counter` by SENTINEL_INCREMENT, waits until the increment is visible, and returns the
   * compact channel object with the sentinel increment subtracted from the counter.
   *
   * The returned value is final for every operation published before the sentinel: the object operations on a
   * channel are applied in the order Ably accepted them, and the sentinel is published only after the operations
   * under test, including any duplicate, were acknowledged. A duplicate that Ably did not discard is therefore
   * included.
   */
  async function objectAfterSentinel(channel: string): Promise<CompactObject> {
    const object = rest.channels.get(channel).object;
    await object.publish({ path: 'counter', counterInc: { number: SENTINEL_INCREMENT } });
    const compact = await pollUntil(
      async () => {
        const value = (await object.get()) as CompactObject;
        return (value.counter ?? 0) >= SENTINEL_INCREMENT ? value : null;
      },
      { interval: 500, timeout: 15_000 },
    );
    return { ...compact, counter: compact.counter! - SENTINEL_INCREMENT };
  }

  it('runs the built entry points of the plugin', function () {
    const serverDist = path.resolve(__dirname, '..', '..', '..', '..', 'server', 'dist');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const built = require(path.join(serverDist, 'temporal.js'));
    expect(AblyHttpPlugin).to.equal(built.AblyHttpPlugin);
    expect(createActivities).to.equal(built.createActivities);
    // The workflows import the built workflow entry point rather than the plugin's source, and it imports
    // nothing of the Ably runtime.
    expect(workflowBundle.code).to.include('"./packages/server/dist/temporal-workflow.mjs"');
    expect(workflowBundle.code).to.not.include('"./packages/core-impl/src/platform/temporal');
    expect(workflowBundle.code).to.not.match(/"\.\/packages\/(core\/|server\/dist\/(index|node)\.)/);
  });

  it('publishes from a workflow with generated IDs, and Ably accepts the Temporal metadata headers', async function () {
    const channel = uniqueChannel('persisted');

    const { result, handle, events } = await execute(TASK_QUEUE, 'sandboxPublish', channel);

    const items = await historyOf(channel, 2);
    expect(items).to.have.length(2);
    const ids = items.map((item) => item.id);
    expectGeneratedIds(ids);
    const [activity] = historyActivities(events);
    expect(activity.attempt).to.equal(1);
    expect(activity.input.messages.map((message: { id: string }) => message.id)).to.deep.equal(ids);
    expect(result.serials).to.deep.equal(items.map((item) => item.serial));

    expect(items[0].name).to.equal('greeting');
    expect(items[0].data).to.deep.equal({ text: 'hello' });
    expect(items[1].name).to.equal('bytes');
    expect(Buffer.isBuffer(items[1].data)).to.equal(true);
    expect(items[1].data).to.deep.equal(Buffer.from([0, 1, 254, 255]));

    // The headers come back exactly as the plugin sent them.
    const headers = expectedHeaders(namespace, handle.workflowId, events);
    expect(Object.keys(headers)).to.have.length(3);
    for (const item of items) {
      expect(item.extras).to.deep.equal({ headers });
    }
  });

  describe('deduplication of a retried publish', function () {
    it('keeps only the first attempt of a message with a fixed ID, although its headers differ', async function () {
      const channel = uniqueChannel('persisted');
      const id = `${randomUUID()}:0`;

      // Every attempt of a plugin call sends the same content, so the test sends its own differing header to show that
      // Ably deduplicates on the ID alone.
      const [first, second] = await runTwice('ably.channel.publish', (attempt) => ({
        channel,
        messages: [{ id, name: 'dedupe', data: 'payload', extras: { headers: { testAttempt: attempt } } }],
      }));

      const items = await historyBeforeSentinel(channel);
      expect(items).to.have.length(1);
      expect(items[0].id).to.equal(id);
      expect(items[0].extras.headers.testAttempt).to.equal(1);
      expect(items[0].extras.headers.temporalNamespace).to.equal('default');
      // Ably acknowledges the duplicate with the serial of the original message.
      expect(first.serials).to.deep.equal([items[0].serial]);
      expect(second.serials).to.deep.equal(first.serials);
    });

    it('keeps both attempts of a message without an ID', async function () {
      const channel = uniqueChannel('persisted');

      await runTwice('ably.channel.publish', (attempt) => ({
        channel,
        messages: [{ name: 'control', data: 'payload', extras: { headers: { testAttempt: attempt } } }],
      }));

      const items = await historyBeforeSentinel(channel);
      expect(items).to.have.length(2);
      expect(items.map((item) => item.extras.headers.testAttempt)).to.deep.equal([1, 2]);
      expect(items[0].id).to.not.equal(items[1].id);
    });
  });

  it('batch publishes from a workflow with generated IDs for each spec, and Ably accepts them', async function () {
    const paired = [uniqueChannel('persisted'), uniqueChannel('persisted')];
    const single = uniqueChannel('persisted');

    const { result, handle, events } = await execute(TASK_QUEUE, 'sandboxBatchPublish', paired, single);

    const [activity] = historyActivities(events);
    expect(activity.activityType).to.equal('ably.batchPublish');
    const [pairedItems, otherPairedItems, singleItems] = await Promise.all([
      historyOf(paired[0], 2),
      historyOf(paired[1], 2),
      historyOf(single, 1),
    ]);
    expect(pairedItems).to.have.length(2);
    expect(singleItems).to.have.length(1);
    const pairedIds = pairedItems.map((item) => item.id);
    const pairedBase = expectGeneratedIds(pairedIds);
    expect(otherPairedItems.map((item) => item.id)).to.deep.equal(pairedIds);
    const singleBase = expectGeneratedIds(singleItems.map((item) => item.id));
    expect(singleBase, 'each spec has its own ID base').to.not.equal(pairedBase);
    expect(activity.input.specs.map((spec: Ably.BatchPublishSpec) => spec.messages.map((m) => m.id))).to.deep.equal([
      pairedIds,
      [`${singleBase}:0`],
    ]);

    expect(pairedItems.map((item) => item.name)).to.deep.equal(['first', 'second']);
    expect(singleItems[0].name).to.equal('single');
    const headers = expectedHeaders(namespace, handle.workflowId, events);
    for (const item of [...pairedItems, ...otherPairedItems, ...singleItems]) {
      expect(item.extras).to.deep.equal({ headers });
    }

    // Ably reports the base of the message IDs as the message ID of each channel's publish.
    const [pairedResult, singleResult] = result as BatchPublishResult[];
    expect(pairedResult).to.include({ successCount: 2, failureCount: 0 });
    expect(singleResult).to.include({ successCount: 1, failureCount: 0 });
    for (const [channel, items] of [
      [paired[0], pairedItems],
      [paired[1], otherPairedItems],
    ] as const) {
      expect(pairedResult.results.find((entry) => entry.channel === channel)).to.deep.equal({
        channel,
        messageId: pairedBase,
        serials: items.map((item) => item.serial),
      });
    }
    expect(singleResult.results).to.deep.equal([
      { channel: single, messageId: singleBase, serials: [singleItems[0].serial] },
    ]);
  });

  describe('deduplication of a retried batch publish', function () {
    it('keeps only the first attempt of each message with a fixed ID, on every channel', async function () {
      const channels = [uniqueChannel('persisted'), uniqueChannel('persisted')];
      const base = randomUUID();
      const ids = [`${base}:0`, `${base}:1`];

      const [first, second] = (await runTwice('ably.batchPublish', (attempt) => ({
        specs: {
          channels,
          messages: [
            { id: ids[0], name: 'first', data: 'one', extras: { headers: { testAttempt: attempt } } },
            { id: ids[1], name: 'second', data: 'two', extras: { headers: { testAttempt: attempt } } },
          ],
        },
      }))) as BatchPublishResult[];

      expect(first).to.include({ successCount: 2, failureCount: 0 });
      for (const channel of channels) {
        const items = await historyBeforeSentinel(channel);
        expect(items.map((item) => item.id)).to.deep.equal(ids);
        expect(items.map((item) => item.extras.headers.testAttempt)).to.deep.equal([1, 1]);
        expect(first.results.find((entry) => entry.channel === channel)).to.deep.equal({
          channel,
          messageId: base,
          serials: items.map((item) => item.serial),
        });
      }
      // Ably acknowledges the duplicates with the message ID and serials of the original messages.
      expect(second).to.deep.equal(first);
    });

    it('keeps both attempts of messages without IDs, on every channel', async function () {
      const channels = [uniqueChannel('persisted'), uniqueChannel('persisted')];

      await runTwice('ably.batchPublish', (attempt) => ({
        specs: {
          channels,
          messages: [
            { name: 'first', data: 'one', extras: { headers: { testAttempt: attempt } } },
            { name: 'second', data: 'two', extras: { headers: { testAttempt: attempt } } },
          ],
        },
      }));

      for (const channel of channels) {
        const items = await historyBeforeSentinel(channel);
        expect(items.map((item) => item.name)).to.deep.equal(['first', 'second', 'first', 'second']);
        expect(items.map((item) => item.extras.headers.testAttempt)).to.deep.equal([1, 1, 2, 2]);
        expect(new Set(items.map((item) => item.id)).size).to.equal(4);
      }
    });
  });

  describe('LiveObjects operations', function () {
    it('publishes object operations from a workflow with generated IDs, and Ably applies them', async function () {
      const { channel, counterId } = await channelWithCounter();

      const { result, events } = await execute(TASK_QUEUE, 'sandboxObjectOperations', channel);

      const [increment, batch, get] = historyActivities(events);
      expect([increment, batch, get].map((activity) => activity.activityType)).to.deep.equal([
        'ably.channel.object.publish',
        'ably.channel.object.publish',
        'ably.channel.object.get',
      ]);
      const incrementBase = expectGeneratedIds([increment.input.operations.id]);
      const batchBase = expectGeneratedIds(
        batch.input.operations.map((operation: HttpObjectOperation) => operation.id),
      );
      // Ably reports the base of the operation IDs as the message ID of the publish.
      expect(result.increment).to.deep.equal({ messageId: incrementBase, channel, objectIds: [counterId] });
      expect(result.batch).to.deep.equal({ messageId: batchBase, channel, objectIds: [counterId, 'root'] });
      expect(result.counter.objectId).to.equal(counterId);

      expect(await objectAfterSentinel(channel)).to.deep.equal({ counter: 5, greeting: 'hello' });
    });

    // Observed on nonprod:sandbox: Ably rejects an operation ID on an operation that it expands into several object
    // messages, with 40031/400 "Client-specified message id missing or not a string in some messages of a
    // multi-message ProtocolMessage". The same operations succeed without an ID. The workflow publishes create
    // operations, and operations with a wildcard path, without IDs.
    it('publishes create and wildcard operations from a workflow without IDs, and Ably applies them', async function () {
      const channel = uniqueChannel('liveobjects');
      const object = rest.channels.get(channel).object;
      await object.publish({ path: 'scores', mapCreate: { semantics: 'lww', entries: {} } });
      await object.publish({ path: 'scores.a', counterCreate: { count: 0 } });
      await object.publish({ path: 'scores.b', counterCreate: { count: 0 } });

      const { result, events } = await execute(TASK_QUEUE, 'sandboxObjectOperationsWithoutIds', channel);

      const failed = Object.fromEntries(Object.entries(result).filter(([, outcome]) => 'error' in (outcome as object)));
      expect(failed, 'the operations that failed').to.deep.equal({});
      for (const activity of historyActivities(events)) {
        expect(activity.input.operations, 'the operations published').to.not.have.property('id');
      }
      // The object that a create without a path reports is the one that Ably created.
      const [createdId] = (result.counterCreate as { result: HttpObjectPublishResult }).result.objectIds;
      expect(await object.get({ objectId: createdId, compact: false })).to.deep.include({ objectId: createdId });
      const expected = { votes: 5, profile: { name: 'Ada' }, scores: { a: 1, b: 1 } };
      // On a timeout, the last value read is compared, so that the failure shows the difference.
      const compact = await pollUntil(
        async () => {
          const value = await object.get();
          return isDeepStrictEqual(value, expected) ? value : null;
        },
        { interval: 500, timeout: 15_000 },
      ).catch(() => object.get());
      expect(compact).to.deep.equal(expected);
    });

    describe('deduplication of a retried object publish', function () {
      /** Sets the `greeting` key of the channel object, as another writer might between two attempts. */
      function overwriteGreeting(channel: string): Promise<unknown> {
        return rest.channels
          .get(channel)
          .object.publish({ objectId: 'root', mapSet: { key: 'greeting', value: { string: 'overwritten' } } });
      }

      it('applies an operation with a fixed ID once', async function () {
        const { channel } = await channelWithCounter();
        const base = randomUUID();

        const [first, second] = await runTwice('ably.channel.object.publish', {
          channel,
          operations: { id: `${base}:0`, path: 'counter', counterInc: { number: 1 } },
        });

        expect(await objectAfterSentinel(channel)).to.deep.equal({ counter: 1 });
        // Ably acknowledges the duplicate with the message ID of the original, which is the base of the IDs.
        expect(first.messageId).to.equal(base);
        expect(second).to.deep.equal(first);
      });

      it('applies a batch of operations with fixed IDs once, although a key it sets changed in between', async function () {
        const { channel } = await channelWithCounter();
        const base = randomUUID();
        const operations: HttpObjectOperation[] = [
          { id: `${base}:0`, path: 'counter', counterInc: { number: 1 } },
          { id: `${base}:1`, objectId: 'root', mapSet: { key: 'greeting', value: { string: 'published' } } },
        ];

        const [first, second] = await runTwice('ably.channel.object.publish', { channel, operations }, () =>
          overwriteGreeting(channel),
        );

        expect(await objectAfterSentinel(channel)).to.deep.equal({ counter: 1, greeting: 'overwritten' });
        expect(first.messageId).to.equal(base);
        expect(second).to.deep.equal(first);
      });

      it('applies both attempts of operations without IDs', async function () {
        const { channel } = await channelWithCounter();
        const operations: HttpObjectOperation[] = [
          { path: 'counter', counterInc: { number: 1 } },
          { objectId: 'root', mapSet: { key: 'greeting', value: { string: 'published' } } },
        ];

        const [first, second] = await runTwice('ably.channel.object.publish', { channel, operations }, () =>
          overwriteGreeting(channel),
        );

        expect(await objectAfterSentinel(channel)).to.deep.equal({ counter: 2, greeting: 'published' });
        expect(second.messageId).to.not.equal(first.messageId);
      });

      // Why the workflow publishes create operations without IDs. If Ably starts responding to the duplicate with
      // the original's object IDs, this test fails, and the workflow can assign IDs to create operations.
      it('responds to a create with a fixed ID that it discards as a duplicate with an object that does not exist', async function () {
        const object = rest.channels.get(uniqueChannel('liveobjects')).object;
        const operation: HttpObjectOperation = { id: `${randomUUID()}:0`, counterCreate: { count: 1 } };

        const first = await object.publish(operation);
        const second = await object.publish(operation);

        expect(second.messageId).to.equal(first.messageId);
        expect(second.objectIds).to.have.length(1);
        expect(second.objectIds[0]).to.not.equal(first.objectIds[0]);
        expect(await object.get({ objectId: first.objectIds[0], compact: false })).to.deep.include({
          objectId: first.objectIds[0],
        });
        const missing = await object.get({ objectId: second.objectIds[0], compact: false }).then(
          () => null,
          (err: Ably.ErrorInfo) => err,
        );
        expect(missing?.code, 'the error reading the object in the response to the duplicate').to.equal(40400);
      });

      // A known limitation of creating an object at a path from a workflow: if the response to a successful create
      // is lost, the retried activity fails, because the path now holds an object.
      it('fails a repeated create at a path with 92007', async function () {
        const object = rest.channels.get(uniqueChannel('liveobjects')).object;
        const operation: HttpObjectOperation = { path: 'votes', counterCreate: { count: 1 } };

        await object.publish(operation);
        const repeated = await object.publish(operation).then(
          () => null,
          (err: Ably.ErrorInfo) => err,
        );

        expect(repeated, 'the error from the repeated create').to.deep.include({ code: 92007, statusCode: 400 });
      });
    });
  });

  it('fails a publish without the publish capability with a non-retryable AblyError, attempted once', async function () {
    const channel = uniqueChannel('persisted');

    const { result, events } = await execute(RESTRICTED_TASK_QUEUE, 'sandboxPublishOutcome', channel);

    const error = (result as { error?: CapturedError }).error;
    expect(error, 'the publish fails').to.exist;
    expect(error).to.deep.include({ isActivityFailure: true, causeType: 'AblyError', nonRetryable: true });
    expect(error!.details).to.deep.equal({
      code: 40160,
      statusCode: 401,
      message: 'Unauthorized to publish to channel',
      href: 'https://help.ably.io/error/40160',
    });

    const activities = historyActivities(events);
    expect(activities).to.have.length(1);
    expect(activities[0].attempt).to.equal(1);
    expect(eventsOfType(events, EventType.EVENT_TYPE_ACTIVITY_TASK_STARTED)).to.have.length(1);
    const [failed] = eventsOfType(events, EventType.EVENT_TYPE_ACTIVITY_TASK_FAILED);
    expect(failed.activityTaskFailedEventAttributes!.retryState).to.equal(RetryState.RETRY_STATE_NON_RETRYABLE_FAILURE);
  });

  it('updates and appends to a message, and Ably accepts the operation metadata', async function () {
    // The `mutable` namespace of the sandbox app has mutable messages enabled.
    const channel = uniqueChannel('mutable');

    const { result, handle, events } = await execute(TASK_QUEUE, 'sandboxMessageOperations', channel);

    const { serial, update, append } = result;
    for (const [name, outcome] of Object.entries({ update, append })) {
      if ('error' in outcome) {
        expect.fail(`${name}Message failed: ${JSON.stringify(outcome.error)}`);
      }
      expect(outcome.result.versionSerial).to.be.a('string');
    }
    const [, updateActivity, appendActivity] = historyActivities(events);
    expect([updateActivity.activityType, appendActivity.activityType]).to.deep.equal([
      'ably.channel.updateMessage',
      'ably.channel.appendMessage',
    ]);

    const channelRest = rest.channels.get(channel);
    const latest = await pollUntil(
      async () => {
        const message = await channelRest.getMessage(serial);
        return message.data === 'hello, edited!' ? message : null;
      },
      { interval: 500, timeout: 15_000 },
    );
    expect(latest.version?.description).to.equal('append');
    expect(latest.version?.metadata).to.deep.equal(expectedOperationMetadata(namespace, handle.workflowId, events));

    const versions = await pollUntil(
      async () => {
        const page = await channelRest.getMessageVersions(serial);
        return page.items.some((item) => item.version?.description === 'edit') ? page.items : null;
      },
      { interval: 500, timeout: 15_000 },
    );
    const updated = versions.find((item) => item.version?.description === 'edit')!;
    expect(updated.data).to.equal('hello, edited');
    expect(updated.version?.metadata).to.deep.equal({
      ...expectedOperationMetadata(namespace, handle.workflowId, events),
      reason: 'typo',
    });
  });

  describe('deduplication of a retried update, delete and annotation', function () {
    /** Publishes a message to a new channel in the `mutable` namespace, and returns the channel and its serial. */
    async function publishedMessage(): Promise<{ channel: string; serial: string }> {
      const channel = uniqueChannel('mutable');
      const { serials } = await rest.channels.get(channel).publish('original', 'hello');
      return { channel, serial: serials[0]! };
    }

    /** The versions of a message once there are at least `count`, waiting long enough for a duplicate to appear. */
    async function versionsOf(channel: string, serial: string, count: number): Promise<Ably.Message[]> {
      const versions = await pollUntil(
        async () => {
          const { items } = await rest.channels.get(channel).getMessageVersions(serial);
          return items.length >= count ? items : null;
        },
        { interval: 500, timeout: 15_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return (await rest.channels.get(channel).getMessageVersions(serial)).items;
    }

    for (const operation of ['updateMessage', 'deleteMessage'] as const) {
      const activity = operation === 'updateMessage' ? 'ably.channel.updateMessage' : 'ably.channel.deleteMessage';

      it(`keeps only the first attempt of ${operation} with an idempotencyKey`, async function () {
        const { channel, serial } = await publishedMessage();

        const [first, second] = await runTwice(activity, {
          channel,
          message: { serial, data: 'edited' },
          operation: { description: 'once' },
          options: { idempotencyKey: randomUUID() },
        });

        expect(second.versionSerial).to.equal(first.versionSerial);
        expect(await versionsOf(channel, serial, 2)).to.have.length(2);
      });

      it(`keeps both attempts of ${operation} without an idempotencyKey`, async function () {
        const { channel, serial } = await publishedMessage();

        const [first, second] = await runTwice(activity, {
          channel,
          message: { serial, data: 'edited' },
          operation: { description: 'twice' },
        });

        expect(second.versionSerial).to.not.equal(first.versionSerial);
        expect(await versionsOf(channel, serial, 3)).to.have.length(3);
      });
    }

    /** The annotations on a message once there are at least `count`, waiting long enough for a duplicate to appear. */
    async function annotationsOf(channel: string, serial: string, count: number): Promise<Ably.Annotation[]> {
      await pollUntil(
        async () => {
          const { items } = await rest.channels.get(channel).annotations.get(serial, {});
          return items.length >= count ? items : null;
        },
        { interval: 500, timeout: 15_000 },
      );
      await new Promise((resolve) => setTimeout(resolve, 2_000));
      return (await rest.channels.get(channel).annotations.get(serial, {})).items;
    }

    it('keeps only the first attempt of an annotation with an ID', async function () {
      const { channel, serial } = await publishedMessage();
      const id = `${randomUUID()}:0`;

      await runTwice('ably.channel.annotations.publish', {
        channel,
        messageOrSerial: serial,
        annotation: { id, type: 'reaction:multiple.v1', name: 'up' },
      });

      const annotations = await annotationsOf(channel, serial, 1);
      expect(annotations.map((annotation) => annotation.id)).to.deep.equal([id]);
    });

    it('keeps both attempts of an annotation without an ID', async function () {
      const { channel, serial } = await publishedMessage();

      await runTwice('ably.channel.annotations.publish', {
        channel,
        messageOrSerial: serial,
        annotation: { type: 'reaction:multiple.v1', name: 'up' },
      });

      expect(await annotationsOf(channel, serial, 2)).to.have.length(2);
    });

    it('deletes and annotates from a workflow with derived keys, and Ably accepts them', async function () {
      const channel = uniqueChannel('mutable');

      const { result, events } = await execute(TASK_QUEUE, 'sandboxDeleteAndAnnotate', channel);

      const [, annotate, remove] = historyActivities(events);
      expect(annotate.input.annotation.id).to.match(/^[0-9a-f-]{36}:0$/);
      expect(remove.input.options.idempotencyKey).to.match(/^[0-9a-f-]{36}$/);
      const [annotation] = await annotationsOf(channel, result.serial, 1);
      expect(annotation.id).to.equal(annotate.input.annotation.id);
      const versions = await versionsOf(channel, result.serial, 2);
      expect(versions.map((version) => version.action)).to.deep.equal(['message.create', 'message.delete']);
      expect(versions[1].version?.serial).to.equal(result.deleted.versionSerial);
    });
  });

  describe('push admin', function () {
    it('registers, subscribes and removes a device from a workflow', async function () {
      const channel = `pushenabled:temporal-${randomUUID()}`;
      const device = {
        id: `temporal-${randomUUID()}`,
        platform: 'android',
        formFactor: 'phone',
        push: { recipient: { transportType: 'gcm', registrationToken: 'xxxxxxxxxxx' } },
      } as Ably.DeviceDetails;

      const { result } = await execute(TASK_QUEUE, 'sandboxPushAdmin', channel, device);

      expect(result).to.deep.equal({
        saved: { id: device.id, platform: 'android' },
        got: { id: device.id, state: 'ACTIVE' },
        listed: [device.id],
        subscription: { channel, deviceId: device.id },
        subscriptions: [{ channel, deviceId: device.id }],
        afterRemove: [],
      });
    });

    it('publishes a push notification from a workflow with the retry policy', async function () {
      const channel = `pushenabled:temporal-${randomUUID()}`;
      const key = keyWithCapability({ '*': ['*'] });
      const realtime = Ably.createRealtimeClient({ key, endpoint: SANDBOX_ENDPOINT });
      try {
        const pushChannel = realtime.channels.get(channel);
        const received: Ably.InboundMessage[] = [];
        await pushChannel.subscribe('__ably_push__', (message) => {
          received.push(message);
        });
        const recipient = {
          transportType: 'ablyChannel',
          channel,
          ablyKey: key,
          ablyUrl: 'https://sandbox.realtime.ably-nonprod.net',
        };
        const payload = { notification: { title: 'Hello', body: 'From a workflow' }, data: { step: 'done' } };

        const { events } = await execute(TASK_QUEUE, 'sandboxPushPublish', recipient, payload);

        const [scheduled] = eventsOfType(events, EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED);
        expect(scheduled.activityTaskScheduledEventAttributes!.retryPolicy?.maximumAttempts).to.equal(3);
        await pollUntil(async () => (received.length > 0 ? received : null), { interval: 200, timeout: 15_000 });
        const data = typeof received[0].data === 'string' ? JSON.parse(received[0].data) : received[0].data;
        expect(data.data).to.deep.equal({ step: 'done' });
        expect(data.notification).to.include({ title: 'Hello', body: 'From a workflow' });
      } finally {
        realtime.close();
      }
    });
  });

  it('gets the presence set and status of a channel from a workflow', async function () {
    const channel = uniqueChannel('persisted');

    const { result } = await execute(TASK_QUEUE, 'sandboxPresenceAndStatus', channel);

    expect(result.presence).to.deep.equal({ items: [], hasNext: false });
    expect(result.status.channelId).to.equal(channel);
    expect(result.status.status.isActive).to.be.a('boolean');
    expect(result.status.status.occupancy.metrics).to.include({ presenceMembers: 0 });
    expect(result.history.map((item: { name: string }) => item.name)).to.deep.equal(['activate']);
  });
});
