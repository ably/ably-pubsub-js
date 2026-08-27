import React from 'react';
import type * as Ably from '@ably/pubsub-core';
import { it, beforeEach, describe, expect, vi } from 'vitest';
import { usePresence } from './usePresence.js';
import { render, screen, act, waitFor } from '@testing-library/react';
import { FakeAblySdk, FakeAblyChannels } from '../fakes/ably.js';
import { AblyProvider } from '../AblyProvider.js';
import { ChannelProvider } from '../ChannelProvider.js';

const testChannelName = 'testChannel';

function renderInCtxProvider(client: FakeAblySdk, children: React.ReactNode | React.ReactNode[]) {
  return render(
    <AblyProvider client={client as unknown as Ably.RealtimeClient}>
      <ChannelProvider channelName={testChannelName}>{children}</ChannelProvider>
    </AblyProvider>,
  );
}

describe('usePresence', () => {
  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;
  let otherClient: FakeAblySdk;

  beforeEach(() => {
    channels = new FakeAblyChannels([testChannelName]);
    ablyClient = new FakeAblySdk().connectTo(channels);
    otherClient = new FakeAblySdk().connectTo(channels);
  });

  /** @nospec */
  it('presence is entered after effect runs', async () => {
    const enterListener = vi.fn();
    ablyClient.channels.get(testChannelName).presence.subscribe(['enter'], enterListener);

    renderInCtxProvider(ablyClient, <UsePresenceComponent></UsePresenceComponent>);

    await waitFor(() => {
      expect(enterListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'bar' }));
    });
  });

  /** @nospec */
  it('presence data updates when update function is triggered', async () => {
    const updateListener = vi.fn();
    ablyClient.channels.get(testChannelName).presence.subscribe(['update'], updateListener);

    renderInCtxProvider(ablyClient, <UsePresenceComponent></UsePresenceComponent>);

    await act(async () => {
      const button = screen.getByText(/Update/i);
      button.click();
      await wait(2);
    });

    await waitFor(() => {
      expect(updateListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'baz' }));
    });
  });

  /** @nospec */
  it('presence API works with type information provided', async () => {
    const enterListener = vi.fn();
    const updateListener = vi.fn();
    ablyClient.channels.get(testChannelName).presence.subscribe('enter', enterListener);
    ablyClient.channels.get(testChannelName).presence.subscribe('update', updateListener);

    renderInCtxProvider(ablyClient, <TypedUsePresenceComponent></TypedUsePresenceComponent>);

    // Wait for `usePresence` to be rendered and entered presence
    await waitFor(() => {
      expect(enterListener).toHaveBeenCalledWith(expect.objectContaining({ data: { foo: 'bar' } }));
    });

    await act(async () => {
      const button = screen.getByText(/Update/i);
      button.click();
      await wait(2);
    });

    // Wait for presence data be updated
    await waitFor(() => {
      expect(updateListener).toHaveBeenCalledWith(expect.objectContaining({ data: { foo: 'baz' } }));
    });
  });

  /** @nospec */
  it('`skip` param prevents mounting and entering presence', async () => {
    const enterListener = vi.fn();
    ablyClient.channels.get(testChannelName).presence.subscribe('enter', enterListener);

    renderInCtxProvider(ablyClient, <UsePresenceComponent skip={true}></UsePresenceComponent>);

    // wait for component to be rendered
    await act(async () => {
      await wait(2);
    });

    // expect presence not to be entered
    await waitFor(() => {
      expect(enterListener).not.toHaveBeenCalled();
    });
  });

  /** @nospec */
  it('usePresence works with multiple clients', async () => {
    const updateListener = vi.fn();
    ablyClient.channels.get(testChannelName).presence.subscribe('update', updateListener);

    renderInCtxProvider(
      ablyClient,
      <AblyProvider ablyId="otherClient" client={otherClient as unknown as Ably.RealtimeClient}>
        <ChannelProvider channelName={testChannelName} ablyId="otherClient">
          <UsePresenceComponentMultipleClients />
        </ChannelProvider>
      </AblyProvider>,
    );

    await act(async () => {
      const button = screen.getByText(/Update/i);
      button.click();
      await wait(2);
    });

    await waitFor(() => {
      expect(updateListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'baz1' }));
      expect(updateListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'baz2' }));
    });
  });

  /** @nospec */
  it('usePresence works without default client', async () => {
    const updateListener = vi.fn();
    ablyClient.channels.get(testChannelName).presence.subscribe('update', updateListener);

    render(
      <AblyProvider ablyId="otherClient" client={otherClient as unknown as Ably.RealtimeClient}>
        <ChannelProvider channelName={testChannelName} ablyId="otherClient">
          <UsePresenceComponentWithOtherClient />
        </ChannelProvider>
      </AblyProvider>,
    );

    await act(async () => {
      const button = screen.getByText(/Update/i);
      button.click();
      await wait(2);
    });

    await waitFor(() => {
      expect(updateListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'baz' }));
    });
  });

  /** @nospec */
  it('handles channel errors', async () => {
    const onChannelError = vi.fn();
    const reason = { message: 'foo' };

    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName="blah">
        <UsePresenceStateErrorsComponent onChannelError={onChannelError}></UsePresenceStateErrorsComponent>
      </ChannelProvider>,
    );

    const channelErrorElem = screen.getByRole('channelError');
    expect(onChannelError).toHaveBeenCalledTimes(0);
    expect(channelErrorElem.innerHTML).toEqual('');

    await act(async () => {
      ablyClient.channels.get('blah').emit('failed', {
        reason,
      });
    });

    expect(channelErrorElem.innerHTML).toEqual(reason.message);
    expect(onChannelError).toHaveBeenCalledTimes(1);
    expect(onChannelError).toHaveBeenCalledWith(reason);
  });

  /** @nospec */
  it('handles connection errors', async () => {
    const onConnectionError = vi.fn();
    const reason = { message: 'foo' };

    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName="blah">
        <UsePresenceStateErrorsComponent onConnectionError={onConnectionError}></UsePresenceStateErrorsComponent>
      </ChannelProvider>,
    );

    const connectionErrorElem = screen.getByRole('connectionError');
    expect(onConnectionError).toHaveBeenCalledTimes(0);
    expect(connectionErrorElem.innerHTML).toEqual('');

    await act(async () => {
      ablyClient.connection.emit('failed', {
        reason,
      });
    });

    expect(connectionErrorElem.innerHTML).toEqual(reason.message);
    expect(onConnectionError).toHaveBeenCalledTimes(1);
    expect(onConnectionError).toHaveBeenCalledWith(reason);
  });

  /** @nospec */
  it('should not affect existing presence listeners when hook unmounts', async () => {
    const enterListener = vi.fn();
    const leaveListener = vi.fn();
    ablyClient.channels.get(testChannelName).presence.subscribe('enter', enterListener);
    ablyClient.channels.get(testChannelName).presence.subscribe('leave', leaveListener);

    const { unmount } = renderInCtxProvider(ablyClient, <UsePresenceComponent></UsePresenceComponent>);

    // Wait for `usePresence` to be rendered and effects applied
    await waitFor(() => {
      expect(enterListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'bar' }));
    });

    unmount();

    // Wait for `usePresence` to be fully unmounted and effect's clean-ups applied
    await waitFor(() => {
      expect(leaveListener).toHaveBeenCalledOnce();
    });

    ablyClient.channels.get(testChannelName).presence.enter('baz');

    // Check that listener still exists
    await waitFor(() => {
      expect(enterListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'baz' }));
    });
  });
});

