// Re-exports the core's LiveObjects plugin, so a consumer of this package can load LiveObjects
// without also depending on `@ably/pubsub-core` directly. The plugin carries no side of its own: it loads into a
// realtime client on either side, so both packages expose it identically.
export { LiveObjects } from '../../shared/liveobjects-exports';
