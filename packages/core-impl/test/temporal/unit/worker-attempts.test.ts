import { expect } from 'chai';
import type { Info } from '@temporalio/activity';
import { ApplicationFailure, CancelledFailure } from '@temporalio/common';
import type { MockActivityEnvironment } from '@temporalio/testing';
import { restoreAll } from '../../uts/helpers';
import type { PendingRequest } from '../../uts/mock_http';
import { createActivities, currentCancellationSignal } from '../../../src/platform/temporal/src/worker/activities';
import { ActivityNames } from '../../../src/platform/temporal/src/common/activities';
import { ABLY_ERROR_TYPE } from '../../../src/platform/temporal/src/common/errors';
import type { AblyErrorDetails } from '../../../src/platform/temporal/src/common/errors';
import { activityEnvironment, mockAbly, runActivity, toWire, workflowActivityInfo } from './worker-helpers';

const PRIMARY = 'main.realtime.ably.net';

/** The `Info` of an attempt with the given fields. */
function attemptInfo(overrides: Partial<Info>): Partial<Info> {
  return { ...workflowActivityInfo, activityType: ActivityNames.history, ...overrides };
}

/** Counts the heartbeats of the activities run in `env`. */
function countHeartbeats(env: MockActivityEnvironment): { count: number } {
  const heartbeats = { count: 0 };
  env.on('heartbeat', () => heartbeats.count++);
  return heartbeats;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const history = toWire({ channel: 'chat' });

async function expectRetryableAblyFailure(promise: Promise<unknown>): Promise<AblyErrorDetails> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, 'expected the activity to fail').to.be.instanceOf(ApplicationFailure);
  const failure = caught as ApplicationFailure;
  expect(failure.type).to.equal(ABLY_ERROR_TYPE);
  expect(failure.nonRetryable).to.equal(false);
  return failure.details?.[0] as AblyErrorDetails;
}

describe('temporal/worker/attempts', function () {
  afterEach(function () {
    restoreAll();
  });

  describe('heartbeats', function () {
    it('heartbeats every half of heartbeatTimeout while the call waits, and not after it settles', async function () {
      const { client } = mockAbly((req) => setTimeout(() => req.respond_with(200, []), 350));
      const env = activityEnvironment(attemptInfo({ heartbeatTimeoutMs: 100 }));
      const heartbeats = countHeartbeats(env);

      await runActivity(env, createActivities(client)[ActivityNames.history], history);
      const settledCount = heartbeats.count;
      await sleep(150);

      // Every 50 ms over 350 ms, allowing for timer drift.
      expect(settledCount).to.be.within(3, 7);
      expect(heartbeats.count).to.equal(settledCount);
    });

    it('stops heartbeating when the call fails', async function () {
      const { client } = mockAbly((req) =>
        setTimeout(
          () => req.respond_with(400, { error: { message: 'Bad request', code: 40000, statusCode: 400 } }),
          200,
        ),
      );
      const env = activityEnvironment(attemptInfo({ heartbeatTimeoutMs: 100 }));
      const heartbeats = countHeartbeats(env);

      await runActivity(env, createActivities(client)[ActivityNames.history], history).catch(() => undefined);
      const settledCount = heartbeats.count;
      await sleep(150);

      expect(settledCount).to.be.at.least(2);
      expect(heartbeats.count).to.equal(settledCount);
    });

    for (const heartbeatTimeoutMs of [undefined, 0]) {
      it(`does not heartbeat with a heartbeatTimeout of ${heartbeatTimeoutMs}`, async function () {
        const { client } = mockAbly((req) => setTimeout(() => req.respond_with(200, []), 200));
        const env = activityEnvironment(attemptInfo({ heartbeatTimeoutMs }));
        const heartbeats = countHeartbeats(env);

        await runActivity(env, createActivities(client)[ActivityNames.history], history);

        expect(heartbeats.count).to.equal(0);
      });
    }
  });

  describe('cancellation', function () {
    /** Expects `promise` to reject with Temporal's cancellation of the activity, rather than with an Ably failure. */
    async function expectCancelled(promise: Promise<unknown>): Promise<void> {
      let caught: unknown;
      try {
        await promise;
      } catch (err) {
        caught = err;
      }
      expect(caught, 'expected the activity to be cancelled').to.be.instanceOf(CancelledFailure);
    }

    /** An HTTP client whose requests are abandoned once the activity making them is cancelled, as the plugin's are. */
    function cancellableAbly(handler: (req: PendingRequest) => void) {
      return mockAbly(handler, { clientOptions: { requestSignal: currentCancellationSignal } });
    }

    it('returns the cancellation signal of the activity making the request', async function () {
      let signal: AbortSignal | undefined;
      const { client } = mockAbly((req) => {
        signal = currentCancellationSignal();
        req.respond_with(200, []);
      });
      const env = activityEnvironment(attemptInfo({}));

      await runActivity(env, createActivities(client)[ActivityNames.history], history);

      expect(signal).to.equal(env.context.cancellationSignal);
    });

    it('returns no signal outside an activity', function () {
      expect(currentCancellationSignal()).to.equal(undefined);
    });

    it('abandons the request in progress when the activity is cancelled, and tries no further host', async function () {
      const env = activityEnvironment(attemptInfo({}));
      const { client, requests } = cancellableAbly(() => setTimeout(() => env.cancel(), 50));

      await expectCancelled(runActivity(env, createActivities(client)[ActivityNames.history], history));

      expect(requests).to.have.length(1);
      expect(requests[0].url.hostname).to.equal(PRIMARY);
    });

    it('fails as cancelled when the activity is cancelled once a host has failed', async function () {
      const env = activityEnvironment(attemptInfo({}));
      const { client, requests } = cancellableAbly((req) => {
        env.cancel();
        req.respond_with(500, { error: { message: 'fail', code: 50000, statusCode: 500 } });
      });

      await expectCancelled(runActivity(env, createActivities(client)[ActivityNames.history], history));

      expect(requests).to.have.length(1);
    });

    it('makes no request for an activity that is already cancelled', async function () {
      const env = activityEnvironment(attemptInfo({}));
      const { client, requests } = cancellableAbly((req) => req.respond_with(200, []));
      env.cancel();

      await expectCancelled(runActivity(env, createActivities(client)[ActivityNames.history], history));

      expect(requests).to.have.length(0);
    });

    it('fails with the Ably failure when the activity is not cancelled', async function () {
      const { client } = cancellableAbly((req) =>
        req.respond_with(500, { error: { message: 'fail', code: 50000, statusCode: 500 } }),
      );

      const details = await expectRetryableAblyFailure(
        runActivity(activityEnvironment(attemptInfo({})), createActivities(client)[ActivityNames.history], history),
      );

      expect(details).to.include({ code: 50000, statusCode: 500 });
    });
  });
});
