import type { RealtimePublisherChannel } from '@ably/pubsub-server';
import { ApplicationFailure } from '@temporalio/common';
import { RELAY_UNSUPPORTED_EVENT_TYPE } from '../../common/relay.js';
import type { JsonValue } from '../../common/relay.js';

/**
 * An event read from a Workflow Stream, which a relay passes to its route's adaptor.
 *
 * @typeParam T - The type of the event's data, as the adaptor expects it. The relay does not check it: `data` is
 * whatever the source workflow published to the topic, decoded by the payload converter.
 */
export interface RelayEvent<T = unknown> {
  /** The Workflow Stream topic the event was published to. */
  topic: string;
  /** The event's offset in the Workflow Stream. */
  offset: number;
  /** The event, decoded with the worker client's payload converter. */
  data: T;
}

/** What a {@link RelayAdaptor} resolves with once everything written to it is on the channel. */
export interface RelayAdaptorResult {
  /**
   * The state the adaptor needs to carry on from this point, or `null` if it needs none. The relay stores it in
   * Temporal workflow history with its checkpoint, and passes it to the adaptor factory when it resumes, so keep it
   * small, and never include event content.
   */
  handoff: JsonValue | null;
}

/**
 * Turns the events of one route into Ably messages on one channel. The relay creates an adaptor for each activity
 * attempt, writes the route's events to it in stream order, and then either flushes it to record a checkpoint, or
 * closes it once the route has finished.
 *
 * `write()` returns at once. The adaptor publishes in the background, in the order of its writes. If the channel
 * refuses a publish, the adaptor stops: its next call, whether `write()`, `flush()` or `close()`, throws or rejects
 * with the channel's error. The relay then fails the activity. Temporal retries it from the route's last checkpoint if
 * the error is retryable, so the events since that checkpoint are written again to a new adaptor. A non-retryable
 * error fails the route: the relay stops relaying it, and reports it to the source through `relay.complete()`.
 *
 * For an event the adaptor can never write, such as an event type it doesn't know, `write()` throws
 * {@link unsupportedRelayEvent}, or any object whose `type` is {@link RELAY_UNSUPPORTED_EVENT_TYPE}. The relay then
 * skips that event, logs it, counts it, and carries on with the next. Any other error from `write()` fails the
 * activity, as above.
 *
 * When an activity attempt fails or is cancelled, the relay neither flushes nor closes its adaptor. It calls `abort()`
 * instead, if the adaptor has one, so that the adaptor stops before the retry adopts what it was writing. Publishes
 * already sent may still reach the channel after the retry's first publishes, so order is kept within an attempt but
 * not across attempts.
 *
 * @typeParam T - The type of event data the adaptor expects, which the relay does not check. If the route's topics
 * may carry anything else, check each event in `write()`, and throw {@link unsupportedRelayEvent} for one the
 * adaptor can't write.
 */
export interface RelayAdaptor<T = unknown> {
  /** Accepts an event for publishing. */
  write(event: RelayEvent<T>): void;
  /** Resolves once every event written so far is on the channel, with the handoff for this point. */
  flush(): Promise<RelayAdaptorResult>;
  /**
   * Resolves once every event written is on the channel, with the handoff for this point, and stops the adaptor. The
   * relay calls it once the route has finished.
   */
  close(): Promise<RelayAdaptorResult>;
  /**
   * Stops the adaptor at once, because its activity attempt has failed or been cancelled. Temporal retries the attempt
   * with a new adaptor, created from the route's last checkpoint, which carries on any stream this one was writing. So
   * do not end or mark any stream, and do not wait for publishes in progress. Stop anything that would write to the
   * channel later, such as queued writes or repairs, so that nothing from this adaptor overwrites what the retry
   * writes. Ignore any later call to `write()`, `flush()` or `close()`, which the relay does not make.
   *
   * The relay may call it after the adaptor has stopped on an error, and it must not throw. Optional: an adaptor that
   * publishes each event at once in `write()` and keeps nothing to send later needs none.
   */
  abort?(): void;
}

