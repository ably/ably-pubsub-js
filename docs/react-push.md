# React Hooks for Push Notifications

Use Ably Push Notifications in your React application using idiomatic React Hooks.

Using these hooks you can:

- [Activate and deactivate devices](https://ably.com/docs/push/activate-subscribe) for push notifications
- [Subscribe devices or clients](https://ably.com/docs/push/activate-subscribe#subscribing) to push notifications on channels
- List active push subscriptions for a channel

> [!NOTE]
> Push notifications require the Push plugin to be loaded. If you're using the modular bundle, ensure the Push plugin is included in your client options. See the [Push Notifications documentation](https://ably.com/docs/push) for general concepts and setup.

---

<!-- @import "[TOC]" {cmd="toc" depthFrom=2 depthTo=6 orderedList=false} -->
<!-- code_chunk_output -->

- [Prerequisites](#prerequisites)
- [usePushActivation](#usepushactivation)
- [usePush](#usepush)
- [Error Handling](#error-handling)
- [Full Example](#full-example)
- [API Reference](#api-reference)

## <!-- /code_chunk_output -->

## Prerequisites

Push hooks require the Ably client to be configured with the Push plugin. When using the default `ably` bundle, the Push plugin is included automatically. If you're using the modular bundle, you must provide it explicitly:

```jsx
import * as Ably from 'ably';
import Push from 'ably/push';

const client = new Ably.Realtime({
  key: 'your-ably-api-key',
  clientId: 'me',
  plugins: { Push },
});

root.render(
  <AblyProvider client={client}>
    <App />
  </AblyProvider>,
);
```

---

## usePushActivation

The `usePushActivation` hook provides functions to activate and deactivate the current device for push notifications. It works directly under an `AblyProvider` and does **not** require a `ChannelProvider`.

```jsx
import { usePushActivation } from 'ably/react';

const PushActivationComponent = () => {
  const { activate, deactivate, localDevice } = usePushActivation();

  return (
    <div>
      <p>Status: {localDevice ? `Activated (${localDevice.id})` : 'Not activated'}</p>
      <button onClick={() => activate()}>Enable push notifications</button>
      <button onClick={() => deactivate()}>Disable push notifications</button>
    </div>
  );
};
```

The `localDevice` property is reactive — it updates when `activate()` or `deactivate()` is called. It is also initialised from `localStorage` on mount, so if the device was activated in a prior session, `localDevice` will be populated immediately.

#### Activation lifecycle

Activation registers the device with Ably's push service (on web, this requests browser notification permission and registers a service worker). The device identity is persisted to `localStorage`, so:

- **Activation survives page reloads and app restarts.** You do not need to call `activate()` on every mount.
- **Calling `activate()` when already activated is safe** — it confirms the existing registration without side effects.
- **`deactivate()` is for explicit user opt-out only.** It removes the device registration from Ably's servers and clears all persisted push state. Do not call it on unmount or app close.

A typical pattern is to call `activate()` once in response to a user action (e.g. tapping "Enable notifications"), not automatically on mount:

```jsx
const NotificationBanner = () => {
  const { activate, localDevice } = usePushActivation();

  const handleEnable = async () => {
    try {
      await activate();
    } catch (err) {
      console.error('Push activation failed:', err);
    }
  };

  if (localDevice) return null;

  return (
    <div className="banner">
      <p>Get notified about new updates</p>
      <button onClick={handleEnable}>Enable notifications</button>
    </div>
  );
};
```

#### Multiple clients

If you use multiple Ably clients via the `ablyId` pattern, pass the ID to `usePushActivation`:

```jsx
const { activate, deactivate } = usePushActivation('providerOne');
```

---

## usePush

The `usePush` hook provides functions to manage push notification subscriptions for a specific channel. It must be used inside a `ChannelProvider`.

```jsx
import { usePush } from 'ably/react';

const PushSubscriptionComponent = () => {
  const { subscribeDevice, unsubscribeDevice, isActivated } = usePush('your-channel-name');

  return (
    <div>
      <button onClick={() => subscribeDevice()} disabled={!isActivated}>
        Subscribe to channel
      </button>
      <button onClick={() => unsubscribeDevice()} disabled={!isActivated}>
        Unsubscribe from channel
      </button>
      {!isActivated && <p>Push must be activated before subscribing.</p>}
    </div>
  );
};
```

#### Activation awareness

`usePush` is aware of whether push has been activated via `usePushActivation`. The `isActivated` property is reactive — when `usePushActivation` calls `activate()` or `deactivate()`, all `usePush` instances update automatically, even if they are in different components. This works via a shared store without requiring any additional providers.

> [!IMPORTANT]
> The device must be activated (via `usePushActivation`) before calling `subscribeDevice()` or `unsubscribeDevice()`. Use `isActivated` to guard your UI or check before calling. See [Error Handling](#error-handling) for details on what happens if activation hasn't been completed.

#### Subscribe by device or by client

`usePush` supports both device-level and client-level subscriptions:

```jsx
const {
  subscribeDevice,    // Subscribe the current device
  unsubscribeDevice,  // Unsubscribe the current device
  subscribeClient,    // Subscribe all devices for the current clientId
  unsubscribeClient,  // Unsubscribe all devices for the current clientId
} = usePush('your-channel-name');
```

- **Device subscriptions** target the specific device. Use when you want per-device control.
- **Client subscriptions** target all devices that share the same `clientId`. Use when a user should receive push notifications regardless of which device they're on.

> [!NOTE]
> `subscribeClient` and `unsubscribeClient` require the Ably client to be configured with a `clientId`. An error will be thrown if no `clientId` is set.

#### Listing subscriptions

You can list active push subscriptions for the channel:

```jsx
const { listSubscriptions } = usePush('your-channel-name');

const handleListSubscriptions = async () => {
  const result = await listSubscriptions();
  console.log('Active subscriptions:', result.items);
};
```

`listSubscriptions` accepts an optional params object to filter by `deviceId` or `clientId`:

```jsx
const result = await listSubscriptions({ deviceId: 'specific-device-id' });
```

#### Push subscriptions are persistent

Unlike presence (which enters on mount and leaves on unmount), push subscriptions are **persistent server-side state**. They survive app restarts and are not automatically removed when a component unmounts. This is by design — push notifications are meant to be delivered even when your app is not running.

To remove a subscription, explicitly call `unsubscribeDevice()` or `unsubscribeClient()` in response to a user action.

---

## Error Handling

### Push plugin not loaded

If the Push plugin is not included in your client configuration, `usePush` will throw immediately on render:

```
Error: Push plugin not provided (code: 40019)
```

For `usePushActivation`, the error is thrown when `activate()` or `deactivate()` is called.

To fix this, ensure the Push plugin is loaded. See [Prerequisites](#prerequisites).

### Device not activated

If you call `subscribeDevice()` or `unsubscribeDevice()` before the device has been activated, the promise will reject with:

```
Error: Cannot subscribe from client without deviceIdentityToken (code: 50000)
```

The recommended way to prevent this is to use the `isActivated` flag from `usePush` to guard your UI:

```jsx
const { subscribeDevice, isActivated } = usePush('alerts');

// Disable the button until push is activated
<button onClick={() => subscribeDevice()} disabled={!isActivated}>
  Subscribe
</button>
```

Alternatively, you can sequence activation and subscription imperatively:

```jsx
const { activate } = usePushActivation();
const { subscribeDevice } = usePush('alerts');

const handleEnablePush = async () => {
  await activate();
  await subscribeDevice();
};
```

### No clientId set

If you call `subscribeClient()` or `unsubscribeClient()` without a `clientId` configured on the Ably client, the promise will reject with:

```
Error: Cannot subscribe from client without client ID (code: 50000)
```

Ensure your Ably client is created with a `clientId`:

```jsx
const client = new Ably.Realtime({ key: 'your-api-key', clientId: 'me' });
```

### Connection and channel errors

Like other channel-level hooks, `usePush` returns `connectionError` and `channelError`:

```jsx
const { subscribeDevice, connectionError, channelError } = usePush('your-channel-name');

if (connectionError) {
  return <p>Connection error: {connectionError.message}</p>;
}
if (channelError) {
  return <p>Channel error: {channelError.message}</p>;
}
```

---

## Full Example

A complete example showing activation, channel subscription, and error handling:

```jsx
import { AblyProvider, ChannelProvider, usePushActivation, usePush } from 'ably/react';
import * as Ably from 'ably';
import { useState } from 'react';

const client = new Ably.Realtime({ key: 'your-ably-api-key', clientId: 'me' });

const App = () => (
  <AblyProvider client={client}>
    <PushActivation />
    <ChannelProvider channelName="alerts">
      <AlertSubscription />
    </ChannelProvider>
  </AblyProvider>
);

const PushActivation = () => {
  const { activate, deactivate, localDevice } = usePushActivation();
  const [error, setError] = useState(null);

  const handleToggle = async () => {
    try {
      if (localDevice) {
        await deactivate();
      } else {
        await activate();
      }
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div>
      <button onClick={handleToggle}>
        {localDevice ? 'Disable' : 'Enable'} push notifications
      </button>
      {localDevice && <p>Device ID: {localDevice.id}</p>}
      {error && <p className="error">{error}</p>}
    </div>
  );
};

const AlertSubscription = () => {
  const {
    subscribeDevice, unsubscribeDevice,
    isActivated, connectionError, channelError,
  } = usePush('alerts');
  const [subscribed, setSubscribed] = useState(false);

  if (connectionError) return <p>Connection error: {connectionError.message}</p>;
  if (channelError) return <p>Channel error: {channelError.message}</p>;

  const handleToggle = async () => {
    try {
      if (subscribed) {
        await unsubscribeDevice();
      } else {
        await subscribeDevice();
      }
      setSubscribed(!subscribed);
    } catch (err) {
      console.error('Subscription error:', err);
    }
  };

  return (
    <div>
      <button onClick={handleToggle} disabled={!isActivated}>
        {subscribed ? 'Unsubscribe from' : 'Subscribe to'} alerts
      </button>
      {!isActivated && <p>Activate push notifications first.</p>}
    </div>
  );
};
```

---

## API Reference

### `usePushActivation`

```typescript
function usePushActivation(ablyId?: string): PushActivationResult;

interface PushActivationResult {
  activate: () => Promise<void>;
  deactivate: () => Promise<void>;
  localDevice: Ably.LocalDevice | null;
}
```

| Property      | Type                     | Description                                                                                              |
| ------------- | ------------------------ | -------------------------------------------------------------------------------------------------------- |
| `activate`    | `() => Promise<void>`    | Activates the device for push notifications. Persists to `localStorage`.                                 |
| `deactivate`  | `() => Promise<void>`    | Deactivates the device and removes the registration from Ably's servers.                                 |
| `localDevice` | `Ably.LocalDevice\|null` | The current device if activated, `null` otherwise. Reactive — updates on activate/deactivate and is initialised from persisted state. |

### `usePush`

```typescript
function usePush(channelNameOrNameAndOptions: ChannelParameters): PushResult;

interface PushResult {
  channel: Ably.RealtimeChannel;
  subscribeDevice: () => Promise<void>;
  unsubscribeDevice: () => Promise<void>;
  subscribeClient: () => Promise<void>;
  unsubscribeClient: () => Promise<void>;
  listSubscriptions: (params?: Record<string, string>) => Promise<PaginatedResult<PushChannelSubscription>>;
  isActivated: boolean;
  connectionError: Ably.ErrorInfo | null;
  channelError: Ably.ErrorInfo | null;
}
```

| Property             | Type                                               | Description                                                                    |
| -------------------- | -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `channel`            | `Ably.RealtimeChannel`                             | The channel instance.                                                          |
| `subscribeDevice`    | `() => Promise<void>`                              | Subscribes the current device to push notifications on this channel.           |
| `unsubscribeDevice`  | `() => Promise<void>`                              | Unsubscribes the current device from push notifications on this channel.       |
| `subscribeClient`    | `() => Promise<void>`                              | Subscribes all devices for the current `clientId` to push on this channel.     |
| `unsubscribeClient`  | `() => Promise<void>`                              | Unsubscribes all devices for the current `clientId` from push on this channel. |
| `listSubscriptions`  | `(params?) => Promise<PaginatedResult<...>>`       | Lists active push subscriptions for this channel.                              |
| `isActivated`        | `boolean`                                          | Whether push is currently activated. Reactive — updates across components.     |
| `connectionError`    | `Ably.ErrorInfo \| null`                           | Current connection error, if any.                                              |
| `channelError`       | `Ably.ErrorInfo \| null`                           | Current channel error, if any.                                                 |
