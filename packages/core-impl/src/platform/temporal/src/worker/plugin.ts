import type * as Ably from '@ably/pubsub-core/api';
import { createHttpClient } from '@ably/pubsub-server';
import { SimplePlugin } from '@temporalio/plugin';
import { version } from '../version.js';
import { createActivities, currentCancellationSignal } from './activities.js';

/** Options for {@link AblyHttpPlugin}. */
export interface AblyHttpPluginOptions {
  /**
   * The options of the Ably HTTP client that the plugin creates for its activities, as passed to `createHttpClient`
   * from `@ably/pubsub-server`. To use `channel.object` from workflows, include the `LiveObjects` plugin from
   * `@ably/pubsub-server/liveobjects` in `plugins`.
   */
  clientOptions: Ably.ClientOptions;
}

/** The worker options, typed from `SimplePlugin` because `@temporalio/worker` is not a dependency of this package. */
type WorkerOptions = Parameters<SimplePlugin['configureWorker']>[0];

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
 * registered under the names in {@link ActivityNames}, which all start with `ably.`, so do not give your own activities
 * names that start with `ably.`. Each worker takes one `AblyHttpPlugin`.
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
      version,
      activities: pluginActivities(createActivities(createHttpClient(withCancellation(clientOptions)))),
    });
  }

  /**
   * Adds the Ably activities to the worker's options.
   *
   * @throws `TypeError` if the worker already has a different activity under one of their names: an activity in the
   * worker's `activities`, or one from another `AblyHttpPlugin`. Adding the same plugin instance twice does not throw.
   */
  override configureWorker(options: WorkerOptions): WorkerOptions {
    checkNotRegistered(options.activities, this.options.activities as Record<string, unknown>);
    return super.configureWorker(options);
  }
}

/** The activities of every `AblyHttpPlugin`, which tell another plugin's activities apart from the application's. */
const registeredByPlugin = new WeakSet<object>();

/** Records `activities` as those of an `AblyHttpPlugin`, and returns them. */
function pluginActivities<T extends object>(activities: T): T {
  for (const activity of Object.values(activities)) {
    registeredByPlugin.add(activity);
  }
  return activities;
}

/**
 * Throws if `existing`, the worker's activities so far, has an activity under one of the names in `ours` other than
 * the one in `ours`. The worker would otherwise replace it with ours without warning.
 */
function checkNotRegistered(existing: object | undefined, ours: Record<string, unknown>): void {
  if (existing === undefined) {
    return;
  }
  const replaced = Object.keys(ours).filter((name) => {
    // The worker registers only the functions among the own enumerable properties of `activities`.
    if (!Object.prototype.propertyIsEnumerable.call(existing, name)) {
      return false;
    }
    const activity = (existing as Record<string, unknown>)[name];
    return typeof activity === 'function' && activity !== ours[name];
  });
  if (replaced.length === 0) {
    return;
  }
  if (replaced.some((name) => registeredByPlugin.has((existing as Record<string, object>)[name]))) {
    throw new TypeError(
      'The worker already has another AblyHttpPlugin, whose activities this AblyHttpPlugin would replace. Add one AblyHttpPlugin to each worker. To use Ably with different client options, add each AblyHttpPlugin to a worker on its own task queue, and set `activityOptions.taskQueue` in the TemporalAblyHttpClient options to choose the task queue in workflow code.',
    );
  }
  const names = replaced.map((name) => `'${name}'`).join(', ');
  throw new TypeError(
    `The worker's activities already include ${replaced.length === 1 ? 'an activity' : 'activities'} named ${names}, which AblyHttpPlugin would replace with its own. Rename your activities so that their names do not start with \`ably.\`. If you add the activities from createActivities yourself, do not also add AblyHttpPlugin.`,
  );
}

/**
 * `requestSignal` is an internal option of the Ably client, absent from the public `ClientOptions`. The client calls it
 * once for each request, and abandons the request once the signal it returns has aborted.
 */
type ClientOptionsWithRequestSignal = Ably.ClientOptions & { requestSignal: () => AbortSignal | undefined };

/**
 * Returns a copy of `clientOptions` that abandons each request once Temporal cancels the activity that makes it, or
 * times its attempt out.
 */
function withCancellation(clientOptions: Ably.ClientOptions): Ably.ClientOptions {
  const options: ClientOptionsWithRequestSignal = { ...clientOptions, requestSignal: currentCancellationSignal };
  return options;
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