/**
 * Creates the adaptor for one activity attempt of a route.
 *
 * @param channel - The route's channel, which the relay releases once the attempt ends. The adaptor must not use it
 * after its `flush()` or `close()` has settled for the last time.
 * @param handoff - The handoff of the route's last checkpoint, or `null` when the route starts.
 * @typeParam T - The type of event data the adaptor expects, as described on {@link RelayAdaptor}.
 */
export type RelayAdaptorFactory<T = unknown> = (
  channel: RealtimePublisherChannel,
  handoff: JsonValue | null,
) => RelayAdaptor<T>;

/**
 * Creates the error with which an adaptor's `write()` rejects one event it can never write, such as an event type it
 * doesn't know, for example from a producer newer than the adaptor. The relay skips the event, logs it with its route,
 * topic and offset, counts it in the route's outcome, and carries on with the next event. Use it only for a problem
 * with this one event: an error that would recur for every event, such as a channel refusing publishes, must fail the
 * route instead.
 *
 * The relay recognises the error by its `type` alone, not by its class. An adaptor without a Temporal dependency, such
 * as one that browsers also import, can throw any object whose `type` is {@link RELAY_UNSUPPORTED_EVENT_TYPE}, for
 * example an `Ably.ErrorInfo` with that `type` set. The relay logs its `message` as the reason.
 *
 * ```ts
 * write(event) {
 *   if (!isKnownChunk(event.data)) throw unsupportedRelayEvent(`unknown chunk type ${event.data.type}`);
 *   ...
 * }
 * ```
 *
 * @param reason - Why the adaptor can't write the event, for the relay's log.
 */
export function unsupportedRelayEvent(reason: string): ApplicationFailure {
  return ApplicationFailure.create({ type: RELAY_UNSUPPORTED_EVENT_TYPE, message: reason, nonRetryable: true });
}

/**
 * Returns an adaptor factory that publishes each event as one Ably message, named after the event's topic, with the
 * event as its data. Its handoff is always `null`, since each message stands alone.
 *
 * It has no `abort()`, since it publishes each event in `write()` and keeps nothing to send later.
 *
 * Messages are published in stream order within an activity attempt. A retried activity publishes the events since
 * its last checkpoint again, so a subscriber may receive an event more than once.
 */
export function publishPerEvent(): RelayAdaptorFactory {
  return (channel) => new PerEventAdaptor(channel);
}

class PerEventAdaptor implements RelayAdaptor {
  private readonly publishing = new Set<Promise<unknown>>();
  private error: { reason: unknown } | undefined;
  private closed = false;

  constructor(private readonly channel: RealtimePublisherChannel) {}

  write(event: RelayEvent): void {
    this.throwIfStopped();
    const publish = this.channel.publish(event.topic, event.data);
    this.publishing.add(publish);
    publish.then(
      () => this.publishing.delete(publish),
      (reason: unknown) => {
        this.publishing.delete(publish);
        this.error ??= { reason };
      },
    );
  }

  async flush(): Promise<RelayAdaptorResult> {
    this.throwIfStopped();
    await this.settle();
    return { handoff: null };
  }

  async close(): Promise<RelayAdaptorResult> {
    this.throwIfStopped();
    this.closed = true;
    await this.settle();
    return { handoff: null };
  }

  /** Waits for every publish in progress, and throws the first error that any publish rejected with. */
  private async settle(): Promise<void> {
    await Promise.allSettled([...this.publishing]);
    if (this.error) {
      throw this.error.reason;
    }
  }

  private throwIfStopped(): void {
    if (this.error) {
      throw this.error.reason;
    }
    if (this.closed) {
      throw new Error('The relay adaptor is closed, so it accepts no further calls.');
    }
  }
}
