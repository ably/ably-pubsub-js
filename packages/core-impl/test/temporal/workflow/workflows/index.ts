// Test workflows for the workflow-side proxy. They run against stub activities (see ../proxy.test.ts), and return
// plain JSON values describing what they observed, because values such as a Uint8Array or an error class can only
// be inspected inside the workflow sandbox.

import { ActivityFailure, ApplicationFailure } from '@temporalio/workflow';
import type * as Ably from '@ably/pubsub-server';
import type { HttpObjectOperation } from '@ably/pubsub-server/liveobjects';
import {
  getAblyErrorDetails,
  TemporalRest,
  type TemporalHttpPaginatedResponse,
  type TemporalPaginatedResult,
} from '../../../../src/platform/temporal/src/workflow.js';

// Constructed at module scope, as in the documented usage.
const ably = new TemporalRest();

interface CapturedError {
  isApplicationFailure: boolean;
  isActivityFailure: boolean;
  type?: string | null;
  nonRetryable?: boolean | null;
  message: string;
  details: ReturnType<typeof getAblyErrorDetails>;
}

async function captureError(fn: () => Promise<unknown>): Promise<CapturedError | null> {
  try {
    await fn();
    return null;
  } catch (err) {
    return {
      isApplicationFailure: err instanceof ApplicationFailure,
      isActivityFailure: err instanceof ActivityFailure,
      type: err instanceof ApplicationFailure ? err.type : undefined,
      nonRetryable: err instanceof ApplicationFailure ? err.nonRetryable : undefined,
      message: (err as Error).message,
      details: getAblyErrorDetails(err),
    };
  }
}

function describeBinary(value: unknown): { isUint8Array: boolean; bytes: number[] } {
  return { isUint8Array: value instanceof Uint8Array, bytes: Array.from(value as ArrayLike<number>) };
}

function describePage<T>(page: TemporalPaginatedResult<T> | null) {
  return page && { items: page.items, hasNext: page.hasNext(), isLast: page.isLast() };
}

function describeResponse<T>(response: TemporalHttpPaginatedResponse<T> | null) {
  return (
    response && {
      ...describePage(response),
      statusCode: response.statusCode,
      success: response.success,
      errorCode: response.errorCode,
      errorMessage: response.errorMessage,
      headers: response.headers,
    }
  );
}

export async function publishOverloads(): Promise<unknown> {
  const channel = ably.channels.get('overloads');
  return {
    results: [
      await channel.publish('greeting', 'hello', { quickAck: true }),
      await channel.publish({ name: 'single', data: { a: 1 } }, { param: 'x' }),
      await channel.publish([{ name: 'a' }, { name: 'b', data: 2 }]),
      await channel.publish(null as unknown as string, 'nameless'),
      await channel.publish('nodata', undefined),
    ],
    sameChannel: ably.channels.get('overloads') === channel,
    channelName: channel.name,
  };
}

