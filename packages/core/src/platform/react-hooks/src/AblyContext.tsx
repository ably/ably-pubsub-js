import * as Ably from '@ably/pubsub-core';
import React from 'react';

// We need to make sure we never create more than one Ably React context.
// This might happen when exporting a context directly from a module -
// there's a risk of creating multiple instances of the same context
// if there are misconfigurations in module bundler or package manager on the consumer side of Ably Context.
// This can lead to problems like having an Ably Channel instance added
// in one context, and then attempting to retrieve it from another different context.
// This is why a single Ably context is created and stored in the global state.
const contextKey = Symbol.for('__ABLY_CONTEXT__');

const globalObjectForContext: { [contextKey]?: React.Context<AblyContextValue> } =
  typeof globalThis !== 'undefined' ? (globalThis as any) : {};

// Ably context contains an object which stores all provider options indexed by provider id,
// which is used to get options set by specific `AblyProvider` after calling `React.useContext`.
export type AblyContextValue = Record<string, AblyContextProviderProps>;

export interface AblyContextProviderProps {
  client: Ably.RealtimeClient;
  _channelNameToChannelContext: Record<string, ChannelContextProps>;
  // The channel named by the closest enclosing `ChannelProvider`. Channel hooks
  // called without an explicit channel name resolve to this, so the name does
  // not have to be repeated when there is a surrounding provider.
  _nearestChannelName?: string;
}

export interface ChannelContextProps {
  channel: Ably.RealtimeChannel;
  derived?: boolean;
}

function getContext(): React.Context<AblyContextValue> {
  let context = globalObjectForContext[contextKey];
  if (!context) {
    context = globalObjectForContext[contextKey] = React.createContext<AblyContextValue>({});
  }

  return context;
}

export const AblyContext = getContext();
