import React, { useState } from 'react';
import { it, beforeEach, describe, expect, vi } from 'vitest';
import { render, renderHook, screen } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import * as Ably from '@ably/pubsub-core';
import { FakeAblySdk, FakeAblyChannels } from '../fakes/ably.js';
import { AblyProvider } from '../AblyProvider.js';
import { ChannelProvider } from '../ChannelProvider.js';
import { useChannel } from './useChannel.js';
import { usePresence } from './usePresence.js';
import { usePresenceListener } from './usePresenceListener.js';
import { useChannelStateListener } from './useChannelStateListener.js';

// These tests cover resolving the channel from the nearest ChannelProvider when
// the channel name is omitted from a channel based hook.
describe('inferring the channel name from the nearest ChannelProvider', () => {
  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;
  let otherClient: FakeAblySdk;

  beforeEach(() => {
    channels = new FakeAblyChannels(['outer', 'inner']);
    ablyClient = new FakeAblySdk().connectTo(channels);
    otherClient = new FakeAblySdk().connectTo(channels);
  });

  const wrapInProviders = (channelName: string, children: React.ReactNode) =>
    render(
      <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
        <ChannelProvider channelName={channelName}>{children}</ChannelProvider>
      </AblyProvider>,
    );

  /** @nospec */
  it('useChannel(callback) subscribes to the surrounding channel', async () => {
    const Component = () => {
      const [messages, setMessages] = useState<Ably.Message[]>([]);
      useChannel((message) => setMessages((prev) => [...prev, message]));
      return (
        <ul role="messages">
          {messages.map((m, i) => (
            <li key={i}>{m.data.text}</li>
          ))}
        </ul>
      );
    };

    wrapInProviders('inner', <Component />);

    await act(async () => {
      await otherClient.channels.get('inner').publish({ text: 'hello' });
    });

    const list = screen.getAllByRole('messages')[0];
    expect(list.childElementCount).toBe(1);
    expect(list.children[0].innerHTML).toBe('hello');
  });

  /** @nospec */
  it('useChannel() returns a publish bound to the surrounding channel', async () => {
    const { result } = renderHook(() => useChannel(), {
      wrapper: ({ children }) => (
        <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
          <ChannelProvider channelName="inner">{children}</ChannelProvider>
        </AblyProvider>
      ),
    });

    expect(result.current.channel.name).toBe('inner');
    expect(typeof result.current.publish).toBe('function');
  });

  /** @nospec */
  it('useChannel() publish works for a derived surrounding channel', async () => {
    const { result } = renderHook(() => useChannel(), {
      wrapper: ({ children }) => (
        <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
          <ChannelProvider channelName="inner" deriveOptions={{ filter: 'headers.user == `"robert.pike@domain.io"`' }}>
            {children}
          </ChannelProvider>
        </AblyProvider>
      ),
    });

    const { channel, publish } = result.current;

    // Publishing directly on a derived channel is not allowed.
    await expect(channel.publish('test', 'test')).rejects.toThrow();
    // The publish returned by the hook uses a transient publish and works.
    await publish('test', 'test');
  });

  /** @nospec */
  it('resolves to the nearest provider when providers are nested', async () => {
    const Component = () => {
      const [messages, setMessages] = useState<Ably.Message[]>([]);
      useChannel((message) => setMessages((prev) => [...prev, message]));
      return (
        <ul role="messages">
          {messages.map((m, i) => (
            <li key={i}>{m.data.text}</li>
          ))}
        </ul>
      );
    };

    render(
      <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
        <ChannelProvider channelName="outer">
          <ChannelProvider channelName="inner">
            <Component />
          </ChannelProvider>
        </ChannelProvider>
      </AblyProvider>,
    );

    await act(async () => {
      await otherClient.channels.get('outer').publish({ text: 'from outer' });
      await otherClient.channels.get('inner').publish({ text: 'from inner' });
    });

    const list = screen.getAllByRole('messages')[0];
    expect(list.childElementCount).toBe(1);
    expect(list.children[0].innerHTML).toBe('from inner');
  });

  /** @nospec */
  it('an explicit channel name still resolves an outer provider when nested', async () => {
    const Component = () => {
      const [messages, setMessages] = useState<Ably.Message[]>([]);
      useChannel('outer', (message) => setMessages((prev) => [...prev, message]));
      return (
        <ul role="messages">
          {messages.map((m, i) => (
            <li key={i}>{m.data.text}</li>
          ))}
        </ul>
      );
    };

    render(
      <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
        <ChannelProvider channelName="outer">
          <ChannelProvider channelName="inner">
            <Component />
          </ChannelProvider>
        </ChannelProvider>
      </AblyProvider>,
    );

    await act(async () => {
      await otherClient.channels.get('outer').publish({ text: 'from outer' });
    });

    const list = screen.getAllByRole('messages')[0];
    expect(list.childElementCount).toBe(1);
    expect(list.children[0].innerHTML).toBe('from outer');
  });

  /** @nospec */
  it('throws when there is no surrounding ChannelProvider to infer from', () => {
    const Component = () => {
      useChannel(vi.fn());
      return null;
    };

    // React logs the error that is thrown during render; silence it for this test.
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() =>
        render(
          <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
            <Component />
          </AblyProvider>,
        ),
      ).toThrowError(/no parent ChannelProvider to infer one from/);
    } finally {
      consoleError.mockRestore();
    }
  });

  /** @nospec */
  it('usePresenceListener(listener) listens on the surrounding channel', async () => {
    const onPresence = vi.fn();
    const Component = () => {
      const { presenceData } = usePresenceListener<{ foo: string }>(onPresence);
      return (
        <ul role="presence">
          {presenceData.map((m, i) => (
            <li key={i}>{m.data?.foo}</li>
          ))}
        </ul>
      );
    };

    wrapInProviders('inner', <Component />);

    await act(async () => {
      await otherClient.channels.get('inner').presence.enter({ foo: 'bar' });
    });

    const list = screen.getAllByRole('presence')[0];
    expect(list.childElementCount).toBe(1);
    expect(list.children[0].innerHTML).toBe('bar');
    expect(onPresence).toHaveBeenCalled();
  });

  /** @nospec */
  it('useChannelStateListener(listener) listens on the surrounding channel', async () => {
    const Component = () => {
      const [channelState, setChannelState] = useState<Ably.ChannelState>('initialized');
      useChannelStateListener((stateChange) => setChannelState(stateChange.current));
      return <p role="channelState">{channelState}</p>;
    };

    wrapInProviders('inner', <Component />);

    act(() => {
      ablyClient.channels.get('inner').emit('attached', { current: 'attached' });
    });

    expect(screen.getAllByRole('channelState')[0].innerHTML).toBe('attached');
  });

  /** @nospec */
  it('usePresence(undefined, data) enters presence on the surrounding channel', async () => {
    const Component = () => {
      // The channel name is inferred, so `undefined` is passed as the first
      // argument and the presence data is passed as the second argument.
      usePresence(undefined, { foo: 'bar' });
      return null;
    };

    await act(async () => {
      wrapInProviders('inner', <Component />);
    });

    const presence = await ablyClient.channels.get('inner').presence.get();
    expect(presence.length).toBe(1);
  });
});