export async function publishIds(idempotentPublishing?: boolean): Promise<unknown> {
  const rest = new TemporalRest(idempotentPublishing === undefined ? {} : { idempotentPublishing });
  const channel = rest.channels.get('ids');

  const fresh: Ably.Message[] = [{ name: 'x' }, { name: 'y', extras: { headers: { h: '1' } } }];
  const withOwnId: Ably.Message[] = [{ name: 'p' }, { name: 'q', id: 'own-id' }];
  const single: Ably.Message = { name: 'z' };
  const specs: Ably.BatchPublishSpec[] = [
    { channels: ['b1', 'b2'], messages: [{ name: 'm1' }, { name: 'm2' }] },
    { channels: ['b3'], messages: [{ name: 'm3', id: 'spec-own-id' }, { name: 'm4' }] },
  ];
  const singleSpec: Ably.BatchPublishSpec = { channels: ['b4'], messages: [{ name: 'm5' }] };
  // The batch publish endpoint also accepts a single message object in place of an array.
  const singleMessageSpec = { channels: ['b5'], messages: { name: 'm6' } } as unknown as Ably.BatchPublishSpec;
  const operations: HttpObjectOperation[] = [
    { objectId: 'counter:1', counterInc: { number: 1 } },
    { objectId: 'counter:2', counterInc: { number: 2 } },
  ];
  const operationsWithOwnId: HttpObjectOperation[] = [
    { objectId: 'counter:3', counterInc: { number: 3 }, id: 'op-own-id' },
  ];

  const results = {
    fresh: await channel.publish(fresh),
    withOwnId: await channel.publish(withOwnId),
    single: await channel.publish(single),
    batch: await rest.batchPublish(specs),
    singleSpec: await rest.batchPublish(singleSpec),
    singleMessageSpec: await rest.batchPublish(singleMessageSpec),
    objectOperations: await channel.object.publish(operations),
    objectOperationsWithOwnId: await channel.object.publish(operationsWithOwnId),
    // Create operations, and operations with a wildcard path, are published without IDs.
    objectCreateAtPath: await channel.object.publish([
      { path: 'votes', counterCreate: { count: 0 } },
      { objectId: 'counter:1', counterInc: { number: 1 } },
    ]),
    objectWildcard: await channel.object.publish({ path: 'scores.*', counterInc: { number: 1 } }),
    objectCreate: await channel.object.publish({ counterCreate: { count: 0 } }),
    objectCreateWithObjectId: await channel.object.publish({
      objectId: 'counter:4',
      counterCreateWithObjectId: { initialValue: '{"count":0}', nonce: 'nonce' },
    }),
  };

  const callerMessages = [...fresh, withOwnId[0], single, ...specs[0].messages, specs[1].messages[1]];
  return {
    results,
    callerObjectsUnmodified: callerMessages.every((message) => !('id' in message)),
    callerSpecsUnmodified: specs[0].messages.length === 2 && singleSpec.messages.every((m) => !('id' in m)),
    callerOperationsUnmodified: operations.every((operation) => !('id' in operation)),
    callerSingleMessageUnmodified: !('id' in (singleMessageSpec.messages as unknown as Ably.Message)),
  };
}

export async function publishInvalid(rethrow: boolean): Promise<unknown> {
  const publish = () => ably.channels.get('invalid').publish(42 as unknown as string, 'data');
  if (rethrow) {
    await publish();
  }
  return captureError(publish);
}

export async function binaryData(): Promise<unknown> {
  const channel = ably.channels.get('binary');
  await channel.publish('bin', new Uint8Array([1, 2, 3]));
  await channel.publish({ name: 'nested', data: { inner: new Uint8Array([4, 5]), text: 'kept' } });
  const page = await channel.history();
  const object = (await channel.object.get({ compact: false })) as { map: { entries: { bytes: { data: unknown } } } };
  return {
    historyData: describeBinary(page.items[0].data),
    historyNested: describeBinary((page.items[1].data as { inner: unknown }).inner),
    objectBytes: describeBinary((object.map.entries.bytes.data as { bytes: unknown }).bytes),
  };
}

export async function pagination(): Promise<unknown> {
  const channel = ably.channels.get('pages');
  const page1 = await channel.history({ limit: 1 });
  const page2 = await page1.next();
  const page3 = await page2!.next();
  const first = await page2!.first();
  const current = await page1.current();

  const unlinked = await ably.channels.get('nolinks').history();
  return {
    page1: describePage(page1),
    page2: describePage(page2),
    page3: describePage(page3),
    first: describePage(first),
    current: describePage(current),
    unlinked: describePage(unlinked),
    unlinkedNext: describePage(await unlinked.next()),
    unlinkedFirstError: await captureError(() => unlinked.first()),
    unlinkedCurrentError: await captureError(() => unlinked.current()),
  };
}

export async function requestPagination(): Promise<unknown> {
  const response = await ably.request('POST', '/custom/path', 3, { q: '1' }, { hello: 'world' }, { 'X-Custom': 'yes' });
  const next = await response.next();
  const first = await response.first();
  const current = await next!.current();
  const failed = await ably.request('get', '/error', 2);
  return {
    response: describeResponse(response),
    next: describeResponse(next),
    first: describeResponse(first),
    current: describeResponse(current),
    afterLast: describeResponse(await next!.next()),
    failed: describeResponse(failed),
  };
}

export async function activityOptions(variant: 'default' | 'custom' | 'summary'): Promise<void> {
  const rest =
    variant === 'default'
      ? new TemporalRest()
      : variant === 'custom'
        ? new TemporalRest({
            activityOptions: {
              startToCloseTimeout: '7 seconds',
              scheduleToCloseTimeout: '1 minute',
              retry: { maximumAttempts: 2, nonRetryableErrorTypes: ['AblyError'] },
            },
          })
        : new TemporalRest({ activityOptions: { summary: 'my summary' } });
  const channel = rest.channels.get('opts');
  await channel.publish('event', 'data');
  const page = await channel.history();
  await page.next();
  await rest.time();
}

