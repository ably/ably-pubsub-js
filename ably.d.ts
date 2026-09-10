// Type definitions for Ably Realtime and Rest client library 1.2
// Project: https://www.ably.com/
// Definitions by: Ably <https://github.com/ably/>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

/**
 * You are currently viewing the default variant of the Ably JavaScript Client Library SDK. View the modular variant {@link modular | here}.
 *
 * To get started with the Ably JavaScript Client Library SDK, follow the [Quickstart Guide](https://ably.com/docs/quick-start-guide) or view the introductions to the [realtime](https://ably.com/docs/realtime/usage) and [REST](https://ably.com/docs/rest/usage) interfaces.
 *
 * @module
 */

/**
 * The `ChannelStates` namespace describes the possible values of the {@link ChannelState} type.
 */
declare namespace ChannelStates {
  /**
   * The channel has been initialized but no attach has yet been attempted.
   */
  type INITIALIZED = 'initialized';
  /**
   * An attach has been initiated by sending a request to Ably. This is a transient state, followed either by a transition to `ATTACHED`, `SUSPENDED`, or `FAILED`.
   */
  type ATTACHING = 'attaching';
  /**
   * The attach has succeeded. In the `ATTACHED` state a client may publish and subscribe to messages, or be present on the channel.
   */
  type ATTACHED = 'attached';
  /**
   * A detach has been initiated on an `ATTACHED` channel by sending a request to Ably. This is a transient state, followed either by a transition to `DETACHED` or `FAILED`.
   */
  type DETACHING = 'detaching';
  /**
   * The channel, having previously been `ATTACHED`, has been detached by the user.
   */
  type DETACHED = 'detached';
  /**
   * The channel, having previously been `ATTACHED`, is waiting for the client to reconnect to Ably after an extended period of disconnection. It will automatically reattach once connectivity is restored. Message continuity may have been lost, but the authoritative source for this is the {@link ChannelStateChange.resumed | `resumed`} flag on the subsequent `attached` state change.
   */
  type SUSPENDED = 'suspended';
  /**
   * An indefinite failure condition. This state is entered if a channel error has been received from the Ably service, such as an attempt to attach without the necessary access rights.
   */
  type FAILED = 'failed';
}
/**
 * Describes the possible states of a {@link Channel} or {@link RealtimeChannel} object.
 */
export type ChannelState =
  | ChannelStates.FAILED
  | ChannelStates.INITIALIZED
  | ChannelStates.SUSPENDED
  | ChannelStates.ATTACHED
  | ChannelStates.ATTACHING
  | ChannelStates.DETACHED
  | ChannelStates.DETACHING;

/**
 * The `ChannelEvents` namespace describes the possible values of the {@link ChannelEvent} type.
 */
declare namespace ChannelEvents {
  /**
   * The channel has been initialized but no attach has yet been attempted.
   */
  type INITIALIZED = 'initialized';
  /**
   * An attach has been initiated by sending a request to Ably. This is a transient state, followed either by a transition to `ATTACHED`, `SUSPENDED`, or `FAILED`.
   */
  type ATTACHING = 'attaching';
  /**
   * The attach has succeeded. In the `ATTACHED` state a client may publish and subscribe to messages, or be present on the channel.
   */
  type ATTACHED = 'attached';
  /**
   * A detach has been initiated on an `ATTACHED` channel by sending a request to Ably. This is a transient state, followed either by a transition to `DETACHED` or `FAILED`.
   */
  type DETACHING = 'detaching';
  /**
   * The channel, having previously been `ATTACHED`, has been detached by the user.
   */
  type DETACHED = 'detached';
  /**
   * The channel, having previously been `ATTACHED`, is waiting for the client to reconnect to Ably after an extended period of disconnection. It will automatically reattach once connectivity is restored. Message continuity may have been lost, but the authoritative source for this is the {@link ChannelStateChange.resumed | `resumed`} flag on the subsequent `attached` state change.
   */
  type SUSPENDED = 'suspended';
  /**
   * An indefinite failure condition. This state is entered if a channel error has been received from the Ably service, such as an attempt to attach without the necessary access rights.
   */
  type FAILED = 'failed';
  /**
   * An event for changes to channel conditions that do not result in a change in {@link ChannelState}.
   */
  type UPDATE = 'update';
}
/**
 * Describes the events emitted by a {@link Channel} or {@link RealtimeChannel} object. An event is either an `UPDATE` or a {@link ChannelState}.
 */
export type ChannelEvent =
  | ChannelEvents.FAILED
  | ChannelEvents.INITIALIZED
  | ChannelEvents.SUSPENDED
  | ChannelEvents.ATTACHED
  | ChannelEvents.ATTACHING
  | ChannelEvents.DETACHED
  | ChannelEvents.DETACHING
  | ChannelEvents.UPDATE;

/**
 * The `ConnectionStates` namespace describes the possible values of the {@link ConnectionState} type.
 */
declare namespace ConnectionStates {
  /**
   * A connection with this state has been initialized but no connection has yet been attempted.
   */
  type INITIALIZED = 'initialized';
  /**
   * A connection attempt has been initiated. The connecting state is entered as soon as the library has completed initialization, and is reentered each time connection is re-attempted following disconnection.
   */
  type CONNECTING = 'connecting';
  /**
   * A connection exists and is active.
   */
  type CONNECTED = 'connected';
  /**
   * A temporary failure condition. The client has been disconnected from Ably, usually due to network connectivity. It will periodically attempt to open a new connection (about every 15 seconds). In this state, you can continue to publish messages, which will be queued to be sent once a connection is reestablished. Messages published by other clients while this client is disconnected will be delivered to it upon reconnection if the server is able to preserve continuity.
   */
  type DISCONNECTED = 'disconnected';
  /**
   * A long term failure condition. A client moves to this state once it has been in the `disconnected` state for over two minutes. Developers are unable to publish messages in this state, and any queued messages are discarded. The library will attempt to reconnect every 30 seconds; an attempt can also be triggered by calling {@link Connection.connect | `connect()`}.
   */
  type SUSPENDED = 'suspended';
  /**
   * An explicit request by the developer to close the connection has been sent to the Ably service. If a reply is not received from Ably within a short period of time, the connection is forcibly terminated and the connection state becomes `CLOSED`.
   */
  type CLOSING = 'closing';
  /**
   * The connection has been explicitly closed by the client. In the closed state, no reconnection attempts are made automatically by the library, and clients may not publish messages. No connection state is preserved by the service or by the library. A new connection attempt can be triggered by an explicit call to {@link Connection.connect | `connect()`}, which results in a new connection.
   */
  type CLOSED = 'closed';
  /**
   * This state is entered if the client library encounters a failure condition that it cannot recover from. This may be a fatal connection error received from the Ably service, for example an attempt to connect with an incorrect API key, or a local terminal error, for example the token in use has expired and the library does not have any way to renew it. In the failed state, no reconnection attempts are made automatically by the library, and clients may not publish messages. A new connection attempt can be triggered by an explicit call to {@link Connection.connect | `connect()`}.
   */
  type FAILED = 'failed';
}
/**
 * Describes the realtime {@link Connection} object states.
 */
export type ConnectionState =
  | ConnectionStates.INITIALIZED
  | ConnectionStates.CONNECTED
  | ConnectionStates.CONNECTING
  | ConnectionStates.DISCONNECTED
  | ConnectionStates.SUSPENDED
  | ConnectionStates.CLOSED
  | ConnectionStates.CLOSING
  | ConnectionStates.FAILED;

/**
 * The `ConnectionEvents` namespace describes the possible values of the {@link ConnectionEvent} type.
 */
declare namespace ConnectionEvents {
  /**
   * A connection with this state has been initialized but no connection has yet been attempted.
   */
  type INITIALIZED = 'initialized';
  /**
   * A connection attempt has been initiated. The connecting state is entered as soon as the library has completed initialization, and is reentered each time connection is re-attempted following disconnection.
   */
  type CONNECTING = 'connecting';
  /**
   * A connection exists and is active.
   */
  type CONNECTED = 'connected';
  /**
   * A temporary failure condition. The client has been disconnected from Ably, usually due to network connectivity. It will periodically attempt to open a new connection (about every 15 seconds). In this state, you can continue to publish messages, which will be queued to be sent once a connection is reestablished. Messages published by other clients while this client is disconnected will be delivered to it upon reconnection if the server is able to preserve continuity.
   */
  type DISCONNECTED = 'disconnected';
  /**
   * A long term failure condition. A client moves to this state once it has been in the `disconnected` state for over two minutes. Developers are unable to publish messages in this state, and any queued messages are discarded. The library will attempt to reconnect every 30 seconds; an attempt can also be triggered by calling {@link Connection.connect | `connect()`}.
   */
  type SUSPENDED = 'suspended';
  /**
   * An explicit request by the developer to close the connection has been sent to the Ably service. If a reply is not received from Ably within a short period of time, the connection is forcibly terminated and the connection state becomes `CLOSED`.
   */
  type CLOSING = 'closing';
  /**
   * The connection has been explicitly closed by the client. In the closed state, no reconnection attempts are made automatically by the library, and clients may not publish messages. No connection state is preserved by the service or by the library. A new connection attempt can be triggered by an explicit call to {@link Connection.connect | `connect()`}, which results in a new connection.
   */
  type CLOSED = 'closed';
  /**
   * This state is entered if the client library encounters a failure condition that it cannot recover from. This may be a fatal connection error received from the Ably service, for example an attempt to connect with an incorrect API key, or a local terminal error, for example the token in use has expired and the library does not have any way to renew it. In the failed state, no reconnection attempts are made automatically by the library, and clients may not publish messages. A new connection attempt can be triggered by an explicit call to {@link Connection.connect | `connect()`}.
   */
  type FAILED = 'failed';
  /**
   * An event for changes to connection conditions for which the {@link ConnectionState} does not change.
   */
  type UPDATE = 'update';
}
/**
 * Describes the events emitted by a {@link Connection} object. An event is either an `UPDATE` or a {@link ConnectionState}.
 */
export type ConnectionEvent =
  | ConnectionEvents.INITIALIZED
  | ConnectionEvents.CONNECTED
  | ConnectionEvents.CONNECTING
  | ConnectionEvents.DISCONNECTED
  | ConnectionEvents.SUSPENDED
  | ConnectionEvents.CLOSED
  | ConnectionEvents.CLOSING
  | ConnectionEvents.FAILED
  | ConnectionEvents.UPDATE;

/**
 * The `PresenceActions` namespace describes the possible values of the {@link PresenceAction} type.
 */
declare namespace PresenceActions {
  /**
   * A member is not present in the channel.
   */
  type ABSENT = 'absent';
  /**
   * When subscribing to presence events on a channel that already has members present, this event is emitted for every member already present on the channel before the subscribe listener was registered.
   */
  type PRESENT = 'present';
  /**
   * A new member has entered the channel.
   */
  type ENTER = 'enter';
  /**
   * A member who was present has now left the channel. This may be a result of an explicit request to leave or implicitly when detaching from the channel. Alternatively, if a member's connection is abruptly disconnected and they do not resume their connection within a minute, Ably treats this as a leave event as the client is no longer present.
   */
  type LEAVE = 'leave';
  /**
   * An already present member has updated their member data. Being notified of member data updates can be very useful, for example, it can be used to update the status of a user when they are typing a message.
   */
  type UPDATE = 'update';
}
/**
 * Describes the possible actions members in the presence set can emit.
 */
export type PresenceAction =
  | PresenceActions.ABSENT
  | PresenceActions.PRESENT
  | PresenceActions.ENTER
  | PresenceActions.LEAVE
  | PresenceActions.UPDATE;

/**
 * The `StatsIntervalGranularities` namespace describes the possible values of the {@link StatsIntervalGranularity} type.
 */
declare namespace StatsIntervalGranularities {
  /**
   * Interval unit over which statistics are gathered as minutes.
   */
  type MINUTE = 'minute';
  /**
   * Interval unit over which statistics are gathered as hours.
   */
  type HOUR = 'hour';
  /**
   * Interval unit over which statistics are gathered as days.
   */
  type DAY = 'day';
  /**
   * Interval unit over which statistics are gathered as months.
   */
  type MONTH = 'month';
}
/**
 * Describes the interval unit over which statistics are gathered.
 */
export type StatsIntervalGranularity =
  | StatsIntervalGranularities.MINUTE
  | StatsIntervalGranularities.HOUR
  | StatsIntervalGranularities.DAY
  | StatsIntervalGranularities.MONTH;

/**
 * HTTP Methods, used internally.
 */
declare namespace HTTPMethods {
  /**
   * Represents a HTTP POST request.
   */
  type POST = 'POST';
  /**
   * Represents a HTTP GET request.
   */
  type GET = 'GET';
}
/**
 * HTTP Methods, used internally.
 */
export type HTTPMethod = HTTPMethods.GET | HTTPMethods.POST;

/**
 * A type which specifies the valid transport names. [See here](https://faqs.ably.com/which-transports-are-supported) for more information.
 */
export type Transport = 'web_socket' | 'xhr_polling' | 'comet';

/**
 * Unique symbol used to brand LiveObject interfaces (LiveMap, LiveCounter).
 * This enables TypeScript to distinguish between these otherwise empty interfaces,
 * which would be structurally identical without this discriminating property.
 *
 * This symbol is exported from 'ably' so that the types in 'ably/liveobjects'
 * (both ESM and CJS versions) share the same symbol, ensuring type compatibility.
 */
export declare const __livetype: unique symbol;

/**
 * Contains the details of a {@link Channel} or {@link RealtimeChannel} object such as its ID and {@link ChannelStatus}.
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
 * Contains the status of a {@link Channel} or {@link RealtimeChannel} object such as whether it is active and its {@link ChannelOccupancy}.
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
 * Contains the metrics of a {@link Channel} or {@link RealtimeChannel} object.
 */
export interface ChannelOccupancy {
  /**
   * A {@link ChannelMetrics} object.
   */
  metrics: ChannelMetrics;
}

/**
 * Contains the metrics associated with a {@link Channel} or {@link RealtimeChannel}, such as the number of publishers, subscribers and connections it has.
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
   * The number of realtime attachments receiving messages on the channel. This requires the `subscribe` capability and for a client to not have specified a {@link ChannelMode} flag that excludes {@link ChannelModes.SUBSCRIBE}.
   */
  subscribers: number;
}

/**
 * Passes additional client-specific properties to the REST constructor or the Realtime constructor.
 */
export interface ClientOptions<Plugins = CorePlugins> extends AuthOptions {
  /**
   * When `true`, the client connects to Ably as soon as it is instantiated. You can set this to `false` and explicitly connect to Ably using the {@link Connection.connect | `connect()`} method. The default is `true`.
   *
   * @defaultValue `true`
   */
  autoConnect?: boolean;

  /**
   * When `true`, operations that would otherwise fail silently, such as those gated on a channel mode, reject with an {@link ErrorInfo} whose {@link ErrorInfo.remediation | `remediation`} describes the cause and how to fix it. When `false`, the same paths emit a warning log and return their legacy silent value. The default is `false`. A future major version will make the strict behaviour unconditional.
   *
   * @defaultValue `false`
   */
  strictMode?: boolean;

  /**
   * When a {@link TokenParams} object is provided, it overrides the client library defaults when issuing new Ably Tokens or Ably {@link TokenRequest | `TokenRequest`s}.
   */
  defaultTokenParams?: TokenParams;

  /**
   * If `false`, prevents messages originating from this connection being echoed back on the same connection. The default is `true`.
   *
   * @defaultValue `true`
   */
  echoMessages?: boolean;

  /**
   * Set a routing policy or FQDN to connect to Ably. See [platform customization](https://ably.com/docs/platform-customization).
   */
  endpoint?: string;

  /**
   * @deprecated This property is deprecated and will be removed in a future version. Use the {@link ClientOptions.endpoint} client option instead.
   */
  environment?: string;

  /**
   * Controls the verbosity of the logs output from the library. Valid values are: 0 (no logs), 1 (errors only), 2 (errors plus connection and channel state changes), 3 (high-level debug output), and 4 (full debug output).
   */
  logLevel?: number;

  /**
   * Controls the log output of the library. This is a function to handle each line of log output. If you do not set this value, then `console.log` will be used.
   *
   * @param msg - The log message emitted by the library.
   * @param level - The level of the log. Values are one of: 0 (no logs), 1 (errors only), 2 (errors plus connection and channel state changes), 3 (high-level debug output), and 4 (full debug output).
   */
  logHandler?: (msg: string, level: number) => void;

  /**
   * Enables a non-default Ably port to be specified. For development environments only. The default value is 80.
   *
   * @defaultValue 80
   */
  port?: number;

  /**
   * If `false`, this disables the default behavior whereby the library queues messages on a connection in the disconnected or connecting states. The default behavior enables applications to submit messages immediately upon instantiating the library without having to wait for the connection to be established. Applications may use this option to disable queueing if they wish to have application-level control over the queueing. The default is `true`.
   *
   * @defaultValue `true`
   */
  queueMessages?: boolean;

  /**
   * @deprecated This property is deprecated and will be removed in a future version. Use the {@link ClientOptions.endpoint} client option instead.
   */
  restHost?: string;

  /**
   * @deprecated This property is deprecated and will be removed in a future version. Use the {@link ClientOptions.endpoint} client option instead.
   */
  realtimeHost?: string;

  /**
   * An array of fallback hosts to be used in the case of an error necessitating the use of an alternative host. If you have been provided a set of custom fallback hosts by Ably, please specify them here.
   *
   * @defaultValue `['a.ably-realtime.com', 'b.ably-realtime.com', 'c.ably-realtime.com', 'd.ably-realtime.com', 'e.ably-realtime.com']``
   */
  fallbackHosts?: string[];

  /**
   * Set of configurable options to set on the HTTP(S) agent used for REST requests.
   *
   * See the [NodeJS docs](https://nodejs.org/api/http.html#new-agentoptions) for descriptions of these options.
   */
  restAgentOptions?: {
    /**
     * See [NodeJS docs](https://nodejs.org/api/http.html#new-agentoptions)
     */
    maxSockets?: number;
    /**
     * See [NodeJS docs](https://nodejs.org/api/http.html#new-agentoptions)
     */
    keepAlive?: boolean;
  };

  /**
   * Enables a connection to inherit the state of a previous connection that may have existed under a different instance of the Realtime library. This might typically be used by clients of the browser library to ensure connection state can be preserved when the user refreshes the page. A recovery key string can be explicitly provided, or alternatively if a callback function is provided, the client library will automatically persist the recovery key between page reloads and call the callback when the connection is recoverable. The callback is then responsible for confirming whether the connection should be recovered or not. See [connection state recovery](https://ably.com/docs/realtime/connection/#connection-state-recovery) for further information.
   */
  recover?: string | recoverConnectionCallback;

  /**
   * If specified, the SDK's internal persistence mechanism for storing the recovery key
   * over page loads (see the `recover` client option) will store the recovery key under
   * this identifier (in sessionstorage), so only another library instance which specifies
   * the same recoveryKeyStorageName will attempt to recover from it. This is useful if you have
   * multiple ably-js instances sharing a given origin (the origin being the scope of
   * sessionstorage), as otherwise the multiple instances will overwrite each other's
   * recovery keys, and after a reload they will all try and recover the same connection,
   * which is not permitted and will cause broken behaviour.
   */
  recoveryKeyStorageName?: string;

  /**
   * When `false`, the client will use an insecure connection. The default is `true`, meaning a TLS connection will be used to connect to Ably.
   *
   * @defaultValue `true`
   */
  tls?: boolean;

  /**
   * Enables a non-default Ably TLS port to be specified. For development environments only. The default value is 443.
   *
   * @defaultValue 443
   */
  tlsPort?: number;

