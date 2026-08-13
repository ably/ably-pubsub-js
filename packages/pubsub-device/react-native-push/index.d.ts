/**
 * The core's React Native push plugin. Unlike the web `@ably/pubsub-device/push` plugin, the push
 * environment is supplied by your application: pass an async storage implementation and a token
 * callback to `create()`, then register the result under the `Push` plugin key.
 *
 * ```javascript
 * import { createClient } from '@ably/pubsub-device';
 * import { ReactNativePush } from '@ably/pubsub-device/react-native-push';
 * import AsyncStorage from '@react-native-async-storage/async-storage';
 * import messaging from '@react-native-firebase/messaging';
 *
 * const Push = ReactNativePush.create({
 *   storage: AsyncStorage,
 *   requestToken: async () => ({ transportType: 'fcm', token: await messaging().getToken() }),
 * });
 *
 * const client = createClient({
 *   authUrl: 'https://your-server.example.com/ably-token',
 *   clientId: 'me',
 *   plugins: { Push },
 * });
 * await client.push.activate();
 * ```
 *
 * Authenticate with `authUrl` or `authCallback` rather than `key`: an API key shipped inside a
 * mobile application binary can be extracted from it, and cannot be revoked without a release.
 *
 * A named export, matching every other plugin subpath in this package. The core declares the
 * plugin as a namespace exported with `export =`, so the value is imported as a default and given
 * a name on the way out, while the option types the namespace carries are re-exported by name
 * below — meaning that list has to grow whenever the core's namespace gains a type.
 */
import ReactNativePush from 'ably/react-native-push';

export type { ReactNativePushStorage, ReactNativePushToken, ReactNativePushOptions } from 'ably/react-native-push';

export { ReactNativePush };
