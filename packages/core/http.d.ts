/**
 * The part of the Pub/Sub type surface that only the stateless HTTP client uses: the client itself,
 * its REST channel and presence, and the types reachable from nothing else.
 *
 * It is kept apart from ./types.d.ts so that `@ably/pubsub-device`, which has no HTTP client, can
 * star-export the rest of the surface without it. TypeScript has no way to re-export a module minus
 * some names. ./ably.d.ts re-exports both halves.
 */

/* eslint-disable no-unused-vars, @typescript-eslint/no-unused-vars */
import type {
  Annotation,
  Auth,
  BatchPresenceFailureResult,
  BatchPresenceSuccessResult,
  BatchPublishFailureResult,
  BatchPublishSpec,
  BatchPublishSuccessResult,
  BatchResult,
  ChannelMode,
  ChannelModes,
  ChannelOptions,
  Channels,
  ClientOptions,
  ErrorInfo,
  GetAnnotationsParams,
  HttpPaginatedResponse,
  InboundMessage,
  Message,
  MessageOperation,
  OutboundAnnotation,
  PaginatedResult,
  PresenceAction,
  PresenceMessage,
  PublishOptions,
  PublishResult,
  Push,
  RealtimeChannel,
  Stats,
  StatsParams,
  TokenRequest,
  UpdateDeleteResult,
} from './types';
/* eslint-enable no-unused-vars, @typescript-eslint/no-unused-vars */

/**
 * Contains the details of a {@link HttpChannel} or {@link RealtimeChannel} object such as its ID and {@link ChannelStatus}.
 */
export interface ChannelDetails {
  /**
   * The identifier of the channel.
   */
  channelId: string;
  /**
   * A {@link ChannelStatus} object.
   */
  status: ChannelStatus;
}

/**
 * Contains the status of a {@link HttpChannel} or {@link RealtimeChannel} object such as whether it is active and its {@link ChannelOccupancy}.
 */
export interface ChannelStatus {
  /**
   * If `true`, the channel is active, otherwise `false`.
   */
  isActive: boolean;
  /**
   * A {@link ChannelOccupancy} object.
   */
  occupancy: ChannelOccupancy;
}

/**
 * Contains the metrics of a {@link HttpChannel} or {@link RealtimeChannel} object.
 */
export interface ChannelOccupancy {
  /**
   * A {@link ChannelMetrics} object.
   */
  metrics: ChannelMetrics;
}

/**
 * Contains the metrics associated with a {@link HttpChannel} or {@link RealtimeChannel}, such as the number of publishers, subscribers and connections it has.
 */
export interface ChannelMetrics {
  /**
   * The number of realtime connections attached to the channel.
   */
  connections: number;
  /**
   * The number of realtime connections attached to the channel with permission to enter the presence set, regardless of whether or not they have entered it. This requires the `presence` capability and for a client to not have specified a {@link ChannelMode} flag that excludes {@link ChannelModes.PRESENCE}.
   */
  presenceConnections: number;
  /**
   * The number of members in the presence set of the channel.
   */
  presenceMembers: number;
  /**
   * The number of realtime attachments receiving presence messages on the channel. This requires the `subscribe` capability and for a client to not have specified a {@link ChannelMode} flag that excludes {@link ChannelModes.PRESENCE_SUBSCRIBE}.
   */
  presenceSubscribers: number;
  /**
   * The number of realtime attachments permitted to publish messages to the channel. This requires the `publish` capability and for a client to not have specified a {@link ChannelMode} flag that excludes {@link ChannelModes.PUBLISH}.
   */
  publishers: number;
  /**
   * The number of realtime attachments receiving messages on the channel. This requires the `subscribe` capability and for a client to not have specified a {@link ChannelMode} flag that excludes {@link ChannelModes.MESSAGE_SUBSCRIBE}.
   */
  subscribers: number;
}

/**
 * The `HttpHistoryParams` interface describes the parameters accepted by the following methods:
 *
 * - {@link HttpPresence.history}
 * - {@link HttpChannel.history}
 */
export interface HttpHistoryParams {
  /**
   * The time from which messages are retrieved, specified as milliseconds since the Unix epoch.
   */
  start?: number;
  /**
   * The time until messages are retrieved, specified as milliseconds since the Unix epoch.
   *
   * @defaultValue The current time.
   */
  end?: number;
  /**
   * The order for which messages are returned in. Valid values are `'backwards'` which orders messages from most recent to oldest, or `'forwards'` which orders messages from oldest to most recent. The default is `'backwards'`.
   *
   * @defaultValue `'backwards'`
   */
  direction?: 'forwards' | 'backwards';
  /**
   * An upper limit on the number of messages returned. The default is 100, and the maximum is 1000.
   *
   * @defaultValue 100
   */
  limit?: number;
}

