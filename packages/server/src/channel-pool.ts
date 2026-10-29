import type * as Ably from '@ably/pubsub-core/api';
import { ErrorInfo } from '@ably/pubsub-core';
import type {
  PubSubRealtimeChannelPool,
  RealtimeChannelPoolOptions,
  RealtimePublisherAnnotations,
  RealtimePublisherChannel,
} from '../index';

// The contract of the pool and its handles is documented on the declarations in ../index.d.ts,
// which is what consumers see. The comments here cover how the implementation meets it.

const defaultSize = 4;
const defaultFailedRetryTimeout = 30000;

type PoolState = 'initialized' | 'opening' | 'open' | 'closing' | 'closed';

interface PooledClient {
  readonly realtime: Ably.PubSubRealtimeClient;
  /** The number of channel names bound to this client, which client selection balances. */
  boundNames: number;
  failedRetryTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * The pool's state for one channel name. It lives while a handle on the name is unreleased or an
 * operation on it is unsettled, so that a name used again before its last publish is acknowledged
 * keeps its client, and with it the order of its messages.
 */
interface Binding {
  readonly name: string;
  /** The client the name is bound to, resolved by the first operation rather than by `get()`. */
  client: PooledClient | null;
  handles: number;
  inFlight: number;
}

/** Resolves once the connection is in one of `states`, with the state it reached. */
function whenOneOf(
  connection: Ably.Connection,
  states: readonly Ably.ConnectionState[],
): Promise<Ably.ConnectionState> {
  return new Promise((resolve) => {
    if (states.includes(connection.state)) {
      resolve(connection.state);
      return;
    }
    const listener = (change: Ably.ConnectionStateChange) => {
      if (states.includes(change.current)) {
        connection.off(listener);
        resolve(change.current);
      }
    };
    connection.on(listener);
  });
}

/** The client with the fewest names bound to it, chosen at random among equals. */
function leastBound(candidates: PooledClient[]): PooledClient {
  const fewest = Math.min(...candidates.map((client) => client.boundNames));
  const tied = candidates.filter((client) => client.boundNames === fewest);
  return tied[Math.floor(Math.random() * tied.length)];
}

function invalidOptionError(name: string, value: unknown, requirement: string): ErrorInfo {
  return ErrorInfo.fromValues({
    message: `Invalid channel pool option ${name}: ${String(value)}`,
    code: 40003,
    statusCode: 400,
    remediation: `Set ${name} to ${requirement}, or omit it to use the default.`,
  });
}

export class RealtimeChannelPool implements PubSubRealtimeChannelPool {
  private readonly size: number;
  private readonly failedRetryTimeout: number;
  private state: PoolState = 'initialized';
  private readonly clients: PooledClient[] = [];
  private readonly bindings = new Map<string, Binding>();
  private readonly inFlight = new Set<Promise<void>>();
  private opened: Promise<void> | null = null;
  private closed: Promise<void> | null = null;

  constructor(
    private readonly createClient: () => Ably.PubSubRealtimeClient,
    options: RealtimeChannelPoolOptions = {},
  ) {
    const { size = defaultSize, failedRetryTimeout = defaultFailedRetryTimeout } = options;
    if (!Number.isInteger(size) || size < 1) {
      throw invalidOptionError('size', size, 'a whole number of clients, 1 or more');
    }
    if (typeof failedRetryTimeout !== 'number' || !Number.isFinite(failedRetryTimeout) || failedRetryTimeout < 0) {
      throw invalidOptionError('failedRetryTimeout', failedRetryTimeout, 'a number of milliseconds, 0 or more');
    }
    this.size = size;
    this.failedRetryTimeout = failedRetryTimeout;

    // Bound so that `const { get } = pool` works.
    this.get = this.get.bind(this);
    this.open = this.open.bind(this);
    this.close = this.close.bind(this);
  }

  get(name: string): RealtimePublisherChannel {
    let binding = this.bindings.get(name);
    if (!binding) {
      binding = { name, client: null, handles: 0, inFlight: 0 };
      this.bindings.set(name, binding);
    }
    binding.handles++;
    return new PooledPublisherChannel(this, binding);
  }

  open(): Promise<void> {
    if (!this.opened) {
      this.opened = this.openClients();
    }
    return this.opened;
  }

  close(): Promise<void> {
    if (!this.closed) {
      this.closed = this.closeClients();
    }
    return this.closed;
  }

