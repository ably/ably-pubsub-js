import * as Utils from '../util/utils';
import EventEmitter from '../util/eventemitter';
import Logger from '../util/logger';
import PresenceMessage, { WirePresenceMessage } from '../types/presencemessage';
import ErrorInfo, { PartialErrorInfo } from '../types/errorinfo';
import { flags } from '../types/protocolmessagecommon';
import RealtimeChannel from './realtimechannel';
import Multicaster from '../util/multicaster';
import ChannelStateChange from './channelstatechange';
import { ErrCallback } from '../../types/utils';
import { PaginatedResult } from './paginatedresource';
import { PresenceMap, RealtimePresenceParams } from './presencemap';
import Platform from '../../platform';

interface RealtimeHistoryParams {
  start?: number;
  end?: number;
  direction?: string;
  limit?: number;
  untilAttach?: boolean;
  from_serial?: string | null;
}

function getClientId(realtimePresence: RealtimePresence) {
  return realtimePresence.channel.client.auth.clientId;
}

function isAnonymousOrWildcard(realtimePresence: RealtimePresence) {
  const realtime = realtimePresence.channel.client;
  /* If not currently connected, we can't assume that we're an anonymous
   * client, as realtime may inform us of our clientId in the CONNECTED
   * message. So assume we're not anonymous and leave it to realtime to
   * return an error if we are */
  const clientId = realtime.auth.clientId;
  return (!clientId || clientId === '*') && realtime.connection.state === 'connected';
}

class RealtimePresence extends EventEmitter {
  channel: RealtimeChannel;
  pendingPresence: { presence: WirePresenceMessage; callback: ErrCallback }[];
  syncComplete: boolean;
  members: PresenceMap;
  _myMembers: PresenceMap;
  subscriptions: EventEmitter;
  name?: string;
  private _syncId?: string;

  constructor(channel: RealtimeChannel) {
    super(channel.logger);
    this.channel = channel;
    this.syncComplete = false;
    this.members = new PresenceMap(this, (item) => item.clientId + ':' + item.connectionId);
    // RTP17h: Store own members by clientId only.
    this._myMembers = new PresenceMap(this, (item) => item.clientId!);
    this.subscriptions = new EventEmitter(this.logger);
    this.pendingPresence = [];
  }

  enter(...args: unknown[]): Promise<void> {
    Utils.detectV1Callback(args, 0);
    return this._enterImpl(args[0]);
  }

  private async _enterImpl(data: unknown): Promise<void> {
    if (isAnonymousOrWildcard(this)) {
      throw new ErrorInfo({
        message: 'clientId must be specified to enter a presence channel',
        code: 40012,
        statusCode: 400,
        remediation:
          'Set ClientOptions.clientId (or include clientId in the token) before calling presence.enter() again. To enter on behalf of another identity, use presence.enterClient(otherId, data), which requires the library to be instantiated with an API key or a token bound to a wildcard clientId.',
      });
    }
    return this._enterOrUpdateClient(undefined, undefined, data, 'enter');
  }

  update(...args: unknown[]): Promise<void> {
    Utils.detectV1Callback(args, 0);
    return this._updateImpl(args[0]);
  }

  private async _updateImpl(data: unknown): Promise<void> {
    if (isAnonymousOrWildcard(this)) {
      throw new ErrorInfo({
        message: 'clientId must be specified to update presence data',
        code: 40012,
        statusCode: 400,
        remediation:
          'Set ClientOptions.clientId (or include clientId in the token) before calling presence.update() again. To update on behalf of another identity, use presence.updateClient(otherId, data), which requires the library to be instantiated with an API key or a token bound to a wildcard clientId.',
      });
    }
    return this._enterOrUpdateClient(undefined, undefined, data, 'update');
  }

  async enterClient(clientId: string, data: unknown): Promise<void> {
    return this._enterOrUpdateClient(undefined, clientId, data, 'enter');
  }

  async updateClient(clientId: string, data: unknown): Promise<void> {
    return this._enterOrUpdateClient(undefined, clientId, data, 'update');
  }

  async _enterOrUpdateClient(
    id: string | undefined,
    clientId: string | undefined,
    data: unknown,
    action: string,
  ): Promise<void> {
    const channel = this.channel;
    if (!channel.connectionManager.activeState()) {
      throw channel.connectionManager.getError();
    }

    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'RealtimePresence.' + action + 'Client()',
      'channel = ' + channel.name + ', id = ' + id + ', client = ' + (clientId || '(implicit) ' + getClientId(this)),
    );

    const presence = PresenceMessage.fromData(data);
    presence.action = action;
    if (id) {
      presence.id = id;
    }
    if (clientId) {
      presence.clientId = clientId;
    }
    const wirePresMsg = await presence.encode(channel.channelOptions);

