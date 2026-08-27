import type { ClientOptions, Realtime, Rest } from '@ably/pubsub-core';

/**
 * The full public type surface of the core. Safe as a star re-export because it resolves
 * at compile time only — see ../shared/core-exports.ts for why the *runtime* re-export is
 * enumerated instead.
 */
export * from '@ably/pubsub-core';

/**
 * Creates a stateless Pub/Sub client for a server, talking to Ably over HTTP.
 *
 * The client this returns is identical to one built with the {@link Rest} constructor,
 * except that it declares itself a server. Server traffic is exempt from monthly active
 * user counting, from the per-client-ID concurrency limit, and from the requirement to
 * carry a client ID on an account billed by MAU.
 *
 * How that exemption is granted depends on how the client authenticates, and token auth
 * needs more than this package provides. With an API key, the `ably-pubsub-server` agent
 * entry this factory sends is enough on its own. With token auth it is not: Ably grants the
 * server side only from a signed `x-ably-clientType=server` claim on the token, and a
 * client that declares itself a server without that claim is rejected rather than treated
 * as a device. If you authenticate with `authUrl` or `authCallback`, add that claim to the
 * tokens your auth service issues before you deploy this package.
 *
 * Use `createClient` from `@ably/pubsub-device` for code running on an end user's device,
 * so that its traffic is counted instead of exempt.
 *
 * @param options - A client options object, an Ably API key, or an Ably token.
 */
export declare function createHttpClient(options: ClientOptions | string): Rest;

/**
 * Creates a realtime Pub/Sub client for a server, holding a persistent connection to Ably.
 *
 * The client this returns is identical to one built with the {@link Realtime} constructor,
 * except that it declares itself a server. Server traffic is exempt from monthly active
 * user counting, from the per-client-ID concurrency limit, and from the requirement to
 * carry a client ID on an account billed by MAU.
 *
 * How that exemption is granted depends on how the client authenticates, and token auth
 * needs more than this package provides. With an API key, the `ably-pubsub-server` agent
 * entry this factory sends is enough on its own. With token auth it is not: Ably grants the
 * server side only from a signed `x-ably-clientType=server` claim on the token, and a
 * client that declares itself a server without that claim is rejected at connect rather
 * than treated as a device. If you authenticate with `authUrl` or `authCallback`, add that
 * claim to the tokens your auth service issues before you deploy this package.
 *
 * Use `createClient` from `@ably/pubsub-device` for code running on an end user's device,
 * so that its traffic is counted instead of exempt.
 *
 * @param options - A client options object, an Ably API key, or an Ably token.
 */
export declare function createRealtimeClient(options: ClientOptions | string): Realtime;
