// Re-exports the core's LiveObjects React hook, so a consumer of this package can use it without
// also depending on `@ably/pubsub-core` directly.
//
// A subpath of its own rather than part of ./react.ts, following the core: the hook pulls in the
// LiveObjects types, and an app that does not use LiveObjects should not pay for them.
//
// Star-re-exported for the same reason as ./react.ts — the core's hooks are compiled by tsc rather
// than bundled as UMD, so `cjs-module-lexer` reads their named exports exactly.
export * from '@ably/pubsub-core/liveobjects/react';
