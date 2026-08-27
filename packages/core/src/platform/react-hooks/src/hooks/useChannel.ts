import * as Ably from '@ably/pubsub-core';
import { useEffect, useMemo, useRef } from 'react';
import { ChannelParameters } from '../AblyReactHooks.js';
import { useAbly } from './useAbly.js';
import { useStateErrors } from './useStateErrors.js';
import { useChannelInstance } from './useChannelInstance.js';
import { useChannelAttach } from './useChannelAttach.js';

export type AblyMessageCallback = Ably.messageCallback<Ably.Message>;

export interface ChannelResult {
  channel: Ably.RealtimeChannel;
  publish: Ably.RealtimeChannel['publish'];
  history: Ably.RealtimeChannel['history'];
  ably: Ably.RealtimeClient;
  connectionError: Ably.ErrorInfo | null;
  channelError: Ably.ErrorInfo | null;
}

type SubscribeArgs = [string, AblyMessageCallback] | [AblyMessageCallback];

// The channel name can be omitted to use the channel from the nearest ChannelProvider.
export function useChannel(callbackOnMessage?: AblyMessageCallback): ChannelResult;
export function useChannel(
  channelNameOrNameAndOptions: ChannelParameters,
  callbackOnMessage?: AblyMessageCallback,
): ChannelResult;
export function useChannel(
  channelNameOrNameAndOptions: ChannelParameters,
  event: string,
  callbackOnMessage?: AblyMessageCallback,
): ChannelResult;

export function useChannel(
  channelNameOrNameAndOptionsOrCallback?: ChannelParameters | AblyMessageCallback,
  eventOrCallback?: string | AblyMessageCallback,
  callback?: AblyMessageCallback,
): ChannelResult {
  // The first argument is the message callback when the channel name is
  // inferred from a surrounding ChannelProvider, e.g. useChannel(listener).
  const inferChannelFromNearestProvider = typeof channelNameOrNameAndOptionsOrCallback === 'function';
  const channelNameOrNameAndOptions = inferChannelFromNearestProvider
    ? undefined
    : (channelNameOrNameAndOptionsOrCallback as ChannelParameters | undefined);
  const eventOrCallbackArg = inferChannelFromNearestProvider
    ? (channelNameOrNameAndOptionsOrCallback as AblyMessageCallback)
    : eventOrCallback;

  const channelHookOptions =
    typeof channelNameOrNameAndOptions === 'object'
      ? channelNameOrNameAndOptions
      : channelNameOrNameAndOptions === undefined
        ? {}
        : { channelName: channelNameOrNameAndOptions };

  const ably = useAbly(channelHookOptions.ablyId);
  const { skip } = channelHookOptions;

  const { channel, derived, channelName } = useChannelInstance(
    channelHookOptions.ablyId,
    channelHookOptions.channelName,
  );

  const publish: Ably.RealtimeChannel['publish'] = useMemo(() => {
    if (!derived) return channel.publish.bind(channel);
    const regularChannel = ably.channels.get(channelName);
    // For derived channels we use transient publish (it won't attach to the channel)
    return regularChannel.publish.bind(regularChannel);
  }, [ably.channels, derived, channel, channelName]);

  const channelEvent = typeof eventOrCallbackArg === 'string' ? eventOrCallbackArg : null;
  const ablyMessageCallback = typeof eventOrCallbackArg === 'string' ? callback : eventOrCallbackArg;

  const ablyMessageCallbackRef = useRef(ablyMessageCallback);

  const history: Ably.RealtimeChannel['history'] = useMemo(
    () => ((params?: Ably.RealtimeHistoryParams) => channel.history(params)) as Ably.RealtimeChannel['history'],
    [channel],
  );

  const { connectionError, channelError } = useStateErrors(channelHookOptions);

  useEffect(() => {
    ablyMessageCallbackRef.current = ablyMessageCallback;
  }, [ablyMessageCallback]);

  useEffect(() => {
    const listener: AblyMessageCallback | null = ablyMessageCallbackRef.current
      ? (message) => {
          ablyMessageCallbackRef.current && ablyMessageCallbackRef.current(message);
        }
      : null;

    const subscribeArgs: SubscribeArgs | null = listener
      ? channelEvent === null
        ? [listener]
        : [channelEvent, listener]
      : null;

    if (!skip && subscribeArgs) {
      handleChannelMount(channel, ...subscribeArgs);
    }

    return () => {
      !skip && subscribeArgs && handleChannelUnmount(channel, ...subscribeArgs);
    };
  }, [channelEvent, channel, skip]);

  useChannelAttach(channel, channelHookOptions.ablyId, skip);

  return { channel, publish, history, ably, connectionError, channelError };
}

async function handleChannelMount(channel: Ably.RealtimeChannel, ...subscribeArgs: SubscribeArgs) {
  await (channel.subscribe as any)(...subscribeArgs);
}

async function handleChannelUnmount(channel: Ably.RealtimeChannel, ...subscribeArgs: SubscribeArgs) {
  await (channel.unsubscribe as any)(...subscribeArgs);
}
