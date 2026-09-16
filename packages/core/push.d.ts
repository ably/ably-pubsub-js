// The ESLint warning is triggered because we only use these types in a documentation comment.
/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import { RealtimeClient, HttpClient } from './ably';
import { BaseHttp, BaseRealtime, Http } from './modular';
/* eslint-enable no-unused-vars, @typescript-eslint/no-unused-vars */

/**
 * Provides a {@link HttpClient} or {@link RealtimeClient} instance with the ability to be activated as a target for push notifications.
 *
 * To create a client that includes this plugin, include it in the client options that you pass to the {@link HttpClient.constructor} or {@link RealtimeClient.constructor}:
 *
 * ```javascript
 * import { Realtime } from '@ably/pubsub-core';
 * import Push from '@ably/pubsub-core/push';
 * const realtime = new Realtime({ ...options, plugins: { Push } });
 * ```
 *
 * The Push plugin can also be used with a {@link BaseHttp} or {@link BaseRealtime} client, with the additional requirement that you must also use the {@link Http} plugin
 *
 * ```javascript
 * import { BaseRealtime, Http, WebSocketTransport, FetchRequest } from '@ably/pubsub-core/modular';
 * import Push from '@ably/pubsub-core/push';
 * const realtime = new BaseRealtime({ ...options, plugins: { Http, WebSocketTransport, FetchRequest, Push } });
 * ```
 */
declare const Push: any;

export = Push;
