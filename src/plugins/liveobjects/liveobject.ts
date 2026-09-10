import type BaseClient from 'common/lib/client/baseclient';
import type EventEmitter from 'common/lib/util/eventemitter';
import type { EventCallback, Subscription } from '../../../ably';
import { ROOT_OBJECT_ID } from './constants';
import { InstanceEvent } from './instance';
import { ObjectData, ObjectMessage, ObjectOperation } from './objectmessage';
import { Path } from './path';
import { PathEvent } from './pathobjectsubscriptionregister';
import { ObjectsOperationSource, RealtimeObject } from './realtimeobject';
import type { LiveMap } from './livemap';

export enum LiveObjectSubscriptionEvent {
  updated = 'updated',
}

export interface LiveObjectData {
  data: any;
}

export interface LiveObjectUpdate {
  _type: 'LiveMapUpdate' | 'LiveCounterUpdate';
  /** Delta of the change */
  update: any;
  /** Object message that caused an update to an object, if available */
  objectMessage?: ObjectMessage;
  /** Indicates whether this update is a result of a tombstone (delete) operation. */
  tombstone?: boolean;
}

export interface LiveObjectUpdateNoop {
  // have optional update field with undefined type so it's not possible to create a noop object with a meaningful update property.
  update?: undefined;
  noop: true;
}

export abstract class LiveObject<
  TData extends LiveObjectData = LiveObjectData,
  TUpdate extends LiveObjectUpdate = LiveObjectUpdate,
