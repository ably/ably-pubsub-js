import type * as Ably from '@ably/pubsub-core/api';
import { ErrorInfo } from '@ably/pubsub-core';
import { createLogger, Logger } from '../../core-impl/side/logger';
import type { LoggerInstance, LogOptions } from '../../core-impl/side/logger';
import type {
  RealtimeChannelPool,
  RealtimeChannelPoolOptions,
  RealtimePublisherAnnotations,
  RealtimePublisherChannel,
} from '../index';

// The contract of the pool and its handles is documented on the declarations in ../index.d.ts,
// which is what consumers see. The comments here cover how the implementation meets it.

const defaultSize = 4;
const defaultFailedRetryTimeout = 30000;

type PoolState = 'initialized' | 'opening' | 'open' | 'closing' | 'closed';

/**
 * How the pool's clients serve calls: through a connected client, by queueing them while no client
 * is connected, or not at all, rejecting them, while every client is suspended or failed. The pool
 * logs each change of it, rather than each call it affects.
 */
type Availability = 'connected' | 'queueing' | 'rejecting';

/** The connection states that end an attempt, which a client's availability is judged by. */
const settledStates: readonly Ably.ConnectionState[] = ['connected', 'disconnected', 'suspended', 'failed'];

/** The action of the pool's log lines, other than those of `open()` and `close()`. */
const logAction = 'RealtimeChannelPool';

/** The tag on each line a pool client logs, and on the pool's own lines about that client. */
export function poolClientLogContext(index: number): string {
  return `pool client ${index}`;
}

interface PooledClient {
  readonly index: number;
  readonly underlyingClient: Ably.PubSubRealtimeClient;
  /** Logs the pool's events about this client, tagged as the client's own lines are. */
  readonly logger: LoggerInstance;
  /** Follows the client's connection state until the pool closes. */
  readonly onStateChange: (change: Ably.ConnectionStateChange) => void;
  /** The number of channel names bound to this client, which client selection balances. */
  boundNames: number;
  failedRetryTimer: ReturnType<typeof setTimeout> | null;
  /**
   * The state in which the client's latest connection attempt ended, so not `connecting`. A client
   * that is suspended or failed then counts as unable to serve calls until an attempt connects or
   * disconnects, rather than each time a retry starts.
   */
  settledState: Ably.ConnectionState;
  /** The id of the client's latest connection, kept for the logs once the connection has gone. */
  lastConnectionId: string | undefined;
  /** When the connection failed, if it has not connected since. */
  failedAt: number | null;
  /** The number of times the pool has reconnected the client since its connection failed. */
  reconnectAttempts: number;
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

/**
 * An error's code and message, for a log line. Never its `toString()`, which includes its `cause`,
 * and a cause can carry content from the app's `authCallback`.
 */
function describeError(err: Ably.ErrorInfo | null | undefined): string {
  return err ? `${err.code}: ${err.message}` : 'no reason';
}

function invalidOptionError(name: string, value: unknown, requirement: string): ErrorInfo {
  return ErrorInfo.fromValues({
    message: `Invalid channel pool option ${name}: ${String(value)}`,
    code: 40003,
    statusCode: 400,
    remediation: `Set ${name} to ${requirement}, or omit it to use the default.`,
  });
}

export class DefaultRealtimeChannelPool implements RealtimeChannelPool {
  private readonly size: number;
  private readonly failedRetryTimeout: number;
  private state: PoolState = 'initialized';
  private readonly clients: PooledClient[] = [];
  private readonly bindings = new Map<string, Binding>();
  private readonly inFlight = new Set<Promise<void>>();
  private opened: Promise<void> | null = null;
  private closed: Promise<void> | null = null;
  /** Logs the pool's events that concern no one client, once each, however many clients there are. */
  private readonly logger: LoggerInstance;
  /** Judged once the pool is open, from which time each change is logged. */
  private availability: Availability = 'connected';