/**
 * The `HttpPresenceParams` interface describes the parameters accepted by {@link HttpPresence.get}.
 */
export interface HttpPresenceParams {
  /**
   * An upper limit on the number of messages returned. The default is 100, and the maximum is 1000.
   *
   * @defaultValue 100
   */
  limit?: number;
  /**
   * Filters the list of returned presence members by a specific client using its ID.
   */
  clientId?: string;
  /**
   * Filters the list of returned presence members by a specific connection using its ID.
   */
  connectionId?: string;
}

// Interfaces
/**
 * A client that offers a simple stateless API to interact directly with Ably's REST API.
 */
export declare interface PubSubHttpClient {
  /**
   * An {@link Auth} object.
   */
  auth: Auth;
  /**
   * A {@link Channels} object.
   */
  channels: Channels<HttpChannel>;
  /**
   * Makes a REST request to a provided path. This is provided as a convenience for developers who wish to use REST API functionality that is either not documented or is not yet included in the public API, without having to directly handle features such as authentication, paging, fallback hosts, MsgPack and JSON support.
   *
   * @param method - The request method to use, such as `GET`, `POST`.
   * @param path - The request path.
   * @param version - The version of the Ably REST API to use. See the [REST API reference](https://ably.com/docs/api/rest-api#versioning) for information on versioning.
   * @param params - The parameters to include in the URL query of the request. The parameters depend on the endpoint being queried. See the [REST API reference](https://ably.com/docs/api/rest-api) for the available parameters of each endpoint.
   * @param body - The JSON body of the request.
   * @param headers - Additional HTTP headers to include in the request.
   * @returns A promise which, upon success, will be fulfilled with an {@link HttpPaginatedResponse} response object returned by the HTTP request. This response object will contain an empty or JSON-encodable object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  request<T = any>(
    method: string,
    path: string,
    version: number,
    params?: any,
    body?: any[] | any,
    headers?: any,
  ): Promise<HttpPaginatedResponse<T>>;
  /**
   * Queries the REST `/stats` API and retrieves your application's usage statistics. Returns a {@link PaginatedResult} object, containing an array of {@link Stats} objects. See the [Stats docs](https://ably.com/docs/general/statistics).
   *
   * @param params - A set of parameters which are used to specify which statistics should be retrieved. If you do not provide this argument, then this method will use the default parameters described in the {@link StatsParams} interface.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link Stats} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  stats(params?: StatsParams): Promise<PaginatedResult<Stats>>;
  /**
   * Retrieves the time from the Ably service as milliseconds since the Unix epoch. Clients that do not have access to a sufficiently well maintained time source and wish to issue Ably {@link TokenRequest | `TokenRequest`s} with a more accurate timestamp should use the {@link ClientOptions.queryTime} property instead of this method.
   *
   * @returns A promise which, upon success, will be fulfilled with the time as milliseconds since the Unix epoch. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  time(): Promise<number>;

  /**
   * Publishes a {@link BatchPublishSpec} object to one or more channels, up to a maximum of 100 channels.
   *
   * @param spec - A {@link BatchPublishSpec} object.
   * @returns A promise which, upon success, will be fulfilled with a {@link BatchResult} object containing information about the result of the batch publish for each requested channel. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  batchPublish(spec: BatchPublishSpec): Promise<BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>>;
  /**
   * Publishes one or more {@link BatchPublishSpec} objects to one or more channels, up to a maximum of 100 channels.
   *
   * @param specs - An array of {@link BatchPublishSpec} objects.
   * @returns A promise which, upon success, will be fulfilled with an array of {@link BatchResult} objects containing information about the result of the batch publish for each requested channel for each provided {@link BatchPublishSpec}. This array is in the same order as the provided {@link BatchPublishSpec} array. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  batchPublish(
    specs: BatchPublishSpec[],
  ): Promise<BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>[]>;
  /**
   * Retrieves the presence state for one or more channels, up to a maximum of 100 channels. Presence state includes the `clientId` of members and their current {@link PresenceAction}.
   *
   * @param channels - An array of one or more channel names, up to a maximum of 100 channels.
   * @returns A promise which, upon success, will be fulfilled with a {@link BatchResult} object containing information about the result of the batch presence request for each requested channel. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  batchPresence(channels: string[]): Promise<BatchResult<BatchPresenceSuccessResult | BatchPresenceFailureResult>[]>;
  /**
   * A {@link Push} object.
   */
  push: Push;
}

