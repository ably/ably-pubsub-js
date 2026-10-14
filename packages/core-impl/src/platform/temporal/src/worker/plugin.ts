import { createHttpClient } from '@ably/pubsub-server';
import type * as Ably from '@ably/pubsub-core/api';
import { SimplePlugin } from '@temporalio/plugin';
import { createActivities } from './activities.js';

/**
 * Options for {@link AblyRestPlugin}. Provide either `ably`, for the plugin to construct its own HTTP client, or
 * `client`, to use an existing one.
 */
export type AblyRestPluginOptions = (
  | {
      /** The options with which the plugin constructs the `PubSubHttpClient` that its activities use. */
      ably: Ably.ClientOptions;
      client?: never;
    }
  | {
      /** An existing Ably HTTP client for the plugin's activities to use. */
      client: Ably.PubSubHttpClient;
      ably?: never;
    }
) & {
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
};

/**
 * A Temporal worker plugin that registers the Ably activities, which perform Ably REST operations on behalf of
 * workflows. Workflow code calls them through `TemporalRest` from `@ably/pubsub-server/temporal/workflow`.
 *
 * ```ts
 * const worker = await Worker.create({
 *   // ...
 *   plugins: [new AblyRestPlugin({ ably: { key: process.env.ABLY_API_KEY } })],
 * });
 * ```
 *
 * The activities are registered under the names in {@link ActivityNames}, which all start with `ably.`.
 */
export class AblyRestPlugin extends SimplePlugin {
  /** The Ably HTTP client that the plugin's activities use. */
  readonly client: Ably.PubSubHttpClient;

  /**
   * @param options - The plugin options. Exactly one of `ably` and `client` must be provided.
   * @throws An `Error` if both or neither of `ably` and `client` are provided.
   */
  constructor(options: AblyRestPluginOptions) {
    const client = resolveClient(options);
    super({
      name: 'AblyRestPlugin',
      activities: createActivities(client, {
        temporalMetadata: options.temporalMetadata,
        channelOptions: options.channelOptions,
      }),
    });
    this.client = client;
  }
}

function resolveClient(options: AblyRestPluginOptions | undefined): Ably.PubSubHttpClient {
  const { ably, client } = options ?? {};
  if (ably != null && client != null) {
    throw new Error(
      'AblyRestPlugin options include both `ably` and `client`. Pass `ably` with the ClientOptions for the plugin to construct an HTTP client, or `client` with an existing PubSubHttpClient, but not both.',
    );
  }
  if (client != null) {
    return client;
  }
  if (ably == null) {
    throw new Error(
      'AblyRestPlugin options include neither `ably` nor `client`. Pass `ably` with the ClientOptions for the plugin to construct an HTTP client, for example `{ ably: { key: process.env.ABLY_API_KEY } }`, or `client` with an existing PubSubHttpClient.',
    );
  }
  return createHttpClient(ably);
}