  /** Runs `operation` on the channel object of the client that the name resolves to now. */
  run<T>(binding: Binding, operation: (channel: Ably.RealtimeChannel) => Promise<T>): Promise<T> {
    const unavailable = this.unavailableError();
    if (unavailable) {
      return Promise.reject(unavailable);
    }

    const client = this.resolve(binding);
    let result: Promise<T>;
    try {
      result = operation(client.realtime.channels.get(binding.name));
    } catch (err) {
      result = Promise.reject(err);
    }

    binding.inFlight++;
    const settled: Promise<void> = result.then(
      () => this.settle(binding, settled),
      () => this.settle(binding, settled),
    );
    this.inFlight.add(settled);
    return result;
  }

  releaseHandle(binding: Binding): void {
    binding.handles--;
    this.dropIfUnused(binding);
  }

  private settle(binding: Binding, settled: Promise<void>): void {
    this.inFlight.delete(settled);
    binding.inFlight--;
    this.dropIfUnused(binding);
  }

  private dropIfUnused(binding: Binding): void {
    if (binding.handles > 0 || binding.inFlight > 0) {
      return;
    }
    this.unbind(binding);
    this.bindings.delete(binding.name);
  }

  private unavailableError(): ErrorInfo | null {
    switch (this.state) {
      case 'initialized':
        return ErrorInfo.fromValues({
          message: 'Channel pool is not open',
          code: 40000,
          statusCode: 400,
          remediation:
            'Call open() on the pool, and await it, before calling a method on a channel obtained from it. Open the pool once, when the process starts.',
        });
      case 'closing':
      case 'closed':
        return ErrorInfo.fromValues({
          message: `Channel pool is ${this.state}`,
          code: 80017,
          statusCode: 400,
          remediation:
            'Close the pool only after the work using it has finished. A closed pool cannot be reopened, so call createRealtimeChannelPool() for a new pool if the process needs one again.',
        });
      default:
        return null;
    }
  }

  /**
   * The client for the name. A bound client that is connected keeps the name, which preserves the
   * order of messages on it. Otherwise the name moves to the connected client with the fewest names
   * bound to it. If no client is connected, a bound name stays where it is, and an unbound name goes
   * to the client with the fewest names; the operation then meets that client's state, queueing
   * while it is connecting or disconnected, and failing while it is suspended or failed.
   */
  private resolve(binding: Binding): PooledClient {
    const current = binding.client;
    if (current && current.realtime.connection.state === 'connected') {
      return current;
    }

    const connected = this.clients.filter((client) => client.realtime.connection.state === 'connected');
    if (connected.length === 0 && current) {
      return current;
    }

    const chosen = leastBound(connected.length > 0 ? connected : this.clients);
    this.unbind(binding);
    binding.client = chosen;
    chosen.boundNames++;
    return chosen;
  }

  private unbind(binding: Binding): void {
    const client = binding.client;
    if (!client) {
      return;
    }
    binding.client = null;
    client.boundNames--;
    // The channel object never attaches, so it stays in the initialized state, which `release()`
    // accepts. Operations already given to it are queued on the connection rather than the channel,
    // so they still complete.
    client.realtime.channels.release(binding.name);
  }

  private async openClients(): Promise<void> {
    if (this.state !== 'initialized') {
      throw this.unavailableError();
    }
    this.state = 'opening';

    for (let i = 0; i < this.size; i++) {
      const client: PooledClient = { realtime: this.createClient(), boundNames: 0, failedRetryTimer: null };
      client.realtime.connection.on('failed', () => this.scheduleReconnect(client));
      this.clients.push(client);
      client.realtime.connect();
    }

    // Each client's first attempt decides the outcome. A failed client means a fault that retrying
    // would meet again, such as an invalid key, so the pool does not open. A client that is
    // disconnected or suspended retries by itself, so a transient outage does not stop the process
    // from starting.
    const outcomes = await Promise.all(
      this.clients.map((client) =>
        whenOneOf(client.realtime.connection, [
          'connected',
          'disconnected',
          'suspended',
          'failed',
          'closing',
          'closed',
        ]),
      ),
    );

    if (this.state !== 'opening') {
      throw ErrorInfo.fromValues({
        message: 'Channel pool was closed while it was opening',
        code: 80017,
        statusCode: 400,
        remediation: 'Await open() before calling close() on the pool.',
      });
    }

    const failed = this.clients.find((_, i) => outcomes[i] === 'failed');
    if (failed) {
      const reason = failed.realtime.connection.errorReason;
      await this.close();
      // The client's own error, which already describes the fault and how to fix it.
      throw reason;
    }

    this.state = 'open';
    // A client that failed after its first attempt failed while reconnects were not yet scheduled.
    for (const client of this.clients) {
      if (client.realtime.connection.state === 'failed') {
        this.scheduleReconnect(client);
      }
    }
  }

