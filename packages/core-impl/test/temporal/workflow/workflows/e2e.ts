// Workflows for the end-to-end tests in ../e2e.test.ts. They import the built `@ably/pubsub-server/temporal/workflow` entry point,
// as an application would, and run on workers with the built `AblyRestPlugin`. They return plain JSON values
// describing what they observed, because values such as a Uint8Array or an error class can only be inspected inside
// the workflow sandbox.

import { ActivityFailure, ApplicationFailure, type RetryPolicy } from '@temporalio/workflow';
import type * as Ably from '@ably/pubsub-server';
import {
  getAblyErrorDetails,
  TemporalAblyRest,
  type TemporalAblyPaginatedResult,
} from '@ably/pubsub-server/temporal/workflow';

// Constructed at module scope, as in the documented usage.
const ably = new TemporalAblyRest();

// Retries a failed activity after 50ms rather than Temporal's default of 1 second, and gives up after 5 attempts,
// so that an unexpected retry shows up as extra requests rather than a test timeout.
const fastRetry: RetryPolicy = { initialInterval: '50 milliseconds', backoffCoefficient: 1, maximumAttempts: 5 };
const retrying = new TemporalAblyRest({ activityOptions: { retry: fastRetry } });

export interface CapturedError {
  isActivityFailure: boolean;
  causeIsApplicationFailure: boolean;
  causeType?: string | null;
  nonRetryable?: boolean | null;
  details: ReturnType<typeof getAblyErrorDetails>;
}

function captureError(err: unknown): CapturedError {
  const cause = (err as { cause?: unknown }).cause;
  return {
    isActivityFailure: err instanceof ActivityFailure,
    causeIsApplicationFailure: cause instanceof ApplicationFailure,
    causeType: cause instanceof ApplicationFailure ? cause.type : undefined,
    nonRetryable: cause instanceof ApplicationFailure ? cause.nonRetryable : undefined,
    details: getAblyErrorDetails(err),
  };
}

function describeBinary(value: unknown): { isUint8Array: boolean; bytes: number[] } {
  return { isUint8Array: value instanceof Uint8Array, bytes: Array.from(value as ArrayLike<number>) };
}

function describePage(page: TemporalAblyPaginatedResult<Ably.InboundMessage> | null) {
  return page && { ids: page.items.map((item) => item.id), hasNext: page.hasNext() };
}

export async function e2ePublish(channelName: string): Promise<Ably.PublishResult> {
  return ably.channels.get(channelName).publish([
    { name: 'greeting', data: { text: 'hello' } },
    { name: 'farewell', data: 'bye' },
  ]);
}

export async function e2eRetry(channelName: string): Promise<Ably.PublishResult> {
  return retrying.channels.get(channelName).publish('event', 'data');
}

export async function e2eAblyError(channelName: string, rethrow: boolean): Promise<CapturedError | null> {
  try {
    await retrying.channels.get(channelName).publish('event', 'data');
    return null;
  } catch (err) {
    if (rethrow) {
      throw err;
    }
    return captureError(err);
  }
}

export async function e2eBinary(channelName: string): Promise<unknown> {
  const channel = ably.channels.get(channelName);
  const published = await channel.publish('bytes', new Uint8Array([0, 1, 254, 255]));
  const page = await channel.history();
  return { published, history: page.items.map((item) => describeBinary(item.data)) };
}

export async function e2ePagination(channelName: string): Promise<unknown> {
  const channel = ably.channels.get(channelName);
  const page1 = await channel.history({ limit: 2, direction: 'backwards' });
  const page2 = await page1.next();
  const page3 = page2 && (await page2.next());
  const first = page2 && (await page2.first());
  return {
    page1: describePage(page1),
    page2: describePage(page2),
    page3: describePage(page3),
    first: describePage(first),
  };
}

export async function e2eMessageOperations(channelName: string): Promise<unknown> {
  const channel = ably.channels.get(channelName);
  return {
    update: await channel.updateMessage(
      { serial: 'serial-1', data: 'updated' },
      { description: 'edit', metadata: { reason: 'typo' } },
    ),
    append: await channel.appendMessage({ serial: 'serial-1', data: ' more' }),
  };
}

export async function e2eLocalActivity(channelName: string): Promise<Ably.PublishResult> {
  const rest = new TemporalAblyRest({ localActivityOptions: { startToCloseTimeout: '10 seconds', retry: fastRetry } });
  return rest.channels.get(channelName).publish('event', 'local');
}

export async function e2eReplay(channelName: string): Promise<unknown> {
  const channel = ably.channels.get(channelName);
  const first = await channel.publish('one', 'first');
  const page = await channel.history();
  const second = await channel.publish([{ name: 'two' }, { name: 'three', data: new Uint8Array([3]) }]);
  return { first, second, history: describePage(page) };
}

export async function e2eObjectPublish(channelName: string): Promise<unknown> {
  return ably.channels.get(channelName).object.publish([
    { objectId: 'counter:1', counterInc: { number: 1 } },
    { objectId: 'counter:2', counterInc: { number: 2 } },
  ]);
}
