import type * as Ably from '@ably/pubsub-core/api';
import { DefaultPubSubHttpClient, DefaultPubSubRealtimeClient } from '../../core-impl/side/core-clients';
import { optionsWithSideAgent, serverAgentIdentifier } from '../../core-impl/side/side';
import { logOptionsOf, optionsWithLogContext } from '../../core-impl/side/logger';
import type { RealtimeChannelPool, RealtimeChannelPoolOptions } from '../index';
import { DefaultRealtimeChannelPool, poolClientLogContext } from './channel-pool';

// The public value surface besides the factories. See ../../core-impl/side/core-exports.ts for why
// the list is enumerated.
export { ErrorInfo, Crypto, Message, PresenceMessage, Annotation } from '../../core-impl/side/core-exports';

// The contract of both factories, including how the MAU exemption is granted and why token
// auth needs more than the agent entry, is documented on the declarations in ../index.d.ts,
// which is what consumers see. Following the implementation, which keeps its documentation
// in declaration files rather than duplicating it here.

export function createHttpClient(options: Ably.ClientOptions | string): Ably.PubSubHttpClient {
  return new DefaultPubSubHttpClient(optionsWithSideAgent(options, serverAgentIdentifier));
}

export function createRealtimeClient(options: Ably.ClientOptions | string): Ably.PubSubRealtimeClient {
  return new DefaultPubSubRealtimeClient(optionsWithSideAgent(options, serverAgentIdentifier));
}

export function createRealtimeChannelPool(
  options: Ably.ClientOptions | string,
  pool?: RealtimeChannelPoolOptions,
): RealtimeChannelPool {
  // The pool logs through its own logger, which follows the clients' logLevel and logHandler, and
  // tags each client's own lines with the client's index, so that they can be told apart.
  return new DefaultRealtimeChannelPool(
    (index) =>
      new DefaultPubSubRealtimeClient(
        optionsWithLogContext(optionsWithSideAgent(options, serverAgentIdentifier), poolClientLogContext(index)),
      ),
    pool,
    logOptionsOf(options),
  );
}
