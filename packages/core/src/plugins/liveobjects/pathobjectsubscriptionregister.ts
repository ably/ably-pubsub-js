import type BaseClient from 'common/lib/client/baseclient';
import type { EventCallback, Subscription } from '../../../ably';
import type { PathObjectSubscriptionEvent, PathObjectSubscriptionOptions } from '../../../liveobjects';
import { ObjectMessage } from './objectmessage';
import { Path } from './path';
import { DefaultPathObject } from './pathobject';
import { RealtimeObject } from './realtimeobject';

/**
 * Internal subscription entry that tracks a listener and its options
 */
export interface SubscriptionEntry {
  /** The listener function to call when events match */
  listener: EventCallback<PathObjectSubscriptionEvent>;
  /** The subscription options including depth */
  options: PathObjectSubscriptionOptions;
  /** The path this subscription is registered for */
  path: Path;
}

/**
 * Event data that LiveObjects provide when notifying of changes
 */
export interface PathEvent {
  /**
   * Candidate paths for surfacing this event to subscriptions, in order of
   * decreasing preference. For a given subscription, the first candidate path
   * it covers is used as the path of `event.object` passed to its listener.
   */
  preferenceOrderedCandidatePaths: Path[];
  /** Object message that caused this event */
  message?: ObjectMessage;
}

/**
 * Registry for managing PathObject subscriptions and routing events to appropriate listeners.
 * Handles depth-based filtering for subscription matching.
 *
 * @internal
 */
export class PathObjectSubscriptionRegister {
  private _client: BaseClient;
  private _subscriptions: Map<string, SubscriptionEntry> = new Map();
  private _nextSubscriptionId = 0;

  constructor(private _realtimeObject: RealtimeObject) {
    this._client = this._realtimeObject.getClient();
  }

  /**
   * Registers a new subscription for the given path.
   *
   * @param path - Array of keys representing the path to subscribe to
   * @param listener - Function to call when matching events occur
   * @param options - Subscription options including depth parameter
   * @returns Unsubscribe function
   */
  subscribe(
    path: Path,
    listener: EventCallback<PathObjectSubscriptionEvent>,
    options: PathObjectSubscriptionOptions,
  ): Subscription {
    if (options == null || typeof options !== 'object') {
      throw new this._client.ErrorInfo('Subscription options must be an object', 40000, 400);
    }

    if (options.depth !== undefined && options.depth <= 0) {
      throw new this._client.ErrorInfo(
        'Subscription depth must be greater than 0 or undefined for infinite depth',
        40003,
        400,
      );
    }

    const subscriptionId = (this._nextSubscriptionId++).toString();
    const entry: SubscriptionEntry = {
      listener,
      options,
      path: [...path], // Make a copy to avoid external mutations
    };

    this._subscriptions.set(subscriptionId, entry);

    return {
      unsubscribe: () => {
        this._subscriptions.delete(subscriptionId);
      },
    };
  }

  /**
   * Dispatches a {@link PathEvent} to subscriptions. Each subscription that
   * covers any of the event's {@link PathEvent.preferenceOrderedCandidatePaths}
   * receives at most one notification, at the first covered path.
   */
  notifyPathEvent(event: PathEvent): void {
    for (const subscription of this._subscriptions.values()) {
      const chosenCoveredPath = event.preferenceOrderedCandidatePaths.find((path) =>
        this._subscriptionCoversPath(subscription, path),
      );
      if (chosenCoveredPath === undefined) {
        continue;
      }

      try {
        const subscriptionEvent: PathObjectSubscriptionEvent = {
          object: new DefaultPathObject(
            this._realtimeObject,
            this._realtimeObject.getPool().getRoot(),
            chosenCoveredPath,
          ),
          message: event.message?.toUserFacingMessage(this._realtimeObject.getChannel()),
        };

        subscription.listener(subscriptionEvent);
      } catch (error) {
        // Log error but don't let one subscription failure affect others
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MINOR,
          'PathObjectSubscriptionRegister.notifyPathEvent()',
          `Error in PathObject subscription listener; path=${JSON.stringify(chosenCoveredPath)}, error=${error}`,
        );
      }
    }
  }

  /**
   * Returns true if the given path falls within the area covered by the
   * subscription — that is, it starts with the subscription's path, and
   * extends it by at most `depth − 1` further segments.
   *
   * Coverage examples:
   * - subscription at ["users"] with depth=undefined: covers ["users"], ["users", "emma"], ["users", "emma", "visits"], etc.
   * - subscription at ["users"] with depth=1: covers ["users"] only
   * - subscription at ["users"] with depth=2: covers ["users"], ["users", "emma"] only
   * - subscription at ["users"] with depth=3: covers ["users"], ["users", "emma"], ["users", "emma", "visits"] only
   *
   * The depth calculation is: eventPath.length - subscriptionPath.length + 1
   * This means:
   * - Same level (["users"] -> ["users"]): 1 - 1 + 1 = 1 (depth=1)
   * - One level deeper (["users"] -> ["users", "emma"]): 2 - 1 + 1 = 2 (depth=2)
   * - Two levels deeper (["users"] -> ["users", "emma", "visits"]): 3 - 1 + 1 = 3 (depth=3)
   */
  private _subscriptionCoversPath(subscription: SubscriptionEntry, eventPath: Path): boolean {
    const subPath = subscription.path;
    const depth = subscription.options.depth;

    // Check if the event path starts with the subscription path
    if (!this._pathStartsWith(eventPath, subPath)) {
      return false;
    }

    // If depth is undefined, allow infinite depth
    if (depth === undefined) {
      return true;
    }

    // Otherwise calculate the relative depth from subscription path to event path
    const relativeDepth = eventPath.length - subPath.length + 1;

    // Check if the event is within the allowed depth
    return relativeDepth <= depth;
  }

  /**
   * Checks if eventPath starts with subscriptionPath.
   *
   * @param eventPath - The path where the event occurred
   * @param subscriptionPath - The path that was subscribed to
   * @returns true if eventPath starts with subscriptionPath
   */
  private _pathStartsWith(eventPath: Path, subscriptionPath: Path): boolean {
    if (subscriptionPath.length > eventPath.length) {
      return false;
    }

    for (let i = 0; i < subscriptionPath.length; i++) {
      if (eventPath[i] !== subscriptionPath[i]) {
        return false;
      }
    }

    return true;
  }
}
