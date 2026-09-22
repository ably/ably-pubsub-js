import type * as Ably from '@ably/pubsub-core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ChannelParameters } from '../AblyReactHooks.js';
import { useAbly } from './useAbly.js';
import { useChannelInstance } from './useChannelInstance.js';
import { useStateErrors } from './useStateErrors.js';
import { useChannelStateListener } from './useChannelStateListener.js';
import { INACTIVE_CHANNEL_STATES, INACTIVE_CONNECTION_STATES } from './constants.js';
import { useChannelAttach } from './useChannelAttach.js';

export interface PresenceResult<T> {
  updateStatus: (messageOrPresenceObject: T) => Promise<void>;
  connectionError: Ably.ErrorInfo | null;
  channelError: Ably.ErrorInfo | null;
}

/**
 * Enter the presence set of a channel.
 *
 * The channel name can be omitted to use the channel from the nearest `ChannelProvider`.
 * Because the presence data can itself be a string or object, it is indistinguishable
 * from a channel name or options object, so it cannot be passed as the first argument.
 * To infer the channel while still providing presence data, pass `undefined` as the
 * first argument: `usePresence(undefined, presenceData)`.
 */
export function usePresence<T = any>(
  channelNameOrNameAndOptions?: ChannelParameters,
  messageOrPresenceObject?: T,
): PresenceResult<T> {
  const params =
    typeof channelNameOrNameAndOptions === 'object'
      ? channelNameOrNameAndOptions
      : channelNameOrNameAndOptions === undefined
        ? {}
        : { channelName: channelNameOrNameAndOptions };
  const skip = params.skip;

  const ably = useAbly(params.ablyId);
  const { channel } = useChannelInstance(params.ablyId, params.channelName);
  const { connectionError, channelError } = useStateErrors(params);

  // we can't simply add messageOrPresenceObject to dependency list in our useCallback/useEffect hooks,
  // since it will most likely cause an infinite loop of updates in cases when user calls this hook
  // with an object literal instead of a state or memoized object.
  // to prevent this from happening we store messageOrPresenceObject in a ref, and use that instead.
  // note that it still prevents us from automatically re-entering presence with new messageOrPresenceObject if it changes.
  // one of the options to fix this, is to use deep equals to check if the object has actually changed. see https://github.com/ably/ably-js/issues/1688.
  const messageOrPresenceObjectRef = useRef(messageOrPresenceObject);
  useEffect(() => {
    messageOrPresenceObjectRef.current = messageOrPresenceObject;
  }, [messageOrPresenceObject]);

  // similar to connection states, we should only attempt to enter presence when in certain
  // channel states.
  const [channelState, setChannelState] = useState(channel.state);
  useChannelStateListener(params, (stateChange) => {
    setChannelState(stateChange.current);
  });

  const { connectionState } = useChannelAttach(channel, params.ablyId, skip);

  const shouldNotEnterPresence =
    INACTIVE_CONNECTION_STATES.includes(connectionState) || INACTIVE_CHANNEL_STATES.includes(channelState) || skip;

  useEffect(() => {
    if (shouldNotEnterPresence) {
      return;
    }

    const onMount = async () => {
      await channel.presence.enter(messageOrPresenceObjectRef.current);
    };
    onMount();

    return () => {
      // here we use the ably.connection.state property, which upon this cleanup function call
      // will have the current connection state for that connection, thanks to us accessing the Ably instance here by reference.
      // if the connection is in one of the inactive states or the channel is not attached/attaching, a presence.leave call will produce an exception.
      // so we should only leave presence in other cases.
      const canLeaveFromConnectionState = !INACTIVE_CONNECTION_STATES.includes(ably.connection.state);
      const canLeaveFromChannelState = ['attached', 'attaching'].includes(channel.state);
      if (canLeaveFromChannelState && canLeaveFromConnectionState) {
        channel.presence.leave();
      }
    };
  }, [shouldNotEnterPresence, channel, ably]);

  const updateStatus = useCallback(
    async (messageOrPresenceObject: T) => {
      await channel.presence.update(messageOrPresenceObject);
    },
    [channel],
  );

  return { updateStatus, connectionError, channelError };
}
