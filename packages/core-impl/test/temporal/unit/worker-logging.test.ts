import { expect } from 'chai';
import type { Info } from '@temporalio/activity';
import { Ably, restoreAll } from '../../uts/helpers';
import type { PendingRequest } from '../../uts/mock_http';
import { createActivities } from '../../../src/platform/temporal/src/worker/activities';
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

/** The `Info` of an attempt of an activity first scheduled now. */
function attemptInfo(activityType: ActivityName, attempt: number, overrides: Partial<Info> = {}): Partial<Info> {
  return {
    ...workflowActivityInfo,
    activityType,
    attempt,
    scheduledTimestampMs: Date.now(),
    ...overrides,
  };
}

const RETRY_WARNING = 'Ably: retrying a call that Ably does not deduplicate, so it may be applied more than once';
const WINDOW_WARNING =
  "Ably: retrying a call more than 2 minutes after it was first scheduled. Ably's deduplication window may have passed, so the call may be applied more than once. Set scheduleToCloseTimeout in activityOptions to keep retries within the window.";

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
    ];

    for (const [activity, input] of notDeduplicated) {
      it(`warns on a retry of ${activity}`, async function () {
        const { logger } = await runLogged(activity, input, attemptInfo(activity, 2));

        const warnings = logger.ablyEntries.filter((entry) => entry.message === RETRY_WARNING);
        expect(warnings).to.have.length(1);
        expect(warnings[0].level).to.equal('WARN');
        expect(pluginAttributes(warnings[0])).to.deep.equal({ reason: 'operation is not idempotent' });
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
        expect(pluginAttributes(warnings[0])).to.deep.equal({ reason: 'no message IDs or idempotencyKey' });
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
      expect(warnings.map(pluginAttributes)).to.deep.equal([{ reason: 'no message IDs or idempotencyKey' }]);
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
      // The plugin cannot tell whether Ably deduplicates a request, so it does not warn of one.
      ['a POST request', ActivityNames.request, { method: 'POST', path: '/custom', version: 3, body: { a: 1 } }],
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
      expect(attributes).to.have.keys('elapsedMs');
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

  describe('sensitive values', function () {
    it('logs no credentials, IDs, keys, payloads, clientIds or channel names', async function () {
      const late = (activity: ActivityName, attempt = 2) =>
        attemptInfo(activity, attempt, { scheduledTimestampMs: Date.now() - 125_000 });
      const failing = (req: PendingRequest) =>
        req.respond_with(500, { error: { message: 'secret-error-message', code: 50000, statusCode: 500 } });
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
          loggers.push((await runLogged(activity, input, late(activity, attempt), failing)).logger);
        }
      }

      const entries = loggers.flatMap((logger) => logger.ablyEntries);
      expect(entries.map((entry) => entry.message)).to.include.members([RETRY_WARNING, WINDOW_WARNING]);
      const logged = JSON.stringify(entries.map(pluginAttributes)) + JSON.stringify(entries.map((e) => e.message));
      expect(logged).to.not.include('secret');
      expect(logged).to.not.include('keySecret');
      expect(logged).to.not.include('appId.keyId');
    });
  });
});
