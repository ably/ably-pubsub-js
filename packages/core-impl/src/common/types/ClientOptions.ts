import { Modify } from './utils';
import * as API from '@ably/pubsub-core/api';
import type * as Device from '@ably/pubsub-core/device';
import { ModularPlugins } from 'common/lib/client/modularplugins';
import { StandardPlugins } from 'plugins';

export type RestAgentOptions = {
  keepAlive: boolean;
  maxSockets: number;
};

export default interface ClientOptions
  extends Device.ClientOptions<API.CorePlugins & ModularPlugins & StandardPlugins> {
  restAgentOptions?: RestAgentOptions;
  pushFullWait?: boolean;
  agents?: Record<string, string | undefined>;
  /**
   * Tags every line this client logs, after the `Ably: ` prefix (see `Logger.setContext`), so that
   * the lines of the clients in a group of them, such as the realtime channel pool of
   * `@ably/pubsub-server`, can be told apart. Honoured at runtime, but absent from the public
   * declarations, like `agents`.
   */
  logContext?: string;
  /**
   * Internal, and absent from the public `ClientOptions`. Returns the signal that aborts the REST request being made in
   * the current async context, or `undefined` if nothing can abort it. The Temporal worker plugin returns the
   * cancellation signal of the current activity attempt.
   *
   * `HttpRequester.do` calls it once per request, before trying any host. Once the signal has aborted, it tries no
   * further host, and the request in progress is abandoned. A hook that throws counts as no signal.
   */
  requestSignal?: () => AbortSignal | undefined;
}

export type NormalisedClientOptions = Modify<
  ClientOptions,
  {
    primaryDomain: string;
    keyName?: string;
    keySecret?: string;
    timeouts: Record<string, number>;
    maxMessageSize: number;
    connectivityCheckParams: Record<string, string> | null;
    headers: Record<string, string>;
  }
>;
