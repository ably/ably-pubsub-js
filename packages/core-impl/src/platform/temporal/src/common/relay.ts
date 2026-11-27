// The contract between the relay workflow and the relay activity: the activity name, its input and its result, and
// the reserved topic through which a source workflow signals the end of its stream.
//
// Shared between the workflow and worker entry points, so this module must stay workflow-safe. It imports nothing at
// runtime.
//
// The activity's input and result are stored in workflow history, and during a rolling deploy an activity that one
// release's relay scheduled can run on a worker of another. So change these types only in ways that both the old and
// the new code can read, such as by adding an optional field.

/** A JSON value, as a {@link RelayCheckpoint.handoff} must be, since it is stored in Temporal workflow history. */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/**
 * The Workflow Stream topic reserved for the relay's own events. The relay activity subscribes to it on every route,
 * and never passes its events to an adaptor. Source workflows must not publish to it themselves.
 */
export const RELAY_TOPIC = '__ably';

/** The `type` of the event on {@link RELAY_TOPIC} that marks the end of the source workflow's stream. */
export const END_OF_STREAM = '__ably_end_of_stream';

/**
 * The `type` of the event on {@link RELAY_TOPIC} that a relay activity publishes to end the reads that the source
 * workflow holds for it. Relays ignore it.
 */
export const WAKE = '__ably_wake';

/** An event on {@link RELAY_TOPIC}. */
export interface RelayTopicEvent {
  type: typeof END_OF_STREAM | typeof WAKE;
}

/** The name under which the relay activity is registered on the worker. */
export const RELAY_ACTIVITY_NAME = 'ably.relay.route';

/** Which Workflow Stream topics a route relays, to which Ably channel, and through which adaptor. */
export interface RelayRoute {
  /** The Workflow Stream topics whose events the route relays. Must not include {@link RELAY_TOPIC}. */
  topics: string[];
  /** The name of the adaptor, as registered in the worker plugin's `adaptors` option. */
  adaptor: string;
  /** The name of the Ably channel that the route publishes to. */
  channel: string;
}

/**
 * How far a route has relayed its topics: the Workflow Stream offset to read from next, and the adaptor's handoff
 * for that point. A route starts from offset 0 of the source's first run, with a `null` handoff.
 */
export interface RelayCheckpoint {
  offset: number;
  handoff: JsonValue | null;
  /**
   * The run of the source workflow that `offset` belongs to. A route starts from the source's first run, and follows
   * each Continue-As-New to the next.
   */
  runId: string;
}

/** When a relay activity returns a checkpoint, so that a retry or the next activity resumes close to where it was. */
export interface RelayCheckpointOptions {
  /**
   * The number of route events an activity relays before it checkpoints. Events on {@link RELAY_TOPIC} do not count.
   * Defaults to {@link DEFAULT_CHECKPOINT_BUDGET}.
   */
  checkpointBudget?: number;
  /**
   * How long, in milliseconds, an activity waits for the next event, once it has relayed one, before it checkpoints.
   * Defaults to {@link DEFAULT_IDLE_CHECKPOINT_MS}.
   */
  idleCheckpointMs?: number;
}

export const DEFAULT_CHECKPOINT_BUDGET = 100;
export const DEFAULT_IDLE_CHECKPOINT_MS = 30_000;

/** Input for the relay activity, which relays one route from a checkpoint. */
export interface RelayActivityInput {
  /** The ID of the workflow whose Workflow Stream the route reads. */
  sourceWorkflowId: string;
  route: RelayRoute;
  checkpoint: RelayCheckpoint;
  options?: RelayCheckpointOptions;
}

/**
 * Why a relay activity returned, with the route's checkpoint at that point.
 *
 * - `checkpoint`: the activity reached its budget, went quiet, or neared its deadline. The route is still running,
 *   and the next activity continues from the checkpoint.
 * - `completed`: the source workflow published the end-of-stream event. The adaptor is closed.
 * - `source-closed`: the source workflow closed without publishing the end-of-stream event. The adaptor is closed.
 */
export interface RelayActivityResult extends RelayCheckpoint {
  status: 'checkpoint' | 'completed' | 'source-closed';
  /** The route events this activity skipped because its adaptor rejected them as unsupported. */
  skipped: number;
}

/**
 * The `type` of the error with which an adaptor rejects one event it can never write, such as an event type it doesn't
 * know. The relay skips that event, logs it, and counts it, rather than failing the route.
 *
 * This string is the contract. The relay checks the thrown value's `type`, not its class, so any object whose `type`
 * is this string counts, and its `message` is logged as the reason. An adaptor with a Temporal dependency can create
 * one with `unsupportedRelayEvent()` from `@ably/pubsub-server/temporal`. One without, such as an adaptor that browsers
 * also import, can throw its own error, for example an `Ably.ErrorInfo`, with `type` set to this string.
 */
export const RELAY_UNSUPPORTED_EVENT_TYPE = 'AblyRelayUnsupportedEvent';

/** How one route of a relay ended. */
export interface RelayRouteOutcome {
  /** The route's Ably channel. */
  channel: string;
  /** The route's Workflow Stream topics. */
  topics: string[];
  /**
   * `completed` when the route relayed every event before the end-of-stream event. `failed` when its activity failed
   * and wasn't retried, for example because the channel refused a publish permanently. The route's other events were
   * not relayed after that point, and any response it was streaming was left open.
   */
  status: 'completed' | 'failed';
  /** The route events skipped because the adaptor rejected them as unsupported. */
  skipped: number;
  /** Why the route failed, when it did. */
  error?: { message: string; type?: string };
}

/**
 * What `relay.complete()` resolves with.
 *
 * - `succeeded`: every route relayed every event published before `complete()`. Some may have been skipped as
 *   unsupported: see each route's `skipped`.
 * - `failed`: at least one route failed. The routes say which, and why. The others relayed every event.
 * - `timed-out`: the relay did not report within `completeTimeoutMs`. `routes` is empty.
 */
export interface AblyRelayCompletion {
  status: 'succeeded' | 'failed' | 'timed-out';
  routes: RelayRouteOutcome[];
}

/** The relay activity, keyed by its name, as the workflow passes it to `proxyActivities()`. */
export interface RelayActivities {
  [RELAY_ACTIVITY_NAME](input: RelayActivityInput): Promise<RelayActivityResult>;
}
