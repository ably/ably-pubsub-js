/**
 * The public value surface of the core's web push plugin, in one place so that both packages
 * re-export the same thing.
 *
 * A default import rather than a named one, because the core declares this plugin with `export =`:
 * the module *is* the plugin object, so there is no name inside it to pick out. Giving it one here
 * is what lets every plugin subpath in these packages have the same shape as LiveObjects — a named
 * export, one source serving both module systems, and a declaration file that copies verbatim into
 * its ESM counterpart. See ./liveobjects-exports.ts for the shape being matched.
 */
import Push from 'ably/push';

export { Push };
