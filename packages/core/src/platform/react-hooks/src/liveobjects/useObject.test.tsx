import React from 'react';
import type * as Ably from '@ably/pubsub-core';
import { it, beforeEach, describe, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { FakeAblySdk, FakeAblyChannels } from '../fakes/ably.js';
import { FakeRealtimeObject } from '../fakes/liveobjects.js';
import { AblyProvider } from '../AblyProvider.js';
import { ChannelProvider } from '../ChannelProvider.js';
import { useObject, UseObjectOptions, UseObjectResult } from './useObject.js';

const testChannelName = 'testChannel';

// flush the effects that resolve the root object and start the subscription
async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
  });
}

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

const ResultView = ({ result }: { result: UseObjectResult<any> }) => (
  <div>
    <p role="value">{result.value === undefined ? 'undefined' : JSON.stringify(result.value)}</p>
    <p role="object">{result.object ? `path:${result.object.path()}` : 'undefined'}</p>
    <p role="error">{result.error ? result.error.message : 'null'}</p>
  </div>
);

const RootObjectComponent = ({
  options,
  results,
}: {
  options?: UseObjectOptions;
  results?: UseObjectResult<any>[];
}) => {
  const result = useObject(options);
  results?.push(result);
  return <ResultView result={result} />;
};

const SelectorComponent = ({
  selector,
  options,
  results,
  nonce,
}: {
  selector: (root: any) => any;
  options?: UseObjectOptions;
  results?: UseObjectResult<any>[];
  nonce?: number;
}) => {
  const result = useObject(selector, options);
  results?.push(result);
  return (
    <div>
      <p role="nonce">{nonce ?? 0}</p>
      <ResultView result={result} />
    </div>
  );
};

const PlayerScoreComponent = ({ player }: { player: string }) => {
  const result = useObject((root) => root.get('scores').get(player));
  return <ResultView result={result} />;
};

