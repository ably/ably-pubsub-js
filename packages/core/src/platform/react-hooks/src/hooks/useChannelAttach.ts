import type * as Ably from '@ably/pubsub-core';
import { useEffect, useState } from 'react';
import { useConnectionStateListener } from './useConnectionStateListener.js';
import { useAbly } from './useAbly.js';
import { INACTIVE_CONNECTION_STATES } from './constants.js';
import { logError } from '../utils.js';

interface ChannelAttachResult {
  connectionState: Ably.ConnectionState;
}

export function useChannelAttach(
  channel: Ably.RealtimeChannel,
  ablyId: string | undefined,
  skip: boolean,
): ChannelAttachResult {
  const ably = useAbly(ablyId);

  // we need to listen for the current connection state in order to react to it.
  // for example, we should attach when first connected, re-enter when reconnected,
  // and be able to prevent attaching when the connection is in an inactive state.
  // all of that can be achieved by using the useConnectionStateListener hook.
  const [connectionState, setConnectionState] = useState(ably.connection.state);
  useConnectionStateListener((stateChange) => {
    setConnectionState(stateChange.current);
  }, ablyId);

  if (ably.connection.state !== connectionState) {
    setConnectionState(ably.connection.state);
  }

  const shouldAttachToTheChannel = !skip && !INACTIVE_CONNECTION_STATES.includes(connectionState);

  useEffect(() => {
    if (shouldAttachToTheChannel) {
      channel.attach().catch((reason) => {
        // we use a fire-and-forget approach for attaching, but calling detach during the attaching process or while
        // suspending can cause errors that will be automatically resolved
        logError(ably, reason.toString());
      });
    }
  }, [shouldAttachToTheChannel, channel, ably]);

  // we expose `connectionState` here for reuse in the usePresence hook, where we need to prevent
  // entering and leaving presence in a similar manner
  return { connectionState };
}
