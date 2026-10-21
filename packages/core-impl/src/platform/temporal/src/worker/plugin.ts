import type * as Ably from '@ably/pubsub-core/api';
import { SimplePlugin } from '@temporalio/plugin';
import { createActivities } from './activities.js';

/** Options for {@link AblyHttpPlugin}. */
export interface AblyHttpPluginOptions {
  /**
   * The `PubSubHttpClient` that the plugin's activities use. Create it with `createHttpClient` from
   * `@ably/pubsub-server`. To use `channel.object` from workflows, create it with the `LiveObjects` plugin from
   * `@ably/pubsub-server/liveobjects`.
   */
  client: Ably.PubSubHttpClient;
  /**
   * Whether to record the Temporal execution that performed each operation. When enabled, the
   * {@link TemporalMetadataKeys | Temporal metadata} is added to the `extras.headers` of every published message,
   * and to the `metadata` of every update, delete and append operation. The application's own header or metadata
   * values take precedence over the plugin's when their keys collide.
   *
   * @defaultValue `true`
   */
  temporalMetadata?: boolean;
  /**
   * Returns the options, such as a `cipher`, for a channel that workflows use. Every operation on the channel uses
   * these options, so channel options are configured on the worker rather than in workflow code, and cipher keys
   * stay out of the workflow history. Return `undefined` for a channel that needs no options.
   *
   * A channel that the application already got from `client` keeps the options the application gave it.
   *
   * ```ts
   * channelOptions: (name) => (name.startsWith('secure:') ? { cipher: { key: process.env.CHANNEL_KEY } } : undefined),
   * ```
   */
  channelOptions?: (name: string) => Ably.ChannelOptions | undefined;
}

/**
 * A Temporal worker plugin that registers the Ably activities, which perform Ably REST operations on behalf of
 * workflows. Workflow code calls them through `TemporalAblyHttpClient` from `@ably/pubsub-server/temporal/workflow`.
 *
 * ```ts
 * const client = createHttpClient({ key: process.env.ABLY_API_KEY });
 *
 * const worker = await Worker.create({
 *   // ...
 *   plugins: [new AblyHttpPlugin({ client })],
 * });
 * ```
 *
 * The activities are registered under the names in {@link ActivityNames}, which all start with `ably.`.
 */
export class AblyHttpPlugin extends SimplePlugin {
  /** The Ably HTTP client that the plugin's activities use. */
  readonly client: Ably.PubSubHttpClient;

  /**
   * @param options - The plugin options, including the Ably HTTP client that the activities use.
   * @throws `TypeError` if `options.client` is not a `PubSubHttpClient`.
   */
  constructor(options: AblyHttpPluginOptions) {
    const client = validateClient(options);
    super({
      name: 'AblyHttpPlugin',
      activities: createActivities(client, {
        temporalMetadata: options.temporalMetadata,
        channelOptions: options.channelOptions,
      }),
    });
    this.client = client;
  }
}

/**
 * Returns `options.client`, after checking that it is a `PubSubHttpClient`. The check is structural, because the
 * client may come from a different copy of `@ably/pubsub-server` than the one the application imports. A realtime
 * client from `createRealtimeClient` is rejected: it has a `connection`, and its channels publish over that
 * connection rather than with an HTTP request.
 */
function validateClient(options: AblyHttpPluginOptions | undefined): Ably.PubSubHttpClient {
  const client: unknown = options?.client;
  if (
    typeof client !== 'object' ||
    client === null ||
    typeof (client as Ably.PubSubHttpClient).channels?.get !== 'function' ||
    typeof (client as Ably.PubSubHttpClient).request !== 'function' ||
    'connection' in client
  ) {
    throw new TypeError(
      'AblyHttpPlugin options do not include a PubSubHttpClient in `client`. Create the client with `createHttpClient` from `@ably/pubsub-server` and pass it as `client`, for example `new AblyHttpPlugin({ client: createHttpClient({ key: process.env.ABLY_API_KEY }) })`. A realtime client from `createRealtimeClient` is not accepted.',
    );
  }
  return client as Ably.PubSubHttpClient;
}