describe('useObject', () => {
  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;
  let fakeObject: FakeRealtimeObject;

  beforeEach(() => {
    channels = new FakeAblyChannels([testChannelName]);
    ablyClient = new FakeAblySdk().connectTo(channels);
    fakeObject = new FakeRealtimeObject({ scores: { alice: 1, bob: 2 }, title: 'hello' });
    (ablyClient.channels.get(testChannelName) as any).object = fakeObject;
  });

  /** @nospec */
  it('returns undefined value and object while the root object is resolving', async () => {
    fakeObject.deferGet();

    renderInCtxProvider(ablyClient, <RootObjectComponent />);

    expect(screen.getByRole('value').innerHTML).toBe('undefined');
    expect(screen.getByRole('object').innerHTML).toBe('undefined');
    expect(screen.getByRole('error').innerHTML).toBe('null');

    await act(async () => {
      fakeObject.releaseGet();
    });

    expect(screen.getByRole('object').innerHTML).toBe('path:');
  });

  /** @nospec */
  it('returns the root snapshot and root object once resolved', async () => {
    renderInCtxProvider(ablyClient, <RootObjectComponent />);

    await flushEffects();

    expect(JSON.parse(screen.getByRole('value').innerHTML)).toEqual({ scores: { alice: 1, bob: 2 }, title: 'hello' });
    expect(screen.getByRole('object').innerHTML).toBe('path:');
    expect(screen.getByRole('error').innerHTML).toBe('null');
  });

  /** @nospec */
  it('subscribes to the node returned by the selector', async () => {
    renderInCtxProvider(ablyClient, <SelectorComponent selector={(root) => root.get('scores').get('alice')} />);

    await flushEffects();

    expect(screen.getByRole('value').innerHTML).toBe('1');
    expect(screen.getByRole('object').innerHTML).toBe('path:scores.alice');
  });

  /** @nospec */
  it('re-renders with a fresh snapshot when the subscribed node changes', async () => {
    renderInCtxProvider(ablyClient, <SelectorComponent selector={(root) => root.get('scores')} />);

    await flushEffects();
    expect(JSON.parse(screen.getByRole('value').innerHTML)).toEqual({ alice: 1, bob: 2 });

    act(() => {
      fakeObject.set(['scores', 'alice'], 5);
    });

    expect(JSON.parse(screen.getByRole('value').innerHTML)).toEqual({ alice: 5, bob: 2 });
  });

  /** @nospec */
  it('renders a change that lands between the render snapshot and the subscription', async () => {
    fakeObject.onSubscribe = () => {
      // mutate the data directly, without notifying: no listener is registered
      // yet, so only the post-subscribe snapshot refresh can observe the change
      (fakeObject.data.scores as Record<string, unknown>).alice = 42;
    };

    renderInCtxProvider(ablyClient, <SelectorComponent selector={(root) => root.get('scores').get('alice')} />);

    await flushEffects();

    expect(screen.getByRole('value').innerHTML).toBe('42');
  });

  /** @nospec */
  it('does not re-render for changes outside the selected node', async () => {
    const results: UseObjectResult<any>[] = [];
    renderInCtxProvider(ablyClient, <SelectorComponent selector={(root) => root.get('scores')} results={results} />);

    await flushEffects();
    const renderCount = results.length;

    act(() => {
      fakeObject.set(['title'], 'changed');
    });

    expect(results.length).toBe(renderCount);
    expect(JSON.parse(screen.getByRole('value').innerHTML)).toEqual({ alice: 1, bob: 2 });
  });

  /** @nospec */
  it('keeps the same snapshot and object identity across unrelated re-renders', async () => {
    const results: UseObjectResult<any>[] = [];
    const { rerender } = renderInCtxProvider(
      ablyClient,
      <SelectorComponent selector={(root) => root.get('scores')} results={results} nonce={1} />,
    );

    await flushEffects();
    const before = results[results.length - 1];

    rerender(<SelectorComponent selector={(root) => root.get('scores')} results={results} nonce={2} />);

    const after = results[results.length - 1];
    expect(results.length).toBeGreaterThan(1);
    expect(after.value).toBe(before.value);
    expect(after.object).toBe(before.object);
  });

  /** @nospec */
  it('surfaces the error when the root object fails to resolve', async () => {
    fakeObject.failGet({ message: 'channel is missing the object modes', code: 40024, statusCode: 400 });

    renderInCtxProvider(ablyClient, <RootObjectComponent />);

    await flushEffects();

    expect(screen.getByRole('error').innerHTML).toBe('channel is missing the object modes');
    expect(screen.getByRole('value').innerHTML).toBe('undefined');
    expect(screen.getByRole('object').innerHTML).toBe('undefined');
  });

  /** @nospec */
  it('does not resolve the object when skip is set', async () => {
    renderInCtxProvider(ablyClient, <RootObjectComponent options={{ skip: true }} />);

    await flushEffects();

    expect(fakeObject.getCalls).toBe(0);
    expect(screen.getByRole('value').innerHTML).toBe('undefined');
    expect(screen.getByRole('object').innerHTML).toBe('undefined');
  });

  /** @nospec */
  it('unsubscribes from the node on unmount', async () => {
    const { unmount } = renderInCtxProvider(ablyClient, <SelectorComponent selector={(root) => root.get('scores')} />);

    await flushEffects();
    expect(fakeObject.listeners.size).toBe(1);

    unmount();

    expect(fakeObject.listeners.size).toBe(0);
  });

  /** @nospec */
  it('moves the subscription when the selector navigates to a different node', async () => {
    const { rerender } = renderInCtxProvider(ablyClient, <PlayerScoreComponent player="alice" />);

    await flushEffects();
    expect(screen.getByRole('value').innerHTML).toBe('1');
    expect(screen.getByRole('object').innerHTML).toBe('path:scores.alice');

    rerender(<PlayerScoreComponent player="bob" />);
    await flushEffects();

    expect(screen.getByRole('value').innerHTML).toBe('2');
    expect(screen.getByRole('object').innerHTML).toBe('path:scores.bob');
    expect(fakeObject.listeners.size).toBe(1);

    act(() => {
      fakeObject.set(['scores', 'bob'], 7);
    });

    expect(screen.getByRole('value').innerHTML).toBe('7');
  });

  /** @nospec */
  it('accepts an explicit channel name', async () => {
    renderInCtxProvider(ablyClient, <RootObjectComponent options={{ channelName: testChannelName }} />);

    await flushEffects();

    expect(JSON.parse(screen.getByRole('value').innerHTML)).toEqual({ scores: { alice: 1, bob: 2 }, title: 'hello' });
  });
});
