// End-to-end tests of the built plugin on a local Temporal server. The workflows in ./workflows/e2e.ts import the
// built `@ably/pubsub-server/temporal/workflow`, and run on workers that use the built `AblyHttpPlugin` from `@ably/pubsub-server/temporal`. Each
// plugin is given an Ably HTTP client built from source, with the UTS mock HTTP client installed, so that the real
// ably-js request pipeline runs and the tests can inspect every HTTP request it makes.
//
// Run `npm run build:node && npm run build:liveobjects && npm run build:temporal` first.

import { randomUUID } from 'crypto';
import * as path from 'path';
import msgpack from '@ably/msgpack-js';
import { WorkflowFailedError, type WorkflowHandleWithFirstExecutionRunId } from '@temporalio/client';
import { ActivityFailure, ApplicationFailure, defaultPayloadConverter } from '@temporalio/common';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import {
  bundleWorkflowCode,
  DefaultLogger,
  Worker,
  type InjectedSinks,
  type WorkflowBundleWithSourceMap,
} from '@temporalio/worker';
import type * as AblyTypes from '@ably/pubsub-server';
import { AblyHttpPlugin, getAblyErrorDetails, TemporalMetadataKeys } from '@ably/pubsub-server/temporal';
import { expect } from 'chai';
import { Ably, installMockHttp, restoreAll } from '../../uts/helpers';
import { MockHttpClient, type PendingRequest } from '../../uts/mock_http';
import * as LiveObjectsPlugin from '../../../src/plugins/liveobjects';
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
import type { CapturedError } from './workflows/e2e';
import type { RecorderSinks } from './workflows/interceptors';

const JSON_QUEUE = 'ably-temporal-e2e-json';
const MSGPACK_QUEUE = 'ably-temporal-e2e-msgpack';

/** Responds to a request made on a channel. `count` is the number of requests on that channel so far, this included. */
type Responder = (req: PendingRequest, count: number) => void;

interface ScheduledActivity {
  phase: 'run' | 'replay';
  workflowId: string;
  activityType: string;
  args: unknown[];
  local: boolean;
}

const requests: PendingRequest[] = [];
const responders = new Map<string, Responder>();
const scheduledActivities: ScheduledActivity[] = [];
let recordingPhase: ScheduledActivity['phase'] = 'run';

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

function channelOf(req: PendingRequest): string | undefined {
  const match = /^\/channels\/([^/]+)/.exec(req.path);
  return match ? decodeURIComponent(match[1]) : undefined;
}

function requestsFor(channel: string): PendingRequest[] {
  return requests.filter((req) => channelOf(req) === channel);
}

function handleRequest(req: PendingRequest): void {
  requests.push(req);
  const channel = channelOf(req);
  const responder = channel === undefined ? undefined : responders.get(channel);
  if (!responder) {
    req.respond_with(404, {
      error: { code: 40400, statusCode: 404, message: `No responder for ${req.method} ${req.url.href}` },
    });
    return;
  }
  responder(req, requestsFor(channel!).length);
}

function isMsgpack(req: PendingRequest): boolean {
  return /msgpack/.test(req.headers.accept ?? req.headers.Accept ?? '');
}

/** Responds with `body` encoded in the protocol of the request. */
function reply(req: PendingRequest, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (!isMsgpack(req)) {
    req.respond_with(status, body, headers);
    return;
  }
  req._resolve!({ error: null, body: msgpack.encode(body) as any, headers, unpacked: false, statusCode: status });
}

/** Decodes the body of a request in the protocol it was sent with. */
function bodyOf(req: PendingRequest): any {
  return isMsgpack(req) ? msgpack.decode(req.body) : JSON.parse(req.body);
}

function queryOf(req: PendingRequest): Record<string, string> {
  return Object.fromEntries(req.url.searchParams.entries());
}

