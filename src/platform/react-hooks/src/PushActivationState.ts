import type * as Ably from 'ably';

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
const deviceState = new Map<string, Ably.LocalDevice | null>();

export function getActivatedDevice(ablyId: string): Ably.LocalDevice | null {
  return deviceState.get(ablyId) ?? null;
}

export function setActivatedDevice(ablyId: string, device: Ably.LocalDevice | null): void {
  deviceState.set(ablyId, device);
  const ablyListeners = listeners.get(ablyId);
  if (ablyListeners) {
    for (const listener of ablyListeners) {
      listener();
    }
  }
}

export function subscribe(ablyId: string, listener: Listener): () => void {
  if (!listeners.has(ablyId)) {
    listeners.set(ablyId, new Set());
  }
  listeners.get(ablyId)!.add(listener);
  return () => {
    listeners.get(ablyId)?.delete(listener);
  };
}