> {
  protected _client: BaseClient;
  protected _subscriptions: EventEmitter;
  protected _objectId: string;
  /**
   * Represents an aggregated value for an object, which combines the initial value for an object from the create operation,
   * and all object operations applied to the object.
   */
  protected _dataRef: TData;
  protected _siteTimeserials: Record<string, string>;
  protected _createOperationIsMerged: boolean;
  private _tombstone: boolean;
  private _tombstonedAt: number | undefined;
  /**
   * Track parent references - which LiveMap objects contain this object and at which keys.
   * Multiple parents can reference the same object, so we use a Map of parent to Set of keys for efficient lookups.
   */
  private _parentReferences: Map<LiveMap, Set<string>>;

  protected constructor(
    protected _realtimeObject: RealtimeObject,
    objectId: string,
  ) {
    this._client = this._realtimeObject.getClient();
    this._subscriptions = new this._client.EventEmitter(this._client.logger);
    this._objectId = objectId;
    this._dataRef = this._getZeroValueData();
    // use empty map of serials by default, so any future operation can be applied to this object
    this._siteTimeserials = {};
    this._createOperationIsMerged = false;
    this._tombstone = false;
    this._parentReferences = new Map<LiveMap, Set<string>>();
  }

  subscribe(listener: EventCallback<InstanceEvent>): Subscription {
    this._subscriptions.on(LiveObjectSubscriptionEvent.updated, listener);

    const unsubscribe = () => {
      this._subscriptions.off(LiveObjectSubscriptionEvent.updated, listener);
    };

    return { unsubscribe };
  }

  /**
   * @internal
   */
  getObjectId(): string {
    return this._objectId;
  }

  /**
   * Emits the {@link LiveObjectSubscriptionEvent.updated} event with provided update object if it isn't a noop.
   * Also notifies the path object subscriptions about path-based events.
   *
   * @internal
   */
  notifyUpdated(update: TUpdate | LiveObjectUpdateNoop): void {
    if (this._isNoopUpdate(update)) {
      // do not emit update events for noop updates
      return;
    }

    this._notifyInstanceSubscriptions(update);
    this._notifyPathSubscriptions(update);

    if (update.tombstone) {
      // deregister all listeners if update was a result of a tombstone operation
      this._subscriptions.off();
    }
  }

  /**
   * Clears the object's data, cancels any buffered operations and sets the tombstone flag to `true`.
   * The root object can never be tombstoned (RTLO4e10); such attempts return a noop update.
   *
   * @internal
   */
  tombstone(objectMessage: ObjectMessage): TUpdate | LiveObjectUpdateNoop {
    // RTLO4e10 - the root object must always exist in the ObjectsPool (RTO3b); the realtime
    // system never publishes an OBJECT_DELETE operation or a tombstoned object state for it,
    // so an attempt to tombstone it indicates a faulty message. log a warning and skip it
    if (this.getObjectId() === ROOT_OBJECT_ID) {
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MAJOR,
        'LiveObject.tombstone()',
        `attempt to tombstone the root object was rejected; serial=${objectMessage.serial}, siteCode=${objectMessage.siteCode}, message id: ${objectMessage.id}`,
      );
      return { noop: true };
    }

    this._tombstone = true; // RTLO4e2
    this._tombstonedAt = this._calculateTombstonedAt(
      objectMessage.serialTimestamp,
      'LiveObject.tombstone()',
      `objectId=${this.getObjectId()}`,
    ); // RTLO4e3
    // RTLO4e5 - compute the diff between the pre-clear data and the zero value. Per the RTLC14c /
    // RTLM22c tombstone carve-out, that noop exception "must not be applied when the diff is
    // computed for a tombstone": tombstoning an already-empty object yields a noop diff, but the
    // resulting tombstone update (RTLO4b4e) must still be delivered so it drives the RTLO4b4c3c
    // listener teardown. So when the diff collapses to a noop, synthesize the typed no-change
    // update instead, leaving a real (non-noop) update to stamp.
    const diff = this.clearData(); // RTLO4e4
    const update: TUpdate = this._isNoopUpdate(diff) ? this._createNoChangeUpdate() : diff;
    update.objectMessage = objectMessage; // RTLO4e7
    update.tombstone = true; // RTLO4e6

    return update; // RTLO4e8
  }

  /**
   * @internal
   */
  isTombstoned(): boolean {
    return this._tombstone;
  }

  /**
   * @internal
   */
  tombstonedAt(): number | undefined {
    return this._tombstonedAt;
  }

  /**
   * @internal
   */
  clearData(): TUpdate | LiveObjectUpdateNoop {
    const previousDataRef = this._dataRef;
    this._dataRef = this._getZeroValueData();
    return this._updateFromDataDiff(previousDataRef, this._dataRef);
  }

  /**
   * Add a parent reference indicating that this object is referenced by the given parent LiveMap at the specified key.
   *
   * @internal
   */
  addParentReference(parent: LiveMap, key: string): void {
    const keys = this._parentReferences.get(parent);

    if (keys) {
      keys.add(key);
    } else {
      this._parentReferences.set(parent, new Set([key]));
    }
  }

  /**
   * Remove a parent reference indicating that this object is no longer referenced by the given parent LiveMap at the specified key.
   *
   * @internal
   */
  removeParentReference(parent: LiveMap, key: string): void {
    const keys = this._parentReferences.get(parent);

    if (keys) {
      keys.delete(key);
      // If no more keys for this parent, remove the parent entry entirely
      if (keys.size === 0) {
        this._parentReferences.delete(parent);
      }
    }
  }

  /**
   * Clears all parent references for this object.
   *
   * @internal
   */
  clearParentReferences(): void {
    this._parentReferences.clear();
  }

  /**
   * Calculates and returns all possible paths to this object from the root object by traversing up the parent hierarchy.
   * Uses iterative DFS with an explicit stack. Each path is represented as an array of keys from root to this object.
   *
   * @internal
   */
  getFullPaths(): Path[] {
    const paths: Path[] = [];

    const stack: { obj: LiveObject; currentPath: Path; visited: Set<LiveObject> }[] = [
      { obj: this, currentPath: [], visited: new Set() },
    ];

    while (stack.length > 0) {
      const { obj, currentPath, visited } = stack.pop()!;

      // Check for cyclic references
      if (visited.has(obj)) {
        continue; // Skip this path to prevent infinite loops
      }

      // Create new visited set for this path
      const newVisited = new Set(visited);
      newVisited.add(obj);

      if (obj.getObjectId() === ROOT_OBJECT_ID) {
        // Reached the root object, add the current path
        paths.push(currentPath);
        continue;
      }

      // Otherwise, add work items for each parent-key combination to the stack
      for (const [parent, keys] of obj._parentReferences) {
        for (const key of keys) {
          stack.push({
            obj: parent,
            currentPath: [key, ...currentPath],
            visited: newVisited,
          });
        }
      }
    }

    return paths;
  }

  /**
   * Returns true if the given serial indicates that the operation to which it belongs should be applied to the object.
   *
   * An operation should be applied if its serial is strictly greater than the serial in the `siteTimeserials` map for the same site.
   * If `siteTimeserials` map does not contain a serial for the same site, the operation should be applied.
   */
  protected _canApplyOperation(opSerial: string | undefined, opSiteCode: string | undefined): boolean {
    // RTLO4a3 - an operation with invalid serial values is not applied; log a warning and
    // skip it instead of throwing, so one malformed operation cannot abort the processing
    // of sibling operations in the same ProtocolMessage.
    if (!opSerial || !opSiteCode) {
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MAJOR,
        'LiveObject._canApplyOperation()',
        `object operation message has invalid serial values, skipping operation; serial=${opSerial}, siteCode=${opSiteCode}, objectId=${this.getObjectId()}`,
      );
      return false;
    }

    const siteSerial = this._siteTimeserials[opSiteCode];
    return !siteSerial || opSerial > siteSerial;
  }

  protected _applyObjectDelete(objectMessage: ObjectMessage): TUpdate | LiveObjectUpdateNoop {
    return this.tombstone(objectMessage);
  }

  /**
   * Calculate a tombstonedAt timestamp from the provided serialTimestamp,
   * falling back to the local clock if not available.
   *
   * @spec RTLO6
   */
  protected _calculateTombstonedAt(serialTimestamp: number | undefined, action: string, details?: string): number {
    if (serialTimestamp != null) {
      return serialTimestamp; // RTLO6a
    }

    // RTLO6b1
    this._client.Logger.logAction(
      this._client.logger,
      this._client.Logger.LOG_MINOR,
      action,
      `no "serialTimestamp" found for an operation, using local clock instead; ${details}`,
    );
    return Date.now(); // RTLO6b
  }

  private _notifyInstanceSubscriptions(update: TUpdate): void {
    const event: InstanceEvent = {
      // Do not expose object sync messages as they do not represent a single operation on an object
      message: update.objectMessage?.isOperationMessage() ? update.objectMessage : undefined,
    };
    this._subscriptions.emit(LiveObjectSubscriptionEvent.updated, event);
  }

  /**
   * Notifies path-based subscriptions about changes to this object.
   * For LiveMapUpdate events, each updated key also contributes a candidate
   * path one segment deeper than this object's own path.
   */
  private _notifyPathSubscriptions(update: TUpdate): void {
    const pathsToThis = this.getFullPaths();

    if (pathsToThis.length === 0) {
      // No paths to this object, skip notification
      return;
    }

    // Do not expose object sync messages as they do not represent a single operation on an object
    const operationObjectMessage = update.objectMessage?.isOperationMessage() ? update.objectMessage : undefined;

    // Call notifyPathEvent() once for each path-to-this. Since
    // notifyPathEvent() emits at most one event on each subscription, this
    // means that we emit at most one event per path-to-this.
    for (const pathToThis of pathsToThis) {
      const preferenceOrderedCandidatePaths: Path[] = [pathToThis];

      // For LiveMapUpdate, also add a candidate path per updated key. We insert these after
      // pathToThis so that notifyPathEvent() picks pathToThis in the case where a given subscription
      // covers multiple candidate paths (that is, we favour the shorter path).
      if (update._type === 'LiveMapUpdate') {
        const updatedKeys = Object.keys(update.update);

        for (const key of updatedKeys) {
          preferenceOrderedCandidatePaths.push([...pathToThis, key]);
        }
      }

      const pathEvent: PathEvent = {
        preferenceOrderedCandidatePaths,
        message: operationObjectMessage,
      };

      this._realtimeObject.getPathObjectSubscriptionRegister().notifyPathEvent(pathEvent);
    }
  }

  protected _isNoopUpdate(update: TUpdate | LiveObjectUpdateNoop): update is LiveObjectUpdateNoop {
    return (update as LiveObjectUpdateNoop).noop === true;
  }

  /**
   * Apply object operation message on this LiveObject.
   *
   * @returns `true` if the operation was applied successfully, `false` if it was skipped.
   * @spec RTLC7g, RTLM15g
   * @internal
   */
  abstract applyOperation(op: ObjectOperation<ObjectData>, msg: ObjectMessage, source: ObjectsOperationSource): boolean;
  /**
   * Overrides internal data for this LiveObject with object state from the given object message.
   * Provided object state should hold a valid data for current LiveObject, e.g. counter data for LiveCounter, map data for LiveMap.
   *
   * Object states are received during sync sequence, and sync sequence is a source of truth for the current state of the objects,
   * so we can use the data received from the sync sequence directly and override any data values or site serials this LiveObject has
   * without the need to merge them.
   *
   * Returns an update object that describes the changes applied based on the object's previous value.
   *
   * @internal
   */
  abstract overrideWithObjectState(objectMessage: ObjectMessage): TUpdate | LiveObjectUpdateNoop;
  /**
   * @internal
   */
  abstract onGCInterval(): void;

  protected abstract _getZeroValueData(): TData;
  /**
   * Calculate the update object based on the current LiveObject data and incoming new data.
   *
   * Returns a noop update when the data is unchanged (RTLC14c / RTLM22c).
   */
  protected abstract _updateFromDataDiff(prevDataRef: TData, newDataRef: TData): TUpdate | LiveObjectUpdateNoop;
  /**
   * Returns a typed update that represents "no change" (e.g. a counter delta of 0, or an empty
   * map key-diff), used by {@link LiveObject.tombstone} to synthesize a deliverable tombstone
   * update when the tombstone diff itself collapsed to a noop per the RTLC14c / RTLM22c carve-out.
   */
  protected abstract _createNoChangeUpdate(): TUpdate;
  /**
   * Merges the initial data from the create operation into the LiveObject.
   *
   * Client SDKs do not need to keep around the object operation that created the object,
   * so we can merge the initial data the first time we receive it for the object,
   * and work with aggregated value after that.
   *
   * This saves us from needing to merge the initial value with operations applied to
   * the object every time the object is read.
   */
  protected abstract _mergeInitialDataFromCreateOperation(
    objectOperation: ObjectOperation<ObjectData>,
    msg: ObjectMessage,
  ): TUpdate | LiveObjectUpdateNoop;
}
