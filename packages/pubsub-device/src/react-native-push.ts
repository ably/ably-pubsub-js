// Re-exports the core's React Native push plugin, so a consumer of this package can activate push
// without also depending on `ably` directly.
//
// One source serving both module systems, for the same reason as ./push.ts. Unlike the web push
// plugin, this one is configured before use: pass an async storage implementation and a token
// callback to `ReactNativePush.create()`, then register the result under the `Push` plugin key.
export { ReactNativePush } from '../../shared/react-native-push-exports';
