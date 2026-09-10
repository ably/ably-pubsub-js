import { actions, channelModes, flags } from '../types/protocolmessagecommon';
import ProtocolMessage, { fromValues as protocolMessageFromValues } from '../types/protocolmessage';
import EventEmitter from '../util/eventemitter';
import * as Utils from '../util/utils';
import Logger from '../util/logger';
import { EncodingDecodingContext, populateFieldsFromParent } from '../types/basemessage';
import Message, { getMessagesSize, encodeArray as encodeMessagesArray } from '../types/message';
import ChannelStateChange from './channelstatechange';
import ErrorInfo, { PartialErrorInfo } from '../types/errorinfo';
import * as API from '../../../../ably';
import ConnectionManager from '../transport/connectionmanager';
import Platform from '../../platform';
import type { PendingMessage } from '../transport/protocol';
import { StandardCallback } from '../../types/utils';
import BaseRealtime from './baserealtime';
import { ChannelOptions } from '../../types/channel';
import { normaliseChannelOptions } from '../util/defaults';
import { PaginatedResult } from './paginatedresource';
import type { PushChannel } from 'plugins/push';
import type { WirePresenceMessage } from '../types/presencemessage';
import type { RealtimeObject, WireObjectMessage } from 'plugins/liveobjects';
import type RealtimePresence from './realtimepresence';
import type RealtimeAnnotations from './realtimeannotations';

interface RealtimeHistoryParams {
  start?: number;
  end?: number;
  direction?: string;
  limit?: number;
  untilAttach?: boolean;
  from_serial?: string;
}

function validateChannelOptions(options?: API.ChannelOptions) {
  if (options && 'params' in options && !Utils.isObject(options.params)) {
    const err = new ErrorInfo({
      message: 'options.params must be an object',
      code: 40000,
      statusCode: 400,
      remediation: 'Pass an object map of channel params (e.g. { rewind: "1" }), not a string or array.',
    });
    return err;
  }
  if (options && 'modes' in options) {
    if (!Array.isArray(options.modes)) {
      const err = new ErrorInfo({
        message: 'options.modes must be an array',
        code: 40000,
        statusCode: 400,
        remediation: 'Pass an array of ChannelMode strings, e.g. { modes: ["publish", "subscribe"] }.',
      });
      return err;
    }
    for (let i = 0; i < options.modes.length; i++) {
      const currentMode = options.modes[i];
      if (
        !currentMode ||
        typeof currentMode !== 'string' ||
        !channelModes.includes(String.prototype.toUpperCase.call(currentMode))
      ) {
        const err = new ErrorInfo({
          message: 'Invalid channel mode: ' + currentMode,
          code: 40000,
          statusCode: 400,
          remediation: `Valid ChannelMode values are: ${channelModes.join(', ').toLowerCase()}. The server grants only the modes the key or token capability permits and silently drops the rest on attach. After attach, channel.modes shows what was granted. If you have the Ably CLI installed, \`ably auth keys list\` shows your key's capabilities.`,
        });
        return err;
      }
    }
  }
}

class RealtimeChannel extends EventEmitter {
  name: string;
  channelOptions: ChannelOptions;
  client: BaseRealtime;
  private _presence: RealtimePresence | null;
  private _annotations: RealtimeAnnotations | null = null;
  get presence(): RealtimePresence {
    if (!this._presence) {
      Utils.throwMissingPluginError('RealtimePresence');
    }
    return this._presence;
  }
  get annotations(): RealtimeAnnotations {
    if (!this._annotations) {
      Utils.throwMissingPluginError('Annotations');
    }
    return this._annotations;
  }
  connectionManager: ConnectionManager;
  state: API.ChannelState;
  subscriptions: EventEmitter;
  filteredSubscriptions?: Map<API.messageCallback<Message>, Map<API.MessageFilter, API.messageCallback<Message>[]>>;
  syncChannelSerial?: string | null;
  properties: {
    attachSerial: string | null | undefined;
    channelSerial: string | null | undefined;
  };
  errorReason: ErrorInfo | null;
  _mode = 0;
  _silentSubscribeWarned = false;
  _decodingContext: EncodingDecodingContext;
  _lastPayload: {
    messageId?: string | null;
    protocolMessageChannelSerial?: string | null;
    decodeFailureRecoveryInProgress: null | boolean;
  };
  /**
   * Emits an 'attached' event (with no payload) whenever an ATTACHED protocol
   * message is received from the server. Used by setOptions (RTL16a) to know
   * when the server has confirmed new channel options.
   */
  _attachedReceived: EventEmitter;
  /**
   * Internal event emitter for channel state changes, not affected by public
   * off() calls. Exists to satisfy RTC10: the client library should never
   * register internal listeners with the public EventEmitter in such a way
   * that a user calling off() would result in the library not working as
   * expected.
   */
  internalStateChanges: EventEmitter;
  params?: Record<string, any>;
  modes: API.ChannelMode[] | undefined;
  stateTimer?: number | NodeJS.Timeout | null;
  retryTimer?: number | NodeJS.Timeout | null;
  retryCount: number = 0;
  _push?: PushChannel;
  _object?: RealtimeObject;

