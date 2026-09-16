# Migration guide for ably-js v3

v3 splits the SDK into two packages, one per side of the connection, and this repository no longer publishes `ably`:

| Your code runs on                                                                | Install               |
| -------------------------------------------------------------------------------- | --------------------- |
| An end user's device: a browser, React Native, Electron, a mobile or desktop app | `@ably/pubsub-device` |
| Infrastructure you operate: a Node.js server, a container, a serverless function | `@ably/pubsub-server` |

Here's how to migrate from ably-js v2 to v3:

1. [Prepare on v2](#prepare-on-v2), by stopping use of the functionality that v3 removes.
2. [Switch to a per-side package](#switch-package).
3. [Create your clients through the factories](#use-the-factories).
4. [Rename `Rest` to `Http`](#rest-to-http).

<h2 id="prepare-on-v2">Prepare on v2</h2>

Everything in this section can be done while you are still on v2, where the replacement APIs already exist and the old ones only log a deprecation warning. Doing it first keeps the version bump itself small.

<h3 id="endpoint">Replace <code>environment</code>, <code>restHost</code> and <code>realtimeHost</code> with <code>endpoint</code></h3>

The `environment`, `restHost` and `realtimeHost` client options are removed in v3. The `endpoint` client option replaces all three.

> [!IMPORTANT]
> These options are removed, not renamed, and v3 does not reject them: a client that still passes `environment` connects to the default endpoint instead.

`endpoint` takes either a routing policy ID or a hostname, and which one you pass decides how the primary and fallback domains are derived:

| v2                                      | v3                                      | Primary domain           | Fallback domains                        |
| --------------------------------------- | --------------------------------------- | ------------------------ | --------------------------------------- |
| `{ environment: 'main' }` (or unset)    | `{ endpoint: 'main' }` (or unset)       | `main.realtime.ably.net` | `main.{a–e}.fallback.ably-realtime.com` |
| `{ environment: 'foo' }`                | `{ endpoint: 'foo' }`                   | `foo.realtime.ably.net`  | `foo.{a–e}.fallback.ably-realtime.com`  |
| `{ restHost: 'test.org' }`              | `{ endpoint: 'test.org' }`              | `test.org`               | none                                    |
| `{ realtimeHost: 'test.org' }`          | `{ endpoint: 'test.org' }`              | `test.org`               | none                                    |
| `{ restHost: 'localhost', port: 8080 }` | `{ endpoint: 'localhost', port: 8080 }` | `localhost`              | none                                    |

<h3 id="get-device">Replace <code>device()</code> with <code>await getDevice()</code></h3>

The synchronous `device()` accessor on the client is removed. `getDevice()` replaces it, and returns a promise, so that it also works on platforms whose push storage is asynchronous, such as React Native.

```diff
- const device = client.device();
+ const device = await client.getDevice();
```

<h3 id="recovery-key">Replace <code>connection.recoveryKey</code> with <code>connection.createRecoveryKey()</code></h3>

```diff
- const recoveryKey = client.connection.recoveryKey;
+ const recoveryKey = client.connection.createRecoveryKey();
```

In v2 `recoveryKey` was a getter that returned `createRecoveryKey()` and logged a deprecation warning, so the replacement is exact: both return `null` when there is nothing to recover. It had already been dropped from the TypeScript definitions before v3.

<h3 id="entry-point-shims">Stop importing the <code>promises</code> and <code>callbacks</code> entry points</h3>

The `ably/promises` and `ably/callbacks` subpaths existed only to help v1 code find the promise-based API. They are removed, and have no equivalent on the new packages. Import from the package root instead — the API there is the promise-based one.

```diff
- import * as Ably from 'ably/promises';
+ import { createClient } from '@ably/pubsub-device';
```

The v1 callback-signature overloads that TypeScript showed struck through are also gone from the type definitions. The runtime guards that reject a v1-style callback argument remain, so such a call still fails with an error explaining what to do rather than failing only at compile time.

<h3 id="liveobjects-wire-fields">Stop reading the deprecated LiveObjects wire fields</h3>

Only relevant if your code inspects raw LiveObjects `ObjectMessage` payloads. The deprecated duplicates of the typed fields are removed:

| Removed                     | Use instead                                                     |
| --------------------------- | --------------------------------------------------------------- |
| `ObjectOperation.mapOp`     | `ObjectOperation.mapSet` / `ObjectOperation.mapRemove`          |
| `ObjectOperation.counterOp` | `ObjectOperation.counterInc`                                    |
| `ObjectOperation.map`       | `ObjectOperation.mapCreate`                                     |
| `ObjectOperation.counter`   | `ObjectOperation.counterCreate`                                 |
| `ObjectData.value`          | `ObjectData.boolean`, `.bytes`, `.number`, `.string` or `.json` |

The `ObjectsMapOp`, `ObjectsCounterOp`, `ObjectsMap` and `ObjectsCounter` types, which existed only to describe those fields, are removed with them. Wire decoding is unaffected: these fields were only ever written on the way out, alongside the typed fields that replace them.

<h2 id="switch-package">Switch to a per-side package</h2>

Pick the package by **who owns the runtime**, not by which features you need — both expose the same API — and not by which side is cheaper to declare. Code that runs on an end user's device belongs on `@ably/pubsub-device`; code that runs on infrastructure you operate belongs on `@ably/pubsub-server`. See [What declaring a side means](#what-declaring-a-side-means) for why this matters.

```sh
npm uninstall ably

npm install @ably/pubsub-device    # in an app that runs on your users' devices
npm install @ably/pubsub-server    # in a backend service that you operate
```

`@ably/pubsub-core` is an exact peer dependency of both, and npm installs it for you. You do not need to depend on it directly, and should not import from it: everything it exports is re-exported from the package you installed. The three packages release together on the same version, so keep them in step.

A repository with both a frontend and a backend installs both packages, one in each. They are independent, and nothing stops a single monorepo containing both.

<h3 id="import-paths">Update your import paths</h3>

Every `ably` subpath has a counterpart on `@ably/pubsub-device`:

| v2                                | v3                                      | What you get                                                          |
| --------------------------------- | --------------------------------------- | --------------------------------------------------------------------- |
| `ably`                            | `@ably/pubsub-device`                   | `createClient`, plus the core's entire public API and type surface    |
| `ably/modular`                    | `@ably/pubsub-device/modular`           | `createClient` over the tree-shakable `BaseRealtime`, and its plugins |
| `ably/react`                      | `@ably/pubsub-device/react`             | The React hooks: `AblyProvider`, `useChannel`, `usePresence`, …       |
| `ably/liveobjects`                | `@ably/pubsub-device/liveobjects`       | The LiveObjects plugin                                                |
| `ably/liveobjects/react`          | `@ably/pubsub-device/liveobjects/react` | The `useObject` React hook for LiveObjects                            |
| `ably/push`                       | `@ably/pubsub-device/push`              | The web push plugin                                                   |
| `ably/react-native-push`          | `@ably/pubsub-device/react-native-push` | The React Native push plugin                                          |
| `ably/promises`, `ably/callbacks` | — (removed)                             | See [above](#entry-point-shims)                                       |

`@ably/pubsub-server` carries only what a server needs:

| v2                 | v3                                | What you get                                                                            |
| ------------------ | --------------------------------- | --------------------------------------------------------------------------------------- |
| `ably`             | `@ably/pubsub-server`             | `createHttpClient`, `createRealtimeClient`, plus the core's entire public API and types |
| `ably/liveobjects` | `@ably/pubsub-server/liveobjects` | The LiveObjects plugin                                                                  |

Push receive and the React hooks are device-side concerns and are not re-exported on the server package. The modular variant is device-side too: it exists to shrink a browser bundle.

If you source the SDK from the CDN rather than npm, nothing changes in how you load it, but note that the CDN bundle is the shared core and so declares no side. Clients created from it are classified by Ably's default rules.

<h2 id="use-the-factories">Create your clients through the factories</h2>

The constructors still exist and still work. What they do not do is declare a side, which means Ably has to fall back to its default classification. The factories are how a client says which side it is on.

On a device:

```diff
- import * as Ably from 'ably';
- const client = new Ably.Realtime({ key, clientId: 'me' });
+ import { createClient } from '@ably/pubsub-device';
+ const client = createClient({ key, clientId: 'me' });
```

On a server, one factory per client kind:

```diff
- import * as Ably from 'ably';
- const rest = new Ably.Rest({ key });
- const realtime = new Ably.Realtime({ key });
+ import { createHttpClient, createRealtimeClient } from '@ably/pubsub-server';
+ const pubSubHttpClient = createHttpClient({ key });
+ const pubSubRealtimeClient = createRealtimeClient({ key });
```

Each factory returns exactly what the constructor it wraps returns, so the rest of your code is unchanged. Like the constructors, they accept a client options object, an API key, or a token.

In the modular variant, the factory comes from the `modular` subpath and takes only an options object, never a bare key or token string, because a modular client is unusable without the plugins that `plugins` carries:

```diff
- import { BaseRealtime, WebSocketTransport, FetchRequest } from 'ably/modular';
- const client = new BaseRealtime({ key, plugins: { WebSocketTransport, FetchRequest } });
+ import { createClient, WebSocketTransport, FetchRequest } from '@ably/pubsub-device/modular';
+ const client = createClient({ key, plugins: { WebSocketTransport, FetchRequest } });
```

If an SDK of your own sits on top of this one and sets its own `agents` entries, those are preserved: the side entry is added alongside them.

<h3 id="what-declaring-a-side-means">What declaring a side means</h3>

Device traffic counts toward your account's monthly active users. On an account billed by MAU:

- a device connection **must** carry a client ID, and is rejected at connect without one, so set `clientId` or issue tokens that carry one;
- a device client ID is subject to a per-client-ID concurrency limit.

Server traffic is exempt from monthly active user counting, from the per-client-ID concurrency limit, and from the client ID requirement.

Declaring the device side from a backend service inflates your monthly active user count and subjects that service to the per-client-ID concurrency limit. Declaring the server side from a device claims an exemption it is not entitled to.

<h3 id="server-token-auth">With token authentication, you must add a claim</h3>

> [!IMPORTANT]
> Read this before deploying `@ably/pubsub-server`. Ably grants the server side on token auth only from a signed `x-ably-clientType=server` claim on the token itself. A client that declares itself a server without that claim is **rejected at connect**, not quietly treated as a device.

So if your server authenticates with `authUrl` or `authCallback`, add that claim to the tokens your auth service issues **before** you deploy `@ably/pubsub-server`. Rolling the package out ahead of that change breaks the connection rather than degrading it.

With an API key there is nothing to do: the `ably-pubsub-server` agent entry the factories send is enough on its own.

This applies only to `@ably/pubsub-server`. `@ably/pubsub-device` needs no claim.

<h2 id="rest-to-http">Rename <code>Rest</code> to <code>Http</code></h2>

The stateless client family is named after its transport in v3, matching the `createHttpClient` factory: `Rest` becomes `Http` throughout the public API.

In the main API surface:

| v2                   | v3                   |
| -------------------- | -------------------- |
| `RestClient`         | `HttpClient`         |
| `RestAnnotations`    | `HttpAnnotations`    |
| `RestHistoryParams`  | `HttpHistoryParams`  |
| `RestPresenceParams` | `HttpPresenceParams` |

In the modular variant:

| v2                    | v3                    |
| --------------------- | --------------------- |
| `BaseRest`            | `BaseHttp`            |
| the `Rest` plugin     | the `Http` plugin     |
| `ModularPlugins.Rest` | `ModularPlugins.Http` |

```diff
- import { BaseRealtime, WebSocketTransport, FetchRequest, Rest } from 'ably/modular';
- const realtime = new BaseRealtime({ ...options, plugins: { WebSocketTransport, FetchRequest, Rest } });
+ import { createClient, WebSocketTransport, FetchRequest, Http } from '@ably/pubsub-device/modular';
+ const realtime = createClient({ ...options, plugins: { WebSocketTransport, FetchRequest, Http } });
```

In LiveObjects, every `Rest`-prefixed type follows the same rule — `Rest` becomes `Http`, the rest of the name is unchanged:

| v2                                                                                                    | v3                                                                                                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `RestObject`                                                                                          | `HttpObject`                                                                                          |
| `RestObjectDataMapEntry`                                                                              | `HttpObjectDataMapEntry`                                                                              |
| `RestObjectGetParams`, `RestObjectGetCompactParams`, `RestObjectGetFullParams`                        | `HttpObjectGetParams`, `HttpObjectGetCompactParams`, `HttpObjectGetFullParams`                        |
| `RestObjectGetCompactResult`, `RestObjectGetFullResult`                                               | `HttpObjectGetCompactResult`, `HttpObjectGetFullResult`                                               |
| `RestObjectGenerateIdResult`                                                                          | `HttpObjectGenerateIdResult`                                                                          |
| `RestObjectPublishResult`                                                                             | `HttpObjectPublishResult`                                                                             |
| `RestObjectOperation`, `RestObjectOperationBase`                                                      | `HttpObjectOperation`, `HttpObjectOperationBase`                                                      |
| `RestObjectOperationMapCreate`, `…MapCreateBody`, `…MapCreateWithObjectId`, `…MapSet`, `…MapRemove`   | `HttpObjectOperationMapCreate`, `…MapCreateBody`, `…MapCreateWithObjectId`, `…MapSet`, `…MapRemove`   |
| `RestObjectOperationCounterCreate`, `…CounterCreateBody`, `…CounterCreateWithObjectId`, `…CounterInc` | `HttpObjectOperationCounterCreate`, `…CounterCreateBody`, `…CounterCreateWithObjectId`, `…CounterInc` |
| `RestLiveObject`, `RestLiveMap`, `RestLiveCounter`, `RestLiveObjectMapEntry`                          | `HttpLiveObject`, `HttpLiveMap`, `HttpLiveCounter`, `HttpLiveObjectMapEntry`                          |
| `AnyRestLiveObject`                                                                                   | `AnyHttpLiveObject`                                                                                   |
| `AnyTargetRestObjectOperationBase`                                                                    | `AnyTargetHttpObjectOperationBase`                                                                    |

JavaScript users are affected only by the `Rest` class and the modular `Rest` plugin; the rest are types, and TypeScript will point at every use.

What the rename deliberately leaves alone: the `restAgentOptions` and `idempotentRestPublishing` client options, which are cross-SDK spec option names; and prose and documentation URLs about Ably's REST API, which is still called the REST API. The removed `restHost` option is covered by [`endpoint`](#endpoint) instead.

> [!NOTE]
> If you reach into the client's internals, the request layer moved: `client.http` is now the modular `Http` plugin slot, and the requester is at `client.httpRequester`. Both are private API and neither is in `ably.d.ts`.

<h2 id="reference">Full list of breaking changes</h2>

| Change                                                                                                                                                                                     | Action                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| Install `@ably/pubsub-device` or `@ably/pubsub-server` and update every import ([step 2](#switch-package))                                                                                 |
| `ably/promises` and `ably/callbacks` entry points removed                                                                                                                                  | Import from the package root ([above](#entry-point-shims)) |
| `Rest` → `Http` across the public API, the modular plugins, and the LiveObjects types                                                                                                      | Rename ([step 4](#rest-to-http))                           |
| `environment`, `restHost` and `realtimeHost` client options removed — **silently ignored**, not rejected                                                                                   | Use `endpoint` ([above](#endpoint))                        |
| `device()` removed from the `Http` and `Realtime` clients                                                                                                                                  | `await getDevice()` ([above](#get-device))                 |
| `Connection.recoveryKey` removed                                                                                                                                                           | `Connection.createRecoveryKey()` ([above](#recovery-key))  |
| v1 callback-signature overloads removed from the type definitions                                                                                                                          | Await the returned promise ([above](#entry-point-shims))   |
| LiveObjects `ObjectOperation.mapOp`, `.counterOp`, `.map`, `.counter` and `ObjectData.value` removed, with the `ObjectsMapOp`, `ObjectsCounterOp`, `ObjectsMap` and `ObjectsCounter` types | Use the typed fields ([above](#liveobjects-wire-fields))   |
| `Ably-Agent` SDK identifier is `ably-pubsub-js`, and the side entries are versionless                                                                                                      | Update anything matching on it ([step 5](#agent))          |
