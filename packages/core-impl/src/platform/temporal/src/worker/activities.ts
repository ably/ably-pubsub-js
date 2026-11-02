import type * as Ably from '@ably/pubsub-core/api';
import { ActivityNames } from '../common/activities.js';
import type { AblyActivities } from '../common/activities.js';
import { decodeFromWire, encodeForWire, setOwnProperty } from '../common/wire.js';
import type { PageLinks, PageParams, WireHttpPaginatedResponse, WirePage } from '../common/wire.js';
import { toActivityFailure } from './errors.js';

/**
 * Creates the Ably activities, keyed by their names in {@link ActivityNames}, which perform each operation with
 * `client`. {@link AblyHttpPlugin} registers them on a worker, so most applications do not need to call this
 * directly. Use it to register the activities on a worker without the plugin.
 *
 * Create `client` for the activities alone, and do not use it anywhere else. The activities get each channel from
 * `client` when they need it, and release it from `client` once no activity is using it. A channel that other code
 * gets from `client` would be released while that code still uses it, and the channel options it sets, such as a
 * `cipher`, would apply to the activities' requests on that channel.
 *
 * Every activity fails with an `ApplicationFailure` of type `AblyError` when the Ably HTTP client returns an error.
 * The failure is retryable only when the error is likely to be transient, such as a 5xx response, a timeout, a
 * rate limit or a network failure.
 *
 * Accessing `channel.object` requires `client` to have been constructed with the `LiveObjects` plugin from
 * `@ably/pubsub-server/liveobjects`. Without it, the `ably.channel.object.*` activities fail non-retryably.
 *
 * @param client - The Ably HTTP client used to perform each operation.
 * @returns The activity implementations, keyed by activity name.
 */
