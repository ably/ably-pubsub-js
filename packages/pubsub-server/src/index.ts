import { Realtime, Rest } from 'ably';
import type * as Ably from 'ably';
import { optionsWithSideAgent, serverAgentIdentifier } from '../../shared/side';
import { version } from '../package.json';

// Re-export the core's public value surface, so consumers of this package never need to
// depend on `ably` directly. See ../../shared/core-exports.ts for why the list is
// enumerated rather than star-re-exported.
export { Rest, Realtime, ErrorInfo } from '../../shared/core-exports';

// The contract of both factories, including how the MAU exemption is granted and why token
// auth needs more than the agent entry, is documented on the declarations in ../index.d.ts,
// which is what consumers see. Following the core, which keeps its documentation in
// ably.d.ts rather than duplicating it here.

export function createHttpClient(options: Ably.ClientOptions | string): Ably.Rest {
  return new Rest(optionsWithSideAgent(options, serverAgentIdentifier, version));
}

export function createRealtimeClient(options: Ably.ClientOptions | string): Ably.Realtime {
  return new Realtime(optionsWithSideAgent(options, serverAgentIdentifier, version));
}