function uniqueChannel(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

/** Responds to the first request with a 500 error, which ably-js does not retry because the client has no fallback hosts. */
const serverErrorOnce =
  (then: Responder): Responder =>
  (req, count) =>
    count === 1
      ? req.respond_with(500, { error: { code: 50000, statusCode: 500, message: 'Internal error' } })
      : then(req, count);

/** An HTTP client built from source, which sends its requests through the installed mock HTTP client. */
function restClient(options: { useBinaryProtocol: boolean; liveObjects?: boolean }): AblyTypes.PubSubHttpClient {
  const client = new Ably.Http({
    key: 'appId.keyId:keySecret',
    logLevel: 0,
    useBinaryProtocol: options.useBinaryProtocol,
    // Without fallback hosts, ably-js makes a single request for each operation, so a 5xx response fails the
    // activity rather than being retried on another host.
    fallbackHosts: [],
    ...(options.liveObjects ? { plugins: { LiveObjects: LiveObjectsPlugin } } : {}),
  });
  return client as unknown as AblyTypes.PubSubHttpClient;
}

describe('temporal end to end', function () {
  this.timeout(180_000);

  let env: TestWorkflowEnvironment;
  let namespace: string;
  let workflowBundle: WorkflowBundleWithSourceMap;
  let jsonPlugin: AblyHttpPlugin;
  const workers: Worker[] = [];
  const workerRuns: Promise<void>[] = [];

  before(async function () {
    installTestRuntime();
    installMockHttp(
      new MockHttpClient({ onConnectionAttempt: (conn) => conn.respond_with_success(), onRequest: handleRequest }),
    );
    jsonPlugin = new AblyHttpPlugin({ client: restClient({ useBinaryProtocol: false, liveObjects: true }) });
    const msgpackPlugin = new AblyHttpPlugin({ client: restClient({ useBinaryProtocol: true }) });

    env = await TestWorkflowEnvironment.createLocal();
    namespace = env.namespace ?? 'default';
    workflowBundle = await bundleWorkflowCode({
      workflowsPath: path.join(__dirname, 'workflows', 'e2e.ts'),
      workflowInterceptorModules: [path.join(__dirname, 'workflows', 'interceptors.ts')],
      logger: new DefaultLogger('WARN'),
    });
    for (const [taskQueue, plugin] of [
      [JSON_QUEUE, jsonPlugin],
      [MSGPACK_QUEUE, msgpackPlugin],
    ] as const) {
      const worker = await Worker.create({
        connection: env.nativeConnection,
        namespace,
        taskQueue,
        workflowBundle,
        sinks,
        plugins: [plugin],
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
      restoreAll();
    }
  });

  afterEach(function () {
    responders.clear();
  });

  async function start(taskQueue: string, workflow: string, ...args: unknown[]) {
    return env.client.workflow.start(workflow, {
      taskQueue,
      workflowId: `${workflow}-${randomUUID()}`,
      args,
      workflowExecutionTimeout: '60 seconds',
    });
  }

  async function execute(
    taskQueue: string,
    workflow: string,
    ...args: unknown[]
  ): Promise<{ result: any; handle: WorkflowHandleWithFirstExecutionRunId; events: HistoryEvent[] }> {
    const handle = await start(taskQueue, workflow, ...args);
    let result: unknown;
    try {
      result = await handle.result();
    } catch (err) {
      throw new Error(`Workflow ${workflow} failed: ${causeChain(err)}`);
    }
    return { result, handle, events: await historyEvents(handle) };
  }

  it('runs the built entry points of the plugin', function () {
    const serverDist = path.resolve(__dirname, '..', '..', '..', '..', 'server', 'dist');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const built = require(path.join(serverDist, 'temporal.js'));
    expect(AblyHttpPlugin).to.equal(built.AblyHttpPlugin);
    // The workflows import the built workflow entry point rather than the plugin's source, and it imports
    // nothing of the Ably runtime.
    expect(workflowBundle.code).to.include('"./packages/server/dist/temporal-workflow.mjs"');
    expect(workflowBundle.code).to.not.include('"./packages/core-impl/src/platform/temporal');
    expect(workflowBundle.code).to.not.match(/"\.\/packages\/(core\/|server\/dist\/(index|node)\.)/);
  });

  describe('publish', function () {
    it('publishes with generated IDs and the Temporal metadata of the activity in extras.headers', async function () {
      const channel = uniqueChannel('publish');
      responders.set(channel, (req) => req.respond_with(201, { serials: ['serial-0', 'serial-1'] }));

      const { result, handle, events } = await execute(JSON_QUEUE, 'e2ePublish', channel);

      expect(result).to.deep.equal({ serials: ['serial-0', 'serial-1'] });
      const [req, ...others] = requestsFor(channel);
      expect(others).to.have.length(0);
      expect(req.method).to.equal('post');
      expect(req.path).to.equal(`/channels/${channel}/messages`);

      const body = bodyOf(req);
      const ids = body.map((message: { id: string }) => message.id);
      expectGeneratedIds(ids);

      // The IDs on the wire are those the workflow scheduled the activity with.
      const [activity, ...otherActivities] = historyActivities(events);
      expect(otherActivities).to.have.length(0);
      expect(activity.activityType).to.equal('ably.channel.publish');
      expect(activity.attempt).to.equal(1);
      expect(activity.input.messages.map((message: { id: string }) => message.id)).to.deep.equal(ids);

      const headers = expectedHeaders(namespace, handle.workflowId, events);
      expect(headers[TemporalMetadataKeys.runId]).to.equal(handle.firstExecutionRunId);
      expect(body).to.have.length(2);
      expect(body[0]).to.deep.include({
        id: ids[0],
        name: 'greeting',
        data: '{"text":"hello"}',
        encoding: 'json',
        extras: { headers },
      });
      expect(body[1]).to.deep.include({ id: ids[1], name: 'farewell', data: 'bye', extras: { headers } });
      expect(body[1]).to.not.have.property('encoding');
    });

    it('retries a 5xx error with the same message IDs and the same content', async function () {
      const channel = uniqueChannel('retry');
      responders.set(
        channel,
        serverErrorOnce((req) => req.respond_with(201, { serials: ['serial-0'] })),
      );

      const { result, handle, events } = await execute(JSON_QUEUE, 'e2eRetry', channel);

      expect(result).to.deep.equal({ serials: ['serial-0'] });
      const channelRequests = requestsFor(channel);
      expect(channelRequests, 'one request per activity attempt').to.have.length(2);
      const [first, second] = channelRequests.map((req) => bodyOf(req)[0]);
      expectGeneratedIds([first.id]);
      expect(second.id).to.equal(first.id);

      const [activity] = historyActivities(events);
      expect(activity.attempt).to.equal(2);
      expect(first.extras.headers).to.deep.equal(expectedHeaders(namespace, handle.workflowId, events));
      expect(second).to.deep.equal(first);
    });
  });

  describe('errors', function () {
    // The mock HTTP client reports an error response to ably-js as a plain object rather than an ErrorInfo, so the
    // error has no `href`. The sandbox tests cover a real ErrorInfo.
    const notPermitted = { code: 40160, statusCode: 401, message: 'Action not permitted' };

    it('does not retry a 4xx error, and the workflow can catch it with the Ably error details', async function () {
      const channel = uniqueChannel('forbidden');
      responders.set(channel, (req) => req.respond_with(401, { error: notPermitted }));

      const { result, events } = await execute(JSON_QUEUE, 'e2eAblyError', channel, false);

      expect(requestsFor(channel), 'the activity is attempted once').to.have.length(1);
      const captured = result as CapturedError;
      expect(captured).to.deep.include({
        isActivityFailure: true,
        causeIsApplicationFailure: true,
        causeType: 'AblyError',
        nonRetryable: true,
      });
      expect(captured.details).to.deep.equal(notPermitted);

      const [activity] = historyActivities(events);
      expect(activity.attempt).to.equal(1);
      const [failed] = eventsOfType(events, EventType.EVENT_TYPE_ACTIVITY_TASK_FAILED);
      expect(failed.activityTaskFailedEventAttributes!.retryState).to.equal(
        RetryState.RETRY_STATE_NON_RETRYABLE_FAILURE,
      );
    });

    it('fails the workflow, not the workflow task, when the error is not caught', async function () {
      const channel = uniqueChannel('forbidden-uncaught');
      responders.set(channel, (req) => req.respond_with(401, { error: notPermitted }));

      const handle = await start(JSON_QUEUE, 'e2eAblyError', channel, true);
      let caught: unknown;
      try {
        await handle.result();
      } catch (err) {
        caught = err;
      }

      expect(caught).to.be.an.instanceof(WorkflowFailedError);
      const activityFailure = (caught as WorkflowFailedError).cause;
      expect(activityFailure).to.be.an.instanceof(ActivityFailure);
      const applicationFailure = (activityFailure as ActivityFailure).cause;
      expect(applicationFailure).to.be.an.instanceof(ApplicationFailure);
      expect((applicationFailure as ApplicationFailure).type).to.equal('AblyError');
      expect((applicationFailure as ApplicationFailure).nonRetryable).to.equal(true);
      expect(getAblyErrorDetails(caught)).to.deep.equal(notPermitted);
      expect(requestsFor(channel)).to.have.length(1);

      const events = await historyEvents(handle);
      expect(eventsOfType(events, EventType.EVENT_TYPE_WORKFLOW_EXECUTION_FAILED)).to.have.length(1);
      expect(eventsOfType(events, EventType.EVENT_TYPE_WORKFLOW_TASK_FAILED)).to.have.length(0);
    });
  });

  describe('binary data', function () {
    it('publishes a Uint8Array as base64 with the JSON protocol, and returns binary history data as a Uint8Array', async function () {
      const channel = uniqueChannel('binary-json');
      responders.set(channel, (req) =>
        req.method === 'post'
          ? req.respond_with(201, { serials: ['serial-0'] })
          : req.respond_with(200, [
              { id: 'h:0', name: 'bytes', data: Buffer.from([9, 8, 7]).toString('base64'), encoding: 'base64' },
            ]),
      );

      const { result } = await execute(JSON_QUEUE, 'e2eBinary', channel);

      const [published] = bodyOf(requestsFor(channel)[0]);
      expect(published).to.include({ name: 'bytes', data: 'AAH+/w==', encoding: 'base64' });
      expect(result).to.deep.equal({
        published: { serials: ['serial-0'] },
        history: [{ isUint8Array: true, bytes: [9, 8, 7] }],
      });
    });

    it('publishes a Uint8Array as binary with the MessagePack protocol, and returns binary history data as a Uint8Array', async function () {
      const channel = uniqueChannel('binary-msgpack');
      responders.set(channel, (req) =>
        req.method === 'post'
          ? reply(req, 201, { serials: ['serial-0'] })
          : reply(req, 200, [{ id: 'h:0', name: 'bytes', data: Buffer.from([9, 8, 7]) }]),
      );

      const { result, handle, events } = await execute(MSGPACK_QUEUE, 'e2eBinary', channel);

      const [req] = requestsFor(channel);
      expect(isMsgpack(req)).to.equal(true);
      const [published] = bodyOf(req);
      expect(Buffer.isBuffer(published.data)).to.equal(true);
      expect(published.data).to.deep.equal(Buffer.from([0, 1, 254, 255]));
      expect(published).to.not.have.property('encoding');
      expect(published.extras.headers).to.deep.equal(expectedHeaders(namespace, handle.workflowId, events));
      expect(result).to.deep.equal({
        published: { serials: ['serial-0'] },
        history: [{ isUint8Array: true, bytes: [9, 8, 7] }],
      });
    });
  });

  describe('pagination', function () {
    it('fetches the next and first pages with the params from the Link header', async function () {
      const channel = uniqueChannel('pages');
      const first = '<./messages?limit=2&direction=backwards>; rel="first"';
      const current = '<./messages?limit=2&direction=backwards>; rel="current"';
      responders.set(channel, (req) =>
        queryOf(req).cursor === 'abc:1'
          ? req.respond_with(200, [{ id: 'm3' }], {
              Link: [first, '<./messages?limit=2&direction=backwards&cursor=abc%3A1>; rel="current"'].join(', '),
            })
          : req.respond_with(200, [{ id: 'm1' }, { id: 'm2' }], {
              Link: [first, current, '<./messages?limit=2&direction=backwards&cursor=abc%3A1>; rel="next"'].join(', '),
            }),
      );

      const { result } = await execute(JSON_QUEUE, 'e2ePagination', channel);

      expect(result).to.deep.equal({
        page1: { ids: ['m1', 'm2'], hasNext: true },
        page2: { ids: ['m3'], hasNext: false },
        page3: null,
        first: { ids: ['m1', 'm2'], hasNext: true },
      });
      const channelRequests = requestsFor(channel);
      expect(channelRequests.map((req) => req.method)).to.deep.equal(['get', 'get', 'get']);
      expect(channelRequests.map((req) => req.path)).to.deep.equal(
        channelRequests.map(() => `/channels/${channel}/messages`),
      );
      expect(channelRequests.map(queryOf)).to.deep.equal([
        { limit: '2', direction: 'backwards' },
        { limit: '2', direction: 'backwards', cursor: 'abc:1' },
        { limit: '2', direction: 'backwards' },
      ]);
    });
  });

  describe('message operations', function () {
    it('sends the Temporal metadata as string values in the operation metadata', async function () {
      const channel = uniqueChannel('operations');
      responders.set(channel, (req, count) => req.respond_with(200, { versionSerial: `version-${count}` }));

      const { result, handle, events } = await execute(JSON_QUEUE, 'e2eMessageOperations', channel);

      expect(result).to.deep.equal({ update: { versionSerial: 'version-1' }, append: { versionSerial: 'version-2' } });
      const [update, append] = requestsFor(channel);
      for (const req of [update, append]) {
        expect(req.method).to.equal('patch');
        expect(req.path).to.equal(`/channels/${channel}/messages/serial-1`);
      }
      // The action is sent as its numeric wire value: 1 is message.update and 5 is message.append.
      expect(bodyOf(update)).to.deep.equal({
        serial: 'serial-1',
        data: 'updated',
        action: 1,
        version: {
          description: 'edit',
          metadata: {
            ...expectedOperationMetadata(namespace, handle.workflowId, events),
            reason: 'typo',
          },
        },
      });
      expect(bodyOf(append)).to.deep.equal({
        serial: 'serial-1',
        data: ' more',
        action: 5,
        version: { metadata: expectedOperationMetadata(namespace, handle.workflowId, events) },
      });
    });
  });

  describe('local activities', function () {
    it('publishes from a local activity with the Temporal metadata, retrying with the same IDs and content', async function () {
      const channel = uniqueChannel('local');
      responders.set(
        channel,
        serverErrorOnce((req) => req.respond_with(201, { serials: ['serial-0'] })),
      );

      const { result, handle, events } = await execute(JSON_QUEUE, 'e2eLocalActivity', channel);

      expect(result).to.deep.equal({ serials: ['serial-0'] });
      expect(eventsOfType(events, EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED)).to.have.length(0);
      const markers = eventsOfType(events, EventType.EVENT_TYPE_MARKER_RECORDED).map(
        (event) => event.markerRecordedEventAttributes!,
      );
      expect(markers).to.have.length(1);
      expect(markers[0].markerName).to.equal('core_local_activity');
      const marker = defaultPayloadConverter.fromPayload<{
        activity_id: string;
        activity_type: string;
        attempt: number;
      }>(markers[0].details!.data.payloads![0]);
      expect(marker).to.include({ activity_type: 'ably.channel.publish', attempt: 2 });

      const [first, second] = requestsFor(channel).map((req) => bodyOf(req)[0]);
      expect(requestsFor(channel)).to.have.length(2);
      expectGeneratedIds([first.id]);
      expect(second.id).to.equal(first.id);
      expect(first.extras.headers).to.deep.equal(expectedHeaders(namespace, handle.workflowId, events));
      expect(second).to.deep.equal(first);
    });
  });

  describe('replay', function () {
    it('replays the history with the plugin without making any requests', async function () {
      const channel = uniqueChannel('replay');
      responders.set(channel, (req, count) =>
        req.method === 'post'
          ? req.respond_with(201, { serials: [`serial-${count}`] })
          : req.respond_with(200, [{ id: 'h:0', name: 'one', data: 'first' }]),
      );

      const { handle } = await execute(JSON_QUEUE, 'e2eReplay', channel);
      const workflowId = handle.workflowId;
      const original = scheduledActivities.filter((call) => call.workflowId === workflowId);
      expect(original.map((call) => call.activityType)).to.deep.equal([
        'ably.channel.publish',
        'ably.channel.history',
        'ably.channel.publish',
      ]);
      const requestCount = requests.length;
      expect(requestsFor(channel)).to.have.length(3);

      const history = await handle.fetchHistory();
      recordingPhase = 'replay';
      try {
        await Worker.runReplayHistory({ workflowBundle, sinks, plugins: [jsonPlugin] }, history, workflowId);
      } finally {
        recordingPhase = 'run';
      }

      expect(requests, 'replay makes no requests').to.have.length(requestCount);
      const replayed = scheduledActivities.filter((call) => call.workflowId === workflowId && call.phase === 'replay');
      expect(replayed).to.deep.equal(original.map((call) => ({ ...call, phase: 'replay' })));
    });
  });

  describe('LiveObjects', function () {
    it('publishes object operations with generated IDs', async function () {
      const channel = uniqueChannel('objects');
      responders.set(channel, (req) =>
        req.respond_with(201, { messageId: 'message-1', channel, objectIds: ['counter:1', 'counter:2'] }),
      );

      const { result, events } = await execute(JSON_QUEUE, 'e2eObjectPublish', channel);

      expect(result).to.deep.equal({ messageId: 'message-1', channel, objectIds: ['counter:1', 'counter:2'] });
      const [req] = requestsFor(channel);
      expect(req.method).to.equal('post');
      expect(req.path).to.equal(`/channels/${channel}/object`);
      const operations = bodyOf(req);
      const ids = operations.map((operation: { id: string }) => operation.id);
      expectGeneratedIds(ids);
      const [activity] = historyActivities(events);
      expect(activity.input.operations.map((operation: { id: string }) => operation.id)).to.deep.equal(ids);
      expect(operations.map((operation: { objectId: string }) => operation.objectId)).to.deep.equal([
        'counter:1',
        'counter:2',
      ]);
    });
  });
});
