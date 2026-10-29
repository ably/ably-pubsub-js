# @ably/pubsub-server

The Ably Pub/Sub client for **servers**: backend services and other trusted runtimes you operate.

This package is the Ably Pub/Sub client for servers. It implements the API declared by [`@ably/pubsub-core`](https://www.npmjs.com/package/@ably/pubsub-core) and creates clients through factories that declare which side of the connection you are on, so that your own backend services are not billed as your users. Use [`@ably/pubsub-device`](https://www.npmjs.com/package/@ably/pubsub-device) for code running on an end user's device instead.

## Installation

```sh
npm install @ably/pubsub-server
```

`@ably/pubsub-core` is an exact dependency, and npm installs it for you. It carries the API declarations and the runtime `ErrorInfo` shared with the other Ably SDKs.

## Usage

Two factories, one per client kind. Use `createHttpClient` for stateless request-response work such as publishing from a webhook, and `createRealtimeClient` when the service needs a persistent connection.

```javascript
import { createHttpClient, createRealtimeClient } from '@ably/pubsub-server';

// Stateless, over HTTP
const http = createHttpClient({ key: 'your-ably-api-key' });
await http.channels.get('test-channel').publish('test-event', 'hello world');

// Persistent connection
const realtime = createRealtimeClient({ key: 'your-ably-api-key' });
await realtime.connection.once('connected');
await realtime.channels.get('test-channel').subscribe((message) => {
  console.log(`Received message: ${message.data}`);
});
```

They return a `PubSubHttpClient` and a `PubSubRealtimeClient`, the clients that everything in the [Ably Pub/Sub JavaScript documentation](https://ably.com/docs/getting-started/javascript) describes. The factories are the only way to create them: this package exports no client class to construct, because a client constructed directly would declare no side.

### Publishing from many concurrent operations

A long-running process that publishes from many operations at once, such as the activities of a Temporal worker, can share a pool of publish-only channels created by `createRealtimeChannelPool`. The pool holds several realtime clients, set by `size` (4 by default), and spreads channel names across them, so that the process stays within the inbound message rate of each connection. Every handle on a channel name publishes through the same connection while it is connected, so messages published by consecutive operations on a channel keep their order.

```javascript
import { createRealtimeChannelPool } from '@ably/pubsub-server';

const pool = createRealtimeChannelPool({ key: 'your-ably-api-key' }, { size: 4 });
await pool.open();

async function streamReply(channelName, chunks) {
  using channel = pool.get(channelName); // released when the block exits
  await Promise.all(chunks.map((chunk) => channel.publish('chunk', chunk)));
}

// Once the work using the pool has finished
await pool.close();
```

A handle publishes, updates, deletes and appends messages, and publishes and deletes annotations, but cannot attach or subscribe. Without `using`, call `channel.release()` when finished with it. Typing `using` needs TypeScript 5.2 or later, and `@types/node` for `Symbol.dispose`.

## Entry points

Everything the SDK exposes is exported here, so you never need to add `@ably/pubsub-core` as a dependency of your own alongside this package.

| Import from                       | What you get                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `@ably/pubsub-server`             | `createHttpClient`, `createRealtimeClient`, `createRealtimeChannelPool`, plus the core's entire public API and types |
| `@ably/pubsub-server/liveobjects` | The LiveObjects plugin                                                                                               |

```javascript
import { createRealtimeClient } from '@ably/pubsub-server';
import { LiveObjects } from '@ably/pubsub-server/liveobjects';
```

The root entry point also exports the `Message`, `PresenceMessage`, `Annotation` and `Crypto` classes, whose static methods need no client: for example, `Message.fromEncoded()` decodes a message received from a source other than a channel, such as a webhook or a queue.

```javascript
import { Message } from '@ably/pubsub-server';

const message = await Message.fromEncoded(webhookPayload, { cipher: { key } });
```

The LiveObjects plugin is the same object the core exports, not a copy, so a client built here accepts it as the plugin it expects. It carries no side of its own and is available from both packages.

Push receive and the React hooks are device-side concerns and are not re-exported here; they live on [`@ably/pubsub-device`](https://www.npmjs.com/package/@ably/pubsub-device). Push _admin_ is a server concern and is already on the client, at `client.push.admin`.

## What declaring the server side means

Server traffic is exempt from monthly active user counting, from the per-client-ID concurrency limit, and from the requirement to carry a client ID on an account billed by MAU.

### With an API key, installing this package is enough

The agent entry these factories send is what Ably classifies on, so no further configuration is needed.

### With token authentication, you must add a claim

**Read this before deploying.** Ably grants the server side on token auth only from a signed `x-ably-clientType=server` claim on the token itself — an agent entry is not consulted, because an end user could otherwise exempt themselves simply by sending one.

A client that declares itself a server without that claim is **rejected**, not quietly treated as a device. So if you authenticate with `authUrl` or `authCallback`, add the claim to the tokens your auth service issues **before** you deploy this package. Rolling this package out ahead of that change will break the connection rather than degrade it.

## Migrating from `ably`

Replace the constructors with the matching factory, and change the import:

```diff
- import * as Ably from 'ably';
- const http = new Ably.Rest({ key });
- const realtime = new Ably.Realtime({ key });
+ import { createHttpClient, createRealtimeClient } from '@ably/pubsub-server';
+ const http = createHttpClient({ key });
+ const realtime = createRealtimeClient({ key });
```

Replace the `Message`, `PresenceMessage`, `Annotation` and `Crypto` statics on the client classes with the classes of the same names, imported from this package. Replace the `Ably.RestClient` and `Ably.RealtimeClient` types with `PubSubHttpClient` and `PubSubRealtimeClient`. Nothing else changes, other than the token-auth requirement above.

Only use this package for code you operate. Installing it in an application that ships to end users would declare those users servers and stop them being counted, which is not something to rely on.

## Support, feedback, and troubleshooting

See the [ably-js repository](https://github.com/ably/ably-js), or [raise an issue](https://github.com/ably/ably-js/issues).
