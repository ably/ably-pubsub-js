import type * as Ably from '@ably/pubsub-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChannelParameters } from '../AblyReactHooks.js';
import { useChannelInstance } from './useChannelInstance.js';
import { useStateErrors } from './useStateErrors.js';
import { useChannelAttach } from './useChannelAttach.js';

interface PresenceMessage<T = any> extends Ably.PresenceMessage {
  data: T;
}

export interface PresenceListenerResult<T> {
  presenceData: PresenceMessage<T>[];
  connectionError: Ably.ErrorInfo | null;
  channelError: Ably.ErrorInfo | null;
}

export type OnPresenceMessageReceived<T> = (presenceData: PresenceMessage<T>) => void;

// The channel name can be omitted to use the channel from the nearest ChannelProvider.
export function usePresenceListener<T = any>(
  onPresenceMessageReceived?: OnPresenceMessageReceived<T>,
): PresenceListenerResult<T>;
export function usePresenceListener<T = any>(
  channelNameOrNameAndOptions: ChannelParameters,
  onPresenceMessageReceived?: OnPresenceMessageReceived<T>,
): PresenceListenerResult<T>;

export function usePresenceListener<T = any>(
  channelNameOrNameAndOptionsOrListener?: ChannelParameters | OnPresenceMessageReceived<T>,
  onPresenceMessageReceived?: OnPresenceMessageReceived<T>,
): PresenceListenerResult<T> {
  // The first argument is the listener when the channel name is inferred from a
  // surrounding ChannelProvider, e.g. usePresenceListener(listener).
  const inferChannelFromNearestProvider = typeof channelNameOrNameAndOptionsOrListener === 'function';
  const channelNameOrNameAndOptions = inferChannelFromNearestProvider
    ? undefined
    : (channelNameOrNameAndOptionsOrListener as ChannelParameters | undefined);
  const listener = inferChannelFromNearestProvider
    ? (channelNameOrNameAndOptionsOrListener as OnPresenceMessageReceived<T>)
    : onPresenceMessageReceived;

  const params =
    typeof channelNameOrNameAndOptions === 'object'
      ? channelNameOrNameAndOptions
      : channelNameOrNameAndOptions === undefined
        ? {}
        : { channelName: channelNameOrNameAndOptions };
  const skip = params.skip;

  const { channel } = useChannelInstance(params.ablyId, params.channelName);
  const { connectionError, channelError } = useStateErrors(params);
  const [presenceData, updatePresenceData] = useState<Array<PresenceMessage<T>>>([]);

  const onPresenceMessageReceivedRef = useRef(listener);
  useEffect(() => {
    onPresenceMessageReceivedRef.current = listener;
  }, [listener]);

  const updatePresence = useCallback(
    async (message?: Ably.PresenceMessage) => {
      const snapshot = await channel.presence.get();
      updatePresenceData(snapshot);

      onPresenceMessageReceivedRef.current?.(message);
    },
    [channel.presence],
  );

  const onMount = useCallback(async () => {
    channel.presence.subscribe(['enter', 'leave', 'update'], updatePresence);
    const snapshot = await channel.presence.get();
    updatePresenceData(snapshot);
  }, [channel.presence, updatePresence]);

  const onUnmount = useCallback(async () => {
    channel.presence.unsubscribe(['enter', 'leave', 'update'], updatePresence);
  }, [channel.presence, updatePresence]);

  useEffect(() => {
    if (skip) return;

    onMount();
    return () => {
      onUnmount();
    };
  }, [skip, onMount, onUnmount]);

  useChannelAttach(channel, params.ablyId, skip);

  return { presenceData, connectionError, channelError };
}
