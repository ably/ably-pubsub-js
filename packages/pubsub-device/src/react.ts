// Re-exports the core's React hooks, so a consumer of this package can use them without also
// depending on `ably` directly. Pass a client from `createClient()` to `AblyProvider`.
//
// Star-re-exported, unlike the root surface: the core's hooks are compiled by tsc rather than
// bundled as UMD, so `cjs-module-lexer` reads their named exports exactly and there are no bogus
// bindings to leak. That also means new hooks are picked up here without this file changing.
export * from 'ably/react';
