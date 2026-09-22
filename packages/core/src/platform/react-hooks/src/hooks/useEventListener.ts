import * as Ably from '@ably/pubsub-core';
import { useEffect, useRef } from 'react';

type EventListener<T> = (stateChange: T) => any;

export function useEventListener<
  S extends Ably.ConnectionState | Ably.ChannelState,
  C extends Ably.ConnectionStateChange | Ably.ChannelStateChange,
>(emitter: Ably.EventEmitter<EventListener<C>, C, S>, listener: EventListener<C>, event?: S | S[]) {
  const savedListener = useRef(listener);

  useEffect(() => {
    savedListener.current = listener;
  }, [listener]);

  useEffect(() => {
    if (event) {
      emitter.on(event as S, savedListener.current);
    } else {
      emitter.on(listener);
    }

    return () => {
      if (event) {
        emitter.off(event as S, listener);
      } else {
        emitter.off(listener);
      }
    };
  }, [emitter, event, listener]);
}
