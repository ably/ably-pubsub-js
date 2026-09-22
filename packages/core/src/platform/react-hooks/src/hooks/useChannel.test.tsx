import React, { useEffect, useState } from 'react';
import { it, beforeEach, describe, expect, vi } from 'vitest';
import { useChannel } from './useChannel.js';
import { render, renderHook, screen, waitFor } from '@testing-library/react';
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

describe('useChannel', () => {
  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;
  let otherClient: FakeAblySdk;

  beforeEach(() => {
    channels = new FakeAblyChannels(['blah']);
    ablyClient = new FakeAblySdk().connectTo(channels);
    otherClient = new FakeAblySdk().connectTo(channels);
  });

  /** @nospec */
  it('component can useChannel and renders nothing by default', async () => {
    renderInCtxProvider(ablyClient, <UseChannelComponent></UseChannelComponent>);
    const messageUl = screen.getAllByRole('messages')[0];

    expect(messageUl.childElementCount).toBe(0);
  });

  /** @nospec */
  it('component updates when message arrives', async () => {
    renderInCtxProvider(ablyClient, <UseChannelComponent></UseChannelComponent>);

    await act(async () => {
      await otherClient.channels.get('blah').publish({ text: 'message text' });
    });

    const messageUl = screen.getAllByRole('messages')[0];
    expect(messageUl.childElementCount).toBe(1);
    expect(messageUl.children[0].innerHTML).toBe('message text');
  });

  /** @nospec */
  it('component updates when multiple messages arrive', async () => {
    renderInCtxProvider(ablyClient, <UseChannelComponent></UseChannelComponent>);

    await act(async () => {
      await otherClient.channels.get('blah').publish({ text: 'message text1' });
      await otherClient.channels.get('blah').publish({ text: 'message text2' });
    });

    const messageUl = screen.getAllByRole('messages')[0];
    expect(messageUl.children[0].innerHTML).toBe('message text1');
    expect(messageUl.children[1].innerHTML).toBe('message text2');
  });

  /** @nospec */
  it('useChannel works with multiple clients', async () => {
    renderInCtxProvider(
      ablyClient,
      <AblyProvider client={otherClient as unknown as Ably.RealtimeClient} ablyId="otherClient">
        <ChannelProvider channelName="bleh" ablyId="otherClient">
          <UseChannelComponentMultipleClients />
        </ChannelProvider>
      </AblyProvider>,
    );

    await act(async () => {
      await ablyClient.channels.get('blah').publish({ text: 'message text1' });
      await otherClient.channels.get('bleh').publish({ text: 'message text2' });
    });

    const messageUl = screen.getAllByRole('messages')[0];
    expect(messageUl.children[0].innerHTML).toBe('message text1');
    expect(messageUl.children[1].innerHTML).toBe('message text2');
  });

  /** @nospec */
  it('handles channel errors', async () => {
    const onChannelError = vi.fn();
    const reason = { message: 'foo' };

    renderInCtxProvider(
      ablyClient,
      <UseChannelStateErrorsComponent onChannelError={onChannelError}></UseChannelStateErrorsComponent>,
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
      <UseChannelStateErrorsComponent onConnectionError={onConnectionError}></UseChannelStateErrorsComponent>,
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
  it('history function is returned and callable', async () => {
    const { result } = renderHook(() => useChannel('blah'), {
      wrapper: ({ children }) => (
        <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
          <ChannelProvider channelName="blah">{children}</ChannelProvider>
        </AblyProvider>
      ),
    });

    const { history } = result.current;
    expect(typeof history).toBe('function');

    const paginatedResult = await history();
    expect(paginatedResult).toBeDefined();
    expect(paginatedResult.items).toBeDefined();
    expect(Array.isArray(paginatedResult.items)).toBe(true);
  });

  /** @nospec */
  it('history returns previously published messages', async () => {
    const { result } = renderHook(() => useChannel('blah'), {
      wrapper: ({ children }) => (
        <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
          <ChannelProvider channelName="blah">{children}</ChannelProvider>
        </AblyProvider>
      ),
    });

    await act(async () => {
      await otherClient.channels.get('blah').publish({ text: 'hello' });
      await otherClient.channels.get('blah').publish({ text: 'world' });
    });

    const paginatedResult = await result.current.history();
    expect(paginatedResult.items.length).toBe(2);
  });

  /** @nospec */
  it('history with params delegates to channel.history', async () => {
    const { result } = renderHook(() => useChannel('blah'), {
      wrapper: ({ children }) => (
        <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
          <ChannelProvider channelName="blah">{children}</ChannelProvider>
        </AblyProvider>
      ),
    });

    const channel = result.current.channel;
    const historySpy = vi.spyOn(channel, 'history');

    const params = { limit: 10, direction: 'forwards' as const };
    await result.current.history(params);

    expect(historySpy).toHaveBeenCalledWith(params);
  });

  /** @nospec */
  it('history has referential stability across re-renders', async () => {
    const { result, rerender } = renderHook(() => useChannel('blah'), {
      wrapper: ({ children }) => (
        <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
          <ChannelProvider channelName="blah">{children}</ChannelProvider>
        </AblyProvider>
      ),
    });

    const firstHistory = result.current.history;
    rerender();
    const secondHistory = result.current.history;

    expect(firstHistory).toBe(secondHistory);
  });

  /** @nospec */
  it('skip param', async () => {
    renderInCtxProvider(ablyClient, <UseChannelComponent skip={true}></UseChannelComponent>);

    await act(async () => {
      await otherClient.channels.get('blah').publish({ text: 'message text' });
    });

    const messageUl = screen.getAllByRole('messages')[0];
    expect(messageUl.childElementCount).toBe(0);
  });

  /** @nospec */
  it('should use the latest version of the message callback', async () => {
    let callbackCount = 0;

    renderInCtxProvider(
      ablyClient,
      <LatestMessageCallbackComponent channelName="blah" callback={() => callbackCount++} />,
    );

    await act(async () => {
      ablyClient.channels.get('blah').publish({ text: 'test message 1' });
    });

    await act(async () => {
      ablyClient.channels.get('blah').publish({ text: 'test message 2' });
    });

    expect(screen.getByRole('counter').innerHTML).toEqual('2');
    expect(callbackCount).toBe(2);
  });

  /** @nospec */
  it('should re-subscribe if event name has changed', async () => {
    const channel = ablyClient.channels.get('blah');
    channel.subscribe = vi.fn();
    channel.unsubscribe = vi.fn();

    const newEventName = 'event2';

    renderInCtxProvider(ablyClient, <ChangingEventComponent newEventName={newEventName} />);

    await waitFor(() => expect(channel.subscribe).toHaveBeenCalledWith('event1', expect.any(Function)));

    await waitFor(() => expect(channel.unsubscribe).toHaveBeenCalledWith('event1', expect.any(Function)));

    expect(channel.subscribe).toHaveBeenCalledWith(newEventName, expect.any(Function));
  });
});

describe('useChannel with deriveOptions', () => {
  const Channels = {
    tasks: 'tasks',
    alerts: 'alerts',
  };

  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;
  let anotherClient: FakeAblySdk;
  let yetAnotherClient: FakeAblySdk;

  beforeEach(() => {
    channels = new FakeAblyChannels([Channels.tasks, Channels.alerts]);
    ablyClient = new FakeAblySdk().connectTo(channels);
    anotherClient = new FakeAblySdk().connectTo(channels);
    yetAnotherClient = new FakeAblySdk().connectTo(channels);
  });

  /** @nospec */
  it('component can use "useChannel" with "deriveOptions" and renders nothing by default', async () => {
    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName={Channels.tasks} deriveOptions={{ filter: '' }}>
        <UseDerivedChannelComponent channelName={Channels.tasks} />
      </ChannelProvider>,
    );
    const messageUl = screen.getAllByRole('derived-channel-messages')[0];

    expect(messageUl.childElementCount).toBe(0);
  });

  /** @nospec */
  it('component can use "publish" for channel with "deriveOptions"', async () => {
    const { result } = renderHook(() => useChannel('blah'), {
      wrapper: ({ children }) => (
        <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
          <ChannelProvider channelName="blah" deriveOptions={{ filter: 'headers.user == `"robert.pike@domain.io"`' }}>
            {children}
          </ChannelProvider>
        </AblyProvider>
      ),
    });

    const { channel, publish } = result.current;

    await expect(channel.publish('test', 'test')).rejects.toThrow();
    await publish('test', 'test');
  });

  /** @nospec */
  it('component updates when new message arrives', async () => {
    renderInCtxProvider(
      ablyClient,
      <ChannelProvider
        channelName={Channels.tasks}
        deriveOptions={{ filter: 'headers.user == `"robert.pike@domain.io"`' }}
      >
        <UseDerivedChannelComponent channelName={Channels.tasks} />
      </ChannelProvider>,
    );

    act(() => {
      anotherClient.channels
        .get(Channels.tasks)
        .publish({ text: 'A new task for you', extras: { headers: { user: 'robert.pike@domain.io' } } });
    });

    const messageUl = screen.getAllByRole('derived-channel-messages')[0];
    expect(messageUl.childElementCount).toBe(1);
    expect(messageUl.children[0].innerHTML).toBe('A new task for you');
  });

  /** @nospec */
  it('component will not update if message filtered out', async () => {
    renderInCtxProvider(
      ablyClient,
      <ChannelProvider
        channelName={Channels.tasks}
        deriveOptions={{ filter: 'headers.user == `"robert.pike@domain.io"`' }}
      >
        <UseDerivedChannelComponent channelName={Channels.tasks} />
      </ChannelProvider>,
    );

    act(() => {
      anotherClient.channels
        .get(Channels.tasks)
        .publish({ text: 'This one is for another Rob', extras: { headers: { user: 'robert.griesemer@domain.io' } } });
    });

    const messageUl = screen.getAllByRole('derived-channel-messages')[0];
    expect(messageUl.childElementCount).toBe(0);
  });

  /** @nospec */
  it('component will update with only those messages that qualify', async () => {
    renderInCtxProvider(
      ablyClient,
      <ChannelProvider
        channelName={Channels.tasks}
        deriveOptions={{ filter: 'headers.user == `"robert.pike@domain.io"` || headers.company == `"domain"`' }}
      >
        <UseDerivedChannelComponent channelName={Channels.tasks} />
      </ChannelProvider>,
    );

    act(() => {
      const channel = anotherClient.channels.get(Channels.tasks);
      channel.publish({
        text: 'This one is for another Rob',
        extras: { headers: { user: 'robert.griesemer@domain.io' } },
      });
      channel.publish({
        text: 'This one is for the whole domain',
        extras: { headers: { company: 'domain' } },
      });
      channel.publish({
        text: 'This one is for Ken',
        extras: { headers: { user: 'ken.thompson@domain.io' } },
      });
      channel.publish({
        text: 'This one is also a domain-wide fan-out',
        extras: { headers: { company: 'domain' } },
      });
    });

    const messageUl = screen.getAllByRole('derived-channel-messages')[0];
    expect(messageUl.childElementCount).toBe(2);
    expect(messageUl.children[0].innerHTML).toBe('This one is for the whole domain');
    expect(messageUl.children[1].innerHTML).toBe('This one is also a domain-wide fan-out');
  });

  /** @nospec */
  it('component can use "useChannel" with multiple clients', async () => {
    const cliendId = 'client';
    const anotherClientId = 'anotherClient';

    render(
      <AblyProvider client={ablyClient as unknown as Ably.RealtimePromise} ablyId={cliendId}>
        <AblyProvider client={anotherClient as unknown as Ably.RealtimePromise} ablyId={anotherClientId}>
          <ChannelProvider
            ablyId={cliendId}
            channelName={Channels.tasks}
            deriveOptions={{
              filter: 'headers.user == `"robert.griesemer@domain.io"` || headers.company == `"domain"`',
            }}
          >
            <ChannelProvider
              ablyId={anotherClientId}
              channelName={Channels.alerts}
              deriveOptions={{
                filter: 'headers.user == `"robert.griesemer@domain.io"` || headers.company == `"domain"`',
              }}
            >
              <UseDerivedChannelComponentMultipleClients
                clientId={cliendId}
                channelName={Channels.tasks}
                anotherClientId={anotherClientId}
                anotherChannelName={Channels.alerts}
              />
            </ChannelProvider>
          </ChannelProvider>
        </AblyProvider>
      </AblyProvider>,
    );

    act(() => {
      yetAnotherClient.channels.get(Channels.tasks).publish({
        text: 'A task for Griesemer',
        extras: { headers: { user: 'robert.griesemer@domain.io' } },
      });
      yetAnotherClient.channels.get(Channels.alerts).publish({
        text: 'A company-wide alert',
        extras: { headers: { company: 'domain' } },
      });
    });

    const messageUl = screen.getAllByRole('derived-channel-messages')[0];

    expect(messageUl.childElementCount).toBe(2);
    expect(messageUl.children[0].innerHTML).toBe('A task for Griesemer');
    expect(messageUl.children[1].innerHTML).toBe('A company-wide alert');
  });

  /** @nospec */
  it('handles channel errors', async () => {
    const onChannelError = vi.fn();
    const reason = { message: 'channel error occurred' };

    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName={Channels.alerts}>
        <UseChannelStateErrorsComponent
          channelName={Channels.alerts}
          onChannelError={onChannelError}
        ></UseChannelStateErrorsComponent>
      </ChannelProvider>,
    );

    const channelErrorElem = screen.getByRole('channelError');
    expect(onChannelError).toHaveBeenCalledTimes(0);
    expect(channelErrorElem.innerHTML).toEqual('');

    act(() => ablyClient.channels.get(Channels.alerts).emit('failed', { reason }));

    expect(channelErrorElem.innerHTML).toEqual(reason.message);
    expect(onChannelError).toHaveBeenCalledTimes(1);
    expect(onChannelError).toHaveBeenCalledWith(reason);
  });

  /** @nospec */
  it('handles connection errors', async () => {
    const onConnectionError = vi.fn();
    const reason = { message: 'failed to establish connection' };

    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName={Channels.alerts}>
        <UseChannelStateErrorsComponent
          channelName={Channels.alerts}
          onConnectionError={onConnectionError}
        ></UseChannelStateErrorsComponent>
      </ChannelProvider>,
    );

    const channelErrorElem = screen.getByRole('connectionError');
    expect(onConnectionError).toHaveBeenCalledTimes(0);
    expect(channelErrorElem.innerHTML).toEqual('');

    act(() => ablyClient.connection.emit('failed', { reason }));

    expect(channelErrorElem.innerHTML).toEqual(reason.message);
    expect(onConnectionError).toHaveBeenCalledTimes(1);
    expect(onConnectionError).toHaveBeenCalledWith(reason);
  });

  /** @nospec */
  it('wildcard filter', async () => {
    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName={Channels.alerts} deriveOptions={{ filter: '*' }}>
        <UseDerivedChannelComponent channelName={Channels.alerts}></UseDerivedChannelComponent>
      </ChannelProvider>,
    );

    act(() => {
      const text = 'Will receive this text due to wildcard filter';
      anotherClient.channels.get(Channels.alerts).publish({ text });
    });

    const messageUl = screen.getAllByRole('derived-channel-messages')[0];
    expect(messageUl.childElementCount).toBe(1);
  });

  /** @nospec */
  it('skip param', async () => {
    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName={Channels.alerts} deriveOptions={{ filter: '*' }}>
        <UseDerivedChannelComponent channelName={Channels.alerts} skip></UseDerivedChannelComponent>
      </ChannelProvider>,
    );

    act(() => {
      const text = 'Will skip due to "skip=true"';
      anotherClient.channels.get(Channels.alerts).publish({ text });
    });

    const messageUl = screen.getAllByRole('derived-channel-messages')[0];
    expect(messageUl.childElementCount).toBe(0);
  });

  /** @nospec */
  it('should use the latest version of the message callback', async () => {
    let callbackCount = 0;

    renderInCtxProvider(
      ablyClient,
      <ChannelProvider
        channelName={Channels.tasks}
        deriveOptions={{ filter: 'headers.user == `"robert.pike@domain.io"` || headers.company == `"domain"`' }}
      >
        <LatestMessageCallbackComponent channelName={Channels.tasks} callback={() => callbackCount++} />
      </ChannelProvider>,
    );

    act(() => {
      const channel = anotherClient.channels.get(Channels.tasks);
      channel.publish({
        text: 'This one is for another Rob',
        extras: { headers: { user: 'robert.griesemer@domain.io' } },
      });
      channel.publish({
        text: 'This one is for the whole domain',
        extras: { headers: { company: 'domain' } },
      });
      channel.publish({
        text: 'This one is for Ken',
        extras: { headers: { user: 'ken.thompson@domain.io' } },
      });
      channel.publish({
        text: 'This one is also a domain-wide fan-out',
        extras: { headers: { company: 'domain' } },
      });
      channel.publish({
        text: 'This one for Mr.Pike will also get through...',
        extras: { headers: { user: 'robert.pike@domain.io' } },
      });
      channel.publish({
        text: '.... as well as this message',
        extras: { headers: { user: 'robert.pike@domain.io' } },
      });
    });

    expect(callbackCount).toBe(4);
    expect(screen.getByRole('counter').innerHTML).toEqual(`${callbackCount}`);
  });

  /** @nospec */
  it('history function works with derived channels', async () => {
    const { result } = renderHook(() => useChannel(Channels.tasks), {
      wrapper: ({ children }) => (
        <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
          <ChannelProvider
            channelName={Channels.tasks}
            deriveOptions={{ filter: 'headers.user == `"robert.pike@domain.io"`' }}
          >
            {children}
          </ChannelProvider>
        </AblyProvider>
      ),
    });

    const { history } = result.current;
    expect(typeof history).toBe('function');

    await act(async () => {
      await anotherClient.channels
        .get(Channels.tasks)
        .publish({ text: 'A task', extras: { headers: { user: 'robert.pike@domain.io' } } });
    });

    const paginatedResult = await history();
    expect(paginatedResult).toBeDefined();
    expect(paginatedResult.items).toBeDefined();
    expect(paginatedResult.items.length).toBe(1);
  });

  /** @nospec */
  it('should re-subscribe if event name has changed', async () => {
    const channel = ablyClient.channels.get(Channels.alerts);
    channel.subscribe = vi.fn();
    channel.unsubscribe = vi.fn();

    const eventName = 'event1';
    const newEventName = 'event2';

    renderInCtxProvider(
      ablyClient,
      <ChannelProvider channelName={Channels.alerts} deriveOptions={{ filter: '*' }}>
        <ChangingEventComponent channelName={Channels.alerts} eventName={eventName} newEventName={newEventName} />
      </ChannelProvider>,
    );

    await waitFor(() => expect(channel.subscribe).toHaveBeenCalledWith(eventName, expect.any(Function)));

    await waitFor(() => expect(channel.unsubscribe).toHaveBeenCalledWith(eventName, expect.any(Function)));

    expect(channel.subscribe).toHaveBeenCalledWith(newEventName, expect.any(Function));
  });
});

