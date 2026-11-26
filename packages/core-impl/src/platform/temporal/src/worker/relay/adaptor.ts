import type { RealtimePublisherChannel } from '@ably/pubsub-server';
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
 * `write()` returns at once. The adaptor publishes in the background, in the order of its writes. If the adaptor
 * cannot accept an event, `write()` throws. If the channel refuses a publish, the adaptor stops: its next call,
 * whether `write()`, `flush()` or `close()`, throws or rejects with the channel's error. The relay then fails the
 * activity, and Temporal retries it from the route's last checkpoint, so the events since that checkpoint are
 * written again to a new adaptor.
 *
 * The relay neither flushes nor closes an adaptor whose activity fails or is cancelled. Publishes that it had in
 * progress may still reach the channel after the retry's first publishes, so order is kept within an attempt but not
 * across attempts.
 *
 * @typeParam T - The type of event data the adaptor expects, which the relay does not check. If the route's topics
 * may carry anything else, check each event in `write()`, and throw `ApplicationFailure.nonRetryable()` from
 * `@temporalio/common` for one the adaptor can never handle. Any other error is retried, and the retry meets the same
 * event again.
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
 * Returns an adaptor factory that publishes each event as one Ably message, named after the event's topic, with the
 * event as its data. Its handoff is always `null`, since each message stands alone.
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
