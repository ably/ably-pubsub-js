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