const UseChannelComponentMultipleClients = () => {
  const [messages, updateMessages] = useState<Ably.Message[]>([]);
  useChannel({ channelName: 'blah' }, (message) => {
    updateMessages((prev) => [...prev, message]);
  });
  useChannel({ channelName: 'bleh', ablyId: 'otherClient' }, (message) => {
    updateMessages((prev) => [...prev, message]);
  });

  const messagePreviews = messages.map((msg, index) => <li key={index}>{msg.data.text}</li>);

  return <ul role="messages">{messagePreviews}</ul>;
};

const UseChannelComponent = ({ skip }: { skip?: boolean }) => {
  const [messages, updateMessages] = useState<Ably.Message[]>([]);
  useChannel({ channelName: 'blah', skip }, (message) => {
    updateMessages((prev) => [...prev, message]);
  });

  const messagePreviews = messages.map((msg, index) => <li key={index}>{msg.data.text}</li>);

  return <ul role="messages">{messagePreviews}</ul>;
};

interface UseDerivedChannelComponentMultipleClientsProps {
  clientId: string;
  channelName: string;
  anotherClientId: string;
  anotherChannelName: string;
}

const UseDerivedChannelComponentMultipleClients = ({
  channelName,
  clientId,
  anotherClientId,
  anotherChannelName,
}: UseDerivedChannelComponentMultipleClientsProps) => {
  const [messages, setMessages] = useState<Ably.Message[]>([]);
  useChannel({ ablyId: clientId, channelName }, (message) => {
    setMessages((prev) => [...prev, message]);
  });
  useChannel({ ablyId: anotherClientId, channelName: anotherChannelName }, (message) => {
    setMessages((prev) => [...prev, message]);
  });

  const messagePreviews = messages.map((msg, index) => <li key={index}>{msg.data.text}</li>);

  return <ul role="derived-channel-messages">{messagePreviews}</ul>;
};

