// Private helper shared by @ably/pubsub-device and @ably/pubsub-server. It is bundled into
// each package's output by the esbuild step rather than published, so that the two packages
// can share this code without a third npm package existing for it to live in.
//
// PDR-091 keeps `ably` itself as the shared core, so nothing here may grow into a general
// abstraction over the core: it exists only to stamp the side a package declares.

import type * as Ably from 'ably';

// The `-device` / `-server` suffix on both identifiers below is load-bearing, not
// cosmetic. On API-key auth the realtime system grants the server exemption by matching an
// agent entry ending in `-server`, and an identifier that is not yet in the ably-common
// registry is classified by that suffix alone. Renaming either without preserving its
// suffix silently reclassifies every client the package constructs.
//
// Both live here rather than in the package that uses each, so the naming scheme can be
// changed in one place.

/** The agent identifier declaring the device side, sent by `@ably/pubsub-device`. */
export const deviceAgentIdentifier = 'ably-pubsub-device';

/**
 * The agent identifier declaring the server side, sent by `@ably/pubsub-server`.
 *
 * This is the entry that earns the MAU exemption on API-key auth, so its `-server` suffix
 * is the one with billing consequences.
 */
export const serverAgentIdentifier = 'ably-pubsub-server';

/**
 * `ClientOptions.agents` is honoured at runtime — `getAgentString` in
 * src/common/lib/util/defaults.ts turns each entry into an `Ably-Agent` token — but it is
 * deliberately absent from the public `ably.d.ts`, so it cannot be set through the types
 * this package consumes. The cast is confined to this module.
 *
 * Whether `agents` should be promoted to the public `ClientOptions` is an open question
 * for PDR-091, not an oversight here.
 */
type ClientOptionsWithAgents = Ably.ClientOptions & {
  agents?: Record<string, string | undefined>;
};

/**
 * Mirrors the key-versus-token rule the core applies in `objectifyOptions`
 * (src/common/lib/util/defaults.ts): an Ably API key always contains a colon, because its
 * form is `APP_ID.KEY_ID:KEY_SECRET` (see https://ably.com/docs/auth), and an Ably token
 * never does.
 *
 * The rule is duplicated rather than imported because `objectifyOptions` is internal to
 * the core and not part of the surface this package consumes. It is duplicated in
 * preference to rejecting the string form, so that the factories accept everything the
 * constructors they wrap accept.
 */
function keyOrTokenToOptions(keyOrToken: string): Ably.ClientOptions {
  return keyOrToken.indexOf(':') === -1 ? { token: keyOrToken } : { key: keyOrToken };
}

/**
 * Returns a shallow copy of the caller's options carrying the agent entry that declares
 * this package's side.
 *
 * Only `agents` is replaced, with a new object rather than by mutation, so the caller's
 * options and their own `agents` object are both left untouched. Every other option is
 * copied by reference, so nested values such as `plugins` and `transportParams` stay
 * shared with the object the caller passed in — the same treatment the core's own
 * `objectifyOptions` gives them.
 *
 * The caller's `agents` entries are preserved alongside the side stamp, so an SDK layered
 * on top of this package keeps its attribution. The side stamp is applied last and so wins
 * a collision on its own identifier: which side the package declares is the package's to
 * state, not the caller's to redefine.
 *
 * @param optionsOrKeyOrToken - The options, API key or token the caller passed to the factory.
 * @param identifier - The side-declaring agent identifier to stamp.
 * @param version - The version of the package doing the stamping.
 */
export function optionsWithSideAgent(
  optionsOrKeyOrToken: Ably.ClientOptions | string,
  identifier: string,
  version: string,
): Ably.ClientOptions {
  const options: ClientOptionsWithAgents =
    typeof optionsOrKeyOrToken === 'string' ? keyOrTokenToOptions(optionsOrKeyOrToken) : { ...optionsOrKeyOrToken };

  options.agents = { ...options.agents, [identifier]: version };

  return options;
}