export async function localActivities(): Promise<unknown> {
  const rest = new TemporalRest({ localActivityOptions: { startToCloseTimeout: '5 seconds' } });
  return {
    publish: await rest.channels.get('local').publish('event', 'data'),
    time: await rest.time(),
  };
}

export async function activityFailure(rethrow: boolean): Promise<unknown> {
  const publish = () => ably.channels.get('fail:auth').publish('event', 'data');
  if (rethrow) {
    await publish();
  }
  const error = await captureError(publish);
  return error;
}

export async function bothOptions(): Promise<void> {
  new TemporalRest({
    activityOptions: { startToCloseTimeout: '1 second' },
    localActivityOptions: { startToCloseTimeout: '1 second' },
  });
}

export async function channelMethods(): Promise<unknown> {
  const channel = ably.channels.get('methods');
  return {
    status: await channel.status(),
    getMessage: await channel.getMessage('s1'),
    updateMessage: await channel.updateMessage({ serial: 's1', data: 'new' }, { description: 'edit' }, { p: '1' }),
    deleteMessage: await channel.deleteMessage({ serial: 's1' }),
    appendMessage: await channel.appendMessage({ serial: 's1', data: ' more' }, undefined, { q: '2' }),
    getMessageVersions: describePage(await (await channel.getMessageVersions('s1', { limit: 5 })).next()),
    presenceGet: describePage(await (await channel.presence.get({ clientId: 'c1' })).next()),
    presenceHistory: describePage(await (await channel.presence.history({ limit: 2 })).next()),
    annotationsPublish: await channel.annotations.publish('s1', { type: 'reaction:distinct.v1', name: 'up' }),
    annotationsDelete: await channel.annotations.delete({ serial: 's1' }, { type: 'reaction:distinct.v1' }),
    annotationsGet: describePage(await (await channel.annotations.get({ serial: 's1' }, null)).next()),
    objectGet: await channel.object.get({ objectId: 'root', path: 'a.b' }),
    objectPublish: await channel.object.publish({ objectId: 'counter:1', counterInc: { number: 1 } }),
    time: await ably.time(),
    batchPresence: await ably.batchPresence(['p1', 'p2']),
  };
}

export async function invalidArguments(): Promise<unknown> {
  // Calls that bypass the types, as JavaScript callers can.
  const channel = ably.channels.get('invalid') as any;
  const rest = ably as any;
  return {
    updateMessage: await captureError(() => channel.updateMessage(null)),
    getMessage: await captureError(() => channel.getMessage(undefined)),
    annotationsPublish: await captureError(() => channel.annotations.publish('s1', null)),
    annotationsGet: await captureError(() => channel.annotations.get(null, null)),
    objectPublish: await captureError(() => channel.object.publish(null)),
    batchPresence: await captureError(() => rest.batchPresence(undefined)),
    request: await captureError(() => rest.request(undefined, '/time', 3)),
    channelOptions: await captureError(async () => rest.channels.get('invalid', { cipher: { key: 'secret' } })),
    pushPublish: await captureError(() => rest.push.admin.publish(null, { notification: { title: 't' } })),
    createApnsBroadcast: await captureError(() => rest.push.admin.createApnsBroadcast(null)),
    liveActivityStart: await captureError(() =>
      rest.push.admin.liveActivity.start({ apnsBroadcast: 'b1', apns: { aps: {} } }),
    ),
    deviceRegistrationsGet: await captureError(() => rest.push.admin.deviceRegistrations.get(null)),
    deviceRegistrationsRemoveWhere: await captureError(() => rest.push.admin.deviceRegistrations.removeWhere()),
    channelSubscriptionsSave: await captureError(() => rest.push.admin.channelSubscriptions.save(null)),
  };
}

