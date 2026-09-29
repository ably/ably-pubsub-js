import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import * as Ably from 'ably';
import { FakeAblySdk, FakeAblyChannels } from '../fakes/ably.js';
import { AblyProvider } from '../AblyProvider.js';
import { useAbly } from './useAbly.js';
import { useChannel } from './useChannel.js';
import { usePresence } from './usePresence.js';

const expectedMessage =
  'Could not find ably client in context. Make sure your ably hooks are called inside an <AblyProvider>';

// React logs errors thrown during render to the console, which is noise here.
const silenceConsoleError = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

/** @nospec */
describe('hooks called outside an AblyProvider', () => {
  it('useAbly throws a descriptive error', () => {
    const spy = silenceConsoleError();
    expect(() => renderHook(() => useAbly())).toThrow(expectedMessage);
    spy.mockRestore();
  });

  it('useChannel throws a descriptive error', () => {
    const spy = silenceConsoleError();
    expect(() => renderHook(() => useChannel('channel', vi.fn()))).toThrow(expectedMessage);
    spy.mockRestore();
  });

  it('usePresence throws a descriptive error', () => {
    const spy = silenceConsoleError();
    expect(() => renderHook(() => usePresence('channel'))).toThrow(expectedMessage);
    spy.mockRestore();
  });

  it('useAbly throws a descriptive error when the requested ablyId has no provider', () => {
    const spy = silenceConsoleError();
    const client = new FakeAblySdk().connectTo(new FakeAblyChannels(['channel']));
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <AblyProvider client={client as unknown as Ably.RealtimeClient}>{children}</AblyProvider>
    );
    expect(() => renderHook(() => useAbly('missing'), { wrapper })).toThrow(expectedMessage);
    spy.mockRestore();
  });
});
