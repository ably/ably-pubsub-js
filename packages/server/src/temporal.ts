// The Temporal plugin's worker entry point, bundled from the private implementation. The plugin's own entry point
// enumerates its public surface, so it is re-exported whole. It imports `@ably/pubsub-core` for types alone: the
// application creates the client the plugin uses, with `createHttpClient` from this package's root.
export * from '../../core-impl/src/platform/temporal/src/index';
