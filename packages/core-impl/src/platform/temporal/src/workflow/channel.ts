import type * as Ably from '@ably/pubsub-core/api';
import { ActivityNames } from '../common/activities.js';
import { TemporalRestAnnotations } from './annotations.js';
import { requireObject, serialArgument } from './arguments.js';
import { ablyFailure } from './failure.js';
import type { ActivityInvoker } from './invoker.js';
import { TemporalRestObject } from './object.js';
import { paginate, pageSummary, type TemporalPaginatedResult } from './paginated.js';
import { TemporalRestPresence } from './presence.js';

const MESSAGE_REMEDIATION =
  'Pass the Message received from history() or a subscribe callback, which carries a serial, with the fields to change.';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * A channel used from workflow code. It mirrors the Ably REST `Channel`, and is obtained from
 * {@link TemporalRestChannels.get | TemporalRest.channels.get()}.
 *
 * Each method runs as a Temporal activity on the worker's Ably HTTP client. If the request fails, the method
 * rejects with the activity's `ActivityFailure`. Use `getAblyErrorDetails()` to get the Ably error from it. Binary
 * message data is returned as `Uint8Array`.
 */
export class TemporalRestChannel {
  /** The channel name. */
  readonly name: string;
  /** Retrieves the current and historic presence set of the channel. */
  readonly presence: TemporalRestPresence;
  /** Publishes and retrieves annotations on the channel's messages. */
  readonly annotations: TemporalRestAnnotations;
  /** Reads and modifies the objects on the channel. */
  readonly object: TemporalRestObject;

  /** @internal */
  constructor(
    private readonly invoker: ActivityInvoker,
    name: string,
  ) {
    this.name = name;
    this.presence = new TemporalRestPresence(invoker, name);
    this.annotations = new TemporalRestAnnotations(invoker, name);
    this.object = new TemporalRestObject(invoker, name);
  }

  /**
   * Publishes an array of messages to the channel. Runs as a Temporal activity.
   *
   * When idempotent publishing is enabled (see `TemporalRestOptions.idempotentPublishing`) and none of the
   * messages has an `id`, the messages are published with IDs of the form `<base>:<index>`. The workflow derives
   * the base deterministically, so every attempt of the activity publishes the same IDs, and Ably deduplicates a
   * retry that arrives within its idempotency window. The objects passed in are not modified.
   *
   * @param messages - The messages to publish.
   * @param options - Optional parameters sent as part of the query string.
   * @returns A promise which is fulfilled with the serials of the published messages.
   */
  publish(messages: Ably.Message[], options?: Ably.PublishOptions): Promise<Ably.PublishResult>;
  /**
   * Publishes a message to the channel. Runs as a Temporal activity.
   *
   * When idempotent publishing is enabled (see `TemporalRestOptions.idempotentPublishing`) and the message has
   * no `id`, it is published with an ID of the form `<base>:0`. The workflow derives the base deterministically,
   * so every attempt of the activity publishes the same ID, and Ably deduplicates a retry that arrives within its
   * idempotency window. The object passed in is not modified.
   *
   * @param message - The message to publish.
   * @param options - Optional parameters sent as part of the query string.
   * @returns A promise which is fulfilled with the serial of the published message.
   */
  publish(message: Ably.Message, options?: Ably.PublishOptions): Promise<Ably.PublishResult>;
  /**
   * Publishes a message with the given event name and payload to the channel. Runs as a Temporal activity.
   *
   * When idempotent publishing is enabled (see `TemporalRestOptions.idempotentPublishing`), the message is
   * published with an ID of the form `<base>:0`. The workflow derives the base deterministically, so every attempt
   * of the activity publishes the same ID, and Ably deduplicates a retry that arrives within its idempotency
   * window.
   *
   * @param name - The event name of the message.
   * @param data - The payload of the message.
   * @param options - Optional parameters sent as part of the query string.
   * @returns A promise which is fulfilled with the serial of the published message.
   */
  publish(name: string, data: any, options?: Ably.PublishOptions): Promise<Ably.PublishResult>;
  async publish(...args: any[]): Promise<Ably.PublishResult> {
    const [first, second] = args;
    let messages: Ably.Message[];
    let options: Ably.PublishOptions | undefined;

    if (typeof first === 'string' || first === null) {
      messages = [{ name: first, data: second }];
      options = args[2];
    } else if (isPlainObject(first)) {
      messages = [first];
      options = args[1];
    } else if (Array.isArray(first)) {
      messages = first;
      options = args[1];
    } else {
      throw ablyFailure({
        message:
          'publish() expects an event name (string or null), a message object, or an array of message objects as its first argument',
        code: 40003,
        statusCode: 400,
        remediation:
          'Call publish(name, data) for a single event, or publish(message | message[]) with a Message-shaped object.',
      });
    }

    return this.invoker.invoke(ActivityNames.publish, `publish ${this.name}`, {
      channel: this.name,
      messages: this.invoker.assignMessageIds(messages),
      ...(options ? { options } : {}),
    });
  }

