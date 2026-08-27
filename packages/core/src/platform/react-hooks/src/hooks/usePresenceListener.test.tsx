import React from 'react';
import type * as Ably from '@ably/pubsub-core';
import { it, beforeEach, describe, expect, vi } from 'vitest';
import { OnPresenceMessageReceived, usePresenceListener } from './usePresenceListener.js';
import { render, screen, act, waitFor } from '@testing-library/react';
import { FakeAblySdk, FakeAblyChannels } from '../fakes/ably.js';
import { AblyProvider } from '../AblyProvider.js';
import { ChannelProvider } from '../ChannelProvider.js';

const testChannelName = 'testChannel';

function renderInCtxProvider(client: FakeAblySdk, children: React.ReactNode | React.ReactNode[]) {
  const renderResult = render(
    <AblyProvider client={client as unknown as Ably.RealtimeClient}>
      <ChannelProvider channelName={testChannelName}>{children}</ChannelProvider>
    </AblyProvider>,
  );

  const originalRerender = renderResult.rerender;
  renderResult.rerender = (children: React.ReactNode | React.ReactNode[]) => {
    return originalRerender(
      <AblyProvider client={client as unknown as Ably.RealtimeClient}>
        <ChannelProvider channelName={testChannelName}>{children}</ChannelProvider>
      </AblyProvider>,
    );
  };

  return renderResult;
}