interface UseDerivedChannelComponentProps {
  channelName: string;
  skip?: boolean;
}

const UseDerivedChannelComponent = ({ channelName, skip = false }: UseDerivedChannelComponentProps) => {
  const [messages, setMessages] = useState<Ably.Message[]>([]);

  useChannel({ channelName, skip }, (message) => {
    setMessages((prev) => [...prev, message]);
  });

  const messagePreviews = messages.map((msg, index) => <li key={index}>{msg.data.text}</li>);

  return <ul role="derived-channel-messages">{messagePreviews}</ul>;
};

interface UseChannelStateErrorsComponentProps {
  onConnectionError?: (err: Ably.ErrorInfo) => unknown;
  onChannelError?: (err: Ably.ErrorInfo) => unknown;
  channelName?: string;
}

const UseChannelStateErrorsComponent = ({
  onConnectionError,
  onChannelError,
  channelName = 'blah',
}: UseChannelStateErrorsComponentProps) => {
  const opts = { channelName, onConnectionError, onChannelError };
  const { connectionError, channelError } = useChannel(opts);

  return (
    <>
      <p role="connectionError">{connectionError?.message}</p>
      <p role="channelError">{channelError?.message}</p>
    </>
  );
};

interface LatestMessageCallbackComponentProps {
  channelName: string;
  callback: () => any;
}

const LatestMessageCallbackComponent = ({ channelName, callback }: LatestMessageCallbackComponentProps) => {
  const [count, setCount] = React.useState(0);

  useChannel({ channelName }, () => {
    callback();
    setCount((count) => count + 1);
  });

  return <div role="counter">{count}</div>;
};

interface ChangingEventComponentProps {
  newEventName: string;
  channelName?: string;
  eventName?: string;
}

const ChangingEventComponent = ({
  channelName = 'blah',
  eventName = 'event1',
  newEventName,
}: ChangingEventComponentProps) => {
  const [currentEventName, setCurrentEventName] = useState(eventName);

  useChannel({ channelName }, currentEventName, vi.fn());

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setCurrentEventName(newEventName);
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [newEventName]);

  return null;
};
