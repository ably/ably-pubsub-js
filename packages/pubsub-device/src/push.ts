// Re-exports the core's web push plugin, so a consumer of this package can activate push without
// also depending on `ably` directly.
//
// One source serving both module systems, as every other subpath here does: the plugin is exposed
// under a name rather than as the module itself, so nothing needs the `export =` form that has no
// ESM spelling. See ../../shared/push-exports.ts.
export { Push } from '../../shared/push-exports';