  /**
   * When `true`, the more efficient MsgPack binary encoding is used. When `false`, JSON text encoding is used. The default is `true` for Node.js, and `false` for all other platforms.
   *
   * @defaultValue `true` for Node.js, `false` for all other platforms
   */
  useBinaryProtocol?: boolean;

  /**
   * Override the URL used by the realtime client to check if the internet is available.
   *
   * In the event of a failure to connect to the primary endpoint, the client will send a
   * GET request to this URL to check if the internet is available. If this request returns
   * a success response the client will attempt to connect to a fallback host.
   */
  connectivityCheckUrl?: string;

  /**
   * Override the URL used by the realtime client to check if WebSocket connections are available.
   *
   * If the client suspects that WebSocket connections are unavailable on the current network,
   * it will attempt to open a WebSocket connection to this URL to check WebSocket connectivity.
   * If this fails, the client will attempt to connect to Ably systems using fallback transports, if available.
   */
  wsConnectivityCheckUrl?: string;

  /**
   * Disable the check used by the realtime client to check if the internet
   * is available before connecting to a fallback host.
   */
  disableConnectivityCheck?: boolean;

  /**
   * If the connection is still in the {@link ConnectionStates.DISCONNECTED} state after this delay in milliseconds, the client library will attempt to reconnect automatically. The default is 15 seconds.
   *
   * @defaultValue 15s
   */
  disconnectedRetryTimeout?: number;

  /**
   * When the connection enters the {@link ConnectionStates.SUSPENDED} state, after this delay in milliseconds, if the state is still {@link ConnectionStates.SUSPENDED | `SUSPENDED`}, the client library attempts to reconnect automatically. The default is 30 seconds.
   *
   * @defaultValue 30s
   */
  suspendedRetryTimeout?: number;

  /**
   * When `true`, the client library will automatically send a close request to Ably whenever the `window` [`beforeunload` event](https://developer.mozilla.org/en-US/docs/Web/API/BeforeUnloadEvent) fires. By enabling this option, the close request sent to Ably ensures the connection state will not be retained and all channels associated with the channel will be detached. This is commonly used by developers who want presence leave events to fire immediately (that is, if a user navigates to another page or closes their browser, then enabling this option will result in the presence member leaving immediately). Without this option or an explicit call to the `close` method of the `Connection` object, Ably expects that the abruptly disconnected connection could later be recovered and therefore does not immediately remove the user from presence. Instead, to avoid “twitchy” presence behaviour an abruptly disconnected client is removed from channels in which they are present after 15 seconds, and the connection state is retained for two minutes. Defaults to `true`.
   */
  closeOnUnload?: boolean;

  /**
   * When `true`, enables idempotent publishing by assigning a unique message ID client-side, allowing the Ably servers to discard automatic publish retries following a failure such as a network fault. The default is `true`.
   *
   * @defaultValue `true`
   */
  idempotentRestPublishing?: boolean;

  /**
   * A set of key-value pairs that can be used to pass in arbitrary connection parameters, such as [`heartbeatInterval`](https://ably.com/docs/realtime/connection#heartbeats) or [`remainPresentFor`](https://ably.com/docs/realtime/presence#unstable-connections).
   */
  transportParams?: { [k: string]: string | number | boolean };

  /**
   * An array of transports to use, in descending order of preference. In the browser environment the available transports are: `web_socket` and `xhr`.
   */
  transports?: Transport[];

  /**
   * The maximum number of fallback hosts to use as a fallback when an HTTP request to the primary host is unreachable or indicates that it is unserviceable. The default value is 3.
   *
   * @defaultValue 3
   */
  httpMaxRetryCount?: number;

  /**
   * The maximum elapsed time in milliseconds in which fallback host retries for HTTP requests will be attempted. The default is 15 seconds.
   *
   * @defaultValue 15s
   */
  httpMaxRetryDuration?: number;

  /**
   * Timeout in milliseconds for opening a connection to Ably to initiate an HTTP request. The default is 4 seconds.
   *
   * @defaultValue 4s
   */
  httpOpenTimeout?: number;

  /**
   * Timeout in milliseconds for a client performing a complete HTTP request to Ably, including the connection phase. The default is 10 seconds.
   *
   * @defaultValue 10s
   */
  httpRequestTimeout?: number;

  /**
   * Timeout for the wait of acknowledgement for operations performed via a realtime connection, before the client library considers a request failed and triggers a failure condition. Operations include establishing a connection with Ably, or sending a `HEARTBEAT`, `CONNECT`, `ATTACH`, `DETACH` or `CLOSE` request. It is the equivalent of `httpRequestTimeout` but for realtime operations, rather than REST. The default is 10 seconds.
   *
   * @defaultValue 10s
   */
  realtimeRequestTimeout?: number;

  /**
   * A map between a plugin type and a plugin object.
   */
  plugins?: Plugins;

  /**
   * The maximum message size is an attribute of an Ably account which represents the largest permitted payload size of a single message or set of messages published in a single operation. Publish requests whose payload exceeds this limit are rejected by the server. `maxMessageSize` enables the client to enforce, or further restrict, the maximum size of a single message or set of messages published via REST. The default value is `65536` (64 KiB). In the case of a realtime connection, the server may indicate the associated maximum message size on connection establishment; this value takes precedence over the client's default `maxMessageSize`.
   *
   * @defaultValue 65536
   */
  maxMessageSize?: number;

  /**
   * A URL pointing to a service worker script which is used as the target for web push notifications.
   */
  pushServiceWorkerUrl?: string;
}

/**
 * Describes the {@link ClientOptions.plugins | plugins} accepted by all variants of the SDK.
 */
export interface CorePlugins {
  /**
   * A plugin capable of decoding `vcdiff`-encoded messages. For more information on how to configure a channel to use delta encoding, see the [documentation for the `@ably-forks/vcdiff-decoder` package](https://github.com/ably-forks/vcdiff-decoder#usage).
   */
  vcdiff?: any;

  /**
   * A plugin which allows the client to be the target of push notifications.
   */
  Push?: unknown;

  /**
   * A plugin which allows the client to use LiveObjects functionality at `RealtimeChannel.object`.
   */
  LiveObjects?: unknown;
}

/**
 * Passes authentication-specific properties in authentication requests to Ably. Properties set using `AuthOptions` are used instead of the default values set when the client library is instantiated, as opposed to being merged with them.
 */
export interface AuthOptions {
  /**
   * Called when a new token is required. The role of the callback is to obtain a fresh token, one of: an Ably Token string (in plain text format); a signed {@link TokenRequest}; a {@link TokenDetails} (in JSON format); an [Ably JWT](https://ably.com/docs/core-features/authentication.ably-jwt). See [the authentication documentation](https://ably.com/docs/realtime/authentication) for details of the Ably {@link TokenRequest} format and associated API calls.
   *
   * @param data - The parameters that should be used to generate the token.
   * @param callback - A function which, upon success, the `authCallback` should call with one of: an Ably Token string (in plain text format); a signed `TokenRequest`; a `TokenDetails` (in JSON format); an [Ably JWT](https://ably.com/docs/core-features/authentication#ably-jwt). Upon failure, the `authCallback` should call this function with information about the error.
   */
  authCallback?(
    data: TokenParams,
    /**
     * A function which, upon success, the `authCallback` should call with one of: an Ably Token string (in plain text format); a signed `TokenRequest`; a `TokenDetails` (in JSON format); an [Ably JWT](https://ably.com/docs/core-features/authentication#ably-jwt). Upon failure, the `authCallback` should call this function with information about the error.
     *
     * @param error - Should be `null` if the auth request completed successfully, or containing details of the error if not.
     * @param tokenRequestOrDetails - A valid `TokenRequest`, `TokenDetails` or Ably JWT to be used for authentication.
     */
    callback: (
      error: ErrorInfo | string | null,
      tokenRequestOrDetails: TokenDetails | TokenRequest | string | null,
    ) => void,
  ): void;

  /**
   * A set of key-value pair headers to be added to any request made to the `authUrl`. Useful when an application requires these to be added to validate the request or implement the response. If the `authHeaders` object contains an `authorization` key, then `withCredentials` is set on the XHR request.
   */
  authHeaders?: { [index: string]: string };

  /**
   * The HTTP verb to use for any request made to the `authUrl`, either `GET` or `POST`. The default value is `GET`.
   *
   * @defaultValue `HTTPMethod.GET`
   */
  authMethod?: HTTPMethod;

  /**
   * A set of key-value pair params to be added to any request made to the `authUrl`. When the `authMethod` is `GET`, query params are added to the URL, whereas when `authMethod` is `POST`, the params are sent as URL encoded form data. Useful when an application requires these to be added to validate the request or implement the response.
   */
  authParams?: { [index: string]: string };

  /**
   * A URL that the library may use to obtain a token string (in plain text format), or a signed {@link TokenRequest} or {@link TokenDetails} (in JSON format) from.
   */
  authUrl?: string;

  /**
   * The full API key string, as obtained from the [Ably dashboard](https://ably.com/dashboard). Use this option if you wish to use Basic authentication, or wish to be able to issue Ably Tokens without needing to defer to a separate entity to sign Ably {@link TokenRequest | `TokenRequest`s}. Read more about [Basic authentication](https://ably.com/docs/core-features/authentication#basic-authentication).
   */
  key?: string;

  /**
   * If `true`, the library queries the Ably servers for the current time when issuing {@link TokenRequest | `TokenRequest`s} instead of relying on a locally-available time of day. Knowing the time accurately is needed to create valid signed Ably {@link TokenRequest | `TokenRequest`s}, so this option is useful for library instances on auth servers where for some reason the server clock cannot be kept synchronized through normal means, such as an [NTP daemon](https://en.wikipedia.org/wiki/Ntpd). The server is queried for the current time once per client library instance (which stores the offset from the local clock), so if using this option you should avoid instancing a new version of the library for each request. The default is `false`.
   *
   * @defaultValue `false`
   */
  queryTime?: boolean;

  /**
   * An authenticated token. This can either be a {@link TokenDetails} object or token string (obtained from the `token` property of a {@link TokenDetails} component of an Ably {@link TokenRequest} response, or a JSON Web Token satisfying [the Ably requirements for JWTs](https://ably.com/docs/core-features/authentication#ably-jwt)). This option is mostly useful for testing: since tokens are short-lived, in production you almost always want to use an authentication method that enables the client library to renew the token automatically when the previous one expires, such as `authUrl` or `authCallback`. Read more about [Token authentication](https://ably.com/docs/core-features/authentication#token-authentication).
   */
  token?: TokenDetails | string;

  /**
   * An authenticated {@link TokenDetails} object (most commonly obtained from an Ably Token Request response). This option is mostly useful for testing: since tokens are short-lived, in production you almost always want to use an authentication method that enables the client library to renew the token automatically when the previous one expires, such as `authUrl` or `authCallback`. Use this option if you wish to use Token authentication. Read more about [Token authentication](https://ably.com/docs/core-features/authentication#token-authentication).
   */
  tokenDetails?: TokenDetails;

  /**
   * When `true`, forces token authentication to be used by the library. If a `clientId` is not specified in the {@link ClientOptions} or {@link TokenParams}, then the Ably Token issued is [anonymous](https://ably.com/docs/core-features/authentication#identified-clients).
   */
  useTokenAuth?: boolean;

  /**
   * A client ID, used for identifying this client when publishing messages or for presence purposes. The `clientId` can be any non-empty string, except it cannot contain a `*`. This option is primarily intended to be used in situations where the library is instantiated with a key. Note that a `clientId` may also be implicit in a token used to instantiate the library. An error will be raised if a `clientId` specified here conflicts with the `clientId` implicit in the token. Find out more about [client identities](https://ably.com/documentation/how-ably-works#client-identity).
   */
  clientId?: string;
}

/**
 * Capabilities which are available for use within {@link TokenParams}.
 */
export type capabilityOp =
  | 'publish'
  | 'subscribe'
  | 'presence'
  | 'object-subscribe'
  | 'object-publish'
  | 'annotation-subscribe'
  | 'annotation-publish'
  | 'message-update-any'
  | 'message-update-own'
  | 'message-delete-any'
  | 'message-delete-own'
  | 'history'
  | 'stats'
  | 'channel-metadata'
  | 'push-subscribe'
  | 'push-admin'
  | 'privileged-headers';

/**
 * Capabilities which are available for use within {@link TokenParams}.
 */
export type CapabilityOp = capabilityOp;

/**
 * Defines the properties of an Ably Token.
 */
export interface TokenParams {
  /**
   * The capabilities associated with this Ably Token. The capabilities value is a JSON-encoded representation of the resource paths and associated operations. Read more about capabilities in the [capabilities docs](https://ably.com/docs/core-features/authentication/#capabilities-explained).
   *
   * @defaultValue `'{"*":["*"]}'`
   */
  capability?: { [key: string]: capabilityOp[] | ['*'] } | string;
  /**
   * A client ID, used for identifying this client when publishing messages or for presence purposes. The `clientId` can be any non-empty string, except it cannot contain a `*`. This option is primarily intended to be used in situations where the library is instantiated with a key. Note that a `clientId` may also be implicit in a token used to instantiate the library. An error is raised if a `clientId` specified here conflicts with the `clientId` implicit in the token. Find out more about [identified clients](https://ably.com/docs/core-features/authentication#identified-clients).
   */
  clientId?: string;
  /**
   * A cryptographically secure random string of at least 16 characters, used to ensure the {@link TokenRequest} cannot be reused.
   */
  nonce?: string;
  /**
   * The timestamp of this request as milliseconds since the Unix epoch. Timestamps, in conjunction with the `nonce`, are used to prevent requests from being replayed. `timestamp` is a "one-time" value, and is valid in a request, but is not validly a member of any default token params such as `ClientOptions.defaultTokenParams`.
   */
  timestamp?: number;
  /**
   * Requested time to live for the token in milliseconds. The default is 60 minutes.
   *
   * @defaultValue 60min
   */
  ttl?: number;
}

/**
 * Sets the properties to configure encryption for a {@link Channel} or {@link RealtimeChannel} object.
 */
export interface CipherParams {
  /**
   * The algorithm to use for encryption. Only `AES` is supported and is the default value.
   *
   * @defaultValue `"AES"`
   */
  algorithm: string;
  /**
   * The private key used to encrypt and decrypt payloads. You should not set this value directly; rather, you should pass a `key` of type {@link CipherKeyParam} to {@link Crypto.getDefaultParams}.
   */
  key: unknown;
  /**
   * The length of the key in bits; either 128 or 256.
   */
  keyLength: number;
  /**
   * The cipher mode. Only `CBC` is supported and is the default value.
   *
   * @defaultValue `"CBC"`
   */
  mode: string;
}

/**
 * Contains an Ably Token and its associated metadata.
 */
export interface TokenDetails {
  /**
   * The capabilities associated with this Ably Token. The capabilities value is a JSON-encoded representation of the resource paths and associated operations. Read more about capabilities in the [capabilities docs](https://ably.com/docs/core-features/authentication/#capabilities-explained).
   */
  capability: string;
  /**
   * The client ID, if any, bound to this Ably Token. If a client ID is included, then the Ably Token authenticates its bearer as that client ID, and the Ably Token may only be used to perform operations on behalf of that client ID. The client is then considered to be an [identified client](https://ably.com/docs/core-features/authentication#identified-clients).
   */
  clientId?: string;
  /**
   * The timestamp at which this token expires as milliseconds since the Unix epoch.
   */
  expires: number;
  /**
   * The timestamp at which this token was issued as milliseconds since the Unix epoch.
   */
  issued: number;
  /**
   * The [Ably Token](https://ably.com/docs/core-features/authentication#ably-tokens) itself. A typical Ably Token string appears with the form `xVLyHw.A-pwh7wicf3afTfgiw4k2Ku33kcnSA7z6y8FjuYpe3QaNRTEo4`.
   */
  token: string;
}

/**
 * Contains the properties of a request for a token to Ably. Tokens are generated using {@link Auth.requestToken}.
 */
export interface TokenRequest {
  /**
   * Capability of the requested Ably Token. If the Ably `TokenRequest` is successful, the capability of the returned Ably Token will be the intersection of this capability with the capability of the issuing key. The capabilities value is a JSON-encoded representation of the resource paths and associated operations. Read more about capabilities in the [capabilities docs](https://ably.com/docs/realtime/authentication).
   */
  capability: string;
  /**
   * The client ID to associate with the requested Ably Token. When provided, the Ably Token may only be used to perform operations on behalf of that client ID.
   */
  clientId?: string;
  /**
   * The name of the key against which this request is made. The key name is public, whereas the key secret is private.
   */
  keyName: string;
  /**
   * The Message Authentication Code for this request.
   */
  mac: string;
  /**
   * A cryptographically secure random string of at least 16 characters, used to ensure the `TokenRequest` cannot be reused.
   */
  nonce: string;
  /**
   * The timestamp of this request as milliseconds since the Unix epoch.
   */
  timestamp: number;
  /**
   * Requested time to live for the Ably Token in milliseconds. If the Ably `TokenRequest` is successful, the TTL of the returned Ably Token is less than or equal to this value, depending on application settings and the attributes of the issuing key. The default is 60 minutes.
   *
   * @defaultValue 60min
   */
  ttl?: number;
}

/**
 * [Channel Parameters](https://ably.com/docs/realtime/channels/channel-parameters/overview) used within {@link ChannelOptions}.
 */
export type ChannelParams = { [key: string]: string };

/**
 * The `ChannelModes` namespace describes the possible values of the {@link ChannelMode} type.
 */
declare namespace ChannelModes {
  /**
   * The client can publish messages.
   */
  type PUBLISH = 'PUBLISH' | 'publish';
  /**
   * The client will receive messages.
   */
  type SUBSCRIBE = 'SUBSCRIBE' | 'subscribe';
  /**
   * The client can enter the presence set.
   */
  type PRESENCE = 'PRESENCE' | 'presence';
  /**
   * The client will receive presence messages.
   */
  type PRESENCE_SUBSCRIBE = 'PRESENCE_SUBSCRIBE' | 'presence_subscribe';
  /**
   * The client can publish object messages.
   */
  type OBJECT_PUBLISH = 'OBJECT_PUBLISH' | 'object_publish';
  /**
   * The client will receive object messages.
   */
  type OBJECT_SUBSCRIBE = 'OBJECT_SUBSCRIBE' | 'object_subscribe';
  /**
   * The client can publish annotations.
   */
  type ANNOTATION_PUBLISH = 'ANNOTATION_PUBLISH' | 'annotation_publish';
  /**
   * The client will receive annotations.
   */
  type ANNOTATION_SUBSCRIBE = 'ANNOTATION_SUBSCRIBE' | 'annotation_subscribe';
}

/**
 * Describes the possible flags used to configure client capabilities, using {@link ChannelOptions}.
 *
 * **Note:** This type admits uppercase or lowercase values for reasons of backwards compatibility. In the next major release of this SDK, it will be merged with {@link ResolvedChannelMode} and only admit lowercase values; see [this GitHub issue](https://github.com/ably/ably-js/issues/1954).
 */
export type ChannelMode =
  | ChannelModes.PUBLISH
  | ChannelModes.SUBSCRIBE
  | ChannelModes.PRESENCE
  | ChannelModes.PRESENCE_SUBSCRIBE
  | ChannelModes.OBJECT_PUBLISH
  | ChannelModes.OBJECT_SUBSCRIBE
  | ChannelModes.ANNOTATION_PUBLISH
  | ChannelModes.ANNOTATION_SUBSCRIBE;

/**
 * The `ResolvedChannelModes` namespace describes the possible values of the {@link ResolvedChannelMode} type.
 */
