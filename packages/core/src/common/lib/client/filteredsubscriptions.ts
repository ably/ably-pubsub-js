import * as API from '../../../../ably';
import RealtimeChannel from './realtimechannel';
import Message from '../types/message';

export class FilteredSubscriptions {
  static subscribeFilter(channel: RealtimeChannel, filter: API.MessageFilter, listener: API.messageCallback<Message>) {
    const filteredListener = (m: Message) => {
      const mapping: { [key in keyof API.MessageFilter]: any } = {
        name: m.name,
        refTimeserial: m.extras?.ref?.timeserial,
        refType: m.extras?.ref?.type,
        isRef: !!m.extras?.ref?.timeserial,
        clientId: m.clientId,
      };
      // Check if any values are defined in the filter and if they match the value in the message object
      if (
        Object.entries(filter).find(([key, value]) =>
          value !== undefined ? mapping[key as keyof API.MessageFilter] !== value : false,
        )
      ) {
        return;
      }
      listener(m);
    };
    this.addFilteredSubscription(channel, filter, listener, filteredListener);
    channel.subscriptions.on(filteredListener);
  }

  // Adds a new filtered subscription
  static addFilteredSubscription(
    channel: RealtimeChannel,
    filter: API.MessageFilter,
    realListener: API.messageCallback<Message>,
    filteredListener: API.messageCallback<Message>,
  ) {
    if (!channel.filteredSubscriptions) {
      channel.filteredSubscriptions = new Map<
        API.messageCallback<Message>,
        Map<API.MessageFilter, API.messageCallback<Message>[]>
      >();
    }
    if (channel.filteredSubscriptions.has(realListener)) {
      const realListenerMap = channel.filteredSubscriptions.get(realListener) as Map<
        API.MessageFilter,
        API.messageCallback<Message>[]
      >;
      // Add the filtered listener to the map, or append to the array if this filter has already been used
      realListenerMap.set(filter, realListenerMap?.get(filter)?.concat(filteredListener) || [filteredListener]);
    } else {
      channel.filteredSubscriptions.set(
        realListener,
        new Map<API.MessageFilter, API.messageCallback<Message>[]>([[filter, [filteredListener]]]),
      );
    }
  }

  static getAndDeleteFilteredSubscriptions(
    channel: RealtimeChannel,
    filter: API.MessageFilter | undefined,
    realListener: API.messageCallback<Message> | undefined,
  ): API.messageCallback<Message>[] {
    // No filtered subscriptions map means there has been no filtered subscriptions yet, so return nothing
    if (!channel.filteredSubscriptions) {
      return [];
    }
    // Only a filter is passed in with no specific listener
    if (!realListener && filter) {
      // Return each listener which is attached to the specified filter object
      return Array.from(channel.filteredSubscriptions.entries())
        .map(([key, filterMaps]) => {
          // Get (then delete) the maps matching this filter
          let listenerMaps = filterMaps.get(filter);
          filterMaps.delete(filter);
          // Clear the parent if nothing is left
          if (filterMaps.size === 0) {
            channel.filteredSubscriptions?.delete(key);
          }
          return listenerMaps;
        })
        .reduce(
          (prev, cur) => (cur ? (prev as API.messageCallback<Message>[]).concat(...cur) : prev),
          [],
        ) as API.messageCallback<Message>[];
    }

    // No subscriptions for this listener
    if (!realListener || !channel.filteredSubscriptions.has(realListener)) {
      return [];
    }
    const realListenerMap = channel.filteredSubscriptions.get(realListener) as Map<
      API.MessageFilter,
      API.messageCallback<Message>[]
    >;
    // If no filter is specified return all listeners using that function
    if (!filter) {
      // array.flat is not available unless we support es2019 or higher
      const listeners = Array.from(realListenerMap.values()).reduce((prev, cur) => prev.concat(...cur), []);
      // remove the listener from the map
      channel.filteredSubscriptions.delete(realListener);
      return listeners;
    }

    let listeners = realListenerMap.get(filter);
    realListenerMap.delete(filter);

    return listeners || [];
  }
}
