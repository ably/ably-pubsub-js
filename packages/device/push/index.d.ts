/**
 * The core's web push plugin, which gives a client the ability to be activated as a target for
 * push notifications.
 *
 * ```javascript
 * import { createClient } from '@ably/pubsub-device';
 * import { Push } from '@ably/pubsub-device/push';
 *
 * const client = createClient({ key: 'your-ably-api-key', clientId: 'me', plugins: { Push } });
 * await client.push.activate();
 * ```
 *
 * A named export, matching every other plugin subpath in this package, so that one declaration
 * file serves both module systems and its ESM counterpart is generated rather than written by
 * hand. The core declares the plugin with `export =`, so it is imported as a default here and
 * given a name on the way out.
 *
 * Use `@ably/pubsub-device/react-native-push` in a React Native application instead of this one.
 */
import Push from '@ably/pubsub-core/push';

export { Push };