describe('usePresenceListener', () => {
  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;
  let otherClient: FakeAblySdk;

  beforeEach(() => {
    channels = new FakeAblyChannels([testChannelName]);
    ablyClient = new FakeAblySdk().connectTo(channels);
    otherClient = new FakeAblySdk().connectTo(channels);
  });

  /** @nospec */
  it('presence data is not visible on first render as it runs in an effect', async () => {
    // enter presence before rendering the component
    ablyClient.channels.get(testChannelName).presence.enter('bar');

    renderInCtxProvider(ablyClient, <UsePresenceListenerComponent></UsePresenceListenerComponent>);

    const values = screen.getByRole('presence').innerHTML;
    expect(values).toBe('');

    await act(async () => {
      await wait(2);
      // To let react run its updates so we don't see warnings in the test output
    });
  });

  /** @nospec */
  it('presence data available after effect runs', async () => {
    // enter presence before rendering the component
    ablyClient.channels.get(testChannelName).presence.enter('bar');

    renderInCtxProvider(ablyClient, <UsePresenceListenerComponent></UsePresenceListenerComponent>);

    await act(async () => {
      await wait(2);
    });

    const values = screen.getByRole('presence').innerHTML;
    expect(values).toContain(`"bar"`);
  });

  /** @nospec */
  it('presence data in component updates when presence was updated', async () => {
    ablyClient.channels.get(testChannelName).presence.enter('bar');

    renderInCtxProvider(ablyClient, <UsePresenceListenerComponent></UsePresenceListenerComponent>);

    await act(async () => {
      ablyClient.channels.get(testChannelName).presence.update('baz');
    });

    const values = screen.getByRole('presence').innerHTML;
    expect(values).toContain(`"baz"`);
  });

  /** @nospec */
  it('presence data respects updates made by other clients', async () => {
    ablyClient.channels.get(testChannelName).presence.enter('bar');

    renderInCtxProvider(ablyClient, <UsePresenceListenerComponent></UsePresenceListenerComponent>);

    await act(async () => {
      otherClient.channels.get(testChannelName).presence.enter('baz');
    });

    const presenceElement = screen.getByRole('presence');
    const values = presenceElement.innerHTML;
    expect(presenceElement.children.length).toBe(2);
    expect(values).toContain(`"bar"`);
    expect(values).toContain(`"baz"`);
  });

  /** @nospec */
  it('presence API works with type information provided', async () => {
    const data: MyPresenceType = { foo: 'bar' };
    ablyClient.channels.get(testChannelName).presence.enter(data);

    renderInCtxProvider(ablyClient, <TypedUsePresenceListenerComponent></TypedUsePresenceListenerComponent>);

    await act(async () => {
      await wait(2);
    });

    const values = screen.getByRole('presence').innerHTML;
    expect(values).toContain(`"data":${JSON.stringify(data)}`);
  });

  /** @nospec */
  it('`skip` param prevents mounting and subscribing to presence events', async () => {
    // can't really test 'leave' event, since if 'skip' works as expected then we won't have any data available to check that it's gone
    ablyClient.channels.get(testChannelName).presence.enter('bar');
    ablyClient.channels.get(testChannelName).presence.update('baz');

    renderInCtxProvider(ablyClient, <UsePresenceListenerComponent skip={true}></UsePresenceListenerComponent>);

    await act(async () => {
      await wait(2);
    });

    const values = screen.getByRole('presence').innerHTML;
    expect(values).to.not.contain(`"bar"`);
    expect(values).to.not.contain(`"baz"`);
  });

  /** @nospec */
  it('usePresenceListener works with multiple clients', async () => {
    ablyClient.channels.get(testChannelName).presence.enter('bar1');
    otherClient.channels.get(testChannelName).presence.enter('bar2');

    renderInCtxProvider(
      ablyClient,
      <AblyProvider ablyId="otherClient" client={otherClient as unknown as Ably.RealtimeClient}>
        <ChannelProvider channelName={testChannelName} ablyId="otherClient">
          <UsePresenceListenerComponentMultipleClients />
        </ChannelProvider>
      </AblyProvider>,
    );

    await act(async () => {
      ablyClient.channels.get(testChannelName).presence.update('baz1');
      otherClient.channels.get(testChannelName).presence.update('baz2');
    });

    const values1 = screen.getByRole('presence1').innerHTML;
    expect(values1).toContain(`"data":"baz1"`);
    expect(values1).toContain(`"data":"baz2"`);

    const values2 = screen.getByRole('presence2').innerHTML;
    expect(values2).toContain(`"data":"baz1"`);
    expect(values2).toContain(`"data":"baz2"`);
  });

  /** @nospec */
  it('calls onPresenceMessageReceived callback on new messages', async () => {
    const onPresenceMessageReceived = vi.fn();
    ablyClient.channels.get(testChannelName).presence.enter('bar');

    renderInCtxProvider(
      ablyClient,
      <UsePresenceListenerComponent
        onPresenceMessageReceived={onPresenceMessageReceived}
      ></UsePresenceListenerComponent>,
    );

    await act(async () => {
      await wait(2);
    });

    // should not have been called for already existing presence state
    expect(onPresenceMessageReceived).toHaveBeenCalledTimes(0);

    await act(async () => {
      ablyClient.channels.get(testChannelName).presence.update('baz');
    });

    expect(onPresenceMessageReceived).toHaveBeenCalledTimes(1);
    expect(onPresenceMessageReceived).toHaveBeenCalledWith(expect.objectContaining({ data: 'baz' }));
  });

  /** @nospec */
  it('reacts to onPresenceMessageReceived callback changes', async () => {
    let onPresenceMessageReceived = vi.fn();
    ablyClient.channels.get(testChannelName).presence.enter('foo');

    const { rerender } = renderInCtxProvider(
      ablyClient,
      <UsePresenceListenerComponent
        onPresenceMessageReceived={onPresenceMessageReceived}
      ></UsePresenceListenerComponent>,
    );

    await act(async () => {
      ablyClient.channels.get(testChannelName).presence.update('bar');
    });

    expect(onPresenceMessageReceived).toHaveBeenCalledTimes(1);
    expect(onPresenceMessageReceived).toHaveBeenCalledWith(expect.objectContaining({ data: 'bar' }));

    // change callback function and rerender
    onPresenceMessageReceived = vi.fn();
    rerender(
      <UsePresenceListenerComponent
        onPresenceMessageReceived={onPresenceMessageReceived}
      ></UsePresenceListenerComponent>,
    );

    await act(async () => {
      ablyClient.channels.get(testChannelName).presence.update('baz');
    });

    // new callback should be called once
    expect(onPresenceMessageReceived).toHaveBeenCalledTimes(1);
    expect(onPresenceMessageReceived).toHaveBeenCalledWith(expect.objectContaining({ data: 'baz' }));
  });

  /** @nospec */
  it('handles channel errors', async () => {
    const onChannelError = vi.fn();
    const reason = { message: 'foo' };

    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName="blah">
        <UsePresenceListenerStateErrorsComponent
          onChannelError={onChannelError}
        ></UsePresenceListenerStateErrorsComponent>
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
        <UsePresenceListenerStateErrorsComponent
          onConnectionError={onConnectionError}
        ></UsePresenceListenerStateErrorsComponent>
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
    ablyClient.channels.get(testChannelName).presence.subscribe('enter', enterListener);

    // enter presence
    ablyClient.channels.get(testChannelName).presence.enter('bar');

    const { unmount } = renderInCtxProvider(ablyClient, <UsePresenceListenerComponent></UsePresenceListenerComponent>);

    // wait for 'usePresenceListener' to render
    await act(async () => {
      await wait(2);
    });

    // expect existing listener and component to have presence data
    const values = screen.getByRole('presence').innerHTML;
    expect(values).toContain(`"bar"`);
    expect(enterListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'bar' }));

    unmount();

    // Wait for `usePresenceListener` to be fully unmounted and effect's clean-ups applied
    await act(async () => {
      await wait(2);
    });

    ablyClient.channels.get(testChannelName).presence.enter('baz');

    // Check that listener still exists
    await waitFor(() => {
      expect(enterListener).toHaveBeenCalledWith(expect.objectContaining({ data: 'baz' }));
    });
  });
});