  private async closeClients(): Promise<void> {
    this.state = 'closing';

    await Promise.all(this.inFlight);

    await Promise.all(
      this.clients.map((client) => {
        if (client.failedRetryTimer) {
          clearTimeout(client.failedRetryTimer);
          client.failedRetryTimer = null;
        }
        client.realtime.close();
        return whenOneOf(client.realtime.connection, ['closed', 'failed']);
      }),
    );

    this.state = 'closed';
  }

  /**
   * A failed client does not retry by itself, so the pool calls `connect()` on it after
   * `failedRetryTimeout`. A long-running process then recovers once the cause, such as a revoked
   * key, is fixed, without a restart. The client logs each failure at error level with its reason.
   */
  private scheduleReconnect(client: PooledClient): void {
    if (this.state !== 'open') {
      return;
    }
    if (client.failedRetryTimer) {
      clearTimeout(client.failedRetryTimer);
    }
    client.failedRetryTimer = setTimeout(() => {
      client.failedRetryTimer = null;
      if (this.state === 'open' && client.realtime.connection.state === 'failed') {
        client.realtime.connect();
      }
    }, this.failedRetryTimeout);
  }
}

class PooledPublisherChannel implements RealtimePublisherChannel {
  readonly annotations: RealtimePublisherAnnotations;
  private released = false;

  constructor(
    private readonly pool: RealtimeChannelPool,
    private readonly binding: Binding,
  ) {
    this.annotations = {
      publish: (message: Ably.Message | string, annotation: Ably.OutboundAnnotation) =>
        this.run((channel) => channel.annotations.publish(message as Ably.Message, annotation)),
      delete: (message: Ably.Message | string, annotation: Ably.OutboundAnnotation) =>
        this.run((channel) => channel.annotations.delete(message as Ably.Message, annotation)),
    };
  }

  get name(): string {
    return this.binding.name;
  }

  publish(name: string, data: any, options?: Ably.PublishOptions): Promise<Ably.PublishResult>;
  publish(messages: Ably.Message[], options?: Ably.PublishOptions): Promise<Ably.PublishResult>;
  publish(message: Ably.Message, options?: Ably.PublishOptions): Promise<Ably.PublishResult>;
  publish(...args: any[]): Promise<Ably.PublishResult> {
    return this.run((channel) => (channel.publish as (...args: any[]) => Promise<Ably.PublishResult>)(...args));
  }

  updateMessage(
    message: Ably.Message,
    operation?: Ably.MessageOperation,
    options?: Ably.PublishOptions,
  ): Promise<Ably.UpdateDeleteResult> {
    return this.run((channel) => channel.updateMessage(message, operation, options));
  }

  deleteMessage(
    message: Ably.Message,
    operation?: Ably.MessageOperation,
    options?: Ably.PublishOptions,
  ): Promise<Ably.UpdateDeleteResult> {
    return this.run((channel) => channel.deleteMessage(message, operation, options));
  }

  appendMessage(
    message: Ably.Message,
    operation?: Ably.MessageOperation,
    options?: Ably.PublishOptions,
  ): Promise<Ably.UpdateDeleteResult> {
    return this.run((channel) => channel.appendMessage(message, operation, options));
  }

  release(): void {
    if (this.released) {
      return;
    }
    this.released = true;
    this.pool.releaseHandle(this.binding);
  }

  [Symbol.dispose](): void {
    this.release();
  }

  private run<T>(operation: (channel: Ably.RealtimeChannel) => Promise<T>): Promise<T> {
    if (this.released) {
      return Promise.reject(
        ErrorInfo.fromValues({
          message: `Channel handle for ${this.binding.name} was used after it was released`,
          code: 40000,
          statusCode: 400,
          remediation:
            'Call get() on the pool for a new handle on the channel. A handle cannot be used after release(), or after the block that declared it with using has exited.',
        }),
      );
    }
    return this.pool.run(this.binding, operation);
  }
}
