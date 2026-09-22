import { Realtime } from '@ably/pubsub-core';
import type * as Ably from '@ably/pubsub-core';
import { deviceAgentIdentifier, optionsWithSideAgent } from '../../shared/side';

// Re-export the core's public value surface, so consumers of this package never need to
// depend on `@ably/pubsub-core` directly. See ../../shared/core-exports.ts for why the list is
// enumerated rather than star-re-exported.
export { Rest, Realtime, ErrorInfo } from '../../shared/core-exports';

// The contract, and the MAU consequences of being on the device side, are documented on
// the declaration in ../index.d.ts, which is what consumers see. Following the core, which
// keeps its documentation in ably.d.ts rather than duplicating it here.
export function createClient(options: Ably.ClientOptions | string): Ably.Realtime {
  return new Realtime(optionsWithSideAgent(options, deviceAgentIdentifier));
}