const UsePresenceComponent = ({ skip }: { skip?: boolean }) => {
  const { updateStatus } = usePresence({ channelName: testChannelName, skip }, 'bar');

  return (
    <>
      <button
        onClick={() => {
          updateStatus('baz');
        }}
      >
        Update
      </button>
    </>
  );
};

const UsePresenceComponentMultipleClients = () => {
  const { updateStatus: update1 } = usePresence({ channelName: testChannelName }, 'foo');
  const { updateStatus: update2 } = usePresence({ channelName: testChannelName, ablyId: 'otherClient' }, 'bar');

  return (
    <>
      <button
        onClick={() => {
          update1('baz1');
          update2('baz2');
        }}
      >
        Update
      </button>
    </>
  );
};

const UsePresenceComponentWithOtherClient = () => {
  const { updateStatus } = usePresence({ channelName: testChannelName, ablyId: 'otherClient' }, 'bar');

  return (
    <>
      <button
        onClick={() => {
          updateStatus('baz');
        }}
      >
        Update
      </button>
    </>
  );
};

interface UsePresenceStateErrorsComponentProps {
  onConnectionError?: (err: Ably.ErrorInfo) => unknown;
  onChannelError?: (err: Ably.ErrorInfo) => unknown;
}

const UsePresenceStateErrorsComponent = ({
  onConnectionError,
  onChannelError,
}: UsePresenceStateErrorsComponentProps) => {
  const { connectionError, channelError } = usePresence({
    channelName: 'blah',
    onConnectionError,
    onChannelError,
  });

  return (
    <>
      <p role="connectionError">{connectionError?.message}</p>
      <p role="channelError">{channelError?.message}</p>
    </>
  );
};

interface MyPresenceType {
  foo: string;
}

const TypedUsePresenceComponent = () => {
  const { updateStatus } = usePresence<MyPresenceType>(testChannelName, { foo: 'bar' });

  return (
    <div role="presence">
      <button
        onClick={() => {
          updateStatus({ foo: 'baz' });
        }}
      >
        Update
      </button>
    </div>
  );
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