  /**
   * @param createClient - Creates the client at `index` in the pool, whose own lines are tagged with
   * `poolClientLogContext(index)`.
   * @param options - The pool's own options.
   * @param logOptions - The log level and handler of the clients, which the pool's lines follow.
   */
  constructor(
    private readonly createClient: (index: number) => Ably.PubSubRealtimeClient,
    options: RealtimeChannelPoolOptions = {},
    private readonly logOptions: LogOptions = {},
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
    this.logger = createLogger(logOptions);

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
      result = operation(client.underlyingClient.channels.get(binding.name));
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
   * while it is connecting or disconnected, and failing while it is suspended or failed. With
   * `queueMessages: false` in the client options, the connection manager does not queue it, and it
   * fails while the connection is connecting or disconnected too, with the connection's
   * `errorReason`, or with error 90000 if there is none.
   */
  private resolve(binding: Binding): PooledClient {
    const current = binding.client;
    if (current && current.underlyingClient.connection.state === 'connected') {
      return current;
    }

    const connected = this.clients.filter((client) => client.underlyingClient.connection.state === 'connected');
    if (connected.length === 0 && current) {
      return current;
    }

    const chosen = leastBound(connected.length > 0 ? connected : this.clients);
    this.unbind(binding);
    binding.client = chosen;
    chosen.boundNames++;
    if (current) {
      Logger.logAction(
        current.logger,
        Logger.LOG_MINOR,
        logAction,
        `channel ${binding.name} moved to ${poolClientLogContext(chosen.index)}, because this client is ${current.underlyingClient.connection.state}`,
      );
    } else {
      Logger.logAction(chosen.logger, Logger.LOG_MICRO, logAction, `channel ${binding.name} bound to this client`);
    }
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
    client.underlyingClient.channels.release(binding.name);
  }

  private async openClients(): Promise<void> {
    if (this.state !== 'initialized') {
      throw this.unavailableError();
    }
    this.state = 'opening';

    for (let i = 0; i < this.size; i++) {
      const client: PooledClient = {
        index: i,
        underlyingClient: this.createClient(i),
        logger: createLogger(this.logOptions, poolClientLogContext(i)),
        onStateChange: (change) => this.onStateChange(client, change),
        boundNames: 0,
        failedRetryTimer: null,
        settledState: 'initialized',
        lastConnectionId: undefined,
        failedAt: null,
        reconnectAttempts: 0,
      };
      client.underlyingClient.connection.on(client.onStateChange);
      this.clients.push(client);
      client.underlyingClient.connect();
    }

    // Each client's first attempt decides the outcome. A failed client means a fault that retrying
    // would meet again, such as an invalid key, so the pool does not open. A client that is
    // disconnected or suspended retries by itself, so a transient outage does not stop the process
    // from starting.
    const outcomes = await Promise.all(
      this.clients.map((client) =>
        whenOneOf(client.underlyingClient.connection, [
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
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'RealtimeChannelPool.open()',
        'the pool was closed while it was opening, so open() rejects',
      );
      throw ErrorInfo.fromValues({
        message: 'Channel pool was closed while it was opening',
        code: 80017,
        statusCode: 400,
        remediation: 'Await open() before calling close() on the pool.',
      });
    }

    const failed = this.clients.find((_, i) => outcomes[i] === 'failed');
    if (failed) {
      const reason = failed.underlyingClient.connection.errorReason;
      Logger.logAction(
        this.logger,
        Logger.LOG_MAJOR,
        'RealtimeChannelPool.open()',
        `open failed, because a client failed, so the pool closes; ${this.describeClients()}`,
      );
      await this.close();
      // The client's own error, which already describes the fault and how to fix it.
      throw reason;
    }

    this.state = 'open';
    Logger.logAction(this.logger, Logger.LOG_MAJOR, 'RealtimeChannelPool.open()', `opened; ${this.describeClients()}`);
    // A client that failed after its first attempt failed while reconnects were not yet scheduled.
    for (const client of this.clients) {
      if (client.underlyingClient.connection.state === 'failed') {
        this.scheduleReconnect(client);
      }
    }
    // If no client is connected, this logs the change from the `connected` availability the pool
    // starts with.
    this.updateAvailability();
  }

  /** How many clients are connected, and the state of each that is not, with its reason's code. */
  private describeClients(): string {
    const connected = this.clients.filter((client) => client.underlyingClient.connection.state === 'connected');
    const others = this.clients
      .filter((client) => client.underlyingClient.connection.state !== 'connected')
      .map((client) => {
        const { state, errorReason } = client.underlyingClient.connection;
        return `${poolClientLogContext(client.index)} ${state}${errorReason ? ` (${errorReason.code})` : ''}`;
      });
    return `${connected.length} of ${this.size} clients connected${others.length > 0 ? `; ${others.join(', ')}` : ''}`;
  }

  private async closeClients(): Promise<void> {
    this.state = 'closing';
    const closingAt = Date.now();
    Logger.logAction(
      this.logger,
      Logger.LOG_MAJOR,
      'RealtimeChannelPool.close()',
      `closing; operations in flight=${this.inFlight.size}`,
    );

    // The pool makes no more decisions about its clients, so it stops following them.
    for (const client of this.clients) {
      client.underlyingClient.connection.off(client.onStateChange);
    }

    await Promise.all(this.inFlight);

    await Promise.all(
      this.clients.map((client) => {
        if (client.failedRetryTimer) {
          clearTimeout(client.failedRetryTimer);
          client.failedRetryTimer = null;
        }
        client.underlyingClient.close();
        return whenOneOf(client.underlyingClient.connection, ['closed', 'failed']);
      }),
    );

    this.state = 'closed';
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'RealtimeChannelPool.close()',
      `closed in ${Date.now() - closingAt} ms`,
    );
  }

  private onStateChange(client: PooledClient, change: Ably.ConnectionStateChange): void {
    const connection = client.underlyingClient.connection;
    if (change.current === 'connected') {
      client.lastConnectionId = connection.id;
      if (client.failedAt !== null) {
        if (client.reconnectAttempts > 0) {
          Logger.logAction(
            client.logger,
            Logger.LOG_MAJOR,
            logAction,
            `connection recovered; connectionId=${connection.id}; pool reconnects=${client.reconnectAttempts}; failed for ${Date.now() - client.failedAt} ms`,
          );
        }
        client.failedAt = null;
        client.reconnectAttempts = 0;
      }
    } else if (change.current === 'failed') {
      if (client.failedAt === null) {
        client.failedAt = Date.now();
      }
      this.scheduleReconnect(client);
    }

    if (settledStates.includes(change.current)) {
      client.settledState = change.current;
      this.updateAvailability(client);
    }
  }

  private judgeAvailability(): Availability {
    if (this.clients.some((client) => client.settledState === 'connected')) {
      return 'connected';
    }
    if (this.clients.every((client) => client.settledState === 'suspended' || client.settledState === 'failed')) {
      return 'rejecting';
    }
    return 'queueing';
  }

  /**
   * Logs a change of availability: at error level when calls start or stop rejecting, since that is
   * when they fail, and at major level when they start or stop queueing. It runs on a change of a
   * client's settled state, so its cost is not paid per call.
   *
   * @param changed - The client whose change of state this follows, if any.
   */
  private updateAvailability(changed?: PooledClient): void {
    if (this.state !== 'open') {
      return;
    }
    const previous = this.availability;
    const current = this.judgeAvailability();
    if (current === previous) {
      return;
    }
    this.availability = current;

    const cause = changed
      ? `${poolClientLogContext(changed.index)} is ${changed.settledState}`
      : 'a client changed state';
    if (previous === 'rejecting') {
      Logger.logAction(this.logger, Logger.LOG_ERROR, logAction, `calls no longer reject, because ${cause}`);
    }
    if (current === 'rejecting') {
      const clients = this.clients.map(
        (client) =>
          `${poolClientLogContext(client.index)} ${client.settledState} (${describeError(client.underlyingClient.connection.errorReason)})`,
      );
      Logger.logAction(
        this.logger,
        Logger.LOG_ERROR,
        logAction,
        `every client is suspended or failed, so calls reject; ${clients.join(', ')}`,
      );
    } else if (current === 'queueing') {
      const clients = this.clients.map((client) => `${poolClientLogContext(client.index)} ${client.settledState}`);
      Logger.logAction(
        this.logger,
        Logger.LOG_MAJOR,
        logAction,
        `no client is connected, so calls queue until one connects, unless queueMessages is false; ${clients.join(', ')}`,
      );
    } else if (previous === 'queueing') {
      Logger.logAction(this.logger, Logger.LOG_MAJOR, logAction, `calls no longer queue, because ${cause}`);
    }
  }

  /**
   * A failed client does not retry by itself, so the pool calls `connect()` on it after
   * `failedRetryTimeout`. A long-running process then recovers once the cause, such as a revoked
   * key, is fixed, without a restart. The client logs each failure at error level with its reason.
   * The pool logs each reconnect it schedules at major level, each attempt at minor level, and the
   * recovery once the client connects at major level.
   */
  private scheduleReconnect(client: PooledClient): void {
    if (this.state !== 'open') {
      return;
    }
    if (client.failedRetryTimer) {
      clearTimeout(client.failedRetryTimer);
    }
    const connection = client.underlyingClient.connection;
    const lastConnection = client.lastConnectionId ? `last connectionId=${client.lastConnectionId}; ` : '';
    Logger.logAction(
      client.logger,
      Logger.LOG_MAJOR,
      logAction,
      `connection failed, so the pool reconnects it in ${this.failedRetryTimeout} ms; ${lastConnection}reason=${describeError(connection.errorReason)}`,
    );
    client.failedRetryTimer = setTimeout(() => {
      client.failedRetryTimer = null;
      if (this.state !== 'open' || connection.state !== 'failed') {
        Logger.logAction(
          client.logger,
          Logger.LOG_MICRO,
          logAction,
          `reconnect skipped; the pool is ${this.state} and the connection is ${connection.state}`,
        );
        return;
      }
      client.reconnectAttempts++;
      Logger.logAction(
        client.logger,
        Logger.LOG_MINOR,
        logAction,
        `reconnecting; attempt ${client.reconnectAttempts} since the connection failed`,
      );
      client.underlyingClient.connect();
    }, this.failedRetryTimeout);
  }
}

class PooledPublisherChannel implements RealtimePublisherChannel {
  readonly annotations: RealtimePublisherAnnotations;
  private released = false;

  constructor(
    private readonly pool: DefaultRealtimeChannelPool,
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
