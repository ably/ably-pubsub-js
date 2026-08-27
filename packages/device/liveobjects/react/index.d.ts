/**
 * The core's `useObject` React hook, for subscribing a component to LiveObjects state on a channel.
 *
 * ```javascript
 * import { useObject } from '@ably/pubsub-device/liveobjects/react';
 *
 * const { root } = useObject();
 * ```
 *
 * Register the LiveObjects plugin on the client you pass to `AblyProvider`, using the plugin
 * exported from `@ably/pubsub-device/liveobjects`.
 *
 * A subpath of its own rather than part of `@ably/pubsub-device/react`, following the core, so that
 * an app which does not use LiveObjects does not pull in any of its code.
 */
export * from '@ably/pubsub-core/liveobjects/react';
