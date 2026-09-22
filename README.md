![Ably Chat Header](/images/JavaScriptSDK-github.png)
[![npm version](https://img.shields.io/npm/v/@ably/pubsub-device.svg?style=flat)](https://www.npmjs.com/package/@ably/pubsub-device)
[![License](https://badgen.net/github/license/ably/ably-pubsub-js)](https://github.com/ably/ably-pubsub-js/blob/main/LICENSE)

---

# Ably Pub/Sub JavaScript SDK

Build any realtime experience using Ably’s Pub/Sub JavaScript SDK. Supported on all popular platforms and frameworks, including Node, React, and Web Workers.

Ably Pub/Sub provides flexible APIs that deliver features such as pub-sub messaging, message history, presence, and push notifications. Utilizing Ably’s realtime messaging platform, applications benefit from its highly performant, reliable, and scalable infrastructure.

Ably LiveObjects is also available as a Pub/Sub JavaScript SDK plugin. You can use LiveObjects to synchronize application state across your clients at scale.

Find out more:

- [Ably Pub/Sub docs](https://ably.com/docs/basics)
- [Ably Pub/Sub Examples](https://ably.com/examples?product=pubsub)

---

## Getting started

Everything you need to get started with Ably:

- [Getting started with Pub/Sub in JavaScript](https://ably.com/docs/getting-started/javascript)
- [Getting started with Pub/Sub in React](https://ably.com/docs/getting-started/react)
- [Getting started with LiveObjects in JavaScript](https://ably.com/docs/liveobjects/quickstart)

---

## Supported platforms

Ably aims to support a wide range of platforms and all current browser versions, including Chrome, Firefox, Safari, Microsoft Edge, and other modern browsers. If you experience any compatibility issues, open an issue in the repository or contact [Ably support](https://ably.com/support).

The following platforms are supported:

| Platform    | Support                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------- |
| JavaScript  | ES2017                                                                                          |
| Node.js     | See `engines` in [package.json](https://github.com/ably/ably-pubsub-js/blob/main/package.json). |
| React       | >=16.8.x                                                                                        |
| TypeScript  | Type definitions are included in the package.                                                   |
| Web Workers | Browser bundle and [modular](#modular-variant) support.                                         |

> [!NOTE]
> Versions 1.2.x of the SDK support Internet Explorer >=9 and other older browsers, as well as Node.js >=8.17.

> [!IMPORTANT]
> SDK versions < 1.2.36 will be [deprecated](https://ably.com/docs/platform/deprecate/protocol-v1) from November 1, 2025.

---

## Installation

The SDK ships as two packages. Which one you install depends on **where your code runs**, not on which features you need — both give you the same API.

| Your code runs on                                                                | Install                                                                    |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| An end user's device: a browser, React Native, Electron, a mobile or desktop app | [`@ably/pubsub-device`](https://www.npmjs.com/package/@ably/pubsub-device) |
| Infrastructure you operate: a Node.js server, a container, a serverless function | [`@ably/pubsub-server`](https://www.npmjs.com/package/@ably/pubsub-server) |

```sh
npm install @ably/pubsub-device    # in an app that runs on your users' devices
npm install @ably/pubsub-server    # in a backend service that you operate
```

Choosing between them tells Ably which side of the connection a client is on. That matters for more than tidiness: traffic declared as a device counts toward your account's monthly active users and is subject to the per-client-ID concurrency limit, while traffic declared as a server is exempt from both. Choose by who owns the runtime, never by which side is cheaper to declare — declaring the server side from a device claims an exemption it is not entitled to.

The rest of this README uses `@ably/pubsub-device` in its examples. Every one of them works identically with `@ably/pubsub-server`; only the import changes.

You can also source the SDK directly in your HTML. (This url will point to the latest version of v2 of the SDK, the current major version, avoiding breaking changes per semver.)

```html
<script src="https://cdn.ably.com/lib/ably.min-2.js"></script>
```

> [!NOTE]
> The CDN bundle is the shared core, and so declares no side. Clients created from it are classified by Ably's default rules. Install one of the packages above if you want to declare a side explicitly.

## Usage

The following code connects to Ably's realtime messaging service, subscribes to a channel to receive messages, and publishes a test message to that same channel.

```javascript
import { createClient } from '@ably/pubsub-device';

// Initialize an Ably Realtime client that declares the device side
const realtimeClient = createClient({ key: 'your-ably-api-key', clientId: 'me' });

// Wait for connection to be established
await realtimeClient.connection.once('connected');
console.log('Connected to Ably');

// Get a reference to the 'test-channel' channel
const channel = realtimeClient.channels.get('test-channel');

// Subscribe to all messages published to this channel
await channel.subscribe((message) => {
  console.log(`Received message: ${message.data}`);
});

// Publish a test message to the channel
await channel.publish('test-event', 'hello world');
```

For a stateless REST client, construct `Rest` directly — `createClient` is realtime-only, and there is no HTTP-only factory:

```javascript
import { Rest } from '@ably/pubsub-device';

const restClient = new Rest({ key: 'your-ably-api-key', clientId: 'me' });
```

## Modular variant

The Pub/Sub SDK has a modular (tree-shakable) variant to build with a small bundle sizes.

<details>
<summary>Modular variant details.</summary>

Aimed at those who are concerned about their app's bundle size, the modular variant of the library allows you to create a client which has only the functionality that you choose. Unused functionality can then be tree-shaken by your module bundler.

The modular variant of the library provides:

- A `createClient` factory, which builds a `BaseRealtime` declaring the device side;
- the `BaseRealtime` class itself, if you would rather construct it directly and declare no side;
- various plugins that add functionality to a `BaseRealtime` instance, such as `Rest`, `RealtimePresence`, etc.

To use this variant of the library, import `createClient` from `@ably/pubsub-device/modular`, along with the plugins that you wish to use. Then, pass these plugins in the client options as shown in the example below:

```javascript
import { createClient, WebSocketTransport, FetchRequest, RealtimePresence } from '@ably/pubsub-device/modular';

const client = createClient({
  key: 'YOUR_ABLY_API_KEY', // Replace with a real key from the Ably dashboard
  plugins: {
    WebSocketTransport,
    FetchRequest,
    RealtimePresence,
  },
});
```

The modular subpath is ESM only, so it cannot be `require`d. It declares the device side exactly as the root `createClient` does; unlike the root factory it takes only an options object, because a modular client is unusable without the plugins that `plugins` carries.

You must provide:

- At least one HTTP request implementation; that is, one of `FetchRequest` or `XHRRequest`;
- At least one realtime transport implementation; that is, one of `WebSocketTransport` or `XHRPolling`.

The client `createClient` returns here is a `BaseRealtime`, which offers the same API as the `Realtime` class described in the rest of this `README`. This means that you can develop an application using the default variant of the SDK and switch to the modular version when you wish to optimize your bundle size.

In order to further reduce bundle size, the modular variant of the SDK performs less logging than the default variant. It only logs:

- Messages that have a `logLevel` of 1 (that is, errors)
- A small number of other network events

If you require more verbose logging, use the default variant of the SDK.

For more information view the [TypeDoc references](https://sdk.ably.com/builds/ably/ably-pubsub-js/main/typedoc/modules/modular.html).

</details>

---

## Contribute

Read the [CONTRIBUTING.md](./CONTRIBUTING.md) guidelines to contribute to Ably.

---

## Releases

The [CHANGELOG.md](/ably/ably-pubsub-js/blob/main/CHANGELOG.md) contains details of the latest releases for this SDK. You can also view all Ably releases on [changelog.ably.com](https://changelog.ably.com).

---

## Support, feedback, and troubleshooting

For help or technical support, visit Ably's [support page](https://ably.com/support) or [GitHub Issues](https://github.com/ably/ably-pubsub-js/issues) for community-reported bugs and discussions.

### Chrome extensions

Ably Pub/Sub works out-of-the-box in background scripts for Chrome extensions using manifest v2. However, since manifest v3 background pages are no longer supported, you will need to run Ably Pub/Sub JavaScript SDK inside a service worker.

<details>
<summary>Chrome extensions support details.</summary>

If you are using this SDK in a service worker, note:

- In versions of Chrome before 116, active WebSockets would not reset the 30s service worker idle timer, resulting in the client being closed prematurely.
- In versions 116 and above, service workers will stay active as long as a client is connected.

To ensure compatibility, add the following to your `manifest.json`:

If you are using this SDK's realtime features, for example, WebSockets in a service worker, note:

- In versions of Chrome before 116, active WebSockets would not reset the 30s service worker idle timer, resulting in the client being closed prematurely.
- In versions 116 and above, service workers will stay active as long as a client is connected.

To ensure compatibility, add the following to your `manifest.json`:

```json
{
  // ...
  "minimum_chrome_version": "116"
  // ...
}
```

</details>

### "Connection limit exceeded" errors during development

If you're hitting a "connection limit exceeded" error and see rising connection counts in your Ably dashboard, it's likely due to multiple realtime clients being created during development.

<details>
<summary>"Connection limit exceeded" support details.</summary>

Even for `use client` components, Next.js may execute them on the server during pre-rendering. This can create unintended realtime connections from Node.js that remain open until you restart the development server.

To prevent server-side connections, create the Ably client inside a `useEffect` hook so it only runs in the browser:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@ably/pubsub-device';
import { AblyProvider } from '@ably/pubsub-device/react';

export default function AblyClientProvider({ children }) {
  const [client, setClient] = useState(null);

  useEffect(() => {
    const ably = createClient({ authUrl: '/token', authMethod: 'POST', clientId: 'demo' });
    setClient(ably);
    return () => {
      ably.close();
    };
  }, []);

  if (!client) return <div>Loading...</div>;

  return <AblyProvider client={client}>{children}</AblyProvider>;
}
```

Avoid creating the client inside [React](https://github.com/ably/ably-pubsub-js/blob/main/docs/react.md#Usage) component bodies, as this leads to a new connection on every render. Use the `useEffect` + `useState` pattern shown above, or move the client to a shared provider at the layout level.

In development environments that use Hot Module Replacement (HMR), such as React, Vite, or Next.js, saving a file can recreate the realtime client, while previous instances remain connected. Over time, this leads to a growing number of active connections with each code edit. To fix: Move the client to a separate file (e.g., `ably-client.js`) and import it. This ensures the client is recreated only when that file changes.

</details>

### Next.js with App Router and Turbopack

If you encounter a `Failed to compile Module not found` error or warnings related to `keyv` when using Ably Pub/Sub JavaScript SDK with [Next.js](https://nextjs.org/docs/app/api-reference/next-config-js/serverComponentsExternalPackages), add the SDK to the `serverComponentsExternalPackages` list in `next.config.js`.

<details>
<summary>Next.js with App Router and Turbopack support details.</summary>

The following example does so in `next.config.js`. List whichever package your Route Handlers and Server Components load — `@ably/pubsub-server` in a backend route, `@ably/pubsub-device` if a client component is being pre-rendered — together with the shared core they both load:

```javascript
const nextConfig = {
  // ...
  experimental: {
    serverComponentsExternalPackages: ['@ably/pubsub-server', '@ably/pubsub-core'],
  },
};
```

The issue is coming from the fact that when using App Router specifically, dependencies used inside Server Components and Route Handlers will automatically be bundled by Next.js. This causes issues with some packages, usually the ones that have complex `require` statements, for example, requiring some packages dynamically during runtime. `keyv` is one of those packages as it uses `require` statement dynamically when requiring its adapters (see [code in repo](https://github.com/jaredwray/keyv/blob/main/packages/keyv/src/index.ts#L102)):

`keyv` ends up being one of `ably-js`'s upstream dependencies for the node.js bundle, which causes the errors above when using it with Next.js App Router.

Using `serverComponentsExternalPackages` opts out from using Next.js bundling for specific packages and uses native Node.js `require` instead.
This is a common problem in App Router for a number of packages (for example, see next.js issue [vercel/next.js#52876](https://github.com/vercel/next.js/issues/52876)), and using `serverComponentsExternalPackages` is the recommended approach here.

</details>

### General errors during development

If you encounter an error such as `connection limit exceeded` during development, it may be caused by several issues.

<details>
<summary>General errors support details.</summary>

#### Server-side rendering (SSR)

Create the Ably client inside a `useEffect` hook to prevent it from connecting when rendered on the server:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@ably/pubsub-device';

export default function MyComponent() {
  const [client, setClient] = useState(null);

  useEffect(() => {
    const ably = createClient({ authUrl: '/token', authMethod: 'POST', clientId: 'demo' });
    setClient(ably);
    return () => {
      ably.close();
    };
  }, []);

  if (!client) return <div>Loading...</div>;

  // Use client here
}
```

#### Component re-renders

Avoid creating the client inside React component bodies, as this creates a new connection on every render. Use the `useEffect` + `useState` pattern shown above to ensure the client is created once.

#### Hot module replacement (HMR)

To avoid duplicate client instances caused by hot reloads, move the `createClient()` call into a separate file, for example, `ably.js` and export the client from there. This ensures a single shared instance is reused during development.

</details>
