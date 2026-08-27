import * as Ably from '@ably/pubsub-core';
import React, { useMemo } from 'react';
import { AblyContext, AblyContextValue } from './AblyContext.js';

interface AblyProviderProps {
  children?: React.ReactNode | React.ReactNode[] | null;
  client?: Ably.RealtimeClient;
  ablyId?: string;
}

export const AblyProvider = ({ client, children, ablyId = 'default' }: AblyProviderProps) => {
  if (!client) {
    throw new Error('AblyProvider: the `client` prop is required');
  }

  const context = React.useContext(AblyContext);

  const value: AblyContextValue = useMemo(() => {
    return { ...context, [ablyId]: { client, _channelNameToChannelContext: {} } };
  }, [context, client, ablyId]);

  return <AblyContext.Provider value={value}>{children}</AblyContext.Provider>;
};
