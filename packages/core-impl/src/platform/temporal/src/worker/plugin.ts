import type * as Ably from '@ably/pubsub-core/api';
import { createHttpClient } from '@ably/pubsub-server';
import { SimplePlugin } from '@temporalio/plugin';
import { createActivities } from './activities.js';

/** Options for {@link AblyHttpPlugin}. */
export interface AblyHttpPluginOptions {
  /**
   * The options of the Ably HTTP client that the plugin creates for its activities, as passed to `createHttpClient`
   * from `@ably/pubsub-server`. To use `channel.object` from workflows, include the `LiveObjects` plugin from
   * `@ably/pubsub-server/liveobjects` in `plugins`.
   */
  clientOptions: Ably.ClientOptions;
}

/**
 * A Temporal worker plugin that registers the Ably activities, which perform Ably REST operations on behalf of
 * workflows. Workflow code calls them through `TemporalAblyHttpClient` from `@ably/pubsub-server/temporal/workflow`.
 *
 * ```ts
 * const worker = await Worker.create({
 *   // ...
 *   plugins: [new AblyHttpPlugin({ clientOptions: { key: process.env.ABLY_API_KEY } })],
 * });
 * ```
 *
 * The plugin creates its own Ably HTTP client from `clientOptions`, which only its activities use. The activities are
 * registered under the names in {@link ActivityNames}, which all start with `ably.`.
 */
export class AblyHttpPlugin extends SimplePlugin {
  /**
   * @param options - The plugin options, including the options of the Ably HTTP client that the activities use.
   * @throws `TypeError` if `options.clientOptions` is not an object.
   */
  constructor(options: AblyHttpPluginOptions) {
    const clientOptions = validateClientOptions(options);
    super({
      name: 'AblyHttpPlugin',
      activities: createActivities(createHttpClient(clientOptions)),
    });
  }
}

/** Returns `options.clientOptions`, after checking that it is an object. */
function validateClientOptions(options: AblyHttpPluginOptions | undefined): Ably.ClientOptions {
  const clientOptions: unknown = options?.clientOptions;
  if (typeof clientOptions !== 'object' || clientOptions === null || Array.isArray(clientOptions)) {
    throw new TypeError(
      'AblyHttpPlugin options do not include the Ably ClientOptions object in `clientOptions`. Pass the options of the Ably HTTP client that the plugin creates for its activities, for example `new AblyHttpPlugin({ clientOptions: { key: process.env.ABLY_API_KEY } })`.',
    );
  }
  return clientOptions as Ably.ClientOptions;
}
