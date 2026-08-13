/**
 * The public value surface of the core's React Native push plugin, in one place so that both
 * packages re-export the same thing.
 *
 * Named for the same reason as the web push plugin — see ./push-exports.ts. The option types the
 * core declares alongside `create` are handled separately, by each package's hand-written
 * `react-native-push/index.d.ts`, which re-exports them by name.
 */
import ReactNativePush from 'ably/react-native-push';

export { ReactNativePush };
