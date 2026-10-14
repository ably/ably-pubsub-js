// Workflows for the sandbox integration tests in ./sandbox.test.ts. They import the built `@ably/pubsub-server/temporal/workflow`
// entry point, as an application would, and run on workers whose `AblyRestPlugin` talks to an Ably sandbox app. They
// return plain JSON values describing what they observed, because values such as a Uint8Array or an error class can
// only be inspected inside the workflow sandbox.

import { ActivityFailure, ApplicationFailure } from '@temporalio/workflow';
import type * as Ably from '@ably/pubsub-server';
import { getAblyErrorDetails, TemporalRest } from '@ably/pubsub-server/temporal/workflow';

// Retries quickly and a bounded number of times, so that a transient sandbox error does not fail a test, and an
// unexpected retry shows up in the history rather than as a test timeout.
const ably = new TemporalRest({
  activityOptions: { retry: { initialInterval: '200 milliseconds', backoffCoefficient: 1, maximumAttempts: 3 } },
});

export interface CapturedError {
  isActivityFailure: boolean;
  causeType?: string | null;
  nonRetryable?: boolean | null;
  details: ReturnType<typeof getAblyErrorDetails>;
}

type Outcome<T> = { result: T } | { error: CapturedError };

async function outcome<T>(fn: () => Promise<T>): Promise<Outcome<T>> {
  try {
    return { result: await fn() };
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    return {
      error: {
        isActivityFailure: err instanceof ActivityFailure,
        causeType: cause instanceof ApplicationFailure ? cause.type : undefined,
        nonRetryable: cause instanceof ApplicationFailure ? cause.nonRetryable : undefined,
        details: getAblyErrorDetails(err),
      },
    };
  }
}

export async function sandboxPublish(channelName: string): Promise<Ably.PublishResult> {
  return ably.channels.get(channelName).publish([
    { name: 'greeting', data: { text: 'hello' } },
    { name: 'bytes', data: new Uint8Array([0, 1, 254, 255]) },
  ]);
}

export async function sandboxPublishOutcome(channelName: string): Promise<Outcome<Ably.PublishResult>> {
  return outcome(() => ably.channels.get(channelName).publish('event', 'data'));
}

export async function sandboxMessageOperations(channelName: string): Promise<unknown> {
  const channel = ably.channels.get(channelName);
  const { serials } = await channel.publish('original', 'hello');
  const serial = serials[0]!;
  const update = await outcome(() =>
    channel.updateMessage({ serial, data: 'hello, edited' }, { description: 'edit', metadata: { reason: 'typo' } }),
  );
  const append = await outcome(() => channel.appendMessage({ serial, data: '!' }, { description: 'append' }));
  return { serial, update, append };
}

/** Publishes a message, then deletes it and annotates it with the keys and IDs that the workflow derives. */
export async function sandboxDeleteAndAnnotate(channelName: string): Promise<unknown> {
  const channel = ably.channels.get(channelName);
  const { serials } = await channel.publish('original', 'hello');
  const serial = serials[0]!;
  await channel.annotations.publish(serial, { type: 'reaction:multiple.v1', name: 'up' });
  const deleted = await channel.deleteMessage({ serial }, { description: 'remove' });
  return { serial, deleted };
}

/**
 * Registers a device and subscribes it to `channelName`, reads both back, and removes them. `device` is registered
 * with the given ID.
 */
export async function sandboxPushAdmin(channelName: string, device: Ably.DeviceDetails): Promise<unknown> {
  const admin = ably.push.admin;
  const saved = await admin.deviceRegistrations.save(device);
  const got = await admin.deviceRegistrations.get(device);
  const listed = await admin.deviceRegistrations.list({ deviceId: device.id });
  const subscription = await admin.channelSubscriptions.save({ channel: channelName, deviceId: device.id });
  const subscriptions = await admin.channelSubscriptions.list({ channel: channelName });
  await admin.channelSubscriptions.remove({ channel: channelName, deviceId: device.id });
  const afterRemove = await admin.channelSubscriptions.list({ channel: channelName });
  await admin.deviceRegistrations.remove(device.id);
  return {
    saved: { id: saved.id, platform: saved.platform },
    got: { id: got.id, state: got.push.state },
    listed: listed.items.map((item) => item.id),
    subscription,
    subscriptions: subscriptions.items,
    afterRemove: afterRemove.items,
  };
}

export async function sandboxPushPublish(recipient: unknown, payload: unknown): Promise<void> {
  await ably.push.admin.publish(recipient, payload);
}

export async function sandboxBatchPublish(
  pairedChannels: string[],
  singleChannel: string,
): Promise<Ably.BatchResult<Ably.BatchPublishSuccessResult | Ably.BatchPublishFailureResult>[]> {
  return ably.batchPublish([
    {
      channels: pairedChannels,
      messages: [
        { name: 'first', data: 'one' },
        { name: 'second', data: 'two' },
      ],
    },
    { channels: [singleChannel], messages: [{ name: 'single', data: 'three' }] },
  ]);
}

/**
 * Publishes object operations that each map to a single object message: an increment of the existing counter at
 * `counter`, and a batch of an increment and a map set. Reads the counter back in full format.
 */
export async function sandboxObjectOperations(channelName: string): Promise<unknown> {
  const object = ably.channels.get(channelName).object;
  const increment = await object.publish({ path: 'counter', counterInc: { number: 2 } });
  const batch = await object.publish([
    { path: 'counter', counterInc: { number: 3 } },
    { objectId: 'root', mapSet: { key: 'greeting', value: { string: 'hello' } } },
  ]);
  const counter = await object.get({ path: 'counter', compact: false });
  return { increment, batch, counter };
}

/**
 * Publishes the object operations that the workflow publishes without IDs: creating a counter without a path,
 * creating a counter and a map at a path, which also sets the new object on the parent map, and an increment of every
 * counter matched by a wildcard path. The wildcard matches the counters `scores.a` and `scores.b`, which the test
 * creates beforehand.
 */
export async function sandboxObjectOperationsWithoutIds(
  channelName: string,
): Promise<Record<string, Outcome<unknown>>> {
  const object = ably.channels.get(channelName).object;
  return {
    counterCreate: await outcome(() => object.publish({ counterCreate: { count: 1 } })),
    counterCreateAtPath: await outcome(() => object.publish({ path: 'votes', counterCreate: { count: 5 } })),
    mapCreateAtPath: await outcome(() =>
      object.publish({
        path: 'profile',
        mapCreate: { semantics: 'lww', entries: { name: { data: { string: 'Ada' } } } },
      }),
    ),
    counterIncAtWildcardPath: await outcome(() => object.publish({ path: 'scores.*', counterInc: { number: 1 } })),
  };
}

export async function sandboxPresenceAndStatus(channelName: string): Promise<unknown> {
  const channel = ably.channels.get(channelName);
  await channel.publish('activate', 'data');
  const presence = await channel.presence.get();
  const status = await channel.status();
  const history = await channel.history();
  return {
    presence: { items: presence.items, hasNext: presence.hasNext() },
    status,
    history: history.items.map((item) => ({ id: item.id, name: item.name, data: item.data })),
  };
}