  constructor(client: BaseRealtime, name: string, options?: API.ChannelOptions) {
    super(client.logger);
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'RealtimeChannel()', 'started; name = ' + name);
    this.name = name;
    this.channelOptions = normaliseChannelOptions(client._Crypto ?? null, this.logger, options);
    this.client = client;
    this._presence = client._RealtimePresence ? new client._RealtimePresence.RealtimePresence(this) : null;
    if (client._Annotations) {
      this._annotations = new client._Annotations.RealtimeAnnotations(this);
    }
    this.connectionManager = client.connection.connectionManager;
    this.state = 'initialized';
    this.subscriptions = new EventEmitter(this.logger);
    this.syncChannelSerial = undefined;
    this.properties = {
      attachSerial: undefined,
      channelSerial: undefined,
    };
    this.setOptions(options);
    this.errorReason = null;
    this._decodingContext = {
      channelOptions: this.channelOptions,
      plugins: client.options.plugins || {},
      baseEncodedPreviousPayload: undefined,
    };
    this._lastPayload = {
      messageId: null,
      protocolMessageChannelSerial: null,
      decodeFailureRecoveryInProgress: null,
    };
    this._attachedReceived = new EventEmitter(this.logger);
    this.internalStateChanges = new EventEmitter(this.logger);

    if (client.options.plugins?.Push) {
      this._push = new client.options.plugins.Push.PushChannel(this);
    }