  /**
   * Retrieves the message history of the channel. Runs as a Temporal activity.
   *
   * @param params - Restricts which messages are retrieved.
   * @returns A promise which is fulfilled with the first page of {@link Ably.InboundMessage} objects.
   */
  async history(params?: Ably.HttpHistoryParams): Promise<TemporalPaginatedResult<Ably.InboundMessage>> {
    return paginate(
      (pageParams, relation) =>
        this.invoker.invoke(ActivityNames.history, pageSummary(`history ${this.name}`, relation), {
          channel: this.name,
          params: pageParams,
        }),
      params,
    );
  }

  /**
   * Retrieves the status and occupancy metrics of the channel. Runs as a Temporal activity.
   *
   * @returns A promise which is fulfilled with the {@link Ably.ChannelDetails} of the channel.
   */
  async status(): Promise<Ably.ChannelDetails> {
    return this.invoker.invoke(ActivityNames.status, `status ${this.name}`, { channel: this.name });
  }

  /**
   * Retrieves the latest version of a message. Runs as a Temporal activity.
   *
   * @param serialOrMessage - The `serial` of the message, or a message with a populated `serial`.
   * @returns A promise which is fulfilled with the latest version of the message.
   */
  async getMessage(serialOrMessage: string | Ably.Message): Promise<Ably.Message> {
    return this.invoker.invoke(ActivityNames.getMessage, `getMessage ${this.name}`, {
      channel: this.name,
      serialOrMessage: serialArgument('getMessage', serialOrMessage),
    });
  }

  /**
   * Publishes an update to an existing message, with patch semantics. Runs as a Temporal activity.
   *
   * When idempotent publishing is enabled (see `TemporalRestOptions.idempotentPublishing`) and `options` has no
   * `idempotencyKey`, the update is published with a key that the workflow derives deterministically, so every attempt
   * of the activity sends the same key. Ably returns the result of the first attempt for a retry that arrives within
   * its deduplication window. A caller-supplied `idempotencyKey` must be unique among the operations on the channel.
   *
   * @param message - A message with a populated `serial`, and the fields to update.
   * @param operation - Metadata about the update operation.
   * @param options - Optional parameters sent as part of the query string.
   * @returns A promise which is fulfilled with the serial of the new version of the message.
   */
  async updateMessage(
    message: Ably.Message,
    operation?: Ably.MessageOperation,
    options?: Ably.PublishOptions,
  ): Promise<Ably.UpdateDeleteResult> {
    requireObject('updateMessage', 'message', message, MESSAGE_REMEDIATION);
    return this.invoker.invoke(ActivityNames.updateMessage, `updateMessage ${this.name}`, {
      channel: this.name,
      message,
      operation,
      options: this.invoker.withIdempotencyKey(options),
    });
  }

