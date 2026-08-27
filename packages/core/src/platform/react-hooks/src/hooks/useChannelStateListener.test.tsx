import React from 'react';
import { it, beforeEach, describe, expect } from 'vitest';
import { useChannelStateListener } from './useChannelStateListener.js';
import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import { FakeAblySdk, FakeAblyChannels } from '../fakes/ably.js';
import * as Ably from '@ably/pubsub-core';
import { act } from 'react-dom/test-utils';
import { AblyProvider } from '../AblyProvider.js';
import { ChannelProvider } from '../ChannelProvider.js';

function renderInCtxProvider(client: FakeAblySdk, children: React.ReactNode | React.ReactNode[]) {
  return render(
    <AblyProvider client={client as unknown as Ably.RealtimeClient}>
      <ChannelProvider channelName="blah">{children}</ChannelProvider>
    </AblyProvider>,
  );
}

describe('useChannelStateListener', () => {
  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;

  beforeEach(() => {
    channels = new FakeAblyChannels(['blah']);
    ablyClient = new FakeAblySdk().connectTo(channels);
  });

  /** @nospec */
  it('can register a channel state listener for all state changes', async () => {
    renderInCtxProvider(ablyClient, <UseChannelStateListenerComponent></UseChannelStateListenerComponent>);

    act(() => {
      ablyClient.channels.get('blah').emit('attached', { current: 'attached' });
    });

    expect(screen.getAllByRole('channelState')[0].innerHTML).toEqual('attached');
  });

  /** @nospec */
  it('can register a channel state listener for named state changes', async () => {
    renderInCtxProvider(
      ablyClient,
      <UseChannelStateListenerComponentNamedEvents event={'failed'}></UseChannelStateListenerComponentNamedEvents>,
    );

    act(() => {
      ablyClient.channels.get('blah').emit('attached', { current: 'attached' });
    });

    expect(screen.getAllByRole('channelState')[0].innerHTML).toEqual('initialized');

    act(() => {
      ablyClient.channels.get('blah').emit('failed', { current: 'failed' });
    });

    expect(screen.getAllByRole('channelState')[0].innerHTML).toEqual('failed');
  });

  /** @nospec */
  it('can register a channel state listener for an array of named state changes', async () => {
    renderInCtxProvider(
      ablyClient,
      <UseChannelStateListenerComponentNamedEvents
        event={['failed', 'suspended']}
      ></UseChannelStateListenerComponentNamedEvents>,
    );

    act(() => {
      ablyClient.channels.get('blah').emit('attached', { current: 'attached' });
    });

    expect(screen.getAllByRole('channelState')[0].innerHTML).toEqual('initialized');

    act(() => {
      ablyClient.channels.get('blah').emit('suspended', { current: 'suspended' });
    });

    expect(screen.getAllByRole('channelState')[0].innerHTML).toEqual('suspended');
  });
});

const UseChannelStateListenerComponent = () => {
  const [channelState, setChannelState] = useState<Ably.ChannelState>('initialized');

  useChannelStateListener('blah', (stateChange) => {
    setChannelState(stateChange.current);
  });

  return <p role="channelState">{channelState}</p>;
};

interface UseChannelStateListenerComponentNamedEventsProps {
  event: Ably.ChannelState | Ably.ChannelState[];
}

const UseChannelStateListenerComponentNamedEvents = ({ event }: UseChannelStateListenerComponentNamedEventsProps) => {
  const [channelState, setChannelState] = useState<Ably.ChannelState>('initialized');

  useChannelStateListener('blah', event, (stateChange) => {
    setChannelState(stateChange.current);
  });

  return <p role="channelState">{channelState}</p>;
};
