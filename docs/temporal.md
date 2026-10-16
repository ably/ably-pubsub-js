# ably-js Temporal plugin

Call the Ably REST API from [Temporal](https://temporal.io/) workflow code with an API that mirrors the Ably REST client.

Temporal workflow code must be deterministic, so any I/O, including a request to Ably, has to run in an activity. The Temporal plugin does this for you: each Ably call you make from workflow code runs as a Temporal activity on your worker, which makes the request with a real Ably REST client. You keep the familiar `channels.get(...).publish(...)` API, and Temporal records, retries and replays each call like any other activity.

The plugin ships in the `ably` package as two entry points:

- `@ably/pubsub-server/temporal` is the worker entry point. It provides `AblyRestPlugin`, which registers the Ably activities on a Temporal worker.
- `@ably/pubsub-server/temporal/workflow` is the workflow entry point. It provides `TemporalAblyRest`, the client you use in workflow code.

> [!NOTE]
> For more information about Ably and the concepts used here, see the official [Ably documentation](https://ably.com/docs/). For Temporal concepts such as workflows, activities, retry policies and plugins, see the [Temporal TypeScript SDK documentation](https://docs.temporal.io/develop/typescript).

---

<!-- @import "[TOC]" {cmd="toc" depthFrom=2 depthTo=6 orderedList=false} -->
<!-- code_chunk_output -->

- [When to use it](#when-to-use-it)
- [Requirements](#requirements)
- [Installation](#installation)
- [Worker setup](#worker-setup)
  - [Channel options](#channel-options)
  - [Using an existing client](#using-an-existing-client)
  - [Using LiveObjects](#using-liveobjects)
  - [Using other Temporal plugins](#using-other-temporal-plugins)
- [Workflow usage](#workflow-usage)
  - [Options](#options)
  - [Activity summaries](#activity-summaries)
- [Supported API](#supported-api)
  - [Not supported](#not-supported)
- [Retries and idempotency](#retries-and-idempotency)
  - [Calls are deduplicated](#calls-are-deduplicated)
  - [Keeping retries within the deduplication window](#keeping-retries-within-the-deduplication-window)
  - [Appends are not deduplicated](#appends-are-not-deduplicated)
  - [Retried LiveObjects operations](#retried-liveobjects-operations)
  - [Push notifications](#push-notifications)
  - [Turning off idempotent publishing](#turning-off-idempotent-publishing)
- [Temporal metadata](#temporal-metadata)
  - [Reading the metadata in a subscriber](#reading-the-metadata-in-a-subscriber)
- [Errors](#errors)
  - [Errors from Ably](#errors-from-ably)
  - [Which errors are retried](#which-errors-are-retried)
  - [Errors raised in workflow code](#errors-raised-in-workflow-code)
- [Binary data and results](#binary-data-and-results)
- [Pagination](#pagination)
- [Registering the activities without the plugin](#registering-the-activities-without-the-plugin)
- [Exports](#exports)

## <!-- /code_chunk_output -->

## When to use it

Use the plugin for the non-streamed content that an agent workflow delivers to its users, such as:

- Status updates, for example `thinking`, `searching` or `complete`.
- The final reply, once a model call has returned it in full.
- Presence checks, for example to find out whether the user is still online before notifying them.
- Reading and updating [LiveObjects](https://ably.com/docs/liveobjects) state on a channel.

The plugin is not designed for token streaming. Each call is a separate activity, which adds latency and a workflow history event per call. To stream tokens as a model produces them, publish from inside your own activity, for example with an Ably Realtime client, in the same activity that makes the model call.

## Requirements

- **Node.js 20.3 or later.** This is the minimum supported by the `@temporalio` packages. The rest of the `ably` package supports earlier Node.js versions; see `engines` in [package.json](../package.json).
- **`@temporalio/*` 1.18.0 or later.** By default, the workflow derives message IDs from a named random stream (`getRandomStream`), which was added to `@temporalio/workflow` in 1.18.0. See [Retries and idempotency](#retries-and-idempotency).
  - On an earlier version, the first workflow task that publishes fails with a `TypeError` that names the required version. The workflow resumes once the worker is redeployed with 1.18.0 or later.
  - The workflow only uses named random streams for idempotent publishing, so with [`idempotentPublishing: false`](#turning-off-idempotent-publishing) it does not throw this error on earlier versions. 1.18.0 remains the supported minimum.
  - The worker entry point also requires `@temporalio/plugin`, which was first released in 1.13.2. Without it, `@ably/pubsub-server/temporal` fails to load with Node.js's module-not-found error.

## Installation

The Temporal packages are optional peer dependencies of `ably`, so npm does not install them for you. Install them alongside `ably`, all at the same version as each other:

```sh
npm install ably @temporalio/worker @temporalio/workflow @temporalio/activity @temporalio/common @temporalio/plugin
```

You also need `@temporalio/client` in the application that starts your workflows.

Import `@ably/pubsub-server/temporal` only in worker code, and `@ably/pubsub-server/temporal/workflow` only in workflow code. The worker entry point loads the Ably client and worker-only Temporal packages, which cannot be bundled into a workflow. Type-only imports from `ably` and `@ably/pubsub-server/liveobjects`, such as `import type { InboundMessage } from 'ably'`, are fine in workflow code.

## Worker setup

Add `AblyRestPlugin` to the `plugins` of your worker. Pass `ably` with the `ClientOptions` for the plugin to construct an `Ably.PubSubHttpClient` client:

```typescript
// worker.ts
import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import { AblyRestPlugin } from '@ably/pubsub-server/temporal';

const connection = await NativeConnection.connect({ address: 'localhost:7233' });

const worker = await Worker.create({
  connection,
  namespace: 'default',
  taskQueue: 'agents',
  workflowsPath: fileURLToPath(new URL('./workflows.ts', import.meta.url)),
  plugins: [new AblyRestPlugin({ ably: { key: process.env.ABLY_API_KEY } })],
});

await worker.run();
```

The plugin registers one activity per Ably operation. Every activity name starts with `ably.`, so they cannot collide with your own activities. All workflows on the worker share the plugin's client, and the client's credentials stay on the worker: workflow code never sees them.

`AblyRestPlugin` takes these options:

| Option             | Description                                                                                                                              |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `ably`             | The `ClientOptions` with which the plugin constructs its `Ably.PubSubHttpClient` client.                                                 |
| `client`           | An existing `Ably.PubSubHttpClient` client for the plugin to use instead.                                                                |
| `temporalMetadata` | Whether to record the Temporal execution that performed each operation. Defaults to `true`. See [Temporal metadata](#temporal-metadata). |
| `channelOptions`   | A function that returns the `ChannelOptions` for a channel name, or `undefined`. See [Channel options](#channel-options).                |

Provide exactly one of `ably` and `client`. The constructor throws an `Error` if you pass both or neither.

The activities get each channel from the client when they need it, and release it once no activity on the worker is using it, so the client does not keep a channel for every name the worker has ever used. A channel that your own code got from the client is never released.

### Channel options

Channel options, such as a `cipher`, are configured on the worker rather than in workflow code. Pass `channelOptions`, which the activities call with the name of each channel they get from the client:

```typescript
const plugin = new AblyRestPlugin({
  ably: { key: process.env.ABLY_API_KEY },
  channelOptions: (name) => (name.startsWith('secure:') ? { cipher: { key: process.env.CHANNEL_KEY } } : undefined),
});
```

Every operation on the channel uses the same options, so two workflows cannot set conflicting options on one channel. The cipher key stays on the worker, out of the workflow history, which records activity inputs in plain text unless you have configured a payload codec. A channel that your own code got from the client keeps the options your code gave it.

### Using an existing client

Pass `client` to share a client with the rest of your worker, for example one that your own activities also use:

```typescript
import { createHttpClient } from '@ably/pubsub-server';
import { AblyRestPlugin } from '@ably/pubsub-server/temporal';

const ably = createHttpClient({ key: process.env.ABLY_API_KEY });
const plugin = new AblyRestPlugin({ client: ably });
```

The plugin's client is available as `plugin.client`, whichever option you used.

### Using LiveObjects

`channel.object` needs the worker's client to have the LiveObjects plugin from `@ably/pubsub-server/liveobjects`. Add it to the client options:

```typescript
import { LiveObjects } from '@ably/pubsub-server/liveobjects';
import { AblyRestPlugin } from '@ably/pubsub-server/temporal';

const plugin = new AblyRestPlugin({
  ably: { key: process.env.ABLY_API_KEY, plugins: { LiveObjects } },
});
```

Without it, the `ably.channel.object.*` activities fail with a non-retryable Ably error, code 40019.

### Using other Temporal plugins

`AblyRestPlugin` is a standard Temporal worker plugin, so it can be combined with others, such as `AiSdkPlugin` from [`@temporalio/ai-sdk`](https://www.npmjs.com/package/@temporalio/ai-sdk), which runs Vercel AI SDK model calls as activities:

```typescript
// worker.ts
import { fileURLToPath } from 'node:url';
import { NativeConnection, Worker } from '@temporalio/worker';
import { AiSdkPlugin } from '@temporalio/ai-sdk';
import { gateway } from 'ai';
import { AblyRestPlugin } from '@ably/pubsub-server/temporal';

const connection = await NativeConnection.connect({ address: 'localhost:7233' });

const worker = await Worker.create({
  connection,
  namespace: 'default',
  taskQueue: 'agents',
  workflowsPath: fileURLToPath(new URL('./workflows/agent.ts', import.meta.url)),
  plugins: [
    // Runs model calls as activities. Uses AI_GATEWAY_API_KEY from the worker environment.
    new AiSdkPlugin({ modelProvider: gateway }),
    // Runs Ably REST calls as activities.
    new AblyRestPlugin({ ably: { key: process.env.ABLY_API_KEY } }),
  ],
});

await worker.run();
```

## Workflow usage

In workflow code, construct a `TemporalAblyRest` and use it as you would an Ably REST client. Constructing it does not run an activity, so you can create it at module scope:

```typescript
// workflows/agent.ts
import { workflowInfo } from '@temporalio/workflow';
import { TemporalProvider } from '@temporalio/ai-sdk/workflow';
import { generateText, type ModelMessage } from 'ai';
import { TemporalAblyRest } from '@ably/pubsub-server/temporal/workflow';

const ably = new TemporalAblyRest();

const provider = new TemporalProvider({
  languageModel: { startToCloseTimeout: '2 minutes' },
});

export async function agentWorkflow(input: { messages: ModelMessage[] }): Promise<{ text: string }> {
  const channel = ably.channels.get(`chat:${workflowInfo().workflowId}`);

  // Runs as an Ably activity.
  await channel.publish('agent.status', { status: 'thinking' });

  // Runs as an AI SDK activity.
  const { text } = await generateText({
    model: provider.languageModel('anthropic/claude-sonnet-4.5'),
    messages: input.messages,
  });

  // Each publish runs as another Ably activity.
  await channel.publish('agent.reply', { role: 'assistant', text });
  await channel.publish('agent.status', { status: 'complete' });

  return { text };
}
```

Each method resolves with the result of the matching Ably REST method, once its activity has completed. For example, `publish()` resolves with the message serials, and `presence.get()` resolves with a page of presence members:

```typescript
const members = await channel.presence.get({ clientId: userId });
const userIsOnline = members.items.length > 0;
```

### Options

`TemporalAblyRest` takes these options:

| Option                 | Default                                                                  | Description                                                                                                                                                                                 |
| ---------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activityOptions`      | `startToCloseTimeout` of 30 seconds, and Temporal's default retry policy | The `ActivityOptions` for the Ably activities. They are applied on top of the defaults.                                                                                                     |
| `localActivityOptions` | Not set                                                                  | When set, Ably operations run as local activities with these `LocalActivityOptions`, applied on top of a default `startToCloseTimeout` of 30 seconds. Cannot be set with `activityOptions`. |
| `idempotentPublishing` | `true`                                                                   | Whether the workflow derives idempotency keys for calls that have none, so that Ably deduplicates a retried call. See [Retries and idempotency](#retries-and-idempotency).                  |

Temporal's default retry policy retries a failed activity indefinitely, with an exponential backoff that starts at 1 second and is capped at 100 seconds. Ably errors that a retry cannot fix, such as most 4xx errors, are not retried. See [Which errors are retried](#which-errors-are-retried). Ably only deduplicates a retried publish within 2 minutes of the first attempt. See [Keeping retries within the deduplication window](#keeping-retries-within-the-deduplication-window).

The options apply to every call made through a `TemporalAblyRest`. To use different options for different calls, create more than one. For example, best-effort status updates can run as local activities with a few attempts, while the final reply uses durable retries:

```typescript
import { TemporalAblyRest } from '@ably/pubsub-server/temporal/workflow';

// Local activities have lower latency, which suits short calls such as status updates.
const statusAbly = new TemporalAblyRest({
  localActivityOptions: { retry: { maximumAttempts: 3 } },
});

const ably = new TemporalAblyRest({
  activityOptions: { startToCloseTimeout: '10 seconds' },
});
```

Setting both `activityOptions` and `localActivityOptions` throws a `TypeError`. See [Errors raised in workflow code](#errors-raised-in-workflow-code).

### Activity summaries

Each activity has a summary that names the operation, which the Temporal UI shows alongside the activity:

| Call                                                    | Summary                                     |
| ------------------------------------------------------- | ------------------------------------------- |
| A channel method, such as `publish` or `presence.get`   | `publish chat:123`, `presence.get chat:123` |
| `next()`, `first()` or `current()` on a page of results | `history chat:123 (next page)`              |
| `time()`                                                | `time`                                      |
| A push admin method                                     | `push.admin.deviceRegistrations.save`       |
| `request()`                                             | `request POST /path`                        |
| `batchPublish()`, `batchPresence()`                     | `batchPublish (3 channels)`                 |

The summary of `request()` does not include the `params` you pass, so their values do not appear in the UI. To use your own summary, set `summary` in `activityOptions` or `localActivityOptions`. It then applies to every call made through that `TemporalAblyRest`.

## Supported API

`TemporalAblyRest` and the objects it returns mirror the Ably REST client. Each method runs one activity, registered under the name below. The names are exported as `ActivityNames` from `@ably/pubsub-server/temporal`.

| Method                                | Activity name                                                                      |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `TemporalAblyRest.channels.get(name)` | None. Getting a channel does not run an activity.                                  |
| `TemporalAblyRest.time()`             | `ably.time`                                                                        |
| `TemporalAblyRest.request()`          | `ably.request`                                                                     |
| `TemporalAblyRest.batchPublish()`     | `ably.batchPublish`                                                                |
| `TemporalAblyRest.batchPresence()`    | `ably.batchPresence`                                                               |
| `channel.publish()`                   | `ably.channel.publish`                                                             |
| `channel.history()`                   | `ably.channel.history`                                                             |
| `channel.status()`                    | `ably.channel.status`                                                              |
| `channel.getMessage()`                | `ably.channel.getMessage`                                                          |
| `channel.updateMessage()`             | `ably.channel.updateMessage`                                                       |
| `channel.deleteMessage()`             | `ably.channel.deleteMessage`                                                       |
| `channel.appendMessage()`             | `ably.channel.appendMessage`                                                       |
| `channel.getMessageVersions()`        | `ably.channel.getMessageVersions`                                                  |
| `channel.presence.get()`              | `ably.channel.presence.get`                                                        |
| `channel.presence.history()`          | `ably.channel.presence.history`                                                    |
| `channel.annotations.publish()`       | `ably.channel.annotations.publish`                                                 |
| `channel.annotations.delete()`        | `ably.channel.annotations.delete`                                                  |
| `channel.annotations.get()`           | `ably.channel.annotations.get`                                                     |
| `channel.object.get()`                | `ably.channel.object.get`                                                          |
| `channel.object.publish()`            | `ably.channel.object.publish`                                                      |
| `push.admin.<method>()`               | `ably.push.admin.<method>`, for example `ably.push.admin.deviceRegistrations.save` |

`push.admin` has `publish()`, `createApnsBroadcast()`, `liveActivity.start()`, `update()` and `end()`, `deviceRegistrations.save()`, `get()`, `list()`, `remove()` and `removeWhere()`, and `channelSubscriptions.save()`, `list()`, `listChannels()`, `remove()` and `removeWhere()`. It does not need the Push plugin on the worker's client, which is only needed to activate a device.

`request()` reaches any Ably REST endpoint that the plugin does not wrap. An error response from Ably resolves with `success` set to `false`, as it does in the Ably REST client.

### Not supported

- **Channel options in workflow code.** `channels.get()` takes only a channel name, and throws if it is passed options. Configure channel options on the worker instead. See [Channel options](#channel-options).
- **`stats()`.** It is of little use from an agent workflow. Use `request()` if you need it.
- **`auth`.** Authentication is configured on the worker's client. Issue tokens from your application's auth server.
- **`push.activate()` and the other device methods of `push`.** A workflow is not a device. Use `push.admin` to manage devices and publish notifications.
- **`object.generateObjectId()`.** Publish create operations without a pre-generated object ID.

## Retries and idempotency

Temporal retries an activity that fails, and an activity can fail after its request has reached Ably, for example when the response is lost or the worker crashes. The plugin makes the retried call harmless where Ably supports it.

### Calls are deduplicated

When idempotent publishing is enabled, which is the default, the workflow derives an idempotency key for each call from a random stream seeded by the workflow, so the key is the same on every attempt of the activity and on every replay of the workflow. Each call gets a new key. The key is sent in the form that each endpoint deduplicates on:

- `channel.publish()`: each message gets an ID of the form `<base>:<index>`, where the base is the key.
- `batchPublish()`: as for `channel.publish()`. Each spec gets its own base.
- `channel.updateMessage()` and `channel.deleteMessage()`: the key is sent as the `idempotencyKey` option. A retry returns the `versionSerial` of the first attempt, and creates no new version.
- `channel.annotations.publish()` and `channel.annotations.delete()`: the annotation gets an ID of the form `<base>:0`.
- `channel.object.publish()`: each operation gets an ID, so a retried `counterInc` is not applied twice. A call is published without IDs if any of its operations is a `mapCreate` or `counterCreate`, or has a `path` with a wildcard, such as `scores.*`. See [Retried LiveObjects operations](#retried-liveobjects-operations).

### Keeping retries within the deduplication window

Ably discards a message whose ID or idempotency key it has already seen within about the last 2 minutes, so only a retry that arrives within that window is deduplicated. Temporal's default retry policy keeps retrying for much longer: the waits between attempts alone add up to more than 2 minutes by the eighth attempt. A retry that arrives later is published again. Subscribers can still deduplicate such messages on `message.id`, which is the same on every attempt, but a repeated LiveObjects operation is applied again.

To keep every attempt within the window, set `scheduleToCloseTimeout` in `activityOptions`, and leave room for the last attempt to run for its `startToCloseTimeout`:

```typescript
const ably = new TemporalAblyRest({
  activityOptions: { startToCloseTimeout: '30 seconds', scheduleToCloseTimeout: '90 seconds' },
});
```

Once that time is up, the activity fails with a timeout, and the workflow cannot tell whether the last attempt reached Ably. Check the outcome before publishing again, for example by reading the channel's history or the object.

IDs are only assigned when no message in the call has an `id`. For `batchPublish()` this applies to each spec separately, and for `object.publish()` to the operations. An annotation is only assigned an ID when it has none, and an update or delete is only assigned a key when its options have no `idempotencyKey`. If you set IDs or keys yourself, the call is sent with the ones you set. Ably shares one set of keys across the publishes, updates, deletes and appends on a channel, so a key you set must be unique among them. The objects you pass in are never modified.

### Appends are not deduplicated

A retried `appendMessage` appends its data again, even when the retry has the same `idempotencyKey` as the first attempt, so the message can end up with duplicated content. The plugin therefore sends appends without a key.

If duplicated content is unacceptable, call `updateMessage` with the complete content instead of appending to it. A retried update is deduplicated, and repeating an update leaves the message with the same content.

### Retried LiveObjects operations

`channel.object.publish()` publishes a call without IDs if any of its operations is one of those below, so Ably does not deduplicate a retry of it. If the first attempt reached Ably, the retried activity does the following:

| Operation                                       | Retried activity                                                                                                     |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `mapCreate` or `counterCreate` without a `path` | Creates another object, and returns that object's ID. Nothing refers to the object that the first attempt created.   |
| `mapCreate` or `counterCreate` with a `path`    | Fails with a non-retryable Ably error, code 92007, because the path holds the object that the first attempt created. |
| Any operation whose `path` contains a wildcard  | Applies the operation again. For example, a `counterInc` at `scores.*` increments each matching counter twice.       |

These operations are published without IDs for the following reasons:

- Ably rejects an ID on a create at a `path`, and on a wildcard `path`, with error 40031. It expands such an operation into several object messages.
- When Ably discards a retried create as a duplicate, it responds with the ID of an object that it did not create.

The other operations in the same call are published without IDs too, because Ably needs every operation in a call to have an ID, or none. Publish create operations and wildcard operations in a call of their own, so that your other operations keep their IDs.

If the activity for a create at a `path` fails with code 92007, read the path with `channel.object.get()` to find out whether the object exists. `mapCreateWithObjectId` and `counterCreateWithObjectId` operations do get IDs.

### Push notifications

Ably does not deduplicate the push admin calls that send a notification or create a broadcast channel. They use your retry policy, so if an attempt reached Ably before it failed, the retry repeats the call:

| Call                    | What a retry does                                                                                                                                                                                                                                                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish()`             | Sends the notification again. To let the app drop a duplicate, include an ID in the notification's `data`.                                                                                                                                                                                                                                   |
| `createApnsBroadcast()` | Creates another APNs broadcast channel. Ably has no call to list or delete the channel that the first attempt created, and Apple allows 10,000 per app in each environment.                                                                                                                                                                  |
| `liveActivity.start()`  | Sends the push-to-start notification again, so each device shows a second Live Activity.                                                                                                                                                                                                                                                     |
| `liveActivity.update()` | Sends the update again. If the workflow sets `aps.timestamp` in workflow code, for example to `Math.floor(Date.now() / 1000)`, and the payload has no `alert`, the device shows the same state after a repeated update. A payload with an `alert` alerts again, and a repeated update counts against Apple's budget for priority 10 updates. |

To pass a failure to the workflow instead of retrying it, make these calls from a separate `TemporalAblyRest` with a single attempt:

```typescript
const pushAbly = new TemporalAblyRest({
  activityOptions: { retry: { maximumAttempts: 1 } },
});
```

Within an attempt, the worker's Ably client can still send the request again to a fallback host after a timeout, a connection error or a 500 to 504 response, so a single attempt can still repeat a call. If a call fails with a timeout or a retryable error, it may or may not have reached Ably.

Keep `startToCloseTimeout` longer than a request can take, which is about 25 seconds across fallback hosts with the default client options, so that Temporal does not retry an attempt that is still in progress. The default of 30 seconds allows for this.

`liveActivity.end()` is safe to retry, because Ably accepts a repeated end for a broadcast channel that it has already deleted. A device registration is saved by its device ID, and a channel subscription by its channel and device or client, so a retried save has the same effect as one attempt.

### Turning off idempotent publishing

Set `idempotentPublishing: false` to send every call with the IDs and keys it has, if any:

```typescript
const ably = new TemporalAblyRest({ idempotentPublishing: false });
```

Retried calls are then not deduplicated. A message without an ID gets a new one on each attempt, from the worker's Ably client for `channel.publish()` and from Ably for `batchPublish()` and `object.publish()`. A publish that reached Ably before its activity failed is therefore published again with a different ID, and a retried update or delete creates another version of the message.

## Temporal metadata

The plugin records which Temporal execution published each message, in the message's `extras.headers`:

| Header                 | `TemporalMetadataKeys` | Value                                                   |
| ---------------------- | ---------------------- | ------------------------------------------------------- |
| `temporalNamespace`    | `namespace`            | The Temporal namespace the activity ran in.             |
| `temporalWorkflowId`   | `workflowId`           | The ID of the workflow that scheduled the activity.     |
| `temporalRunId`        | `runId`                | The run ID of the workflow that scheduled the activity. |
| `temporalWorkflowType` | `workflowType`         | The workflow type, such as `agentWorkflow`.             |
| `temporalActivityId`   | `activityId`           | The ID of the activity that published the message.      |
| `temporalAttempt`      | `attempt`              | The attempt number of the activity, starting at 1.      |

The headers are added to every message published with `channel.publish()` and `batchPublish()`. `temporalAttempt` is a number, and the other values are strings. The keys use camelCase so that they can be used in [subscription filters](https://ably.com/docs/channels#filter-subscribe) without quoting.

For `updateMessage`, `deleteMessage` and `appendMessage`, the same keys are added to the operation's `metadata` instead, with every value as a string. The message's own `extras` are left unchanged. Ably records the operation metadata with the new version of the message, in `message.version.metadata`.

Annotations and LiveObjects operations do not carry the metadata.

The headers add about 200 to 250 bytes to each message, and they count towards Ably's maximum message size. The limit applies to all the messages of a publish together, so a publish that is close to the limit, or one that publishes many small messages, can fail with error 40009 because of the headers. Turn the metadata off if your publishes are close to the limit.

Your own values take precedence: if a message already has a header, or an operation already has a metadata entry, with one of these keys, the plugin keeps your value. A message whose `extras` or `extras.headers` is not an object is published unchanged.

To turn the metadata off, set `temporalMetadata: false`:

```typescript
new AblyRestPlugin({ ably: { key: process.env.ABLY_API_KEY }, temporalMetadata: false });
```

### Reading the metadata in a subscriber

A subscriber can use the headers to correlate a message with the workflow and activity in the Temporal UI, for example by logging them, or by building a link to the workflow run from `temporalNamespace`, `temporalWorkflowId` and `temporalRunId`.

They also let a subscriber filter by workflow. For example, to receive only the messages published by `agentWorkflow` workflows with `getDerived()`, which is a preview feature:

```typescript
const channel = realtime.channels.getDerived('chat:123', {
  filter: 'headers.temporalWorkflowType == `"agentWorkflow"`',
});
await channel.subscribe((message) => {
  console.log(message.extras?.headers?.temporalWorkflowId, message.data);
});
```

To deduplicate a retried publish that Ably did not discard, keep track of the IDs you have seen:

```typescript
const seen = new Set<string>();
await channel.subscribe((message) => {
  if (message.action === 'message.create' && message.id) {
    if (seen.has(message.id)) {
      return;
    }
    seen.add(message.id);
  }
  render(message);
});
```

`TemporalMetadataKeys` is exported from `@ably/pubsub-server/temporal` for server-side code that already depends on the Temporal packages. Browser code can use the header names directly.

## Errors

### Errors from Ably

When the worker's Ably client fails with an Ably `ErrorInfo`, the activity fails with a Temporal `ApplicationFailure` of type `AblyError`, whose details hold the fields of the `ErrorInfo`. In workflow code, the call rejects with Temporal's `ActivityFailure`, with that `ApplicationFailure` as its `cause`. A call that runs as a local activity rejects with the `ApplicationFailure` itself.

`getAblyErrorDetails(err)` walks the cause chain and returns the Ably error details, or `undefined` if the error was not caused by an Ably error:

```typescript
import { ActivityFailure, log } from '@temporalio/workflow';
import { getAblyErrorDetails, TemporalAblyRest } from '@ably/pubsub-server/temporal/workflow';

const statusAbly = new TemporalAblyRest({ activityOptions: { retry: { maximumAttempts: 3 } } });

async function publishStatus(channelName: string, status: string): Promise<void> {
  try {
    await statusAbly.channels.get(channelName).publish('agent.status', { status });
  } catch (err) {
    if (!(err instanceof ActivityFailure)) {
      throw err;
    }
    // A failed status update should not fail the workflow.
    const details = getAblyErrorDetails(err);
    log.warn('Status update failed', { code: details?.code, message: details?.message ?? err.message });
  }
}
```

The details have these fields:

| Field         | Description                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `code`        | The Ably error code, or `null` if the error response did not come from Ably, such as a 502 from a proxy.                                                           |
| `statusCode`  | The HTTP status code, if the error has one.                                                                                                                        |
| `message`     | What went wrong.                                                                                                                                                   |
| `href`        | A link to documentation for the error code, if available.                                                                                                          |
| `remediation` | How to fix the error. The Ably SDK sets it only on errors it raises itself, such as an `authUrl` response without a `Content-Type`, so errors from Ably have none. |
| `detail`      | Additional key-value details about the error, if it has any.                                                                                                       |

If you do not catch the error, the workflow fails with it, and `getAblyErrorDetails` also works on the `WorkflowFailedError` that a Temporal client receives from the workflow handle's `result()`. It is exported from both `@ably/pubsub-server/temporal` and `@ably/pubsub-server/temporal/workflow`. Importing `@ably/pubsub-server/temporal/workflow` requires `@temporalio/workflow` to be installed, and `@ably/pubsub-server/temporal` requires `@temporalio/plugin` and `@temporalio/activity`.

### Which errors are retried

An Ably error is retried according to your retry policy only when a retry might succeed:

| Error                                                                | Retried |
| -------------------------------------------------------------------- | ------- |
| HTTP status 500 or above                                             | Yes     |
| HTTP status 408 (timeout) or 429 (rate limit)                        | Yes     |
| No HTTP status                                                       | Yes     |
| Code 40170, a failed `authUrl` or `authCallback`                     | Yes     |
| Any other 4xx, such as an invalid request or insufficient capability | No      |

A failed `authUrl` or `authCallback` is retried because its cause is often a timeout or network error reaching your auth endpoint. If the cause is a misconfiguration instead, such as an auth endpoint that responds with the wrong `Content-Type`, the activity keeps failing until you fix it, unless your retry policy limits the attempts.

Errors that are not Ably errors, such as network errors, are passed to Temporal unchanged and retried according to the retry policy, as are activity timeouts. A non-retryable failure is never retried, whatever the retry policy.

To stop Temporal from retrying any Ably error, add the `AblyError` type to the retry policy's `nonRetryableErrorTypes`. `ABLY_ERROR_TYPE` holds the type:

```typescript
import { ABLY_ERROR_TYPE, TemporalAblyRest } from '@ably/pubsub-server/temporal/workflow';

const ably = new TemporalAblyRest({
  activityOptions: { retry: { nonRetryableErrorTypes: [ABLY_ERROR_TYPE] } },
});
```

### Errors raised in workflow code

Some errors are detected in workflow code, before any activity runs:

- **An invalid argument** throws an `ApplicationFailure` of type `AblyError` with code 40003 and status 400. Examples are a first argument to `publish()` that is not an event name, message or array of messages, a `null` message passed to `updateMessage()`, channel options passed to `channels.get()`, and a `null` device ID passed to `push.admin.deviceRegistrations.get()`. It is thrown as it is, not wrapped in an `ActivityFailure`, and `getAblyErrorDetails` accepts it. If you do not catch it, the workflow fails.
- **Calling `first()` or `current()` on a page without a link to that page** throws an `ApplicationFailure` of type `AblyError` with code 40400 and status 404.
- **Setting both `activityOptions` and `localActivityOptions`** throws a `TypeError` from the `TemporalAblyRest` constructor. This fails the workflow task rather than the workflow, so Temporal retries the task: fix the options and redeploy the worker, and the workflow resumes.
- **Publishing with idempotent publishing enabled on `@temporalio/workflow` earlier than 1.18.0** throws a `TypeError`, which also fails the workflow task. See [Requirements](#requirements).

## Binary data and results

Pass binary data in workflow code as a `Uint8Array`, an `ArrayBuffer` or another typed array, anywhere in the arguments. Temporal serialises activity arguments and results as JSON, so the plugin encodes binary values as base64 on the way into the activity and decodes them on the way out. The worker's Ably client publishes them as binary. Binary values in results, such as the `data` of a binary message in `history()`, are returned to the workflow as `Uint8Array`.

```typescript
await channel.publish('thumbnail', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
```

Results are plain data. For example, the `error` of a failed `batchPublish()` result is a plain object with the fields of an `ErrorInfo`.

Every argument and result is recorded in the workflow's event history, like those of any other activity. Temporal also limits the size of each argument and result, to 2 MB by default. A page of 100 large messages can exceed that, so set a `limit` on `history()` and `presence.get()` when messages may be large.

## Pagination

Paginated methods, such as `history()`, `presence.get()` and `getMessageVersions()`, resolve with a `TemporalAblyPaginatedResult`. It has the same `items`, `hasNext()`, `isLast()`, `next()`, `first()` and `current()` as the Ably `PaginatedResult`. `hasNext()` and `isLast()` run no activity. `next()`, `first()` and `current()` each run the query's activity again, for the related page:

```typescript
import type { InboundMessage } from '@ably/pubsub-server';
import type { TemporalAblyPaginatedResult } from '@ably/pubsub-server/temporal/workflow';

let page: TemporalAblyPaginatedResult<InboundMessage> | null = await channel.history({ limit: 100 });
while (page) {
  for (const message of page.items) {
    // ...
  }
  page = await page.next(); // Resolves with null after the last page.
}
```

`request()` resolves with a `TemporalAblyHttpPaginatedResponse`, which adds `statusCode`, `success`, `errorCode`, `errorMessage`, `errorDetail` and `headers`. Its related pages are fetched with a `GET` request to the same path, with the same API version and headers.

## Registering the activities without the plugin

If you register activities on your worker yourself, `createActivities(client)` returns the Ably activities, keyed by their names in `ActivityNames`. Add them to your worker's `activities`:

```typescript
import { createHttpClient } from '@ably/pubsub-server';
import { Worker } from '@temporalio/worker';
import { createActivities } from '@ably/pubsub-server/temporal';
import * as activities from './activities';

const client = createHttpClient({ key: process.env.ABLY_API_KEY });

const worker = await Worker.create({
  // ...
  activities: { ...activities, ...createActivities(client) },
});
```

`createActivities` takes the same `temporalMetadata` option as the plugin, as its second argument: `createActivities(client, { temporalMetadata: false })`.

Workflow code still calls the activities through `TemporalAblyRest`, which encodes their arguments and results. Their input and result formats are internal to the plugin, so do not call them directly with `proxyActivities`. Use `ActivityNames` to recognise the Ably activities elsewhere, for example in the workflow history or in an interceptor.

## Exports

| Entry point                             | Exports                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@ably/pubsub-server/temporal`          | `AblyRestPlugin`, `AblyRestPluginOptions`, `createActivities`, `CreateActivitiesOptions`, `ActivityNames`, `ActivityName`, `AblyActivities`, `TemporalMetadataKeys`, `TemporalMetadata`, `ABLY_ERROR_TYPE`, `getAblyErrorDetails`, `AblyErrorDetails`                                                                                                                                                                                                                                                       |
| `@ably/pubsub-server/temporal/workflow` | `TemporalAblyRest`, `TemporalAblyRestOptions`, `TemporalAblyRestChannels`, `TemporalAblyRestChannel`, `TemporalAblyRestPresence`, `TemporalAblyRestAnnotations`, `TemporalAblyRestObject`, `TemporalAblyRestPush`, `TemporalAblyRestPushAdmin`, `TemporalAblyRestPushDeviceRegistrations`, `TemporalAblyRestPushChannelSubscriptions`, `TemporalAblyRestPushLiveActivity`, `TemporalAblyPaginatedResult`, `TemporalAblyHttpPaginatedResponse`, `ABLY_ERROR_TYPE`, `getAblyErrorDetails`, `AblyErrorDetails` |