declare namespace ResolvedChannelModes {
  /**
   * The client can publish messages.
   */
  type PUBLISH = 'publish';
  /**
   * The client will receive messages.
   */
  type SUBSCRIBE = 'subscribe';
  /**
   * The client can enter the presence set.
   */
  type PRESENCE = 'presence';
  /**
   * The client will receive presence messages.
   */
  type PRESENCE_SUBSCRIBE = 'presence_subscribe';
  /**
   * The client can publish object messages.
   */
  type OBJECT_PUBLISH = 'object_publish';
  /**
   * The client will receive object messages.
   */
  type OBJECT_SUBSCRIBE = 'object_subscribe';
  /**
   * The client can publish annotations.
   */
  type ANNOTATION_PUBLISH = 'annotation_publish';
  /**
   * The client will receive annotations.
   */
  type ANNOTATION_SUBSCRIBE = 'annotation_subscribe';
}

/**
 * Describes the configuration that a {@link RealtimeChannel} is using, as returned by {@link RealtimeChannel.modes}.
 *
 * This type is the same as the {@link ChannelMode} type but with all of the values lowercased.
 *
 * **Note:** This type exists for reasons of backwards compatibility. In the next major release of this SDK, it will be merged with {@link ChannelMode}; see [this GitHub issue](https://github.com/ably/ably-js/issues/1954).
 */
export type ResolvedChannelMode =
  | ResolvedChannelModes.PUBLISH
  | ResolvedChannelModes.SUBSCRIBE
  | ResolvedChannelModes.PRESENCE
  | ResolvedChannelModes.PRESENCE_SUBSCRIBE
  | ResolvedChannelModes.OBJECT_PUBLISH
  | ResolvedChannelModes.OBJECT_SUBSCRIBE
  | ResolvedChannelModes.ANNOTATION_PUBLISH
  | ResolvedChannelModes.ANNOTATION_SUBSCRIBE;

/**
 * Passes additional properties to a {@link Channel} or {@link RealtimeChannel} object, such as encryption, {@link ChannelMode} and channel parameters.
 */
export interface ChannelOptions {
  /**
   * Requests encryption for this channel when not null, and specifies encryption-related parameters (such as algorithm, chaining mode, key length and key). See [an example](https://ably.com/docs/realtime/encryption#getting-started). When running in a browser, encryption is only available when the current environment is a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts).
   */
  cipher?: CipherParamOptions | CipherParams;
  /**
   * [Channel Parameters](https://ably.com/docs/realtime/channels/channel-parameters/overview) that configure the behavior of the channel.
   */
  params?: ChannelParams;
  /**
   * An array of {@link ChannelMode} objects.
   */
  modes?: ChannelMode[];
  /**
   *  A boolean which determines whether calling subscribe
   *  on a channel or presence object should trigger an implicit attach. Defaults to `true`
   *
   *  Note: this option is for realtime client libraries only
   */
  attachOnSubscribe?: boolean;
}

/**
 * Passes additional properties to a {@link RealtimeChannel} name to produce a new derived channel
 */
export interface DeriveOptions {
  /**
   * The JMESPath Query filter string to be used to derive new channel.
   */
  filter?: string;
}

/**
 * The `RestHistoryParams` interface describes the parameters accepted by the following methods:
 *
 * - {@link Presence.history}
 * - {@link Channel.history}
 */
export interface RestHistoryParams {
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
 * Describes the parameters accepted by {@link RestAnnotations.get}.
 */
export interface GetAnnotationsParams {
  /**
   * An upper limit on the number of annotations returned. The default is 100, and the maximum is 1000.
   *
   * @defaultValue 100
   */
  limit?: number;
}

/**
 * The `RestPresenceParams` interface describes the parameters accepted by {@link Presence.get}.
 */
export interface RestPresenceParams {
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

/**
 * The `RealtimePresenceParams` interface describes the parameters accepted by {@link RealtimePresence.get}.
 */
export interface RealtimePresenceParams {
  /**
   * Sets whether to wait for a full presence set synchronization between Ably and the clients on the channel to complete before returning the results. Synchronization begins as soon as the channel is {@link ChannelStates.ATTACHED}. When set to `true` the results will be returned as soon as the sync is complete. When set to `false` the current list of members will be returned without the sync completing. The default is `true`.
   *
   * @defaultValue `true`
   */
  waitForSync?: boolean;
  /**
   * Filters the array of returned presence members by a specific client using its ID.
   */
  clientId?: string;
  /**
   * Filters the array of returned presence members by a specific connection using its ID.
   */
  connectionId?: string;
}

/**
 * The `RealtimeHistoryParams` interface describes the parameters accepted by the following methods:
 *
 * - {@link RealtimePresence.history}
 * - {@link RealtimeChannel.history}
 */
export interface RealtimeHistoryParams {
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
  /**
   * When `true`, ensures message history is up until the point of the channel being attached. See [continuous history](https://ably.com/docs/realtime/history#continuous-history) for more info. Requires the `direction` to be `backwards`. If the channel is not attached, or if `direction` is set to `forwards`, this option results in an error.
   */
  untilAttach?: boolean;
}

/**
 * Contains state change information emitted by {@link Channel} and {@link RealtimeChannel} objects.
 */
export interface ChannelStateChange {
  /**
   * The new current {@link ChannelState}.
   */
  current: ChannelState;
  /**
   * The previous state. For the {@link ChannelEvents.UPDATE} event, this is equal to the `current` {@link ChannelState}.
   */
  previous: ChannelState;
  /**
   * An {@link ErrorInfo} object containing any information relating to the transition.
   */
  reason?: ErrorInfo;
  /**
   * Indicates whether message continuity on this channel is preserved, see [Nonfatal channel errors](https://ably.com/docs/realtime/channels#nonfatal-errors) for more info.
   */
  resumed: boolean;
  /**
   * Indicates whether the client can expect a backlog of messages from a rewind or resume.
   */
  hasBacklog?: boolean;
}

/**
 * Contains {@link ConnectionState} change information emitted by the {@link Connection} object.
 */
export interface ConnectionStateChange {
  /**
   * The new {@link ConnectionState}.
   */
  current: ConnectionState;
  /**
   * The previous {@link ConnectionState}. For the {@link ConnectionEvents.UPDATE} event, this is equal to the current {@link ConnectionState}.
   */
  previous: ConnectionState;
  /**
   * An {@link ErrorInfo} object containing any information relating to the transition.
   */
  reason?: ErrorInfo;
  /**
   * Duration in milliseconds, after which the client retries a connection where applicable.
   */
  retryIn?: number;
}

/**
 * The `DevicePlatforms` namespace describes the possible values of the {@link DevicePlatform} type.
 */
declare namespace DevicePlatforms {
  /**
   * The device platform is Android.
   */
  type ANDROID = 'android';
  /**
   * The device platform is iOS.
   */
  type IOS = 'ios';
  /**
   * The device platform is a web browser.
   */
  type BROWSER = 'browser';
}

/**
 * Describes the device receiving push notifications.
 */
export type DevicePlatform = DevicePlatforms.ANDROID | DevicePlatforms.IOS | DevicePlatforms.BROWSER;

/**
 * The `DeviceFormFactors` namespace describes the possible values of the {@link DeviceFormFactor} type.
 */
declare namespace DeviceFormFactors {
  /**
   * The device is a phone.
   */
  type PHONE = 'phone';
  /**
   * The device is tablet.
   */
  type TABLET = 'tablet';
  /**
   * The device is a desktop.
   */
  type DESKTOP = 'desktop';
  /**
   * The device is a TV.
   */
  type TV = 'tv';
  /**
   * The device is a watch.
   */
  type WATCH = 'watch';
  /**
   * The device is a car.
   */
  type CAR = 'car';
  /**
   * The device is embedded.
   */
  type EMBEDDED = 'embedded';
  /**
   * The device is other.
   */
  type OTHER = 'other';
}

/**
 * Describes the type of device receiving a push notification.
 */
export type DeviceFormFactor =
  | DeviceFormFactors.PHONE
  | DeviceFormFactors.TABLET
  | DeviceFormFactors.DESKTOP
  | DeviceFormFactors.TV
  | DeviceFormFactors.WATCH
  | DeviceFormFactors.CAR
  | DeviceFormFactors.EMBEDDED
  | DeviceFormFactors.OTHER;

/**
 * Contains the properties of a device registered for push notifications.
 */
export interface DeviceDetails {
  /**
   * A unique ID generated by the device.
   */
  id: string;
  /**
   * The client ID the device is connected to Ably with.
   */
  clientId?: string;
  /**
   * The {@link DevicePlatform} associated with the device. Describes the platform the device uses, such as `android` or `ios`.
   */
  platform: DevicePlatform;
  /**
   * The {@link DeviceFormFactor} object associated with the device. Describes the type of the device, such as `phone` or `tablet`.
   */
  formFactor: DeviceFormFactor;
  /**
   * A JSON object of key-value pairs that contains metadata for the device.
   */
  metadata?: any;
  /**
   * A unique device secret generated by the Ably SDK.
   */
  deviceSecret?: string;
  /**
   * The {@link DevicePushDetails} object associated with the device. Describes the details of the push registration of the device.
   */
  push: DevicePushDetails;
}

/**
 * Contains the subscriptions of a device, or a group of devices sharing the same `clientId`, has to a channel in order to receive push notifications.
 */
export interface PushChannelSubscription {
  /**
   * The channel the push notification subscription is for.
   */
  channel: string;
  /**
   * The unique ID of the device.
   */
  deviceId?: string;
  /**
   * The ID of the client the device, or devices are associated to.
   */
  clientId?: string;
}

/**
 * Valid states which a Push device may be in.
 */
export type DevicePushState = 'ACTIVE' | 'FAILING' | 'FAILED';

/**
 * Contains the details of the push registration of a device.
 */
export interface DevicePushDetails {
  /**
   * A JSON object of key-value pairs that contains of the push transport and address.
   */
  recipient: any;
  /**
   * The current state of the push registration.
   */
  state?: DevicePushState;
  /**
   * An {@link ErrorInfo} object describing the most recent error when the `state` is `Failing` or `Failed`.
   */
  error?: ErrorInfo;
}

/**
 * The `DeviceRegistrationParams` interface describes the parameters accepted by the following methods:
 *
 * - {@link PushDeviceRegistrations.list}
 * - {@link PushDeviceRegistrations.removeWhere}
 */
export interface DeviceRegistrationParams {
  /**
   * Filter to restrict to devices associated with a client ID.
   */
  clientId?: string;
  /**
   * Filter to restrict by the unique ID of the device.
   */
  deviceId?: string;
  /**
   * A limit on the number of devices returned, up to 1,000.
   */
  limit?: number;
  /**
   * Filter by the state of the device.
   */
  state?: DevicePushState;
}

/**
 * The `PushChannelSubscriptionParams` interface describes the parameters accepted by the following methods:
 *
 * - {@link PushChannelSubscriptions.list}
 * - {@link PushChannelSubscriptions.removeWhere}
 */
export interface PushChannelSubscriptionParams {
  /**
   * Filter to restrict to subscriptions associated with the given channel.
   */
  channel?: string;
  /**
   * Filter to restrict to devices associated with the given client identifier. Cannot be used with a deviceId param.
   */
  clientId?: string;
  /**
   * Filter to restrict to devices associated with that device identifier. Cannot be used with a clientId param.
   */
  deviceId?: string;
  /**
   * A limit on the number of devices returned, up to 1,000.
   */
  limit?: number;
}

/**
 * The `PushChannelsParams` interface describes the parameters accepted by {@link PushChannelSubscriptions.listChannels}.
 */
export interface PushChannelsParams {
  /**
   * A limit on the number of channels returned, up to 1,000.
   */
  limit?: number;
}

/**
 * The `StatsParams` interface describes the parameters accepted by the following methods:
 *
 * - {@link RestClient.stats}
 * - {@link RealtimeClient.stats}
 */
export interface StatsParams {
  /**
   * The time from which stats are retrieved, specified as milliseconds since the Unix epoch.
   *
   * @defaultValue The Unix epoch.
   */
  start?: number;
  /**
   * The time until stats are retrieved, specified as milliseconds since the Unix epoch.
   *
   * @defaultValue The current time.
   */
  end?: number;
  /**
   * The order for which stats are returned in. Valid values are `'backwards'` which orders stats from most recent to oldest, or `'forwards'` which orders stats from oldest to most recent. The default is `'backwards'`.
   *
   * @defaultValue `'backwards'`
   */
  direction?: 'backwards' | 'forwards';
  /**
   * An upper limit on the number of stats returned. The default is 100, and the maximum is 1000.
   *
   * @defaultValue 100
   */
  limit?: number;
  /**
   * Based on the unit selected, the given `start` or `end` times are rounded down to the start of the relevant interval depending on the unit granularity of the query.
   *
   * @defaultValue `StatsIntervalGranularity.MINUTE`
   */
  unit?: StatsIntervalGranularity;
}

/**
 * Contains information about the results of a batch operation.
 */
export interface BatchResult<T> {
  /**
   * The number of successful operations in the request.
   */
  successCount: number;
  /**
   * The number of unsuccessful operations in the request.
   */
  failureCount: number;
  /**
   * An array of results for the batch operation.
   */
  results: T[];
}

/**
 * Describes the messages that should be published by a batch publish operation, and the channels to which they should be published.
 */
export interface BatchPublishSpec {
  /**
   * The names of the channels to publish the `messages` to.
   */
  channels: string[];
  /**
   * An array of {@link Message} objects.
   */
  messages: Message[];
}

/**
 * Contains information about the result of successful publishes to a channel requested by a single {@link BatchPublishSpec}.
 */
export interface BatchPublishSuccessResult {
  /**
   * The name of the channel the message(s) was published to.
   */
  channel: string;
  /**
   * A unique ID prefixed to the {@link Message.id} of each published message.
   */
  messageId: string;
  /**
   * An array of message serials corresponding 1:1 to the messages that were published.
   * A serial may be null if the message was discarded due to a configured conflation rule.
   */
  serials: (string | null)[];
}

/**
 * Contains information about the result of unsuccessful publishes to a channel requested by a single {@link BatchPublishSpec}.
 */
export interface BatchPublishFailureResult {
  /**
   * The name of the channel the message(s) failed to be published to.
   */
  channel: string;
  /**
   * Describes the reason for which the message(s) failed to publish to the channel as an {@link ErrorInfo} object.
   */
  error: ErrorInfo;
}

/**
 * Contains information about the result of a successful batch presence request for a single channel.
 */
export interface BatchPresenceSuccessResult {
  /**
   * The channel name the presence state was retrieved for.
   */
  channel: string;
  /**
   * An array of {@link PresenceMessage}s describing members present on the channel.
   */
  presence: PresenceMessage[];
}

/**
 * Contains information about the result of an unsuccessful batch presence request for a single channel.
 */
export interface BatchPresenceFailureResult {
  /**
   * The channel name the presence state failed to be retrieved for.
   */
  channel: string;
  /**
   * Describes the reason for which presence state could not be retrieved for the channel as an {@link ErrorInfo} object.
   */
  error: ErrorInfo;
}

/**
 * The `TokenRevocationOptions` interface describes the additional options accepted by {@link Auth.revokeTokens}.
 */
export interface TokenRevocationOptions {
  /**
   * A Unix timestamp in milliseconds where only tokens issued before this time are revoked. The default is the current time. Requests with an `issuedBefore` in the future, or more than an hour in the past, will be rejected.
   */
  issuedBefore?: number;
  /**
   * If true, permits a token renewal cycle to take place without needing established connections to be dropped, by postponing enforcement to 30 seconds in the future, and sending any existing connections a hint to obtain (and upgrade the connection to use) a new token. The default is `false`, meaning that the effect is near-immediate.
   */
  allowReauthMargin?: boolean;
}

/**
 * Describes which tokens should be affected by a token revocation request.
 */
export interface TokenRevocationTargetSpecifier {
  /**
   * The type of token revocation target specifier. Valid values include `clientId`, `revocationKey` and `channel`.
   */
  type: string;
  /**
   * The value of the token revocation target specifier.
   */
  value: string;
}

/**
 * Contains information about the result of a successful token revocation request for a single target specifier.
 */
export interface TokenRevocationSuccessResult {
  /**
   * The target specifier.
   */
  target: string;
  /**
   * The time at which the token revocation will take effect, as a Unix timestamp in milliseconds.
   */
  appliesAt: number;
  /**
   * A Unix timestamp in milliseconds. Only tokens issued earlier than this time will be revoked.
   */
  issuedBefore: number;
}

/**
 * Contains information about the result of an unsuccessful token revocation request for a single target specifier.
 */
export interface TokenRevocationFailureResult {
  /**
   * The target specifier.
   */
  target: string;
  /**
   * Describes the reason for which token revocation failed for the given `target` as an {@link ErrorInfo} object.
   */
  error: ErrorInfo;
}

// Common Listeners
/**
 * A callback which returns only a single argument, used for {@link RealtimeChannel} subscriptions.
 *
 * @param message - The message which triggered the callback.
 */
export type messageCallback<T> = (message: T) => void;
/**
 * The callback used for the events emitted by {@link RealtimeChannel}.
 *
 * @param changeStateChange - The state change that occurred.
 */
export type channelEventCallback = (changeStateChange: ChannelStateChange) => void;
/**
 * The callback used for the events emitted by {@link Connection}.
 *
 * @param connectionStateChange - The state change that occurred.
 */
export type connectionEventCallback = (connectionStateChange: ConnectionStateChange) => void;
/**
 * The callback used by {@link recoverConnectionCallback}.
 *
 * @param shouldRecover - Whether the connection should be recovered.
 */
export type recoverConnectionCompletionCallback = (shouldRecover: boolean) => void;
/**
 * Used in {@link ClientOptions} to configure connection recovery behaviour.
 *
 * @param lastConnectionDetails - Details of the connection used by the connection recovery process.
 * @param callback - A callback which is called when a connection recovery attempt is complete.
 */
export type recoverConnectionCallback = (
  lastConnectionDetails: {
    /**
     * The recovery key can be used by another client to recover this connection’s state in the `recover` client options property. See [connection state recover options](https://ably.com/documentation/realtime/connection/#connection-state-recover-options) for more information.
     */
    recoveryKey: string;
    /**
     * The time at which the previous client was abruptly disconnected before the page was unloaded. This is represented as milliseconds since Unix epoch.
     */
    disconnectedAt: number;
    /**
     * A clone of the `location` object of the previous page’s document object before the page was unloaded. A common use case for this attribute is to ensure that the previous page URL is the same as the current URL before allowing the connection to be recovered. For example, you may want the connection to be recovered only for page reloads, but not when a user navigates to a different page.
     */
    location: string;
    /**
     * The `clientId` of the client’s `Auth` object before the page was unloaded. A common use case for this attribute is to ensure that the current logged in user’s `clientId` matches the previous connection’s `clientId` before allowing the connection to be recovered. Ably prohibits changing a `clientId` for an existing connection, so any mismatch in `clientId` during a recover will result in the connection moving to the failed state.
     */
    clientId: string | null;
  },
  callback: recoverConnectionCompletionCallback,
) => void;

/**
 * A standard callback format which is invoked upon completion of a task.
 *
 * @param err - An error object if the task failed.
 * @param result - The result of the task, if any.
 */
type StandardCallback<T> = (err: ErrorInfo | null, result?: T) => void;

/**
 * A function passed to {@link Push.activate} in order to override the default implementation to register a device for push activation.
 *
 * @param device - A DeviceDetails object representing the local device
 * @param callback - A callback to be invoked when the registration is complete
 */
export type RegisterCallback = (device: DeviceDetails, callback: StandardCallback<DeviceDetails>) => void;

/**
 * A function passed to {@link Push.activate} in order to override the default implementation to deregister a device for push activation.
 *
 * @param device - A DeviceDetails object representing the local device
 * @param callback - A callback to be invoked when the deregistration is complete
 */
export type DeregisterCallback = (device: DeviceDetails, callback: StandardCallback<string>) => void;

/**
 * A callback which returns only an error, or null, when complete.
 *
 * @param error - The error if the task failed, or null not.
 */
export type ErrorCallback = (error: ErrorInfo | null) => void;

/**
 * A callback which returns only a single argument - an event object.
 *
 * @param event - The event which triggered the callback.
 */
export type EventCallback<T> = (event: T) => void;

/**
 * Represents a subscription that can be unsubscribed from.
 * This interface provides a way to clean up and remove subscriptions when they are no longer needed.
 *
 * @example
 * ```typescript
 * const s = someService.subscribe();
 * // Later when done with the subscription
 * s.unsubscribe();
 * ```
 */
export interface Subscription {
  /**
   * Deregisters the listener previously passed to the `subscribe` method.
   *
   * This method should be called when the subscription is no longer needed,
   * it will make sure no further events will be sent to the subscriber and
   * that references to the subscriber are cleaned up.
   */
  readonly unsubscribe: () => void;
}

/**
 * Represents a subscription to status change events that can be unsubscribed from.
 * This interface provides a way to clean up and remove subscriptions when they are no longer needed.
 *
 * @example
 * ```typescript
 * const s = someService.on();
 * // Later when done with the subscription
 * s.off();
 * ```
 */
export interface StatusSubscription {
  /**
   * Deregisters the listener previously passed to the `on` method.
   *
   * Unsubscribes from the status change events. It will ensure that no
   * further status change events will be sent to the subscriber and
   * that references to the subscriber are cleaned up.
   */
  readonly off: () => void;
}

// Internal Interfaces

// To allow a uniform (callback) interface between on and once even in the
// promisified version of the lib, but still allow once to be used in a way
// that returns a Promise if desired, EventEmitter uses method overloading to
// present both methods
/**
 * A generic interface for event registration and delivery used in a number of the types in the Realtime client library. For example, the {@link Connection} object emits events for connection state using the `EventEmitter` pattern.
 */
export declare interface EventEmitter<CallbackType, ResultType, EventType> {
  /**
   * Registers the provided listener for the specified event. If `on()` is called more than once with the same listener and event, the listener is added multiple times to its listener registry. Therefore, as an example, assuming the same listener is registered twice using `on()`, and an event is emitted once, the listener would be invoked twice.
   *
   * @param event - The named event to listen for.
   * @param callback - The event listener.
   */
  on(event: EventType, callback: CallbackType): void;
  /**
   * Registers the provided listener for the specified events. If `on()` is called more than once with the same listener and event, the listener is added multiple times to its listener registry. Therefore, as an example, assuming the same listener is registered twice using `on()`, and an event is emitted once, the listener would be invoked twice.
   *
   * @param events - The named events to listen for.
   * @param callback -  The event listener.
   */
  on(events: EventType[], callback: CallbackType): void;
  /**
   * Registers the provided listener all events. If `on()` is called more than once with the same listener and event, the listener is added multiple times to its listener registry. Therefore, as an example, assuming the same listener is registered twice using `on()`, and an event is emitted once, the listener would be invoked twice.
   *
   * @param callback - The event listener.
   */
  on(callback: CallbackType): void;
  /**
   * Registers the provided listener for the first occurrence of a single named event specified as the `Event` argument. If `once` is called more than once with the same listener, the listener is added multiple times to its listener registry. Therefore, as an example, assuming the same listener is registered twice using `once`, and an event is emitted once, the listener would be invoked twice. However, all subsequent events emitted would not invoke the listener as `once` ensures that each registration is only invoked once.
   *
   * @param event - The named event to listen for.
   * @param callback - The event listener.
   */
  once(event: EventType, callback: CallbackType): void;
  /**
   * Registers the provided listener for the first event that is emitted. If `once()` is called more than once with the same listener, the listener is added multiple times to its listener registry. Therefore, as an example, assuming the same listener is registered twice using `once()`, and an event is emitted once, the listener would be invoked twice. However, all subsequent events emitted would not invoke the listener as `once()` ensures that each registration is only invoked once.
   *
   * @param callback - The event listener.
   */
  once(callback: CallbackType): void;
  /**
   * Returns a promise which resolves upon the first occurrence of a single named event specified as the `Event` argument.
   *
   * @param event - The named event to listen for.
   * @returns A promise which resolves upon the first occurrence of the named event.
   */
  once(event: EventType): Promise<ResultType>;
  /**
   * Returns a promise which resolves upon the first occurrence of an event.
   *
   * @returns A promise which resolves upon the first occurrence of an event.
   */
  once(): Promise<ResultType>;
  /**
   * Removes all registrations that match both the specified listener and the specified event.
   *
   * @param event - The named event.
   * @param callback - The event listener.
   */
  off(event: EventType, callback: CallbackType): void;
  /**
   * Deregisters the specified listener. Removes all registrations matching the given listener, regardless of whether they are associated with an event or not.
   *
   * @param callback - The event listener.
   */
  off(callback: CallbackType): void;
  /**
   * Deregisters all registrations, for all events and listeners.
   */
  off(): void;
  /**
   * Returns the listeners for a specified `EventType`.
   *
   * @param eventName - The event name to retrieve the listeners for.
   */
  listeners(eventName?: EventType): CallbackType[] | null;
}

// Interfaces
/**
 * A client that offers a simple stateless API to interact directly with Ably's REST API.
 */
export declare interface RestClient {
  /**
   * An {@link Auth} object.
   */
  auth: Auth;
  /**
   * A {@link Channels} object.
   */
  channels: Channels<Channel>;
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
  /**
   * Retrieves a {@link LocalDevice} object that represents the current state of the device as a target for push notifications.
   *
   * @returns A {@link LocalDevice} object.
   * @deprecated Use {@link getDevice} instead. `device()` reads the device state from storage synchronously, which is not possible on platforms with asynchronous storage such as React Native. In the next major release `device()` will become asynchronous.
   */
  device(): LocalDevice;
  /**
   * Retrieves a {@link LocalDevice} object that represents the current state of the device as a target for push notifications, loading it from persistent storage if necessary.
   *
   * @returns A promise which resolves to a {@link LocalDevice} object.
   */
  getDevice(): Promise<LocalDevice>;
}

/**
 * A client that extends the functionality of {@link RestClient} and provides additional realtime-specific features.
 */
export declare interface RealtimeClient {
  /**
   * A client ID, used for identifying this client when publishing messages or for presence purposes. The `clientId` can be any non-empty string, except it cannot contain a `*`. This option is primarily intended to be used in situations where the library is instantiated with a key. A `clientId` may also be implicit in a token used to instantiate the library; an error will be raised if a `clientId` specified here conflicts with the `clientId` implicit in the token.
   */
  clientId: string;
  /**
   * Calls {@link Connection.close | `connection.close()`} and causes the connection to close, entering the closing state. Once closed, the library will not attempt to re-establish the connection without an explicit call to {@link Connection.connect | `connect()`}.
   */
  close(): void;
  /**
   * Calls {@link Connection.connect | `connection.connect()`} and causes the connection to open, entering the connecting state. Explicitly calling `connect()` is unnecessary unless the {@link ClientOptions.autoConnect} property is disabled.
   */
  connect(): void;

