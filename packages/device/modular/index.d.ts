/**
 * The tree-shakable variant of the core, plus a factory that declares the device side.
 *
 * Build a client from `BaseRealtime` and only the plugins you need, rather than the all-in-one
 * `Realtime` the root entry point exports. You must supply at least one HTTP request implementation
 * and, for a realtime client, at least one transport.
 *
 * ```javascript
 * import { createClient, WebSocketTransport, FetchRequest } from '@ably/pubsub-device/modular';
 *
 * const client = createClient({
 *   key: 'your-ably-api-key',
 *   clientId: 'me',
 *   plugins: { WebSocketTransport, FetchRequest },
 * });
 * ```
 *
 * This entry point is ESM only, because the core's modular variant is: `require()` of this subpath
 * does not resolve. Use `@ably/pubsub-device` if you need CommonJS.
 */
import type { BaseRealtime, ModularPlugins } from '@ably/pubsub-core/modular';
import type { ClientOptions, CorePlugins } from '@ably/pubsub-core';

export * from '@ably/pubsub-core/modular';

/**
 * Creates a realtime client that declares the device side, so that Ably counts its traffic as an
 * end user's rather than as your own backend's. See the `createClient` documentation on the root
 * entry point for what declaring the device side means, and for when to use
 * `@ably/pubsub-server` instead.
 *
 * Unlike the root `createClient`, this accepts only a `ClientOptions` object and not an API key or
 * token string. A modular client is unusable without the plugins that `ClientOptions.plugins`
 * carries, and a bare string has nowhere to put them.
 *
 * @param options - The client options, whose `plugins` property selects the functionality to
 * include. At minimum this needs an HTTP request implementation (`FetchRequest` or `XHRRequest`)
 * and a transport (`WebSocketTransport` or `XHRPolling`).
 */
export declare function createClient(options: ClientOptions<CorePlugins & ModularPlugins>): BaseRealtime;
