// The tree-shakable variant of the core, re-exported so that a consumer of this package can build
// a minimal client without also depending on `@ably/pubsub-core` directly.
//
// ESM only, because the core's modular variant is: it is published behind an `import` condition
// alone, so there is no CommonJS build here to re-export. The star re-export is left for the
// consumer's bundler to resolve, which is what keeps the variant tree-shakable through this
// package — bundling it here would defeat the entry point's whole purpose.

import { BaseRealtime } from '@ably/pubsub-core/modular';
import type { ModularPlugins } from '@ably/pubsub-core/modular';
import type { ClientOptions, CorePlugins } from '@ably/pubsub-core';
import { deviceAgentIdentifier, optionsWithSideAgent } from '../../shared/side';
import { version } from '../package.json';

export * from '@ably/pubsub-core/modular';

/**
 * Creates a modular realtime client that declares the device side.
 *
 * Unlike the root `createClient`, this takes only a `ClientOptions` object, never an API key or
 * token string: a modular client cannot function without the plugins that `ClientOptions.plugins`
 * carries, and a bare string has nowhere to put them.
 *
 * The contract is documented on the declaration in ../modular/index.d.ts, which is what consumers
 * see.
 */
export function createClient(options: ClientOptions<CorePlugins & ModularPlugins>): BaseRealtime {
  // The signature already forbids bare key/token strings, but a JS caller can still pass one.
  // Hand it to the constructor unstamped rather than normalising it into an options object:
  // the core deliberately rejects strings for modular clients with an error telling the caller
  // to provide an options object with a `plugins` property, and converting the string here
  // would replace that with a generic missing-plugin failure the caller cannot act on. No side
  // agent is needed on a path that always throws.
  if (typeof options === 'string') {
    return new BaseRealtime(options as unknown as ClientOptions<CorePlugins & ModularPlugins>);
  }

  // `optionsWithSideAgent` is typed against the core's default plugin map, because that is all the
  // root factories need. It only ever replaces `agents`, copying every other option across by
  // reference — `plugins` included, untouched — so the wider plugin type a modular client requires
  // survives the call unharmed, and the cast restores it to the signature.
  const withSideAgent = optionsWithSideAgent(options, deviceAgentIdentifier, version) as ClientOptions<
    CorePlugins & ModularPlugins
  >;

  return new BaseRealtime(withSideAgent);
}
