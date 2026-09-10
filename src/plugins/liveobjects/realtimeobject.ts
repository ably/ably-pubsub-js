import type BaseClient from 'common/lib/client/baseclient';
import type RealtimeChannel from 'common/lib/client/realtimechannel';
import type ErrorInfo from 'common/lib/types/errorinfo';
import type EventEmitter from 'common/lib/util/eventemitter';
import type * as API from '../../../ably';
import type { ChannelState, StatusSubscription } from '../../../ably';
import type * as ObjectsApi from '../../../liveobjects';
import { DEFAULTS } from './defaults';
import { LiveCounter } from './livecounter';
import { LiveMap } from './livemap';
import { LiveObject, LiveObjectUpdate, LiveObjectUpdateNoop } from './liveobject';
import { ObjectMessage, ObjectOperationAction } from './objectmessage';
import { ObjectsPool } from './objectspool';
import { DefaultPathObject } from './pathobject';
import { PathObjectSubscriptionRegister } from './pathobjectsubscriptionregister';
import { SyncObjectsPool } from './syncobjectspool';

export enum ObjectsEvent {
  syncing = 'syncing',
  synced = 'synced',
}

/**
 * Internal-only signals emitted on `_eventEmitterInternal` (never on `_eventEmitterPublic`), so they
 * are not observable through the public `RealtimeObject#on` API.
 */
enum ObjectsInternalEvent {
  // RTO23c1 / RTO20e1 - emitted when the channel transitions into DETACHED/SUSPENDED/FAILED, so that
  // parked objects-sync waiters (get()/publishAndApply) can fail. Carries the channel state and its
  // errorReason as emit arguments.
  syncWaitFailed = 'syncWaitFailed',
}

/** @spec RTO22 */
export enum ObjectsOperationSource {
  local = 'local',
  channel = 'channel',
}

export enum ObjectsState {
  initialized = 'initialized',
  syncing = 'syncing',
  synced = 'synced',
}

const StateToEventsMap: Record<ObjectsState, ObjectsEvent | undefined> = {
  initialized: undefined,
  syncing: ObjectsEvent.syncing,
  synced: ObjectsEvent.synced,
};

export type ObjectsEventCallback = () => void;

/**
 * Remediation for a `get()` sync wait failing (RTO23c1). The rejection is recoverable, but the
 * recovery differs per state: `ensureAttached` at `get()` entry re-attaches a DETACHED channel
 * itself and proceeds through SUSPENDED (the SDK re-attaches when the connection recovers), so a
 * plain retry suffices for those two states, whereas from FAILED `get()` rejects at entry (90001)
 * until the channel is explicitly re-attached.
 */
function getSyncWaitFailureRemediation(state: ChannelState): string {
  switch (state) {
    case 'detached':
      return 'Retry channel.object.get(). The retried call re-attaches the channel and waits for a fresh objects sync.';
    case 'suspended':
      return 'Retry channel.object.get() once the channel re-attaches. The SDK re-attaches suspended channels automatically when the connection recovers, or call channel.attach() to retry now.';
    default:
      return 'Inspect the cause for the underlying failure. Call channel.attach() to recover the channel, then retry channel.object.get(). Calling channel.object.get() on a failed channel without re-attaching first rejects immediately.';
  }
}

/**
 * Remediation for a `publishAndApply` sync wait failing (RTO20e1), reached via the public mutation
 * APIs (`LiveMap.set`/`remove`, `LiveCounter.increment`/`decrement`, batch). The operation was
 * published and ACKed before the wait started, so it is persisted server-side and must not be
 * retried; only the local optimistic apply failed, and the local object converges on the next
 * successful attach and objects sync. State-independent, unlike the `get()` remediation.
 */
function publishSyncWaitFailureRemediation(): string {
  return 'Do not retry the operation. It was already published and acknowledged by Ably, so retrying would apply it twice. The local object converges automatically on the next successful attach and objects sync. Inspect the cause and channel.errorReason for why the channel left the attached state.';
}

export class RealtimeObject {
  gcGracePeriod: number;