export function createActivities(client: Ably.PubSubHttpClient): AblyActivities {
  const leases = new ChannelLeases(client);
  const admin = (): Ably.PushAdmin => client.push.admin;

  return {
    [ActivityNames.publish]: (input) =>
      run(async () => {
        const { channel: name, messages, options } = decode(input);
        return encode(await leases.use(name, (channel) => channel.publish(messages, options)));
      }),

    [ActivityNames.history]: (input) =>
      run(async () => {
        const { channel: name, params } = decode(input);
        const page = await leases.use(name, (channel) => channel.history(params as Ably.HttpHistoryParams | undefined));
        return encode(toWirePage(page));
      }),

    [ActivityNames.status]: (input) =>
      run(async () => {
        const { channel: name } = decode(input);
        return encode(await leases.use(name, (channel) => channel.status()));
      }),

    [ActivityNames.getMessage]: (input) =>
      run(async () => {
        const { channel: name, serialOrMessage } = decode(input);
        return encode(await leases.use(name, (channel) => channel.getMessage(serialOrMessage)));
      }),

    [ActivityNames.updateMessage]: (input) =>
      run(async () => {
        const { channel: name, message, operation, options } = decode(input);
        return encode(await leases.use(name, (channel) => channel.updateMessage(message, operation, options)));
      }),

    [ActivityNames.deleteMessage]: (input) =>
      run(async () => {
        const { channel: name, message, operation, options } = decode(input);
        return encode(await leases.use(name, (channel) => channel.deleteMessage(message, operation, options)));
      }),

    [ActivityNames.appendMessage]: (input) =>
      run(async () => {
        const { channel: name, message, operation, options } = decode(input);
        return encode(await leases.use(name, (channel) => channel.appendMessage(message, operation, options)));
      }),

    [ActivityNames.getMessageVersions]: (input) =>
      run(async () => {
        const { channel: name, serialOrMessage, params } = decode(input);
        const page = await leases.use(name, (channel) => channel.getMessageVersions(serialOrMessage, params));
        return encode(toWirePage(page));
      }),

    [ActivityNames.presenceGet]: (input) =>
      run(async () => {
        const { channel: name, params } = decode(input);
        const page = await leases.use(name, (channel) =>
          channel.presence.get(params as Ably.HttpPresenceParams | undefined),
        );
        return encode(toWirePage(page));
      }),

    [ActivityNames.presenceHistory]: (input) =>
      run(async () => {
        const { channel: name, params } = decode(input);
        const page = await leases.use(name, (channel) =>
          channel.presence.history(params as Ably.HttpHistoryParams | undefined),
        );
        return encode(toWirePage(page));
      }),

    [ActivityNames.annotationsPublish]: (input) =>
      run(async () => {
        const { channel: name, messageOrSerial, annotation } = decode(input);
        await leases.use(name, ({ annotations }) =>
          typeof messageOrSerial === 'string'
            ? annotations.publish(messageOrSerial, annotation)
            : annotations.publish(messageOrSerial, annotation),
        );
      }),

    [ActivityNames.annotationsDelete]: (input) =>
      run(async () => {
        const { channel: name, messageOrSerial, annotation } = decode(input);
        await leases.use(name, ({ annotations }) =>
          typeof messageOrSerial === 'string'
            ? annotations.delete(messageOrSerial, annotation)
            : annotations.delete(messageOrSerial, annotation),
        );
      }),

    [ActivityNames.annotationsGet]: (input) =>
      run(async () => {
        const { channel: name, messageOrSerial, params } = decode(input);
        const getParams = params as Ably.GetAnnotationsParams | null;
        const page = await leases.use(name, ({ annotations }) =>
          typeof messageOrSerial === 'string'
            ? annotations.get(messageOrSerial, getParams)
            : annotations.get(messageOrSerial, getParams),
        );
        return encode(toWirePage(page));
      }),

    [ActivityNames.objectGet]: (input) =>
      run(async () => {
        const { channel: name, params } = decode(input);
        return encode(await leases.use(name, (channel) => channel.object.get(params)));
      }),

    [ActivityNames.objectPublish]: (input) =>
      run(async () => {
        const { channel: name, operations } = decode(input);
        return encode(await leases.use(name, (channel) => channel.object.publish(operations)));
      }),

    [ActivityNames.time]: () => run(async () => encode(await client.time())),

    [ActivityNames.request]: (input) =>
      run(async () => {
        const { method, path, version, params, body, headers } = decode(input);
        const response = await client.request(method, path, version, params, body, headers);
        const page: WireHttpPaginatedResponse<unknown> = {
          ...toWirePage(response),
          statusCode: response.statusCode,
          success: response.success,
          errorCode: response.errorCode,
          errorMessage: response.errorMessage,
          headers: response.headers,
        };
        if (response.errorDetail !== undefined) {
          page.errorDetail = response.errorDetail;
        }
        return encode(page);
      }),

    [ActivityNames.batchPublish]: (input) =>
      run(async () => {
        const { specs } = decode(input);
        return Array.isArray(specs)
          ? encode(await client.batchPublish(specs))
          : encode(await client.batchPublish(specs));
      }),

    [ActivityNames.batchPresence]: (input) =>
      run(async () => {
        const { channels } = decode(input);
        return encode(await client.batchPresence(channels));
      }),

    [ActivityNames.pushPublish]: (input) =>
      run(async () => {
        const { recipient, payload } = decode(input);
        await admin().publish(recipient, payload);
      }),

    [ActivityNames.pushCreateApnsBroadcast]: (input) =>
      run(async () => encode(await admin().createApnsBroadcast(decode(input).argument))),

    [ActivityNames.pushLiveActivityStart]: (input) =>
      run(async () => {
        await admin().liveActivity.start(decode(input).argument);
      }),

    [ActivityNames.pushLiveActivityUpdate]: (input) =>
      run(async () => {
        await admin().liveActivity.update(decode(input).argument);
      }),

    [ActivityNames.pushLiveActivityEnd]: (input) =>
      run(async () => {
        await admin().liveActivity.end(decode(input).argument);
      }),

    [ActivityNames.pushDeviceRegistrationsSave]: (input) =>
      run(async () => encode(await admin().deviceRegistrations.save(decode(input).argument))),

    [ActivityNames.pushDeviceRegistrationsGet]: (input) =>
      run(async () => {
        const { argument } = decode(input);
        const registrations = admin().deviceRegistrations;
        return encode(await (typeof argument === 'string' ? registrations.get(argument) : registrations.get(argument)));
      }),

    [ActivityNames.pushDeviceRegistrationsList]: (input) =>
      run(async () => {
        const { params } = decode(input);
        const page = await admin().deviceRegistrations.list((params ?? {}) as Ably.DeviceRegistrationParams);
        return encode(toWirePage(page));
      }),

    [ActivityNames.pushDeviceRegistrationsRemove]: (input) =>
      run(async () => {
        const { argument } = decode(input);
        const registrations = admin().deviceRegistrations;
        await (typeof argument === 'string' ? registrations.remove(argument) : registrations.remove(argument));
      }),

    [ActivityNames.pushDeviceRegistrationsRemoveWhere]: (input) =>
      run(async () => {
        await admin().deviceRegistrations.removeWhere(decode(input).argument);
      }),

    [ActivityNames.pushChannelSubscriptionsSave]: (input) =>
      run(async () => encode(await admin().channelSubscriptions.save(decode(input).argument))),

    [ActivityNames.pushChannelSubscriptionsList]: (input) =>
      run(async () => {
        const { params } = decode(input);
        const page = await admin().channelSubscriptions.list((params ?? {}) as Ably.PushChannelSubscriptionParams);
        return encode(toWirePage(page));
      }),

    [ActivityNames.pushChannelSubscriptionsListChannels]: (input) =>
      run(async () => {
        const { params } = decode(input);
        const page = await admin().channelSubscriptions.listChannels((params ?? {}) as Ably.PushChannelsParams);
        return encode(toWirePage(page));
      }),

    [ActivityNames.pushChannelSubscriptionsRemove]: (input) =>
      run(async () => {
        await admin().channelSubscriptions.remove(decode(input).argument);
      }),

    [ActivityNames.pushChannelSubscriptionsRemoveWhere]: (input) =>
      run(async () => {
        await admin().channelSubscriptions.removeWhere(decode(input).argument);
      }),
  };
}

