import type {
  ClientOptions,
  Message,
  MessageOperation,
  OutboundAnnotation,
  PublishOptions,
  PublishResult,
  PubSubRealtimeClient,
  PubSubHttpClient,
  UpdateDeleteResult,
} from '@ably/pubsub-core/api';

/**
 * The full public type surface of the core. Safe as a star re-export because it resolves
 * at compile time only — see ../core-impl/side/core-exports.ts for why the *runtime* re-export is
 * enumerated instead.
 */
export * from '@ably/pubsub-core/api';

/**
 * Creates a stateless Pub/Sub client for a server, talking to Ably over HTTP.
 *
 * The client this returns declares itself a server. Server traffic is exempt from monthly active
 * user counting, from the per-client-ID concurrency limit, and from the requirement to
 * carry a client ID on an account billed by MAU.
 *
 * How that exemption is granted depends on how the client authenticates, and token auth
 * needs more than this package provides. With an API key, the `ably-pubsub-server` agent
 * entry this factory sends is enough on its own. With token auth it is not: Ably grants the
 * server side only from a signed `x-ably-clientType=server` claim on the token, and a
 * client that declares itself a server without that claim is rejected rather than treated
 * as a device. If you authenticate with `authUrl` or `authCallback`, add that claim to the
 * tokens your auth service issues before you deploy this package.
 *
 * Use `createClient` from `@ably/pubsub-device` for code running on an end user's device,
 * so that its traffic is counted instead of exempt.
 *
 * @param options - A client options object, an Ably API key, or an Ably token.
 */
export declare function createHttpClient(options: ClientOptions | string): PubSubHttpClient;

/**
 * Creates a realtime Pub/Sub client for a server, holding a persistent connection to Ably.
 *
 * The client this returns declares itself a server. Server traffic is exempt from monthly active
 * user counting, from the per-client-ID concurrency limit, and from the requirement to
 * carry a client ID on an account billed by MAU.
 *
 * How that exemption is granted depends on how the client authenticates, and token auth
 * needs more than this package provides. With an API key, the `ably-pubsub-server` agent
 * entry this factory sends is enough on its own. With token auth it is not: Ably grants the
 * server side only from a signed `x-ably-clientType=server` claim on the token, and a
 * client that declares itself a server without that claim is rejected at connect rather
 * than treated as a device. If you authenticate with `authUrl` or `authCallback`, add that
 * claim to the tokens your auth service issues before you deploy this package.
 *
 * Use `createClient` from `@ably/pubsub-device` for code running on an end user's device,
 * so that its traffic is counted instead of exempt.
 *
 * @param options - A client options object, an Ably API key, or an Ably token.
 */
export declare function createRealtimeClient(options: ClientOptions | string): PubSubRealtimeClient;

/**
 * Options for {@link createRealtimeChannelPool}, which apply to the pool rather than to its clients.
 */
export interface RealtimeChannelPoolOptions {
  /**
   * The number of realtime clients, and so of connections, that the pool holds. Each connection
   * accepts a limited rate of inbound messages, so size the pool for the rate at which the process
   * publishes: with `A` operations publishing at once, each at `R` messages per second, the pool
   * needs at least `A * R / limit` clients, where `limit` is your account's inbound message rate
   * per connection. Defaults to 4.
   */
  size?: number;
  /**
   * How long, in milliseconds, the pool waits before it reconnects a client whose connection has
   * failed. A failed connection does not retry by itself, because its cause, such as an invalid or
   * revoked key, would meet a retry again. The pool retries it so that a long-running process
   * recovers once the cause is fixed. Defaults to 30000.
   */
  failedRetryTimeout?: number;
}

/**
 * A pool of publish-only realtime channels, shared by the concurrent operations of a long-running
 * process, such as the activities of a Temporal worker.
 *
 * The pool holds several realtime clients and spreads channel names across them, so that a busy
 * process does not exceed the inbound message rate of one connection. It keeps those clients for
 * the life of the process, so an operation does not wait for a new connection, and the client
 * state that speeds up later operations, such as the fallback host in use, is kept.
 *
 * Create one with {@link createRealtimeChannelPool}, call {@link PubSubRealtimeChannelPool.open}
 * when the process starts, and {@link PubSubRealtimeChannelPool.close} once the work using it has
 * finished.
 */
export interface PubSubRealtimeChannelPool {
  /**
   * Returns a new handle on the publisher channel for a channel name. Each handle holds the channel
   * until it is released. Every handle on a name publishes through the same client while that
   * client is connected, so messages published by consecutive holders of the name keep their order.
   *
   * The handle chooses its client when a method is called on it rather than here, so `get()` does
   * not fail. It takes no channel options, since a channel shared by concurrent holders cannot carry
   * options that differ between them.
   *
   * This method is bound to the pool, so `const { get } = pool` works.
   *
   * @param name - The channel name.
   */
  get(name: string): RealtimePublisherChannel;

