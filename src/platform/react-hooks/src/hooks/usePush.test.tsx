import React from 'react';
import type * as Ably from 'ably';
import { it, beforeEach, afterEach, describe, expect, vi } from 'vitest';
import { usePush } from './usePush.js';
import { renderHook, act } from '@testing-library/react';
import { FakeAblySdk, FakeAblyChannels } from '../fakes/ably.js';
import { AblyProvider } from '../AblyProvider.js';
import { ChannelProvider } from '../ChannelProvider.js';
import { setActivatedDevice } from '../PushActivationState.js';

const testChannelName = 'testChannel';

function renderInCtxProvider(client: FakeAblySdk) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <AblyProvider client={client as unknown as Ably.RealtimeClient}>
      <ChannelProvider channelName={testChannelName}>{children}</ChannelProvider>
    </AblyProvider>
  );

  return renderHook(() => usePush({ channelName: testChannelName }), { wrapper });
}

describe('usePush', () => {
  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;

  beforeEach(() => {
    channels = new FakeAblyChannels([testChannelName]);
    ablyClient = new FakeAblySdk().connectTo(channels);
  });

  afterEach(() => {
    setActivatedDevice('default', null);
  });

  /** @nospec */
  it('returns the channel, push methods, and isActivated', () => {
    const { result } = renderInCtxProvider(ablyClient);

    expect(result.current.channel).toBeDefined();
    expect(result.current.subscribeDevice).toBeTypeOf('function');
    expect(result.current.unsubscribeDevice).toBeTypeOf('function');
    expect(result.current.subscribeClient).toBeTypeOf('function');
    expect(result.current.unsubscribeClient).toBeTypeOf('function');
    expect(result.current.listSubscriptions).toBeTypeOf('function');
    expect(result.current).toHaveProperty('isActivated');
  });

  /** @nospec */
  it('isActivated is false when no device is activated', () => {
    const { result } = renderInCtxProvider(ablyClient);

    expect(result.current.isActivated).toBe(false);
  });

  /** @nospec */
  it('isActivated becomes true when device is activated via store', () => {
    const { result } = renderInCtxProvider(ablyClient);

    expect(result.current.isActivated).toBe(false);

    act(() => {
      setActivatedDevice('default', {
        id: 'device-123',
        deviceSecret: 'secret-456',
        deviceIdentityToken: 'token-789',
        listSubscriptions: vi.fn() as any,
      });
    });

    expect(result.current.isActivated).toBe(true);
  });

  /** @nospec */
  it('isActivated reverts to false when device is deactivated via store', () => {
    setActivatedDevice('default', {
      id: 'device-123',
      deviceSecret: 'secret-456',
      deviceIdentityToken: 'token-789',
      listSubscriptions: vi.fn() as any,
    });

    const { result } = renderInCtxProvider(ablyClient);

    expect(result.current.isActivated).toBe(true);

    act(() => {
      setActivatedDevice('default', null);
    });

    expect(result.current.isActivated).toBe(false);
  });

  /** @nospec */
  it('calls channel.push.subscribeDevice when subscribeDevice is called', async () => {
    const { result } = renderInCtxProvider(ablyClient);
    const channel = result.current.channel;
    const spy = vi.spyOn(channel.push, 'subscribeDevice');

    await act(async () => {
      await result.current.subscribeDevice();
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  /** @nospec */
  it('calls channel.push.unsubscribeDevice when unsubscribeDevice is called', async () => {
    const { result } = renderInCtxProvider(ablyClient);
    const channel = result.current.channel;
    const spy = vi.spyOn(channel.push, 'unsubscribeDevice');

    await act(async () => {
      await result.current.unsubscribeDevice();
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  /** @nospec */
  it('calls channel.push.subscribeClient when subscribeClient is called', async () => {
    const { result } = renderInCtxProvider(ablyClient);
    const channel = result.current.channel;
    const spy = vi.spyOn(channel.push, 'subscribeClient');

    await act(async () => {
      await result.current.subscribeClient();
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  /** @nospec */
  it('calls channel.push.unsubscribeClient when unsubscribeClient is called', async () => {
    const { result } = renderInCtxProvider(ablyClient);
    const channel = result.current.channel;
    const spy = vi.spyOn(channel.push, 'unsubscribeClient');

    await act(async () => {
      await result.current.unsubscribeClient();
    });

    expect(spy).toHaveBeenCalledOnce();
  });

  /** @nospec */
  it('calls channel.push.listSubscriptions with params', async () => {
    const { result } = renderInCtxProvider(ablyClient);
    const channel = result.current.channel;
    const spy = vi.spyOn(channel.push, 'listSubscriptions');

    await act(async () => {
      await result.current.listSubscriptions({ deviceId: 'device123' });
    });

    expect(spy).toHaveBeenCalledWith({ deviceId: 'device123' });
  });

  /** @nospec */
  it('returns stable callback references across re-renders', () => {
    const { result, rerender } = renderInCtxProvider(ablyClient);

    const firstRender = {
      subscribeDevice: result.current.subscribeDevice,
      unsubscribeDevice: result.current.unsubscribeDevice,
      subscribeClient: result.current.subscribeClient,
      unsubscribeClient: result.current.unsubscribeClient,
      listSubscriptions: result.current.listSubscriptions,
    };

    rerender();

    expect(result.current.subscribeDevice).toBe(firstRender.subscribeDevice);
    expect(result.current.unsubscribeDevice).toBe(firstRender.unsubscribeDevice);
    expect(result.current.subscribeClient).toBe(firstRender.subscribeClient);
    expect(result.current.unsubscribeClient).toBe(firstRender.unsubscribeClient);
    expect(result.current.listSubscriptions).toBe(firstRender.listSubscriptions);
  });

  /** @nospec */
  it('accepts a channel name string directly', () => {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>
        <ChannelProvider channelName={testChannelName}>{children}</ChannelProvider>
      </AblyProvider>
    );

    const { result } = renderHook(() => usePush(testChannelName), { wrapper });

    expect(result.current.channel).toBeDefined();
    expect(result.current.subscribeDevice).toBeTypeOf('function');
  });
});
