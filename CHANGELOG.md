# Change Log

This contains only the most important and/or user-facing changes; for a full changelog, see the commit history.

## [2.28.0](https://github.com/ably/ably-js/tree/2.28.0) (2026-08-21)

[Full Changelog](https://github.com/ably/ably-js/compare/2.27.0...2.28.0)

### What's Changed

- Roll out e2e encryption of `data` payloads on annotations. They were previously a message type whose publish path deliberately did not apply the channel's encryption (and were documented accordingly), but the reasons for this no longer apply, so there is no reason now not to enable e2e encryption on annotation payloads. [#2277](https://github.com/ably/ably-js/pull/2277)

## [2.27.0](https://github.com/ably/ably-js/tree/2.27.0) (2026-08-10)

[Full Changelog](https://github.com/ably/ably-js/compare/2.26.0...2.27.0)

### What's Changed

- Fall back to the base transport when a proxy rejects the WebSocket handshake outright, rather than reporting `disconnected` after exhausting every host [#2285](https://github.com/ably/ably-js/pull/2285)
- Move connection resumability decisions from the client to the server: `Connection#id`, `Connection#key` and a channel's `channelSerial` are retained through `SUSPENDED`, and reconnection always attempts a resume. `Connection#createRecoveryKey()` consequently returns a recovery key in `SUSPENDED`, where it previously returned `null` [#2273](https://github.com/ably/ably-js/pull/2273)
- Fix a resumed attach advancing the channel's attach serial, which broke the contiguity of `untilAttach` history with the realtime message stream [#2276](https://github.com/ably/ably-js/pull/2276)
- Fix stale presence members surviving when a new presence sync replaces one still in progress [#2261](https://github.com/ably/ably-js/pull/2261)
- Expand the docstrings on `Auth`, `RealtimeChannel`, `RealtimePresence`, `RealtimeAnnotations` and `RestAnnotations` to cover prerequisites, side effects and failure modes, and link the REST `Channel` and `Presence` members to their reference pages [#2242](https://github.com/ably/ably-js/pull/2242) [#2243](https://github.com/ably/ably-js/pull/2243) [#2244](https://github.com/ably/ably-js/pull/2244) [#2245](https://github.com/ably/ably-js/pull/2245) [#2282](https://github.com/ably/ably-js/pull/2282)

## [2.26.0](https://github.com/ably/ably-js/tree/2.26.0) (2026-07-22)

[Full Changelog](https://github.com/ably/ably-js/compare/2.25.0...2.26.0)

### What's Changed

- Add `push.updateToken()` to update the device's push token on React Native after the underlying push platform rotates it, keeping the device registration in sync with Ably [#2267](https://github.com/ably/ably-js/pull/2267)
- Add a `useObject` React hook for subscribing to LiveObjects state [#2259](https://github.com/ably/ably-js/pull/2259)
- `PathObject.instance()` method now returns `undefined` only if nothing exists at that path. It wraps whatever value resolves there: a `LiveMap`, a `LiveCounter`, or a primitive value. A primitive-backed `Instance` is read-only: it has no `id` and exposes the primitive via `value()`.

## [2.25.0](https://github.com/ably/ably-js/tree/2.25.0) (2026-07-17)

[Full Changelog](https://github.com/ably/ably-js/compare/2.24.0...2.25.0)

### What's Changed

- Add push notification support for React Native via the new `ably/react-native-push` plugin. Adds an asynchronous `client.getDevice()` and deprecates the synchronous `client.device()` [#2262](https://github.com/ably/ably-js/pull/2262)
- Surface previously silent failures when channel modes are missing: `presence.get()` without the `presence_subscribe` mode and `channel.subscribe()` without the `subscribe` mode now log an error, or throw when the new `strictMode` client option is enabled [#2236](https://github.com/ably/ably-js/pull/2236)

## [2.24.0](https://github.com/ably/ably-js/tree/2.24.0) (2026-07-08)

[Full Changelog](https://github.com/ably/ably-js/compare/2.23.0...2.24.0)

### What's Changed

- Add iOS Live Activity support via APNs broadcast channels: `push.admin.createApnsBroadcast` and `push.admin.liveActivity` (`start`/`update`/`end`) [#2253](https://github.com/ably/ably-js/pull/2253)
- Fix: use error code `40106` for missing credentials [#2254](https://github.com/ably/ably-js/pull/2254)

## [2.23.0](https://github.com/ably/ably-js/tree/2.23.0) (2026-06-19)

[Full Changelog](https://github.com/ably/ably-js/compare/2.22.1...2.23.0)

### What's Changed

- Allow omitting `channelName` in the React channel hooks to use the nearest `ChannelProvider` [#2248](https://github.com/ably/ably-js/pull/2248)
- Fix presence auto-reenter causing "Unable to perform operation on channel" NACKs after reconnecting from a transient disconnect; presence operations are now queued at the channel level until the channel next re-attaches [#2241](https://github.com/ably/ably-js/pull/2241)

## [2.22.1](https://github.com/ably/ably-js/tree/2.22.1) (2026-06-08)

[Full Changelog](https://github.com/ably/ably-js/compare/2.22.0...2.22.1)

### What's Changed

- Fix v1-callback deprecated overloads breaking mock assignment by changing return type from `never` to `void` [#2239](https://github.com/ably/ably-js/pull/2239)

## [2.22.0](https://github.com/ably/ably-js/tree/2.22.0) (2026-06-05)

[Full Changelog](https://github.com/ably/ably-js/compare/2.21.0...2.22.0)

### What's Changed

- Make `agent` channel option additive in React hooks [#2237](https://github.com/ably/ably-js/pull/2237)
- Add missing `RestAnnotation#delete` typings [#2218](https://github.com/ably/ably-js/pull/2218)
- Throw on legacy v1 `ably/promises` and `ably/callbacks` imports [#2227](https://github.com/ably/ably-js/pull/2227)
- Mark v1 callback API as deprecated and throw on v1 callback shapes [#2226](https://github.com/ably/ably-js/pull/2226)
- Mark public `ObjectMessage.id` and `.timestamp` as optional [#2230](https://github.com/ably/ably-js/pull/2230)
- Add `PathEvent.isOriginalTarget` as alternative to `bubbles` for LiveObjects path subscriptions [#2223](https://github.com/ably/ably-js/pull/2223)
- Introduce `Path` type alias for path arrays in LiveObjects code [#2222](https://github.com/ably/ably-js/pull/2222)
- Change `channels#release` semantics to implicit detach rather than error on unexpected channel state [#2190](https://github.com/ably/ably-js/pull/2190)
- Bump `ws` to 8.20.1 to resolve security advisory [#2225](https://github.com/ably/ably-js/pull/2225)

## [2.21.0](https://github.com/ably/ably-js/tree/2.21.0) (2026-03-19)

### New features

- Add LiveObjects REST client: `channel.object` is now available on REST channel instances, exposing `get()` to read object state, `publish()` to send object operations, and `generateObjectId()` to create object IDs on the client side for atomic batch operations with cross-references between newly created objects [#2109](https://github.com/ably/ably-js/pull/2109)

## [2.20.0](https://github.com/ably/ably-js/tree/2.20.0) (2026-03-13)

With this release, the ably-js LiveObjects API is no longer in Public Preview and is now generally available.

Key changes:

- Introduce version 6 of the Ably protocol; add operation-specific payload fields to `ObjectOperation` and typed value fields to `ObjectData` exposed in LiveObjects subscription callbacks; deprecate `map`, `counter`, `mapOp`, `counterOp` on `ObjectOperation` and `value` on `ObjectData` [#2159](https://github.com/ably/ably-js/pull/2159)
- Add support for partial sync of LiveObjects state [#2152](https://github.com/ably/ably-js/pull/2152)
- Add support for server-initiated `MAP_CLEAR` object operation [#2176](https://github.com/ably/ably-js/pull/2176)
- Return `history` function from `useChannel` hook [#2177](https://github.com/ably/ably-js/pull/2177)

## [2.19.0](https://github.com/ably/ably-js/tree/2.19.0) (2026-03-02)

### New features

- Add optional `detail` field support to `ErrorInfo` [\#2171](https://github.com/ably/ably-js/pull/2171)

### Bug fixes

- Fix clearing buffered object operations during sync sequence [\#2150](https://github.com/ably/ably-js/pull/2150)

## [2.18.0](https://github.com/ably/ably-js/tree/2.18.0) (2026-02-23)

### New features

#### LiveObjects operations are now applied on acknowledgement

When you call a LiveObjects mutation method (e.g. `map.set()`), the SDK now applies the effects of this operation to the local LiveObjects data as soon as it receives the server's acknowledgement of the operation. This is an improvement over earlier versions, in which the SDK did not apply such an operation until receiving the operation's echo.

Concretely, this means that in the following example, `fetchedValue` is now guaranteed to be `myValue`:

```javascript
await map.set('myKey', 'myValue');
const fetchedValue = map.get('myKey').value();
```

### Bug fixes

- Fix bug where calling `channel.off()` could prevent `attach()` and `detach()` calls from completing [\#2167](https://github.com/ably/ably-js/pull/2167)
- Make sure that `ErrorInfo.cause` is always an `ErrorInfo` [\#2169](https://github.com/ably/ably-js/pull/2169)

## [2.17.1](https://github.com/ably/ably-js/tree/2.17.1) (2026-01-30)

- Fix non-monotonic `msgSerial` on stale connection reset [\#2153](https://github.com/ably/ably-js/pull/2153)
- Fix missing capabilities in `CapabilityOp` type [\#2160](https://github.com/ably/ably-js/pull/2160)

## [2.17.0](https://github.com/ably/ably-js/tree/2.17.0) (2026-01-06)

- Support update and delete operations over realtime connections [\#2127](https://github.com/ably/ably-js/pull/2127)
- Implement message append for realtime and REST [\#2127](https://github.com/ably/ably-js/pull/2127)
- Publish, update, delete, and append methods now return result objects containing message serial/version information [\#2127](https://github.com/ably/ably-js/pull/2127)
- Fix msgpack encoding for multi-byte UTF-8 characters when using the binary protocol browsers [\#2145](https://github.com/ably/ably-js/pull/2145)
- Fix failing of non-sent queued messages when connection enters suspended/failed/closed state [\#2123](https://github.com/ably/ably-js/pull/2123)
- `channel.detach()` now immediately transitions to `detached` when the connection is not connected, instead of waiting or erroring [\#2149](https://github.com/ably/ably-js/pull/2149)

## [2.16.0](https://github.com/ably/ably-js/tree/2.16.0) (2025-12-19)

**Introducing LiveObjects Path-based API**

This release introduces a redesigned LiveObjects API centered around path-based operations. The new `PathObject` abstraction provides a more intuitive interaction model where operations resolve at runtime against the current value at a path, rather than being bound to specific object instances.

With this release, the ably-js LiveObjects API is no longer marked as `@experimental` and is in Public Preview.

Key improvements:

- **Resilient subscriptions**: Subscribe to paths rather than object instances, so subscriptions automatically follow whatever object exists at that location even when it's replaced.
- **Deep subscriptions**: Observe changes at any depth below a path with configurable depth control.
- **Operation context**: Subscription callbacks now receive the complete `ObjectMessage` that triggered the change, including information about the publishing client and operation details.
- **Simplified object creation**: Create deeply nested structures in a single operation using `LiveMap.create()` and `LiveCounter.create()` static methods, eliminating the risk of orphaned objects.
- **Compact representations**: New `.compact()` and `.compactJson()` methods for converting LiveObjects to plain JavaScript objects.

This release contains breaking changes to the LiveObjects API. See the [LiveObjects migration guide](./docs/migration-guides/v2/liveobjects.md) for detailed instructions on updating your code.

Breaking changes:

- The LiveObjects plugin import path changed from `'ably/objects'` to `'ably/liveobjects'`
- The plugin is now a named export: `import { LiveObjects } from 'ably/liveobjects'`
- The API entrypoint changed from `channel.objects` to `channel.object`
- `channel.objects.getRoot()` replaced by `channel.object.get()`, which returns a `PathObject`
- `channel.objects.createMap()` and `channel.objects.createCounter()` replaced by static `LiveMap.create()` and `LiveCounter.create()` methods
- Subscription callback signature changed to receive `{ object, message }` context
- LiveObject lifecycle event methods (`.on()`, `.off()`, `.offAll()`) removed; deleted events now surface via regular subscriptions
- `LiveObject.unsubscribeAll()` removed; use individual `Subscription.unsubscribe()` instead
- `RealtimeObject.offAll()` removed; use individual `StatusSubscription.off()` or `RealtimeObject.off(event, callback)` instead
- `channel.objects.batch()` moved to `PathObject.batch()` / `Instance.batch()`
- For TypeScript users: all LiveObjects types moved from `'ably'` to `'ably/liveobjects'`; global `AblyObjectsTypes` interface removed in favor of type parameters on `channel.object.get<T>()`; several types renamed, removed, or redesigned

## [2.15.0](https://github.com/ably/ably-js/tree/2.15.0) (2025-12-02)

- Implement `client.clientId` attribute as a shortcut for `client.auth.clientId` [#2100](https://github.com/ably/ably-js/pull/2100)
- Add support for updating and deleting messages (REST-only for now) [#2088](https://github.com/ably/ably-js/pull/2088)

## [2.14.0](https://github.com/ably/ably-js/tree/2.14.0) (2025-09-29)

- Add `clipped` field to annotation summary types [#2078](https://github.com/ably/ably-js/pull/2078)

## [2.13.0](https://github.com/ably/ably-js/tree/2.13.0) (2025-09-18)

- Surface the `connectionId` of the client that submitted a `LiveObject` operation in subscribe callbacks [#2084](https://github.com/ably/ably-js/pull/2084)
- Introduce version 4 of the Ably protocol [#2076](https://github.com/ably/ably-js/pull/2076)
- Changes to the structure of the experimental annotations and message fields [#2076](https://github.com/ably/ably-js/pull/2076)
  - A new field `Message.annotations` to store annotation information for the message.
  - `Message.version` is now an object, containing information about the latest message version.
  - `Message.createdAt` has been removed, its purpose is now served by `Message.timestamp`.
  - Per the above, `Message.timestamp` now refers to when a message was first created on the server. For the latest updated at time, see `Message.version.timestamp`.
  - `Message.operation` has been removed. Its fields are now in `Message.version.*`
  - `Message.summary` has been moved to `Message.annotations.summary`

## [2.12.0](https://github.com/ably/ably-js/tree/2.12.0) (2025-08-22)

- Add `clientId` of the client who submitted the operation to the `LiveObjectUpdate` in subscription callbacks [\#2072](https://github.com/ably/ably-js/pull/2072)

## [2.11.1](https://github.com/ably/ably-js/tree/2.11.1) (2025-08-21)

- Fix race for browsers that throttle timeouts in background tabs [\#2070](https://github.com/ably/ably-js/pull/2070)
- Change `ObjectOperation.initialValue` to be a JSON encoded string [\#2065](https://github.com/ably/ably-js/pull/2065)

## [2.11.0](https://github.com/ably/ably-js/tree/2.11.0) (2025-08-13)

- Add support to get and set JSON-encodable objects as values for entries in a `LiveMap` [\#2052](https://github.com/ably/ably-js/pull/2052)

## [2.10.1](https://github.com/ably/ably-js/tree/2.10.1) (2025-07-16)

- Fix minimization issue with Next.js 15.4+ canary builds [\#2057](https://github.com/ably/ably-js/pull/2057)

## [2.10.0](https://github.com/ably/ably-js/tree/2.10.0) (2025-06-25)

- Add `Channels.all` to type declarations [\#2040](https://github.com/ably/ably-js/pull/2040)
- Add `ClientOptions.endpoint` parameter and deprecate the `environment`, `restHost` and `realtimeHost` client options. See [platform customization](https://ably.com/docs/platform-customization#request-a-custom-environment) documentation for guidance on using the new `endpoint` parameter [\#1973](https://github.com/ably/ably-js/pull/1973)

## [2.9.0](https://github.com/ably/ably-js/tree/2.9.0) (2025-05-08)

**Introducing Ably LiveObjects**

With this release, ably-js now supports LiveObjects.

Ably LiveObjects enables effortless realtime synchronization of application state across multiple users and devices at any scale. When a LiveObject is updated, changes are automatically propagated to all subscribed clients in realtime, ensuring that everyone always sees the latest state.

The ably-js implementation for LiveObjects provides a simple, purpose-built API that handles realtime synchronization, persistence, and convergence behind the scenes.

See our [official documentation](https://ably.com/docs/liveobjects) to learn more about LiveObjects and how to start synchronizing your application state using Ably.

- Add support for Ably LiveObjects [\#2007](https://github.com/ably/ably-js/pull/2007)

## [2.8.0](https://github.com/ably/ably-js/tree/2.8.0) (2025-05-01)

- Add `RestClient.device()` and `RealtimeClient.device()` methods which return the `LocalDevice` object for push notifications [\#2020](https://github.com/ably/ably-js/pull/2020)
- Add `LocalDevice.channelSubscriptions()` method which uses device auth to get channel subscriptions only for the local device [\#2013](https://github.com/ably/ably-js/pull/2013)

## [2.7.0](https://github.com/ably/ably-js/tree/2.7.0) (2025-04-17)

- Adds `ANNOTATION_PUBLISH` and `ANNOTATION_SUBSCRIBE` channel modes [\#1953](https://github.com/ably/ably-js/pull/1953)
- Adds support for message annotations via `channel.annotations` [\#1953](https://github.com/ably/ably-js/pull/1953)
- The message action `meta.occupancy` is now renamed to `meta`. Similarly, `MessageActions.META_OCCUPANCY` is now `MessageActions.META` [\#1953](https://github.com/ably/ably-js/pull/1953)
- Fixes a bug where `deactivate` would not use device auth, meaning clients would only be able to use it with the `push-admin` capability [\#2000](https://github.com/ably/ably-js/pull/2000)
- The push `deactivate` method's callback type is now optional when using TypeScript [\#2000](https://github.com/ably/ably-js/pull/2000)

## [2.6.5](https://github.com/ably/ably-js/tree/2.6.5) (2025-03-24)

- Fixed type issue in `PublishOptions` [\#1988](https://github.com/ably/ably-js/pull/1988)

## [2.6.4](https://github.com/ably/ably-js/tree/2.6.4) (2025-03-17)

- Adds new capabilities to control the upcoming message operations. [\#1949](https://github.com/ably/ably-js/pull/1949)
- These include:
  - `message-update-any` - the ability to edit a message created by any client on a given channel.
  - `message-update-own` - the ability to edit only the messages created by the requesting client on a given channel.
  - `message-delete-any` - the ability to delete a message created by any client on a given channel.
  - `message-delete-own` - the ability to delete only the messages created by the requesting client on a given channel.

This contains only the most important and/or user-facing changes; for a full changelog, see the commit history.

## [2.6.3](https://github.com/ably/ably-js/tree/2.6.3) (2025-01-28)

- Fixed `useChannel` hook can throw exception in the effect if connection is closed [\#1938](https://github.com/ably/ably-js/issues/1938)
- Fixed web `FetchRequest` does not respect `disableConnectivityCheck` client option [\#1925](https://github.com/ably/ably-js/pull/1925)
- Fixed typings for `RealtimeChannel.modes` [\#1955](https://github.com/ably/ably-js/pull/1955)

## [2.6.2](https://github.com/ably/ably-js/tree/2.6.2) (2025-01-14)

- Minor bugfix for experimental message fields.

## [2.6.1](https://github.com/ably/ably-js/tree/2.6.1) (2025-01-13)

- Removed an incorrect channel mode `ATTACH_RESUME` from the `ChannelModes` enum.
- Removed the `UNSET` type from `MESSAGE_ACTIONS` enum, all messages will always have their `action` set.
- Removed `ANNOTATION_CREATE` and `ANNOTATION_DELETE` from the `MESSAGE_ACTIONS` enum.
- Adds support for upcoming message summaries with the new `MESSAGE_SUMMARY` message action type.
- Multiple improvements to type definitions and message handling.

## [2.6.0](https://github.com/ably/ably-js/tree/2.6.0) (2024-12-10)

- Removed a build check that prevented referencing branch builds in `package.json`. It is now possible to point npm at specific branches of ably-js.
- Presence will now only emit a `LEAVE` event if a member was present in the presence set to begin with.
- The experimental attributes on the `Message` type to support edits and deletes have been updated and renamed.

## [2.5.0](https://github.com/ably/ably-js/tree/2.5.0) (2024-11-06)

With this release, ably-js will now expose the new `Message` attributes needed to support upcoming features,
such as updates, deletions and annotations in the Ably service.

- Added support for new `Message` attributes. [\#1888](https://github.com/ably/ably-js/pull/1888)

## [2.4.1](https://github.com/ably/ably-js/tree/2.4.1) (2024-10-04)

- Fix `usePresence` hook wasn't leaving presence if component unmounted during channel attaching state [\#1884](https://github.com/ably/ably-js/pull/1884)

## [2.4.0](https://github.com/ably/ably-js/tree/2.4.0) (2024-09-11)

- Add `wsConnectivityCheckUrl` client option [\#1862](https://github.com/ably/ably-js/pull/1862)
- Push plugin is now available to be loaded via a CDN link [\#1861](https://github.com/ably/ably-js/pull/1861)

## [2.3.2](https://github.com/ably/ably-js/tree/2.3.2) (2024-09-06)

- Fix websocket reconnection can get stuck in a disconnected/connecting loop under specific network conditions [\#1855](https://github.com/ably/ably-js/pull/1855)
- Fix `fetchRequest` implementation didn't work with `checkConnectivity` [\#1856](https://github.com/ably/ably-js/pull/1856)

## [2.3.1](https://github.com/ably/ably-js/tree/2.3.1) (2024-07-29)

- Export EventEmitter so we can use it in other SDKs [\#1819](https://github.com/ably/ably-js/pull/1819)
- Fix missing `ablyId` argument to `useConnectionStateListener` [\#1821](https://github.com/ably/ably-js/pull/1821)

## [2.3.0](https://github.com/ably/ably-js/tree/2.3.0) (2024-07-10)

With this release, ably-js clients can now be activated as a target for push notifications. See our [official docs](https://ably.com/docs/push/configure/web) for instructions on how to start publishing web push notifications using Ably.

- Add support for web push activation [\#1775](https://github.com/ably/ably-js/pull/1775)

## [2.2.1](https://github.com/ably/ably-js/tree/2.2.1) (2024-07-02)

- Fix an occasion whereby a channel would attempt to automatically reattach from an inappropriate state [\#1802](https://github.com/ably/ably-js/pull/1802)
- Update the type information so that `ErrorInfo` now extends the `Error` interface [\#1805](https://github.com/ably/ably-js/pull/1805)

## [2.2.0](https://github.com/ably/ably-js/tree/2.2.0) (2024-06-24)

- Add passing a log level as a second parameter to `ClientOptions.logHandler` function [\#1787](https://github.com/ably/ably-js/pull/1787)
- Fix pings stacking when calling `Connection.ping()` if none ever succeed [\#1793](https://github.com/ably/ably-js/pull/1793)

## [2.1.0](https://github.com/ably/ably-js/tree/2.1.0) (2024-06-03)

With this release, Ably React Hooks have now moved to the general availability phase and are considered stable. Non-major version changes to the `ably` package won't include breaking changes for React Hooks going forward.

All changes:

- Add support for optional multiple recovery scopes via `ClientOptions.recoveryKeyStorageName` [\#1762](https://github.com/ably/ably-js/pull/1762)
- Add wildcard `*` and `privileged-headers` values for `TokenParams.capability` field [\#1765](https://github.com/ably/ably-js/pull/1765)
- Add support for unique `logHandler` per Ably client by removing the global effects of setting `logHandler` and `logLevel` [\#1764](https://github.com/ably/ably-js/pull/1764)
- Change `updateStatus` function returned by `usePresence` hook to be async [\#1777](https://github.com/ably/ably-js/pull/1777)
- Fix some of the errors thrown by `ConnectionManager` have misleading stack traces [\#1760](https://github.com/ably/ably-js/pull/1760)
- Fix `FetchRequest` doesn't properly handle a 204 response [\#1773](https://github.com/ably/ably-js/pull/1773)
- Fix `Connection closed` errors when using `usePresence` hook [\#1761](https://github.com/ably/ably-js/pull/1761)
- Fix `Unable to enter presence channel while in suspended state` errors with `usePresence` [\#1781](https://github.com/ably/ably-js/pull/1781)
- Fix `Can't resolve 'ably'` error for environments that don't support `exports` field in `package.json` yet [\#1782](https://github.com/ably/ably-js/pull/1782)

## [2.0.4](https://github.com/ably/ably-js/tree/2.0.4) (2024-05-03)

- Fix invalid `accessToken` when using REST API Client in React Native [\#1730](https://github.com/ably/ably-js/issues/1730), [\#1749](https://github.com/ably/ably-js/issues/1749)
- Fix docstring for `Channels.release` method [\#1752](https://github.com/ably/ably-js/pull/1752)

## [2.0.3](https://github.com/ably/ably-js/tree/2.0.3) (2024-04-18)

- Improve error message displayed when trying to use `Ably.Realtime` instance in the Vercel Edge runtime [\#1736](https://github.com/ably/ably-js/pull/1736)
- Fix to allow `ErrorInfo` export to be accessed as a named export in ESM and when using commonjs interop [\#1741](https://github.com/ably/ably-js/pull/1741)
- Fix `ReferenceError: self is not defined` error when running Jest tests in React Native using ably-js [\#1738](https://github.com/ably/ably-js/pull/1738)
- Fix `httpMaxRetryDuration` client option didn't actually limit max elapsed time for rest fallback host retries [\#1721](https://github.com/ably/ably-js/pull/1721)
- Fix default value for `httpRequestTimeout` client option was wrongly 15 seconds instead of expected 10 seconds [\#1721](https://github.com/ably/ably-js/pull/1721)

## [2.0.2](https://github.com/ably/ably-js/tree/2.0.2) (2024-04-08)

- Fix an issue with realtime connections using the bun runtime [\#1716](https://github.com/ably/ably-js/pull/1716)

## [2.0.1](https://github.com/ably/ably-js/tree/2.0.1) (2024-03-25)

- Fix `Unable to resolve "ably"` in React Native for ably-js v2.0.0 [\#1711](https://github.com/ably/ably-js/issues/1711)
- Fix `TextEncoder`/`TextDecoder` are not defined in React Native for ably-js v2.0.0 [\#1712](https://github.com/ably/ably-js/issues/1712)

## [2.0.0](https://github.com/ably/ably-js/tree/2.0.0) (2024-03-22)

The 2.0.0 release introduces a number of new features and QoL improvements, including a new way to remove bloat and reduce the bundle size of your ably-js client, first-class support for Promises, a more idiomatic approach to using ably-js' React Hooks, enhancements to TypeScript typings, and more.

Below is an overview of the major changes in this release.

Please refer to the ably-js v2 [lib migration guide](./docs/migration-guides/v2/lib.md) and [React Hooks migration guide](./docs/migration-guides/v2/react-hooks.md) for the full details, including a list of all breaking changes and instructions on how to address them.

### Bundle Size Reduction

The default bundle size for the web has been reduced by ~32% compared to v1 - from 234.11 KiB to 159.32 KiB. When calculated with gzip compression, the reduction is ~30%, from 82.54 KiB to 57.9 KiB.

Additionally, by utilizing the new modular variant of the library (see below) and JavaScript tree shaking, you can create your own minimal useful `Realtime` client and achieve a bundle size reduction of ~60.5% compared to v1 - from 234.11 KiB to 92.38 KiB (or ~66% for gzip: from 82.54 KiB to 28.18 KiB).

### Modular variant of the library

An ESM variant of the library is now available for browsers (but not for Node.js) via import from `ably/modular`. This modular variant of the library supports tree shaking, allowing for a reduction in the Ably bundle size within your application and improving the user experience. It can also be used by Web Workers.

### React Hooks changes

React Hooks, exported at `ably/react`, now require the new `ChannelProvider` component to define the channels you wish to use and the options for them. This addresses the complexities previously encountered with `useChannel` and `usePresence` hooks when attempting to dynamically change options for a channel and provides a more straightforward approach to set and manage these options.

The functionality of the `usePresence` hook has been split into two separate hooks: `usePresence`, which is now used only to enter presence, and `usePresenceListener`, which is used to listen for presence updates. These new hooks offer better control over the desired presence behavior in your React components.

### First-class support for Promises

The callbacks API has been entirely removed, and the library now supports promises for all its asynchronous operations by default.

### TypeScript typings

The Types namespace has been removed. All types it contained are now exported at the top level.

### Browser and Web Worker bundles

- The browser bundle now relies on the native Web Crypto API instead of CryptoJS. The `ably/build/ably.noencryption` bundle has been removed, as it is no longer necessary.
- The browser bundle can now be directly used by Web Workers. The `ably/build/ably-webworker` bundle has been removed, as it is no longer necessary.

### Supported platforms changes

- Support for Internet Explorer has been dropped.
- Support for Node.js versions lower than 16 has been dropped. The supported Node.js versions are now 16, 18, and 20.
- The minimum supported versions for major browsers are: Chrome 58, Firefox 52, Edge 79, Safari 11, and Opera 45.

<details>
<summary><b>View merged Pull Requests</b></summary>

### Breaking Changes

- Add `ChannelProvider` component to React Hooks [\#1620](https://github.com/ably/ably-js/pull/1620), [\#1654](https://github.com/ably/ably-js/pull/1654)
- Add untyped stats API [\#1522](https://github.com/ably/ably-js/pull/1522)
- Add type definitions for key returned by `generateRandomKey` [\#1320](https://github.com/ably/ably-js/pull/1320)
- Add mandatory `version` param to `Rest.request` [\#1231](https://github.com/ably/ably-js/pull/1231)
- Change `id` field to be named `ablyId` in React Hooks [\#1676](https://github.com/ably/ably-js/pull/1676)
- Change `usePresence` hook to two different hooks: for entering presence and subscribing to presence updates [\#1674](https://github.com/ably/ably-js/pull/1674)
- Change naming for enum-like namespaces in type declarations and change meaning for public `ChannelModes` type [\#1601](https://github.com/ably/ably-js/pull/1601)
- Change publishing methods to accept a `Message`-shaped object [\#1515](https://github.com/ably/ably-js/pull/1515)
- Change `Crypto.generateRandomKey` API to use Promises [\#1351](https://github.com/ably/ably-js/pull/1351)
- Change `fromEncoded()` and `fromEncodedArray()` methods on `Message` and `PresenceMessage` to be async [\#1311](https://github.com/ably/ably-js/pull/1311)
- Remove `XHRStreaming` transport support [\#1645](https://github.com/ably/ably-js/pull/1645)
- Remove code that's supporting older platforms [\#1629](https://github.com/ably/ably-js/pull/1629), [\#1633](https://github.com/ably/ably-js/pull/1633), [\#1641](https://github.com/ably/ably-js/pull/1641)
- Remove `recoveryKey` in favour of `createRecoveryKey()` on `Connection` [\#1613](https://github.com/ably/ably-js/pull/1613)
- Remove `any` from `stats()` param type [\#1561](https://github.com/ably/ably-js/pull/1561)
- Remove the dedicated Web Worker bundle `ably/build/ably-webworker` and add support for using `ably` and `ably/modular` in Web Workers [\#1550](https://github.com/ably/ably-js/pull/1550)
- Remove false class exports in type declarations [\#1524](https://github.com/ably/ably-js/pull/1524)
- Remove the `Types` namespace [\#1518](https://github.com/ably/ably-js/pull/1518)
- Remove `noencryption` variant of the library [\#1500](https://github.com/ably/ably-js/pull/1500)
- Remove public callbacks API [\#1358](https://github.com/ably/ably-js/pull/1358)
- Remove CryptoJS library and replace it with the Web Crypto API in web bundle [\#1299](https://github.com/ably/ably-js/pull/1299), [\#1325](https://github.com/ably/ably-js/pull/1325), [\#1333](https://github.com/ably/ably-js/pull/1333)
- Remove `ably-commonjs*.js` files [\#1229](https://github.com/ably/ably-js/pull/1229)
- Remove deprecated APIs [\#1227](https://github.com/ably/ably-js/pull/1227)
- Remove deprecated `fromEncoded*` type declarations [\#1222](https://github.com/ably/ably-js/pull/1222)
- Remove deprecated `ClientOptions` parameters [\#1221](https://github.com/ably/ably-js/pull/1221)
- Remove the `ClientOptions.log` property and replace it with separate `logLevel` and `logHandler` properties [\#1216](https://github.com/ably/ably-js/pull/1216)
- Remove support for JSONP [\#1215](https://github.com/ably/ably-js/pull/1215)
- Fix `whenState` inconsistent behavior in `Connection` and `RealtimeChannel` [\#1640](https://github.com/ably/ably-js/pull/1640)
- Fix the type definition of `Crypto.getDefaultParams` [\#1352](https://github.com/ably/ably-js/pull/1352)

### Features

- Add `publish` function to the `useChannel` hook [\#1658](https://github.com/ably/ably-js/pull/1658)
- Add logs to all HTTP activity [\#1581](https://github.com/ably/ably-js/pull/1581)

</details>

[Full Changelog](https://github.com/ably/ably-js/compare/1.2.50...2.0.0)

## [1.2.50](https://github.com/ably/ably-js/tree/1.2.50) (2024-03-21)

- Add new logging API to `ClientOptions` and add a deprecation warning for the old one [\#1671](https://github.com/ably/ably-js/pull/1671)
- Add `ClientOptions.maxMessageSize` to the public API [\#1678](https://github.com/ably/ably-js/pull/1678)
- Add a deprecation warning for the `headers` client option [\#1681](https://github.com/ably/ably-js/pull/1681)
- Improve deprecation log messages [\#1683](https://github.com/ably/ably-js/pull/1683), [\#1685](https://github.com/ably/ably-js/pull/1685)
- Handle 204 status code in `PaginatedResource` [\#1631](https://github.com/ably/ably-js/pull/1631)
- Fix typing and deprecation warning for `Crypto.getDefaultParams()` [\#1693](https://github.com/ably/ably-js/pull/1693)

## [1.2.49](https://github.com/ably/ably-js/tree/1.2.49) (2024-02-07)

- \[React-Hooks\] `usePresence` unsubscribes all listeners on unmount and run `Presence.leave` even if connection has been terminated [\#1610](https://github.com/ably/ably-js/issues/1610)
- `RealtimeChannels.get()` with options parameter throws an exception when executed during the `attaching` state. [\#1609](https://github.com/ably/ably-js/issues/1609)

## [1.2.48](https://github.com/ably/ably-js/tree/1.2.48) (2023-11-20)

- Enable 'derived' options in 'useChannel' hook (by @rustworthy) [\#1501](https://github.com/ably/ably-js/pull/1501)
- fix: use 'ably' as import path from react-hooks [\#1509](https://github.com/ably/ably-js/pull/1509)

## [1.2.47](https://github.com/ably/ably-js/tree/1.2.47) (2023-11-02)

- fix(react): fix issue where useChannel would error upon router navigation or hmr [\#1478](https://github.com/ably/ably-js/pull/1478)

## [1.2.46](https://github.com/ably/ably-js/tree/1.2.46) (2023-10-24)

- fix: avoid directly exporting Ably.ErrorInfo from promises.js [\#1463](https://github.com/ably/ably-js/pull/1463)
- fix(react): add missing id param for `useStateErrors` call to `useChannelStateListener` [\#1455](https://github.com/ably/ably-js/pull/1455)
- fix: allow `RealtimePresence#leave` to take `PresenceMessage` as argument [\#1466](https://github.com/ably/ably-js/pull/1466)
- deps: bump ws to 8.14.2 [\#1467](https://github.com/ably/ably-js/pull/1467)

## [1.2.45](https://github.com/ably/ably-js/tree/1.2.45) (2023-09-25)

- remove `AblyProvider` options prop [\#1446](https://github.com/ably/ably-js/pull/1446)
- fix: throw descriptive error when callbacks used with react [\#1450](https://github.com/ably/ably-js/pull/1450)

## [1.2.44](https://github.com/ably/ably-js/tree/1.2.44) (2023-09-04)

- Add new experimental react hooks and context provider [\#1433](https://github.com/ably/ably-js/pull/1433)
- Export the `ErrorInfo` class [\#1430](https://github.com/ably/ably-js/pull/1430)

## [1.2.43](https://github.com/ably/ably-js/tree/1.2.43) (2023-08-10)

- Add REST APIs for batch publishing, batch presence, and token revocation [\#1410](https://github.com/ably/ably-js/pull/1410)
- Add support for presence message extras [\#1418](https://github.com/ably/ably-js/pull/1418)

## [1.2.42](https://github.com/ably/ably-js/tree/1.2.42) (2023-07-24)

- Auth: remain connected upon failed authorize unless returning explicit 403 [\#1385](https://github.com/ably/ably-js/pull/1385)
- Make `Utils#inspectError` use `toString` for `Error`-like values [\#1391](https://github.com/ably/ably-js/pull/1391)
- docs: fix description of AuthOptions.token [\#1368](https://github.com/ably/ably-js/pull/1368)

## [1.2.41](https://github.com/ably/ably-js/tree/1.2.41) (2023-06-29)

- add `ChannelStateChange.hasBacklog` and return state change to attach promise/callback [\#1347](https://github.com/ably/ably-js/pull/1347)
- fix a bug where host fallback was initially skipped after falling back to the base transport [\#1357](https://github.com/ably/ably-js/pull/1357)

## [1.2.40](https://github.com/ably/ably-js/tree/1.2.40) (2023-05-26)

This release adds a new experimental `channels.getDerived` method which allows you to create custom realtime data feeds by selectively subscribing to receive only part of the data from the channel. See the [announcement post](https://pages.ably.com/subscription-filters-preview) for more information.

- add experimental API to get derived channel [\#1306](https://github.com/ably/ably-js/pull/1306)
- make `Message.connectionId` optional [\#1305](https://github.com/ably/ably-js/pull/1305)
- fix misleading stack traces for early-intialised connection errors [\#1206](https://github.com/ably/ably-js/pull/1206)
- remove `ProtocolMessage.connectionKey` [\#1218](https://github.com/ably/ably-js/pull/1218)
- fix broken promisification of `Presence.history` signature [\#1224](https://github.com/ably/ably-js/pull/1224)
- fix issue with query string encoding in react-native websockets [\#1286](https://github.com/ably/ably-js/pull/1286)
- fix nodejs encryption of `ArrayBuffer` plaintext [\#1280](https://github.com/ably/ably-js/pull/1280)

## [1.2.39](https://github.com/ably/ably-js/tree/1.2.39) (2023-04-13)

- bump got dependency to `^11.8.5` [\#1189](https://github.com/ably/ably-js/pull/1189)

## [1.2.38](https://github.com/ably/ably-js/tree/1.2.38) (2023-04-04)

- retry connection attempt if 'online' event received whilst connecting [\#1171](https://github.com/ably/ably-js/pull/1171)
- populate invalid state `ErrorInfo.cause` with the current `errorReason`, if set [\#1169](https://github.com/ably/ably-js/pull/1169)
- fix: align exposed type of `ErrorInfo` with internal type, extending `Error` [\#1142](https://github.com/ably/ably-js/pull/1142)
- fix: avoid global scope `TextEncoder` access [\#1157](https://github.com/ably/ably-js/pull/1157)

## [1.2.37](https://github.com/ably/ably-js/tree/1.2.37) (2023-02-27)

- make ErrorInfo extend Error [\#1129](https://github.com/ably/ably-js/pull/1129)
- improve error message for clientId mismatch from user auth provider [\#1128](https://github.com/ably/ably-js/pull/1128)
- fix: don't send credentials in webworker FetchInit [\#1132](https://github.com/ably/ably-js/pull/1132)

## [1.2.36](https://github.com/ably/ably-js/tree/1.2.36) (2023-02-10)

- fix(Node/http): prevent got from using its own retry mechanism [\#1122](https://github.com/ably/ably-js/pull/1122)
- deps: update `http-cache-semantics` dependency [\#1123](https://github.com/ably/ably-js/pull/1123)

## [1.2.35](https://github.com/ably/ably-js/tree/1.2.35) (2023-01-30)

- Implement ably-js protocol v2 [\#1110](https://github.com/ably/ably-js/pull/1110)
- Add global HTTP agent pool (fixes memory leak when creating several rest clients) [\#1113](https://github.com/ably/ably-js/pull/1113)

## [1.2.34](https://github.com/ably/ably-js/tree/1.2.34) (2022-12-13)

- fix incorrect sync event signature in base Transport class (fixes an issue with react-native realtime connections) [\#1094](https://github.com/ably/ably-js/pull/1094)

## [1.2.33](https://github.com/ably/ably-js/tree/1.2.33) (2022-11-11)

- Fix some callback typings [\#1075](https://github.com/ably/ably-js/pull/1075)

## [1.2.32](https://github.com/ably/ably-js/tree/1.2.32) (2022-11-09)

- fix: add EventEmitter.off signature with no args [\#1073](https://github.com/ably/ably-js/pull/1073)

## [1.2.31](https://github.com/ably/ably-js/tree/1.2.31) (2022-11-08)

In the latest release of ably-js, we’ve added jsdoc comments for the public methods and properties provided by the SDK so you can quickly access the descriptions directly in your code editor using Intelligent code completion features like Intellisense in VSCode.

We have also implemented the fetch API as a fallback HTTP transport so that ably-js is now fully functional in a service worker context.

**How do I give feedback?**
This docs update and further planned changes are based on feedback from customers like you. So if you’d like to share any other requests or feedback, please [reach out to us](https://ably.com/contact) and help us make Ably better for everyone.

- Add JSDoc annotations to `ably.d.ts` [\#897](https://github.com/ably/ably-js/pull/897)
- Implement fetch as fallback if XHR and JSONP unsupported [\#1019](https://github.com/ably/ably-js/pull/1019)
- [EDX-158] Generate docs with TypeDoc and upload to sdk.ably.com [\#1017](https://github.com/ably/ably-js/pull/1017)
- [EDX-149] Add canonical docstring comments [\#1026](https://github.com/ably/ably-js/pull/1026)
- [EDX-207] Add intro blurb to generated documentation [\#1055](https://github.com/ably/ably-js/pull/1055)
- Add missing/undocumented docstrings [\#1064](https://github.com/ably/ably-js/pull/1064)
- fix: stop mutating `Defaults.agent` on client init [\#1068](https://github.com/ably/ably-js/pull/1068)

## [1.2.30](https://github.com/ably/ably-js/tree/1.2.30) (2022-10-05)

- Add `connectivityCheckUrl` and `disableConnectivityCheck` client options [\#1051](https://github.com/ably/ably-js/pull/1051)
- Fix EventEmitter.once when using array with promises [\#1046](https://github.com/ably/ably-js/pull/1046)
- Allow null arguments in authCallback [\#1052](https://github.com/ably/ably-js/pull/1052)
- Move channel state to attaching on new transport reattach when using promises [\#1053](https://github.com/ably/ably-js/pull/1053)

## [1.2.29](https://github.com/ably/ably-js/tree/1.2.29) (2022-08-08)

- Fix upgrade bug that could lead to an indefinitely sync-pending transport [\#1041](https://github.com/ably/ably-js/pull/1041)
- Always allow event queueing while connecting [\#1039](https://github.com/ably/ably-js/pull/1039)

## [1.2.28](https://github.com/ably/ably-js/tree/1.2.28) (2022-07-28)

- Add clientId to MessageFilter [\#1032](https://github.com/ably/ably-js/pull/1032)
- Transports: implement timeouts in tryConnect() [\#1035](https://github.com/ably/ably-js/pull/1035)
- Only log connectionSerial mismatch from channel messages [\#1036](https://github.com/ably/ably-js/pull/1036)

## [1.2.27](https://github.com/ably/ably-js/tree/1.2.27) (2022-07-06)

- Add filtered subscription type to RealtimeChannel [\#1003](https://github.com/ably/ably-js/pull/1003)

## [1.2.26](https://github.com/ably/ably-js/tree/1.2.26) (2022-06-30)

- Improve global object fallback logic (fixes an issue when using the library in some service worker contexts) [\#1016](https://github.com/ably/ably-js/pull/1016)
- Add backoff and jitter to channel and connection retry strategies [\#1008](https://github.com/ably/ably-js/pull/1008)
- Bump versions for some underlying dependencies [\#1010](https://github.com/ably/ably-js/pull/1010)
- Fix a bug with xhr transports for react-native [\#1007](https://github.com/ably/ably-js/pull/1007)

## [1.2.25](https://github.com/ably/ably-js/tree/1.2.25) (2022-06-10)

- Fix a bug in 1.2.23 where Message and PresenceMessage were removed from the public API [\#1004](https://github.com/ably/ably-js/pull/1004)

## [1.2.24](https://github.com/ably/ably-js/tree/1.2.24) (2022-06-09)

- Revert a bug in 1.2.23 where the Crypto interface was removed from the public API
- Revert change to package.json typings field
- Remove sourcemap links from CDN uploads

## [1.2.23](https://github.com/ably/ably-js/tree/1.2.23) (2022-06-09)

- Add `Channel.status` method to get channel lifecycle status [\#985](https://github.com/ably/ably-js/pull/985)
- Fix bug in compatibility with Salesforce Lightning Components [\#993](https://github.com/ably/ably-js/pull/993)
- Revert uploading sourcemaps to the CDN [\#998](https://github.com/ably/ably-js/pull/998)

## [1.2.22](https://github.com/ably/ably-js/tree/1.2.22) (2022-05-18)

- Fix bug in RealtimeChannel.subscribe promisify when second argument is
  undefined [\#984](https://github.com/ably/ably-js/issue/984)
- Update deprecated NativeScript application settings import [\#980](https://github.com/ably/ably-js/issue/980)

## [1.2.21](https://github.com/ably/ably-js/tree/1.2.21) (2022-05-05)

- Make `Connection.id` and `Connection.key` optional [\#952](https://github.com/ably/ably-js/issue/952)
- Remove support for MozWebSocket [\#954](https://github.com/ably/ably-js/issue/954)
- Fix a bug with promisified `EventEmitter.whenState` [\#962](https://github.com/ably/ably-js/pull/962)
- Update ably.com/documentation urls [\#964](https://github.com/ably/ably-js/pull/964)
- Remove console.log statements from msgpack encoder [\#966](https://github.com/ably/ably-js/pull/966)
- Fix nativescript bundle [\#971](https://github.com/ably/ably-js/pull/971)

## [1.2.20](https://github.com/ably/ably-js/tree/1.2.20) (2022-04-06)

- Fix error where calling realtime presence update caused call stack errors [\#949](https://github.com/ably/ably-js/issue/949)
- Fix an issue where Ably-Agent headers were encoded incorrectly [\#950](https://github.com/ably/ably-js/pull/950)

## [1.2.19](https://github.com/ably/ably-js/tree/1.2.19) (2022-04-05)

- Fix error where some promisified REST methods caused call stack errors [\#943](https://github.com/ably/ably-js/issue/943)
- Fix wasClean implementation for reactnative websocket transport [\#946](https://github.com/ably/ably-js/pull/946)
- Ensure that Ably-Agent is always URI encoded [\#947](https://github.com/ably/ably-js/pull/947)

## [1.2.18](https://github.com/ably/ably-js/tree/1.2.18) (2022-03-31)

- Convert library source code to TypeScript [\#762](https://github.com/ably/ably-js/pull/762)
- Add `realtimeRequestTimeout` to ClientOptions type [\#934](https://github.com/ably/ably-js/pull/934)
- Override toJSON for HttpPaginatedResponse [\#913](https://github.com/ably/ably-js/pull/913)
- Throw ErrorInfo when invalid key supplied [\#912](https://github.com/ably/ably-js/pull/912)
- Remove ErrorReporter [\#908](https://github.com/ably/ably-js/pull/908)
- Fix nonsensical error in RealtimePresence.leaveClient when channel state is invalid [\#911](https://github.com/ably/ably-js/pull/911)

## [1.2.17](https://github.com/ably/ably-js/tree/1.2.17) (2022-01-14)

- Remove NPM preinstall script (this was breaking NPM installs when outside a git repository) [\#876](https://github.com/ably/ably-js/pull/876)

## [1.2.16](https://github.com/ably/ably-js/tree/1.2.16) (2022-01-14)

- Fix bug where channel rewind would ignore messages after reattaching [\#873](https://github.com/ably/ably-js/pull/873)

## [1.2.15](https://github.com/ably/ably-js/tree/1.2.15) (2021-11-22)

- Replace deprecated request HTTP module with got [\#846](https://github.com/ably/ably-js/pull/846)
- Improve checks for XHRRequest error responses [\#804](https://github.com/ably/ably-js/pull/804)

## [1.2.14](https://github.com/ably/ably-js/tree/1.2.14) (2021-09-22)

- Add TypeScript support for REST publish parameters [\#785](https://github.com/ably/ably-js/pull/785)
- Fix a bug with parsing of authUrl responses [\#793](https://github.com/ably/ably-js/pull/793)

## [1.2.13](https://github.com/ably/ably-js/tree/1.2.13) (2021-08-03)

- Implement RTL5b and RTL5j cases for detaching from channels in suspended/failed states [\#784](https://github.com/ably/ably-js/pull/784)

## [1.2.12](https://github.com/ably/ably-js/tree/1.2.12) (2021-08-02)

- Fix channel names as object prototype keys [\#777](https://github.com/ably/ably-js/pull/777)
- Add .once method to EventEmitter [\#779](https://github.com/ably/ably-js/pull/779)
- Bump ws from 5.2.2 to 5.2.3 [\#781](https://github.com/ably/ably-js/pull/781)
- Implement Ably-Agent connection param for ably-js and NodeJS versions [\#740](https://github.com/ably/ably-js/pull/740)

## [1.2.11](https://github.com/ably/ably-js/tree/1.2.11) (2021-07-20)

- Bind setImmediate to global object in browsers [\#774](https://github.com/ably/ably-js/pull/774)

## [1.2.10](https://github.com/ably/ably-js/tree/1.2.10) (2021-05-28)

- Add Playwright tests [\#738](https://github.com/ably/ably-js/pull/738)
- Improve Mocha tests [\#739](https://github.com/ably/ably-js/pull/739)
- Bump grunt from 0.4.5 to 1.3.0 [\#744](https://github.com/ably/ably-js/pull/744)
- Add initial typescript toolchain [\#745](https://github.com/ably/ably-js/pull/745)
- Update react native usage instructions in README [\#746](https://github.com/ably/ably-js/pull/746)
- Webworker support [\#756](https://github.com/ably/ably-js/pull/756)
- Use setImmediate if available in browser [\#757](https://github.com/ably/ably-js/pull/757)
- Add sourcemap stuff [\#758](https://github.com/ably/ably-js/pull/758)
- ably.io -> ably.com [\#759](https://github.com/ably/ably-js/pull/759)
- Improve api typings [\#761](https://github.com/ably/ably-js/pull/761)

## [1.2.9](https://github.com/ably/ably-js/tree/1.2.9) (2021-04-12)

- Fix bugs in disconnection error filtering [\#734](https://github.com/ably/ably-js/pull/734)
- Replace fury badges with shields.io [\#716](https://github.com/ably/ably-js/pull/716)

## [1.2.8](https://github.com/ably/ably-js/tree/1.2.8) (2021-03-26)

- Fix imports for callbacks.js, promises.js, typings. [\#730](https://github.com/ably/ably-js/pull/730)
- Fix request typings [\#731](https://github.com/ably/ably-js/pull/731)
- Deprecate bower [\#733](https://github.com/ably/ably-js/pull/733)

## [1.2.7](https://github.com/ably/ably-js/tree/1.2.7) (2021-03-25)

- Fix faulty import of JSONP transport to React Native and NativeScript [\#726](https://github.com/ably/ably-js/pull/726)
- Comet: Raise preconnect event if the server responds with a protocol message [\#719](https://github.com/ably/ably-js/pull/719)

## [1.2.6](https://github.com/ably/ably-js/tree/1.2.6) (2021-03-04)

- Move null-loader to dev dependencies (note: this release will only affect NPM users so will not be available on cdn.ably.io) [\#718](https://github.com/ably/ably-js/pull/718)

## [1.2.5](https://github.com/ably/ably-js/tree/1.2.5) (2020-11-04)

- Convert library to ES6 modules [\#704](https://github.com/ably/ably-js/pull/704/files)

## [1.2.4](https://github.com/ably/ably-js/tree/1.2.4) (2020-11-04)

- Typings: all ChannelOptions are now optional and other minor improvements [\#695](https://github.com/ably/ably-js/pull/695/files)

## [1.2.3](https://github.com/ably/ably-js/tree/1.2.3) (2020-09-30)

- Use environment-specific fallback hosts by default unless overridden (https://github.com/ably/ably-js/pull/682)
- Rest: use channels.all not channels.attached; "attached" made no sense for rest channels and was never documented
- Add state check for channels.release() to prevent putting the lib into an inconsistent state

## [1.2.2](https://github.com/ably/ably-js/tree/1.2.2) (2020-09-03)

- Auth: fail connection immediately if auth server returns a 403 as a result of an authorize() call or online reauth

## [1.2.1](https://github.com/ably/ably-js/tree/1.2.1) (2020-06-09)

**Oops!** :blush: Fixes an oversight in our 1.2.0 release.

We had
[specified](https://docs.ably.io/client-lib-development-guide/features/#TO3n)
that we would make `idempotentRestPublishing` default to `true` from version 1.2 (`ClientOptions`) but hadn't followed through with this.
That is fixed in this release with
[\#665](https://github.com/ably/ably-js/pull/665)
([SimonWoolf](https://github.com/SimonWoolf)).

## [1.2](https://github.com/ably/ably-js/tree/1.2.0) (2020-06-08)

Adds the capability to subscribe to a channel in delta mode.

Subscribing to a channel in delta mode enables [delta compression](https://www.ably.com/docs/realtime/channels/channel-parameters/deltas). This is a way for a client to subscribe to a channel so that message payloads sent contain only the difference (ie the delta) between the present message and the previous message on the channel.

[Full Changelog](https://github.com/ably/ably-js/compare/1.1.25...1.2.0)

---

## [1.1.25](https://github.com/ably/ably-js/tree/1.1.25) (2020-05-19)

- EventEmitter.whenState: fix for promises [\#630](https://github.com/ably/ably-js/pull/630)
- Typings: re-export Types namespace in 'ably/promises' sub-package [\#634](https://github.com/ably/ably-js/pull/634)
- Support promises with PaginatedResult#next() etc. [\#635](https://github.com/ably/ably-js/pull/635)
- Reduced npm package size [\#646](https://github.com/ably/ably-js/pull/646)
- Update msgpack dependency to version explicitly Apache-2.0 licensed [\#650](https://github.com/ably/ably-js/pull/650)

## [1.1.24](https://github.com/ably/ably-js/tree/1.1.24) (2020-01-24)

- Minor bug fix to comet transport
- Update ably-common submodule for errors.json parsing fix

## [1.1.23](https://github.com/ably/ably-js/tree/1.1.23) (2020-01-08)

- Disable bundling for messages with user-set ids

## [1.1.22](https://github.com/ably/ably-js/tree/1.1.22) (2019-10-28)

- Add some missing ClientOptions to typescript type definition file

## [1.1.21](https://github.com/ably/ably-js/tree/1.1.21) (2019-10-22)

- BufferUtils overhaul (consistent return type on browsers (ArrayBuffer vs WordArray), hexDecode, support typed arrays, and more
- Add error reporting mechanism

## [1.1.20](https://github.com/ably/ably-js/tree/1.1.20) (2019-10-05)

- Fix channel.history with promises bug when using the realtime client
- Auth no way to renew warning: upgrade to error

## [1.1.19](https://github.com/ably/ably-js/tree/1.1.19) (2019-10-03)

- Fix EventEmitter.once typings https://github.com/ably/ably-js/pull/610

## [1.1.18](https://github.com/ably/ably-js/tree/1.1.18) (2019-09-18)

- Fix typings for channel.presence.unsubscribe https://github.com/ably/ably-js/pull/608
- Tweak connection code for generic connection issues (80000 -> 80003)
- Make promisified rest.request() easier to use correctly

## [1.1.17](https://github.com/ably/ably-js/tree/1.1.17) (2019-09-03)

- Fix TS1036 tslint warning when importing ably/promises
- Add delta generation stats infrastructure

## [1.1.16](https://github.com/ably/ably-js/tree/1.1.16) (2019-07-24)

- Fix regression for browser commonjs distribution
- Allow non-ascii clientIds for REST requests

## [1.1.15](https://github.com/ably/ably-js/tree/1.1.15) (2019-07-02)

- Fix type definition for realtime presence.get() with the Promise API

## [1.1.14](https://github.com/ably/ably-js/tree/1.1.14) (2019-06-25)

- Add check for double-encoded tokens
- Reinstate message suppression based on connectionSerial to ensure no duplicate messages during transport upgrades
- Support running in a webworker context that uses `self` as the global object (thanks to Clifton Hensley for that contribution!)

## [1.1.13](https://github.com/ably/ably-js/tree/1.1.13) (2019-06-19)

- Log the content-type of an authUrl response

## [1.1.12](https://github.com/ably/ably-js/tree/1.1.12) (2019-06-10)

- Only ever deduplicate messages on the same channel
- Support uncompressed data stats

## [1.1.11](https://github.com/ably/ably-js/tree/1.1.11) (2019-05-22)

- Allow token strings (including JWT tokens) up to 128kB

## [1.1.10](https://github.com/ably/ably-js/tree/1.1.10) (2019-05-16)

- Fix channel#unsubscribe() throwing an error if called on a failed channel
  (also removes the optional callback argument to subscribe(), which was
  undocumented and almost useless anyway since it was only called in the
  event of a failed channel)

## [1.1.9](https://github.com/ably/ably-js/tree/1.1.9) (2019-05-08)

- Auth: fix tokenParams missing from token requests in the event that no authParams are specified

## [1.1.8](https://github.com/ably/ably-js/tree/1.1.8) (2019-04-30)

- Auth: if you do multiple concurrent authorize()s, make sure the token from last one wins
- If fallback hosts are enabled and a connection is abruptly disconnected with a 5xx error, retry immediately to a fallback rather than waiting the usual 15s disconnectedRetryTimeout

## [1.1.7](https://github.com/ably/ably-js/tree/1.1.7) (2019-03-27)

- Catch common failure mode with poorly-implemented authCallback
- Fix typings of TokenParams.capability

## [1.1.6](https://github.com/ably/ably-js/tree/1.1.6) (2019-03-19)

- Improve handling of responso to active traffic management placement constraint error for smooth cluster handover
- Normalise statuscode for 40170-failure to obtain token from client auth callback to 401 per spec

## [1.1.5](https://github.com/ably/ably-js/tree/1.1.5) (2019-02-27)

- Only autoremove an expired token if we know the local offset from server time
- Fix tokenParams not being correctly mixed in to authParams in some circumstances

## [1.1.4](https://github.com/ably/ably-js/tree/1.1.4) (2019-02-25)

- Support PUSH, PATCH, and DELETE in Rest#request()
- Support arbitrary params for REST publishes
- Fix scope leak issue when using the minified version of the library

## [1.1.3](https://github.com/ably/ably-js/tree/1.1.3) (2019-02-11)

- Rewrite typescript typings to satisfy `tsc --strict`
- PNRG changes needed for newer versions of react-native

## [1.1](https://github.com/ably/ably-js/tree/1.1.0) (2019-02-06)

- Promises support
- Admin api for push notifications
- Many minor bugfixes

---

## [1.0.23](https://github.com/ably/ably-js/tree/1.0.23) (2019-01-21)

- Only make a single token request at a time
- Fix crash with react-native on some Android versions when making REST requests
- Tweak fallback host logic for connected realtime clients making REST requests

## [1.0.21](https://github.com/ably/ably-js/tree/1.0.21) (2019-01-07)

- Reinstate 'stop clientId forcing token auth' change (https://github.com/ably/ably-js/issues/542)
- Prioritise a tokenParam over an authParam of the same name
- Fix behaviour with multiple concurrent pings in-flight
- Use console.warn (if present) when logging at ERROR level
- Implement client-side-enforced maxMessageSize limit and bundling constraints
- Deduce streaming response from lack of content-length header even if no transfer-encoding

## [1.0.20](https://github.com/ably/ably-js/tree/1.0.20) (2018-12-02)

- Temporarily back out of clientId change due to CORS issue

## [1.0.19](https://github.com/ably/ably-js/tree/1.0.19) (2018-11-22)

- Expose rest#setLog method to change log level or handler at runtime
- Allow jsonp for REST requests even if allowComet is false
- Expose Rest.Message for node, for consistency with Realtime.Message
- Add updateOnAttached channel option to force 'update' event even if `resumed` is true
- Stop a clientId from forcing token auth (https://github.com/ably/ably-js/issues/542)
- Fix package bloat through mistaken node_modules_node6 includes (due to npm not correctly parsing .gitignore)

## [1.0.18](https://github.com/ably/ably-js/tree/1.0.18) (2018-09-27)

- Fix bug where connectionSerial was not getting reset after a resume failure (https://github.com/ably/ably-js/pull/540)

## [1.0.17](https://github.com/ably/ably-js/tree/1.0.17) (2018-09-19)

- Give presence.subscribe attach callback the same behaviour as channel.subscribe, for consistency (so it calls back once attached rather than only in the event of an attach error) (https://github.com/ably/ably-js/pull/526)
- Handle empty string response from an authUrl or authCallback as a token error
- Upgrade ws module to v5 (nodejs only) (https://github.com/ably/ably-js/pull/525)

**Note: this release drops support for nodejs versions < 4.5.** node v4 versions 4.5 or later are still supported; customers using node v4 are highly encouraged to update to the latest 4.x branch for security reasons

## [1.0.16](https://github.com/ably/ably-js/tree/1.0.16) (2018-06-25)

- Ensure a message id is included when serialized (https://github.com/ably/ably-js/pull/518)

## [1.0.15](https://github.com/ably/ably-js/tree/1.0.15) (2018-06-21)

- Add support for JWT (https://github.com/ably/ably-js/pull/511)
- Use https instead of git to pull dependencies (https://github.com/ably/ably-js/pull/515)
- Fix compilation issue with Google Closure compiler (https://github.com/ably/ably-js/pull/517)

## [1.0.14](https://github.com/ably/ably-js/tree/1.0.14) (2018-05-16)

- Avoid xhr with local files on chrome 65+ (https://github.com/ably/ably-js/pull/490)
- Update websocket library on node
- Improvements to Rest#request error handling
- Update nodejs supported versions
- TypeScript namespace change (`ablyLib` -> `Types` -- https://github.com/ably/ably-js/pull/492)

## [1.0.13](https://github.com/ably/ably-js/tree/1.0.13) (2018-02-01)

- Fix resume regression in 1.0.12

## [1.0.12](https://github.com/ably/ably-js/tree/1.0.12) (2018-01-30)

- Fix Typescript definition files (https://github.com/ably/ably-js/pull/444)
- Fix sync connection when an upgrade fails (https://github.com/ably/ably-js/pull/445)
- Fix encryption on IE9 and IE10 (https://github.com/ably/ably-js/pull/453)
- Fix crash on `Logger.LOG_ERROR` (https://github.com/ably/ably-js/pull/439/files)
- The `closeOnUnload` option now defaults to true (https://github.com/ably/ably-js/commit/293aed15d7ecaa001a3f834871b78d0403b195d7)

## [1.0.11](https://github.com/ably/ably-js/tree/1.0.11) (2017-12-11)

- Allow Message#fromEncoded to take a short-form (key-only) cipherParams (https://github.com/ably/ably-js/pull/438)

[note: 1.0.10 skipped due to buggy version on npm used to create package; see https://github.com/npm/npm/issues/18870]

## [1.0.9](https://github.com/ably/ably-js/tree/1.0.9) (2017-11-22)

- Add ability for an auth server to trigger a client to move to the failed state by returning an HTTP 403 [\#434](https://github.com/ably/ably-js/pull/434)

- Enable transient publishes when publish is called on a channel that isn't already attached [\#430](https://github.com/ably/ably-js/pull/430)

- Fix bug where qs params provided in an authUrl were being discarded after first use [\#433](https://github.com/ably/ably-js/pull/433)

- Default to logging timestamps on all platforms

- Tweak websocket error log levels to avoid logging non-error closes at ERROR level

[note: 1.0.8 was an npm-only release to fix a minor build error in the published artifact]

## [1.0.7](https://github.com/ably/ably-js/tree/1.0.7) (2017-10-12)

- Fix idle timeout bug when timer extended due to positive timeRemaning (if setTimeout is overly eager) [\#421](https://github.com/ably/ably-js/pull/421)

- Fix channel state change log message when error is not an ErrorInfo [\#420](https://github.com/ably/ably-js/pull/420)

- Stop network error trading a token request for a token failing the connection [\#419](https://github.com/ably/ably-js/pull/419)

## [1.0.6](https://github.com/ably/ably-js/tree/1.0.6) (2017-09-26)

- Fix issue where presence updates sent immediately after a recover can be ignored [\#412](https://github.com/ably/ably-js/pull/412)

- Fix authMethod being ignored if there are no authParams: [\#415](https://github.com/ably/ably-js/pull/415)

- Combine authParams with querystring params given in an authUrl, rather than replace: [\#418](https://github.com/ably/ably-js/pull/418)

## [1.0.5](https://github.com/ably/ably-js/tree/1.0.5) (2017-07-04)

- Fix issue with webpack module resolution: [\#404](https://github.com/ably/ably-js/pull/404)

- Implement Channels#release: [\#405](https://github.com/ably/ably-js/pull/405)

- Fix various bugs with useBinaryProtocol: true [\#406](https://github.com/ably/ably-js/pull/406)

## [1.0.4](https://github.com/ably/ably-js/tree/1.0.4) (2017-04-24)

- Have the default logHandler on node log timestamps (https://github.com/ably/ably-js/issues/399)

- Don't require Ably-protocol-level heartbeats by default on node (https://github.com/ably/ably-js/pull/398)

- Cherry-pick syncComplete fn->bool and other changes and fixes from 0.9 branch that didn't make it into 1.0.0

## [1.0.3](https://github.com/ably/ably-js/tree/1.0.3) (2017-04-17)

- Improved NativeScript supprot [\#392](https://github.com/ably/ably-js/pull/392)

- Fix bug in 1.0.2 where channels can never become reattached after a computer goes into sleep mode [\#396](https://github.com/ably/ably-js/pull/396)

## [1.0.2](https://github.com/ably/ably-js/tree/1.0.2) (2017-03-20)

- Don’t attempt a resume if last known activity was greater than the connectionStateTtl ago [\#389](https://github.com/ably/ably-js/pull/389)

## [1.0.1](https://github.com/ably/ably-js/tree/1.0.1) (2017-03-13)

- Only use websocket transport in node unless comet explicitly requested with `transports: ['comet']` or `transports: ['comet', 'web_socket']` [\#382](https://github.com/ably/ably-js/pull/382)

- Fix issue with multiple attaches happening after a failed resume [\#386](https://github.com/ably/ably-js/pull/386)

## [1.0](https://github.com/ably/ably-js/tree/1.0.0) (2017-03-08)

- Lots of changes; see https://github.com/ably/docs/issues/235 for the most important and/or breaking changes and upgrade notes, or the [full Changelog](https://github.com/ably/ably-js/compare/0.8.42...1.0.0)

---

## [0.8.42](https://github.com/ably/ably-js/tree/0.8.42) (2017-02-27)

- Fix presence issue when receive >9 presence updates from the same connection by backporting 0.9 presence newness algorithm 5ce4fa8

- Fix on('attached') registration in an on('attached') block firing immediately [\#364](https://github.com/ably/ably-js/issues/364)

## [0.8.41](https://github.com/ably/ably-js/tree/0.8.41) (2016-10-26)

- Fix occasional anomalously low presence set right after a sync [abb03f5](https://github.com/ably/ably-js/commit/abb03f5fb4dc86aa13ed60e2def030c30b151852)

## [0.8.40](https://github.com/ably/ably-js/tree/0.8.40) (2016-10-24)

- Fix ‘server’ header CORS warning in chrome for non-ably endpoints [\#345](https://github.com/ably/ably-js/pull/345)

## [0.8.39](https://github.com/ably/ably-js/tree/0.8.39) (2016-10-21)

- Disable xhr streaming if using cloudflare [\#342](https://github.com/ably/ably-js/pull/342)

## [0.8.38](https://github.com/ably/ably-js/tree/0.8.38) (2016-10-12)

- Node: remove runtime dependencies on crypto-js and buffertools [\#340](https://github.com/ably/ably-js/pull/340)

- Fix closeOnUnload on IE11 [\#338](https://github.com/ably/ably-js/issues/338)

## [0.8.37](https://github.com/ably/ably-js/tree/0.8.37) (2016-09-21)

- Node requests: limit max rest request TCP parallelism to 40 [\#336](https://github.com/ably/ably-js/pull/336)

## [0.8.36](https://github.com/ably/ably-js/tree/0.8.36) (2016-09-14)

- Backport subscribing with an event array fix from 0.9

## [0.8.35](https://github.com/ably/ably-js/tree/0.8.35) (2016-09-12)

- Node: try fallback hosts on ECONNRESET

## [0.8.34](https://github.com/ably/ably-js/tree/0.8.34) (2016-09-08)

- Node: keep TCP stream alive between REST requests; update `request` module [\#331](https://github.com/ably/ably-js/pull/331)

## [0.8.33](https://github.com/ably/ably-js/tree/0.8.33) (2016-08-19)

- Upgrade node websocket library for node 6 compatibility [\#326](https://github.com/ably/ably-js/pull/326)

## [0.8.32](https://github.com/ably/ably-js/tree/0.8.32) (2016-08-17)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.31...0.8.32)

- Rate-limit autoreconnect attempts to a maximum of 1 per second [\#322](https://github.com/ably/ably-js/pull/322)

- Fix REST fallback host functionality [\#327](https://github.com/ably/ably-js/pull/327)

## [0.8.31](https://github.com/ably/ably-js/tree/0.8.31) (2016-08-10)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.30...0.8.31)

- Add webpack/commonjs support [\#321](https://github.com/ably/ably-js/pull/321)

## [0.8.30](https://github.com/ably/ably-js/tree/0.8.30) (2016-07-18)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.29...0.8.30)

- Fix an issue where channels with large numbers of presence members (>100) could occasionally see a reduced presence set [\#319](https://github.com/ably/ably-js/pull/319)

## [0.8.29](https://github.com/ably/ably-js/tree/0.8.29) (2016-07-15)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.28...0.8.29)

- Fix an issue where messages retried across a transport upgrade could theoretically lead to duplicate messages [\#308](https://github.com/ably/ably-js/pull/308)

- Fix an issue where a client-detectable auth error on connect could cause the connect attempt to fail after the connect timeout (15s) rather than immediately [\#314](https://github.com/ably/ably-js/pull/314)

## [0.8.28](https://github.com/ably/ably-js/tree/0.8.28) (2016-07-13)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.27...0.8.28)

- Fix an issue where a server-sent channel detached message could cause the channel to go into the failed state [\#313](https://github.com/ably/ably-js/pull/313)

## [0.8.26](https://github.com/ably/ably-js/tree/0.8.26) (2016-07-11)

## [0.8.25](https://github.com/ably/ably-js/tree/0.8.25) (2016-07-06)

No net changes. 0.8.25 reverted a new header addition due to Ably not yet sending the correct `access-control-allow-headers` CORS headers for it; 0.8.26 re-adds it.

## [0.8.24](https://github.com/ably/ably-js/tree/0.8.24) (2016-07-06)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.23...0.8.24)

**Biggest changes:**

- Store transport preferences in memory not just localstorage, for node clients [\#303](https://github.com/ably/ably-js/pull/303)

- Fix issues with sync failures leading to lib sticking in the `synchronizing` state [\#302](https://github.com/ably/ably-js/pull/302)

- Add lib version string to connect querystring an as a header for REST [\#304](https://github.com/ably/ably-js/pull/304)

## [0.8.23](https://github.com/ably/ably-js/tree/0.8.23) (2016-07-01)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.22...0.8.23)

**Biggest changes:**

- Fix exception on accessing localStorage in Safari in private mode [\#298](https://github.com/ably/ably-js/pull/298)

- Fix bug causing transports to occasionally stick around after they should have been disconnected in some circumstances [\#296](https://github.com/ably/ably-js/pull/296)

- Sacrifice commas to appease IE8 [479152f](https://github.com/ably/ably-js/commit/479152f)

## [0.8.22](https://github.com/ably/ably-js/tree/0.8.22) (2016-06-24)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.21...0.8.22)

**Biggest changes:**

- Log and emit errors that occur on-connect (resume failures and upgrade failures) [\#291](https://github.com/ably/ably-js/pull/291)

- Rework upgrade flow so that all messages complete on one transport before switching to another, to avoid 'Invalid transport ID' message race condition [\#291](https://github.com/ably/ably-js/pull/291)

- Fix issue [\#285](https://github.com/ably/ably-js/issues/285) where a detach that happens during a presence sync could fail (also [\#291](https://github.com/ably/ably-js/pull/291))

- Log all connectionDetails on transport active (including the server you're connected to), not just clientId [\#294](https://github.com/ably/ably-js/pull/294)

- Implement `waitForSync` option in (realtime form of) `presence.get()` [\#295](https://github.com/ably/ably-js/pull/295)

## [0.8.21](https://github.com/ably/ably-js/tree/0.8.21) (2016-06-21)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.20...0.8.21)

**Biggest changes:**

- Fix bug where comet transports would occasionally send messages out of order if the sending rate is very high [\#290](https://github.com/ably/ably-js/pull/290)

## [0.8.20](https://github.com/ably/ably-js/tree/0.8.20) (2016-06-13)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.19...0.8.20)

**Biggest changes:**

- Rewrite the transport fallback sequence. It now starts with a polling transport (since some proxies break streaming transports) and then tries to upgrade to a websocket and streaming transport in parallel, picking the websocket if possible. It also remembers the best transport that worked (using HTML5 localstorage) and jumps straight to that if it can. [\#279](https://github.com/ably/ably-js/pull/279)

- Fix crypto bug when generating random data in IE 8 and 9 [\#282](https://github.com/ably/ably-js/pull/282)

- Disable JSONP transport when document is undefined, for React Native support [\#283](https://github.com/ably/ably-js/pull/283)

- Clear presence set on detach [\#287](https://github.com/ably/ably-js/pull/287)

## [0.8.19](https://github.com/ably/ably-js/tree/0.8.19) (2016-05-18)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.18...0.8.19)

**Biggest changes:**

- Fix connection state race condition when one transport drops while another is pending [\#274](https://github.com/ably/ably-js/pull/274)

- Make LOG_MAJOR log level (i.e. level 3) much more friendly [\#275](https://github.com/ably/ably-js/pull/275)

- A few minor fixes to ErrorInfo [\#276](https://github.com/ably/ably-js/pull/276)

## [0.8.18](https://github.com/ably/ably-js/tree/0.8.18) (2016-05-09)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.17...0.8.18)

**Biggest changes:**

- Change default log level to LOG_ERROR [c122a1f](https://github.com/ably/ably-js/commit/c122a1f)

- Add channel#errorReason [\#267](https://github.com/ably/ably-js/pull/267)

- Allow automatic re-authing (eg to use a new token) using auth#authorise() [\#261](https://github.com/ably/ably-js/pull/261)

- Allow ClientOptions#recover to take a callback (so you can decide whether to recover at the time) rather than just a boolean [\#266](https://github.com/ably/ably-js/pull/266)

## [0.8.17](https://github.com/ably/ably-js/tree/0.8.17) (2016-04-05)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.16...0.8.17)

**Biggest changes:**

- Don’t activate a transport that isn’t connected [\#255](https://github.com/ably/ably-js/pull/255)

- Don't try host fallbacks for token errors [\#251](https://github.com/ably/ably-js/pull/251)

- Standardise on 'initialize' event spelling [\#244](https://github.com/ably/ably-js/pull/244)

- Stop assuming that connection state won't change during a transport sync [\#249](https://github.com/ably/ably-js/pull/249)

- Don't reject a presence enter for lacking a clientId unless we're absolutely certain we're anonymous [\#256](https://github.com/ably/ably-js/pull/256)

## [0.8.16](https://github.com/ably/ably-js/tree/0.8.16) (2016-03-01)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.15...0.8.16)

**Biggest changes:**

- Implement latest version of the crypto spec [\#240](https://github.com/ably/ably-js/pull/240)

- Don't sync an upgrade transport that never got activated [\#241](https://github.com/ably/ably-js/pull/241)

## [0.8.15](https://github.com/ably/ably-js/tree/0.8.14) (2016-02-11)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.14...0.8.15)

**Biggest changes:**

- Expose presence message action as a string in the API [\#227](https://github.com/ably/ably-js/pull/233)

## [0.8.14](https://github.com/ably/ably-js/tree/0.8.14) (2016-02-09)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.13...0.8.14)

**Fixed bugs:**

- Token renewal does not seem to be working [\#203](https://github.com/ably/ably-js/issues/203)

- clientId from token auth is ignored for presence [\#198](https://github.com/ably/ably-js/issues/198)

- IE9 support [\#196](https://github.com/ably/ably-js/issues/196)

- ably-js-browsers failing in mobile safari [\#164](https://github.com/ably/ably-js/issues/164)

**Closed issues:**

- Proposal for new transport fallback behaviour [\#217](https://github.com/ably/ably-js/issues/217)

- Investigate whether encoding is being set correctly on presence data [\#200](https://github.com/ably/ably-js/issues/200)

**Merged pull requests:**

- enhance: Off removes all listeners for EventEmitter [\#227](https://github.com/ably/ably-js/pull/227) ([mattheworiordan](https://github.com/mattheworiordan))

- test\(realtime\): Testing echoMessages=true and echoMessages=false [\#226](https://github.com/ably/ably-js/pull/226) ([alex-georgiou](https://github.com/alex-georgiou))

- Safeguard Realtime Constructor [\#222](https://github.com/ably/ably-js/pull/222) ([CrowdHailer](https://github.com/CrowdHailer))

- Issue205 auth token expires fails [\#221](https://github.com/ably/ably-js/pull/221) ([mattheworiordan](https://github.com/mattheworiordan))

- Some proposed fixes for "Poor connection never attaches and reports connection to be connected \#195" [\#218](https://github.com/ably/ably-js/pull/218) ([SimonWoolf](https://github.com/SimonWoolf))

- Publish messages serially [\#215](https://github.com/ably/ably-js/pull/215) ([mattheworiordan](https://github.com/mattheworiordan))

- Adding README instructions for pulling ably-common submodule [\#214](https://github.com/ably/ably-js/pull/214) ([alex-georgiou](https://github.com/alex-georgiou))

- Token error update [\#209](https://github.com/ably/ably-js/pull/209) ([paddybyers](https://github.com/paddybyers))

- Routable format of connectionKey now applies to all transports [\#207](https://github.com/ably/ably-js/pull/207) ([paddybyers](https://github.com/paddybyers))

- Stop shimming async for requirejs [\#206](https://github.com/ably/ably-js/pull/206) ([SimonWoolf](https://github.com/SimonWoolf))

- Force token rerequest if realtime indicates token problems [\#204](https://github.com/ably/ably-js/pull/204) ([SimonWoolf](https://github.com/SimonWoolf))

- Fix presence data not getting encoded [\#201](https://github.com/ably/ably-js/pull/201) ([SimonWoolf](https://github.com/SimonWoolf))

- Presence: get clientId from Auth, not options directly [\#199](https://github.com/ably/ably-js/pull/199) ([SimonWoolf](https://github.com/SimonWoolf))

- Tweak xhr error handling [\#197](https://github.com/ably/ably-js/pull/197) ([SimonWoolf](https://github.com/SimonWoolf))

## [0.8.13](https://github.com/ably/ably-js/tree/0.8.13) (2016-01-08)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.12...0.8.13)

**Fixed bugs:**

- Connection state incorrectly reported [\#187](https://github.com/ably/ably-js/issues/187)

**Merged pull requests:**

- Fix unsubscribe for all events & listeners [\#193](https://github.com/ably/ably-js/pull/193) ([mattheworiordan](https://github.com/mattheworiordan))

## [0.8.12](https://github.com/ably/ably-js/tree/0.8.12) (2015-12-20)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.11...0.8.12)

**Merged pull requests:**

- Add script for running tests in CI [\#186](https://github.com/ably/ably-js/pull/186) ([lmars](https://github.com/lmars))

## [0.8.11](https://github.com/ably/ably-js/tree/0.8.11) (2015-12-18)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.10...0.8.11)

**Fixed bugs:**

- No internet up test coverage [\#183](https://github.com/ably/ably-js/issues/183)

**Merged pull requests:**

- Remove presence leaveOnDisconnect test [\#185](https://github.com/ably/ably-js/pull/185) ([SimonWoolf](https://github.com/SimonWoolf))

- Connectivity check fixes & tests [\#184](https://github.com/ably/ably-js/pull/184) ([SimonWoolf](https://github.com/SimonWoolf))

## [0.8.10](https://github.com/ably/ably-js/tree/0.8.10) (2015-12-17)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.9...0.8.10)

**Implemented enhancements:**

- Flexible handling of callback for auth methods [\#175](https://github.com/ably/ably-js/issues/175)

**Fixed bugs:**

- High priority spec incompatibilities [\#170](https://github.com/ably/ably-js/issues/170)

**Closed issues:**

- Xhr connections not starting a /recv request after /connect connection ends [\#180](https://github.com/ably/ably-js/issues/180)

**Merged pull requests:**

- Fix comet connections not starting a recv after the connect req closes [\#181](https://github.com/ably/ably-js/pull/181) ([SimonWoolf](https://github.com/SimonWoolf))

- Spec updates and miscellania [\#177](https://github.com/ably/ably-js/pull/177) ([SimonWoolf](https://github.com/SimonWoolf))

## [0.8.9](https://github.com/ably/ably-js/tree/0.8.9) (2015-12-04)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.8...0.8.9)

**Implemented enhancements:**

- Spec validation [\#43](https://github.com/ably/ably-js/issues/43)

**Fixed bugs:**

- Highest priority item [\#172](https://github.com/ably/ably-js/issues/172)

**Merged pull requests:**

- Add support for authMethod: POST [\#173](https://github.com/ably/ably-js/pull/173) ([SimonWoolf](https://github.com/SimonWoolf))

## [0.8.8](https://github.com/ably/ably-js/tree/0.8.8) (2015-11-20)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.7...0.8.8)

**Fixed bugs:**

- HTTP requests ignore `tls: false` attribute [\#166](https://github.com/ably/ably-js/issues/166)

- Presence callback error following an immediate disconnect [\#161](https://github.com/ably/ably-js/issues/161)

**Merged pull requests:**

- REST client: respect tls clientOption [\#167](https://github.com/ably/ably-js/pull/167) ([SimonWoolf](https://github.com/SimonWoolf))

- Don’t assume a callback exists if error occurs during presence enter/update [\#162](https://github.com/ably/ably-js/pull/162) ([SimonWoolf](https://github.com/SimonWoolf))

- clientId specs [\#145](https://github.com/ably/ably-js/pull/145) ([mattheworiordan](https://github.com/mattheworiordan))

## [0.8.7](https://github.com/ably/ably-js/tree/0.8.7) (2015-11-13)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.6...0.8.7)

**Merged pull requests:**

- Include version and license [\#159](https://github.com/ably/ably-js/pull/159) ([mattheworiordan](https://github.com/mattheworiordan))

## [0.8.6](https://github.com/ably/ably-js/tree/0.8.6) (2015-11-12)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.5...0.8.6)

**Implemented enhancements:**

- Switch arity of auth methods [\#137](https://github.com/ably/ably-js/issues/137)

- PresenceMessage action [\#45](https://github.com/ably/ably-js/issues/45)

- Emit errors [\#39](https://github.com/ably/ably-js/issues/39)

- README to include code examples and follow common format [\#38](https://github.com/ably/ably-js/issues/38)

- Share test app set up & encoding fixture data [\#34](https://github.com/ably/ably-js/issues/34)

- Integrate SauceLabs browser tests into ably-js [\#31](https://github.com/ably/ably-js/issues/31)

- License & CHANGELOG needs to be included [\#2](https://github.com/ably/ably-js/issues/2)

**Fixed bugs:**

- MsgPack cipher workaround [\#142](https://github.com/ably/ably-js/issues/142)

- Switch arity of auth methods [\#137](https://github.com/ably/ably-js/issues/137)

- connection.close does not always free up resources [\#136](https://github.com/ably/ably-js/issues/136)

- XHR requests timing out leads to connection going into failed state [\#134](https://github.com/ably/ably-js/issues/134)

- connection\#ping throws exception if you don't pass it a callback [\#133](https://github.com/ably/ably-js/issues/133)

- Invalid encoding should not result in the data vanishing [\#121](https://github.com/ably/ably-js/issues/121)

- jsonp transport needs to set `envelope=json` param [\#113](https://github.com/ably/ably-js/issues/113)

- Token Params are not being sent through to authUrl [\#108](https://github.com/ably/ably-js/issues/108)

- Channels stay attached even if connection can't be resumed [\#105](https://github.com/ably/ably-js/issues/105)

- Calling channel.presence.enter doesn't attach to the channel if connectino has been closed and reopened [\#104](https://github.com/ably/ably-js/issues/104)

- Authentication etc. failures with comet incorrectly put connection into 'disconnected' state \(should be 'failed'\) [\#101](https://github.com/ably/ably-js/issues/101)

- Connection recovery after connect causing presence to fail [\#95](https://github.com/ably/ably-js/issues/95)

- Exception / error should be shown if trying to publish or modify presence on a closed connection [\#94](https://github.com/ably/ably-js/issues/94)

- Hard coded transport to work around bugs need to be removed [\#86](https://github.com/ably/ably-js/issues/86)

- Ably-js does not call error callback when channel attach fails when using comet transport [\#81](https://github.com/ably/ably-js/issues/81)

- When attach fails with 'superseded transport handle', ably-js retries immediately forever [\#71](https://github.com/ably/ably-js/issues/71)

- iFrame tests are failing in CI [\#62](https://github.com/ably/ably-js/issues/62)

- WsData exception [\#61](https://github.com/ably/ably-js/issues/61)

- Incorrect error shown in clients when account limits are hit [\#57](https://github.com/ably/ably-js/issues/57)

- IFrameTransport errors when connecting with tls: false [\#55](https://github.com/ably/ably-js/issues/55)

- ToJson bug [\#44](https://github.com/ably/ably-js/issues/44)

- No transport handle [\#40](https://github.com/ably/ably-js/issues/40)

- Bug when running `karma` [\#36](https://github.com/ably/ably-js/issues/36)

- Travis CI builds failing consistenly [\#30](https://github.com/ably/ably-js/issues/30)

- Comet transport error [\#27](https://github.com/ably/ably-js/issues/27)

- Test client library with explicit binary protocol in JSBin [\#18](https://github.com/ably/ably-js/issues/18)

- iPad iOS6 timing issues [\#12](https://github.com/ably/ably-js/issues/12)

- Firefox 10 with Windows 7 fails because of incorrect mime type [\#11](https://github.com/ably/ably-js/issues/11)

- Internet Up URL & use of HTTPS [\#4](https://github.com/ably/ably-js/issues/4)

**Closed issues:**

- requestToken sending key? [\#157](https://github.com/ably/ably-js/issues/157)

- Wrong state change reason with token expiry [\#149](https://github.com/ably/ably-js/issues/149)

- On jsbin, get an exception creating websocket if tls: false [\#129](https://github.com/ably/ably-js/issues/129)

- Auth differences between ably-js and ably-ruby [\#116](https://github.com/ably/ably-js/issues/116)

- ably-js doesn't dispose of the websocket resource if the connection attempt times out [\#98](https://github.com/ably/ably-js/issues/98)

- Use the correct internet-up CDN [\#42](https://github.com/ably/ably-js/issues/42)

**Merged pull requests:**

- Presence map: normalise enter/update actions to present in \#put [\#152](https://github.com/ably/ably-js/pull/152) ([SimonWoolf](https://github.com/SimonWoolf))

- ably-js-browsers-all [\#151](https://github.com/ably/ably-js/pull/151) ([SimonWoolf](https://github.com/SimonWoolf))

- Pass on DISCONNECT errs; a few test fixes [\#150](https://github.com/ably/ably-js/pull/150) ([SimonWoolf](https://github.com/SimonWoolf))

- Allow iframe transport to work with local \(file://\) pages [\#148](https://github.com/ably/ably-js/pull/148) ([SimonWoolf](https://github.com/SimonWoolf))

- Connection\#ping: allow no callback, return a responseTime, add tests [\#146](https://github.com/ably/ably-js/pull/146) ([SimonWoolf](https://github.com/SimonWoolf))

- Convert WordArrays to ArrayBuffers when msgpack-encoding [\#143](https://github.com/ably/ably-js/pull/143) ([SimonWoolf](https://github.com/SimonWoolf))

- NodeCometTransport: clear request timeout on request error [\#141](https://github.com/ably/ably-js/pull/141) ([SimonWoolf](https://github.com/SimonWoolf))

- Use the correct internet up URL [\#140](https://github.com/ably/ably-js/pull/140) ([mattheworiordan](https://github.com/mattheworiordan))

- Log protocol messages at micro level [\#139](https://github.com/ably/ably-js/pull/139) ([mattheworiordan](https://github.com/mattheworiordan))

- Transport failures don’t necessarily imply connection failures [\#135](https://github.com/ably/ably-js/pull/135) ([SimonWoolf](https://github.com/SimonWoolf))

- Avoid ambiguity in received transport protocol message [\#132](https://github.com/ably/ably-js/pull/132) ([mattheworiordan](https://github.com/mattheworiordan))

- Various new-upgrade and test fixes [\#131](https://github.com/ably/ably-js/pull/131) ([SimonWoolf](https://github.com/SimonWoolf))

- Connection state events 3 [\#130](https://github.com/ably/ably-js/pull/130) ([SimonWoolf](https://github.com/SimonWoolf))

- Presence update when connection closed [\#128](https://github.com/ably/ably-js/pull/128) ([SimonWoolf](https://github.com/SimonWoolf))

- Tests no force ws; fix failure to callback on presence event causing implicit attach [\#127](https://github.com/ably/ably-js/pull/127) ([SimonWoolf](https://github.com/SimonWoolf))

- Ensure websocket object is disposed if it fails to connect [\#125](https://github.com/ably/ably-js/pull/125) ([SimonWoolf](https://github.com/SimonWoolf))

- Add some rest presence tests [\#124](https://github.com/ably/ably-js/pull/124) ([SimonWoolf](https://github.com/SimonWoolf))

- Invalid encodings [\#123](https://github.com/ably/ably-js/pull/123) ([SimonWoolf](https://github.com/SimonWoolf))

- Don't process duplicate messages or messages on inactive transports [\#122](https://github.com/ably/ably-js/pull/122) ([SimonWoolf](https://github.com/SimonWoolf))

- CipherParams conform to latest spec \(separate algorithm and keyLength\) [\#120](https://github.com/ably/ably-js/pull/120) ([SimonWoolf](https://github.com/SimonWoolf))

- Use ably-common submodule instead of inline json for test app setup [\#119](https://github.com/ably/ably-js/pull/119) ([SimonWoolf](https://github.com/SimonWoolf))

- Don’t include timestamp/connectionid in string/json representations of messages [\#117](https://github.com/ably/ably-js/pull/117) ([SimonWoolf](https://github.com/SimonWoolf))

- If client lib initialized with clientid, use that for auth if no new tokenParams object is supplied [\#115](https://github.com/ably/ably-js/pull/115) ([SimonWoolf](https://github.com/SimonWoolf))

- JSONP transport: use jsonp envelope [\#114](https://github.com/ably/ably-js/pull/114) ([SimonWoolf](https://github.com/SimonWoolf))

- Define error codes that result in failed rather than disconnected [\#112](https://github.com/ably/ably-js/pull/112) ([SimonWoolf](https://github.com/SimonWoolf))

- Explicitly disallow empty string clientIds [\#111](https://github.com/ably/ably-js/pull/111) ([SimonWoolf](https://github.com/SimonWoolf))

- Allow connection to inherit clientId from connectionDetails [\#110](https://github.com/ably/ably-js/pull/110) ([SimonWoolf](https://github.com/SimonWoolf))

- Some small connection, channel, and presence fixes [\#109](https://github.com/ably/ably-js/pull/109) ([SimonWoolf](https://github.com/SimonWoolf))

- Standardise on tabs [\#107](https://github.com/ably/ably-js/pull/107) ([SimonWoolf](https://github.com/SimonWoolf))

## [0.8.5](https://github.com/ably/ably-js/tree/0.8.5) (2015-08-20)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.3...0.8.5)

**Implemented enhancements:**

- untilAttach for presence history is missing [\#93](https://github.com/ably/ably-js/issues/93)

**Closed issues:**

- presence\#history only available for rest channels, not realtime ones [\#84](https://github.com/ably/ably-js/issues/84)

- Saucelabs websockets support apparently sucks..? [\#82](https://github.com/ably/ably-js/issues/82)

**Merged pull requests:**

- support untilAttach for realtime presence history requests [\#96](https://github.com/ably/ably-js/pull/96) ([SimonWoolf](https://github.com/SimonWoolf))

- Force saucelabs to use varnish rather than squid as a proxy [\#90](https://github.com/ably/ably-js/pull/90) ([SimonWoolf](https://github.com/SimonWoolf))

- Fix a race condition in realtime publish tests [\#89](https://github.com/ably/ably-js/pull/89) ([SimonWoolf](https://github.com/SimonWoolf))

- Add grunt release:\[releasetype\] task [\#88](https://github.com/ably/ably-js/pull/88) ([SimonWoolf](https://github.com/SimonWoolf))

## [0.8.3](https://github.com/ably/ably-js/tree/0.8.3) (2015-08-04)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.2...0.8.3)

**Implemented enhancements:**

- authCallback bug, test coverage & additional type support [\#72](https://github.com/ably/ably-js/issues/72)

- Does not support useTokenAuth client options [\#70](https://github.com/ably/ably-js/issues/70)

- No updateClient method [\#67](https://github.com/ably/ably-js/issues/67)

- createTokenRequest without key option [\#21](https://github.com/ably/ably-js/issues/21)

**Fixed bugs:**

- attaching and detaching events are not emitted [\#74](https://github.com/ably/ably-js/issues/74)

- attach on a channel for a failed client does not fail the attach [\#73](https://github.com/ably/ably-js/issues/73)

- authCallback bug, test coverage & additional type support [\#72](https://github.com/ably/ably-js/issues/72)

- Does not support useTokenAuth client options [\#70](https://github.com/ably/ably-js/issues/70)

- Calling attach twice on an invalid channels fails [\#66](https://github.com/ably/ably-js/issues/66)

- authUrl tests fail in Firefox [\#63](https://github.com/ably/ably-js/issues/63)

- Better error message for an invalid token from the authUrl or callback [\#56](https://github.com/ably/ably-js/issues/56)

- createTokenRequest without key option [\#21](https://github.com/ably/ably-js/issues/21)

**Closed issues:**

- Various functions require a callback with \(err, result\) but docs imply should work with just \(result\) [\#69](https://github.com/ably/ably-js/issues/69)

**Merged pull requests:**

- Presence history 3 [\#87](https://github.com/ably/ably-js/pull/87) ([paddybyers](https://github.com/paddybyers))

- createTokenRequest tweaks [\#83](https://github.com/ably/ably-js/pull/83) ([SimonWoolf](https://github.com/SimonWoolf))

- Add tests for authCallback and update its docstring [\#80](https://github.com/ably/ably-js/pull/80) ([SimonWoolf](https://github.com/SimonWoolf))

- Emit attaching [\#79](https://github.com/ably/ably-js/pull/79) ([paddybyers](https://github.com/paddybyers))

- Support untilAttach param in history requests for realtime channels [\#78](https://github.com/ably/ably-js/pull/78) ([paddybyers](https://github.com/paddybyers))

- Add useTokenAuth option [\#77](https://github.com/ably/ably-js/pull/77) ([SimonWoolf](https://github.com/SimonWoolf))

- Add Presence\#update and Presence\#updateClient methods [\#76](https://github.com/ably/ably-js/pull/76) ([SimonWoolf](https://github.com/SimonWoolf))

- Correct checks for existence of channel name in received message [\#68](https://github.com/ably/ably-js/pull/68) ([paddybyers](https://github.com/paddybyers))

- Auth url fixes2 [\#65](https://github.com/ably/ably-js/pull/65) ([paddybyers](https://github.com/paddybyers))

## [0.8.2](https://github.com/ably/ably-js/tree/0.8.2) (2015-07-01)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.1...0.8.2)

**Implemented enhancements:**

- Release as a bower module [\#1](https://github.com/ably/ably-js/issues/1)

## [0.8.1](https://github.com/ably/ably-js/tree/0.8.1) (2015-06-30)

[Full Changelog](https://github.com/ably/ably-js/compare/0.8.0...0.8.1)

**Implemented enhancements:**

- Improve logging [\#58](https://github.com/ably/ably-js/issues/58)

- Agree on handling of JSON value types [\#52](https://github.com/ably/ably-js/issues/52)

**Fixed bugs:**

- Malformed response body from server: Unexpected token X with Comet on Node.js [\#59](https://github.com/ably/ably-js/issues/59)

**Closed issues:**

- Connection state recovery is intermittent [\#48](https://github.com/ably/ably-js/issues/48)

- Presence\#enterClient errors if not supplied with a data param [\#47](https://github.com/ably/ably-js/issues/47)

- No keyName specified [\#41](https://github.com/ably/ably-js/issues/41)

**Merged pull requests:**

- Throw 411 error for unsupported data types [\#53](https://github.com/ably/ably-js/pull/53) ([SimonWoolf](https://github.com/SimonWoolf))

- Make sure boolean data is encoded correctly [\#51](https://github.com/ably/ably-js/pull/51) ([SimonWoolf](https://github.com/SimonWoolf))

- Allow data parameter to be optional for presence\#enter and channell\#subscribe \(2\) [\#50](https://github.com/ably/ably-js/pull/50) ([SimonWoolf](https://github.com/SimonWoolf))

## [0.8](https://github.com/ably/ably-js/tree/0.8.0) (2015-04-29)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.9...0.8.0)

**Implemented enhancements:**

- Register ably-js as ably in the npm directory [\#29](https://github.com/ably/ably-js/issues/29)

- Sparse stat support [\#22](https://github.com/ably/ably-js/issues/22)

- Travis.CI support [\#3](https://github.com/ably/ably-js/issues/3)

**Fixed bugs:**

- Browser test error: authbase0 - displayError is not defined [\#35](https://github.com/ably/ably-js/issues/35)

- \[Object object\] in error messages makes it difficult to see what the problem is [\#24](https://github.com/ably/ably-js/issues/24)

- Connection issues [\#20](https://github.com/ably/ably-js/issues/20)

- Time function on Realtime blocks Node from exiting [\#9](https://github.com/ably/ably-js/issues/9)

- iFrame loading [\#8](https://github.com/ably/ably-js/issues/8)

---

## [0.7.9](https://github.com/ably/ably-js/tree/0.7.9) (2015-04-03)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.8...0.7.9)

## [0.7.8](https://github.com/ably/ably-js/tree/0.7.8) (2015-04-03)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.7...0.7.8)

## [0.7.7](https://github.com/ably/ably-js/tree/0.7.7) (2015-04-03)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.6...0.7.7)

## [0.7.6](https://github.com/ably/ably-js/tree/0.7.6) (2015-04-03)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.5...0.7.6)

**Fixed bugs:**

- Nodeunit tests in the browser [\#23](https://github.com/ably/ably-js/issues/23)

**Closed issues:**

- TypeError on presence.subscribe\(\) [\#26](https://github.com/ably/ably-js/issues/26)

## [0.7.5](https://github.com/ably/ably-js/tree/0.7.5) (2015-03-21)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.4...0.7.5)

## [0.7.4](https://github.com/ably/ably-js/tree/0.7.4) (2015-03-20)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.3...0.7.4)

**Closed issues:**

- Time out tests [\#15](https://github.com/ably/ably-js/issues/15)

## [0.7.3](https://github.com/ably/ably-js/tree/0.7.3) (2015-03-12)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.2...0.7.3)

## [0.7.2](https://github.com/ably/ably-js/tree/0.7.2) (2015-03-10)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.1...0.7.2)

**Fixed bugs:**

- Swallowing errors [\#6](https://github.com/ably/ably-js/issues/6)

**Closed issues:**

- Logger [\#14](https://github.com/ably/ably-js/issues/14)

- PhantomJS issues [\#13](https://github.com/ably/ably-js/issues/13)

- Node.js 0.12 [\#10](https://github.com/ably/ably-js/issues/10)

## [0.7.1](https://github.com/ably/ably-js/tree/0.7.1) (2015-02-11)

[Full Changelog](https://github.com/ably/ably-js/compare/0.7.0...0.7.1)

## [0.7](https://github.com/ably/ably-js/tree/0.7.0) (2015-01-12)

[Full Changelog](https://github.com/ably/ably-js/compare/0.6.3...0.7.0)

---

## [0.6.3](https://github.com/ably/ably-js/tree/0.6.3) (2014-12-09)

[Full Changelog](https://github.com/ably/ably-js/compare/0.6.1...0.6.3)

## [0.6.1](https://github.com/ably/ably-js/tree/0.6.1) (2014-11-27)

[Full Changelog](https://github.com/ably/ably-js/compare/0.6.0...0.6.1)

## [0.6](https://github.com/ably/ably-js/tree/0.6.0) (2014-11-27)

[Full Changelog](https://github.com/ably/ably-js/compare/0.5.0...0.6.0)

---

## [0.5](https://github.com/ably/ably-js/tree/0.5.0) (2014-01-13)

[Full Changelog](https://github.com/ably/ably-js/compare/0.2.1...0.5.0)

---

## [0.2.1](https://github.com/ably/ably-js/tree/0.2.1) (2013-04-29)

[Full Changelog](https://github.com/ably/ably-js/compare/0.2.0...0.2.1)

## [0.2](https://github.com/ably/ably-js/tree/0.2.0) (2013-04-17)

[Full Changelog](https://github.com/ably/ably-js/compare/0.1.1...0.2.0)

---

## [0.1.1](https://github.com/ably/ably-js/tree/0.1.1) (2012-12-05)

[Full Changelog](https://github.com/ably/ably-js/compare/0.1.0...0.1.1)

## [0.1](https://github.com/ably/ably-js/tree/0.1.0) (2012-12-04)

---

Some sections of this Change Log have been automatically generated by [github_changelog_generator](https://github.com/skywinder/Github-Changelog-Generator)
