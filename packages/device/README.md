# @ably/pubsub-device

The Ably Pub/Sub client for **devices**: browsers, React Native, Electron, mobile and desktop apps, and any other runtime where the code runs under an end user's control.

This package is a thin wrapper around [`@ably/pubsub-core`](https://www.npmjs.com/package/@ably/pubsub-core). It re-exports that package's entire public API and adds a factory that additionally declares which side of the connection you are on, so Ably can tell your users apart from your own backend services. Use [`@ably/pubsub-server`](https://www.npmjs.com/package/@ably/pubsub-server) for a backend service instead.

## Installation

```sh
npm install @ably/pubsub-device
```

`@ably/pubsub-core` is an exact peer dependency, and npm installs it for you. The two are released together on the same version, so keep them in step.

## Usage

```javascript
import { createClient } from '@ably/pubsub-device';

const client = createClient({ key: 'your-ably-api-key', clientId: 'me' });

await client.connection.once('connected');

const channel = client.channels.get('test-channel');
await channel.subscribe((message) => {
  console.log(`Received message: ${message.data}`);
});

await channel.publish('test-event', 'hello world');
```

`createClient` returns exactly the client the `Realtime` constructor returns, so everything in the [Ably Pub/Sub JavaScript documentation](https://ably.com/docs/getting-started/javascript) applies unchanged. The only difference is that this client declares itself a device.

In production, prefer [token authentication](https://ably.com/docs/auth/token) over embedding an API key in code that ships to a device.

## Entry points

Everything the core SDK exposes is re-exported here, so you never need to add `@ably/pubsub-core` as a dependency of your own alongside this package.

| Import from                             | What you get                                                          |
| --------------------------------------- | --------------------------------------------------------------------- |
| `@ably/pubsub-device`                   | `createClient`, plus the core's entire public API and type surface    |
| `@ably/pubsub-device/modular`           | `createClient` over the tree-shakable `BaseRealtime`, and its plugins |
| `@ably/pubsub-device/react`             | The React hooks: `AblyProvider`, `useChannel`, `usePresence`, …       |
| `@ably/pubsub-device/liveobjects`       | The LiveObjects plugin                                                |
| `@ably/pubsub-device/liveobjects/react` | The `useObject` React hook for LiveObjects                            |
| `@ably/pubsub-device/push`              | The web push plugin                                                   |
| `@ably/pubsub-device/react-native-push` | The React Native push plugin                                          |

```javascript
import { createClient } from '@ably/pubsub-device';
import { AblyProvider, useChannel } from '@ably/pubsub-device/react';
import { LiveObjects } from '@ably/pubsub-device/liveobjects';
import { Push } from '@ably/pubsub-device/push';
```

Every subpath exports under a name, so the import spelling is the same whichever one you reach for, and the same under both module systems. Each is the same object the core exports, not a copy, so a plugin registered from here is the one the client expects.

`@ably/pubsub-device/modular` can only be imported, not `require`d, because the core's modular variant is published behind an `import` condition alone. Every other subpath above works under both module systems.

Use `@ably/pubsub-device/react-native-push` in a React Native application; the web push plugin is not a substitute for it.

## What declaring the device side means

Device traffic counts toward your account's monthly active users. On an account billed by MAU:

- a device connection **must** carry a client ID, and is rejected at connect without one, so set `clientId` or issue tokens that carry one;
- a device client ID is subject to a per-client-ID concurrency limit.

Traffic from `@ably/pubsub-server` is exempt from both.

Choose between the two packages by who owns the runtime, not by which side is cheaper to declare. Code that runs on an end user's device (a browser tab, a mobile app, a desktop app) belongs on `@ably/pubsub-device`; code that runs on infrastructure you operate belongs on `@ably/pubsub-server`. Declaring the device side from a backend service inflates your monthly active user count and subjects that service to the per-client-ID concurrency limit; declaring the server side from a device claims an exemption it is not entitled to.

## Migrating from `@ably/pubsub-core`

Replace the `Realtime` constructor with `createClient`, and change the import:

```diff
- import * as Ably from '@ably/pubsub-core';
- const client = new Ably.Realtime({ key, clientId: 'me' });
+ import { createClient } from '@ably/pubsub-device';
+ const client = createClient({ key, clientId: 'me' });
```

Nothing else changes. The `Realtime` constructor still works and is not going away; it simply declares no side, which means Ably has to fall back to its default classification.

This package ships no HTTP-only factory. If you need a stateless REST client on a device, keep using `new Ably.Rest(...)` from `@ably/pubsub-core` — do not reach for `@ably/pubsub-server`, which would declare your device a server and claim an exemption it is not entitled to.

## Support, feedback, and troubleshooting

See the [ably-js repository](https://github.com/ably/ably-js), or [raise an issue](https://github.com/ably/ably-js/issues).
