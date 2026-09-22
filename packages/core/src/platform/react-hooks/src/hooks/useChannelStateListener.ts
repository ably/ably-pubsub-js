import * as Ably from '@ably/pubsub-core';
import { ChannelNameAndAblyId } from '../AblyReactHooks.js';
import { useEventListener } from './useEventListener.js';
import { useChannelInstance } from './useChannelInstance.js';

type ChannelStateListener = (stateChange: Ably.ChannelStateChange) => any;

// The channel name can be omitted to use the channel from the nearest ChannelProvider.
export function useChannelStateListener(listener?: ChannelStateListener);

export function useChannelStateListener(channelName: string, listener?: ChannelStateListener);

export function useChannelStateListener(options: ChannelNameAndAblyId, listener?: ChannelStateListener);

export function useChannelStateListener(
  options: ChannelNameAndAblyId | string,
  state?: Ably.ChannelState | Ably.ChannelState[],
  listener?: ChannelStateListener,
);

export function useChannelStateListener(
  channelNameOrNameAndAblyIdOrListener?: ChannelNameAndAblyId | string | ChannelStateListener,
  stateOrListener?: Ably.ChannelState | Ably.ChannelState[] | ChannelStateListener,
  listener?: (stateChange: Ably.ChannelStateChange) => any,
) {
  // The first argument is the listener when the channel name is inferred from a
  // surrounding ChannelProvider, e.g. useChannelStateListener(listener).
  const inferChannelFromNearestProvider = typeof channelNameOrNameAndAblyIdOrListener === 'function';
  const channelNameOrNameAndAblyId = inferChannelFromNearestProvider
    ? undefined
    : (channelNameOrNameAndAblyIdOrListener as ChannelNameAndAblyId | string | undefined);
  const stateOrListenerArg = inferChannelFromNearestProvider
    ? (channelNameOrNameAndAblyIdOrListener as ChannelStateListener)
    : stateOrListener;

  const channelHookOptions =
    typeof channelNameOrNameAndAblyId === 'object'
      ? channelNameOrNameAndAblyId
      : channelNameOrNameAndAblyId === undefined
        ? {}
        : { channelName: channelNameOrNameAndAblyId };

  const { ablyId, channelName } = channelHookOptions;

  const { channel } = useChannelInstance(ablyId, channelName);

  const _listener =
    typeof listener === 'function'
      ? listener
      : typeof stateOrListenerArg === 'function'
        ? stateOrListenerArg
        : undefined;

  const state = typeof stateOrListenerArg === 'function' ? undefined : stateOrListenerArg;

  useEventListener<Ably.ChannelState, Ably.ChannelStateChange>(channel, _listener, state);
}
