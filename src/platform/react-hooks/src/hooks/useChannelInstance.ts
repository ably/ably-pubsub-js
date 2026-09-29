import React from 'react';
import { AblyContext, ChannelContextProps } from '../AblyContext.js';

export type ResolvedChannelContextProps = ChannelContextProps & { channelName: string };

export function useChannelInstance(ablyId = 'default', channelName?: string): ResolvedChannelContextProps {
  const ablyContext = React.useContext(AblyContext)[ablyId];

  if (!ablyContext) {
    throw new Error(
      'Could not find ably client in context. ' + 'Make sure your ably hooks are called inside an <AblyProvider>',
    );
  }

  const { _channelNameToChannelContext, _nearestChannelName } = ablyContext;

  // When no channel name is provided, resolve to the channel named by the
  // closest enclosing `ChannelProvider`.
  const resolvedChannelName = channelName ?? _nearestChannelName;

  if (resolvedChannelName === undefined) {
    throw new Error(
      'No channel name was provided and there is no parent ChannelProvider to infer one from. Make sure your channel based hooks (usePresence, useChannel, useChannelStateListener) are called inside a <ChannelProvider> component, or pass a channel name explicitly',
    );
  }

  const channelContext = _channelNameToChannelContext[resolvedChannelName];

  if (!channelContext) {
    throw new Error(
      `Could not find a parent ChannelProvider in the component tree for channelName="${resolvedChannelName}". Make sure your channel based hooks (usePresence, useChannel, useChannelStateListener) are called inside a <ChannelProvider> component`,
    );
  }

  return { ...channelContext, channelName: resolvedChannelName };
}