/**
 * Enables the retrieval of the current and historic presence set for a channel.
 */
export declare interface HttpPresence {
  /**
   * Retrieves the current members present on the channel and the metadata for each member, such as their {@link PresenceAction} and ID. Returns a {@link PaginatedResult} object, containing an array of {@link PresenceMessage} objects.
   *
   * @param params - A set of parameters which are used to specify which presence members should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link PresenceMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/presence#get
   */
  get(params?: HttpPresenceParams): Promise<PaginatedResult<PresenceMessage>>;
  /**
   * Retrieves a {@link PaginatedResult} object, containing an array of historical {@link PresenceMessage} objects for the channel. If the channel is configured to persist messages, then presence messages can be retrieved from history for up to 72 hours in the past. If not, presence messages can only be retrieved from history for up to two minutes in the past.
   *
   * @param params - A set of parameters which are used to specify which messages should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link PresenceMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/presence#history
   */
  history(params?: HttpHistoryParams): Promise<PaginatedResult<PresenceMessage>>;
}

/**
 * Enables messages to be published and historic messages to be retrieved for a channel.
 */
export declare interface HttpChannel {
  /**
   * The channel name.
   */
  name: string;

  /**
   * A {@link HttpPresence} object.
   */
  presence: HttpPresence;
  /**
   * {@link HttpAnnotations}
   */
  annotations: HttpAnnotations;
  /**
   * Retrieves a {@link PaginatedResult} object, containing an array of historical {@link InboundMessage} objects for the channel. If the channel is configured to persist messages, then messages can be retrieved from history for up to 72 hours in the past. If not, messages can only be retrieved from history for up to two minutes in the past.
   *
   * @param params - A set of parameters which are used to specify which messages should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link InboundMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#history
   */
  history(params?: HttpHistoryParams): Promise<PaginatedResult<InboundMessage>>;
  /**
   * Publishes an array of messages to the channel.
   *
   * @param messages - An array of {@link Message} objects.
   * @param options - Optional parameters, such as [`quickAck`](https://faqs.ably.com/why-are-some-rest-publishes-on-a-channel-slow-and-then-typically-faster-on-subsequent-publishes) sent as part of the query string.
   * @returns A promise which, upon success, will be fulfilled with a {@link PublishResult} object containing the serials of the published messages. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#publish
   */
  publish(messages: Message[], options?: PublishOptions): Promise<PublishResult>;
  /**
   * Publishes a message to the channel.
   *
   * @param message - A {@link Message} object.
   * @param options - Optional parameters, such as [`quickAck`](https://faqs.ably.com/why-are-some-rest-publishes-on-a-channel-slow-and-then-typically-faster-on-subsequent-publishes) sent as part of the query string.
   * @returns A promise which, upon success, will be fulfilled with a {@link PublishResult} object containing the serial of the published message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#publish
   */
  publish(message: Message, options?: PublishOptions): Promise<PublishResult>;
  /**
   * Publishes a single message to the channel with the given event name and payload.
   *
   * @param name - The name of the message.
   * @param data - The payload of the message.
   * @param options - Optional parameters, such as [`quickAck`](https://faqs.ably.com/why-are-some-rest-publishes-on-a-channel-slow-and-then-typically-faster-on-subsequent-publishes) sent as part of the query string.
   * @returns A promise which, upon success, will be fulfilled with a {@link PublishResult} object containing the serial of the published message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#publish
   */
  publish(name: string, data: any, options?: PublishOptions): Promise<PublishResult>;
  /**
   * Retrieves a {@link ChannelDetails} object for the channel, which includes status and occupancy metrics.
   *
   * @returns A promise which, upon success, will be fulfilled a {@link ChannelDetails} object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#status
   */
  status(): Promise<ChannelDetails>;
  /**
   * Retrieves the latest version of a specific message by its serial identifier.
   *
   * The channel must be configured to allow message updates, enabled by a [rule](https://ably.com/docs/channels#rules).
   *
   * The supplied serial or {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * @param serialOrMessage - Either the serial identifier string of the message to retrieve, or a {@link Message} object containing a populated `serial` field.
   * @returns A promise which, upon success, will be fulfilled with a {@link Message} object representing the latest version of the message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const message = await channel.getMessage(serial);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#get-message
   */
  getMessage(serialOrMessage: string | Message): Promise<Message>;
  /**
   * Publishes an update to an existing message with patch semantics. Non-null `name`, `data`, and `extras` fields in the provided message replace the corresponding fields in the existing message, while null fields are left unchanged.
   *
   * The channel must be configured to allow message updates, enabled by a [rule](https://ably.com/docs/channels#rules).
   *
   * The supplied {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * @param message - A {@link Message} object containing a populated `serial` field and the fields to update.
   * @param operation - An optional {@link MessageOperation} object containing metadata about the update operation.
   * @param options - Optional parameters to modify how the publish is made.
   * @returns A promise which, upon success, will be fulfilled with an {@link UpdateDeleteResult} object containing the serial of the new version of the message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * await channel.updateMessage({ ...message, data: 'edited text' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#update-message
   */
  updateMessage(message: Message, operation?: MessageOperation, options?: PublishOptions): Promise<UpdateDeleteResult>;
  /**
   * Marks a message as deleted by publishing an update with an action of `MESSAGE_DELETE`. This does not remove the message from the server, and the full message history remains accessible.
   *
   * Uses patch semantics: non-null `name`, `data`, and `extras` fields in the provided message replace the corresponding fields in the existing message, while null fields are left unchanged. A deleted message keeps its previous `data` unless the delete explicitly sets `data` to an empty value.
   *
   * The channel must be configured to allow message deletes, enabled by a [rule](https://ably.com/docs/channels#rules).
   *
   * The supplied {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * @param message - A {@link Message} object containing a populated `serial` field.
   * @param operation - An optional {@link MessageOperation} object containing metadata about the delete operation.
   * @param options - Optional parameters to modify how the publish is made.
   * @returns A promise which, upon success, will be fulfilled with an {@link UpdateDeleteResult} object containing the serial of the new version of the message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const result = await channel.deleteMessage(message);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#delete-message
   */
  deleteMessage(message: Message, operation?: MessageOperation, options?: PublishOptions): Promise<UpdateDeleteResult>;
  /**
   * Appends data to an existing message. The supplied `data` field is appended to the previous message's data, while all other fields (`name`, `extras`) replace the previous values if provided.
   *
   * The channel must be configured to allow message appends, enabled by a [rule](https://ably.com/docs/channels#rules).
   *
   * The supplied {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * @param message - A {@link Message} object containing a populated `serial` field and the data to append.
   * @param operation - An optional {@link MessageOperation} object containing metadata about the append operation.
   * @param options - Optional parameters to modify how the publish is made.
   * @returns A promise which, upon success, will be fulfilled with an {@link UpdateDeleteResult} object containing the serial of the new version of the message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const result = await channel.appendMessage({ ...message, data: ' more text' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#append-message
   */
  appendMessage(message: Message, operation?: MessageOperation, options?: PublishOptions): Promise<UpdateDeleteResult>;
  /**
   * Patches an existing message: atomically sets, appends to or removes values inside its JSON `data`, and sets or removes its headers. Only the `patches` field changes the message. Subscribers receive the patch as a `message.patch`, and apply it to their copy with {@link Message.applyPatch}.
   *
   * The channel must be configured to allow message appends, enabled by a [rule](https://ably.com/docs/channels#rules).
   *
   * The supplied {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * @param message - A {@link Message} object containing a populated `serial` field and the `patches` to apply.
   * @param operation - An optional {@link MessageOperation} object containing metadata about the patch operation.
   * @param options - Optional parameters to modify how the publish is made.
   * @returns A promise which, upon success, will be fulfilled with an {@link UpdateDeleteResult} object containing the serial of the new version of the message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const result = await channel.patchMessage({
   *   serial: message.serial,
   *   patches: {
   *     data: [{ op: 'append', path: '/content/0/text', data: ' more text' }],
   *     extras: { headers: [{ op: 'set', key: 'status', value: 'complete' }] },
   *   },
   * });
   * ```
   */
  patchMessage(message: Message, operation?: MessageOperation, options?: PublishOptions): Promise<UpdateDeleteResult>;
  /**
   * Retrieves all historical versions of a specific message, ordered by version. This includes the original message and all subsequent update, delete, or append operations.
   *
   * The supplied serial or {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * Message versions exist only when the channel is configured to allow updating, deleting, or appending messages, enabled by a [rule](https://ably.com/docs/channels#rules).
   *
   * @param serialOrMessage - Either the serial identifier string of the message whose versions are to be retrieved, or a {@link Message} object containing a populated `serial` field.
   * @param params - Optional parameters sent as part of the query string.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link Message} objects representing all versions of the message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const versions = await channel.getMessageVersions(message);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#get-message-versions
   */
  getMessageVersions(
    serialOrMessage: string | Message,
    params?: Record<string, any>,
  ): Promise<PaginatedResult<Message>>;
}