    switch (channel.state) {
      case 'attached':
        return channel.sendPresence([wirePresMsg]);
      case 'initialized':
      case 'detached':
        // RTP8d: implicitly attach the channel
        channel.attach();
      // eslint-disable-next-line no-fallthrough
      case 'attaching':
        // RTP16b: queue at the channel level only when queueMessages is enabled
        if (channel.client.options.queueMessages) {
          return new Promise((resolve, reject) => {
            this.pendingPresence.push({
              presence: wirePresMsg,
              callback: (err) => (err ? reject(err) : resolve()),
            });
          });
        }
      // RTP16c: not queueable, so reject
      // eslint-disable-next-line no-fallthrough
      default: {
        const err = new PartialErrorInfo(
          'Unable to ' + action + ' presence channel while in ' + channel.state + ' state',
          90001,
        );
        err.code = 90001;
        throw err;
      }
    }
  }

  leave(...args: unknown[]): Promise<void> {
    Utils.detectV1Callback(args, 0);
    return this._leaveImpl(args[0]);
  }

  private async _leaveImpl(data: unknown): Promise<void> {
    if (isAnonymousOrWildcard(this)) {
      throw new ErrorInfo({
        message: 'clientId must have been specified to enter or leave a presence channel',
        code: 40012,
        statusCode: 400,
        remediation:
          'To leave a member entered on behalf of another identity, call presence.leaveClient(otherId). A client that never had a clientId has no self-entered member to leave. leaveClient requires the library to be instantiated with an API key or a token bound to a wildcard clientId.',
      });
    }
    return this.leaveClient(undefined, data);
  }

  async leaveClient(clientId?: string, data?: unknown): Promise<void> {
    const channel = this.channel;
    if (!channel.connectionManager.activeState()) {
      throw channel.connectionManager.getError();
    }

    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'RealtimePresence.leaveClient()',
      'leaving; channel = ' + this.channel.name + ', client = ' + clientId,
    );
    const presence = PresenceMessage.fromData(data);
    presence.action = 'leave';
    if (clientId) {
      presence.clientId = clientId;
    }
    const wirePresMsg = await presence.encode(channel.channelOptions);

    switch (channel.state) {
      case 'attached':
        return channel.sendPresence([wirePresMsg]);
      case 'attaching':
        // RTP16b: queue at the channel level only when queueMessages is enabled
        if (channel.client.options.queueMessages) {
          return new Promise((resolve, reject) => {
            this.pendingPresence.push({
              presence: wirePresMsg,
              callback: (err) => (err ? reject(err) : resolve()),
            });
          });
        }
      // RTP16c: not queueable, so reject.
      // Additionally, as we're not attached, we let any entered status time out
      // by itself instead of attaching just in order to leave.
      // eslint-disable-next-line no-fallthrough
      default: {
        throw new PartialErrorInfo({
          message: 'Unable to leave presence channel while in ' + channel.state + ' state',
          code: 90001,
          remediation:
            'presence.leave() only works while the channel is attached. From "suspended" or "attaching", await channel.attach() and retry, since your presence membership is restored when the channel re-attaches. From "initialized", "detached", or "failed" there is nothing to leave: either no member was entered, or the SDK already cleared your membership when the channel left the attached state.',
        });
      }
    }
  }

  get(...args: unknown[]): Promise<PresenceMessage[]> {
    Utils.detectV1Callback(args, 0);
    return this._getImpl(args[0] as RealtimePresenceParams | undefined);
  }

  private async _getImpl(params?: RealtimePresenceParams): Promise<PresenceMessage[]> {
    const waitForSync = !params || ('waitForSync' in params ? params.waitForSync : true);

    function toMessages(members: PresenceMap): PresenceMessage[] {
      return params ? members.list(params) : members.values();
    }

    /* Special-case the suspended state: can still get (stale) presence set if waitForSync is false */
    if (this.channel.state === 'suspended') {
      if (waitForSync) {
        throw ErrorInfo.fromValues({
          statusCode: 400,
          code: 91005,
          message: 'Presence state is out of sync due to channel being in the SUSPENDED state',
          remediation:
            'Wait for the channel to reach "attached" before calling presence.get(), or pass { waitForSync: false } to read the last known (stale) members.',
        });
      }
      return toMessages(this.members);
    }

    await this.channel.ensureAttached();

    if ((this.channel._mode & flags.PRESENCE_SUBSCRIBE) === 0) {
      const err = new ErrorInfo({
        message:
          'The channel was attached without the presence_subscribe mode, so the server has not delivered any members to this client.',
        code: 91008,
        statusCode: 400,
        remediation:
          'Include "presence_subscribe" in the channel modes: realtime.channels.get(name, { modes: ["presence_subscribe", ...] }), or call channel.setOptions({ modes: [...] }) on an existing channel to trigger a reattach. Alternatively, omit modes entirely and ensure your token/API-key capability permits subscribe on this channel. If you have the Ably CLI installed, `ably auth keys list` shows your key\'s capabilities.',
      });
      if (this.channel.client.options.strictMode === true) throw err;
      Logger.logActionNoStrip(
        this.logger,
        Logger.LOG_ERROR,
        'RealtimePresence.get()',
        err.message + '; remediation=' + err.remediation + Logger.silentFailureLogSuffix(),
      );
    }

    const members = this.members;
    if (waitForSync) {
      await members.waitSync();
    }

    return toMessages(this.members);
  }

  history(...args: unknown[]): Promise<PaginatedResult<PresenceMessage>> {
    Utils.detectV1Callback(args, 0);
    return this._historyImpl(args[0] as RealtimeHistoryParams | null);
  }

  private async _historyImpl(params: RealtimeHistoryParams | null): Promise<PaginatedResult<PresenceMessage>> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RealtimePresence.history()', 'channel = ' + this.name);
    // We fetch this first so that any plugin-not-provided error takes priority over other errors
    const restMixin = this.channel.client.rest.presenceMixin;

    if (params && params.untilAttach) {
      if (this.channel.state === 'attached') {
        delete params.untilAttach;
        params.from_serial = this.channel.properties.attachSerial;
      } else {
        throw new ErrorInfo({
          message: 'option untilAttach requires the channel to be attached, was: ' + this.channel.state,
          code: 40000,
          statusCode: 400,
          remediation: 'Await channel.attach() before calling presence.history({ untilAttach: true }).',
        });
      }
    }

    return restMixin.history(this, params);
  }

  setPresence(presenceSet: PresenceMessage[], isSync: boolean, syncChannelSerial?: string): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'RealtimePresence.setPresence()',
      'received presence for ' + presenceSet.length + ' participants; syncChannelSerial = ' + syncChannelSerial,
    );
    let syncId, syncCursor, match;
    const members = this.members,
      myMembers = this._myMembers,
      broadcastMessages = [],
      connId = this.channel.connectionManager.connectionId;

    if (isSync) {
      if (syncChannelSerial && (match = syncChannelSerial.match(/^([\w-]+):(.*)$/))) {
        syncId = match[1];
        syncCursor = match[2];
      }
      if (!this.members.syncInProgress || (this._syncId !== undefined && syncId !== this._syncId)) {
        this.members.startSync();
      }
      if (syncId !== undefined) {
        this._syncId = syncId;
      }
    }

    for (let presence of presenceSet) {
      switch (presence.action) {
        case 'leave':
          if (members.remove(presence)) {
            broadcastMessages.push(presence);
          }
          if (presence.connectionId === connId && !presence.isSynthesized()) {
            myMembers.remove(presence);
          }
          break;
        case 'enter':
        case 'present':
        case 'update':
          if (members.put(presence)) {
            broadcastMessages.push(presence);
          }
          if (presence.connectionId === connId) {
            myMembers.put(presence);
          }
          break;
      }
    }
    /* if this is the last (or only) message in a sequence of sync updates, end the sync */
    if (isSync && !syncCursor) {
      members.endSync();
      this._syncId = undefined;
      this.channel.syncChannelSerial = null;
    }

    /* broadcast to listeners */
    for (let i = 0; i < broadcastMessages.length; i++) {
      const presence = broadcastMessages[i];
      this.subscriptions.emit(presence.action!, presence);
    }
  }

  onAttached(hasPresence?: boolean): void {
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'RealtimePresence.onAttached()',
      'channel = ' + this.channel.name + ', hasPresence = ' + hasPresence,
    );

    if (hasPresence) {
      this.members.startSync();
    } else {
      this._synthesizeLeaves(this.members.values());
      this.members.clear();
    }

    // RTP17i: Re-enter own members when moving into the attached state.
    this._ensureMyMembersPresent();

    /* NB this must be after the _ensureMyMembersPresent call, which may add items to pendingPresence */
    const pendingPresence = this.pendingPresence,
      pendingPresCount = pendingPresence.length;

    if (pendingPresCount) {
      this.pendingPresence = [];
      const presenceArray = [];
      const multicaster = Multicaster.create(this.logger);
      Logger.logAction(
        this.logger,
        Logger.LOG_MICRO,
        'RealtimePresence.onAttached',
        'sending ' + pendingPresCount + ' queued presence messages',
      );
      for (let i = 0; i < pendingPresCount; i++) {
        const event = pendingPresence[i];
        presenceArray.push(event.presence);
        multicaster.push(event.callback);
      }
      this.channel
        .sendPresence(presenceArray)
        .then(() => multicaster())
        .catch((err: ErrorInfo) => multicaster(err));
    }
  }

  actOnChannelState(state: string, hasPresence?: boolean, err?: ErrorInfo | null): void {
    switch (state) {
      case 'attached':
        this.onAttached(hasPresence);
        break;
      case 'detached':
      case 'failed':
        this._clearMyMembers();
        this.members.clear();
      /* falls through */
      case 'suspended':
        this.failPendingPresence(err);
        break;
    }
  }

  failPendingPresence(err?: ErrorInfo | null): void {
    if (this.pendingPresence.length) {
      Logger.logAction(
        this.logger,
        Logger.LOG_MINOR,
        'RealtimeChannel.failPendingPresence',
        'channel; name = ' + this.channel.name + ', err = ' + Utils.inspectError(err),
      );
      for (let i = 0; i < this.pendingPresence.length; i++)
        try {
          this.pendingPresence[i].callback(err);
          // eslint-disable-next-line no-empty
        } catch (e) {}
      this.pendingPresence = [];
    }
  }

  /**
   * RTL3d: re-queue presence messages that were moved off the connection-wide
   * queue onto this channel's presence queue, to be sent once the channel next
   * reaches the ATTACHED state (RTP5b).
   */
  requeuePresenceMessages(presenceMessages: WirePresenceMessage[], callback: ErrCallback): void {
    for (const presence of presenceMessages) {
      this.pendingPresence.push({ presence, callback });
    }
  }

  _clearMyMembers(): void {
    this._myMembers.clear();
  }

  _ensureMyMembersPresent(): void {
    const myMembers = this._myMembers;
    const connId = this.channel.connectionManager.connectionId;

    for (const memberKey in myMembers.map) {
      const entry = myMembers.map[memberKey];
      Logger.logAction(
        this.logger,
        Logger.LOG_MICRO,
        'RealtimePresence._ensureMyMembersPresent()',
        'Auto-reentering clientId "' + entry.clientId + '" into the presence set',
      );
      // RTP17g: Send ENTER containing the member id, clientId and data
      // attributes.
      // RTP17g1: suppress id if the connId has changed
      const id = entry.connectionId === connId ? entry.id : undefined;
      this._enterOrUpdateClient(id, entry.clientId, entry.data, 'enter').catch((err) => {
        const wrappedErr = new ErrorInfo({
          message: 'Presence auto re-enter failed',
          code: 91004,
          statusCode: 400,
          cause: err,
          remediation:
            'Listen for the channel "update" event and call presence.enter(...) again once the channel is attached. For a member entered on behalf of another clientId, call presence.enterClient(clientId, data) instead.',
        });
        Logger.logAction(
          this.logger,
          Logger.LOG_ERROR,
          'RealtimePresence._ensureMyMembersPresent()',
          'Presence auto re-enter failed; reason = ' + Utils.inspectError(err),
        );
        // RTP17e
        const change = new ChannelStateChange(this.channel.state, this.channel.state, true, false, wrappedErr);
        this.channel.emit('update', change);
      });
    }
  }

  _synthesizeLeaves(items: PresenceMessage[]): void {
    const subscriptions = this.subscriptions;
    items.forEach(function (item) {
      const presence = PresenceMessage.fromValues({
        action: 'leave',
        connectionId: item.connectionId,
        clientId: item.clientId,
        data: item.data,
        encoding: item.encoding,
        timestamp: Platform.Config.now(),
      });
      subscriptions.emit('leave', presence);
    });
  }

  subscribe(..._args: unknown[] /* [event], listener */): Promise<void> {
    Utils.detectV1Callback(_args, 2);
    return this._subscribeImpl(_args);
  }

  private async _subscribeImpl(_args: unknown[]): Promise<void> {
    const args = RealtimeChannel.processListenerArgs(_args);
    const event = args[0];
    const listener = args[1];
    const channel = this.channel;

    if (channel.state === 'failed') {
      throw ErrorInfo.fromValues(channel.invalidStateError());
    }

    this.subscriptions.on(event, listener);

    // (RTP6d)
    if (channel.channelOptions.attachOnSubscribe !== false) {
      await channel.attach();
    }
  }

  unsubscribe(..._args: unknown[] /* [event], listener */): void {
    const args = RealtimeChannel.processListenerArgs(_args);
    const event = args[0];
    const listener = args[1];
    this.subscriptions.off(event, listener);
  }
}

export default RealtimePresence;
