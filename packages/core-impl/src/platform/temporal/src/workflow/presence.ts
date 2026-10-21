import type * as Ably from '@ably/pubsub-core/api';
import { ActivityNames } from '../common/activities.js';
import type { ActivityInvoker } from './invoker.js';
import { paginate, pageSummary, type TemporalAblyPaginatedResult } from './paginated.js';

/**
 * Retrieves the current and historic presence set of a channel from workflow code. It mirrors the Ably REST
 * `Presence`, and is obtained from `TemporalAblyHttpChannel.presence`.
 *
 * Each method runs as a Temporal activity.
 */
export class TemporalAblyHttpPresence {
  /** @internal */
  constructor(
    private readonly invoker: ActivityInvoker,
    private readonly channel: string,
  ) {}

  /**
   * Retrieves the members currently present on the channel. Runs as a Temporal activity.
   *
   * @param params - Restricts which presence members are retrieved.
   * @returns A promise which is fulfilled with the first page of {@link Ably.PresenceMessage} objects.
   */
  async get(params?: Ably.HttpPresenceParams): Promise<TemporalAblyPaginatedResult<Ably.PresenceMessage>> {
    return paginate(
      (pageParams, relation) =>
        this.invoker.invoke(ActivityNames.presenceGet, pageSummary(`presence.get ${this.channel}`, relation), {
          channel: this.channel,
          params: pageParams,
        }),
      params,
    );
  }

  /**
   * Retrieves the presence history of the channel. Runs as a Temporal activity.
   *
   * @param params - Restricts which presence messages are retrieved.
   * @returns A promise which is fulfilled with the first page of {@link Ably.PresenceMessage} objects.
   */
  async history(params?: Ably.HttpHistoryParams): Promise<TemporalAblyPaginatedResult<Ably.PresenceMessage>> {
    return paginate(
      (pageParams, relation) =>
        this.invoker.invoke(ActivityNames.presenceHistory, pageSummary(`presence.history ${this.channel}`, relation), {
          channel: this.channel,
          params: pageParams,
        }),
      params,
    );
  }
}