/**
 * Functionality for annotating messages with small pieces of data, such as emoji
 * reactions, that the server will roll up into the message as a summary.
 */
export declare interface HttpAnnotations {
  /**
   * Publish a new annotation for a message. If the annotation specifies no `action`, it defaults to `annotation.create`.
   *
   * The supplied {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations), and the key or token must have the `annotation-publish` capability. Without either the server rejects the operation, so the call rejects with an {@link ErrorInfo}.
   *
   * Annotation data is encrypted when {@link ChannelOptions.cipher} is set, as it is for messages and presence messages.
   *
   * @param message - The message to annotate.
   * @param annotation - The annotation to publish. It must include at least the `type`. Other required fields depend on the annotation type.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.annotations.publish(message, { type: 'emoji:distinct.v1', name: '👍' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/rest-annotations#annotations-publish
   */
  publish(message: Message, annotation: OutboundAnnotation): Promise<void>;
  /**
   * Publish a new annotation for a message. If the annotation specifies no `action`, it defaults to `annotation.create`.
   *
   * The supplied serial must be a non-empty string, otherwise the call rejects with an {@link ErrorInfo}.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations), and the key or token must have the `annotation-publish` capability. Without either the server rejects the operation, so the call rejects with an {@link ErrorInfo}.
   *
   * Annotation data is encrypted when {@link ChannelOptions.cipher} is set, as it is for messages and presence messages.
   *
   * @param messageSerial - The serial field of the message to annotate.
   * @param annotation - The annotation to publish. It must include at least the `type`. Other required fields depend on the annotation type.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.annotations.publish(messageSerial, { type: 'emoji:distinct.v1', name: '👍' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/rest-annotations#annotations-publish
   */
  publish(messageSerial: string, annotation: OutboundAnnotation): Promise<void>;
  /**
   * Publish an annotation removal request for a message, to remove it from the message's annotation summary. The semantics of a delete, and the fields it requires, differ by annotation type.
   *
   * It sets `action` to `annotation.delete` on the annotation object you pass, overwriting any `action` you set.
   *
   * The supplied {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations), and the key or token must have the `annotation-publish` capability. Without either the server rejects the operation, so the call rejects with an {@link ErrorInfo}.
   *
   * @param message - The message which has an annotation that you want to delete.
   * @param annotation - The annotation deletion request. It must include at least the `type`. Other required fields depend on the type.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.annotations.delete(message, { type: 'emoji:distinct.v1', name: '👍' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/rest-annotations#annotations-delete
   */
  delete(message: Message, annotation: OutboundAnnotation): Promise<void>;
  /**
   * Publish an annotation removal request for a message, to remove it from the message's annotation summary. The semantics of a delete, and the fields it requires, differ by annotation type.
   *
   * It sets `action` to `annotation.delete` on the annotation object you pass, overwriting any `action` you set.
   *
   * The supplied serial must be a non-empty string, otherwise the call rejects with an {@link ErrorInfo}.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations), and the key or token must have the `annotation-publish` capability. Without either the server rejects the operation, so the call rejects with an {@link ErrorInfo}.
   *
   * @param messageSerial - The serial field of the message which has an annotation that
   * you want to delete.
   * @param annotation - The annotation deletion request. It must include at least the `type`. Other required fields depend on the type.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.annotations.delete(messageSerial, { type: 'emoji:distinct.v1', name: '👍' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/rest-annotations#annotations-delete
   */
  delete(messageSerial: string, annotation: OutboundAnnotation): Promise<void>;
  /**
   * Get all annotations for a given message.
   *
   * The supplied {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations). Without it the call rejects with an {@link ErrorInfo}.
   *
   * @param message - The message to get annotations for.
   * @param params - Restrictions on which annotations to get, in particular a limit.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link Annotation} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const result = await channel.annotations.get(message, null);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/rest-annotations#annotations-get
   */
  get(message: Message, params: GetAnnotationsParams | null): Promise<PaginatedResult<Annotation>>;
  /**
   * Get all annotations for a given message.
   *
   * The supplied serial must be a non-empty string, otherwise the call rejects with an {@link ErrorInfo}.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations). Without it the call rejects with an {@link ErrorInfo}.
   *
   * @param messageSerial - The `serial` of the message to get annotations for.
   * @param params - Restrictions on which annotations to get, in particular a limit.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link Annotation} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const result = await channel.annotations.get(messageSerial, null);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/rest-annotations#annotations-get
   */
  get(messageSerial: string, params: GetAnnotationsParams | null): Promise<PaginatedResult<Annotation>>;
}
