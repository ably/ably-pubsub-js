// Tests of the workflow-side proxy (`@ably/pubsub-server/temporal/workflow`) in a real Temporal environment. The workflows in
// ./workflows run against stub activities, registered under the Ably activity names, that record the inputs they
// receive and return canned results. No Ably requests are made.

import { randomUUID } from 'crypto';
import * as path from 'path';
import { Context } from '@temporalio/activity';
import { WorkflowFailedError, type WorkflowHandle } from '@temporalio/client';
import { ActivityFailure, ApplicationFailure, defaultPayloadConverter } from '@temporalio/common';
import { tsToMs } from '@temporalio/common/lib/time';
import { temporal } from '@temporalio/proto';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  bundleWorkflowCode,
  DefaultLogger,
  Runtime,
  Worker,
  type InjectedSinks,
  type WorkflowBundleWithSourceMap,
} from '@temporalio/worker';
import { expect } from 'chai';
import { ActivityNames, type ActivityName } from '../../../src/platform/temporal/src/common/activities';
import { getAblyErrorDetails } from '../../../src/platform/temporal/src/common/errors';
import { decodeFromWire, encodeForWire, type WirePage } from '../../../src/platform/temporal/src/common/wire';
import type { RecorderSinks } from './workflows/interceptors';

const EventType = temporal.api.enums.v1.EventType;
type HistoryEvent = temporal.api.history.v1.IHistoryEvent;

const TASK_QUEUE = 'ably-temporal-proxy-test';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const AUTH_ERROR_DETAILS = {
  code: 40142,
  statusCode: 401,
  message: 'Token expired',
  href: 'https://help.ably.io/error/40142',
};

/** An activity input as the stub activity received it, before decoding. */
interface ActivityCall {
  name: ActivityName;
  input: any;
  workflowId: string;
  isLocal: boolean;
}

/** An activity scheduled by a workflow, as recorded by the interceptor in ./workflows/interceptors. */
interface ScheduledActivity {
  phase: 'run' | 'replay';
  workflowId: string;
  activityType: string;
  args: unknown[];
  local: boolean;
}

const activityCalls: ActivityCall[] = [];
const scheduledActivities: ScheduledActivity[] = [];
let recordingPhase: ScheduledActivity['phase'] = 'run';

function page(channel: string, params: Record<string, string> | undefined): WirePage<unknown> {
  if (channel === 'nolinks') {
    return { items: [{ id: 'only' }], links: {} };
  }
  if (channel === 'binary') {
    return { items: [{ data: Uint8Array.from([1, 2, 3]) }, { data: { inner: Buffer.from([4, 5]) } }], links: {} };
  }
  if (params?.page === '2') {
    return { items: [{ id: 'item-2' }], links: { first: { page: '1' }, current: { page: '2' } } };
  }
  return {
    items: [{ id: 'item-1' }],
    links: { first: { page: '1' }, current: { page: '1', limit: '1' }, next: { page: '2' } },
  };
}

// The canned results of the stub activities, computed from their decoded inputs.
const handlers: Record<ActivityName, (input: any) => unknown> = {
  [ActivityNames.publish]: ({ channel, messages }) => {
    if (channel.startsWith('fail:')) {
      throw ApplicationFailure.create({
        type: 'AblyError',
        message: AUTH_ERROR_DETAILS.message,
        nonRetryable: true,
        details: [AUTH_ERROR_DETAILS],
      });
    }
    return { serials: messages.map((message: { id?: string }) => message.id ?? null) };
  },
  [ActivityNames.history]: ({ channel, params }) => page(channel, params),
  [ActivityNames.status]: ({ channel }) => ({ channelId: channel, status: { isActive: true } }),
  [ActivityNames.getMessage]: ({ serialOrMessage }) => ({ serial: serialOrMessage, name: 'got' }),
  [ActivityNames.updateMessage]: () => ({ versionSerial: 'v-update' }),
  [ActivityNames.deleteMessage]: () => ({ versionSerial: 'v-delete' }),
  [ActivityNames.appendMessage]: () => ({ versionSerial: 'v-append' }),
  [ActivityNames.getMessageVersions]: ({ channel, params }) => page(channel, params),
  [ActivityNames.presenceGet]: ({ channel, params }) => page(channel, params),
  [ActivityNames.presenceHistory]: ({ channel, params }) => page(channel, params),
  [ActivityNames.annotationsPublish]: () => undefined,
  [ActivityNames.annotationsDelete]: () => undefined,
  [ActivityNames.annotationsGet]: ({ channel, params }) => page(channel, params ?? undefined),
  [ActivityNames.objectGet]: ({ channel }) =>
    channel === 'binary'
      ? { objectId: 'root', map: { semantics: 'lww', entries: { bytes: { data: { bytes: Buffer.from([7, 8]) } } } } }
      : { a: { b: 1 } },
  [ActivityNames.objectPublish]: ({ channel }) => ({ messageId: 'msg-1', channel, objectIds: ['counter:1'] }),
  [ActivityNames.time]: () => 1234567890,
  [ActivityNames.request]: ({ path, params }) => {
    if (path === '/error') {
      return {
        items: [],
        links: {},
        statusCode: 404,
        success: false,
        errorCode: 40400,
        errorMessage: 'Not found',
        headers: { 'x-ably-errorcode': '40400' },
      };
    }
    if (params?.page === '2') {
      return {
        items: [{ n: 2 }],
        links: { first: { page: '1' }, current: { page: '2' } },
        statusCode: 200,
        success: true,
        headers: { 'content-type': 'application/json' },
      };
    }
    return {
      items: [{ n: 1 }],
      links: { first: { page: '1' }, current: { page: '1' }, next: { page: '2' } },
      statusCode: 201,
      success: true,
      headers: { 'content-type': 'application/json', link: ['<./next>; rel="next"'] },
    };
  },
  [ActivityNames.batchPublish]: ({ specs }) => {
    const result = (spec: { channels: string[]; messages: { id?: string }[] | { id?: string } }) => ({
      successCount: spec.channels.length,
      failureCount: 0,
      results: spec.channels.map((channel) => ({
        channel,
        messageId: 'batch',
        serials: (Array.isArray(spec.messages) ? spec.messages : [spec.messages]).map((message) => message.id ?? null),
      })),
    });
    return Array.isArray(specs) ? specs.map(result) : result(specs);
  },
  [ActivityNames.batchPresence]: ({ channels }) => [
    {
      successCount: channels.length,
      failureCount: 0,
      results: channels.map((channel: string) => ({ channel, presence: [] })),
    },
  ],
  [ActivityNames.pushPublish]: ({ recipient }) => {
    if (recipient.clientId === 'retryable-failure') {
      throw ApplicationFailure.create({ type: 'AblyError', message: 'Service unavailable', nonRetryable: false });
    }
  },
  [ActivityNames.pushCreateApnsBroadcast]: () => ({ id: 'b1', apnsChannelId: 'apns-1' }),
  [ActivityNames.pushLiveActivityStart]: () => undefined,
  [ActivityNames.pushLiveActivityUpdate]: () => undefined,
  [ActivityNames.pushLiveActivityEnd]: () => undefined,
  [ActivityNames.pushDeviceRegistrationsSave]: ({ argument }) => argument,
  [ActivityNames.pushDeviceRegistrationsGet]: ({ argument }) => ({ id: argument, platform: 'ios' }),
  [ActivityNames.pushDeviceRegistrationsList]: ({ params }) => page('push', params),
  [ActivityNames.pushDeviceRegistrationsRemove]: () => undefined,
  [ActivityNames.pushDeviceRegistrationsRemoveWhere]: () => undefined,
  [ActivityNames.pushChannelSubscriptionsSave]: ({ argument }) => argument,
  [ActivityNames.pushChannelSubscriptionsList]: ({ params }) => page('push', params),
  [ActivityNames.pushChannelSubscriptionsListChannels]: ({ params }) => page('push', params),
  [ActivityNames.pushChannelSubscriptionsRemove]: () => undefined,
  [ActivityNames.pushChannelSubscriptionsRemoveWhere]: () => undefined,
};