  private _client: BaseClient;
  private _channel: RealtimeChannel;
  private _state: ObjectsState;
  // composition over inheritance since we cannot import class directly into plugin code.
  // instead we obtain a class type from the client
  private _eventEmitterInternal: EventEmitter;
  // related to RTC10, should have a separate EventEmitter for users of the library
  private _eventEmitterPublic: EventEmitter;
  private _objectsPool: ObjectsPool; // RTO3
  private _syncObjectsPool: SyncObjectsPool;
  private _currentSyncId: string | undefined;
  private _currentSyncCursor: string | undefined;
  private _bufferedObjectOperations: ObjectMessage[];
  private _appliedOnAckSerials: Set<string>; // RTO7b
  private _pathObjectSubscriptionRegister: PathObjectSubscriptionRegister;

  // Used by tests
  static _DEFAULTS = DEFAULTS;

  constructor(channel: RealtimeChannel) {
    this._channel = channel;
    this._client = channel.client;
    this._state = ObjectsState.initialized;
    this._eventEmitterInternal = new this._client.EventEmitter(this._client.logger);
    this._eventEmitterPublic = new this._client.EventEmitter(this._client.logger);
    this._objectsPool = new ObjectsPool(this);
    this._syncObjectsPool = new SyncObjectsPool(this);
    this._bufferedObjectOperations = [];
    this._appliedOnAckSerials = new Set(); // RTO7b1
    this._pathObjectSubscriptionRegister = new PathObjectSubscriptionRegister(this);
    // use server-provided objectsGCGracePeriod if available, and subscribe to new connectionDetails that can be emitted as part of the RTN24
    this.gcGracePeriod =
      this._channel.connectionManager.connectionDetails?.objectsGCGracePeriod ?? DEFAULTS.gcGracePeriod;
    this._channel.connectionManager.on('connectiondetails', (details: Record<string, any>) => {
      this.gcGracePeriod = details.objectsGCGracePeriod ?? DEFAULTS.gcGracePeriod;
    });
  }

  /**
   * When called without a type variable, we return a default root type which is based on globally defined interface for Objects feature.
   * A user can provide an explicit type for the this method to explicitly set the type structure on this particular channel.
   * This is useful when working with multiple channels with different underlying data structure.
   */
  async get<T extends Record<string, ObjectsApi.Value>>(): Promise<ObjectsApi.PathObject<ObjectsApi.LiveMap<T>>> {
    this._throwIfMissingChannelMode('object_subscribe');

    // implicit attach before proceeding
    await this._channel.ensureAttached();

    // RTO23c - if we're not synced yet, wait for sync sequence to finish before returning root
    if (this._state !== ObjectsState.synced) {
      await this._waitForSyncedOrChannelFailure('the object could not be retrieved', getSyncWaitFailureRemediation); // RTO23c1
    }

    const pathObject = new DefaultPathObject(this, this._objectsPool.getRoot(), []);
    return pathObject;
  }

  on(event: ObjectsEvent, callback: ObjectsEventCallback): StatusSubscription {
    // this public API method can be called without specific configuration, so checking for invalid settings is unnecessary.
    this._eventEmitterPublic.on(event, callback);

    const off = () => {
      this._eventEmitterPublic.off(event, callback);
    };

    return { off };
  }

  off(event: ObjectsEvent, callback: ObjectsEventCallback): void {
    // this public API method can be called without specific configuration, so checking for invalid settings is unnecessary.

    // prevent accidentally calling .off without any arguments on an EventEmitter and removing all callbacks
    if (this._client.Utils.isNil(event) && this._client.Utils.isNil(callback)) {
      return;
    }

    this._eventEmitterPublic.off(event, callback);
  }

  /**
   * @internal
   */
  getPool(): ObjectsPool {
    return this._objectsPool;
  }

  /**
   * @internal
   */
  getChannel(): RealtimeChannel {
    return this._channel;
  }

  /**
   * @internal
   */
  getClient(): BaseClient {
    return this._client;
  }

  /**
   * @internal
   */
  getPathObjectSubscriptionRegister(): PathObjectSubscriptionRegister {
    return this._pathObjectSubscriptionRegister;
  }

