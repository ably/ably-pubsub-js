import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChannelAttach } from './useChannelAttach.js';

interface LocalTestContext {
  useChannelAttach: typeof useChannelAttach;
}

describe('useChannelAttach', () => {
  const fakeAblyClientRef: any = {};

  beforeEach<LocalTestContext>(async (context) => {
    vi.doMock('./useConnectionStateListener.js', () => ({
      useConnectionStateListener: vi.fn(),
    }));

    vi.doMock('./useAbly.js', () => ({
      useAbly: () => fakeAblyClientRef.current,
    }));

    context.useChannelAttach = (await import('./useChannelAttach.js')).useChannelAttach;
    fakeAblyClientRef.current = { connection: { state: 'initialized' } };
  });

  it<LocalTestContext>('should call attach on render', ({ useChannelAttach }) => {
    const channel = { attach: vi.fn(() => Promise.resolve()) };
    const { result } = renderHook(() => useChannelAttach(channel, undefined, false));

    expect(result.current.connectionState).toBe('initialized');
    expect(channel.attach).toHaveBeenCalled();
  });

  it<LocalTestContext>('should not call attach when skipped', ({ useChannelAttach }) => {
    const channel = { attach: vi.fn(() => Promise.resolve()) };
    const { result } = renderHook(() => useChannelAttach(channel, undefined, true));

    expect(result.current.connectionState).toBe('initialized');
    expect(channel.attach).not.toHaveBeenCalled();
  });

  it<LocalTestContext>('should not call attach when in failed state', ({ useChannelAttach }) => {
    fakeAblyClientRef.current = { connection: { state: 'failed' } };
    const channel = { attach: vi.fn(() => Promise.resolve()) };
    const { result } = renderHook(() => useChannelAttach(channel, undefined, false));

    expect(result.current.connectionState).toBe('failed');
    expect(channel.attach).not.toHaveBeenCalled();
  });

  it<LocalTestContext>('should call attach when go back to the connected state', async ({ useChannelAttach }) => {
    fakeAblyClientRef.current = { connection: { state: 'suspended' } };
    const channel = { attach: vi.fn(() => Promise.resolve()) };
    const { result, rerender } = renderHook(() => useChannelAttach(channel, undefined, false));

    expect(result.current.connectionState).toBe('suspended');
    expect(channel.attach).not.toHaveBeenCalled();

    fakeAblyClientRef.current = { connection: { state: 'connected' } };
    rerender();

    expect(result.current.connectionState).toBe('connected');
    expect(channel.attach).toHaveBeenCalled();
  });
});