  /**
   * An {@link Auth} object.
   */
  auth: Auth;
  /**
   * A {@link Channels} object.
   */
  channels: Channels<RealtimeChannel>;
  /**
   * A {@link Connection} object.
   */
  connection: Connection;
  /**
   * Makes a REST request to a provided path. This is provided as a convenience for developers who wish to use REST API functionality that is either not documented or is not yet included in the public API, without having to directly handle features such as authentication, paging, fallback hosts, MsgPack and JSON support.
   *
   * @param method - The request method to use, such as `GET`, `POST`.
   * @param path - The request path.
   * @param version - The version of the Ably REST API to use. See the [REST API reference](https://ably.com/docs/api/rest-api#versioning) for information on versioning.
   * @param params - The parameters to include in the URL query of the request. The parameters depend on the endpoint being queried. See the [REST API reference](https://ably.com/docs/api/rest-api) for the available parameters of each endpoint.
   * @param body - The JSON body of the request.
   * @param headers - Additional HTTP headers to include in the request.
   * @returns A promise which, upon success, will be fulfilled with the {@link HttpPaginatedResponse} response object returned by the HTTP request. This response object will contain an empty or JSON-encodable object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
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
  /**
   * Retrieves a {@link LocalDevice} object that represents the current state of the device as a target for push notifications.
   *
   * @returns A {@link LocalDevice} object.
   * @deprecated Use {@link getDevice} instead. `device()` reads the device state from storage synchronously, which is not possible on platforms with asynchronous storage such as React Native. In the next major release `device()` will become asynchronous.
   */
  device(): LocalDevice;
  /**
   * Retrieves a {@link LocalDevice} object that represents the current state of the device as a target for push notifications, loading it from persistent storage if necessary.
   *
   * @returns A promise which resolves to a {@link LocalDevice} object.
   */
  getDevice(): Promise<LocalDevice>;
}

/**
 * Creates Ably {@link TokenRequest} objects and obtains Ably Tokens from Ably to subsequently issue to less trusted clients.
 */
export declare interface Auth {
  /**
   * The client ID this client is identified as when publishing messages or entering presence.
   *
   * The value is resolved from the `clientId` in {@link ClientOptions}, or from the `clientId` in the token the client authenticated with. A conflict between the two raises an {@link ErrorInfo}.
   *
   * The value is unset for an anonymous client, for example a key-authenticated client with no `clientId` configured. A populated value makes this an [identified client](https://ably.com/docs/auth/identified-clients). Guard against an unset value despite the declared type.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/auth#properties
   */
  clientId: string;