  /**
   * Creates and connects every client. It resolves once each client has made its first connection
   * attempt, whether or not it connected: a client that cannot connect yet, such as during a network
   * outage, keeps retrying by itself, and an operation on it waits or fails as described on
   * {@link RealtimePublisherChannel}. It rejects with the client's `errorReason` if any client's
   * connection fails, for example because the key is invalid, and the pool is then closed.
   *
   * A second call does nothing, and returns the promise of the first.
   */
  open(): Promise<void>;

  /**
   * Waits for the operations in progress to settle, then closes every client, resolving once every
   * connection is closed. An operation called once `close()` has been called rejects with error
   * 80017. A closed pool cannot be reopened.
   *
   * A second call does nothing, and returns the promise of the first.
   */
  close(): Promise<void>;
}

/**
 * The `annotations` of a {@link RealtimePublisherChannel}, which publish and delete annotations
 * without subscribing to them.
 */
export interface RealtimePublisherAnnotations {
  /**
   * Publishes an annotation for a message, as `RealtimeAnnotations.publish` does.
   *
   * @param message - The message to annotate, or its serial.
   * @param annotation - The annotation to publish.
   */
  publish(message: Message | string, annotation: OutboundAnnotation): Promise<void>;
  /**
   * Deletes an annotation for a message, as `RealtimeAnnotations.delete` does.
   *
   * @param message - The annotated message, or its serial.
   * @param annotation - The annotation to delete.
   */
  delete(message: Message | string, annotation: OutboundAnnotation): Promise<void>;
}

/**
 * A handle on a channel obtained from a {@link PubSubRealtimeChannelPool}. It publishes on the
 * channel, but cannot attach to it or subscribe to it, so every publish is transient and the
 * channel holds no state between operations.
 *
 * Each method call runs on the client that the channel name is bound to while that client is
 * connected. Otherwise the name moves to the connected client with the fewest channel names bound
 * to it. If no client is connected, the call goes to the client the name is bound to, or to the
 * client with the fewest names if the name is not bound, and meets that client's connection state:
 * it is queued while the connection is connecting or disconnected and sent once it connects, and it
 * rejects with the client's `errorReason` while the connection is suspended or failed.
 *
 * Release the handle when finished with it, by calling {@link RealtimePublisherChannel.release} or
 * by declaring it with `using`. A method called after release rejects with error 40000.
 */
export interface RealtimePublisherChannel {
  /** The channel name. */
  readonly name: string;

  /** Publishes a single message, as `RealtimeChannel.publish` does. */
  publish(name: string, data: any, options?: PublishOptions): Promise<PublishResult>;
  /** Publishes an array of messages as one operation, as `RealtimeChannel.publish` does. */
  publish(messages: Message[], options?: PublishOptions): Promise<PublishResult>;
  /** Publishes a single message, as `RealtimeChannel.publish` does. */
  publish(message: Message, options?: PublishOptions): Promise<PublishResult>;

  /** Updates a message, as `RealtimeChannel.updateMessage` does. */
  updateMessage(message: Message, operation?: MessageOperation, options?: PublishOptions): Promise<UpdateDeleteResult>;
  /** Marks a message as deleted, as `RealtimeChannel.deleteMessage` does. */
  deleteMessage(message: Message, operation?: MessageOperation, options?: PublishOptions): Promise<UpdateDeleteResult>;
  /** Appends to a message, as `RealtimeChannel.appendMessage` does. */
  appendMessage(message: Message, operation?: MessageOperation, options?: PublishOptions): Promise<UpdateDeleteResult>;

  /** Publishes and deletes annotations on the channel's messages. */
  readonly annotations: RealtimePublisherAnnotations;

  /**
   * Drops this handle's hold on the channel. Once every handle on a channel name is released and
   * its operations have settled, the pool forgets the name. A second call does nothing.
   */
  release(): void;

  /** Calls `release()`, so that a handle declared with `using` is released when its block exits. */
  [Symbol.dispose](): void;
}

/**
 * Creates a {@link PubSubRealtimeChannelPool}: a pool of publish-only channels, served by realtime
 * clients that declare the server side, as those of {@link createRealtimeClient} do. The clients
 * are created and connected by {@link PubSubRealtimeChannelPool.open}.
 *
 * Every client in the pool is created from the same `options`, so what the server side requires
 * of token auth, described on {@link createRealtimeClient}, applies to each of them.
 *
 * @param options - A client options object, an Ably API key, or an Ably token, used by every client.
 * @param pool - Options for the pool itself.
 */
export declare function createRealtimeChannelPool(
  options: ClientOptions | string,
  pool?: RealtimeChannelPoolOptions,
): PubSubRealtimeChannelPool;