export async function operationKeys(idempotentPublishing?: boolean): Promise<unknown> {
  const rest = new TemporalRest(idempotentPublishing === undefined ? {} : { idempotentPublishing });
  const channel = rest.channels.get('keys');
  const options = { p: '1' };
  const annotation: Ably.OutboundAnnotation = { type: 'reaction:distinct.v1', name: 'up' };
  await channel.updateMessage({ serial: 's1', data: 'a' });
  await channel.updateMessage({ serial: 's1', data: 'b' }, undefined, options);
  await channel.updateMessage({ serial: 's1', data: 'c' }, undefined, { idempotencyKey: 'own-key' });
  await channel.deleteMessage({ serial: 's1' });
  await channel.appendMessage({ serial: 's1', data: 'd' });
  await channel.annotations.publish('s1', annotation);
  await channel.annotations.publish('s1', { ...annotation, id: 'own-annotation-id' });
  await channel.annotations.delete('s1', annotation);
  return { callerObjectsUnmodified: !('idempotencyKey' in options) && !('id' in annotation) };
}

export async function pushAdmin(): Promise<unknown> {
  const admin = ably.push.admin;
  const device = {
    id: 'device-1',
    platform: 'ios',
    formFactor: 'phone',
    push: { recipient: {} },
  } as Ably.DeviceDetails;
  const subscription = { channel: 'news', clientId: 'user-1' };
  return {
    publish: await admin.publish({ clientId: 'user-1' }, { notification: { title: 'Hello' } }),
    createApnsBroadcast: await admin.createApnsBroadcast({ messageStoragePolicy: 1 }),
    liveActivityStart: await admin.liveActivity.start({
      recipient: { channels: ['news'] },
      apnsBroadcast: 'b1',
      apns: { aps: { event: 'start' } },
    }),
    liveActivityUpdate: await admin.liveActivity.update({ apnsBroadcast: 'b1', apns: { aps: { event: 'update' } } }),
    liveActivityEnd: await admin.liveActivity.end({ apnsBroadcast: 'b1', apns: { aps: { event: 'end' } } }),
    deviceSave: await admin.deviceRegistrations.save(device),
    deviceGet: await admin.deviceRegistrations.get(device),
    deviceList: describePage(await (await admin.deviceRegistrations.list({ clientId: 'user-1' })).next()),
    deviceRemove: await admin.deviceRegistrations.remove('device-1'),
    deviceRemoveWhere: await admin.deviceRegistrations.removeWhere({ clientId: 'user-1' }),
    subscriptionSave: await admin.channelSubscriptions.save(subscription),
    subscriptionList: describePage(await (await admin.channelSubscriptions.list({ channel: 'news' })).next()),
    subscriptionListChannels: describePage(await (await admin.channelSubscriptions.listChannels({})).next()),
    subscriptionRemove: await admin.channelSubscriptions.remove(subscription),
    subscriptionRemoveWhere: await admin.channelSubscriptions.removeWhere({ clientId: 'user-1' }),
  };
}

export async function pushRetries(variant: 'default' | 'custom'): Promise<void> {
  const rest =
    variant === 'default'
      ? new TemporalRest()
      : new TemporalRest({ activityOptions: { retry: { maximumAttempts: 5 } } });
  const admin = rest.push.admin;
  await admin.publish({ clientId: 'user-1' }, { notification: { title: 'Hello' } });
  await admin.createApnsBroadcast({ messageStoragePolicy: 0 });
  await admin.liveActivity.start({ recipient: { deviceId: 'device-1' }, apnsBroadcast: 'b1', apns: {} });
  await admin.liveActivity.update({ apnsBroadcast: 'b1', apns: {} });
  await admin.liveActivity.end({ apnsBroadcast: 'b1', apns: {} });
  await admin.deviceRegistrations.get('device-1');
  await admin.channelSubscriptions.removeWhere({ clientId: 'user-1' });
}

/** Publishes a push notification whose activity fails retryably, as a local activity. */
export async function pushLocalFailure(): Promise<unknown> {
  const rest = new TemporalRest({
    localActivityOptions: { startToCloseTimeout: '5 seconds', retry: { maximumAttempts: 3, initialInterval: '10ms' } },
  });
  return captureError(() => rest.push.admin.publish({ clientId: 'retryable-failure' }, { notification: {} }));
}

export async function serialArguments(): Promise<void> {
  const channel = ably.channels.get('serials');
  await channel.getMessage({ serial: 's1', data: 'large' });
  await channel.getMessage({ data: 'no serial' });
  await channel.getMessageVersions({ serial: 's2', data: 'large' });
  await channel.annotations.publish({ serial: 's3', data: 'large' }, { type: 'reaction:distinct.v1' });
}
