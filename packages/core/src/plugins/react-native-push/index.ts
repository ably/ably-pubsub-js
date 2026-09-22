import PushChannel from '../push/pushchannel';
import { getW3CPushDeviceDetails } from '../push/getW3CDeviceDetails';
import { ActivationStateMachine, CalledActivate, CalledDeactivate, localDeviceFactory } from '../push/pushactivation';
import { DeviceFormFactor, DevicePlatform } from 'common/lib/types/devicedetails';
import type { IPlatformPushConfig } from 'common/types/IPlatformConfig';
import { getReactNativePushDeviceDetails } from './getReactNativePushDeviceDetails';

/**
 * Asynchronous key-value storage used to persist push activation state. Matches the interface of
 * `@react-native-async-storage/async-storage`, so its default export can be passed directly.
 */
export interface ReactNativePushStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/**
 * A push token obtained by the application, along with the transport it belongs to. Return
 * `transportType: 'fcm'` for a Firebase Cloud Messaging registration token (what
 * `messaging().getToken()` from `@react-native-firebase/messaging` returns, on both Android and
 * iOS), or `transportType: 'apns'` for a raw APNs device token (e.g. from
 * `messaging().getAPNSToken()`).
 */
export interface ReactNativePushToken {
  transportType: 'fcm' | 'apns';
  token: string;
}

export interface ReactNativePushOptions {
  /** Persistent storage for activation state, e.g. `@react-native-async-storage/async-storage`. */
  storage: ReactNativePushStorage;
  /**
   * Called by the plugin whenever it needs a push token. Requesting notification permissions
   * beforehand is the application's responsibility.
   */
  requestToken: () => Promise<ReactNativePushToken>;
}

function resolvePlatform(): DevicePlatform {
  // 'react-native' is a peer dependency, marked external in the plugin bundle. The UMD wrapper
  // requires all externals at module load, so the bundle only loads where react-native is
  // resolvable (a React Native runtime, or a test environment that mocks it).
  // Installing @types/react-native would allow a typed import but conflicts with @types/node,
  // see https://github.com/DefinitelyTyped/DefinitelyTyped/issues/15960
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const os = require('react-native').Platform.OS;
  return os === 'ios' ? DevicePlatform.IOS : DevicePlatform.Android;
}

export function create(options: ReactNativePushOptions) {
  if (
    !options ||
    typeof options.storage?.getItem !== 'function' ||
    typeof options.storage?.setItem !== 'function' ||
    typeof options.storage?.removeItem !== 'function' ||
    typeof options.requestToken !== 'function'
  ) {
    throw new TypeError(
      'ReactNativePush.create() requires an options object with a storage implementing getItem/setItem/removeItem (e.g. @react-native-async-storage/async-storage) and a requestToken callback returning a { transportType, token } object.',
    );
  }

  const pushConfig: IPlatformPushConfig = {
    platform: resolvePlatform(),
    formFactor: DeviceFormFactor.Phone,
    storageIsAsync: true,
    storage: {
      get: (name: string) => options.storage.getItem(name),
      set: (name: string, value: string) => options.storage.setItem(name, value),
      remove: (name: string) => options.storage.removeItem(name),
    },
    getPushDeviceDetails: (machine: ActivationStateMachine) => {
      // fire-and-forget, like the W3C hook: failures are reported to the state machine as
      // GettingPushDeviceDetailsFailed events rather than propagated to this caller
      void getReactNativePushDeviceDetails(machine, options.requestToken);
    },
  };

  // the same shape as the default export of plugins/push, plus a pushConfig which the client
  // reads per instance (client.pushConfig), so this object registers under
  // ClientOptions.plugins.Push unchanged and clients never share storage or callbacks
  return {
    ActivationStateMachine,
    localDeviceFactory,
    CalledActivate,
    CalledDeactivate,
    PushChannel,
    getW3CPushDeviceDetails,
    pushConfig,
  };
}

export default { create };
