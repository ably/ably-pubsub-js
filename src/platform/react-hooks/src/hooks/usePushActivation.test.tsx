import React from 'react';
import type * as Ably from 'ably';
import { it, beforeEach, afterEach, describe, expect, vi } from 'vitest';
import { usePushActivation } from './usePushActivation.js';
import { renderHook, act, waitFor } from '@testing-library/react';
import { FakeAblySdk, FakeAblyChannels } from '../fakes/ably.js';
import { AblyProvider } from '../AblyProvider.js';
import { setActivatedDevice } from '../PushActivationState.js';

const fakeDevice: Ably.LocalDevice = {
  id: 'device-123',
  deviceSecret: 'secret-456',
  deviceIdentityToken: 'token-789',
  listSubscriptions: vi.fn() as any,
};

describe('usePushActivation', () => {
  let channels: FakeAblyChannels;
  let ablyClient: FakeAblySdk;

  beforeEach(() => {
    channels = new FakeAblyChannels([]);
    ablyClient = new FakeAblySdk().connectTo(channels);
    (ablyClient as any).push = {
      activate: vi.fn().mockResolvedValue(undefined),
      deactivate: vi.fn().mockResolvedValue(undefined),
    };
    (ablyClient as any).device = vi.fn().mockReturnValue(fakeDevice);
  });

  afterEach(() => {
    setActivatedDevice('default', null);
  });

  function renderWithProvider() {
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AblyProvider client={ablyClient as unknown as Ably.RealtimeClient}>{children}</AblyProvider>
    );

    return renderHook(() => usePushActivation(), { wrapper });
  }

  /** @nospec */
  it('returns activate, deactivate and localDevice', async () => {
    const { result } = renderWithProvider();

    await waitFor(() => {
      expect(result.current.activate).toBeTypeOf('function');
      expect(result.current.deactivate).toBeTypeOf('function');
      expect(result.current).toHaveProperty('localDevice');
    });
  });

  /** @nospec */
  it('localDevice is populated from persisted state on mount', async () => {
    const { result } = renderWithProvider();

    await waitFor(() => {
      expect(result.current.localDevice).toEqual(fakeDevice);
    });
  });

  /** @nospec */
  it('localDevice is null when device has no identity token', async () => {
    (ablyClient as any).device = vi.fn().mockReturnValue({
      id: 'device-123',
      deviceSecret: 'secret-456',
      deviceIdentityToken: undefined,
    });

    const { result } = renderWithProvider();

    await waitFor(() => {
      expect(result.current.localDevice).toBeNull();
    });
  });

  /** @nospec */
  it('localDevice updates after activate is called', async () => {
    (ablyClient as any).device = vi.fn().mockReturnValue({
      id: 'device-123',
      deviceSecret: 'secret-456',
      deviceIdentityToken: undefined,
    });

    const { result } = renderWithProvider();

    await waitFor(() => {
      expect(result.current.localDevice).toBeNull();
    });

    (ablyClient as any).device = vi.fn().mockReturnValue(fakeDevice);

    await act(async () => {
      await result.current.activate();
    });

    expect(result.current.localDevice).toEqual(fakeDevice);
  });

  /** @nospec */
  it('localDevice becomes null after deactivate is called', async () => {
    const { result } = renderWithProvider();

    await waitFor(() => {
      expect(result.current.localDevice).toEqual(fakeDevice);
    });

    await act(async () => {
      await result.current.deactivate();
    });

    expect(result.current.localDevice).toBeNull();
  });

  /** @nospec */
  it('calls client.push.activate when activate is called', async () => {
    const { result } = renderWithProvider();

    await act(async () => {
      await result.current.activate();
    });

    expect((ablyClient as any).push.activate).toHaveBeenCalledOnce();
  });

  /** @nospec */
  it('calls client.push.deactivate when deactivate is called', async () => {
    const { result } = renderWithProvider();

    await act(async () => {
      await result.current.deactivate();
    });

    expect((ablyClient as any).push.deactivate).toHaveBeenCalledOnce();
  });

  /** @nospec */
  it('returns stable callback references across re-renders', async () => {
    const { result, rerender } = renderWithProvider();

    await waitFor(() => {
      expect(result.current.activate).toBeTypeOf('function');
    });

    const firstRender = {
      activate: result.current.activate,
      deactivate: result.current.deactivate,
    };

    rerender();

    expect(result.current.activate).toBe(firstRender.activate);
    expect(result.current.deactivate).toBe(firstRender.deactivate);
  });
});