const activities = Object.fromEntries(
  (Object.keys(handlers) as ActivityName[]).map((name) => [
    name,
    async (input?: unknown) => {
      const { info } = Context.current();
      const workflowId = info.workflowExecution?.workflowId ?? '';
      activityCalls.push({ name, input, workflowId, isLocal: info.isLocal });
      return encodeForWire(await handlers[name](decodeFromWire(input)));
    },
  ]),
);

const sinks: InjectedSinks<RecorderSinks> = {
  recorder: {
    scheduled: {
      fn: (info, activityType, args, local) => {
        scheduledActivities.push({ phase: recordingPhase, workflowId: info.workflowId, activityType, args, local });
      },
      callDuringReplay: true,
    },
  },
};

function callsFor(workflowId: string): ActivityCall[] {
  return activityCalls.filter((call) => call.workflowId === workflowId);
}

function inputsFor(workflowId: string, name: ActivityName): any[] {
  return callsFor(workflowId)
    .filter((call) => call.name === name)
    .map((call) => call.input);
}

async function historyEvents(handle: WorkflowHandle): Promise<HistoryEvent[]> {
  return (await handle.fetchHistory()).events ?? [];
}

function scheduledEvents(events: HistoryEvent[]): HistoryEvent[] {
  return events.filter((event) => event.eventType === EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED);
}

function summaryOf(event: HistoryEvent): unknown {
  const payload = event.userMetadata?.summary;
  return payload ? defaultPayloadConverter.fromPayload(payload) : undefined;
}

/** Splits a generated message ID into its base and index, and checks the base is a UUID. */
function splitId(id: string): { base: string; index: number } {
  const separator = id.lastIndexOf(':');
  const base = id.slice(0, separator);
  expect(base).to.match(UUID_PATTERN);
  return { base, index: Number(id.slice(separator + 1)) };
}

