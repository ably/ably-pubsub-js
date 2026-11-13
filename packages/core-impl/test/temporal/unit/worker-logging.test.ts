import { expect } from 'chai';
import type { Info } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import { Ably, restoreAll } from '../../uts/helpers';
import type { PendingRequest } from '../../uts/mock_http';
import { createActivities } from '../../../src/platform/temporal/src/worker/activities';
import { toActivityFailure } from '../../../src/platform/temporal/src/worker/errors';
import { ActivityNames } from '../../../src/platform/temporal/src/common/activities';
import type { ActivityName } from '../../../src/platform/temporal/src/common/activities';
import { capturingActivityEnvironment, mockAbly, runActivity, toWire, workflowActivityInfo } from './worker-helpers';
import type { CapturingLogger, LogEntry } from './worker-helpers';

/** The attributes that Temporal adds to every line logged through the activity context. */
const TEMPORAL_ATTRIBUTES = new Set([
  'isLocal',
  'attempt',
  'namespace',
  'taskToken',
  'activityId',
  'activityType',
  'taskQueue',
  'workflowId',
  'workflowRunId',
  'workflowType',
  'activityRunId',
  'sdkComponent',
]);

/** The attributes of a line that the plugin set, without those that Temporal adds. */
function pluginAttributes(entry: LogEntry): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entry.meta).filter(([key]) => !TEMPORAL_ATTRIBUTES.has(key)));
}

/** The `Info` of an attempt of an activity first scheduled now, with a `startToCloseTimeout` of 30 seconds. */
function attemptInfo(activityType: ActivityName, attempt: number, overrides: Partial<Info> = {}): Partial<Info> {
  return {
    ...workflowActivityInfo,
    activityType,
    attempt,
    scheduledTimestampMs: Date.now(),
    startToCloseTimeoutMs: 30_000,
    ...overrides,
  };
}

const RETRY_WARNING = 'Ably: retrying a call that Ably applies again if an earlier attempt reached it';
const WINDOW_WARNING =
  "Ably: retrying a call after Ably's deduplication window, so Ably may apply it again if an earlier attempt reached it";
const PASS_THROUGH_WARNING =
  'Ably: passing an error that is not an Ably error to Temporal, which retries it according to the retry policy';
const SLOW_WARNING = 'Ably: call took more than half of the activity startToCloseTimeout';

function respondToEverything(req: PendingRequest): void {
  if (req.path === '/push/apnsBroadcastChannels') {
    req.respond_with(201, { id: 'b1', apnsChannelId: 'apns-1' });
  } else if (req.path.endsWith('/messages') && req.method === 'get') {
    req.respond_with(200, []);
  } else if (req.path === '/messages') {
    req.respond_with(201, [{ successCount: 1, failureCount: 0, results: [] }]);
  } else {
    req.respond_with(201, { serials: ['s0'], versionSerial: 'v1' });
  }
}

/**
 * Runs `activity` with `input` in an environment with `info`, with a client whose requests `handler` answers, and
 * returns the logger and any error the activity failed with. Each call replaces the mock HTTP client of the last.
 */
async function runLogged(
  activity: ActivityName,
  input: unknown,
  info: Partial<Info>,
  handler: (req: PendingRequest) => void = respondToEverything,
  options: { liveObjects?: boolean; refuseConnections?: boolean } = {},
): Promise<{ logger: CapturingLogger; error?: unknown }> {
  restoreAll();
  const { client } = mockAbly(handler, options);
  const activities = createActivities(client) as unknown as Record<string, (input: unknown) => Promise<unknown>>;
  const { env, logger } = capturingActivityEnvironment(info);
  try {
    await runActivity(env, activities[activity], input === undefined ? undefined : toWire(input));
    return { logger };
  } catch (error) {
    return { logger, error };
  }
}

