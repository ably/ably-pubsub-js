import type { ClientOptions, Realtime } from '@ably/pubsub-core';

/**
 * The full public type surface of the core. Safe as a star re-export because it resolves
 * at compile time only — see ../shared/core-exports.ts for why the *runtime* re-export is
 * enumerated instead.
 */
export * from '@ably/pubsub-core';

/**
 * Creates a Pub/Sub client for a device: a browser, a mobile app, or any other runtime
 * where the code is under an end user's control.
 *
 * The client this returns is identical to one built with the {@link Realtime} constructor,
 * except that it declares its side. It does so by sending an `ably-pubsub-device` entry in
 * its `Ably-Agent`, which is what tells Ably this connection belongs to a device.
 *
 * Device traffic counts toward your account's monthly active users. On an account billed
 * by MAU, a device connection must carry a client ID and is rejected at connect without
 * one, so set `clientId` here or issue tokens that carry one. A device client ID is also
 * subject to a per-client-ID concurrency limit.
 *
 * Use `createHttpClient` or `createRealtimeClient` from `@ably/pubsub-server` for a
 * backend service instead, so that its traffic is exempt from all three.
 *
 * @param options - A client options object, an Ably API key, or an Ably token.
 */
export declare function createClient(options: ClientOptions | string): Realtime;
