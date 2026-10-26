import type * as Ably from 'ably';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAbly } from './useAbly.js';
import { getActivatedDevice, setActivatedDevice, subscribe } from '../PushActivationState.js';

export interface PushActivationResult {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  localDevice: Ably.LocalDevice | null;
}

export function usePushActivation(ablyId: string = 'default'): PushActivationResult {
  const ably = useAbly(ablyId);

  // Initialise the store from persisted device state on first render.
  // client.device() reads from localStorage, so if the device was activated
  // in a prior session it will already have a deviceIdentityToken.
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    try {
      const device = ably.device();
      if (device.deviceIdentityToken) {
        setActivatedDevice(ablyId, device);
      }
    } catch {
      // Push plugin not loaded — leave as null
    }
  }

  // Subscribe to the shared store for reactive updates
  const [localDevice, setLocalDevice] = useState<Ably.LocalDevice | null>(() => getActivatedDevice(ablyId));

  useEffect(() => {
    return subscribe(ablyId, () => {
      setLocalDevice(getActivatedDevice(ablyId));
    });
  }, [ablyId]);

  const activate = useCallback(async () => {
    await ably.push.activate();
    setActivatedDevice(ablyId, ably.device());
  }, [ably, ablyId]);

  const deactivate = useCallback(async () => {
    await ably.push.deactivate();
    setActivatedDevice(ablyId, null);
  }, [ably, ablyId]);

  return { activate, deactivate, localDevice };
}
