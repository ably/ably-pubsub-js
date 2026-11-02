import type * as Ably from '@ably/pubsub-core/api';
import { ActivityNames } from '../common/activities.js';
import type { AblyActivities } from '../common/activities.js';
import { encodeBinaryData, mapOperationBytes, toWireValue } from '../common/wire.js';
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
        const { channel: name, messages, options } = input;
        return encode(await leases.use(name, (channel) => channel.publish(messages, options)));
      }),

    [ActivityNames.history]: (input) =>
      run(async () => {
        const { channel: name, params } = input;
        const page = await leases.use(name, (channel) => channel.history(params as Ably.HttpHistoryParams | undefined));
        return encode(toWireMessagePage(page));
      }),

    [ActivityNames.status]: (input) =>
      run(async () => {
        const { channel: name } = input;
        return encode(await leases.use(name, (channel) => channel.status()));
      }),

    [ActivityNames.getMessage]: (input) =>
      run(async () => {
        const { channel: name, serialOrMessage } = input;
        return encode(encodeData(await leases.use(name, (channel) => channel.getMessage(serialOrMessage))));
      }),

    [ActivityNames.updateMessage]: (input) =>
      run(async () => {
        const { channel: name, message, operation, options } = input;
        return encode(await leases.use(name, (channel) => channel.updateMessage(message, operation, options)));
      }),

    [ActivityNames.deleteMessage]: (input) =>
      run(async () => {
        const { channel: name, message, operation, options } = input;
        return encode(await leases.use(name, (channel) => channel.deleteMessage(message, operation, options)));
      }),

    [ActivityNames.appendMessage]: (input) =>
      run(async () => {
        const { channel: name, message, operation, options } = input;
        return encode(await leases.use(name, (channel) => channel.appendMessage(message, operation, options)));
      }),

    [ActivityNames.getMessageVersions]: (input) =>
      run(async () => {
        const { channel: name, serialOrMessage, params } = input;
        const page = await leases.use(name, (channel) => channel.getMessageVersions(serialOrMessage, params));
        return encode(toWireMessagePage(page));
      }),

    [ActivityNames.presenceGet]: (input) =>
      run(async () => {
        const { channel: name, params } = input;
        const page = await leases.use(name, (channel) =>
          channel.presence.get(params as Ably.HttpPresenceParams | undefined),
        );
        return encode(toWireMessagePage(page));
      }),

    [ActivityNames.presenceHistory]: (input) =>
      run(async () => {
        const { channel: name, params } = input;
        const page = await leases.use(name, (channel) =>
          channel.presence.history(params as Ably.HttpHistoryParams | undefined),
        );
        return encode(toWireMessagePage(page));
      }),

    [ActivityNames.annotationsPublish]: (input) =>
      run(async () => {
        const { channel: name, messageOrSerial, annotation } = input;
        await leases.use(name, ({ annotations }) =>
          typeof messageOrSerial === 'string'
            ? annotations.publish(messageOrSerial, annotation)
            : annotations.publish(messageOrSerial, annotation),
        );
      }),

    [ActivityNames.annotationsDelete]: (input) =>
      run(async () => {
        const { channel: name, messageOrSerial, annotation } = input;
        await leases.use(name, ({ annotations }) =>
          typeof messageOrSerial === 'string'
            ? annotations.delete(messageOrSerial, annotation)
            : annotations.delete(messageOrSerial, annotation),
        );
      }),

    [ActivityNames.annotationsGet]: (input) =>
      run(async () => {
        const { channel: name, messageOrSerial, params } = input;
        const getParams = params as Ably.GetAnnotationsParams | null;
        const page = await leases.use(name, ({ annotations }) =>
          typeof messageOrSerial === 'string'
            ? annotations.get(messageOrSerial, getParams)
            : annotations.get(messageOrSerial, getParams),
        );
        return encode(toWireMessagePage(page));
      }),

    [ActivityNames.objectGet]: (input) =>
      run(async () => {
        const { channel: name, params } = input;
        return encode(await leases.use(name, (channel) => channel.object.get(params)));
      }),

    [ActivityNames.objectPublish]: (input) =>
      run(async () => {
        const { channel: name, operations } = input;
        // The `bytes` of each value are base64 strings, which the Ably SDK only sends as binary when given a Buffer.
        const decoded = Array.isArray(operations)
          ? operations.map((operation) => mapOperationBytes(operation, decodeBytes))
          : mapOperationBytes(operations, decodeBytes);
        return encode(await leases.use(name, (channel) => channel.object.publish(decoded)));
      }),

    [ActivityNames.time]: () => run(async () => encode(await client.time())),

    [ActivityNames.request]: (input) =>
      run(async () => {
        const { method, path, version, params, body, headers } = input;
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
        const { specs } = input;
        return Array.isArray(specs)
          ? encode(await client.batchPublish(specs))
          : encode(await client.batchPublish(specs));
      }),

    [ActivityNames.batchPresence]: (input) =>
      run(async () => {
        const { channels } = input;
        return encode((await client.batchPresence(channels)).map(encodeBatchPresenceData));
      }),

    [ActivityNames.pushPublish]: (input) =>
      run(async () => {
        const { recipient, payload } = input;
        await admin().publish(recipient, payload);
      }),

    [ActivityNames.pushCreateApnsBroadcast]: (input) =>
      run(async () => encode(await admin().createApnsBroadcast(input.argument))),

    [ActivityNames.pushLiveActivityStart]: (input) =>
      run(async () => {
        await admin().liveActivity.start(input.argument);
      }),

    [ActivityNames.pushLiveActivityUpdate]: (input) =>
      run(async () => {
        await admin().liveActivity.update(input.argument);
      }),

    [ActivityNames.pushLiveActivityEnd]: (input) =>
      run(async () => {
        await admin().liveActivity.end(input.argument);
      }),

    [ActivityNames.pushDeviceRegistrationsSave]: (input) =>
      run(async () => encode(await admin().deviceRegistrations.save(input.argument))),

    [ActivityNames.pushDeviceRegistrationsGet]: (input) =>
      run(async () => {
        const { argument } = input;
        const registrations = admin().deviceRegistrations;
        return encode(await (typeof argument === 'string' ? registrations.get(argument) : registrations.get(argument)));
      }),

    [ActivityNames.pushDeviceRegistrationsList]: (input) =>
      run(async () => {
        const { params } = input;
        const page = await admin().deviceRegistrations.list((params ?? {}) as Ably.DeviceRegistrationParams);
        return encode(toWirePage(page));
      }),

    [ActivityNames.pushDeviceRegistrationsRemove]: (input) =>
      run(async () => {
        const { argument } = input;
        const registrations = admin().deviceRegistrations;
        await (typeof argument === 'string' ? registrations.remove(argument) : registrations.remove(argument));
      }),

    [ActivityNames.pushDeviceRegistrationsRemoveWhere]: (input) =>
      run(async () => {
        await admin().deviceRegistrations.removeWhere(input.argument);
      }),

    [ActivityNames.pushChannelSubscriptionsSave]: (input) =>
      run(async () => encode(await admin().channelSubscriptions.save(input.argument))),

    [ActivityNames.pushChannelSubscriptionsList]: (input) =>
      run(async () => {
        const { params } = input;
        const page = await admin().channelSubscriptions.list((params ?? {}) as Ably.PushChannelSubscriptionParams);
        return encode(toWirePage(page));
      }),

    [ActivityNames.pushChannelSubscriptionsListChannels]: (input) =>
      run(async () => {
        const { params } = input;
        const page = await admin().channelSubscriptions.listChannels((params ?? {}) as Ably.PushChannelsParams);
        return encode(toWirePage(page));
      }),

    [ActivityNames.pushChannelSubscriptionsRemove]: (input) =>
      run(async () => {
        await admin().channelSubscriptions.remove(input.argument);
      }),

    [ActivityNames.pushChannelSubscriptionsRemoveWhere]: (input) =>
      run(async () => {
        await admin().channelSubscriptions.removeWhere(input.argument);
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

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('base64');
}

function decodeBytes(bytes: unknown): unknown {
  return typeof bytes === 'string' ? Buffer.from(bytes, 'base64') : bytes;
}

/**
 * Encodes an activity's result for the activity boundary, replacing binary data anywhere in it with a base64 string.
 * The result type is that of the value before encoding.
 */
function encode<T>(value: T): T {
  return toWireValue(value, base64) as T;
}

/** Encodes the binary `data` of a message, presence message or annotation as base64, with its `encoding`. */
function encodeData<T>(message: T): T {
  return encodeBinaryData(message, base64);
}

function encodeBatchPresenceData(
  batch: Ably.BatchResult<Ably.BatchPresenceSuccessResult | Ably.BatchPresenceFailureResult>,
): Ably.BatchResult<Ably.BatchPresenceSuccessResult | Ably.BatchPresenceFailureResult> {
  const results = batch.results.map((result) =>
    'presence' in result && Array.isArray(result.presence)
      ? { ...result, presence: result.presence.map((message) => encodeData(message)) }
      : result,
  );
  return { ...batch, results };
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

/** A page of messages, presence messages or annotations, with their binary `data` encoded as base64. */
function toWireMessagePage<T>(result: Ably.PaginatedResult<T>): WirePage<T> {
  return { items: result.items.map((item) => encodeData(item)), links: pageLinks(result) };
}