describe('temporal/worker/logging', function () {
  afterEach(function () {
    restoreAll();
  });

  describe('retries that Ably applies again', function () {
    const notDeduplicated: [ActivityName, unknown][] = [
      [ActivityNames.appendMessage, { channel: 'chat', message: { serial: 's1', data: 'more' } }],
      [ActivityNames.pushPublish, { recipient: { clientId: 'user-1' }, payload: { notification: { title: 'Hi' } } }],
      [ActivityNames.pushCreateApnsBroadcast, { argument: { messageStoragePolicy: 1 } }],
      [
        ActivityNames.pushLiveActivityStart,
        { argument: { recipient: { deviceId: 'device-1' }, apnsBroadcast: 'b1', apns: { aps: {} } } },
      ],
      [ActivityNames.pushLiveActivityUpdate, { argument: { apnsBroadcast: 'b1', apns: { aps: {} } } }],
      [ActivityNames.request, { method: 'POST', path: '/custom', version: 3, body: { a: 1 } }],
      [ActivityNames.request, { method: 'delete', path: '/custom', version: 3 }],
    ];

    for (const [activity, input] of notDeduplicated) {
      it(`warns on a retry of ${activity}${activity === ActivityNames.request ? ` ${(input as any).method}` : ''}`, async function () {
        const { logger } = await runLogged(activity, input, attemptInfo(activity, 2));

        const warnings = logger.ablyEntries.filter((entry) => entry.message === RETRY_WARNING);
        expect(warnings).to.have.length(1);
        expect(warnings[0].level).to.equal('WARN');
        expect(pluginAttributes(warnings[0])).to.deep.equal({
          operation: activity,
          reason: 'not deduplicated by Ably',
        });
      });
    }

    const withoutIds: [string, ActivityName, unknown][] = [
      ['a publish without message IDs', ActivityNames.publish, { channel: 'chat', messages: [{ name: 'e' }] }],
      [
        'a publish in which only some messages have IDs',
        ActivityNames.publish,
        { channel: 'chat', messages: [{ id: 'k:0', name: 'e' }, { name: 'f' }] },
      ],
      [
        'a batchPublish with a spec without message IDs',
        ActivityNames.batchPublish,
        {
          specs: [
            { channels: ['a'], messages: [{ id: 'k:0', name: 'e' }] },
            { channels: ['b'], messages: { name: 'f' } },
          ],
        },
      ],
      [
        'an update without an idempotencyKey',
        ActivityNames.updateMessage,
        { channel: 'chat', message: { serial: 's1', data: 'new' } },
      ],
      [
        'a delete without an idempotencyKey',
        ActivityNames.deleteMessage,
        { channel: 'chat', message: { serial: 's1' }, options: {} },
      ],
      [
        'an annotation without an ID',
        ActivityNames.annotationsPublish,
        { channel: 'chat', messageOrSerial: 's1', annotation: { type: 'reaction:unique.v1' } },
      ],
      [
        'an annotation delete without an ID',
        ActivityNames.annotationsDelete,
        { channel: 'chat', messageOrSerial: 's1', annotation: { type: 'reaction:unique.v1' } },
      ],
    ];

    for (const [description, activity, input] of withoutIds) {
      it(`warns on a retry of ${description}`, async function () {
        const { logger } = await runLogged(activity, input, attemptInfo(activity, 2));

        const warnings = logger.ablyEntries.filter((entry) => entry.message === RETRY_WARNING);
        expect(warnings).to.have.length(1);
        expect(pluginAttributes(warnings[0])).to.deep.equal({
          operation: activity,
          reason: 'no message IDs or idempotencyKey',
        });
      });
    }

    it('warns on a retry of a LiveObjects publish without operation IDs', async function () {
      const { logger } = await runLogged(
        ActivityNames.objectPublish,
        { channel: 'chat', operations: [{ path: 'votes', counterInc: { number: 1 } }] },
        attemptInfo(ActivityNames.objectPublish, 2),
        (req) => req.respond_with(200, { messageId: 'm', channel: 'chat', objectIds: [] }),
        { liveObjects: true },
      );

      const warnings = logger.ablyEntries.filter((entry) => entry.message === RETRY_WARNING);
      expect(warnings.map(pluginAttributes)).to.deep.equal([
        { operation: ActivityNames.objectPublish, reason: 'no message IDs or idempotencyKey' },
      ]);
    });

    it('does not warn on the first attempt', async function () {
      const { logger } = await runLogged(
        ActivityNames.appendMessage,
        { channel: 'chat', message: { serial: 's1', data: 'more' } },
        attemptInfo(ActivityNames.appendMessage, 1),
      );

      expect(logger.ablyEntries).to.deep.equal([]);
    });

    const deduplicatedOrIdempotent: [string, ActivityName, unknown][] = [
      [
        'a publish whose messages all have IDs',
        ActivityNames.publish,
        { channel: 'chat', messages: [{ id: 'k:0', name: 'e' }] },
      ],
      [
        'an update with an idempotencyKey',
        ActivityNames.updateMessage,
        { channel: 'chat', message: { serial: 's1' }, options: { idempotencyKey: 'key-1' } },
      ],
      [
        'an annotation with an ID',
        ActivityNames.annotationsPublish,
        { channel: 'chat', messageOrSerial: 's1', annotation: { id: 'k:0', type: 'reaction:unique.v1' } },
      ],
      [
        'a batchPublish whose messages all have IDs',
        ActivityNames.batchPublish,
        { specs: { channels: ['a'], messages: [{ id: 'k:0', name: 'e' }] } },
      ],
      ['a read', ActivityNames.history, { channel: 'chat' }],
      ['a GET request', ActivityNames.request, { method: 'get', path: '/custom', version: 3 }],
      ['a live activity end', ActivityNames.pushLiveActivityEnd, { argument: { apnsBroadcast: 'b1', apns: {} } }],
    ];

    for (const [description, activity, input] of deduplicatedOrIdempotent) {
      it(`does not warn on a retry of ${description} within the deduplication window`, async function () {
        const { logger } = await runLogged(
          activity,
          input,
          attemptInfo(activity, 2, { scheduledTimestampMs: Date.now() - 60_000 }),
        );

        expect(logger.ablyEntries.filter((entry) => entry.level === 'WARN')).to.deep.equal([]);
      });
    }
  });

  describe('retries after the deduplication window', function () {
    it('warns on a retry of a deduplicated call more than 2 minutes after it was first scheduled', async function () {
      const { logger } = await runLogged(
        ActivityNames.publish,
        { channel: 'chat', messages: [{ id: 'k:0', name: 'e' }] },
        attemptInfo(ActivityNames.publish, 4, { scheduledTimestampMs: Date.now() - 125_000 }),
      );

      const warnings = logger.ablyEntries.filter((entry) => entry.message === WINDOW_WARNING);
      expect(warnings).to.have.length(1);
      expect(warnings[0].level).to.equal('WARN');
      const attributes = pluginAttributes(warnings[0]);
      expect(attributes).to.have.keys('elapsedMs', 'deduplicationWindowMs');
      expect(attributes.deduplicationWindowMs).to.equal(120_000);
      expect(attributes.elapsedMs).to.be.within(125_000, 135_000);
    });

    it('warns once with the reason for a call that Ably does not deduplicate at all', async function () {
      const { logger } = await runLogged(
        ActivityNames.appendMessage,
        { channel: 'chat', message: { serial: 's1', data: 'more' } },
        attemptInfo(ActivityNames.appendMessage, 4, { scheduledTimestampMs: Date.now() - 125_000 }),
      );

      expect(logger.ablyEntries.map((entry) => entry.message)).to.deep.equal([RETRY_WARNING]);
    });

    for (const [description, activity, input] of [
      ['a read', ActivityNames.history, { channel: 'chat' }],
      ['a device registration save', ActivityNames.pushDeviceRegistrationsSave, { argument: { id: 'device-1' } }],
    ] as const) {
      it(`does not warn on a late retry of ${description}`, async function () {
        const { logger } = await runLogged(
          activity,
          input,
          attemptInfo(activity, 4, { scheduledTimestampMs: Date.now() - 125_000 }),
          (req) => req.respond_with(200, req.method === 'get' ? [] : { id: 'device-1' }),
        );

        expect(logger.ablyEntries).to.deep.equal([]);
      });
    }

    it('does not warn on the first attempt, however late', async function () {
      const { logger } = await runLogged(
        ActivityNames.publish,
        { channel: 'chat', messages: [{ id: 'k:0', name: 'e' }] },
        attemptInfo(ActivityNames.publish, 1, { scheduledTimestampMs: Date.now() - 125_000 }),
      );

      expect(logger.ablyEntries).to.deep.equal([]);
    });
  });

  describe('errors that are not Ably errors', function () {
    it('warns once, on the first attempt, with the error name and message', async function () {
      const first = await runLogged(
        ActivityNames.time,
        undefined,
        attemptInfo(ActivityNames.time, 1),
        () => undefined,
        {
          refuseConnections: true,
        },
      );
      const second = await runLogged(
        ActivityNames.time,
        undefined,
        attemptInfo(ActivityNames.time, 2),
        () => undefined,
        {
          refuseConnections: true,
        },
      );

      expect(first.error).to.not.be.instanceOf(ApplicationFailure);
      const warnings = first.logger.ablyEntries.filter((entry) => entry.message === PASS_THROUGH_WARNING);
      expect(warnings).to.have.length(1);
      expect(warnings[0].level).to.equal('WARN');
      // The mock HTTP client fails with a plain object with a string `code`, where Node.js fails with an `Error`.
      expect(first.error).to.include({ code: 'ECONNREFUSED' });
      expect(pluginAttributes(warnings[0])).to.deep.equal({
        errorName: 'object',
        errorMessage: 'Connection refused',
        retriedByTemporal: true,
      });
      expect(second.error).to.not.be.instanceOf(ApplicationFailure);
      expect(second.logger.ablyEntries.filter((entry) => entry.message === PASS_THROUGH_WARNING)).to.deep.equal([]);
    });

    it('does not include the stack', async function () {
      const { env, logger } = capturingActivityEnvironment(attemptInfo(ActivityNames.time, 1));
      const err = new TypeError('Cannot read properties of undefined');

      await env.run(async () => toActivityFailure(err));

      expect(pluginAttributes(logger.ablyEntries[0])).to.deep.equal({
        errorName: 'TypeError',
        errorMessage: 'Cannot read properties of undefined',
        retriedByTemporal: true,
      });
      expect(JSON.stringify(logger.ablyEntries)).to.not.include(err.stack!.split('\n')[1].trim());
    });

    it('logs only the type of a thrown value that is not an Error and has no message', async function () {
      const { env, logger } = capturingActivityEnvironment(attemptInfo(ActivityNames.time, 1));

      await env.run(async () => toActivityFailure({ token: 'secret-token' }));

      expect(logger.ablyEntries.map(pluginAttributes)).to.deep.equal([
        { errorName: 'object', retriedByTemporal: true },
      ]);
    });

    it('does not warn of a Temporal failure', async function () {
      const { env, logger } = capturingActivityEnvironment(attemptInfo(ActivityNames.time, 1));

      await env.run(async () => toActivityFailure(ApplicationFailure.nonRetryable('stop')));

      expect(logger.ablyEntries).to.deep.equal([]);
    });

    it('does not log or throw outside an activity', function () {
      const err = new TypeError('oops');

      expect(toActivityFailure(err)).to.equal(err);
      expect((toActivityFailure(new Ably.ErrorInfo('Bad', 40000, 400)) as ApplicationFailure).nonRetryable).to.equal(
        true,
      );
    });
  });

  describe('Ably error classification', function () {
    const cases: { code: number; statusCode: number | undefined; rule: string; retryable: boolean }[] = [
      { code: 50000, statusCode: 500, rule: '5xx', retryable: true },
      { code: 50003, statusCode: 503, rule: '5xx', retryable: true },
      { code: 40800, statusCode: 408, rule: '408', retryable: true },
      { code: 42910, statusCode: 429, rule: '429', retryable: true },
      { code: 80000, statusCode: undefined, rule: 'noStatus', retryable: true },
      { code: 40170, statusCode: 401, rule: '40170', retryable: true },
      { code: 40160, statusCode: 401, rule: '4xx', retryable: false },
      { code: 40400, statusCode: 404, rule: '4xx', retryable: false },
    ];

    for (const { code, statusCode, rule, retryable } of cases) {
      it(`logs the ${rule} rule for code ${code} with status ${statusCode} at DEBUG`, async function () {
        const { env, logger } = capturingActivityEnvironment(attemptInfo(ActivityNames.publish, 1));
        const err = new Ably.ErrorInfo('Secret detail in message', code as any, statusCode as any, undefined, {
          field: 'secret-detail',
        });

        const result: unknown = await env.run(async () => toActivityFailure(err));
        const failure = result as ApplicationFailure;

        expect(failure.nonRetryable).to.equal(!retryable);
        expect(logger.ablyEntries).to.have.length(1);
        expect(logger.ablyEntries[0].level).to.equal('DEBUG');
        expect(pluginAttributes(logger.ablyEntries[0])).to.deep.equal({
          code,
          ...(statusCode === undefined ? {} : { statusCode }),
          retryable,
          rule,
        });
        expect(JSON.stringify(logger.ablyEntries)).to.not.include('secret');
      });
    }

    it('omits the code of an error response without an Ably error code', async function () {
      const { env, logger } = capturingActivityEnvironment(attemptInfo(ActivityNames.publish, 1));

      await env.run(async () => toActivityFailure(new Ably.ErrorInfo('Bad Gateway', NaN as any, 502)));

      expect(pluginAttributes(logger.ablyEntries[0])).to.deep.equal({
        statusCode: 502,
        retryable: true,
        rule: '5xx',
      });
    });

    it('logs the classification of an error response to an activity', async function () {
      const { logger } = await runLogged(
        ActivityNames.history,
        { channel: 'chat' },
        attemptInfo(ActivityNames.history, 1),
        (req) => req.respond_with(503, { error: { message: 'Try again', code: 50300, statusCode: 503 } }),
      );

      expect(logger.ablyEntries.map((entry) => [entry.level, pluginAttributes(entry)])).to.deep.equal([
        ['DEBUG', { code: 50300, statusCode: 503, retryable: true, rule: '5xx' }],
      ]);
    });
  });

  describe('request', function () {
    it('logs an unsuccessful response at DEBUG without the path, params, headers or body', async function () {
      const { logger } = await runLogged(
        ActivityNames.request,
        {
          method: 'GET',
          path: '/secret-path/user-42',
          version: 3,
          params: { clientId: 'secret-client' },
          headers: { 'X-Secret': 'secret-header' },
        },
        attemptInfo(ActivityNames.request, 1),
        (req) => req.respond_with(404, { error: { message: 'Not found: secret-path', code: 40400, statusCode: 404 } }),
      );

      expect(logger.ablyEntries.map((entry) => [entry.level, pluginAttributes(entry)])).to.deep.equal([
        ['DEBUG', { method: 'GET', statusCode: 404, errorCode: 40400 }],
      ]);
      expect(JSON.stringify(logger.ablyEntries)).to.not.include('secret');
    });

    it('does not log a successful response', async function () {
      const { logger } = await runLogged(
        ActivityNames.request,
        { method: 'GET', path: '/custom', version: 3 },
        attemptInfo(ActivityNames.request, 1),
        (req) => req.respond_with(200, []),
      );

      expect(logger.ablyEntries).to.deep.equal([]);
    });
  });

  describe('batch calls', function () {
    const failure = (channel: string, code: number) => ({
      channel,
      error: { message: `Failed on ${channel}`, code, statusCode: Math.floor(code / 100) },
    });

    it('logs the counts and distinct error codes of a partly failed batchPublish at DEBUG', async function () {
      const { logger } = await runLogged(
        ActivityNames.batchPublish,
        {
          specs: [
            { channels: ['secret-a', 'secret-b'], messages: [{ id: 'k:0', name: 'e' }] },
            { channels: ['secret-c', 'secret-d'], messages: [{ id: 'j:0', name: 'f' }] },
          ],
        },
        attemptInfo(ActivityNames.batchPublish, 1),
        (req) =>
          req.respond_with(201, [
            {
              successCount: 1,
              failureCount: 1,
              results: [{ channel: 'secret-a', messageId: 'k:0' }, failure('secret-b', 40160)],
            },
            { successCount: 0, failureCount: 2, results: [failure('secret-c', 40160), failure('secret-d', 40000)] },
          ]),
      );

      expect(logger.ablyEntries.map((entry) => [entry.level, pluginAttributes(entry)])).to.deep.equal([
        ['DEBUG', { successCount: 1, failureCount: 3, errorCodes: [40000, 40160] }],
      ]);
      expect(JSON.stringify(logger.ablyEntries)).to.not.include('secret');
    });

    it('logs a partly failed batchPublish of a single spec', async function () {
      const { logger } = await runLogged(
        ActivityNames.batchPublish,
        { specs: { channels: ['a', 'b'], messages: [{ id: 'k:0', name: 'e' }] } },
        attemptInfo(ActivityNames.batchPublish, 1),
        (req) =>
          req.respond_with(201, [
            { successCount: 1, failureCount: 1, results: [{ channel: 'a', messageId: 'k:0' }, failure('b', 40300)] },
          ]),
      );

      expect(logger.ablyEntries.map(pluginAttributes)).to.deep.equal([
        { successCount: 1, failureCount: 1, errorCodes: [40300] },
      ]);
    });

    it('logs a partly failed batchPresence', async function () {
      const { logger } = await runLogged(
        ActivityNames.batchPresence,
        { channels: ['secret-a', 'secret-b'] },
        attemptInfo(ActivityNames.batchPresence, 1),
        (req) =>
          req.respond_with(200, [
            {
              successCount: 1,
              failureCount: 1,
              results: [
                { channel: 'secret-a', presence: [{ clientId: 'secret-client', data: 'secret-data' }] },
                failure('secret-b', 40160),
              ],
            },
          ]),
      );

      expect(logger.ablyEntries.map((entry) => [entry.level, pluginAttributes(entry)])).to.deep.equal([
        ['DEBUG', { successCount: 1, failureCount: 1, errorCodes: [40160] }],
      ]);
      expect(JSON.stringify(logger.ablyEntries)).to.not.include('secret');
    });

    it('does not log a batch call in which every channel succeeded', async function () {
      const { logger } = await runLogged(
        ActivityNames.batchPresence,
        { channels: ['a'] },
        attemptInfo(ActivityNames.batchPresence, 1),
        (req) =>
          req.respond_with(200, [{ successCount: 1, failureCount: 0, results: [{ channel: 'a', presence: [] }] }]),
      );

      expect(logger.ablyEntries).to.deep.equal([]);
    });
  });

  describe('slow calls', function () {
    const delayed =
      (ms: number, respond: (req: PendingRequest) => void) =>
      (req: PendingRequest): void => {
        setTimeout(() => respond(req), ms);
      };

    it('warns when a call takes more than half of startToCloseTimeout', async function () {
      const { logger } = await runLogged(
        ActivityNames.history,
        { channel: 'chat' },
        attemptInfo(ActivityNames.history, 1, { startToCloseTimeoutMs: 100 }),
        delayed(80, (req) => req.respond_with(200, [])),
      );

      const warnings = logger.ablyEntries.filter((entry) => entry.message === SLOW_WARNING);
      expect(warnings).to.have.length(1);
      expect(warnings[0].level).to.equal('WARN');
      const attributes = pluginAttributes(warnings[0]);
      expect(attributes).to.have.keys('durationMs', 'startToCloseTimeoutMs');
      expect(attributes.startToCloseTimeoutMs).to.equal(100);
      expect(attributes.durationMs).to.be.greaterThan(50);
    });

    it('warns when a slow call fails', async function () {
      const { logger, error } = await runLogged(
        ActivityNames.history,
        { channel: 'chat' },
        attemptInfo(ActivityNames.history, 1, { startToCloseTimeoutMs: 100 }),
        delayed(80, (req) => req.respond_with(400, { error: { message: 'Bad', code: 40000, statusCode: 400 } })),
      );

      expect(error).to.be.instanceOf(ApplicationFailure);
      expect(logger.ablyEntries.filter((entry) => entry.message === SLOW_WARNING)).to.have.length(1);
    });

    it('does not warn when a call takes less than half of startToCloseTimeout', async function () {
      const { logger } = await runLogged(
        ActivityNames.history,
        { channel: 'chat' },
        attemptInfo(ActivityNames.history, 1, { startToCloseTimeoutMs: 10_000 }),
        delayed(20, (req) => req.respond_with(200, [])),
      );

      expect(logger.ablyEntries).to.deep.equal([]);
    });

    it('does not warn when startToCloseTimeout is not set', async function () {
      const { logger } = await runLogged(
        ActivityNames.history,
        { channel: 'chat' },
        attemptInfo(ActivityNames.history, 1, { startToCloseTimeoutMs: 0 }),
        delayed(20, (req) => req.respond_with(200, [])),
      );

      expect(logger.ablyEntries).to.deep.equal([]);
    });
  });

  describe('sensitive values', function () {
    it('logs no credentials, IDs, keys, payloads, clientIds or channel names', async function () {
      const late = (activity: ActivityName, attempt = 2) =>
        attemptInfo(activity, attempt, { scheduledTimestampMs: Date.now() - 125_000, startToCloseTimeoutMs: 1 });
      const delayed = (req: PendingRequest) =>
        setTimeout(
          () => req.respond_with(500, { error: { message: 'secret-error-message', code: 50000, statusCode: 500 } }),
          5,
        );
      const loggers: CapturingLogger[] = [];
      for (const [activity, input] of [
        [
          ActivityNames.publish,
          {
            channel: 'secret-channel',
            messages: [
              {
                id: 'secret-id:0',
                name: 'secret-name',
                clientId: 'secret-client',
                data: 'secret-data',
                extras: { headers: { secret: 'secret-extras' } },
              },
            ],
          },
        ],
        [ActivityNames.publish, { channel: 'secret-channel', messages: [{ data: 'secret-data' }] }],
        [
          ActivityNames.updateMessage,
          {
            channel: 'secret-channel',
            message: { serial: 'secret-serial', data: 'secret-data' },
            options: { idempotencyKey: 'secret-key' },
          },
        ],
        [
          ActivityNames.annotationsPublish,
          {
            channel: 'secret-channel',
            messageOrSerial: 'secret-serial',
            annotation: { id: 'secret-id:0', type: 'reaction:secret.v1', data: 'secret-data' },
          },
        ],
        [
          ActivityNames.pushPublish,
          { recipient: { clientId: 'secret-client' }, payload: { notification: { title: 'secret-title' } } },
        ],
        [
          ActivityNames.request,
          {
            method: 'POST',
            path: '/secret-path',
            version: 3,
            params: { secret: 'secret-param' },
            body: { secret: 'secret-body' },
            headers: { 'X-Secret': 'secret-header' },
          },
        ],
      ] as [ActivityName, unknown][]) {
        for (const attempt of [1, 2]) {
          loggers.push((await runLogged(activity, input, late(activity, attempt), delayed)).logger);
        }
      }

      const entries = loggers.flatMap((logger) => logger.ablyEntries);
      expect(entries.map((entry) => entry.message)).to.include.members([
        RETRY_WARNING,
        WINDOW_WARNING,
        SLOW_WARNING,
        'Ably: classified the Ably error as retryable',
      ]);
      const logged = JSON.stringify(entries.map(pluginAttributes)) + JSON.stringify(entries.map((e) => e.message));
      expect(logged).to.not.include('secret');
      expect(logged).to.not.include('keySecret');
      expect(logged).to.not.include('appId.keyId');
    });
  });
});
