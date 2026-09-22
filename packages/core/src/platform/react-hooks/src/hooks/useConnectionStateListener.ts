import * as Ably from '@ably/pubsub-core';
import { useAbly } from './useAbly.js';
import { useEventListener } from './useEventListener.js';

type ConnectionStateListener = (stateChange: Ably.ConnectionStateChange) => any;

export function useConnectionStateListener(listener: ConnectionStateListener, ablyId?: string);

export function useConnectionStateListener(
  state: Ably.ConnectionState | Ably.ConnectionState[],
  listener: ConnectionStateListener,
  ablyId?: string,
);

export function useConnectionStateListener(
  stateOrListener?: Ably.ConnectionState | Ably.ConnectionState[] | ConnectionStateListener,
  listenerOrAblyId?: string | ConnectionStateListener,
  ablyId = 'default',
) {
  const _ablyId = typeof listenerOrAblyId === 'string' ? listenerOrAblyId : ablyId;
  const ably = useAbly(_ablyId);

  const listener =
    typeof listenerOrAblyId === 'function' ? listenerOrAblyId : (stateOrListener as ConnectionStateListener);
  const state = typeof stateOrListener !== 'function' ? stateOrListener : undefined;

  useEventListener<Ably.ConnectionState, Ably.ConnectionStateChange>(ably.connection, listener, state);
}
