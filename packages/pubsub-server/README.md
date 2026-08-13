# @ably/pubsub-server

The Ably Pub/Sub client for **servers**: backend services and other trusted runtimes you operate.

This package is a thin wrapper around [`ably`](https://www.npmjs.com/package/ably). It re-exports that package's entire public API and adds factories that additionally declare which side of the connection you are on, so that your own backend services are not billed as your users. Use [`@ably/pubsub-device`](https://www.npmjs.com/package/@ably/pubsub-device) for code running on an end user's device instead.

## Installation

```sh
npm install @ably/pubsub-server
```

`ably` is an exact peer dependency, and npm installs it for you. The two are released together on the same version, so keep them in step.

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

Both return exactly what the `Rest` and `Realtime` constructors return, so everything in the [Ably Pub/Sub JavaScript documentation](https://ably.com/docs/getting-started/javascript) applies unchanged. The only difference is that these clients declare themselves servers.

## Entry points

Everything the core SDK exposes is re-exported here, so you never need to add `ably` as a dependency of your own alongside this package.

| Import from                       | What you get                                                                            |
| --------------------------------- | --------------------------------------------------------------------------------------- |
| `@ably/pubsub-server`             | `createHttpClient`, `createRealtimeClient`, plus the core's entire public API and types |
| `@ably/pubsub-server/liveobjects` | The LiveObjects plugin                                                                  |

```javascript
import { createRealtimeClient } from '@ably/pubsub-server';
import { LiveObjects } from '@ably/pubsub-server/liveobjects';
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

Nothing else changes, other than the token-auth requirement above. The `Rest` and `Realtime` constructors still work and are not going away; they simply declare no side, which means Ably has to fall back to its default classification.

Only use this package for code you operate. Installing it in an application that ships to end users would declare those users servers and stop them being counted, which is not something to rely on.

## Support, feedback, and troubleshooting

See the [ably-js repository](https://github.com/ably/ably-js), or [raise an issue](https://github.com/ably/ably-js/issues).
