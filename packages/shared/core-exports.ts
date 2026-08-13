/**
 * The public value surface of the core, in one place so that both packages re-export the
 * same list and it only has to grow once.
 *
 * These are enumerated rather than star-re-exported, for two reasons:
 *
 * The core ships as UMD with `libraryExport: 'default'`. `export * from 'ably'` does
 * resolve, but cjs-module-lexer over-detects two bogus bindings from that wrapper — `Ably`
 * and a literal `module.exports` — which a star re-export would publish as part of this
 * package's own namespace.
 *
 * The core's platform entry points also export `msgpack` and
 * `makeProtocolMessageFromDeserialized`, which are internal plumbing absent from the
 * public `ably.d.ts`. A star re-export would promote them to public API of a brand-new
 * package.
 *
 * The type surface is handled separately, in each package's hand-written `index.d.ts`,
 * where `export * from 'ably'` is safe because it resolves at compile time only.
 */
export { Rest, Realtime, ErrorInfo } from 'ably';
