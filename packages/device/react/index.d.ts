/**
 * The full public type surface of the core's React hooks.
 *
 * Use these with a client from `createClient()`:
 *
 * ```javascript
 * import { createClient } from '@ably/pubsub-device';
 * import { AblyProvider, useChannel } from '@ably/pubsub-device/react';
 *
 * const client = createClient({ key: 'your-ably-api-key', clientId: 'me' });
 * // <AblyProvider client={client}> ... </AblyProvider>
 * ```
 */
export * from '@ably/pubsub-core/react';
