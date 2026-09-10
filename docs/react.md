# ably-js React Hooks

Use Ably in your React application using idiomatic, easy to use, React Hooks!

Using this module you can:

- Interact with [Ably channels](https://ably.com/docs/channels) using a React Hook.
- [Publish messages](https://ably.com/docs/channels#publish) via Ably using the publish function the hooks provide
- Get notifications of user [presence on channels](https://ably.com/docs/presence-occupancy/presence)
- Enter presence and send presence updates

The hooks provide a simplified syntax for interacting with Ably, and manage the lifecycle of the Ably SDK instances for you taking care to subscribe and unsubscribe to channels and events when your react components re-render.

> [!NOTE]
> For more information what Ably is and concepts you need, please see the official [Ably documentation](https://ably.com/docs/). The official docs also include a more complete [React Hooks quickstart guide](https://ably.com/docs/getting-started/react).

---

<!-- @import "[TOC]" {cmd="toc" depthFrom=2 depthTo=6 orderedList=false} -->
<!-- code_chunk_output -->

- [Compatible React Versions](#compatible-react-versions)
- [Usage](#usage)
  - [useChannel](#usechannel)
  - [usePresence](#usepresence)
  - [usePresenceListener](#usepresencelistener)
  - [useObject](#useobject)

## <!-- /code_chunk_output -->

### Compatible React Versions

The hooks are compatible with all versions of React above 16.8.0, with the exception of `useObject`, which requires React 18 or later.

## Usage

Start by connecting your app to Ably using the `AblyProvider` component. See the [`ClientOptions` documentation](https://ably.com/docs/api/realtime-sdk/types?lang=javascript) for information about what options are available when creating an Ably client. If you want to use the `usePresence` or `usePresenceListener` hooks, you'll need to explicitly provide a `clientId`.

The `AblyProvider` should be high in your component tree, wrapping every component which needs to access Ably.
Also, ensure that the `Ably.Realtime` instance is created outside of components to prevent it from being recreated on component re-renders. This will help avoid opening extra unnecessary connections to the Ably servers and potentially reaching the maximum connections limit on your account.

```jsx
import { AblyProvider } from 'ably/react';
import * as Ably from 'ably';

const client = new Ably.Realtime({ key: 'your-ably-api-key', clientId: 'me' });

root.render(
  <AblyProvider client={client}>
    <App />
  </AblyProvider>,
);
```

However, exposing API key in the client app isn't the best practice. Alternatively, you can use the auth callback to provide the token needed to establish the connection. 
```tsx
import { AblyProvider } from 'ably/react';
import * as Ably from 'ably';

const BACKEND_URL = "YOUR_BACKEND_URL"

const client = new Ably.Realtime({
  authCallback: async (_, callback) => {
    let token: Ably.TokenDetails | null = null;

    try {
      const response = await fetch(BACKEND_URL, {
        method: "POST",
      });
      if (!response.ok) {
        throw new Error(`Token fetch failed: ${response.statusText}`);
      }
      token = await response.json(); // adjust according to your backend data structure
    } catch (e) {
      callback(e instanceof Error ? e.message : "Unknown error occurred", null);
      return;
    }

    callback(null, token);
  }
});

root.render(
  <AblyProvider client={client}>
    <App />
  </AblyProvider>,
);
```

More about token generation, please refer to this [documentation](https://ably.com/docs/auth/token?lang=javascript#ably-token).

### Define Ably channels

Once you've set up `AblyProvider`, define Ably channels you want to use by utilizing the `ChannelProvider` component:

```jsx
<ChannelProvider channelName="your-channel-name">
  <Component />
</ChannelProvider>
```

After setting up `ChannelProvider`, you can employ the provided `hooks` in your code. Here's a basic example:

```javascript
const { channel } = useChannel('your-channel-name', (message) => {
  console.log(message);
});
```

Every time a message is sent to `your-channel-name` it'll be logged to the console. You can do whatever you need to with those messages.

#### Omitting the channel name

When a channel-based hook (`useChannel`, `usePresence`, `usePresenceListener`, `useChannelStateListener`) is called without a channel name, it resolves to the channel of the closest enclosing `ChannelProvider`. This avoids repeating the name when there is a surrounding provider:

```jsx
<ChannelProvider channelName="your-channel-name">
  <Component />
</ChannelProvider>;

// Inside Component — no channel name needed:
const { channel } = useChannel((message) => {
  console.log(message);
});
```

When providers are nested, the nearest one wins. You can still pass an explicit channel name to target a specific enclosing provider by name:

```jsx
<ChannelProvider channelName="outer">
  <ChannelProvider channelName="inner">
    {/* useChannel(...) resolves to "inner"; useChannel("outer", ...) resolves to "outer" */}
  </ChannelProvider>
</ChannelProvider>
```

> [!NOTE]
> Channel resolution is scoped by `ablyId`. A hook called without an `ablyId` uses the `default` one, so it only resolves to a `ChannelProvider` that also uses the `default` `ablyId`. If your `ChannelProvider` uses a non-default `ablyId`, you must pass it to the hook for the channel to be inferred, for example `useChannel({ ablyId: 'your-ably-id' })`.

<!-- -->

> [!NOTE]
> Our react hooks are designed to run on the client-side, so if you are using server-side rendering, make sure that your components which use Ably react hooks are only rendered on the client side.

### Channel Options

We support providing [ChannelOptions](https://ably.com/docs/api/realtime-sdk/types#channel-options) for the `ChannelProvider` component:

This means you can use features like `rewind`:

```jsx
<ChannelProvider channelName="your-channel-name" options={{ params: { rewind: '1' } }}>
  <Component />
</ChannelProvider>
```

[Subscription filters](https://ably.com/docs/channels#filter-subscribe) are also supported:

```jsx
const deriveOptions = { filter: 'headers.email == `"rob.pike@domain.com"` || headers.company == `"domain"`' }

return (
  <ChannelProvider channelName="your-derived-channel-name" options={{ ... }} deriveOptions={deriveOptions}>
    <Component />
  </ChannelProvider>
)
```

> [!NOTE]
> Please note that attempts to publish to a derived channel (the one created or retrieved with a filter expression)
> using channel instance will fail, since derived channels support only `subscribe` capability.
> Use `publish` function returned by `useChannel` hook instead.

---

### useChannel

The useChannel hook lets you subscribe to an [Ably Channel](https://ably.com/docs/channels) and receive messages from it.

```javascript
const { channel, ably } = useChannel('your-channel-name', (message) => {
  console.log(message);
});
```

**Both the channel instance, and the Ably JavaScript SDK instance are returned from the useChannel call.**

`useChannel` really shines when combined with a regular react `useState` hook - for example, you could keep a list of messages in your app state, and use the `useChannel` hook to subscribe to a channel, and update the state when new messages arrive.

```javascript
const [messages, updateMessages] = useState([]);
const { channel } = useChannel('your-channel-name', (message) => {
  updateMessages((prev) => [...prev, message]);
});

// Convert the messages to list items to render in a react component
const messagePreviews = messages.map((msg, index) => <li key={index}>{msg.data.someProperty}</li>);
```

`useChannel` supports all of the parameter combinations of a regular call to `channel.subscribe`, so you can filter the messages you subscribe to by providing a `message type` to the `useChannel` function:

```javascript
useChannel('your-channel-name', 'test-message', (message) => {
  console.log(message); // Only logs messages sent using the `test-message` message type
});
```

#### useChannel `publish` function

The `publish` function returned by `useChannel` can be used to send messages to the channel.

```javascript
const { publish } = useChannel('your-channel-name');
publish('test-message', { text: 'message text' });
```

#### useChannel `channel` instance

The `useChannel` hook returns an instance of the channel, which is part of the Ably JavaScript SDK. This allows you to access the standard Ably JavaScript SDK functionalities associated with channels.

By providing both the channel instance and the Ably SDK instance through our useChannel hook, you gain the flexibility to execute various operations on the channel.

For instance, you can easily fetch the history of the channel using the following method:

```javascript
const { channel } = useChannel('your-channel-name', (message) => {
  console.log(message);
});

const history = channel.history((err, result) => {
  var lastMessage = resultPage.items[0];
  console.log('Last message: ' + lastMessage.id + ' - ' + lastMessage.data);
});
```

---

### usePresence

The usePresence hook [enters the presence set on a channel](https://ably.com/docs/presence-occupancy/presence) and enables you to send presence updates for current client. To find out more about Presence, see the [Presence documentation](https://ably.com/docs/presence-occupancy/presence).

```javascript
const { updateStatus } = usePresence('your-channel-name');

// The `updateStatus` function can be used to update the presence data for the current client
updateStatus('status');
```

You can optionally provide a second parameter when you `usePresence` to set an initial `presence data`.

```javascript
const { updateStatus } = usePresence('your-channel-name', 'initial state');

// The `updateStatus` function can be used to update the presence data for the current client
updateStatus('new status');
```

The new state will be sent to the channel, and all clients subscribed to the channel (including current, if you've subscribed to updates using [`usePresenceListener` hook](#usepresencelistener)) will be notified of the change immediately.

`usePresence` supports objects and numbers, as well as strings:

```javascript
usePresence('your-channel-name', { foo: 'bar' });
usePresence('another-channel-name', 123);
usePresence('third-channel-name', 'initial status');
```

> [!NOTE]
> Unlike the other channel-based hooks, `usePresence` cannot infer the channel from the nearest `ChannelProvider` when you call it with presence data only. Because the presence data can itself be a string or object, it is indistinguishable from a channel name or options object, so `usePresence(presenceData)` would be treated as a channel name. To infer the channel while still passing presence data, pass `undefined` as the first argument:
>
> ```javascript
> usePresence(undefined, { foo: 'bar' });
> ```

If you're using `TypeScript` there are type hints to make sure that value passed to `updateStatus` is of the same `type` as your initial constraint, or a provided generic type parameter:

```tsx
const TypedUsePresenceComponent = () => {
  // In this example MyPresenceType will be used for type checking updateStatus function.
  // If omitted, the shape of the initial value will be used, and if that's omitted, `any` will be the default.

  const { updateStatus } = usePresence<MyPresenceType>('testChannelName', { foo: 'bar' });

  return (
    <button
      onClick={() => {
        {
          /* you will have Intellisense for updateStatus function here */
        }
        updateStatus({ foo: 'baz' });
      }}
    >
      Update presence data
    </button>
  );
};

interface MyPresenceType {
  foo: string;
}
```

---

### usePresenceListener

The usePresenceListener hook [subscribes you to presence 'enter', 'update' and 'leave' events on a channel](https://ably.com/docs/presence-occupancy/presence?lang=javascript#subscribe) - this will allow you to get notified when a user joins or leaves the channel, or updates its presence data. To find out more about Presence, see the [Presence documentation](https://ably.com/docs/presence-occupancy/presence).

**Please note** that fetching present members is executed as an effect, so it'll load in _after_ your component renders for the first time.

```javascript
const { presenceData } = usePresenceListener('your-channel-name');

// Convert presence data to the list of items to render
const membersData = presenceData.map((msg, index) => (
  <li key={index}>
    {msg.clientId}: {msg.data}
  </li>
));
```

The `usePresenceListener` hook returns an array of presence messages - each message is a regular Ably JavaScript SDK `PresenceMessage` instance.

If you don't want to use the `presenceData` returned from `usePresenceListener`, you can configure a callback:

```javascript
usePresenceListener('your-channel-name', (presenceUpdate) => {
  console.log(presenceUpdate);
});
```

If you're using `TypeScript` there are type hints to make sure that presence data received are of the same `type` as a provided generic type parameter:

```tsx
const TypedUsePresenceListenerComponent = () => {
  // In this example MyPresenceType will be used for presenceData type hints.
  // If that's omitted, `any` will be the default.

  const { presenceData } = usePresenceListener<MyPresenceType>('testChannelName');

  const membersData = presenceData.map((presenceMsg, index) => {
    return (
      <li key={index}>
        {/* you will have Intellisense for presenceMsg.data of type MyPresenceType here */}
        {presenceMsg.clientId} - {presenceMsg.data.foo}
      </li>
    );
  });

  return <ul>{membersData}</ul>;
};

interface MyPresenceType {
  foo: string;
}
```

`presenceData` is a good way to store synchronised, per-client metadata, so types here are especially valuable.

### useObject

The `useObject` hook subscribes to the [LiveObjects](https://ably.com/docs/liveobjects) state on a channel and re-renders your component when it changes. It is exported from its own entry point, `ably/liveobjects/react`, so apps that don't use LiveObjects don't need to import any of its code:

```javascript
import { useObject } from 'ably/liveobjects/react';
```

Using the hook requires:

- the `LiveObjects` plugin passed to the Ably client (see the [LiveObjects documentation](https://ably.com/docs/liveobjects/quickstart/javascript)),
- the `OBJECT_SUBSCRIBE` channel mode (plus `OBJECT_PUBLISH` if you write to objects), set via `ChannelProvider`'s channel options,
- React 18 or later (the hook is built on `useSyncExternalStore`).

```jsx
<ChannelProvider channelName="your-channel-name" options={{ modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] }}>
  <Component />
</ChannelProvider>
```

Called with no arguments, `useObject` subscribes to the channel's object. `value` is a plain-data snapshot of the object (the result of [`compact()`](https://ably.com/docs/liveobjects/concepts/objects#compact)), and `object` is the live `PathObject` for the subscribed node, which you can use to navigate and to write:

```jsx
const Scoreboard = () => {
  const { value, object } = useObject();

  if (!object) return <p>Loading…</p>;

  return <button onClick={() => object.get('scores').get('alice').increment(1)}>Alice: {value.scores.alice}</button>;
};
```

Pass a selector to subscribe to a nested node instead. The selector receives the channel's object as a `PathObject` and must navigate to a descendant using `get`/`at`; the hook subscribes to the node it returns, so the component only re-renders for changes within that node. Navigating to the narrowest node you actually render is the main performance lever:

```jsx
const AliceScore = () => {
  const { value, object } = useObject((obj) => obj.get('scores').get('alice'));

  return <button onClick={() => object?.increment(1)}>Alice: {value ?? 0}</button>;
};
```

If you're using TypeScript, annotate the selector's parameter with the shape of your channel's object and the whole navigation chain is checked at compile time — `value` and `object` are then typed from the chain with no further annotation:

```tsx
import { LiveCounter, LiveMap, PathObject } from 'ably/liveobjects';

type Game = {
  scores: LiveMap<{ alice: LiveCounter; bob: LiveCounter }>;
  title: string;
};

const AliceScore = () => {
  // value: number | undefined, object: PathObject<LiveCounter> | undefined
  const { value, object } = useObject((obj: PathObject<LiveMap<Game>>) => obj.get('scores').get('alice'));

  return <button onClick={() => object?.increment(1)}>Alice: {value ?? 0}</button>;
};
```

For the no-selector form, provide the shape of the channel's object as a type parameter instead — `useObject<Game>()` — the same type parameter that `channel.object.get<Game>()` takes.

If the object cannot be resolved — for example the `LiveObjects` plugin is missing from the client, or the channel lacks the object modes — the hook reports this through the `error` return value, which carries ably-js's own `ErrorInfo` describing the failure:

```jsx
const Scoreboard = () => {
  const { value, object, error } = useObject();

  if (error) return <p>Objects failed to load: {error.message}</p>;
  if (!object) return <p>Loading…</p>;

  return <p>Alice: {value.scores.alice}</p>;
};
```

The channel's object resolves asynchronously (after the channel attaches and the initial sync completes), so the hook's readiness is derived from the result: `object === undefined && error === null` means loading, `error !== null` means the object could not be resolved, and a defined `object` means ready, with `value` carrying the data once the node exists.

Two things to note about `value`:

- It is a cached snapshot: its identity only changes when the subscribed node changes, so it is safe to use in dependency arrays.
- It is a by-value copy: the same logical node reached through two different hooks is not reference-equal. Compare fields rather than snapshots, and use `object` when you need a stable identity.

Like the other channel hooks, `useObject` accepts the standard options (`channelName`, `ablyId`, `skip`, `onConnectionError`, `onChannelError`) and returns `connectionError` / `channelError`:

```javascript
const { value, error, connectionError, channelError } = useObject((obj) => obj.get('scores'), {
  channelName: 'your-channel-name',
});
```

### useConnectionStateListener

The `useConnectionStateListener` hook lets you attach a listener to be notified of [connection state changes](https://ably.com/docs/connect/states?lang=javascript). This can be useful for detecting when the client has lost connection.

```javascript
useConnectionStateListener((stateChange) => {
  console.log(stateChange.current); // the new connection state
  console.log(stateChange.previous); // the previous connection state
  console.log(stateChange.reason); // if applicable, an error indicating the reason for the connection state change
});
```

You can also pass in a filter to only listen to a set of connection states:

```javascript
useConnectionStateListener('failed', listener); // the listener only gets called when the connection state becomes failed
useConnectionStateListener(['failed', 'suspended'], listener); // the listener only gets called when the connection state becomes failed or suspended
```

### useChannelStateListener

The `useChannelStateListener` hook lets you attach a listener to be notified of [channel state changes](https://ably.com/docs/channels?lang=javascript#states). This can be useful for detecting when a channel error has occured.

```javascript
useChannelStateListener((stateChange) => {
  console.log(stateChange.current); // the new channel state
  console.log(stateChange.previous); // the previous channel state
  console.log(stateChange.reason); // if applicable, an error indicating the reason for the channel state change
});
```

You can also pass in a filter to only listen to a set of channel states:

```javascript
useChannelStateListener('failed', listener); // the listener only gets called when the channel state becomes failed
useChannelStateListener(['failed', 'suspended'], listener); // the listener only gets called when the channel state becomes failed or suspended
```

### useAbly

The `useAbly` hook lets you access the Ably client used by the `AblyProvider` context. This can be useful if you need to access ably-js APIs which aren't available through our react-hooks library.

```javascript
const client = useAbly();

client.authorize();
```

### Error Handling

When using the Ably react hooks, your Ably client may encounter a variety of errors, for example if it doesn't have permissions to attach to a channel it may encounter a channel error, or if it loses connection from the Ably network it may encounter a connection error.

To allow you to handle these errors, the `useChannel`, `usePresence` and `usePresenceListener` hooks return connection and channel errors so that you can react to them in your components:

```jsx
const { connectionError, channelError } = useChannel('my_channel', messageHandler);

if (connectionError) {
  // TODO: handle connection errors
} else if (channelError) {
  // TODO: handle channel errors
} else {
  return <AblyChannelComponent />;
}
```

Alternatively, you can also pass callbacks to the hooks to be called when the client encounters an error:

```js
useChannel(
  {
    channelName: 'my_channel',
    onConnectionError: (err) => {
      /* handle connection error */
    },
    onChannelError: (err) => {
      /* handle channel error */
    },
  },
  messageHandler,
);
```

### Usage with multiple clients

If you need to use multiple Ably clients on the same page, the easiest way to do so is to keep your clients in separate `AblyProvider` components. However, if you need to nest `AblyProvider`s, you can pass a string `ablyId` for each client as a prop to the provider.

```jsx
root.render(
  <AblyProvider client={client1} ablyId={'providerOne'}>
    <AblyProvider client={client2} ablyId={'providerTwo'}>
      <App />
    </AblyProvider>
  </AblyProvider>,
);
```

This `ablyId` can then be passed in to each hook to specify which client to use.

```javascript
const ablyId = 'providerOne';

const client = useAbly(ablyId);

useChannel({ channelName: 'your-channel-name', ablyId }, (message) => {
  console.log(message);
});

usePresence({ channelName: 'your-channel-name', ablyId }, 'initial state');

usePresenceListener({ channelName: 'your-channel-name', ablyId }, (presenceUpdate) => {
  // ...
});
```

### Skip attaching to a channel using `skip` parameter

By default, `usePresenceEnter` and `usePresenceListener` automatically attach to a channel upon component mount, and `useChannel` does so if a callback for receiving messages is provided. This means that these hooks will attempt to establish a connection to the Ably server using the credentials currently set in the corresponding `Ably.RealtimeClient` from `AblyProvider`. However, there may be scenarios where your user authentication is asynchronous or when certain parts of your application are conditionally accessible (e.g., premium features). In these instances, you might not have a valid auth token yet, and an attempt to attach to a channel would result in an error.

To address this, the `skip` parameter allows you to control the mounting behavior of the `useChannel`, `usePresenceEnter`, and `usePresenceListener` hooks, specifically determining whether they should attach to a channel upon the component's mount.

```tsx
const [skip, setSkip] = useState(true);

const { channel, publish } = useChannel({ channelName: 'your-channel-name', skip }, (message) => {
  updateMessages((prev) => [...prev, message]);
});
```

By setting the `skip` parameter, you can prevent the hooks from attempting to attach to a channel, thereby avoiding errors and avoiding unnecessary messages being send (which reduces your messages consumption in your Ably app).

The `skip` parameter accepts a boolean value. When set to `true`, it instructs the hooks not to attach to the channel upon the component's mount. This behavior is dynamically responsive; meaning that, once the conditions change (e.g., the user gets authenticated), updating the `skip` parameter to `false` will trigger the hooks to attach to the channel.

This parameter is useful in next situations:

**Asynchronous Authentication**: Users are not immediately authorized upon loading the component, and acquiring a valid auth token is asynchronous.

Consider a scenario where a component uses the `useChannel` hook, but the user's authentication status is determined asynchronously:

```tsx
import React, { useEffect, useState } from 'react';
import { useChannel } from 'ably/react';
import * as Ably from 'ably';

const ChatComponent = () => {
  const [isUserAuthenticated, setIsUserAuthenticated] = useState(false);
  const [messages, updateMessages] = useState<Ably.Message[]>([]);

  // Simulate asynchronous authentication
  useEffect(() => {
    async function authenticate() {
      const isAuthenticated = await someAuthenticationFunction();
      setIsUserAuthenticated(isAuthenticated);
    }
    authenticate();
  }, []);

  // useChannel with skip parameter
  useChannel({ channelName: 'your-channel-name', skip: !isUserAuthenticated }, (message) => {
    updateMessages((prev) => [...prev, message]);
  });

  if (!isUserAuthenticated) {
    return <p>Please log in to join the chat.</p>;
  }

  return (
    <div>
      {messages.map((message, index) => (
        <p key={index}>{message.data.text}</p>
      ))}
    </div>
  );
};
```

**Conditional Feature Access**: Certain features or parts of your application are behind a paywall or require specific user privileges that not all users possess.

In an application with both free and premium features, you might want to conditionally use channels based on the user's subscription status:

```tsx
import React from 'react';
import { useChannel } from 'ably/react';
import * as Ably from 'ably';

interface PremiumFeatureComponentProps {
  isPremiumUser: boolean;
}

const PremiumFeatureComponent = ({ isPremiumUser }: PremiumFeatureComponentProps) => {
  const [messages, updateMessages] = useState<Ably.Message[]>([]);

  // Skip attaching to the channel if the user is not a premium subscriber
  useChannel({ channelName: 'premium-feature-channel', skip: !isPremiumUser }, (message) => {
    updateMessages((prev) => [...prev, message]);
  });

  if (!isPremiumUser) {
    return <p>This feature is available for premium users only.</p>;
  }

  return <div>{/* Render premium feature based on messages */}</div>;
};
```

## NextJS warnings

Currently, when using our react library with NextJS you may encounter some warnings which arise due to some static checks against subdependencies of the library.
While these warnings won't affect the performance of the library and are safe to ignore, we understand that they are an annoyance and offer the following advice to prevent them from displaying:

### Critical dependency: the request of a dependency is an expression

This warning comes from keyv which is a subdependency of our NodeJS http client.
You can read more about the reason this warning is displayed at [jaredwray/keyv#45](https://github.com/jaredwray/keyv/issues/45).

You can avoid this warning by overriding the version of keyv used by adding the following to your package.json:

```json
"overrides": {
  "cacheable-request": {
    "keyv": "npm:@keyvhq/core@~1.6.6"
  }
}
```

### Module not found: Can't resolve 'bufferutil'/'utf-8-validate'

These warnings come from devDependencies which are conditionally loaded in the ws module (our NodeJS websocket client).
They aren't required for the websocket client to work, however NextJS will statically analyse imports and incorrectly assume that these are needed.

You can avoid this warning by adding the following to your next.config.js:

```javascript
module.exports = {
  webpack: (config) => {
    config.externals.push({
      'utf-8-validate': 'commonjs utf-8-validate',
      bufferutil: 'commonjs bufferutil',
    });
    return config;
  },
};
```