  /**
   * Instructs the library to get a new token immediately.
   *
   * On a realtime client it re-authenticates a connection that is already in the `connected` state, and otherwise starts or restarts the connection. The returned promise resolves only once the new token has taken effect on a connection in the `connected` state. It rejects with an {@link ErrorInfo} if re-authentication fails or the connection cannot be established.
   *
   * The client must have a way to obtain a token, so the resolved {@link AuthOptions} must include one of the [token authentication](https://ably.com/docs/auth/token) mechanisms `authCallback`, `authUrl`, or `key`, or a token supplied directly. Without any of these the call rejects with an {@link ErrorInfo}.
   *
   * `authorize()` cannot change the API key, so passing an `authOptions.key` that differs from the one the client was constructed with is rejected with an {@link ErrorInfo}.
   *
   * Any {@link TokenParams} and {@link AuthOptions} passed in are stored as the new defaults for subsequent token requests. They replace, rather than merge with, the stored defaults.
   *
   * @param tokenParams - A {@link TokenParams} object.
   * @param authOptions - An {@link AuthOptions} object.
   * @returns A promise which, upon success, will be fulfilled with a {@link TokenDetails} object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const tokenDetails = await realtime.auth.authorize({ clientId: 'bob' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/auth#authorize
   */
  authorize(tokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenDetails>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link Auth.authorize | `realtime.auth.authorize(tokenParams)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * realtime.auth.authorize(tokenParams, authOptions, (err, token) => {});
   *
   * // v2:
   * const token = await realtime.auth.authorize(tokenParams, authOptions);
   * ```
   * @param tokenParams - A {@link TokenParams} object.
   * @param authOptions - An {@link AuthOptions} object.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  authorize(
    tokenParams: TokenParams | null,
    authOptions: AuthOptions | null,
    callback: StandardCallback<TokenDetails>,
  ): void;
  /**
   * Creates and signs an Ably {@link TokenRequest} based on the specified {@link TokenParams} and {@link AuthOptions}. Use this to implement an Ably Token request callback for use by other clients.
   *
   * An API `key` value must be available locally to sign the request, supplied either in the client's {@link ClientOptions} or as `key` in the `authOptions` argument. Without a `key` the call rejects with an {@link ErrorInfo}, since a client using [token authentication](https://ably.com/docs/auth/token) cannot construct token requests itself and must instead obtain the {@link TokenRequest} from the key owner.
   *
   * Both {@link TokenParams} and {@link AuthOptions} are optional. When omitted or `null`, the client's stored defaults are used, as specified at instantiation or later updated by an `authorize()` request. Any values passed in replace, rather than merge with, those defaults.
   *
   * @param tokenParams - A {@link TokenParams} object.
   * @param authOptions - An {@link AuthOptions} object.
   * @returns A promise which, upon success, will be fulfilled with a {@link TokenRequest} object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const tokenRequest = await realtime.auth.createTokenRequest({ clientId: 'bob' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/auth#create-token-request
   */
  createTokenRequest(tokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenRequest>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link Auth.createTokenRequest | `realtime.auth.createTokenRequest(tokenParams)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * realtime.auth.createTokenRequest(tokenParams, authOptions, (err, req) => {});
   *
   * // v2:
   * const req = await realtime.auth.createTokenRequest(tokenParams, authOptions);
   * ```
   * @param tokenParams - A {@link TokenParams} object.
   * @param authOptions - An {@link AuthOptions} object.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  createTokenRequest(
    tokenParams: TokenParams | null,
    authOptions: AuthOptions | null,
    callback: StandardCallback<TokenRequest>,
  ): void;
  /**
   * Obtains an Ably Token according to the specified {@link TokenParams} and {@link AuthOptions}.
   *
   * Both {@link TokenParams} and {@link AuthOptions} are optional. When omitted or `null`, the client's stored defaults are used, as specified at instantiation or later updated by an `authorize()` request. Any values passed in replace, rather than merge with, those defaults.
   *
   * The client must have a way to obtain a token, so the resolved {@link AuthOptions} must include one of the [token authentication](https://ably.com/docs/auth/token) mechanisms `authCallback`, `authUrl`, or `key`. A client given only a literal token cannot request a new one and the call rejects with an {@link ErrorInfo}.
   *
   * @param TokenParams - A {@link TokenParams} object.
   * @param authOptions - An {@link AuthOptions} object.
   * @returns A promise which, upon success, will be fulfilled with a {@link TokenDetails} object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const tokenDetails = await realtime.auth.requestToken({ clientId: 'bob' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/auth#request-token
   */
  requestToken(TokenParams?: TokenParams, authOptions?: AuthOptions): Promise<TokenDetails>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link Auth.requestToken | `realtime.auth.requestToken(tokenParams)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * realtime.auth.requestToken(tokenParams, authOptions, (err, token) => {});
   *
   * // v2:
   * const token = await realtime.auth.requestToken(tokenParams, authOptions);
   * ```
   * @param tokenParams - A {@link TokenParams} object.
   * @param authOptions - An {@link AuthOptions} object.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  requestToken(
    tokenParams: TokenParams | null,
    authOptions: AuthOptions | null,
    callback: StandardCallback<TokenDetails>,
  ): void;
  /**
   * Revokes the tokens specified by the provided array of {@link TokenRevocationTargetSpecifier}s.
   *
   * The client making this call must be authenticated with an API key (basic auth), not a token. A token-authenticated client cannot revoke tokens and the call rejects with an {@link ErrorInfo}.
   *
   * Only tokens issued by an API key that had [revocable tokens](https://ably.com/docs/auth/revocation) enabled before the token was issued can be revoked.
   *
   * @param specifiers - An array of {@link TokenRevocationTargetSpecifier} objects.
   * @param options - A set of options which are used to modify the revocation request.
   * @returns A promise which, upon success, will be fulfilled with a {@link BatchResult} containing information about the result of the token revocation request for each provided [`TokenRevocationTargetSpecifier`]{@link TokenRevocationTargetSpecifier}. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const result = await rest.auth.revokeTokens([{ type: 'clientId', value: 'bob' }]);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/auth#revoke-tokens
   */
  revokeTokens(
    specifiers: TokenRevocationTargetSpecifier[],
    options?: TokenRevocationOptions,
  ): Promise<BatchResult<TokenRevocationSuccessResult | TokenRevocationFailureResult>>;
}

/**
 * Enables the retrieval of the current and historic presence set for a channel.
 */
export declare interface Presence {
  /**
   * Retrieves the current members present on the channel and the metadata for each member, such as their {@link PresenceAction} and ID. Returns a {@link PaginatedResult} object, containing an array of {@link PresenceMessage} objects.
   *
   * @param params - A set of parameters which are used to specify which presence members should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link PresenceMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/presence#get
   */
  get(params?: RestPresenceParams): Promise<PaginatedResult<PresenceMessage>>;
  /**
   * Retrieves a {@link PaginatedResult} object, containing an array of historical {@link PresenceMessage} objects for the channel. If the channel is configured to persist messages, then presence messages can be retrieved from history for up to 72 hours in the past. If not, presence messages can only be retrieved from history for up to two minutes in the past.
   *
   * @param params - A set of parameters which are used to specify which messages should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link PresenceMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/presence#history
   */
  history(params?: RestHistoryParams): Promise<PaginatedResult<PresenceMessage>>;
}

/**
 * Enables the presence set to be entered and subscribed to, and the historic presence set to be retrieved for a channel.
 */
export declare interface RealtimePresence {
  /**
   * Indicates whether the presence set synchronization between Ably and the clients on the channel has been completed.
   *
   * A `true` value means only that no sync is in progress. It does not mean the presence set is populated, since the flag is also `true` once the local set is cleared, and it returns to `false` whenever a new sync starts.
   *
   * To wait for an in-progress sync, call {@link RealtimePresence.get | `get()`}, which by default resolves only once the sync completes.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#properties
   */
  syncComplete: boolean;
  /**
   * Deregisters a specific listener that is registered to receive {@link PresenceMessage} on the channel for a given {@link PresenceAction}. This removes local listeners only and does not detach the channel or remove this client from the presence set. The server keeps streaming presence events to an attached channel, subject to the client's capabilities.
   *
   * @param presence - A specific {@link PresenceAction} to deregister the listener for.
   * @param listener - An event listener function.
   * @example
   * ```ts
   * channel.presence.unsubscribe('enter', listener);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#unsubscribe
   */
  unsubscribe(presence: PresenceAction, listener: messageCallback<PresenceMessage>): void;
  /**
   * Deregisters a specific listener that is registered to receive {@link PresenceMessage} on the channel for a given array of {@link PresenceAction} objects. This removes local listeners only and does not detach the channel or remove this client from the presence set. The server keeps streaming presence events to an attached channel, subject to the client's capabilities.
   *
   * @param presence - An array of {@link PresenceAction} objects to deregister the listener for.
   * @param listener - An event listener function.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#unsubscribe
   */
  unsubscribe(presence: Array<PresenceAction>, listener: messageCallback<PresenceMessage>): void;
  /**
   * Deregisters any listener that is registered to receive {@link PresenceMessage} on the channel for a specific {@link PresenceAction}. This removes local listeners only and does not detach the channel or remove this client from the presence set. The server keeps streaming presence events to an attached channel, subject to the client's capabilities.
   *
   * @param presence - A specific {@link PresenceAction} to deregister the listeners for.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#unsubscribe
   */
  unsubscribe(presence: PresenceAction): void;
  /**
   * Deregisters any listener that is registered to receive {@link PresenceMessage} on the channel for an array of {@link PresenceAction} objects. This removes local listeners only and does not detach the channel or remove this client from the presence set. The server keeps streaming presence events to an attached channel, subject to the client's capabilities.
   *
   * @param presence - An array of {@link PresenceAction} objects to deregister the listeners for.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#unsubscribe
   */
  unsubscribe(presence: Array<PresenceAction>): void;
  /**
   * Deregisters a specific listener that is registered to receive {@link PresenceMessage} on the channel. This removes local listeners only and does not detach the channel or remove this client from the presence set. The server keeps streaming presence events to an attached channel, subject to the client's capabilities.
   *
   * @param listener - An event listener function.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#unsubscribe
   */
  unsubscribe(listener: messageCallback<PresenceMessage>): void;
  /**
   * Deregisters all listeners currently receiving {@link PresenceMessage} for the channel. This removes local listeners only and does not detach the channel or remove this client from the presence set. The server keeps streaming presence events to an attached channel, subject to the client's capabilities.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#unsubscribe
   */
  unsubscribe(): void;

  /**
   * Retrieves the current members present on the channel and the metadata for each member, such as their {@link PresenceAction} and ID. Implicitly attaches the channel if it is not already attached. Without the `presence_subscribe` mode the call resolves with an empty array.
   *
   * On a channel in the `suspended` state the call rejects with an {@link ErrorInfo}. Pass `waitForSync: false` to resolve with the last known members instead.
   *
   * @param params - A set of parameters which are used to specify which presence members should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with an array of {@link PresenceMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const members = await channel.presence.get();
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#get
   */
  get(params?: RealtimePresenceParams): Promise<PresenceMessage[]>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimePresence.get | `channel.presence.get(params)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.presence.get(params, (err, members) => {});
   *
   * // v2:
   * const members = await channel.presence.get(params);
   * ```
   * @param params - A {@link RealtimePresenceParams} object.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  get(params: RealtimePresenceParams | null, callback: StandardCallback<PresenceMessage[]>): void;
  /**
   * Retrieves a {@link PaginatedResult} object, containing an array of historical {@link PresenceMessage} objects for the channel. Presence messages are returned from storage only when message persistence is enabled for the channel by a [rule](https://ably.com/docs/channels#rules). If message persistence is not enabled, only presence messages from the last two minutes are returned.
   *
   * @param params - A set of parameters which are used to specify which presence messages should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link PresenceMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const result = await channel.presence.history();
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#history
   */
  history(params?: RealtimeHistoryParams): Promise<PaginatedResult<PresenceMessage>>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimePresence.history | `channel.presence.history(params)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.presence.history(params, (err, result) => {});
   *
   * // v2:
   * const result = await channel.presence.history(params);
   * ```
   * @param params - A {@link RealtimeHistoryParams} object.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  history(params: RealtimeHistoryParams | null, callback: StandardCallback<PaginatedResult<PresenceMessage>>): void;
  /**
   * Registers a listener that is called each time a {@link PresenceMessage} matching a given {@link PresenceAction}, or an action within an array of {@link PresenceAction | `PresenceAction`s}, is received on the channel, such as a new member entering the presence set. Implicitly attaches the channel unless {@link ChannelOptions.attachOnSubscribe} is `false`. Without the `presence_subscribe` mode the server delivers no presence events and the listener never fires.
   *
   * @param action - A {@link PresenceAction} or an array of {@link PresenceAction | `PresenceAction`s} to register the listener for.
   * @param listener - An event listener function.
   * @returns A promise which resolves upon success of the channel {@link RealtimeChannel.attach | `attach()`} operation and rejects with an {@link ErrorInfo} object upon its failure. When {@link ChannelOptions.attachOnSubscribe} is `false`, no attach is performed.
   * @example
   * ```ts
   * await channel.presence.subscribe('enter', (member) => console.log(member.clientId));
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#subscribe
   */
  subscribe(action: PresenceAction | Array<PresenceAction>, listener?: messageCallback<PresenceMessage>): Promise<void>;
  /**
   * Registers a listener that is called each time a {@link PresenceMessage} is received on the channel, such as a new member entering the presence set. Implicitly attaches the channel unless {@link ChannelOptions.attachOnSubscribe} is `false`. Without the `presence_subscribe` mode the server delivers no presence events and the listener never fires.
   *
   * @param listener - An event listener function.
   * @returns A promise which resolves upon success of the channel {@link RealtimeChannel.attach | `attach()`} operation and rejects with an {@link ErrorInfo} object upon its failure. When {@link ChannelOptions.attachOnSubscribe} is `false`, no attach is performed.
   * @example
   * ```ts
   * await channel.presence.subscribe((member) => console.log(member.clientId));
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#subscribe
   */
  subscribe(listener?: messageCallback<PresenceMessage>): Promise<void>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimePresence.subscribe | `channel.presence.subscribe(action, listener)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.presence.subscribe('enter', listener, (err) => {});
   *
   * // v2:
   * await channel.presence.subscribe('enter', listener);
   * ```
   * @param action - A {@link PresenceAction} or an array of {@link PresenceAction | `PresenceAction`s}.
   * @param listener - An event listener function.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  subscribe(
    action: PresenceAction | Array<PresenceAction>,
    listener: messageCallback<PresenceMessage>,
    callback: ErrorCallback,
  ): void;
  /**
   * Enters the presence set for the channel, optionally passing a `data` payload. Implicitly attaches the channel if it is not already attached.
   *
   * Requires an identified client. If the `clientId` is unset, or is the wildcard `*`, the call rejects with an {@link ErrorInfo}. Set a `clientId` in {@link ClientOptions} or in the token, or use {@link RealtimePresence.enterClient | `enterClient()`} to enter on behalf of another identity.
   *
   * The member is automatically re-entered when the channel re-attaches after a disconnection. If that fails, the {@link ErrorInfo} arrives as a channel `update` event rather than as a rejection.
   *
   * @param data - The payload associated with the presence member.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.presence.enter({ status: 'online' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#enter
   */
  enter(data?: any): Promise<void>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimePresence.enter | `channel.presence.enter(data)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.presence.enter(data, (err) => {});
   *
   * // v2:
   * await channel.presence.enter(data);
   * ```
   * @param data - The payload associated with the presence member.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  enter(data: any, callback: ErrorCallback): void;
  /**
   * Updates the `data` payload for a presence member. If called before entering the presence set, this is treated as an {@link PresenceActions.ENTER} event. Implicitly attaches the channel if it is not already attached.
   *
   * Requires an identified client. If the `clientId` is unset, or is the wildcard `*`, the call rejects with an {@link ErrorInfo}. Use {@link RealtimePresence.updateClient | `updateClient()`} to update on behalf of another identity.
   *
   * @param data - The payload to update for the presence member.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.presence.update({ status: 'busy' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#update
   */
  update(data?: any): Promise<void>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimePresence.update | `channel.presence.update(data)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.presence.update(data, (err) => {});
   *
   * // v2:
   * await channel.presence.update(data);
   * ```
   * @param data - The payload to update for the presence member.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  update(data: any, callback: ErrorCallback): void;
  /**
   * Leaves the presence set for the channel. Use {@link RealtimePresence.leaveClient | `leaveClient()`} to leave on behalf of another identity.
   *
   * Leaving does not implicitly attach the channel. It requires a channel in the `attached` state. On an `attaching` channel the call is queued until the channel attaches, unless {@link ClientOptions.queueMessages} is disabled. In any other channel state, or when the connection is unusable, it rejects with an {@link ErrorInfo}.
   *
   * @param data - The payload associated with the presence member.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.presence.leave();
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#leave
   */
  leave(data?: any): Promise<void>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimePresence.leave | `channel.presence.leave(data)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.presence.leave(data, (err) => {});
   *
   * // v2:
   * await channel.presence.leave(data);
   * ```
   * @param data - The payload associated with the presence member.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  leave(data: any, callback: ErrorCallback): void;
  /**
   * Enters the presence set of the channel for a given `clientId`. Enables a single client to update presence on behalf of any number of clients using a single connection. Implicitly attaches the channel if it is not already attached.
   *
   * Requires an API key or token bound to a wildcard `clientId`. Without one the call rejects with an {@link ErrorInfo} from the server.
   *
   * The member is automatically re-entered when the channel re-attaches after a disconnection. If that fails, the {@link ErrorInfo} arrives as a channel `update` event rather than as a rejection.
   *
   * @param clientId - The ID of the client to enter into the presence set.
   * @param data - The payload associated with the presence member.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.presence.enterClient('bob', { status: 'online' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#enter-client
   */
  enterClient(clientId: string, data?: any): Promise<void>;
  /**
   * Updates the `data` payload for a presence member using a given `clientId`. Enables a single client to update presence on behalf of any number of clients using a single connection. Implicitly attaches the channel if it is not already attached.
   *
   * Requires an API key or token bound to a wildcard `clientId`. Without one the call rejects with an {@link ErrorInfo} from the server.
   *
   * @param clientId - The ID of the client to update in the presence set.
   * @param data - The payload to update for the presence member.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.presence.updateClient('bob', { status: 'busy' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#update-client
   */
  updateClient(clientId: string, data?: any): Promise<void>;
  /**
   * Leaves the presence set of the channel for a given `clientId`. Enables a single client to update presence on behalf of any number of clients using a single connection.
   *
   * Requires an API key or token bound to a wildcard `clientId`. Without one the call rejects with an {@link ErrorInfo} from the server.
   *
   * Leaving does not implicitly attach the channel. It requires a channel in the `attached` state. On an `attaching` channel the call is queued until the channel attaches, unless {@link ClientOptions.queueMessages} is disabled. In any other channel state, or when the connection is unusable, it rejects with an {@link ErrorInfo}.
   *
   * @param clientId - The ID of the client to leave the presence set for.
   * @param data - The payload associated with the presence member.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.presence.leaveClient('bob');
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-presence#leave-client
   */
  leaveClient(clientId: string, data?: any): Promise<void>;
}

/**
 * Functionality for annotating messages with small pieces of data, such as emoji
 * reactions, that the server will roll up into the message as a summary.
 */
export declare interface RealtimeAnnotations {
  /**
   * Registers a listener that is called each time an {@link Annotation} matching a given type is received on the channel. Implicitly attaches the channel unless {@link ChannelOptions.attachOnSubscribe} is `false`.
   *
   * Individual annotations are delivered only to clients that request the `annotation_subscribe` mode via {@link ChannelOptions.modes}, since most clients can rely on the rolled-up summary updates instead. The server grants the mode only if the key or token has the `annotation-subscribe` capability, and silently drops it otherwise.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations). Without it the attach rejects with an {@link ErrorInfo}.
   *
   * On a channel in the `failed` state the call rejects before the listener is registered. If the channel attaches without the mode it also rejects, but the listener stays registered and will fire if the mode is granted later. Remove it with {@link RealtimeAnnotations.unsubscribe | `unsubscribe()`} if that is not what you want. When {@link ChannelOptions.attachOnSubscribe} is `false` and the channel is not yet attached, the call resolves and a listener that lacks the mode never fires.
   *
   * @param type - A specific type string or an array of them to register the listener for.
   * @param listener - An event listener function.
   * @returns A promise which resolves upon success of the channel {@link RealtimeChannel.attach | `attach()`} operation and rejects with an {@link ErrorInfo} object upon its failure. When {@link ChannelOptions.attachOnSubscribe} is `false`, no attach is performed.
   * @example
   * ```ts
   * await channel.annotations.subscribe('emoji:distinct.v1', (annotation) => console.log(annotation.name));
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-subscribe
   */
  subscribe(type: string | Array<string>, listener?: messageCallback<Annotation>): Promise<void>;
  /**
   * Registers a listener that is called each time an {@link Annotation} is received on the channel. Implicitly attaches the channel unless {@link ChannelOptions.attachOnSubscribe} is `false`.
   *
   * Individual annotations are delivered only to clients that request the `annotation_subscribe` mode via {@link ChannelOptions.modes}, since most clients can rely on the rolled-up summary updates instead. The server grants the mode only if the key or token has the `annotation-subscribe` capability, and silently drops it otherwise.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations). Without it the attach rejects with an {@link ErrorInfo}.
   *
   * On a channel in the `failed` state the call rejects before the listener is registered. If the channel attaches without the mode it also rejects, but the listener stays registered and will fire if the mode is granted later. Remove it with {@link RealtimeAnnotations.unsubscribe | `unsubscribe()`} if that is not what you want. When {@link ChannelOptions.attachOnSubscribe} is `false` and the channel is not yet attached, the call resolves and a listener that lacks the mode never fires.
   *
   * @param listener - An event listener function.
   * @returns A promise which resolves upon success of the channel {@link RealtimeChannel.attach | `attach()`} operation and rejects with an {@link ErrorInfo} object upon its failure. When {@link ChannelOptions.attachOnSubscribe} is `false`, no attach is performed.
   * @example
   * ```ts
   * await channel.annotations.subscribe((annotation) => console.log(annotation.name));
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-subscribe
   */
  subscribe(listener?: messageCallback<Annotation>): Promise<void>;
  /**
   * Deregisters a specific listener that is registered to receive {@link Annotation} on the channel for a given type. This removes local listeners only and does not detach the channel. The server keeps streaming annotations to an attached channel, subject to the client's capabilities.
   *
   * @param type - A specific annotation type (or array of types) to deregister the listener for.
   * @param listener - An event listener function.
   * @example
   * ```ts
   * channel.annotations.unsubscribe('emoji:distinct.v1', listener);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-unsubscribe
   */
  unsubscribe(type: string | Array<string>, listener: messageCallback<Annotation>): void;
  /**
   * Deregisters any listener that is registered to receive {@link Annotation} on the channel for a specific type. This removes local listeners only and does not detach the channel. The server keeps streaming annotations to an attached channel, subject to the client's capabilities.
   *
   * @param type - A specific annotation type (or array of types) to deregister the listeners for.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-unsubscribe
   */
  unsubscribe(type: string | Array<string>): void;
  /**
   * Deregisters a specific listener that is registered to receive {@link Annotation} on the channel. This removes local listeners only and does not detach the channel. The server keeps streaming annotations to an attached channel, subject to the client's capabilities.
   *
   * @param listener - An event listener function.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-unsubscribe
   */
  unsubscribe(listener: messageCallback<Annotation>): void;
  /**
   * Deregisters all listeners currently receiving {@link Annotation} for the channel. This removes local listeners only and does not detach the channel. The server keeps streaming annotations to an attached channel, subject to the client's capabilities.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-unsubscribe
   */
  unsubscribe(): void;
  /**
   * Publish a new annotation for a message. If the annotation specifies no `action`, it defaults to `annotation.create`.
   *
   * The supplied {@link Message} must carry a populated `serial`. A newly constructed {@link Message} has none, so the call rejects with an {@link ErrorInfo}.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations), and the key or token must have the `annotation-publish` capability. Without either the server rejects the operation, so the call rejects with an {@link ErrorInfo}.
   *
   * Does not implicitly attach the channel. It rejects with an {@link ErrorInfo} on a channel in the `failed` or `suspended` state, or when the connection is unusable.
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
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-publish
   */
  publish(message: Message, annotation: OutboundAnnotation): Promise<void>;
  /**
   * Publish a new annotation for a message. If the annotation specifies no `action`, it defaults to `annotation.create`.
   *
   * The supplied serial must be a non-empty string, otherwise the call rejects with an {@link ErrorInfo}.
   *
   * Message annotations must be enabled for the channel's namespace by a [rule](https://ably.com/docs/messages/annotations), and the key or token must have the `annotation-publish` capability. Without either the server rejects the operation, so the call rejects with an {@link ErrorInfo}.
   *
   * Does not implicitly attach the channel. It rejects with an {@link ErrorInfo} on a channel in the `failed` or `suspended` state, or when the connection is unusable.
   *
   * Annotation data is encrypted when {@link ChannelOptions.cipher} is set, as it is for messages and presence messages.
   *
   * @param messageSerial - The serial field of the message to annotate.
   * @param annotation - The annotation to publish. It must include at least the `type`. Other required fields depend on the annotation type.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.annotations.publish(message.serial, { type: 'emoji:distinct.v1', name: '👍' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-publish
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
   * Does not implicitly attach the channel. It rejects with an {@link ErrorInfo} on a channel in the `failed` or `suspended` state, or when the connection is unusable.
   *
   * @param message - The message which has an annotation that you want to delete.
   * @param annotation - The annotation deletion request. It must include at least the `type`. Other required fields depend on the type.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.annotations.delete(message, { type: 'emoji:distinct.v1', name: '👍' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-delete
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
   * Does not implicitly attach the channel. It rejects with an {@link ErrorInfo} on a channel in the `failed` or `suspended` state, or when the connection is unusable.
   *
   * @param messageSerial - The serial field of the message which has an annotation that
   * you want to delete.
   * @param annotation - The annotation deletion request. It must include at least the `type`. Other required fields depend on the type.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.annotations.delete(message.serial, { type: 'emoji:distinct.v1', name: '👍' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-delete
   */
  delete(messageSerial: string, annotation: OutboundAnnotation): Promise<void>;
  /**
   * Get all annotations for a given message.
   *
   * Does not implicitly attach the channel, and can be called in any channel or connection state. It does not require the `annotation_subscribe` mode.
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
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-get
   */
  get(message: Message, params: GetAnnotationsParams | null): Promise<PaginatedResult<Annotation>>;
  /**
   * Get all annotations for a given message.
   *
   * Does not implicitly attach the channel, and can be called in any channel or connection state. It does not require the `annotation_subscribe` mode.
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
   * const result = await channel.annotations.get(message.serial, null);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-annotations#annotations-get
   */
  get(messageSerial: string, params: GetAnnotationsParams | null): Promise<PaginatedResult<Annotation>>;
}

/**
 * Enables devices to subscribe to push notifications for a channel.
 */
export declare interface PushChannel {
  /**
   * Subscribes the device to push notifications for the channel.
   */
  subscribeDevice(): Promise<void>;

  /**
   * Unsubscribes the device from receiving push notifications for the channel.
   */
  unsubscribeDevice(): Promise<void>;

  /**
   * Subscribes all devices associated with the current device's `clientId` to push notifications for the channel.
   */
  subscribeClient(): Promise<void>;

  /**
   * Unsubscribes all devices associated with the current device's `clientId` from receiving push notifications for the channel.
   */
  unsubscribeClient(): Promise<void>;

  /**
   * Retrieves all push subscriptions for the channel. Subscriptions can be filtered using a params object.
   *
   * @param params - An object containing key-value pairs to filter subscriptions by. Can contain `clientId`, `deviceId` or a combination of both, and a `limit` on the number of subscriptions returned, up to 1,000.
   * @returns a {@link PaginatedResult} object containing an array of {@link PushChannelSubscription} objects.
   */
  listSubscriptions(params?: Record<string, string>): Promise<PaginatedResult<PushChannelSubscription>>;
}

/**
 * Enables messages to be published and historic messages to be retrieved for a channel.
 */
export declare interface Channel {
  /**
   * The channel name.
   */
  name: string;

  /**
   * A {@link Presence} object.
   */
  presence: Presence;
  /**
   * {@link RestAnnotations}
   */
  annotations: RestAnnotations;
  /**
   * A {@link PushChannel} object.
   */
  push: PushChannel;
  /**
   * Retrieves a {@link PaginatedResult} object, containing an array of historical {@link InboundMessage} objects for the channel. If the channel is configured to persist messages, then messages can be retrieved from history for up to 72 hours in the past. If not, messages can only be retrieved from history for up to two minutes in the past.
   *
   * @param params - A set of parameters which are used to specify which messages should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link InboundMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @see https://ably.com/docs/pub-sub/api/javascript/rest/channel#history
   */
  history(params?: RestHistoryParams): Promise<PaginatedResult<InboundMessage>>;
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
export declare interface RestAnnotations {
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

/**
 * Enables messages to be published and subscribed to. Also enables historic messages to be retrieved and provides access to the {@link RealtimePresence} object of a channel.
 */
export declare interface RealtimeChannel extends EventEmitter<channelEventCallback, ChannelStateChange, ChannelEvent> {
  /**
   * The channel name.
   */
  readonly name: string;
  /**
   * An {@link ErrorInfo} object describing the last error which occurred on the channel, if any. This is `null` until an error occurs, for example a transition in channel state to `failed` or `suspended`. Guard against `null` despite the declared type.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#properties
   */
  errorReason: ErrorInfo;
  /**
   * The current {@link ChannelState} of the channel.
   */
  readonly state: ChannelState;
  /**
   * Optional channel parameters that configure the behavior of the channel. After the channel attaches this reflects the parameters the server confirmed on the most recent attach.
   *
   * It is `undefined` before the channel attaches for the first time, so guard against `undefined` despite the declared type.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#properties
   */
  params: ChannelParams;
  /**
   * An array of {@link ResolvedChannelMode} objects reflecting the modes the server granted on the most recent attach. The server grants only the modes the key or token capability permits, so this may be a subset of the modes requested via {@link ChannelOptions.modes}.
   *
   * It is `undefined` before the channel attaches for the first time. When the server grants no modes, it is also `undefined`, not an empty array. Guard against `undefined` despite the declared type.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#properties
   */
  modes: ResolvedChannelMode[];
  /**
   * Deregisters the given listener for the specified event name. This removes local listeners only and does not detach the channel. The server keeps streaming messages to an attached channel, subject to the client's capabilities.
   *
   * @param event - The event name.
   * @param listener - An event listener function.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#unsubscribe
   */
  unsubscribe(event: string, listener: messageCallback<InboundMessage>): void;
  /**
   * Deregisters the given listener from all event names in the array. This removes local listeners only and does not detach the channel. The server keeps streaming messages to an attached channel, subject to the client's capabilities.
   *
   * @param events - An array of event names.
   * @param listener - An event listener function.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#unsubscribe
   */
  unsubscribe(events: Array<string>, listener: messageCallback<InboundMessage>): void;
  /**
   * Deregisters all listeners for the given event name. This removes local listeners only and does not detach the channel. The server keeps streaming messages to an attached channel, subject to the client's capabilities.
   *
   * @param event - The event name.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#unsubscribe
   */
  unsubscribe(event: string): void;
  /**
   * Deregisters all listeners for all event names in the array. This removes local listeners only and does not detach the channel. The server keeps streaming messages to an attached channel, subject to the client's capabilities.
   *
   * @param events - An array of event names.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#unsubscribe
   */
  unsubscribe(events: Array<string>): void;
  /**
   * Deregisters listeners registered with the supplied {@link MessageFilter}. The filter is matched by object identity, so pass the same object given to {@link RealtimeChannel.subscribe | `subscribe()`}. Any other filter object removes nothing and no error is raised. This removes local listeners only and does not detach the channel. The server keeps streaming messages to an attached channel, subject to the client's capabilities.
   *
   * @param filter - A {@link MessageFilter}.
   * @param listener - An event listener function.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#unsubscribe
   */
  unsubscribe(filter: MessageFilter, listener?: messageCallback<InboundMessage>): void;
  /**
   * Deregisters the given listener from all event names. This removes local listeners only and does not detach the channel. The server keeps streaming messages to an attached channel, subject to the client's capabilities.
   *
   * @param listener - An event listener function.
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#unsubscribe
   */
  unsubscribe(listener: messageCallback<InboundMessage>): void;
  /**
   * Deregisters all listeners to messages on this channel. This removes local listeners only and does not detach the channel. The server keeps streaming messages to an attached channel, subject to the client's capabilities.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#unsubscribe
   */
  unsubscribe(): void;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimeChannel.unsubscribe | `channel.unsubscribe(name, listener)`} — the v2 API is synchronous. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.unsubscribe('event', listener, (err) => {});
   *
   * // v2:
   * channel.unsubscribe('event', listener);
   * ```
   * @param event - The event name.
   * @param listener - An event listener function.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  unsubscribe(event: string, listener: messageCallback<InboundMessage>, callback: ErrorCallback): void;

  /**
   * A {@link RealtimePresence} object.
   */
  presence: RealtimePresence;
  /**
   * A {@link PushChannel} object that manages device push notification subscriptions for this channel. Accessing this property requires the `Push` plugin to be registered via {@link ClientOptions.plugins}. The default and modular builds do not bundle the `Push` plugin. If the plugin is absent, the getter throws an {@link ErrorInfo} rather than returning a {@link PushChannel}.
   *
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#properties
   */
  push: PushChannel;
  /**
   * A {@link RealtimeAnnotations} object.
   */
  annotations: RealtimeAnnotations;
  /**
   * Attach to this channel so that messages published on it are received by any listeners registered with {@link RealtimeChannel.subscribe | `subscribe()`}. It also emits the resulting channel state change to listeners registered with `on()` or `once()`.
   *
   * As a convenience you need not call this directly. It is invoked implicitly by {@link RealtimeChannel.subscribe | `channel.subscribe()`}, by {@link RealtimePresence.enter | `presence.enter()`}, {@link RealtimePresence.enterClient | `presence.enterClient()`}, {@link RealtimePresence.update | `presence.update()`}, {@link RealtimePresence.updateClient | `presence.updateClient()`}, {@link RealtimePresence.subscribe | `presence.subscribe()`}, or {@link RealtimePresence.get | `presence.get()`}, by {@link RealtimeAnnotations.subscribe | `annotations.subscribe()`}, or by LiveObjects `get()`.
   *
   * The returned promise rejects with an {@link ErrorInfo} if the connection is in the `suspended`, `closing`, `closed`, or `failed` state. It also rejects if the channel transitions to `detaching`, `detached`, `suspended`, or `failed` instead of attaching.
   *
   * @returns A promise which, upon success, if the channel became attached will be fulfilled with a {@link ChannelStateChange} object. If the channel was already attached the promise will be fulfilled with `null`. Upon failure, the promise will be rejected with an {@link ErrorInfo} object.
   * @example
   * ```ts
   * await channel.attach();
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#attach
   */
  attach(): Promise<ChannelStateChange | null>;
  /**
   * Detach from this channel. Any resulting channel state change is emitted to listeners registered with `on()` or `once()`.
   *
   * Detaching stops the server sending this channel's messages and any other channel traffic to the client. Locally registered listeners remain registered.
   *
   * Once all clients globally have detached from the channel, the channel is released in the Ably service within two minutes.
   *
   * Detaching from a channel in the `suspended` or `detached` state resolves without further action. Calling `detach()` on a channel in the `detaching` state does not start a second detach, and the returned promise resolves once the channel transitions to the `detached` state. Detaching from a channel in the `failed` state rejects with an {@link ErrorInfo}. Release the channel with {@link Channels.release | `release()`} and get it again with {@link Channels.get | `get()`} to start afresh.
   *
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.detach();
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#detach
   */
  detach(): Promise<void>;
  /**
   * Retrieves a {@link PaginatedResult} object, containing an array of historical {@link InboundMessage} objects for the channel.
   *
   * Messages are returned from storage only when message persistence is enabled for the channel by a [rule](https://ably.com/docs/channels#rules). If message persistence is not enabled, only messages from the last two minutes are returned.
   *
   * @param params - A set of parameters which are used to specify which messages should be retrieved.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link InboundMessage} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * const result = await channel.history({ limit: 25 });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#history
   */
  history(params?: RealtimeHistoryParams): Promise<PaginatedResult<InboundMessage>>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimeChannel.history | `channel.history(params)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.history(params, (err, result) => {});
   *
   * // v2:
   * const result = await channel.history(params);
   * ```
   * @param params - A {@link RealtimeHistoryParams} object.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  history(params: RealtimeHistoryParams | null, callback: StandardCallback<PaginatedResult<InboundMessage>>): void;
  /**
   * Sets the {@link ChannelOptions} for the channel.
   *
   * Changing {@link ChannelOptions.modes} or {@link ChannelOptions.params} while the channel is attached or attaching re-attaches it to apply them, and the promise resolves only once the server confirms the new options. It rejects with an {@link ErrorInfo} if the channel transitions to `detached` or `failed` instead. If the channel is not attached or attaching, changed {@link ChannelOptions.modes} or {@link ChannelOptions.params} are stored and applied on the next attach. Other options, such as a cipher, take effect immediately.
   *
   * The promise also rejects with an {@link ErrorInfo} when the supplied options are invalid.
   *
   * @param options - A {@link ChannelOptions} object.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   * @example
   * ```ts
   * await channel.setOptions({ params: { rewind: '1' } });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#set-options
   */
  setOptions(options: ChannelOptions): Promise<void>;
  /**
   * Registers a listener for messages with a given event name on this channel. Implicitly attaches the channel unless {@link ChannelOptions.attachOnSubscribe} is `false`. Without the `subscribe` mode the server delivers no messages and the listener never fires.
   *
   * @param event - The event name.
   * @param listener - An event listener function.
   * @returns A promise which, upon successful attachment to the channel, will be fulfilled with a {@link ChannelStateChange} object. If the channel was already attached the promise will be resolved with `null`. The promise also resolves with `null` when {@link ChannelOptions.attachOnSubscribe} is `false`, in which case no attach is attempted. Upon failure, the promise will be rejected with an {@link ErrorInfo} object.
   * @example
   * ```ts
   * await channel.subscribe('event', (message) => console.log(message.data));
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#subscribe
   */
  subscribe(event: string, listener?: messageCallback<InboundMessage>): Promise<ChannelStateChange | null>;
  /**
   * Registers a listener for messages on this channel for multiple event name values. Implicitly attaches the channel unless {@link ChannelOptions.attachOnSubscribe} is `false`. Without the `subscribe` mode the server delivers no messages and the listener never fires.
   *
   * @param events - An array of event names.
   * @param listener - An event listener function.
   * @returns A promise which, upon successful attachment to the channel, will be fulfilled with a {@link ChannelStateChange} object. If the channel was already attached the promise will be resolved with `null`. The promise also resolves with `null` when {@link ChannelOptions.attachOnSubscribe} is `false`, in which case no attach is attempted. Upon failure, the promise will be rejected with an {@link ErrorInfo} object.
   * @example
   * ```ts
   * await channel.subscribe(['event1', 'event2'], (message) => console.log(message.data));
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#subscribe
   */
  subscribe(events: Array<string>, listener?: messageCallback<InboundMessage>): Promise<ChannelStateChange | null>;
  /**
   * {@label WITH_MESSAGE_FILTER}
   *
   * Registers a listener for messages on this channel that match the supplied filter. Implicitly attaches the channel unless {@link ChannelOptions.attachOnSubscribe} is `false`. Without the `subscribe` mode the server delivers no messages and the listener never fires.
   *
   * @param filter - A {@link MessageFilter}.
   * @param listener - An event listener function.
   * @returns A promise which, upon successful attachment to the channel, will be fulfilled with a {@link ChannelStateChange} object. If the channel was already attached the promise will be resolved with `null`. The promise also resolves with `null` when {@link ChannelOptions.attachOnSubscribe} is `false`, in which case no attach is attempted. Upon failure, the promise will be rejected with an {@link ErrorInfo} object.
   * @example
   * ```ts
   * await channel.subscribe({ name: 'event' }, (message) => console.log(message.data));
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#subscribe
   */
  subscribe(filter: MessageFilter, listener?: messageCallback<InboundMessage>): Promise<ChannelStateChange | null>;
  /**
   * Registers a listener for messages on this channel. Implicitly attaches the channel unless {@link ChannelOptions.attachOnSubscribe} is `false`. Without the `subscribe` mode the server delivers no messages and the listener never fires.
   *
   * @param callback - An event listener function.
   * @returns A promise which, upon successful attachment to the channel, will be fulfilled with a {@link ChannelStateChange} object. If the channel was already attached the promise will be resolved with `null`. The promise also resolves with `null` when {@link ChannelOptions.attachOnSubscribe} is `false`, in which case no attach is attempted. Upon failure, the promise will be rejected with an {@link ErrorInfo} object.
   * @example
   * ```ts
   * await channel.subscribe((message) => console.log(message.data));
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#subscribe
   */
  subscribe(callback: messageCallback<InboundMessage>): Promise<ChannelStateChange | null>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimeChannel.subscribe | `channel.subscribe(name, listener)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.subscribe('event', listener, (err) => { if (err) console.error(err); });
   *
   * // v2:
   * await channel.subscribe('event', listener);
   * ```
   * @param event - The event name.
   * @param listener - An event listener function.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  subscribe(event: string, listener: messageCallback<InboundMessage>, callback: ErrorCallback): void;
  /**
   * Publishes a single message to the channel with the given event name and payload.
   *
   * @param name - The event name.
   * @param data - The message payload.
   * @param options - Optional parameters to modify how the publish is made.
   * @returns A promise which, upon success, will be fulfilled with a {@link PublishResult} object containing the serial of the published message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * await channel.publish('event', { text: 'hello' });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#publish
   */
  publish(name: string, data: any, options?: PublishOptions): Promise<PublishResult>;
  /**
   * Publishes an array of messages to the channel.
   *
   * @param messages - An array of {@link Message} objects.
   * @param options - Optional parameters to modify how the publish is made.
   * @returns A promise which, upon success, will be fulfilled with a {@link PublishResult} object containing the serials of the published messages. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * await channel.publish([{ name: 'event', data: { text: 'hello' } }]);
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#publish
   */
  publish(messages: Message[], options?: PublishOptions): Promise<PublishResult>;
  /**
   * Publishes a message to the channel.
   *
   * @param message - A {@link Message} object.
   * @param options - Optional parameters to modify how the publish is made.
   * @returns A promise which, upon success, will be fulfilled with a {@link PublishResult} object containing the serial of the published message. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   * @example
   * ```ts
   * await channel.publish({ name: 'event', data: { text: 'hello' } });
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#publish
   */
  publish(message: Message, options?: PublishOptions): Promise<PublishResult>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link RealtimeChannel.publish | `channel.publish(name, data)`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * channel.publish('event', data, (err) => { if (err) console.error(err); });
   *
   * // v2:
   * await channel.publish('event', data);
   * ```
   * @param name - The event name.
   * @param data - The message payload.
   * @param callback - v1 Node-style callback (no longer supported).
   */
  publish(name: string, data: any, callback: ErrorCallback): void;
  /**
   * If the channel is already in the given state, resolves immediately with `null`. Otherwise resolves with the {@link ChannelStateChange} the next time the channel transitions to the given state. If the channel never transitions to the given state, the promise never settles and no error is raised.
   *
   * @param targetState - The channel state to wait for.
   * @example
   * ```ts
   * const stateChange = await channel.whenState('attached');
   * ```
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#when-state
   */
  whenState(targetState: ChannelState): Promise<ChannelStateChange | null>;
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
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#get-message
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
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#update-message
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
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#delete-message
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
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#append-message
   */
  appendMessage(message: Message, operation?: MessageOperation, options?: PublishOptions): Promise<UpdateDeleteResult>;
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
   * @see https://ably.com/docs/pub-sub/api/javascript/realtime/realtime-channel#get-message-versions
   */
  getMessageVersions(
    serialOrMessage: string | Message,
    params?: Record<string, any>,
  ): Promise<PaginatedResult<Message>>;
}

/**
 * Optional parameters for message publishing.
 */
export type PublishOptions = {
  /**
   * Publish options are server-defined
   */
  [k: string]: string | number | boolean | undefined;
};

/**
 * Contains properties to filter messages with when calling {@link RealtimeChannel.subscribe | `RealtimeChannel.subscribe()`}.
 */
export type MessageFilter = {
  /**
   * Filters messages by a specific message `name`.
   */
  name?: string;
  /**
   * Filters messages by a specific `extras.ref.timeserial` value.
   */
  refTimeserial?: string;
  /**
   * Filters messages by a specific `extras.ref.type` value.
   */
  refType?: string;
  /**
   * Filters messages based on whether they contain an `extras.ref`.
   */
  isRef?: boolean;
  /**
   * Filters messages by a specific message `clientId`.
   */
  clientId: string;
};

/**
 * Creates and destroys {@link Channel} and {@link RealtimeChannel} objects.
 */
export declare interface Channels<T> {
  /**
   * Creates a new {@link Channel} or {@link RealtimeChannel} object, with the specified {@link ChannelOptions}, or returns the existing channel object.
   *
   * @param name - The channel name.
   * @param channelOptions - A {@link ChannelOptions} object.
   * @returns A {@link Channel} or {@link RealtimeChannel} object.
   */
  get(name: string, channelOptions?: ChannelOptions): T;
  /**
   * Creates a new {@link Channel} or {@link RealtimeChannel} object, with the specified channel {@link DeriveOptions}
   * and {@link ChannelOptions}, or returns the existing channel object.
   *
   * @experimental This is a preview feature and may change in a future non-major release.
   * This experimental method allows you to create custom realtime data feeds by selectively subscribing
   * to receive only part of the data from the channel.
   * See the [announcement post](https://pages.ably.com/subscription-filters-preview) for more information.
   * @param name - The channel name.
   * @param deriveOptions - A {@link DeriveOptions} object.
   * @param channelOptions - A {@link ChannelOptions} object.
   * @returns A {@link RealtimeChannel} object.
   */
  getDerived(name: string, deriveOptions: DeriveOptions, channelOptions?: ChannelOptions): T;
  /**
   * Releases all SDK-held references to a {@link Channel} or {@link RealtimeChannel} object, enabling it to be garbage collected. Warning: this method has no guardrails; using a channel reference after it has been released is undefined behaviour. It can be useful for applications that work with a continually changing set of channels on a single client and need to avoid unbounded memory growth; if this does not describe you, don't call it. Realtime channels not already in the `INITIALIZED`, `DETACHED`, or `FAILED` state are detached before release.
   *
   * @param name - The channel name.
   */
  release(name: string): void;
  /**
   * All of the channels that exist in this `Channels` object.
   *
   * Channels are added here when created using {@link get}, and removed when released using {@link release}.
   */
  all: Record<string, T>;
}

/** The summary entry for aggregated annotations that use the distinct.v1
 * aggregation method. */
export interface SummaryDistinctValues {
  [key: string]: SummaryClientIdList;
}

/** The summary entry for aggregated annotations that use the unique.v1
 * aggregation method. */
export interface SummaryUniqueValues {
  [key: string]: SummaryClientIdList;
}

/** The summary entry for aggregated annotations that use the multiple.v1
 * aggregation method. */
export interface SummaryMultipleValues {
  [key: string]: SummaryClientIdCounts;
}

/** The summary entry for aggregated annotations that use the flag.v1
 * aggregation method; also the per-name value for some other aggregation methods. */
export interface SummaryClientIdList {
  /** The total number of clients who have published an annotation with this name (or
   * type, depending on context). */
  total: number;
  /** A list of the clientIds of all clients who have published an annotation with this name (or
   * type, depending on context). */
  clientIds: string[];
  /** Whether the list of clientIds has been clipped due to exceeding the maximum number of
   * clients. */
  clipped: boolean;
}

/** The per-name value for the multiple.v1 aggregation method. */
export interface SummaryClientIdCounts {
  /** The sum of the counts from all clients who have published an annotation with this
   * name */
  total: number;
  /** A list of the clientIds of all clients who have published an annotation with this
   * name, and the count each of them have contributed. */
  clientIds: { [key: string]: number };
  /** The sum of the counts from all unidentified clients who have published an annotation with this
   * name, and so who are not included in the clientIds list */
  totalUnidentified: number;
  /** Whether the list of clientIds has been clipped due to exceeding the maximum number of
   * clients. */
  clipped: boolean;
  /** The total number of distinct clientIds in the map (equal to length of map if clipped is false). */
  totalClientIds: number;
}

/** The summary entry for aggregated annotations that use the total.v1
 * aggregation method. */
export interface SummaryTotal {
  /** The total number of clients who have published an annotation with this name (or
   * type, depending on context). */
  total: number;
}

/** The different possible values of the Message.summary map. */
export type SummaryEntry =
  | SummaryDistinctValues
  | SummaryUniqueValues
  | SummaryMultipleValues
  | SummaryClientIdList
  | SummaryTotal;

/**
 * Contains an individual message that is sent to, or received from, Ably.
 */
export interface Message {
  /**
   * The client ID of the publisher of this message.
   */
  clientId?: string;
  /**
   * The connection ID of the publisher of this message.
   */
  connectionId?: string;
  /**
   * The message payload, if provided.
   */
  data?: any;
  /**
   * This is typically empty, as all messages received from Ably are automatically decoded client-side using this value. However, if the message encoding cannot be processed, this attribute contains the remaining transformations not applied to the `data` payload.
   */
  encoding?: string;
  /**
   * A JSON object of arbitrary key-value pairs that may contain metadata, and/or ancillary payloads. Valid payloads include `push`, `delta`, `ref` and `headers`.
   */
  extras?: any;
  /**
   * An ID associated with the message. Clients may set this field explicitly when publishing a message to enable
   * idempotent publishing. If not set, this will be generated by the server.
   *
   * For the canonical identifier of the message on the server, see `serial`.
   */
  id?: string;
  /**
   * The event name.
   */
  name?: string;
  /**
   * Timestamp of when the message was received by Ably, as milliseconds since the Unix epoch.
   * (This is the timestamp of the current version of the message)
   */
  timestamp?: number;
  /**
   * The action type of the message, one of the {@link MessageAction} enum values.
   */
  action?: MessageAction;
  /**
   * This message's unique serial (an identifier that will be the same in all future
   * updates of this message).
   */
  serial?: string;
  /**
   * The latest version of the message, containing version-specific metadata.
   */
  version?: MessageVersion;
  /**
   * Allows a REST client to publish a message on behalf of a Realtime client. If you set this to the {@link Connection.key | private connection key} of a Realtime connection when publishing a message using a {@link RestClient}, the message will be published on behalf of that Realtime client. This property is only populated by a client performing a publish, and will never be populated on an inbound message.
   */
  connectionKey?: string;
  /**
   * Annotations associated with this message.
   */
  annotations?: MessageAnnotations;
}

/**
 * An annotation to a message, received from Ably
 */
export interface Annotation {
  /**
   * Unique ID assigned by Ably to this annotation.
   */
  id: string;
  /**
   * The client ID of the publisher of this annotation (if any).
   */
  clientId?: string;
  /**
   * The name of this annotation. This is the field that most annotation aggregations will
   * operate on. For example, using "distinct.v1" aggregation (specified in the type), the
   * message summary will show a list of clients who have published an annotation with
   * each distinct annotation.name.
   */
  name?: string;
  /**
   * An optional count, only relevant to certain aggregation types, see aggregation types
   * documentation for more info.
   */
  count?: number;
  /**
   * An arbitrary publisher-provided payload, if provided. Not aggregated.
   */
  data?: any;
  /**
   * The encoding of the payload; typically empty as the data is decoded client-side back
   * into the original data type.
   */
  encoding?: string;
  /**
   * Timestamp of when the annotation was received by Ably, as milliseconds since the Unix epoch.
   */
  timestamp: number;
  /**
   * The action, whether this is an annotation being added or removed, one of the {@link AnnotationAction} enum values.
   */
  action: AnnotationAction;
  /**
   * This message's unique serial (lexicographically totally ordered).
   */
  serial: string;
  /**
   * The serial of the message (of type message.create) that this annotation is annotating.
   */
  messageSerial: string;
  /**
   * The type of annotation it is, typically some name together with an aggregation
   * method; for example: "emoji:distinct.v1". Handled opaquely by the SDK and validated serverside.
   */
  type: string;
  /**
   * A JSON object for metadata and/or ancillary payloads.
   */
  extras: any;
}

/**
 * A variant of the Annotation type customized for those fields which need to be populated
 * by the user when publishing an annotation.
 */
export type OutboundAnnotation = Partial<Annotation> & {
  /**
   * The type of annotation it is, typically some name together with an aggregation
   * method; for example: "emoji:distinct.v1". Handled opaquely by the SDK and validated serverside.
   */
  type: string;
};

/**
 * Contains the details regarding the current version of the message - including when it was updated and by whom.
 */
export interface MessageVersion {
  /**
   * A unique identifier for the version of the message, lexicographically-comparable with other versions (that
   * share the same `Message.serial`). Will differ from the `Message.serial` only if the message has been
   * updated or deleted.
   */
  serial?: string;
  /**
   * The timestamp of the message version.
   *
   * If the `Message.action` is `message.create`, this will equal the `Message.timestamp`.
   */
  timestamp?: number;
  /**
   * The client ID of the client that updated the message to this version.
   */
  clientId?: string;
  /**
   * The description provided by the client that updated the message to this version.
   */
  description?: string;
  /**
   * A JSON object of string key-value pairs that may contain metadata associated with the operation to update
   * the message to this version.
   */
  metadata?: Record<string, string>;
}

/**
 * Contains information about annotations associated with a particular message.
 */
export interface MessageAnnotations {
  /**
   * A summary of all the annotations that have been made to the message. Will always be
   * populated for a message.summary, and may be populated for any other type (in
   * particular a message retrieved from REST history will have its latest summary
   * included).
   * The keys of the map are the annotation types. The exact structure of the value of
   * each key depends on the aggregation part of the annotation type, e.g. for a type of
   * reaction:distinct.v1, the value will be a DistinctValues object. New aggregation
   * methods might be added serverside, hence the 'unknown' part of the sum type.
   */
  summary: Record<string, SummaryEntry>;
}

/**
 * Contains metadata about a message update or delete operation.
 */
export interface MessageOperation {
  /**
   * Optional identifier of the client performing the operation.
   */
  clientId?: string;
  /**
   * Optional human-readable description of the operation.
   */
  description?: string;
  /**
   * Optional dictionary of key-value pairs containing additional metadata about the operation.
   */
  metadata?: Record<string, string>;
}

/**
 * Contains the result of a publish operation.
 */
export interface PublishResult {
  /**
   * An array of message serials corresponding 1:1 to the messages that were published.
   * A serial may be null if the message was discarded due to a configured conflation rule.
   */
  serials: (string | null)[];
}

/**
 * Contains the result of an update or delete message operation.
 */
export interface UpdateDeleteResult {
  /**
   * The serial of the new version of the updated or deleted message.
   * Will be null if the message was superseded by a subsequent update before it could be published.
   */
  versionSerial: string | null;
}

/**
 * The namespace containing the different types of message actions.
 */
declare namespace MessageActions {
  /**
   * Message action for a newly created message.
   */
  type MESSAGE_CREATE = 'message.create';
  /**
   * Message action for an updated message. The `serial` field identifies the message of which this is
   * an update. The update will have a newer `version` compared with the original message.create message.
   */
  type MESSAGE_UPDATE = 'message.update';
  /**
   * Message action for a deleted message. The `serial` field identifies the message which is being deleted.
   * The delete will have a newer `version` compared with the original message.create message.
   */
  type MESSAGE_DELETE = 'message.delete';
  /**
   * Message action for a meta-message (a message originating from ably rather than being explicitly
   * published on a channel), containing eg inband channel occupancy events or some other information
   * requested by channel param.
   */
  type META = 'meta';
  /**
   * Message action for a message containing the latest rolled-up summary of annotations
   * that have been made to this message. Like an update, but only updates the summary, so
   * the message.serial is the serial of the message for which this is a summary.
   */
  type MESSAGE_SUMMARY = 'message.summary';
  /**
   * Message action for an appended message. The `serial` field identifies the message to which
   * data is being appended. The `data` field is appended to the previous message's data, while
   * all other fields replace the previous values.
   */
  type MESSAGE_APPEND = 'message.append';
}

/**
 * Describes the possible action types used on an {@link Message}.
 */
export type MessageAction =
  | MessageActions.MESSAGE_CREATE
  | MessageActions.MESSAGE_UPDATE
  | MessageActions.MESSAGE_DELETE
  | MessageActions.META
  | MessageActions.MESSAGE_SUMMARY
  | MessageActions.MESSAGE_APPEND;

/**
 * The namespace containing the different types of annotation actions.
 */
declare namespace AnnotationActions {
  /**
   * Annotation action for a created annotation.
   */
  type ANNOTATION_CREATE = 'annotation.create';
  /**
   * Annotation action for a deleted annotation.
   */
  type ANNOTATION_DELETE = 'annotation.delete';
}

/**
 * The possible values of the 'action' field of an {@link Annotation}.
 */
export type AnnotationAction = AnnotationActions.ANNOTATION_CREATE | AnnotationActions.ANNOTATION_DELETE;

/**
 * A message received from Ably.
 */
export type InboundMessage = Omit<Message, 'connectionKey'> &
  Required<Pick<Message, 'id' | 'timestamp' | 'action' | 'version' | 'annotations'>>;

/**
 * Static utilities related to messages.
 */
export interface MessageStatic {
  /**
   * A static factory method to create an `InboundMessage` object from a deserialized InboundMessage-like object encoded using Ably's wire protocol.
   *
   * @param JsonObject - A `InboundMessage`-like deserialized object.
   * @param channelOptions - A {@link ChannelOptions} object. If you have an encrypted channel, use this to allow the library to decrypt the data.
   * @returns A promise which will be fulfilled with an `InboundMessage` object.
   */
  fromEncoded: (JsonObject: any, channelOptions?: ChannelOptions) => Promise<InboundMessage>;
  /**
   * A static factory method to create an array of `InboundMessage` objects from an array of deserialized InboundMessage-like object encoded using Ably's wire protocol.
   *
   * @param JsonArray - An array of `InboundMessage`-like deserialized objects.
   * @param channelOptions - A {@link ChannelOptions} object. If you have an encrypted channel, use this to allow the library to decrypt the data.
   * @returns A promise which will be fulfilled with an array of {@link InboundMessage} objects.
   */
  fromEncodedArray: (JsonArray: any[], channelOptions?: ChannelOptions) => Promise<InboundMessage[]>;
}

/**
 * Contains an individual presence update sent to, or received from, Ably.
 */
export declare interface PresenceMessage {
  /**
   * The type of {@link PresenceAction} the `PresenceMessage` is for.
   */
  action: PresenceAction;
  /**
   * The ID of the client that published the `PresenceMessage`.
   */
  clientId: string;
  /**
   * The ID of the connection associated with the client that published the `PresenceMessage`.
   */
  connectionId: string;
  /**
   * The payload of the `PresenceMessage`.
   */
  data: any;
  /**
   * This will typically be empty as all presence messages received from Ably are automatically decoded client-side using this value. However, if the message encoding cannot be processed, this attribute will contain the remaining transformations not applied to the data payload.
   */
  encoding: string;
  /**
   * A JSON object of arbitrary key-value pairs that may contain metadata, and/or ancillary payloads. Valid payloads include `headers`.
   */
  extras: any;
  /**
   * A unique ID assigned to each `PresenceMessage` by Ably.
   */
  id: string;
  /**
   * The time the `PresenceMessage` was received by Ably, as milliseconds since the Unix epoch.
   */
  timestamp: number;
}

/**
 * Static utilities related to presence messages.
 */
export interface PresenceMessageStatic {
  /**
   * Decodes and decrypts a deserialized `PresenceMessage`-like object using the cipher in {@link ChannelOptions}. Any residual transforms that cannot be decoded or decrypted will be in the `encoding` property. Intended for users receiving messages from a source other than a REST or Realtime channel (for example a queue) to avoid having to parse the encoding string.
   *
   * @param JsonObject - The deserialized `PresenceMessage`-like object to decode and decrypt.
   * @param channelOptions - A {@link ChannelOptions} object containing the cipher.
   */
  fromEncoded: (JsonObject: any, channelOptions?: ChannelOptions) => Promise<PresenceMessage>;
  /**
   * Decodes and decrypts an array of deserialized `PresenceMessage`-like object using the cipher in {@link ChannelOptions}. Any residual transforms that cannot be decoded or decrypted will be in the `encoding` property. Intended for users receiving messages from a source other than a REST or Realtime channel (for example a queue) to avoid having to parse the encoding string.
   *
   * @param JsonArray - An array of deserialized `PresenceMessage`-like objects to decode and decrypt.
   * @param channelOptions - A {@link ChannelOptions} object containing the cipher.
   */
  fromEncodedArray: (JsonArray: any[], channelOptions?: ChannelOptions) => Promise<PresenceMessage[]>;

  /**
   * Initialises a `PresenceMessage` from a `PresenceMessage`-like object.
   *
   * @param values - The values to intialise the `PresenceMessage` from.
   */
  fromValues(values: Partial<Pick<PresenceMessage, 'clientId' | 'data' | 'extras'>>): PresenceMessage;
}

/**
 * Static utilities related to annotations.
 */
export interface AnnotationStatic {
  /**
   * Decodes a deserialized `Annotation`-like object. Any residual transforms that cannot be decoded or decrypted will be in the `encoding` property. Intended for users receiving messages from a source other than a REST or Realtime channel (for example a queue) to avoid having to parse the encoding string.
   *
   * @param JsonObject - The deserialized `Annotation`-like object to decode and decrypt.
   * @param channelOptions - A {@link ChannelOptions} object containing the current channel options.
   */
  fromEncoded: (JsonObject: any, channelOptions?: ChannelOptions) => Promise<Annotation>;
  /**
   * Decodes an array of deserialized `Annotation`-like objects. Any residual transforms that cannot be decoded or decrypted will be in the `encoding` property. Intended for users receiving messages from a source other than a REST or Realtime channel (for example a queue) to avoid having to parse the encoding string.
   *
   * @param JsonArray - An array of deserialized `Annotation`-like objects to decode and decrypt.
   * @param channelOptions - A {@link ChannelOptions} object containing the current channel options.
   */
  fromEncodedArray: (JsonArray: any[], channelOptions?: ChannelOptions) => Promise<Annotation[]>;
}

/**
 * Cipher Key used in {@link CipherParamOptions}. If set to a `string`, the value must be base64 encoded.
 */
export type CipherKeyParam = ArrayBuffer | Uint8Array | string; // if string must be base64-encoded
/**
 * The type of the key returned by {@link Crypto.generateRandomKey}. Typed differently depending on platform (`Buffer` in Node.js, `ArrayBuffer` elsewhere).
 */
export type CipherKey = ArrayBuffer | Buffer;

/**
 * Contains the properties used to generate a {@link CipherParams} object.
 */
export type CipherParamOptions = {
  /**
   * The private key used to encrypt and decrypt payloads.
   */
  key: CipherKeyParam;
  /**
   * The algorithm to use for encryption. Only `AES` is supported.
   */
  algorithm?: 'aes';
  /**
   * The length of the key in bits; for example 128 or 256.
   */
  keyLength?: number;
  /**
   * The cipher mode. Only `CBC` is supported.
   */
  mode?: 'cbc';
};

/**
 * Contains the properties required to configure the encryption of {@link Message} payloads.
 */
export interface Crypto {
  /**
   * Generates a random key to be used in the encryption of the channel. If the language cryptographic randomness primitives are blocking or async, a callback is used. The callback returns a generated binary key.
   *
   * @param keyLength - The length of the key, in bits, to be generated. If not specified, this is equal to the default `keyLength` of the default algorithm: for AES this is 256 bits.
   * @returns A promise which, upon success, will be fulfilled with the generated key as a binary, for example, a byte array. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  generateRandomKey(keyLength?: number): Promise<CipherKey>;
  /**
   * Returns a {@link CipherParams} object, using the default values for any fields not supplied by the {@link CipherParamOptions} object.
   *
   * @param params - A {@link CipherParamOptions} object.
   * @returns A {@link CipherParams} object, using the default values for any fields not supplied.
   */
  getDefaultParams(params: CipherParamOptions): CipherParams;
}

/**
 * Enables the management of a connection to Ably.
 */
export declare interface Connection
  extends EventEmitter<connectionEventCallback, ConnectionStateChange, ConnectionEvent> {
  /**
   * An {@link ErrorInfo} object describing the last error received if a connection failure occurs.
   */
  errorReason: ErrorInfo;
  /**
   * A unique public identifier for this connection, used to identify this member.
   */
  id?: string;
  /**
   * A unique private connection key used to recover or resume a connection, assigned by Ably. This private connection key can also be used by other REST clients to publish on behalf of this client. See the [publishing over REST on behalf of a realtime client docs](https://ably.com/docs/rest/channels#publish-on-behalf) for more info. (If you want to explicitly recover a connection in a different SDK instance, see createRecoveryKey() instead)
   */
  key?: string;
  /**
   * createRecoveryKey method returns a string that can be used by another client to recover this connection's state in the recover client options property. See [connection state recover options](https://ably.com/docs/connect/states?lang=javascript#connection-state-recovery) for more information.
   */
  createRecoveryKey(): string | null;
  /**
   * The current {@link ConnectionState} of the connection.
   */
  readonly state: ConnectionState;
  /**
   * Causes the connection to close, entering the {@link ConnectionStates.CLOSING} state. Once closed, the library does not attempt to re-establish the connection without an explicit call to {@link Connection.connect | `connect()`}.
   */
  close(): void;
  /**
   * Explicitly calling `connect()` is unnecessary unless the `autoConnect` attribute of the {@link ClientOptions} object is `false`. Unless already connected or connecting, this method causes the connection to open, entering the {@link ConnectionStates.CONNECTING} state.
   */
  connect(): void;

  /**
   * When connected, sends a heartbeat ping to the Ably server and executes the callback with any error and the response time in milliseconds when a heartbeat ping request is echoed from the server. This can be useful for measuring true round-trip latency to the connected Ably server.
   *
   * @returns A promise which, upon success, will be fulfilled with the response time in milliseconds. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  ping(): Promise<number>;
  /**
   * @deprecated v1 callback signature — no longer supported. Use {@link Connection.ping | `realtime.connection.ping()`} and `await` the returned promise. See [the v2 migration guide](https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md).
   * @example
   * ```ts
   * // v1 (no longer supported — IDE shows this with strikethrough):
   * realtime.connection.ping((err, responseTime) => {});
   *
   * // v2:
   * const responseTime = await realtime.connection.ping();
   * ```
   * @param callback - v1 Node-style callback (no longer supported).
   */
  ping(callback: StandardCallback<number>): void;
  /**
   * If the connection is already in the given state, returns a promise which immediately resolves to `null`. Else, calls {@link EventEmitter.once | `once()`} to return a promise which resolves the next time the connection transitions to the given state.
   *
   * @param targetState - The connection state to wait for.
   */
  whenState(targetState: ConnectionState): Promise<ConnectionStateChange | null>;
}

/**
 * Contains application statistics for a specified time interval and time period.
 */
export declare interface Stats {
  /**
   * The UTC time at which the time period covered begins. If `unit` is set to `minute` this will be in the format `YYYY-mm-dd:HH:MM`, if `hour` it will be `YYYY-mm-dd:HH`, if `day` it will be `YYYY-mm-dd:00` and if `month` it will be `YYYY-mm-01:00`.
   */
  intervalId: string;
  /**
   * For entries that are still in progress, such as the current month: the last sub-interval included in this entry (in format yyyy-mm-dd:hh:mm:ss), else undefined.
   */
  inProgress?: string;
  /**
   * The statistics for this time interval and time period. See the JSON schema which the {@link Stats.schema | `schema`} property points to for more information.
   */
  entries: Partial<Record<string, number>>;
  /**
   * The URL of a [JSON Schema](https://json-schema.org/) which describes the structure of this `Stats` object.
   */
  schema: string;
  /**
   * The ID of the Ably application the statistics are for.
   */
  appId: string;
}

/**
 * Contains a page of results for message or presence history, stats, or REST presence requests. A `PaginatedResult` response from a REST API paginated query is also accompanied by metadata that indicates the relative queries available to the `PaginatedResult` object.
 */
export declare interface PaginatedResult<T> {
  /**
   * Contains the current page of results; for example, an array of {@link InboundMessage} or {@link PresenceMessage} objects for a channel history request.
   */
  items: T[];
  /**
   * Returns a new `PaginatedResult` for the first page of results.
   *
   * @returns A promise which, upon success, will be fulfilled with a page of results for message and presence history, stats, and REST presence requests. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  first(): Promise<PaginatedResult<T>>;
  /**
   * Returns a new `PaginatedResult` loaded with the next page of results. If there are no further pages, then `null` is returned.
   *
   * @returns A promise which, upon success, will be fulfilled with a page of results for message and presence history, stats, and REST presence requests. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  next(): Promise<PaginatedResult<T> | null>;
  /**
   * Returns the `PaginatedResult` for the current page of results.
   */
  current(): Promise<PaginatedResult<T>>;
  /**
   * Returns `true` if there are more pages available by calling next and returns `false` if this page is the last page available.
   *
   * @returns Whether or not there are more pages of results.
   */
  hasNext(): boolean;
  /**
   * Returns `true` if this page is the last page and returns `false` if there are more pages available by calling next available.
   *
   * @returns Whether or not this is the last page of results.
   */
  isLast(): boolean;
}

/**
 * A superset of {@link PaginatedResult} which represents a page of results plus metadata indicating the relative queries available to it. `HttpPaginatedResponse` additionally carries information about the response to an HTTP request.
 */
export declare interface HttpPaginatedResponse<T = any> extends PaginatedResult<T> {
  /**
   * The HTTP status code of the response.
   */
  statusCode: number;
  /**
   * Whether `statusCode` indicates success. This is equivalent to `200 <= statusCode < 300`.
   */
  success: boolean;
  /**
   * The error code if the `X-Ably-Errorcode` HTTP header is sent in the response.
   */
  errorCode: number;
  /**
   * The error message if the `X-Ably-Errormessage` HTTP header is sent in the response.
   */
  errorMessage: string;
  /**
   * Optional map of string key-value pairs containing structured error metadata, extracted from the response body when present.
   */
  errorDetail?: Record<string, string>;
  /**
   * The headers of the response.
   */
  headers: any;
}

/**
 * A push token obtained from the underlying push platform, along with the transport it belongs to. Has the same shape as the `ReactNativePushToken` accepted by the `ably/react-native-push` plugin's `requestToken` callback.
 */
export declare interface PushDeviceToken {
  /**
   * The push transport the token belongs to: `fcm` for a Firebase Cloud Messaging registration token, or `apns` for a raw APNs device token.
   */
  transportType: 'fcm' | 'apns';
  /**
   * The token itself: an FCM registration token or an APNs device token.
   */
  token: string;
}

/**
 * Enables a device to be registered and deregistered from receiving push notifications.
 */
export declare interface Push {
  /**
   * A {@link PushAdmin} object.
   */
  admin: PushAdmin;

  /**
   * Activates the device for push notifications. Subsequently registers the device with Ably and stores the deviceIdentityToken in local storage.
   *
   * @param registerCallback - A function passed to override the default implementation to register the local device for push activation.
   * @param updateFailedCallback - A callback to be invoked when the device registration failed to update.
   */
  activate(registerCallback?: RegisterCallback, updateFailedCallback?: ErrorCallback): Promise<void>;

  /**
   * Deactivates the device from receiving push notifications.
   *
   * @param deregisterCallback - A function passed to override the default implementation to deregister the local device for push activation.
   */
  deactivate(deregisterCallback?: DeregisterCallback): Promise<void>;

  /**
   * Updates the device's push token after the underlying push platform has rotated it, and synchronizes the new token with Ably by updating the device registration. Call this from your platform's token refresh listener, for example `messaging().onTokenRefresh()` of `@react-native-firebase/messaging`, once {@link activate | `activate()`} has completed.
   *
   * The synchronization with Ably is fire-and-forget: it is serialized with any in-flight `activate()`, `deactivate()` or earlier `updateToken()` synchronization rather than racing it, it is routed through the `registerCallback` passed to `activate()` when one was provided, and a synchronization failure is reported to the `updateFailedCallback` passed to `activate()`.
   *
   * @param token - The refreshed push token, in the same shape as returned by the `requestToken` callback of the `ably/react-native-push` plugin.
   * @returns A promise which resolves once the refreshed token has been persisted locally and its synchronization with Ably has been initiated, and rejects if the token is malformed or the device is not activated for push notifications.
   */
  updateToken(token: PushDeviceToken): Promise<void>;
}

/**
 * Contains the device identity token and secret of a device.
 */
export declare interface LocalDevice {
  /**
   * A unique ID generated by the device.
   */
  id: string;
  /**
   * A unique device secret generated by the Ably SDK.
   */
  deviceSecret: string;
  /**
   * A unique device identity token that the device uses to authenticate itself with Ably.
   */
  deviceIdentityToken?: string;

  /**
   * Retrieves push subscriptions active for the local device.
   *
   * @returns a {@link PaginatedResult} object containing an array of {@link PushChannelSubscription} objects for each push channel subscription active for the local device.
   */
  listSubscriptions(): Promise<PaginatedResult<PushChannelSubscription>>;
}

/**
 * Enables the management of device registrations and push notification subscriptions. Also enables the publishing of push notifications to devices.
 */
export declare interface PushAdmin {
  /**
   * A {@link PushDeviceRegistrations} object.
   */
  deviceRegistrations: PushDeviceRegistrations;
  /**
   * A {@link PushChannelSubscriptions} object.
   */
  channelSubscriptions: PushChannelSubscriptions;
  /**
   * Sends a push notification directly to a device, or a group of devices sharing the same `clientId`.
   *
   * @param recipient - A JSON object containing the recipient details using `clientId`, `deviceId` or the underlying notifications service.
   * @param payload - A JSON object containing the push notification payload.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  publish(recipient: any, payload: any): Promise<void>;
  /**
   * Creates an APNs broadcast channel for use with an iOS Live Activity. Call once before starting the Live Activity and persist the returned ids for the session.
   *
   * @experimental This is a preview feature and may change in a future non-major release.
   *
   * @param options - Options for the broadcast, including the `messageStoragePolicy`.
   * @returns A promise resolving to the broadcast `{ id, apnsChannelId }`.
   */
  createApnsBroadcast(options: PushApnsBroadcastOptions): Promise<PushApnsBroadcast>;
  /**
   * Controls the lifecycle of iOS Live Activities over an APNs broadcast channel created with {@link PushAdmin.createApnsBroadcast}.
   *
   * @experimental This is a preview feature and may change in a future non-major release.
   */
  liveActivity: PushLiveActivity;
}

/**
 * Controls the lifecycle of an iOS Live Activity over an APNs broadcast channel.
 *
 * @experimental This is a preview feature and may change in a future non-major release.
 */
export declare interface PushLiveActivity {
  /**
   * Sends a push-to-start notification to all devices subscribed to the given Ably channels. Each targeted device starts a new Live Activity using its registered push-to-start token.
   *
   * @experimental This is a preview feature and may change in a future non-major release.
   *
   * @param params - The recipient channels, the broadcast `id`, and a valid APNs Live Activity start payload.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  start(params: PushLiveActivityStartParams): Promise<void>;
  /**
   * Sends a `content-state` update to all devices with an active Live Activity on the broadcast channel. A single push is sent to the channel; APNs handles fan-out to all subscribed devices.
   *
   * @experimental This is a preview feature and may change in a future non-major release.
   *
   * @param params - The broadcast `id` and a valid APNs Live Activity update payload.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  update(params: PushLiveActivityUpdateParams): Promise<void>;
  /**
   * Ends the Live Activity on all subscribed devices and cleans up the APNs channel. After this call, the broadcast `id` is no longer valid.
   *
   * @experimental This is a preview feature and may change in a future non-major release.
   *
   * @param params - The broadcast `id` and a valid APNs Live Activity end payload.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  end(params: PushLiveActivityEndParams): Promise<void>;
}

/**
 * Parameters for {@link PushLiveActivity.start}.
 */
export declare interface PushLiveActivityStartParams {
  /**
   * The targeted recipients of the push-to-start notification.
   */
  recipient:
    | {
        /**
         * One or more Ably channel names. Devices subscribed to any of these channels will receive the push-to-start notification. Provide either `channels` or `deviceId`.
         */
        channels: string[];
      }
    | {
        /**
         * Restrict the push-to-start notification to a single device. Provide either `channels` or `deviceId`.
         */
        deviceId: string;
      };
  /**
   * The `id` returned from {@link PushAdmin.createApnsBroadcast}.
   */
  apnsBroadcast: string;
  /**
   * A valid APNs Live Activity start payload. The payload is passed through to APNs as-is.
   */
  apns: any;
  /**
   * Optional APNs delivery headers, such as `apns-priority` and `apns-expiration`. When supplied, these are included in the request body under a `headers` key.
   */
  headers?: Record<string, string>;
}

/**
 * Parameters for {@link PushLiveActivity.update}.
 */
export declare interface PushLiveActivityUpdateParams {
  /**
   * The `id` returned from {@link PushAdmin.createApnsBroadcast}.
   */
  apnsBroadcast: string;
  /**
   * A valid APNs Live Activity update payload. The payload is passed through to APNs as-is.
   */
  apns: any;
  /**
   * Optional APNs delivery headers, such as `apns-priority` and `apns-expiration`. When supplied, these are included in the request body under a `headers` key.
   */
  headers?: Record<string, string>;
}

/**
 * Parameters for {@link PushLiveActivity.end}.
 */
export declare interface PushLiveActivityEndParams {
  /**
   * The `id` returned from {@link PushAdmin.createApnsBroadcast}.
   */
  apnsBroadcast: string;
  /**
   * A valid APNs Live Activity end payload. The payload is passed through to APNs as-is.
   */
  apns: any;
  /**
   * Optional APNs delivery headers, such as `apns-priority` and `apns-expiration`. When supplied, these are included in the request body under a `headers` key.
   */
  headers?: Record<string, string>;
}

/**
 * Options for creating an APNs broadcast channel via {@link PushAdmin.createApnsBroadcast}.
 */
export declare interface PushApnsBroadcastOptions {
  /**
   * Set to `1` to cache the last update payload so late-joining devices receive the current content state immediately on subscription. Set to `0` to disable caching.
   *
   * @see https://developer.apple.com/documentation/usernotifications/sending-channel-management-requests-to-apns
   */
  messageStoragePolicy: 0 | 1;
}

/**
 * The result of creating an APNs broadcast channel via {@link PushAdmin.createApnsBroadcast}.
 */
export declare interface PushApnsBroadcast {
  /**
   * The opaque Ably broadcast id.
   */
  id: string;
  /**
   * The Apple-assigned channel id.
   */
  apnsChannelId: string;
}

/**
 * Enables the management of push notification registrations with Ably.
 */
export declare interface PushDeviceRegistrations {
  /**
   * Registers or updates a {@link DeviceDetails} object with Ably. Returns the new, or updated {@link DeviceDetails} object.
   *
   * @param deviceDetails - The {@link DeviceDetails} object to create or update.
   * @returns A promise which, upon success, will be fulfilled with a {@link DeviceDetails} object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  save(deviceDetails: DeviceDetails): Promise<DeviceDetails>;
  /**
   * Retrieves the {@link DeviceDetails} of a device registered to receive push notifications using its `deviceId`.
   *
   * @param deviceId - The unique ID of the device.
   * @returns A promise which, upon success, will be fulfilled with a {@link DeviceDetails} object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  get(deviceId: string): Promise<DeviceDetails>;
  /**
   * Retrieves the {@link DeviceDetails} of a device registered to receive push notifications using the `id` property of a {@link DeviceDetails} object.
   *
   * @param deviceDetails - The {@link DeviceDetails} object containing the `id` property of the device.
   * @returns A promise which, upon success, will be fulfilled with a {@link DeviceDetails} object. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  get(deviceDetails: DeviceDetails): Promise<DeviceDetails>;
  /**
   * Retrieves all devices matching the filter `params` provided. Returns a {@link PaginatedResult} object, containing an array of {@link DeviceDetails} objects.
   *
   * @param params - An object containing key-value pairs to filter devices by.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link DeviceDetails} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  list(params: DeviceRegistrationParams): Promise<PaginatedResult<DeviceDetails>>;
  /**
   * Removes a device registered to receive push notifications from Ably using its `deviceId`.
   *
   * @param deviceId - The unique ID of the device.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  remove(deviceId: string): Promise<void>;
  /**
   * Removes a device registered to receive push notifications from Ably using the `id` property of a {@link DeviceDetails} object.
   *
   * @param deviceDetails - The {@link DeviceDetails} object containing the `id` property of the device.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  remove(deviceDetails: DeviceDetails): Promise<void>;
  /**
   * Removes all devices registered to receive push notifications from Ably matching the filter `params` provided.
   *
   * @param params - An object containing key-value pairs to filter devices by. This object’s {@link DeviceRegistrationParams.limit} property will be ignored.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  removeWhere(params: DeviceRegistrationParams): Promise<void>;
}

/**
 * Enables device push channel subscriptions.
 */
export declare interface PushChannelSubscriptions {
  /**
   * Subscribes a device, or a group of devices sharing the same `clientId` to push notifications on a channel. Returns a {@link PushChannelSubscription} object.
   *
   * @param subscription - A {@link PushChannelSubscription} object.
   * @returns A promise which, upon success, will be fulfilled with a {@link PushChannelSubscription} object describing the new or updated subscriptions. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  save(subscription: PushChannelSubscription): Promise<PushChannelSubscription>;
  /**
   * Retrieves all push channel subscriptions matching the filter `params` provided. Returns a {@link PaginatedResult} object, containing an array of {@link PushChannelSubscription} objects.
   *
   * @param params - An object containing key-value pairs to filter subscriptions by.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of {@link PushChannelSubscription} objects. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  list(params: PushChannelSubscriptionParams): Promise<PaginatedResult<PushChannelSubscription>>;
  /**
   * Retrieves all channels with at least one device subscribed to push notifications. Returns a {@link PaginatedResult} object, containing an array of channel names.
   *
   * @param params - An object containing key-value pairs to filter channels by.
   * @returns A promise which, upon success, will be fulfilled with a {@link PaginatedResult} object containing an array of channel names. Upon failure, the promise will be rejected with an {@link ErrorInfo} object which explains the error.
   */
  listChannels(params: PushChannelsParams): Promise<PaginatedResult<string>>;
  /**
   * Unsubscribes a device, or a group of devices sharing the same `clientId` from receiving push notifications on a channel.
   *
   * @param subscription - A {@link PushChannelSubscription} object.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  remove(subscription: PushChannelSubscription): Promise<void>;
  /**
   * Unsubscribes all devices from receiving push notifications on a channel that match the filter `params` provided.
   *
   * @param params - An object containing key-value pairs to filter subscriptions by. Can contain `channel`, and optionally either `clientId` or `deviceId`.
   * @returns A promise which resolves upon success of the operation and rejects with an {@link ErrorInfo} object upon its failure.
   */
  removeWhere(params: PushChannelSubscriptionParams): Promise<void>;
}

/**
 * A client that offers a simple stateless API to interact directly with Ably's REST API.
 */
export declare class Rest implements RestClient {
  /**
   * Construct a client object using an Ably {@link ClientOptions} object.
   *
   * @param options - A {@link ClientOptions} object to configure the client connection to Ably.
   */
  constructor(options: ClientOptions);
  /**
   * Constructs a client object using an Ably API key or token string.
   *
   * @param keyOrToken - The Ably API key or token string used to validate the client.
   */
  constructor(keyOrToken: string);
  /**
   * The cryptographic functions available in the library.
   */
  static Crypto: Crypto;
  /**
   * Static utilities related to messages.
   */
  static Message: MessageStatic;
  /**
   * Static utilities related to presence messages.
   */
  static PresenceMessage: PresenceMessageStatic;
  /**
   * Static utilities related to annotations.
   */
  static Annotation: AnnotationStatic;

  // Requirements of RestClient

  auth: Auth;
  channels: Channels<Channel>;
  request<T = any>(
    method: string,
    path: string,
    version: number,
    params?: any,
    body?: any[] | any,
    headers?: any,
  ): Promise<HttpPaginatedResponse<T>>;
  stats(params?: StatsParams): Promise<PaginatedResult<Stats>>;
  time(): Promise<number>;
  batchPublish(spec: BatchPublishSpec): Promise<BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>>;
  batchPublish(
    specs: BatchPublishSpec[],
  ): Promise<BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>[]>;
  batchPresence(channels: string[]): Promise<BatchResult<BatchPresenceSuccessResult | BatchPresenceFailureResult>[]>;
  push: Push;
  device(): LocalDevice;
  getDevice(): Promise<LocalDevice>;
}

/**
 * A client that extends the functionality of {@link Rest} and provides additional realtime-specific features.
 */
export declare class Realtime implements RealtimeClient {
  /**
   * Construct a client object using an Ably {@link ClientOptions} object.
   *
   * @param options - A {@link ClientOptions} object to configure the client connection to Ably.
   */
  constructor(options: ClientOptions);
  /**
   * Constructs a client object using an Ably API key or token string.
   *
   * @param keyOrToken - The Ably API key or token string used to validate the client.
   */
  constructor(keyOrToken: string);
  /**
   * The cryptographic functions available in the library.
   */
  static Crypto: Crypto;
  /**
   * Static utilities related to messages.
   */
  static Message: MessageStatic;
  /**
   * Static utilities related to presence messages.
   */
  static PresenceMessage: PresenceMessageStatic;
  /**
   * Static utilities related to annotations.
   */
  static Annotation: AnnotationStatic;

  // Requirements of RealtimeClient

  clientId: string;
  close(): void;
  connect(): void;
  auth: Auth;
  channels: Channels<RealtimeChannel>;
  connection: Connection;
  request<T = any>(
    method: string,
    path: string,
    version: number,
    params?: any,
    body?: any[] | any,
    headers?: any,
  ): Promise<HttpPaginatedResponse<T>>;
  stats(params?: StatsParams): Promise<PaginatedResult<Stats>>;
  time(): Promise<number>;
  batchPublish(spec: BatchPublishSpec): Promise<BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>>;
  batchPublish(
    specs: BatchPublishSpec[],
  ): Promise<BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>[]>;
  batchPresence(channels: string[]): Promise<BatchResult<BatchPresenceSuccessResult | BatchPresenceFailureResult>[]>;
  push: Push;
  device(): LocalDevice;
  getDevice(): Promise<LocalDevice>;
}

/**
 * A generic Ably error object that contains an Ably-specific status code, and a generic status code. Errors returned from the Ably server are compatible with the `ErrorInfo` structure and should result in errors that inherit from `ErrorInfo`.
 */
export declare class ErrorInfo extends Error {
  /**
   * Ably [error code](https://github.com/ably/ably-common/blob/main/protocol/errors.json).
   */
  code: number;
  /**
   * Additional message information, where available.
   */
  message: string;
  /**
   * HTTP Status Code corresponding to this error, where applicable.
   */
  statusCode: number;
  /**
   * The underlying cause of the error, where applicable.
   */
  cause?: ErrorInfo;
  /**
   * Optional map of string key-value pairs containing structured metadata associated with the error.
   */
  detail?: Record<string, string>;
  /**
   * Actionable guidance describing *how* to fix the error — distinct from
   * `message`, which summarises *what* went wrong. Written as prose suitable for an
   * agent or human to act on without further lookup (typically including the
   * canonical replacement call and a doc link where applicable). Present only on
   * SDK-originating errors that have meaningful remediation steps.
   */
  remediation?: string;

  /**
   * Construct an ErrorInfo object.
   *
   * @param message - A string describing the error.
   * @param code - Ably [error code](https://github.com/ably/ably-common/blob/main/protocol/errors.json).
   * @param statusCode - HTTP Status Code corresponding to this error.
   * @param cause - The underlying cause of the error.
   * @param detail - Optional map of string key-value pairs containing structured metadata associated with the error.
   */
  constructor(message: string, code: number, statusCode: number, cause?: ErrorInfo, detail?: Record<string, string>);
}