  /**
   * Marks a message as deleted by publishing an update with an action of `message.delete`, with patch semantics.
   * Runs as a Temporal activity.
   *
   * When idempotent publishing is enabled (see `TemporalRestOptions.idempotentPublishing`) and `options` has no
   * `idempotencyKey`, the delete is published with a key that the workflow derives deterministically, so every attempt
   * of the activity sends the same key. Ably returns the result of the first attempt for a retry that arrives within
   * its deduplication window. A caller-supplied `idempotencyKey` must be unique among the operations on the channel.
   *
   * @param message - A message with a populated `serial`.
   * @param operation - Metadata about the delete operation.
   * @param options - Optional parameters sent as part of the query string.
   * @returns A promise which is fulfilled with the serial of the new version of the message.
   */
  async deleteMessage(
    message: Ably.Message,
    operation?: Ably.MessageOperation,
    options?: Ably.PublishOptions,
  ): Promise<Ably.UpdateDeleteResult> {
    requireObject('deleteMessage', 'message', message, MESSAGE_REMEDIATION);
    return this.invoker.invoke(ActivityNames.deleteMessage, `deleteMessage ${this.name}`, {
      channel: this.name,
      message,
      operation,
      options: this.invoker.withIdempotencyKey(options),
    });
  }

  /**
   * Appends data to an existing message. Runs as a Temporal activity.
   *
   * The append is published without an idempotency key, because Ably applies a retried append again even when the
   * retry has the same key. A retried activity appends the data again.
   *
   * @param message - A message with a populated `serial`, and the data to append.
   * @param operation - Metadata about the append operation.
   * @param options - Optional parameters sent as part of the query string.
   * @returns A promise which is fulfilled with the serial of the new version of the message.
   */
  async appendMessage(
    message: Ably.Message,
    operation?: Ably.MessageOperation,
    options?: Ably.PublishOptions,
  ): Promise<Ably.UpdateDeleteResult> {
    requireObject('appendMessage', 'message', message, MESSAGE_REMEDIATION);
    return this.invoker.invoke(ActivityNames.appendMessage, `appendMessage ${this.name}`, {
      channel: this.name,
      message,
      operation,
      options,
    });
  }

  /**
   * Retrieves every version of a message, ordered by version. Runs as a Temporal activity.
   *
   * @param serialOrMessage - The `serial` of the message, or a message with a populated `serial`.
   * @param params - Optional parameters sent as part of the query string.
   * @returns A promise which is fulfilled with the first page of versions of the message.
   */
  async getMessageVersions(
    serialOrMessage: string | Ably.Message,
    params?: Record<string, any>,
  ): Promise<TemporalPaginatedResult<Ably.Message>> {
    const serial = serialArgument('getMessageVersions', serialOrMessage);
    return paginate(
      (pageParams, relation) =>
        this.invoker.invoke(
          ActivityNames.getMessageVersions,
          pageSummary(`getMessageVersions ${this.name}`, relation),
          { channel: this.name, serialOrMessage: serial, params: pageParams },
        ),
      params,
    );
  }
}

/**
 * Creates and caches the channels of a `TemporalRest` instance. It mirrors the Ably REST `Channels`.
 */
export class TemporalRestChannels {
  private readonly all: Record<string, TemporalRestChannel> = Object.create(null);

  /** @internal */
  constructor(private readonly invoker: ActivityInvoker) {}

  /**
   * Gets the channel with the given name, creating it if it does not exist. Getting a channel does not run an
   * activity.
   *
   * Channel options, such as a `cipher`, are configured on the worker, with `AblyRestPluginOptions.channelOptions`.
   *
   * @param name - The channel name.
   * @returns The channel.
   */
  get(name: string): TemporalRestChannel {
    // A caller that bypasses the type of this method could pass channel options, which would otherwise be ignored.
    if (arguments.length > 1 && arguments[1] !== undefined) {
      throw ablyFailure({
        message: `channels.get() in workflow code does not take channel options, but was called with options for channel "${name}"`,
        code: 40003,
        statusCode: 400,
        remediation:
          'Call channels.get() with the channel name only. Configure channel options, such as a cipher, with the channelOptions function of AblyRestPlugin on the worker.',
      });
    }
    name = String(name);
    return (this.all[name] ??= new TemporalRestChannel(this.invoker, name));
  }
}
