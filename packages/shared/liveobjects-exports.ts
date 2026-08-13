/**
 * The public value surface of the core's LiveObjects plugin, in one place so that both packages
 * re-export the same list.
 *
 * `LiveObjects` is the only value `ably/liveobjects` exports; everything else it declares is a
 * type, and types are handled by the star re-export in each package's hand-written
 * `liveobjects/index.d.ts`. Enumerated rather than star-re-exported at runtime for the same reason
 * as the root surface — see ./core-exports.ts.
 */
export { LiveObjects } from 'ably/liveobjects';