/**
 * Gets channels from the client for the activities, and releases each channel once no activity is using it, so that
 * `client.channels.all` does not keep every channel the worker has used.
 *
 * A REST channel holds only its options, so getting a released channel again costs a few small objects. An activity
 * that is using a channel keeps its reference to it after a release.
 */
class ChannelLeases {
  /** The number of activities using each channel. */
  private readonly counts = new Map<string, number>();

  constructor(private readonly client: Ably.PubSubHttpClient) {}

  /** Runs `operation` with the channel called `name`, which stays on the client until the operation settles. */
  async use<T>(name: string, operation: (channel: Ably.HttpChannel) => Promise<T>): Promise<T> {
    const channel = this.client.channels.get(name);
    this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    try {
      return await operation(channel);
    } finally {
      this.release(name);
    }
  }

  private release(name: string): void {
    const count = (this.counts.get(name) ?? 1) - 1;
    if (count > 0) {
      this.counts.set(name, count);
      return;
    }
    this.counts.delete(name);
    this.client.channels.release(name);
  }
}

/** Runs the body of an activity, converting any Ably error it throws into an activity failure. */
async function run<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body();
  } catch (err) {
    throw toActivityFailure(err);
  }
}

/**
 * Decodes an activity's input from its wire form. Binary values are restored as Node.js `Buffer`s rather than plain
 * `Uint8Array`s, because the Ably SDK's MessagePack encoder only encodes a `Buffer` as binary. This matters where the
 * SDK sends values as given, such as the messages passed to `batchPublish` and the body passed to `request`.
 */
function decode<T>(input: T): T {
  return toNodeBuffers(decodeFromWire(input)) as T;
}

function toNodeBuffers(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  }
  if (Array.isArray(value)) {
    return value.map(toNodeBuffers);
  }
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      setOwnProperty(result, key, toNodeBuffers(value[key]));
    }
    return result;
  }
  return value;
}

/** Encodes an activity's result to its wire form. The result type is that of the value before encoding. */
function encode<T>(value: T): T {
  return encodeForWire(value) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/** The links to the first, current and next pages of a paginated result, from its `Link` header. */
function pageLinks(result: Ably.PaginatedResult<unknown>): PageLinks {
  // `PaginatedResult` keeps the parsed `Link` header in a private field, and exposes no public way to read it.
  const relParams = (result as unknown as { _relParams?: Record<string, PageParams> | null })._relParams;
  const links: PageLinks = {};
  for (const rel of ['first', 'current', 'next'] as const) {
    const params = relParams?.[rel];
    if (params) {
      links[rel] = params;
    }
  }
  return links;
}

function toWirePage<T>(result: Ably.PaginatedResult<T>): WirePage<T> {
  return { items: result.items, links: pageLinks(result) };
}
