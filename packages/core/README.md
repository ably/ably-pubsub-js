# @ably/pubsub-core

**This package is Ably-internal. It is published so that the packages below can depend on it, and is not intended to be installed directly.**

Install one of these instead, according to where your code runs:

| Your code runs on                                                               | Install                                                                    |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| An end user's device — browser, React Native, Electron, mobile or desktop app   | [`@ably/pubsub-device`](https://www.npmjs.com/package/@ably/pubsub-device) |
| Infrastructure you operate — a Node.js server, container or serverless function | [`@ably/pubsub-server`](https://www.npmjs.com/package/@ably/pubsub-server) |

Both re-export this package's entire public API, so nothing is out of reach through them, and both add a `createClient` that declares which side of the connection you are on. That declaration is what lets Ably tell your users' traffic apart from your own backend's, which in turn determines how connections count toward your account's monthly active users. Depending on this package directly declares no side, and leaves Ably to fall back to its default classification.

## What this package is

The shared implementation of the Ably Pub/Sub JavaScript SDK: the realtime and REST clients, the transports, the plugins (push, LiveObjects) and the React hooks. It targets browsers, Node.js and React Native, and it is the single copy of the SDK that both per-side packages resolve at runtime — which is why it is a peer dependency of each rather than bundled into them.

Its public API surface is defined in [`ably.d.ts`](./ably.d.ts), and the [API reference](https://sdk.ably.com/builds/ably/ably-js/main/typedoc/) is generated from it.

## Contributing

See the repository [README](https://github.com/ably/ably-js#readme) and [CONTRIBUTING.md](https://github.com/ably/ably-js/blob/main/CONTRIBUTING.md).