describe('temporal/workflow proxy', function () {
  this.timeout(180_000);

  let env: TestWorkflowEnvironment;
  let workflowBundle: WorkflowBundleWithSourceMap;
  let worker: Worker;
  let workerRun: Promise<void>;

  before(async function () {
    // Several tests fail activities, workflows and workflow tasks on purpose, which the SDK logs as warnings.
    Runtime.install({ logger: new DefaultLogger('ERROR') });
    env = await TestWorkflowEnvironment.createLocal();
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.join(__dirname, 'workflows', 'index.ts'),
      workflowInterceptorModules: [path.join(__dirname, 'workflows', 'interceptors.ts')],
      logger: new DefaultLogger('WARN'),
    });
    worker = await Worker.create({
      connection: env.nativeConnection,
      namespace: env.namespace ?? 'default',
      taskQueue: TASK_QUEUE,
      workflowBundle,
      activities,
      sinks,
    });
    workerRun = worker.run();
  });

  after(async function () {
    if (worker) {
      worker.shutdown();
      await workerRun;
    }
    await env?.teardown();
  });

  async function start(workflow: string, ...args: unknown[]) {
    const workflowId = `${workflow}-${randomUUID()}`;
    const handle = await env.client.workflow.start(workflow, {
      taskQueue: TASK_QUEUE,
      workflowId,
      args,
      workflowExecutionTimeout: '60 seconds',
    });
    return { handle, workflowId };
  }

  async function execute(
    workflow: string,
    ...args: unknown[]
  ): Promise<{ result: any; handle: WorkflowHandle; workflowId: string }> {
    const { handle, workflowId } = await start(workflow, ...args);
    return { result: await handle.result(), handle, workflowId };
  }

  async function executeExpectingFailure(workflow: string, ...args: unknown[]): Promise<WorkflowFailedError> {
    const { handle } = await start(workflow, ...args);
    try {
      await handle.result();
    } catch (err) {
      expect(err).to.be.an.instanceof(WorkflowFailedError);
      return err as WorkflowFailedError;
    }
    expect.fail('Expected the workflow to fail');
  }

  describe('publish', function () {
    it('normalises each overload to an array of messages', async function () {
      const { result, workflowId } = await execute('publishOverloads');
      const inputs = inputsFor(workflowId, ActivityNames.publish);
      expect(inputs).to.have.length(5);

      const ids = inputs.map((input) => input.messages.map((message: { id: string }) => message.id));
      const bases = ids.map((messageIds) => splitId(messageIds[0]).base);
      expect(new Set(bases).size, 'each publish has its own ID base').to.equal(5);

      expect(inputs[0]).to.deep.equal({
        channel: 'overloads',
        messages: [{ name: 'greeting', data: 'hello', id: `${bases[0]}:0` }],
        options: { quickAck: true },
      });
      expect(inputs[1]).to.deep.equal({
        channel: 'overloads',
        messages: [{ name: 'single', data: { a: 1 }, id: `${bases[1]}:0` }],
        options: { param: 'x' },
      });
      expect(inputs[2]).to.deep.equal({
        channel: 'overloads',
        messages: [
          { name: 'a', id: `${bases[2]}:0` },
          { name: 'b', data: 2, id: `${bases[2]}:1` },
        ],
      });
      expect(inputs[3]).to.deep.equal({
        channel: 'overloads',
        messages: [{ name: null, data: 'nameless', id: `${bases[3]}:0` }],
      });
      expect(inputs[4]).to.deep.equal({ channel: 'overloads', messages: [{ name: 'nodata', id: `${bases[4]}:0` }] });

      expect(result.results).to.deep.equal(ids.map((serials) => ({ serials })));
      expect(result.sameChannel).to.equal(true);
      expect(result.channelName).to.equal('overloads');
    });

    it('assigns IDs with a shared base only when no message has an ID, without modifying the caller objects', async function () {
      const { result, workflowId } = await execute('publishIds');
      const [fresh, withOwnId, single] = inputsFor(workflowId, ActivityNames.publish);
      const [batch, singleSpec, singleMessageSpec] = inputsFor(workflowId, ActivityNames.batchPublish);

      const freshBase = splitId(fresh.messages[0].id).base;
      expect(fresh.messages).to.deep.equal([
        { name: 'x', id: `${freshBase}:0` },
        { name: 'y', extras: { headers: { h: '1' } }, id: `${freshBase}:1` },
      ]);
      expect(withOwnId.messages).to.deep.equal([{ name: 'p' }, { name: 'q', id: 'own-id' }]);
      const singleBase = splitId(single.messages[0].id).base;
      expect(single.messages).to.deep.equal([{ name: 'z', id: `${singleBase}:0` }]);

      const specBase = splitId(batch.specs[0].messages[0].id).base;
      expect(batch.specs).to.deep.equal([
        {
          channels: ['b1', 'b2'],
          messages: [
            { name: 'm1', id: `${specBase}:0` },
            { name: 'm2', id: `${specBase}:1` },
          ],
        },
        { channels: ['b3'], messages: [{ name: 'm3', id: 'spec-own-id' }, { name: 'm4' }] },
      ]);
      const singleSpecBase = splitId(singleSpec.specs.messages[0].id).base;
      expect(singleSpec.specs).to.deep.equal({
        channels: ['b4'],
        messages: [{ name: 'm5', id: `${singleSpecBase}:0` }],
      });

      const singleMessageBase = splitId(singleMessageSpec.specs.messages.id).base;
      expect(singleMessageSpec.specs).to.deep.equal({
        channels: ['b5'],
        messages: { name: 'm6', id: `${singleMessageBase}:0` },
      });

      const [operations, operationsWithOwnId, createAtPath, wildcard, create, createWithObjectId] = inputsFor(
        workflowId,
        ActivityNames.objectPublish,
      );
      const operationBase = splitId(operations.operations[0].id).base;
      expect(operations.operations).to.deep.equal([
        { objectId: 'counter:1', counterInc: { number: 1 }, id: `${operationBase}:0` },
        { objectId: 'counter:2', counterInc: { number: 2 }, id: `${operationBase}:1` },
      ]);
      expect(createAtPath.operations).to.deep.equal([
        { path: 'votes', counterCreate: { count: 0 } },
        { objectId: 'counter:1', counterInc: { number: 1 } },
      ]);
      expect(wildcard.operations).to.deep.equal({ path: 'scores.*', counterInc: { number: 1 } });
      expect(create.operations).to.deep.equal({ counterCreate: { count: 0 } });
      const createWithObjectIdBase = splitId(createWithObjectId.operations.id).base;
      expect(createWithObjectId.operations).to.deep.equal({
        objectId: 'counter:4',
        counterCreateWithObjectId: { initialValue: '{"count":0}', nonce: 'nonce' },
        id: `${createWithObjectIdBase}:0`,
      });
      expect(operationsWithOwnId.operations).to.deep.equal([
        { objectId: 'counter:3', counterInc: { number: 3 }, id: 'op-own-id' },
      ]);

      expect(
        new Set([
          freshBase,
          singleBase,
          specBase,
          singleSpecBase,
          singleMessageBase,
          operationBase,
          createWithObjectIdBase,
        ]).size,
      ).to.equal(7);
      expect(result.callerObjectsUnmodified).to.equal(true);
      expect(result.callerSpecsUnmodified).to.equal(true);
      expect(result.callerOperationsUnmodified).to.equal(true);
      expect(result.callerSingleMessageUnmodified).to.equal(true);
      expect(result.results.batch).to.have.length(2);
      expect(result.results.singleSpec.results[0].serials).to.deep.equal([`${singleSpecBase}:0`]);
    });

    it('does not assign IDs when idempotent publishing is disabled', async function () {
      const { workflowId } = await execute('publishIds', false);
      const [fresh, withOwnId, single] = inputsFor(workflowId, ActivityNames.publish);
      const [batch, singleSpec] = inputsFor(workflowId, ActivityNames.batchPublish);
      expect(fresh.messages).to.deep.equal([{ name: 'x' }, { name: 'y', extras: { headers: { h: '1' } } }]);
      expect(withOwnId.messages).to.deep.equal([{ name: 'p' }, { name: 'q', id: 'own-id' }]);
      expect(single.messages).to.deep.equal([{ name: 'z' }]);
      expect(batch.specs[0].messages).to.deep.equal([{ name: 'm1' }, { name: 'm2' }]);
      expect(singleSpec.specs.messages).to.deep.equal([{ name: 'm5' }]);
      const [operations] = inputsFor(workflowId, ActivityNames.objectPublish);
      expect(operations.operations).to.deep.equal([
        { objectId: 'counter:1', counterInc: { number: 1 } },
        { objectId: 'counter:2', counterInc: { number: 2 } },
      ]);
    });

    it('generates the same message IDs when the workflow is replayed', async function () {
      const { handle, workflowId } = await execute('publishIds');
      const original = scheduledActivities.filter((call) => call.workflowId === workflowId);
      expect(original.map((call) => call.activityType)).to.deep.equal([
        ActivityNames.publish,
        ActivityNames.publish,
        ActivityNames.publish,
        ActivityNames.batchPublish,
        ActivityNames.batchPublish,
        ActivityNames.batchPublish,
        ActivityNames.objectPublish,
        ActivityNames.objectPublish,
        ActivityNames.objectPublish,
        ActivityNames.objectPublish,
        ActivityNames.objectPublish,
        ActivityNames.objectPublish,
      ]);
      expect((original[0].args[0] as any).messages[0].id).to.match(/:0$/);

      const history = await handle.fetchHistory();
      recordingPhase = 'replay';
      try {
        await Worker.runReplayHistory({ workflowBundle, sinks }, history, workflowId);
      } finally {
        recordingPhase = 'run';
      }

      const replayed = scheduledActivities.filter((call) => call.workflowId === workflowId && call.phase === 'replay');
      expect(replayed).to.deep.equal(original.map((call) => ({ ...call, phase: 'replay' })));
    });

    it('fails the workflow with an AblyError for an invalid first argument, without running an activity', async function () {
      const { result, workflowId } = await execute('publishInvalid', false);
      expect(result).to.deep.equal({
        isApplicationFailure: true,
        isActivityFailure: false,
        type: 'AblyError',
        nonRetryable: true,
        message:
          'publish() expects an event name (string or null), a message object, or an array of message objects as its first argument',
        details: {
          code: 40003,
          statusCode: 400,
          message:
            'publish() expects an event name (string or null), a message object, or an array of message objects as its first argument',
          remediation:
            'Call publish(name, data) for a single event, or publish(message | message[]) with a Message-shaped object.',
          href: 'https://help.ably.io/error/40003',
        },
      });
      expect(callsFor(workflowId)).to.have.length(0);

      const error = await executeExpectingFailure('publishInvalid', true);
      expect(error.cause).to.be.an.instanceof(ApplicationFailure);
      expect((error.cause as ApplicationFailure).type).to.equal('AblyError');
      expect(getAblyErrorDetails(error)?.code).to.equal(40003);
    });
  });

  describe('operation idempotency keys', function () {
    it('derives a key for each update and delete, and an ID for each annotation, unless the caller set one', async function () {
      const { result, workflowId } = await execute('operationKeys');
      expect(result).to.deep.equal({ callerObjectsUnmodified: true });

      const updates = inputsFor(workflowId, ActivityNames.updateMessage);
      const [deleteInput] = inputsFor(workflowId, ActivityNames.deleteMessage);
      const [appendInput] = inputsFor(workflowId, ActivityNames.appendMessage);
      const keys = [
        updates[0].options.idempotencyKey,
        updates[1].options.idempotencyKey,
        deleteInput.options.idempotencyKey,
      ];
      for (const key of keys) {
        expect(key).to.match(UUID_PATTERN);
      }
      expect(new Set(keys).size).to.equal(3);
      expect(updates[1].options).to.deep.equal({ p: '1', idempotencyKey: keys[1] });
      expect(updates[2].options).to.deep.equal({ idempotencyKey: 'own-key' });
      // A retried append is applied again whatever its key, so appends are sent without one.
      expect(appendInput).to.not.have.property('options');

      const [annotation, ownAnnotation] = inputsFor(workflowId, ActivityNames.annotationsPublish);
      const [deletedAnnotation] = inputsFor(workflowId, ActivityNames.annotationsDelete);
      expect(splitId(annotation.annotation.id).index).to.equal(0);
      expect(splitId(deletedAnnotation.annotation.id).base).to.not.equal(splitId(annotation.annotation.id).base);
      expect(ownAnnotation.annotation.id).to.equal('own-annotation-id');
    });

    it('does not derive keys when idempotent publishing is disabled', async function () {
      const { workflowId } = await execute('operationKeys', false);
      const updates = inputsFor(workflowId, ActivityNames.updateMessage);
      expect(updates.map((input) => input.options)).to.deep.equal([
        undefined,
        { p: '1' },
        { idempotencyKey: 'own-key' },
      ]);
      expect(inputsFor(workflowId, ActivityNames.deleteMessage)[0]).to.not.have.property('options');
      for (const input of inputsFor(workflowId, ActivityNames.annotationsPublish).slice(0, 1)) {
        expect(input.annotation).to.not.have.property('id');
      }
    });

    it('derives the same keys when the workflow is replayed', async function () {
      const { handle, workflowId } = await execute('operationKeys');
      const original = scheduledActivities.filter((call) => call.workflowId === workflowId);
      expect(original).to.have.length(8);

      const history = await handle.fetchHistory();
      recordingPhase = 'replay';
      try {
        await Worker.runReplayHistory({ workflowBundle, sinks }, history, workflowId);
      } finally {
        recordingPhase = 'run';
      }

      const replayed = scheduledActivities.filter((call) => call.workflowId === workflowId && call.phase === 'replay');
      expect(replayed).to.deep.equal(original.map((call) => ({ ...call, phase: 'replay' })));
    });
  });

  describe('push admin', function () {
    it('runs the matching activity with the arguments', async function () {
      const { result, workflowId, handle } = await execute('pushAdmin');
      const device = { id: 'device-1', platform: 'ios', formFactor: 'phone', push: { recipient: {} } };
      const subscription = { channel: 'news', clientId: 'user-1' };
      expect(callsFor(workflowId).map(({ name, input }) => [name, input])).to.deep.equal([
        [
          ActivityNames.pushPublish,
          { recipient: { clientId: 'user-1' }, payload: { notification: { title: 'Hello' } } },
        ],
        [ActivityNames.pushCreateApnsBroadcast, { argument: { messageStoragePolicy: 1 } }],
        [
          ActivityNames.pushLiveActivityStart,
          {
            argument: { recipient: { channels: ['news'] }, apnsBroadcast: 'b1', apns: { aps: { event: 'start' } } },
          },
        ],
        [
          ActivityNames.pushLiveActivityUpdate,
          { argument: { apnsBroadcast: 'b1', apns: { aps: { event: 'update' } } } },
        ],
        [ActivityNames.pushLiveActivityEnd, { argument: { apnsBroadcast: 'b1', apns: { aps: { event: 'end' } } } }],
        [ActivityNames.pushDeviceRegistrationsSave, { argument: device }],
        // A device with an ID is reduced to its ID.
        [ActivityNames.pushDeviceRegistrationsGet, { argument: 'device-1' }],
        [ActivityNames.pushDeviceRegistrationsList, { params: { clientId: 'user-1' } }],
        [ActivityNames.pushDeviceRegistrationsList, { params: { page: '2' } }],
        [ActivityNames.pushDeviceRegistrationsRemove, { argument: 'device-1' }],
        [ActivityNames.pushDeviceRegistrationsRemoveWhere, { argument: { clientId: 'user-1' } }],
        [ActivityNames.pushChannelSubscriptionsSave, { argument: subscription }],
        [ActivityNames.pushChannelSubscriptionsList, { params: { channel: 'news' } }],
        [ActivityNames.pushChannelSubscriptionsList, { params: { page: '2' } }],
        [ActivityNames.pushChannelSubscriptionsListChannels, { params: {} }],
        [ActivityNames.pushChannelSubscriptionsListChannels, { params: { page: '2' } }],
        [ActivityNames.pushChannelSubscriptionsRemove, { argument: subscription }],
        [ActivityNames.pushChannelSubscriptionsRemoveWhere, { argument: { clientId: 'user-1' } }],
      ]);

      const nextPage = { items: [{ id: 'item-2' }], hasNext: false, isLast: true };
      expect(result).to.deep.equal({
        createApnsBroadcast: { id: 'b1', apnsChannelId: 'apns-1' },
        deviceSave: device,
        deviceGet: { id: 'device-1', platform: 'ios' },
        deviceList: nextPage,
        subscriptionSave: subscription,
        subscriptionList: nextPage,
        subscriptionListChannels: nextPage,
      });

      expect(scheduledEvents(await historyEvents(handle)).map(summaryOf)).to.deep.equal([
        'push.admin.publish',
        'push.admin.createApnsBroadcast',
        'push.admin.liveActivity.start',
        'push.admin.liveActivity.update',
        'push.admin.liveActivity.end',
        'push.admin.deviceRegistrations.save',
        'push.admin.deviceRegistrations.get',
        'push.admin.deviceRegistrations.list',
        'push.admin.deviceRegistrations.list (next page)',
        'push.admin.deviceRegistrations.remove',
        'push.admin.deviceRegistrations.removeWhere',
        'push.admin.channelSubscriptions.save',
        'push.admin.channelSubscriptions.list',
        'push.admin.channelSubscriptions.list (next page)',
        'push.admin.channelSubscriptions.listChannels',
        'push.admin.channelSubscriptions.listChannels (next page)',
        'push.admin.channelSubscriptions.remove',
        'push.admin.channelSubscriptions.removeWhere',
      ]);
    });

    async function retryPolicies(variant: string): Promise<[string, number | null | undefined][]> {
      const { handle } = await execute('pushRetries', variant);
      return scheduledEvents(await historyEvents(handle)).map((event) => [
        summaryOf(event) as string,
        event.activityTaskScheduledEventAttributes!.retryPolicy?.maximumAttempts,
      ]);
    }

    it('applies the retry policy to every push admin call', async function () {
      for (const variant of ['default', 'custom']) {
        const retryPolicy = variant === 'default' ? 0 : 5;
        expect(await retryPolicies(variant), variant).to.deep.equal([
          ['push.admin.publish', retryPolicy],
          ['push.admin.createApnsBroadcast', retryPolicy],
          ['push.admin.liveActivity.start', retryPolicy],
          ['push.admin.liveActivity.update', retryPolicy],
          ['push.admin.liveActivity.end', retryPolicy],
          ['push.admin.deviceRegistrations.get', retryPolicy],
          ['push.admin.channelSubscriptions.removeWhere', retryPolicy],
        ]);
      }
    });

    it('retries a local push notification activity with the retry policy', async function () {
      // A failed local activity throws its cause in the workflow, rather than an ActivityFailure.
      const { result, workflowId } = await execute('pushLocalFailure');
      expect(result).to.include({ isApplicationFailure: true, type: 'AblyError', message: 'Service unavailable' });
      expect(callsFor(workflowId)).to.have.length(3);
    });
  });

  describe('arguments', function () {
    it('fails the workflow with an AblyError for invalid arguments, without running an activity', async function () {
      const { result, workflowId } = await execute('invalidArguments');
      const errors = result as Record<string, any>;
      expect(Object.keys(errors)).to.have.length(14);
      for (const [method, error] of Object.entries(errors)) {
        expect(error, method).to.include({ isApplicationFailure: true, type: 'AblyError', nonRetryable: true });
        expect(error.details, method).to.include({ code: 40003, statusCode: 400 });
        expect(error.details.remediation, method).to.be.a('string');
      }
      expect(errors.updateMessage.message).to.equal(
        'updateMessage() expects message to be an object, but was called with null',
      );
      expect(errors.channelOptions.message).to.equal(
        'channels.get() in workflow code does not take channel options, but was called with options for channel "invalid"',
      );
      expect(errors.liveActivityStart.message).to.equal(
        'push.admin.liveActivity.start() expects params.recipient to be an object, but was called with a value of type undefined',
      );
      expect(errors.deviceRegistrationsGet.message).to.equal(
        'push.admin.deviceRegistrations.get() expects a device ID or a DeviceDetails object, but was called with null',
      );
      expect(callsFor(workflowId)).to.have.length(0);
    });

    it('sends the serial of a message that has one, and a message without a serial as it is', async function () {
      const { workflowId } = await execute('serialArguments');
      expect(inputsFor(workflowId, ActivityNames.getMessage)).to.deep.equal([
        { channel: 'serials', serialOrMessage: 's1' },
        { channel: 'serials', serialOrMessage: { data: 'no serial' } },
      ]);
      expect(inputsFor(workflowId, ActivityNames.getMessageVersions)[0].serialOrMessage).to.equal('s2');
      expect(inputsFor(workflowId, ActivityNames.annotationsPublish)[0].messageOrSerial).to.equal('s3');
    });
  });

  describe('binary data', function () {
    it('sends binary data encoded and returns binary results as Uint8Array', async function () {
      const { result, workflowId } = await execute('binaryData');
      const [first, second] = inputsFor(workflowId, ActivityNames.publish);
      expect(first.messages[0].data).to.deep.equal({ __ablyTemporalBinary: 'AQID' });
      expect(second.messages[0].data).to.deep.equal({ inner: { __ablyTemporalBinary: 'BAU=' }, text: 'kept' });
      expect(result).to.deep.equal({
        historyData: { isUint8Array: true, bytes: [1, 2, 3] },
        historyNested: { isUint8Array: true, bytes: [4, 5] },
        objectBytes: { isUint8Array: true, bytes: [7, 8] },
      });
    });
  });

  describe('pagination', function () {
    it('fetches related pages by running the activity with the link params', async function () {
      const { result, workflowId } = await execute('pagination');
      expect(inputsFor(workflowId, ActivityNames.history)).to.deep.equal([
        { channel: 'pages', params: { limit: 1 } },
        { channel: 'pages', params: { page: '2' } },
        { channel: 'pages', params: { page: '1' } },
        { channel: 'pages', params: { page: '1', limit: '1' } },
        { channel: 'nolinks' },
      ]);
      expect(result.page1).to.deep.equal({ items: [{ id: 'item-1' }], hasNext: true, isLast: false });
      expect(result.page2).to.deep.equal({ items: [{ id: 'item-2' }], hasNext: false, isLast: true });
      expect(result.page3).to.equal(null);
      expect(result.first.items).to.deep.equal([{ id: 'item-1' }]);
      expect(result.current.items).to.deep.equal([{ id: 'item-1' }]);
      expect(result.unlinked).to.deep.equal({ items: [{ id: 'only' }], hasNext: false, isLast: true });
      expect(result.unlinkedNext).to.equal(null);
      expect(result.unlinkedFirstError).to.deep.include({ isApplicationFailure: true, type: 'AblyError' });
      expect(result.unlinkedFirstError.details).to.deep.include({
        code: 40400,
        statusCode: 404,
        message: 'No link to the first page of results',
      });
      expect(result.unlinkedFirstError.details.remediation).to.be.a('string');
      expect(result.unlinkedCurrentError.details).to.deep.include({
        code: 40400,
        statusCode: 404,
        message: 'No link to the current page of results',
      });
      expect(result.unlinkedCurrentError.details.remediation).to.be.a('string');
    });

    it('fetches related pages of a request with GET to the same path, version and headers', async function () {
      const { result, workflowId } = await execute('requestPagination');
      const headers = { 'X-Custom': 'yes' };
      expect(inputsFor(workflowId, ActivityNames.request)).to.deep.equal([
        { method: 'POST', path: '/custom/path', version: 3, params: { q: '1' }, body: { hello: 'world' }, headers },
        { method: 'get', path: '/custom/path', version: 3, params: { page: '2' }, headers },
        { method: 'get', path: '/custom/path', version: 3, params: { page: '1' }, headers },
        { method: 'get', path: '/custom/path', version: 3, params: { page: '2' }, headers },
        { method: 'get', path: '/error', version: 2 },
      ]);
      expect(result.response).to.deep.equal({
        items: [{ n: 1 }],
        hasNext: true,
        isLast: false,
        statusCode: 201,
        success: true,
        errorCode: null,
        errorMessage: null,
        headers: { 'content-type': 'application/json', link: ['<./next>; rel="next"'] },
      });
      expect(result.next).to.deep.include({ items: [{ n: 2 }], hasNext: false, isLast: true, statusCode: 200 });
      expect(result.first).to.deep.include({ items: [{ n: 1 }], statusCode: 201 });
      expect(result.current).to.deep.include({ items: [{ n: 2 }], statusCode: 200 });
      expect(result.afterLast).to.equal(null);
      expect(result.failed).to.deep.equal({
        items: [],
        hasNext: false,
        isLast: true,
        statusCode: 404,
        success: false,
        errorCode: 40400,
        errorMessage: 'Not found',
        headers: { 'x-ably-errorcode': '40400' },
      });
    });
  });

  describe('channel and client methods', function () {
    it('run the matching activity with the channel and arguments', async function () {
      const { result, workflowId, handle } = await execute('channelMethods');
      const calls = callsFor(workflowId).map(({ name, input }) => [name, input]);
      const [objectPublish] = inputsFor(workflowId, ActivityNames.objectPublish);
      const objectOperationBase = splitId(objectPublish.operations.id).base;
      const [updateKey] = inputsFor(workflowId, ActivityNames.updateMessage).map(
        (input) => input.options.idempotencyKey,
      );
      const [deleteKey] = inputsFor(workflowId, ActivityNames.deleteMessage).map(
        (input) => input.options.idempotencyKey,
      );
      const [publishedAnnotation] = inputsFor(workflowId, ActivityNames.annotationsPublish);
      const [deletedAnnotation] = inputsFor(workflowId, ActivityNames.annotationsDelete);
      expect(updateKey).to.match(UUID_PATTERN);
      expect(deleteKey).to.match(UUID_PATTERN);
      const publishedAnnotationBase = splitId(publishedAnnotation.annotation.id).base;
      const deletedAnnotationBase = splitId(deletedAnnotation.annotation.id).base;
      expect(calls).to.deep.equal([
        [ActivityNames.status, { channel: 'methods' }],
        [ActivityNames.getMessage, { channel: 'methods', serialOrMessage: 's1' }],
        [
          ActivityNames.updateMessage,
          {
            channel: 'methods',
            message: { serial: 's1', data: 'new' },
            operation: { description: 'edit' },
            options: { p: '1', idempotencyKey: updateKey },
          },
        ],
        [
          ActivityNames.deleteMessage,
          { channel: 'methods', message: { serial: 's1' }, options: { idempotencyKey: deleteKey } },
        ],
        [
          ActivityNames.appendMessage,
          { channel: 'methods', message: { serial: 's1', data: ' more' }, options: { q: '2' } },
        ],
        [ActivityNames.getMessageVersions, { channel: 'methods', serialOrMessage: 's1', params: { limit: 5 } }],
        [ActivityNames.getMessageVersions, { channel: 'methods', serialOrMessage: 's1', params: { page: '2' } }],
        [ActivityNames.presenceGet, { channel: 'methods', params: { clientId: 'c1' } }],
        [ActivityNames.presenceGet, { channel: 'methods', params: { page: '2' } }],
        [ActivityNames.presenceHistory, { channel: 'methods', params: { limit: 2 } }],
        [ActivityNames.presenceHistory, { channel: 'methods', params: { page: '2' } }],
        [
          ActivityNames.annotationsPublish,
          {
            channel: 'methods',
            messageOrSerial: 's1',
            annotation: { type: 'reaction:distinct.v1', name: 'up', id: `${publishedAnnotationBase}:0` },
          },
        ],
        [
          ActivityNames.annotationsDelete,
          {
            channel: 'methods',
            messageOrSerial: 's1',
            annotation: { type: 'reaction:distinct.v1', id: `${deletedAnnotationBase}:0` },
          },
        ],
        [ActivityNames.annotationsGet, { channel: 'methods', messageOrSerial: 's1', params: null }],
        [ActivityNames.annotationsGet, { channel: 'methods', messageOrSerial: 's1', params: { page: '2' } }],
        [ActivityNames.objectGet, { channel: 'methods', params: { objectId: 'root', path: 'a.b' } }],
        [
          ActivityNames.objectPublish,
          {
            channel: 'methods',
            operations: { objectId: 'counter:1', counterInc: { number: 1 }, id: `${objectOperationBase}:0` },
          },
        ],
        [ActivityNames.time, undefined],
        [ActivityNames.batchPresence, { channels: ['p1', 'p2'] }],
      ]);

      expect(result).to.deep.equal({
        status: { channelId: 'methods', status: { isActive: true } },
        getMessage: { serial: 's1', name: 'got' },
        updateMessage: { versionSerial: 'v-update' },
        deleteMessage: { versionSerial: 'v-delete' },
        appendMessage: { versionSerial: 'v-append' },
        getMessageVersions: { items: [{ id: 'item-2' }], hasNext: false, isLast: true },
        presenceGet: { items: [{ id: 'item-2' }], hasNext: false, isLast: true },
        presenceHistory: { items: [{ id: 'item-2' }], hasNext: false, isLast: true },
        annotationsGet: { items: [{ id: 'item-2' }], hasNext: false, isLast: true },
        objectGet: { a: { b: 1 } },
        objectPublish: { messageId: 'msg-1', channel: 'methods', objectIds: ['counter:1'] },
        time: 1234567890,
        batchPresence: [
          {
            successCount: 2,
            failureCount: 0,
            results: [
              { channel: 'p1', presence: [] },
              { channel: 'p2', presence: [] },
            ],
          },
        ],
      });

      expect(scheduledEvents(await historyEvents(handle)).map(summaryOf)).to.deep.equal([
        'status methods',
        'getMessage methods',
        'updateMessage methods',
        'deleteMessage methods',
        'appendMessage methods',
        'getMessageVersions methods',
        'getMessageVersions methods (next page)',
        'presence.get methods',
        'presence.get methods (next page)',
        'presence.history methods',
        'presence.history methods (next page)',
        'annotations.publish methods',
        'annotations.delete methods',
        'annotations.get methods',
        'annotations.get methods (next page)',
        'object.get methods',
        'object.publish methods',
        'time',
        'batchPresence (2 channels)',
      ]);
    });
  });

  describe('activity options', function () {
    it('applies the default options and a summary naming the operation', async function () {
      const { handle } = await execute('activityOptions', 'default');
      const events = scheduledEvents(await historyEvents(handle));
      expect(events.map(summaryOf)).to.deep.equal(['publish opts', 'history opts', 'history opts (next page)', 'time']);
      for (const event of events) {
        const attributes = event.activityTaskScheduledEventAttributes!;
        expect(tsToMs(attributes.startToCloseTimeout)).to.equal(30_000);
      }
    });

    it("applies the caller's activity options over the defaults", async function () {
      const { handle } = await execute('activityOptions', 'custom');
      const events = scheduledEvents(await historyEvents(handle));
      expect(events).to.have.length(4);
      expect(summaryOf(events[0])).to.equal('publish opts');
      for (const event of events) {
        const attributes = event.activityTaskScheduledEventAttributes!;
        expect(tsToMs(attributes.startToCloseTimeout)).to.equal(7_000);
        expect(tsToMs(attributes.scheduleToCloseTimeout)).to.equal(60_000);
        expect(attributes.retryPolicy?.maximumAttempts).to.equal(2);
        expect(attributes.retryPolicy?.nonRetryableErrorTypes).to.deep.equal(['AblyError']);
      }
    });

    it("uses the caller's summary when set", async function () {
      const { handle } = await execute('activityOptions', 'summary');
      const events = scheduledEvents(await historyEvents(handle));
      expect(events.map(summaryOf)).to.deep.equal(['my summary', 'my summary', 'my summary', 'my summary']);
      expect(tsToMs(events[0].activityTaskScheduledEventAttributes!.startToCloseTimeout)).to.equal(30_000);
    });

    it('runs operations as local activities when localActivityOptions is set', async function () {
      const { result, handle, workflowId } = await execute('localActivities');
      const events = await historyEvents(handle);
      expect(scheduledEvents(events)).to.have.length(0);
      expect(events.filter((event) => event.eventType === EventType.EVENT_TYPE_MARKER_RECORDED)).to.have.length(2);
      expect(callsFor(workflowId).map(({ name, isLocal }) => [name, isLocal])).to.deep.equal([
        [ActivityNames.publish, true],
        [ActivityNames.time, true],
      ]);
      const [input] = inputsFor(workflowId, ActivityNames.publish);
      expect(result).to.deep.equal({ publish: { serials: [input.messages[0].id] }, time: 1234567890 });
    });

    it('fails the workflow task when both activityOptions and localActivityOptions are set', async function () {
      const { handle } = await start('bothOptions');
      let failure: temporal.api.failure.v1.IFailure | null | undefined;
      for (let attempt = 0; attempt < 100 && !failure; attempt++) {
        const failed = (await historyEvents(handle)).find(
          (event) => event.eventType === EventType.EVENT_TYPE_WORKFLOW_TASK_FAILED,
        );
        failure = failed?.workflowTaskFailedEventAttributes?.failure;
        if (!failure) {
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }
      await handle.terminate();
      expect(failure?.message).to.equal(
        'TemporalRestOptions cannot set both activityOptions and localActivityOptions. Set localActivityOptions to run Ably operations as local activities, or activityOptions to run them as regular activities.',
      );
    });
  });

  describe('errors', function () {
    it('surfaces an Ably activity failure as an ActivityFailure with the Ably error details', async function () {
      const { result, workflowId } = await execute('activityFailure', false);
      expect(result).to.deep.equal({
        isApplicationFailure: false,
        isActivityFailure: true,
        message: 'Activity task failed',
        details: AUTH_ERROR_DETAILS,
      });
      expect(callsFor(workflowId)).to.have.length(1);

      const error = await executeExpectingFailure('activityFailure', true);
      expect(error.cause).to.be.an.instanceof(ActivityFailure);
      expect((error.cause as ActivityFailure).activityType).to.equal(ActivityNames.publish);
      expect(getAblyErrorDetails(error)).to.deep.equal(AUTH_ERROR_DETAILS);
    });
  });
});
