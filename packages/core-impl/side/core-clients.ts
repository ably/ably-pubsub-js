// The implementation's client classes, for the per-side factories to construct.
//
// The implementation's platform entry points export both classes, but no public declaration
// describes either: a client built by constructing one directly declares no side, so clients reach
// consumers only through the factories, typed as the `PubSubRealtimeClient` and
// `PubSubHttpClient` interfaces. The cast that gives the factories typed access is confined to
// this module.
//
// Which platform's entry point this resolves to is chosen when each package is bundled, by the
// `node`, `react-native`, `nativescript` or `default` condition of `@ably/pubsub-core-impl/platform`.

import platform from '@ably/pubsub-core-impl/platform';
import type { ClientOptions, PubSubHttpClient, PubSubRealtimeClient } from '@ably/pubsub-core/api';

interface CoreClientClasses {
  DefaultPubSubHttpClient: new (options: ClientOptions | string) => PubSubHttpClient;
  DefaultPubSubRealtimeClient: new (options: ClientOptions | string) => PubSubRealtimeClient;
}

const clientClasses = platform as CoreClientClasses;

export const DefaultPubSubHttpClient = clientClasses.DefaultPubSubHttpClient;
export const DefaultPubSubRealtimeClient = clientClasses.DefaultPubSubRealtimeClient;