  /**
   * @internal
   * @spec RTO5
   *
   * Note on server-initiated resync: if the realtime server needs to force a resync, it is expected
   * to send an ATTACHED message before the new OBJECT_SYNC sequence. However, if an OBJECT_SYNC
   * is received after a previously completed sync without a preceding ATTACHED,
   * we handle it on a best-effort basis: enter the SYNCING state and start buffering OBJECT messages
   * from that point. Since the buffer is cleared at the end of each completed sync sequence, receiving
   * an OBJECT_SYNC while in the SYNCED state means we start with an empty buffer.
   */
  handleObjectSyncMessages(objectMessages: ObjectMessage[], syncChannelSerial: string | null | undefined): void {
    const { syncId, syncCursor } = this._parseSyncChannelSerial(syncChannelSerial); // RTO5a
    const newSyncSequence = this._currentSyncId !== syncId;
    if (newSyncSequence) {
      // RTO5a2 - new sync sequence started
      this._startNewSync(syncId, syncCursor); // RTO5a2a
    }

    // RTO5a3 - continue current sync sequence
    this._syncObjectsPool.applyObjectSyncMessages(objectMessages); // RTO5f

    // RTO5a4 - if this is the last (or only) message in a sequence of sync updates, end the sync
    if (!syncCursor) {
      this._endSync(); // RTO5c
    }
  }

  /**
   * @internal
   * @spec RTO8
   */
  handleObjectMessages(objectMessages: ObjectMessage[]): void {
    if (this._state !== ObjectsState.synced) {
      // The client receives object messages in realtime over the channel concurrently with the sync sequence.
      // Some of the incoming object messages may have already been applied to the objects described in
      // the sync sequence, but others may not; therefore we must buffer these messages so that we can apply
      // them to the objects once the sync is complete.
      this._bufferedObjectOperations.push(...objectMessages);
      return;
    }

    this._applyObjectMessages(objectMessages, ObjectsOperationSource.channel); // RTO8b
  }

  /**
   * @internal
   * @spec RTO4
   */
  onAttached(hasObjects?: boolean): void {
    this._client.Logger.logAction(
      this._client.logger,
      this._client.Logger.LOG_MINOR,
      'RealtimeObject.onAttached()',
      `channel=${this._channel.name}, hasObjects=${hasObjects}`,
    );

    // Regardless of whether HAS_OBJECTS is set, the client must drop any previously buffered object operations
    // and start a new sync sequence. If HAS_OBJECTS is set, the realtime server will deliver a sync sequence
    // following the ATTACHED, guaranteeing that the objects in that sequence include at least all operations
    // up to the point of attachment.
    // RTO4d
    this._bufferedObjectOperations = [];
    // RTO4c
    this._startNewSync();

    // RTO4b
    if (!hasObjects) {
      // If no HAS_OBJECTS flag was received on attach, end the sync sequence immediately and treat it as no objects on the channel.
      // Reset the objects pool to its initial state and emit update events so subscribers to the root object are notified of changes.
      this._objectsPool.resetToInitialPool(true); // RTO4b1, RTO4b2
      this._syncObjectsPool.clear(); // RTO4b3
      this._endSync(); // RTO4b4
    }
  }

  /**
   * @internal
   * Dispatches channel state changes to the objects data lifecycle handlers: the `ATTACHED`
   * transition is handled per RTO4 (via `onAttached`, which drives the sync lifecycle), and
   * every other state per RTO27.
   * @spec RTO4 - handling of the `ATTACHED` transition
   * @spec RTO27 - manage the stored objects data across non-`ATTACHED` transitions
   */
  actOnChannelState(state: ChannelState, hasObjects?: boolean, reason?: ErrorInfo | null): void {
    switch (state) {
      case 'attached':
        // RTO4 - ATTACHED is handled by onAttached (the sync lifecycle); it is outside RTO27's scope
        this.onAttached(hasObjects);
        break;

      case 'detached':
      case 'suspended':
      case 'failed':
        // RTO23c1 / RTO20e1 - fail any parked objects-sync waiters (get()/publishAndApply) before the
        // RTO27a data clearing below (drain-then-clear, matching ably-cocoa). The channel's errorReason
        // is not yet assigned when notifyState invokes this handler, so it is passed in as `reason`.
        // Emitted unconditionally; a no-op when no waiter is parked.
        this._eventEmitterInternal.emit(ObjectsInternalEvent.syncWaitFailed, state, reason);

        if (state !== 'suspended') {
          // RTO27a - the actual current state of Objects data is unknown in DETACHED/FAILED, so clear it
          // without emitting update events (RTO27a1); the objects themselves remain in the pool.
          this._objectsPool.clearObjectsData(false); // RTO27a1
          this._syncObjectsPool.clear(); // RTO27a2
        }
        // RTO27b - SUSPENDED (and every unlisted state: INITIALIZED, ATTACHING, DETACHING) retains the
        // objects data unchanged. For SUSPENDED in particular the connection may still recover, so the
        // retained data remains a valid best-effort local copy.
        break;
    }
  }

