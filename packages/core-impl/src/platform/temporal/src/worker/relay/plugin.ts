import type { RealtimeChannelPool } from '@ably/pubsub-server';
import { SimplePlugin } from '@temporalio/plugin';
import { version } from '../../version.js';
import type { RelayAdaptorFactory } from './adaptor.js';
import { createRelayActivities } from './activity.js';

/** Options for {@link AblyRelayPlugin}. */
export interface AblyRelayPluginOptions {
  /**
   * The realtime channel pool that the relay publishes through, from `createRealtimeChannelPool` in
   * `@ably/pubsub-server`. The plugin borrows it: open it before the worker runs, and close it once the worker has
   * shut down.
   */
  pool: RealtimeChannelPool;
  /**
   * The adaptors that routes can use, keyed by the name a route gives in its `adaptor`. Register the same names on
   * every worker that polls the relay's task queue.
   */
  adaptors: Record<string, RelayAdaptorFactory>;
}

/**
 * A Temporal worker plugin that registers the relay activity, which relays a workflow's Workflow Stream to Ably
 * channels.
 *
 * The activity is registered under a name that starts with `ably.`, like the activities of `AblyHttpPlugin`, so do not
 * give your own activities names that start with `ably.`.
 */
export class AblyRelayPlugin extends SimplePlugin {
  /**
   * @param options - The channel pool to publish through, and the adaptors that routes can use.
   * @throws `TypeError` if `options.pool` is not a channel pool, or `options.adaptors` is not an object of functions.
   */
  constructor(options: AblyRelayPluginOptions) {
    const { pool, adaptors } = validateOptions(options);
    super({
      name: 'AblyRelayPlugin',
      version,
      activities: createRelayActivities(pool, adaptors),
    });
  }
}

function validateOptions(options: AblyRelayPluginOptions | undefined): AblyRelayPluginOptions {
  const pool: unknown = options?.pool;
  if (typeof (pool as Partial<RealtimeChannelPool> | null)?.get !== 'function') {
    throw new TypeError(
      'AblyRelayPlugin options do not include a realtime channel pool in `pool`. Create one with `createRealtimeChannelPool` from `@ably/pubsub-server`, open it, and pass it, for example `new AblyRelayPlugin({ pool, adaptors: { events: publishPerEvent() } })`.',
    );
  }
  const adaptors: unknown = options?.adaptors;
  if (typeof adaptors !== 'object' || adaptors === null || Array.isArray(adaptors)) {
    throw new TypeError(
      'AblyRelayPlugin options do not include an object of adaptor factories in `adaptors`. Pass the adaptors that routes can use, keyed by name, for example `{ events: publishPerEvent() }`.',
    );
  }
  for (const [name, factory] of Object.entries(adaptors)) {
    if (typeof factory !== 'function') {
      throw new TypeError(
        `AblyRelayPlugin's adaptor "${name}" is not a function. Pass an adaptor factory, such as the one \`publishPerEvent()\` returns.`,
      );
    }
  }
  return { pool: pool as RealtimeChannelPool, adaptors: adaptors as Record<string, RelayAdaptorFactory> };
}