const UsePresenceListenerComponent = ({
  skip,
  onPresenceMessageReceived,
}: {
  skip?: boolean;
  onPresenceMessageReceived?: OnPresenceMessageReceived<any>;
}) => {
  const { presenceData } = usePresenceListener({ channelName: testChannelName, skip }, onPresenceMessageReceived);

  const presentUsers = presenceData.map((presence, index) => {
    return (
      <li key={index}>
        {/* PresenceMessage type is not correctly resolved and is missing 'clientId' property due to fail to load '@ably/pubsub-core' type declarations in this test file */}
        {(presence as any).clientId} - {JSON.stringify(presence)}
      </li>
    );
  });

  return (
    <>
      <ul role="presence">{presentUsers}</ul>
    </>
  );
};

const UsePresenceListenerComponentMultipleClients = () => {
  const { presenceData: presenceData1 } = usePresenceListener({ channelName: testChannelName });
  const { presenceData: presenceData2 } = usePresenceListener({ channelName: testChannelName, ablyId: 'otherClient' });

  const presentUsers1 = presenceData1.map((presence, index) => {
    return (
      <li key={index}>
        {/* PresenceMessage type is not correctly resolved and is missing 'clientId' property due to fail to load '@ably/pubsub-core' type declarations in this test file */}
        {(presence as any).clientId} - {JSON.stringify(presence)}
      </li>
    );
  });
  const presentUsers2 = presenceData2.map((presence, index) => {
    return (
      <li key={index}>
        {/* PresenceMessage type is not correctly resolved and is missing 'clientId' property due to fail to load '@ably/pubsub-core' type declarations in this test file */}
        {(presence as any).clientId} - {JSON.stringify(presence)}
      </li>
    );
  });

  return (
    <>
      <ul role="presence1">{presentUsers1}</ul>
      <ul role="presence2">{presentUsers2}</ul>
    </>
  );
};

interface UsePresenceListenerStateErrorsComponentProps {
  onConnectionError?: (err: Ably.ErrorInfo) => unknown;
  onChannelError?: (err: Ably.ErrorInfo) => unknown;
}

const UsePresenceListenerStateErrorsComponent = ({
  onConnectionError,
  onChannelError,
}: UsePresenceListenerStateErrorsComponentProps) => {
  const { connectionError, channelError } = usePresenceListener({
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

const TypedUsePresenceListenerComponent = () => {
  const { presenceData } = usePresenceListener<MyPresenceType>(testChannelName);

  return <div role="presence">{JSON.stringify(presenceData)}</div>;
};

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