    if (client._liveObjectsPlugin) {
      this._object = new client._liveObjectsPlugin.RealtimeObject(this);
    }
  }

  get push() {
    if (!this._push) {
      Utils.throwMissingPluginError('Push');
    }
    return this._push;
  }

  /** @spec RTL27 */
  get object() {
    if (!this._object) {
      Utils.throwMissingPluginError('LiveObjects'); // RTL27b
    }
    return this._object; // RTL27a
  }

  // Override of EventEmitter method
  emit(event: string, ...args: unknown[]) {
    super.emit(event, ...args);
    this.internalStateChanges.emit(event, ...args);
  }

  invalidStateError(): ErrorInfo {
    const err = new ErrorInfo({
      message: 'Channel operation failed as channel state is ' + this.state,
      code: 90001,
      statusCode: 400,
      cause: this.errorReason || undefined,
      remediation:
        'Inspect channel.errorReason for the underlying cause. It may be null after a clean detach. From "failed" or "detached", call channel.attach() to recover. From "suspended" the SDK re-attaches automatically, or call channel.attach() to retry now.',
    });
    return err;
  }

  static processListenerArgs(args: unknown[]): any[] {
    /* [event], listener */
    args = Array.prototype.slice.call(args);
    if (typeof args[0] === 'function') {
      args.unshift(null);
    }
    return args;
  }

  async setOptions(options?: API.ChannelOptions): Promise<void> {
    const previousChannelOptions = this.channelOptions;
    const err = validateChannelOptions(options);
    if (err) {
      throw err;
    }
    this.channelOptions = normaliseChannelOptions(this.client._Crypto ?? null, this.logger, options);
    if (this._decodingContext) this._decodingContext.channelOptions = this.channelOptions;
    if (this._shouldReattachToSetOptions(options, previousChannelOptions)) {
      /* This does not just do _attach(true, null, callback) because that would put us
       * into the 'attaching' state until we receive the new attached, which is
       * conceptually incorrect: we are still attached, we just have a pending request to
       * change some channel params. Per RTL17 going into the attaching state would mean
       * rejecting messages until we have confirmation that the options have changed,
       * which would unnecessarily lose message continuity. */
      this.attachImpl();
      return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          this._attachedReceived.off(onAttached);
          this.internalStateChanges.off(onFailure);
        };
        const onAttached = () => {
          cleanup();
          resolve();
        };
        const onFailure = (stateChange: ChannelStateChange) => {
          cleanup();
          reject(stateChange.reason);
        };
        this._attachedReceived.once('attached', onAttached);
        this.internalStateChanges.once(['detached', 'failed'], onFailure);
      });
    }
  }

  _shouldReattachToSetOptions(options: API.ChannelOptions | undefined, prevOptions: API.ChannelOptions) {
    if (!(this.state === 'attached' || this.state === 'attaching')) {
      return false;
    }
    if (options?.params) {
      // Don't check against the `agent` param - it isn't returned in the ATTACHED message
      const requestedParams = omitAgent(options.params);
      const existingParams = omitAgent(prevOptions.params);

      if (Object.keys(requestedParams).length !== Object.keys(existingParams).length) {
        return true;
      }

      if (!Utils.shallowEquals(existingParams, requestedParams)) {
        return true;
      }
    }
    if (options?.modes) {
      if (!prevOptions.modes || !Utils.arrEquals(options.modes, prevOptions.modes)) {
        return true;
      }
    }
    return false;
  }

  publish(...args: unknown[]): Promise<API.PublishResult> {
    Utils.detectV1Callback(args, 0);
    return this._publishImpl(args);
  }

  private async _publishImpl(args: any[]): Promise<API.PublishResult> {
    const first = args[0],
      second = args[1];
    let messages: Message[];
    let params: Record<string, any> | undefined;

    if (typeof first === 'string' || first === null || first === undefined) {
      messages = [Message.fromValues({ name: first, data: second })];
      params = args[2];
    } else if (Utils.isObject(first)) {
      messages = [Message.fromValues(first)];
      params = args[1];
    } else if (Array.isArray(first)) {
      messages = Message.fromValuesArray(first);
      params = args[1];
    } else {
      throw new ErrorInfo({
        message: 'The single-argument form of publish() expects a message object or an array of message objects',
        code: 40013,
        statusCode: 400,
        remediation:
          'Call publish(name, data) for a single event, or publish(message | message[]) with a Message-shaped object.',
      });
    }
    const maxMessageSize = this.client.options.maxMessageSize;
    const wireMessages = await encodeMessagesArray(messages, this.channelOptions);
    /* RSL1i */
    const size = getMessagesSize(wireMessages);
    if (size > maxMessageSize) {
      throw new ErrorInfo({
        message: `Maximum size of messages that can be published at once exceeded (was ${size} bytes, against a limit of ${maxMessageSize} bytes)`,
        code: 40009,
        statusCode: 400,
        remediation:
          'Split the publish into multiple calls so each batch is under the limit. If a single message exceeds the limit, reduce its payload size. To lift the account limit, contact Ably support.',
      });
    }

    this.throwIfUnpublishableState();

    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'RealtimeChannel.publish()',
      'sending message; channel state is ' + this.state + ', message count = ' + wireMessages.length,
    );

    const pm = protocolMessageFromValues({
      action: actions.MESSAGE,
      channel: this.name,
      messages: wireMessages,
      params: params ? Utils.stringifyValues(params) : undefined,
    });
    return this.sendAndAwaitAck(pm);
  }

  throwIfUnpublishableState(): void {
    if (!this.connectionManager.activeState()) {
      throw this.connectionManager.getError();
    }
    if (this.state === 'failed' || this.state === 'suspended') {
      throw this.invalidStateError();
    }
  }

  onEvent(messages: Array<any>): void {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.onEvent()', 'received message');
    const subscriptions = this.subscriptions;
    for (let i = 0; i < messages.length; i++) {
      const message = messages[i];
      subscriptions.emit(message.name, message);
    }
  }

  async attach(): Promise<ChannelStateChange | null> {
    if (this.state === 'attached') {
      return null;
    }

    return new Promise((resolve, reject) => {
      this._attach(false, null, (err, result) => (err ? reject(err) : resolve(result!)));
    });
  }

  _attach(
    forceReattach: boolean,
    attachReason: ErrorInfo | null,
    callback?: StandardCallback<ChannelStateChange>,
  ): void {
    if (!callback) {
      callback = (err?: ErrorInfo | null) => {
        if (err) {
          Logger.logAction(
            this.logger,
            Logger.LOG_ERROR,
            'RealtimeChannel._attach()',
            'Channel attach failed: ' + err.toString(),
          );
        }
      };
    }

    const connectionManager = this.connectionManager;
    if (!connectionManager.activeState()) {
      callback(connectionManager.getError());
      return;
    }

    if (this.state !== 'attaching' || forceReattach) {
      this.requestState('attaching', attachReason);
    }

    this.internalStateChanges.once(function (this: { event: string }, stateChange: ChannelStateChange) {
      switch (this.event) {
        case 'attached':
          callback?.(null, stateChange);
          break;
        case 'detached':
        case 'suspended':
        case 'failed':
          callback?.(
            stateChange.reason ||
              connectionManager.getError() ||
              new ErrorInfo('Unable to attach; reason unknown; state = ' + this.event, 90000, 500),
          );
          break;
        case 'detaching':
          callback?.(new ErrorInfo('Attach request superseded by a subsequent detach request', 90000, 409));
          break;
      }
    });
  }

  attachImpl(): void {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.attachImpl()', 'sending ATTACH message');
    const attachMsg = protocolMessageFromValues({
      action: actions.ATTACH,
      channel: this.name,
      params: this.channelOptions.params,
      // RTL4c1: Includes the channel serial to resume from a previous message
      // or attachment.
      channelSerial: this.properties.channelSerial,
    });
    if (this.channelOptions.modes) {
      attachMsg.encodeModesToFlags(Utils.allToUpperCase(this.channelOptions.modes) as API.ChannelMode[]);
    }
    if (this._lastPayload.decodeFailureRecoveryInProgress) {
      attachMsg.channelSerial = this._lastPayload.protocolMessageChannelSerial;
    }
    this.send(attachMsg);
  }

  async detach(): Promise<void> {
    const connectionManager = this.connectionManager;
    switch (this.state) {
      // RTL5j
      case 'suspended':
        this.notifyState('detached');
        return;
      case 'detached':
        return;
      // RTL5b
      case 'failed': {
        throw new ErrorInfo({
          message: 'Unable to detach as channel state is failed',
          code: 90001,
          statusCode: 400,
          remediation:
            'A failed channel is not attached, so there is nothing to detach. Inspect channel.errorReason for the cause. Call channel.attach() to recover the channel, or channels.release(name) to discard it.',
        });
      }
      default:
        // RTL5l: if connection is not connected, immediately transition to detached
        if (connectionManager.state.state !== 'connected') {
          this.notifyState('detached');
          return;
        }
        this.requestState('detaching');
      // eslint-disable-next-line no-fallthrough
      case 'detaching':
        return new Promise((resolve, reject) => {
          this.internalStateChanges.once(function (this: { event: string }, stateChange: ChannelStateChange) {
            switch (this.event) {
              case 'detached':
                resolve();
                break;
              case 'attached':
              case 'suspended':
              case 'failed':
                reject(
                  stateChange.reason ||
                    connectionManager.getError() ||
                    new ErrorInfo('Unable to detach; reason unknown; state = ' + this.event, 90000, 500),
                );
                break;
              case 'attaching':
                reject(new ErrorInfo('Detach request superseded by a subsequent attach request', 90000, 409));
                break;
            }
          });
        });
    }
  }

  detachImpl(): void {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.detach()', 'sending DETACH message');
    const msg = protocolMessageFromValues({ action: actions.DETACH, channel: this.name });
    this.send(msg);
  }

  subscribe(...args: unknown[] /* [event], listener */): Promise<ChannelStateChange | null> {
    Utils.detectV1Callback(args, 2);
    return this._subscribeImpl(args);
  }

  private async _subscribeImpl(args: unknown[]): Promise<ChannelStateChange | null> {
    const [event, listener] = RealtimeChannel.processListenerArgs(args);

    if (this.state === 'failed') {
      throw ErrorInfo.fromValues(this.invalidStateError());
    }

    // Filtered
    if (event && typeof event === 'object' && !Array.isArray(event)) {
      this.client._FilteredSubscriptions.subscribeFilter(this, event, listener);
    } else {
      this.subscriptions.on(event, listener);
    }

    // (RTL7g)
    let stateChange: ChannelStateChange | null = null;
    if (this.channelOptions.attachOnSubscribe !== false) {
      stateChange = await this.attach();
    }

    // Whether or not we attached on subscribe, if the channel ended up attached without the
    // subscribe mode the server will never deliver messages to this listener.
    if (this.state === 'attached' && (this._mode & flags.SUBSCRIBE) === 0) {
      const err = new ErrorInfo({
        message:
          'The channel was attached without the subscribe mode, so the server will not deliver messages to this listener.',
        code: 90009,
        statusCode: 400,
        remediation:
          'Include "subscribe" in the channel modes: realtime.channels.get(name, { modes: ["subscribe", ...] }), or call channel.setOptions({ modes: [...] }) on an existing channel to trigger a reattach. Alternatively, omit modes entirely and ensure your token/API-key capability permits subscribe on this channel. If you have the Ably CLI installed, `ably auth keys list` shows your key\'s capabilities.',
      });
      if (this.client.options.strictMode === true) {
        // The listener stays registered despite the throw, matching subscribe()'s existing
        // semantics: the listener is always added regardless of attach outcome.
        throw err;
      }
      if (!this._silentSubscribeWarned) {
        Logger.logActionNoStrip(
          this.logger,
          Logger.LOG_ERROR,
          'RealtimeChannel.subscribe()',
          err.message + '; remediation=' + err.remediation + Logger.silentFailureLogSuffix(),
        );
        this._silentSubscribeWarned = true;
      }
    }
    return stateChange;
  }

  unsubscribe(...args: unknown[] /* [event], listener */): void {
    const [event, listener] = RealtimeChannel.processListenerArgs(args);

    // If we either have a filtered listener, a filter or both we need to do additional processing to find the original function(s)
    if ((typeof event === 'object' && !listener) || this.filteredSubscriptions?.has(listener)) {
      this.client._FilteredSubscriptions
        .getAndDeleteFilteredSubscriptions(this, event, listener)
        .forEach((l) => this.subscriptions.off(l));
      return;
    }

    this.subscriptions.off(event, listener);
  }

  sync(): void {
    /* check preconditions */
    switch (this.state) {
      case 'initialized':
      case 'detaching':
      case 'detached': {
        // sync() is an internal SDK method, so no fix-it remediation here — user/LLM code shouldn't reach this throw.
        throw new PartialErrorInfo({
          message: 'Unable to sync to channel; not attached',
          code: 40000,
        });
      }
      default:
    }
    const connectionManager = this.connectionManager;
    if (!connectionManager.activeState()) {
      throw connectionManager.getError();
    }

    /* send sync request */
    const syncMessage = protocolMessageFromValues({ action: actions.SYNC, channel: this.name });
    if (this.syncChannelSerial) {
      syncMessage.channelSerial = this.syncChannelSerial;
    }
    connectionManager.send(syncMessage);
  }

  send(msg: ProtocolMessage): void {
    this.connectionManager.send(msg);
  }

  async sendAndAwaitAck(msg: ProtocolMessage): Promise<API.PublishResult> {
    return new Promise((resolve, reject) => {
      this.connectionManager.send(msg, this.client.options.queueMessages, (err, publishResponse) => {
        if (err) {
          reject(err);
        } else {
          resolve(publishResponse!);
        }
      });
    });
  }

  async sendPresence(presence: WirePresenceMessage[]): Promise<void> {
    const msg = protocolMessageFromValues({
      action: actions.PRESENCE,
      channel: this.name,
      presence: presence,
    });
    await this.sendAndAwaitAck(msg);
  }

  /**
   * RTL3d: when the connection becomes CONNECTED, presence messages waiting on
   * the connection-wide queue are moved onto this channel's presence queue, so
   * they are only sent once the channel has (re-)attached (RTP5b) rather than
   * flushed immediately. Returns true if the channel will (re-)attach and the
   * messages were re-queued.
   */
  requeuePresenceFromConnectionQueue(pendingMessage: PendingMessage): boolean {
    if (this._presence && (this.state === 'attached' || this.state === 'attaching' || this.state === 'suspended')) {
      const callback = pendingMessage.callback;
      this._presence.requeuePresenceMessages(pendingMessage.message.presence ?? [], (err) => callback?.(err));
      return true;
    }
    return false;
  }

  async sendState(objectMessages: WireObjectMessage[]): Promise<API.PublishResult> {
    const msg = protocolMessageFromValues({
      action: actions.OBJECT,
      channel: this.name,
      state: objectMessages,
    });
    return this.sendAndAwaitAck(msg);
  }

  // Access to this method is synchronised by ConnectionManager#processChannelMessage, in order to synchronise access to the state stored in _decodingContext.
  async processMessage(message: ProtocolMessage): Promise<void> {
    if (
      message.action === actions.ATTACHED ||
      message.action === actions.MESSAGE ||
      message.action === actions.PRESENCE ||
      message.action === actions.OBJECT ||
      message.action === actions.ANNOTATION
    ) {
      // RTL15b
      this.setChannelSerial(message.channelSerial);
    }

    let syncChannelSerial,
      isSync = false;
    switch (message.action) {
      case actions.ATTACHED: {
        const resumed = message.hasFlag('RESUMED');
        // RTL15c: only update attachSerial for non-resumed attaches. A resumed
        // attach hasn't reset the period of message continuity, so it must not
        // move the point up to which untilAttach history is contiguous.
        if (!resumed) {
          this.properties.attachSerial = message.channelSerial;
        }
        this._mode = message.getMode();
        this._silentSubscribeWarned = false;
        this.params = (message as any).params || {};
        const modesFromFlags = message.decodeModesFromFlags();
        this.modes = (modesFromFlags && (Utils.allToLowerCase(modesFromFlags) as API.ChannelMode[])) || undefined;
        const hasPresence = message.hasFlag('HAS_PRESENCE');
        const hasBacklog = message.hasFlag('HAS_BACKLOG');
        const hasObjects = message.hasFlag('HAS_OBJECTS');
        this._attachedReceived.emit('attached');
        if (this.state === 'attached') {
          if (!resumed) {
            // we have lost continuity.
            // the presence set needs to be re-synced
            if (this._presence) {
              this._presence.onAttached(hasPresence);
            }
          }

          // Must always resync the Objects tree after an ATTACHED.
          // Whether there are objects on the channel and whether an OBJECT_SYNC sequence will follow
          // is determined by the HAS_OBJECTS flag.
          if (this._object) {
            this._object.onAttached(hasObjects);
          }

          const change = new ChannelStateChange(this.state, this.state, resumed, hasBacklog, message.error);
          if (!resumed || this.channelOptions.updateOnAttached) {
            this.emit('update', change);
          }
        } else if (this.state === 'detaching') {
          /* RTL5i: re-send DETACH and remain in the 'detaching' state */
          this.checkPendingState();
        } else {
          this.notifyState('attached', message.error, resumed, hasPresence, hasBacklog, hasObjects);
        }
        break;
      }

      case actions.DETACHED: {
        const detachErr = message.error
          ? ErrorInfo.fromWireValues(message.error)
          : new ErrorInfo('Channel detached', 90001, 404);
        if (this.state === 'detaching') {
          this.notifyState('detached', detachErr);
        } else if (this.state === 'attaching') {
          /* Only retry immediately if we were previously attached. If we were
           * attaching, go into suspended, fail messages, and wait a few seconds
           * before retrying */
          this.notifyState('suspended', detachErr);
        } else if (this.state === 'attached' || this.state === 'suspended') {
          // RTL13a
          this.requestState('attaching', detachErr);
        }
        // else no action (detached in initialized, detached, or failed state is a noop)
        break;
      }

      case actions.SYNC:
        /* syncs can have channelSerials, but might not if the sync is one page long */
        isSync = true;
        syncChannelSerial = this.syncChannelSerial = message.channelSerial;
        /* syncs can happen on channels with no presence data as part of connection
         * resuming, in which case protocol message has no presence property */
        if (!message.presence) break;
      // eslint-disable-next-line no-fallthrough
      case actions.PRESENCE: {
        if (!message.presence) {
          break;
        }

        populateFieldsFromParent(message);
        const options = this.channelOptions;
        if (this._presence) {
          const presenceMessages = await Promise.all(
            message.presence.map((wpm) => {
              return wpm.decode(options, this.logger);
            }),
          );

          this._presence.setPresence(presenceMessages, isSync, syncChannelSerial as any);
        }
        break;
      }

      // RTL1
      // OBJECT and OBJECT_SYNC message processing share most of the logic, so group them together
      case actions.OBJECT:
      case actions.OBJECT_SYNC: {
        if (!this._object || !message.state) {
          return;
        }

        populateFieldsFromParent(message);
        // need to use the active protocol format instead of just client's useBinaryProtocol option,
        // as comet transport does not support msgpack and will default to json without changing useBinaryProtocol.
        // message processing is done in the same event loop tick up until this point,
        // so we can reliably expect an active protocol to exist and be the one that received the object message.
        const format = this.client.connection.connectionManager.getActiveTransportFormat()!;
        const objectMessages = message.state.map((om) => om.decode(this.client, format));

        if (message.action === actions.OBJECT) {
          this._object.handleObjectMessages(objectMessages);
        } else {
          this._object.handleObjectSyncMessages(objectMessages, message.channelSerial);
        }

        break;
      }

      case actions.MESSAGE: {
        //RTL17
        if (this.state !== 'attached') {
          Logger.logAction(
            this.logger,
            Logger.LOG_MAJOR,
            'RealtimeChannel.processMessage()',
            'Message "' +
              message.id +
              '" skipped as this channel "' +
              this.name +
              '" state is not "attached" (state is "' +
              this.state +
              '").',
          );
          return;
        }

        populateFieldsFromParent(message);

        const encoded = message.messages!,
          firstMessage = encoded[0],
          lastMessage = encoded[encoded.length - 1];

        if (
          firstMessage.extras &&
          firstMessage.extras.delta &&
          firstMessage.extras.delta.from !== this._lastPayload.messageId
        ) {
          const msg =
            'Delta message decode failure - previous message not available for message "' +
            message.id +
            '" on this channel "' +
            this.name +
            '".';
          Logger.logAction(this.logger, Logger.LOG_ERROR, 'RealtimeChannel.processMessage()', msg);
          this._startDecodeFailureRecovery(new ErrorInfo(msg, 40018, 400));
          break;
        }

        let messages: Message[] = [];
        for (let i = 0; i < encoded.length; i++) {
          const { decoded, err } = await encoded[i].decodeWithErr(this._decodingContext, this.logger);
          messages[i] = decoded;

          if (err) {
            switch (err.code) {
              case 40018:
                /* decode failure */
                this._startDecodeFailureRecovery(err);
                return;

              case 40019: /* No vcdiff plugin passed in - no point recovering, give up */
              case 40021:
                /* Browser does not support deltas, similarly no point recovering */
                this.notifyState('failed', err);
                return;

              default:
              // do nothing, continue decoding
            }
          }
        }

        this._lastPayload.messageId = lastMessage.id;
        this._lastPayload.protocolMessageChannelSerial = message.channelSerial;
        this.onEvent(messages);
        break;
      }

      case actions.ANNOTATION: {
        populateFieldsFromParent(message);
        const options = this.channelOptions;
        if (this._annotations) {
          const annotations = await Promise.all(
            (message.annotations || []).map((wpm) => {
              return wpm.decode(options, this.logger);
            }),
          );

          this._annotations._processIncoming(annotations);
        }
        break;
      }

      case actions.ERROR: {
        /* there was a channel-specific error */
        const err = message.error as ErrorInfo;
        if (err && err.code == 80016) {
          /* attach/detach operation attempted on superseded transport handle */
          this.checkPendingState();
        } else {
          this.notifyState('failed', ErrorInfo.fromWireValues(err));
        }
        break;
      }

      default:
        // RSF1, should handle unrecognized message actions gracefully and don't abort the realtime connection to ensure forward compatibility
        Logger.logAction(
          this.logger,
          Logger.LOG_MAJOR,
          'RealtimeChannel.processMessage()',
          'Protocol error: unrecognised message action (' + message.action + ')',
        );
    }
  }

  _startDecodeFailureRecovery(reason: ErrorInfo): void {
    if (!this._lastPayload.decodeFailureRecoveryInProgress) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MAJOR,
        'RealtimeChannel.processMessage()',
        'Starting decode failure recovery process.',
      );
      this._lastPayload.decodeFailureRecoveryInProgress = true;
      this._attach(true, reason, () => {
        this._lastPayload.decodeFailureRecoveryInProgress = false;
      });
    }
  }

  onAttached(): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'RealtimeChannel.onAttached',
      'activating channel; name = ' + this.name,
    );
  }

  notifyState(
    state: API.ChannelState,
    reason?: ErrorInfo | null,
    resumed?: boolean,
    hasPresence?: boolean,
    hasBacklog?: boolean,
    hasObjects?: boolean,
  ): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'RealtimeChannel.notifyState',
      'name = ' + this.name + ', current state = ' + this.state + ', notifying state ' + state,
    );
    this.clearStateTimer();

    // RTL15b2: clear channelSerial only when entering DETACHED or FAILED.
    // Unlike previous spec versions it is retained through SUSPENDED, so that
    // the channelSerial is available on the subsequent ATTACH (RTL4c1) for the
    // server to decide whether continuity can be preserved.
    if (['detached', 'failed'].includes(state)) {
      this.properties.channelSerial = null;
    }

    if (state === this.state) {
      return;
    }
    if (this._presence) {
      this._presence.actOnChannelState(state, hasPresence, reason);
    }
    if (this._object) {
      // RTO23c1/RTO20e1 - pass `reason` explicitly: this runs before `this.errorReason` is assigned
      // below, so the plugin cannot read it off the channel to set the sync-wait failure cause.
      this._object.actOnChannelState(state, hasObjects, reason);
    }
    if (state === 'suspended' && this.connectionManager.state.sendEvents) {
      this.startRetryTimer();
    } else {
      this.cancelRetryTimer();
    }
    if (reason) {
      this.errorReason = reason;
    }
    const change = new ChannelStateChange(this.state, state, resumed, hasBacklog, reason);
    const action = 'Channel state for channel "' + this.name + '"';
    const message = state + (reason ? '; reason: ' + reason : '');
    if (state === 'failed') {
      Logger.logAction(this.logger, Logger.LOG_ERROR, action, message);
    } else {
      Logger.logAction(this.logger, Logger.LOG_MAJOR, action, message);
    }

    if (state !== 'attaching' && state !== 'suspended') {
      this.retryCount = 0;
    }

    /* Note: we don't set inProgress for pending states until the request is actually in progress */
    if (state === 'attached') {
      this.onAttached();
    }

    this.state = state;
    this.emit(state, change);
  }

  requestState(state: API.ChannelState, reason?: ErrorInfo | null): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'RealtimeChannel.requestState',
      'name = ' + this.name + ', state = ' + state,
    );
    this.notifyState(state, reason);
    /* send the event and await response */
    this.checkPendingState();
  }

  checkPendingState(): void {
    /* if can't send events, do nothing */
    const cmState = this.connectionManager.state;
    if (!cmState.sendEvents) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'RealtimeChannel.checkPendingState',
        'sendEvents is false; state is ' + this.connectionManager.state.state,
      );
      return;
    }

    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'RealtimeChannel.checkPendingState',
      'name = ' + this.name + ', state = ' + this.state,
    );
    /* Only start the state timer running when actually sending the event */
    switch (this.state) {
      case 'attaching':
        this.startStateTimerIfNotRunning();
        this.attachImpl();
        break;
      case 'detaching':
        this.startStateTimerIfNotRunning();
        this.detachImpl();
        break;
      case 'attached':
        /* resume any sync operation that was in progress */
        this.sync();
        break;
      default:
        break;
    }
  }

  timeoutPendingState(): void {
    switch (this.state) {
      case 'attaching': {
        const err = new ErrorInfo({
          message: 'Channel attach timed out',
          code: 90007,
          statusCode: 408,
          remediation:
            'The channel is now suspended. The SDK retries the attach automatically while the connection is connected, and you can call channel.attach() to retry immediately. Inspect channel.errorReason if it keeps timing out.',
        });
        this.notifyState('suspended', err);
        break;
      }
      case 'detaching': {
        const err = new ErrorInfo({
          message: 'Channel detach timed out',
          code: 90007,
          statusCode: 408,
          remediation:
            'The detach timed out and the channel is back in the attached state. Call channel.detach() again to retry. Inspect channel.errorReason if it keeps timing out.',
        });
        this.notifyState('attached', err);
        break;
      }
      default:
        this.checkPendingState();
        break;
    }
  }

  startStateTimerIfNotRunning(): void {
    if (!this.stateTimer) {
      this.stateTimer = Platform.Config.setTimeout(() => {
        Logger.logAction(this.logger, Logger.LOG_MINOR, 'RealtimeChannel.startStateTimerIfNotRunning', 'timer expired');
        this.stateTimer = null;
        this.timeoutPendingState();
      }, this.client.options.timeouts.realtimeRequestTimeout);
    }
  }

  clearStateTimer(): void {
    const stateTimer = this.stateTimer;
    if (stateTimer) {
      Platform.Config.clearTimeout(stateTimer as unknown as ReturnType<typeof setTimeout>);
      this.stateTimer = null;
    }
  }

  startRetryTimer(): void {
    if (this.retryTimer) return;

    this.retryCount++;
    const retryDelay = Utils.getRetryTime(this.client.options.timeouts.channelRetryTimeout, this.retryCount);

    this.retryTimer = Platform.Config.setTimeout(() => {
      /* If connection is not connected, just leave in suspended, a reattach
       * will be triggered once it connects again */
      if (this.state === 'suspended' && this.connectionManager.state.sendEvents) {
        this.retryTimer = null;
        Logger.logAction(
          this.logger,
          Logger.LOG_MINOR,
          'RealtimeChannel retry timer expired',
          'attempting a new attach',
        );
        this.requestState('attaching');
      }
    }, retryDelay);
  }

  cancelRetryTimer(): void {
    if (this.retryTimer) {
      Platform.Config.clearTimeout(this.retryTimer as unknown as ReturnType<typeof setTimeout>);
      this.retryTimer = null;
    }
  }

  history = function (this: RealtimeChannel, ...args: unknown[]): Promise<PaginatedResult<Message>> {
    Utils.detectV1Callback(args, 0);
    return this._historyImpl(args[0] as RealtimeHistoryParams | null);
  } as any;

  private _historyImpl = async function (
    this: RealtimeChannel,
    params: RealtimeHistoryParams | null,
  ): Promise<PaginatedResult<Message>> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.history()', 'channel = ' + this.name);

    // We fetch this first so that any plugin-not-provided error takes priority over other errors
    const restMixin = this.client.rest.channelMixin;

    if (params && params.untilAttach) {
      if (this.state !== 'attached') {
        throw new ErrorInfo({
          message: 'option untilAttach requires the channel to be attached, was: ' + this.state,
          code: 40000,
          statusCode: 400,
          remediation: 'Await channel.attach() before calling history({ untilAttach: true }).',
        });
      }
      if (!this.properties.attachSerial) {
        throw new ErrorInfo({
          message: 'untilAttach was specified and channel is attached, but attachSerial is not defined',
          code: 40000,
          statusCode: 400,
          remediation:
            'Detach the channel (await channel.detach()) and re-attach (await channel.attach()) so the SDK records the attachSerial from the new attach, then retry history({ untilAttach: true }).',
        });
      }
      delete params.untilAttach;
      params.from_serial = this.properties.attachSerial;
    }

    return restMixin.history(this, params);
  } as any;

  whenState = ((state: string) => {
    return EventEmitter.prototype.whenState.call(this, state, this.state);
  }) as any;

  /* @returns null (if can safely be released) | ErrorInfo (if cannot) */
  getReleaseErr(): ErrorInfo | null {
    const s = this.state;
    if (s === 'initialized' || s === 'detached' || s === 'failed') {
      return null;
    }
    const err = new ErrorInfo({
      message:
        'Can only release a channel in a state where there is no possibility of further updates from the server being received (initialized, detached, or failed). The current state is ' +
        s,
      code: 90001,
      statusCode: 400,
      remediation:
        'Call channel.detach() and wait for the channel to reach "detached" before calling channels.release(name).',
    });
    return err;
  }

  setChannelSerial(channelSerial?: string | null): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'RealtimeChannel.setChannelSerial()',
      'Updating channel serial; serial = ' + channelSerial + '; previous = ' + this.properties.channelSerial,
    );

    // RTP17h: Only update the channel serial if its present (it won't always
    // be set).
    if (channelSerial) {
      this.properties.channelSerial = channelSerial;
    }
  }

  async status(): Promise<API.ChannelDetails> {
    return this.client.rest.channelMixin.status(this);
  }

  async getMessage(serialOrMessage: string | Message): Promise<Message> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.getMessage()', 'channel = ' + this.name);
    const restMixin = this.client.rest.channelMixin;
    return restMixin.getMessage(this, serialOrMessage);
  }

  async updateMessage(
    message: Message,
    operation?: API.MessageOperation,
    params?: Record<string, any>,
  ): Promise<API.UpdateDeleteResult> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.updateMessage()', 'channel = ' + this.name);
    return this.sendUpdate(message, 'message.update', operation, params);
  }

  async deleteMessage(
    message: Message,
    operation?: API.MessageOperation,
    params?: Record<string, any>,
  ): Promise<API.UpdateDeleteResult> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.deleteMessage()', 'channel = ' + this.name);
    return this.sendUpdate(message, 'message.delete', operation, params);
  }

  async appendMessage(
    message: Message,
    operation?: API.MessageOperation,
    params?: Record<string, any>,
  ): Promise<API.UpdateDeleteResult> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.appendMessage()', 'channel = ' + this.name);
    return this.sendUpdate(message, 'message.append', operation, params);
  }

  private async sendUpdate(
    message: Message,
    action: 'message.update' | 'message.delete' | 'message.append',
    operation?: API.MessageOperation,
    params?: Record<string, any>,
  ): Promise<API.UpdateDeleteResult> {
    if (!message.serial) {
      throw new ErrorInfo({
        message: 'This message lacks a serial',
        code: 40003,
        statusCode: 400,
        remediation:
          'Pass the Message received from a subscribe callback (which carries .serial), not a freshly constructed object.',
      });
    }

    this.throwIfUnpublishableState();

    const updateDeleteMsg = Message.fromValues({
      ...message,
      action: action,
      version: operation,
    });

    const wireMessage = await updateDeleteMsg.encode(this.channelOptions);
    const pm = protocolMessageFromValues({
      action: actions.MESSAGE,
      channel: this.name,
      messages: [wireMessage],
      params: params ? Utils.stringifyValues(params) : undefined,
    });
    const publishResponse = await this.sendAndAwaitAck(pm);
    return { versionSerial: publishResponse.serials[0] ?? null };
  }

  async getMessageVersions(
    serialOrMessage: string | Message,
    params?: Record<string, any>,
  ): Promise<PaginatedResult<Message>> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimeChannel.getMessageVersions()', 'channel = ' + this.name);
    const restMixin = this.client.rest.channelMixin;
    return restMixin.getMessageVersions(this, serialOrMessage, params);
  }

  /**
   * Ensures the channel is attached, attaching if necessary.
   *
   * This method is intended for use by features like Presence or Objects that need to
   * implicitly attach the channel when an operation is called (e.g., `presence.get()` per RTP11b,
   * or `objects.get()`). This guarantees that the corresponding sync sequence will start and
   * that the operation will resolve for callers even if they did not explicitly attach beforehand.
   */
  async ensureAttached(): Promise<void> {
    switch (this.state) {
      case 'attached':
      case 'suspended':
        break;
      case 'initialized':
      case 'detached':
      case 'detaching':
      case 'attaching':
        await this.attach();
        break;
      case 'failed':
      default:
        throw ErrorInfo.fromValues(this.invalidStateError());
    }
  }
}

function omitAgent(channelParams?: API.ChannelParams) {
  const { agent: _, ...paramsWithoutAgent } = channelParams || {};
  return paramsWithoutAgent;
}

export default RealtimeChannel;