  /**
   * @internal
   * @spec RTO15
   */
  async publish(objectMessages: ObjectMessage[]): Promise<API.PublishResult> {
    this._channel.throwIfUnpublishableState();

    const encodedMsgs = objectMessages.map((x) => x.encode());
    const maxMessageSize = this._client.options.maxMessageSize;
    const size = encodedMsgs.reduce((acc, msg) => acc + msg.getMessageSize(), 0);
    if (size > maxMessageSize) {
      throw new this._client.ErrorInfo(
        `Maximum size of object messages that can be published at once exceeded (was ${size} bytes, against a limit of ${maxMessageSize} bytes)`,
        40009,
        400,
      );
    }

    // RTO15h
    return this._channel.sendState(encodedMsgs);
  }

  /**
   * Publishes ObjectMessages and applies them locally upon receiving the ACK from the server.
   *
   * @internal
   * @spec RTO20
   */
  async publishAndApply(objectMessages: ObjectMessage[]): Promise<void> {
    // RTO20b
    const publishResult = await this.publish(objectMessages);

    this._client.Logger.logAction(
      this._client.logger,
      this._client.Logger.LOG_MICRO,
      'RealtimeObject.publishAndApply()',
      `received ACK for ${objectMessages.length} message(s), applying locally; channel=${this._channel.name}`,
    );

    // RTO20c - check required information is available
    const siteCode = this._channel.connectionManager.connectionDetails?.siteCode;
    // RTO20c1
    if (!siteCode) {
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_ERROR,
        'RealtimeObject.publishAndApply()',
        `operations will not be applied locally: siteCode not available from connectionDetails; channel=${this._channel.name}`,
      );
      return;
    }
    // RTO20c2
    if (!publishResult.serials || publishResult.serials.length !== objectMessages.length) {
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_ERROR,
        'RealtimeObject.publishAndApply()',
        `operations will not be applied locally: PublishResult.serials has unexpected length (expected ${objectMessages.length}, got ${publishResult.serials?.length}); channel=${this._channel.name}`,
      );
      return;
    }

    // RTO20d
    const syntheticMessages: ObjectMessage[] = [];
    for (let i = 0; i < objectMessages.length; i++) {
      const serial = publishResult.serials[i];

      // RTO20d1
      if (serial === null) {
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MICRO,
          'RealtimeObject.publishAndApply()',
          `operation will not be applied locally: serial is null in PublishResult (index ${i}); channel=${this._channel.name}`,
        );
        continue;
      }

      // RTO20d2, RTO20d3
      syntheticMessages.push(
        ObjectMessage.fromValues(
          {
            ...objectMessages[i],
            serial, // RTO20d2a
            siteCode, // RTO20d2b
          },
          this._client.Utils,
          this._client.MessageEncoding,
        ),
      );
    }

    // RTO20e - Wait for sync to complete if not synced
    if (this._state !== ObjectsState.synced) {
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MICRO,
        'RealtimeObject.publishAndApply()',
        `waiting for sync to complete before applying ${syntheticMessages.length} message(s); channel=${this._channel.name}`,
      );

      await this._waitForSyncedOrChannelFailure(
        'the operation could not be applied locally',
        publishSyncWaitFailureRemediation,
      ); // RTO20e1
    }

    // RTO20f - Apply synthetic messages
    this._client.Logger.logAction(
      this._client.logger,
      this._client.Logger.LOG_MICRO,
      'RealtimeObject.publishAndApply()',
      `applying ${syntheticMessages.length} message(s); channel=${this._channel.name}`,
    );
    this._applyObjectMessages(syntheticMessages, ObjectsOperationSource.local);
  }

  /**
   * @internal
   */
  throwIfInvalidAccessApiConfiguration(): void {
    this._throwIfMissingChannelMode('object_subscribe');
    this._throwIfInChannelState(['detached', 'failed']);
  }

  /**
   * @internal
   */
  throwIfInvalidWriteApiConfiguration(): void {
    this._throwIfMissingChannelMode('object_publish');
    this._throwIfInChannelState(['detached', 'failed', 'suspended']);
    this._throwIfEchoMessagesDisabled();
  }

  private _startNewSync(syncId?: string, syncCursor?: string): void {
    this._syncObjectsPool.clear();
    this._currentSyncId = syncId;
    this._currentSyncCursor = syncCursor;
    this._stateChange(ObjectsState.syncing);
  }

  /** @spec RTO5c */
  private _endSync(): void {
    this._applySync();
    // Apply buffered object operations after the sync has been applied.
    // Uses the regular object message application logic.
    this._applyObjectMessages(this._bufferedObjectOperations, ObjectsOperationSource.channel); // RTO5c6

    this._bufferedObjectOperations = []; // RTO5c5
    this._syncObjectsPool.clear(); // RTO5c4
    this._currentSyncId = undefined; // RTO5c3
    this._currentSyncCursor = undefined; // RTO5c3

    // RTO5c9 - Clear appliedOnAckSerials
    this._appliedOnAckSerials.clear();

    this._stateChange(ObjectsState.synced);
  }

  private _parseSyncChannelSerial(syncChannelSerial: string | null | undefined): {
    syncId: string | undefined;
    syncCursor: string | undefined;
  } {
    let match: RegExpMatchArray | null;
    let syncId: string | undefined = undefined;
    let syncCursor: string | undefined = undefined;
    // RTO5a1 - syncChannelSerial is a two-part identifier: <sequence id>:<cursor value>
    if (syncChannelSerial && (match = syncChannelSerial.match(/^([\w-]+):(.*)$/))) {
      syncId = match[1];
      syncCursor = match[2];
    }

    return {
      syncId,
      syncCursor,
    };
  }

  private _applySync(): void {
    if (this._syncObjectsPool.isEmpty()) {
      return;
    }

    const receivedObjectIds = new Set<string>();
    const existingObjectUpdates: {
      object: LiveObject;
      update: LiveObjectUpdate | LiveObjectUpdateNoop;
    }[] = [];

    // RTO5c1
    for (const [objectId, objectMessage] of this._syncObjectsPool.entries()) {
      receivedObjectIds.add(objectId);
      const existingObject = this._objectsPool.get(objectId);

      // RTO5c1a
      if (existingObject) {
        const update = existingObject.overrideWithObjectState(objectMessage); // RTO5c1a1
        // store updates to call subscription callbacks for all of them once the sync sequence is completed.
        // this will ensure that clients get notified about the changes only once everything has been applied.
        existingObjectUpdates.push({ object: existingObject, update });
        continue;
      }

      // RTO5c1b
      let newObject: LiveObject;
      if (objectMessage.object?.counter) {
        newObject = LiveCounter.fromObjectState(this, objectMessage); // RTO5c1b1a
      } else if (objectMessage.object?.map) {
        newObject = LiveMap.fromObjectState(this, objectMessage); // RTO5c1b1b
      } else {
        // RTO5c1b1c
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MAJOR,
          'RealtimeObject._applySync()',
          `received unsupported object state message during OBJECT_SYNC, expected 'counter' or 'map' to be present, skipping message; message id: ${objectMessage.id}, channel: ${this._channel.name}`,
        );
        continue;
      }

      this._objectsPool.set(objectId, newObject); // RTO5c1b1
    }

    // RTO5c2 - need to remove LiveObject instances from the ObjectsPool for which objectIds were not received during the sync sequence
    this._objectsPool.deleteExtraObjectIds([...receivedObjectIds]);

    // Rebuild all parent references after sync to ensure all object-to-object references are properly established
    // This is necessary because objects may reference other objects that weren't in the pool when they were initially created
    this._rebuildAllParentReferences();

    // call subscription callbacks for all updated existing objects.
    existingObjectUpdates.forEach(({ object, update }) => object.notifyUpdated(update));
  }

  /** @spec RTO9 */
  private _applyObjectMessages(objectMessages: ObjectMessage[], source: ObjectsOperationSource): void {
    for (const objectMessage of objectMessages) {
      if (!objectMessage.operation) {
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MAJOR,
          'RealtimeObject._applyObjectMessages()',
          `object operation message is received without 'operation' field, skipping message; message id: ${objectMessage.id}, channel: ${this._channel.name}`,
        );
        continue;
      }

      const serial = objectMessage.serial;

      // RTO9a3 - Skip if already applied on ACK
      if (serial && this._appliedOnAckSerials.has(serial)) {
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MICRO,
          'RealtimeObject._applyObjectMessages()',
          `skipping message: already applied on ACK; serial=${serial}, channel=${this._channel.name}`,
        );
        this._appliedOnAckSerials.delete(serial);
        continue;
      }

      const objectOperation = objectMessage.operation;

      switch (objectOperation.action) {
        case ObjectOperationAction.MAP_CREATE:
        case ObjectOperationAction.COUNTER_CREATE:
        case ObjectOperationAction.MAP_SET:
        case ObjectOperationAction.MAP_REMOVE:
        case ObjectOperationAction.COUNTER_INC:
        case ObjectOperationAction.OBJECT_DELETE:
        case ObjectOperationAction.MAP_CLEAR: {
          // we can receive an op for an object id we don't have yet in the pool. instead of buffering such operations,
          // we can create a zero-value object for the provided object id and apply the operation to that zero-value object.
          // this also means that all objects are capable of applying the corresponding *_CREATE ops on themselves,
          // since they need to be able to eventually initialize themselves from that *_CREATE op.
          // so to simplify operations handling, we always try to create a zero-value object in the pool first,
          // and then we can always apply the operation on the existing object in the pool.
          this._objectsPool.createZeroValueObjectIfNotExists(objectOperation.objectId);
          const applied = this._objectsPool
            .get(objectOperation.objectId)!
            .applyOperation(objectOperation, objectMessage, source); // RTO9a2a3

          // RTO9a2a4
          if (source === ObjectsOperationSource.local && applied && serial) {
            this._appliedOnAckSerials.add(serial);
          }
          break;
        }

        default:
          this._client.Logger.logAction(
            this._client.logger,
            this._client.Logger.LOG_MAJOR,
            'RealtimeObject._applyObjectMessages()',
            `received unsupported action in object operation message: ${objectOperation.action}, skipping message; message id: ${objectMessage.id}, channel: ${this._channel.name}`,
          );
      }
    }
  }

  /** @spec RTO2 */
  private _throwIfMissingChannelMode(expectedMode: 'object_subscribe' | 'object_publish'): void {
    // RTO2a - channel.modes is only populated on channel attachment, so use it only if it is set
    if (this._channel.modes != null && !this._channel.modes.includes(expectedMode)) {
      throw new this._client.ErrorInfo({
        message: `"${expectedMode}" channel mode must be set for this operation`,
        code: 40024,
        statusCode: 400,
        remediation: `Include "${expectedMode}" in the channel modes: realtime.channels.get(name, { modes: ["${expectedMode}", ...] }), or call channel.setOptions({ modes: [...] }) on an existing channel to trigger a reattach. Calling channels.get(name, { modes }) on an existing channel throws. If the mode is still missing after the reattach, your API key lacks the capability corresponding to the mode ("object-subscribe" or "object-publish") on this channel and the server silently dropped it. If you have the Ably CLI installed, \`ably auth keys list\` shows your key's capabilities.`,
      });
    }
    // RTO2b - otherwise as a best effort use user provided channel options
    if (!this._client.Utils.allToLowerCase(this._channel.channelOptions.modes ?? []).includes(expectedMode)) {
      throw new this._client.ErrorInfo({
        message: `"${expectedMode}" channel mode must be set for this operation`,
        code: 40024,
        statusCode: 400,
        remediation: `Include "${expectedMode}" in the channel modes: realtime.channels.get(name, { modes: ["${expectedMode}", ...] }), or call channel.setOptions({ modes: [...] }) on an existing channel to trigger a reattach. Calling channels.get(name, { modes }) on an existing channel throws. If the mode is still missing after the reattach, your API key lacks the capability corresponding to the mode ("object-subscribe" or "object-publish") on this channel and the server silently dropped it. If you have the Ably CLI installed, \`ably auth keys list\` shows your key's capabilities.`,
      });
    }
  }

  /**
   * Waits for the objects sync state to reach SYNCED, rejecting with a 92008 error if the channel
   * first transitions into DETACHED/SUSPENDED/FAILED (signalled by `actOnChannelState` via the
   * internal `syncWaitFailed` event). Shared by `get()` (RTO23c1) and `publishAndApply` (RTO20e1),
   * which differ in the error message's `failureDescription` prefix and in their caller-specific
   * `remediation` (resolved per failure state, since the recovery advice depends on it); the error's
   * code (92008), statusCode (400), and cause (the channel's errorReason) are mandated identically
   * by both spec points, which say nothing about remediation. The cause is the state-change
   * `reason` — the same error `notifyState` assigns to `RealtimeChannel.errorReason`; on a
   * reason-less transition (e.g. a clean detach) the cause is deliberately absent rather than a
   * stale prior errorReason. Both listeners are removed on either outcome (no leaks).
   */
  private _waitForSyncedOrChannelFailure(
    failureDescription: string,
    remediation: (state: ChannelState) => string,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this._eventEmitterInternal.off(ObjectsEvent.synced, onSynced);
        this._eventEmitterInternal.off(ObjectsInternalEvent.syncWaitFailed, onChannelFailure);
      };
      const onSynced = () => {
        cleanup();
        resolve();
      };
      const onChannelFailure = (state: ChannelState, reason?: ErrorInfo | null) => {
        cleanup();
        reject(
          new this._client.ErrorInfo({
            message: `${failureDescription} due to the channel entering the ${state} state whilst waiting for objects sync to complete`,
            code: 92008,
            statusCode: 400,
            cause: reason || undefined,
            remediation: remediation(state),
          }),
        );
      };
      this._eventEmitterInternal.once(ObjectsEvent.synced, onSynced);
      this._eventEmitterInternal.once(ObjectsInternalEvent.syncWaitFailed, onChannelFailure);
    });
  }

  private _stateChange(state: ObjectsState): void {
    if (this._state === state) {
      return;
    }

    this._state = state;
    const event = StateToEventsMap[state];
    if (!event) {
      return;
    }

    this._eventEmitterInternal.emit(event);
    this._eventEmitterPublic.emit(event);
  }

  /**
   * Rebuilds all parent references in the objects pool.
   * This is necessary after sync operations where objects may reference other objects
   * that weren't available when the initial parent references were established.
   */
  private _rebuildAllParentReferences(): void {
    // First, clear all existing parent references
    for (const object of this._objectsPool.getAll()) {
      object.clearParentReferences();
    }

    // Then, rebuild parent references by examining all objects and their data
    for (const object of this._objectsPool.getAll()) {
      if (object instanceof LiveMap) {
        // For LiveMaps, iterate through their entries and establish parent references
        for (const [key, value] of object.entries()) {
          if (value instanceof LiveObject) {
            value.addParentReference(object, key);
          }
        }
      }
      // Note: LiveCounter doesn't reference other objects, so no special handling needed
    }
  }

  private _throwIfInChannelState(channelState: ChannelState[]): void {
    if (channelState.includes(this._channel.state)) {
      throw this._client.ErrorInfo.fromValues(this._channel.invalidStateError());
    }
  }

  private _throwIfEchoMessagesDisabled(): void {
    if (this._channel.client.options.echoMessages === false) {
      throw new this._channel.client.ErrorInfo(
        `"echoMessages" client option must be enabled for this operation`,
        40000,
        400,
      );
    }
  }
}
