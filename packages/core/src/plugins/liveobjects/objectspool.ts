import type BaseClient from 'common/lib/client/baseclient';
import { ROOT_OBJECT_ID } from './constants';
import { DEFAULTS } from './defaults';
import { LiveCounter } from './livecounter';
import { LiveMap } from './livemap';
import { LiveObject } from './liveobject';
import { ObjectId } from './objectid';
import { RealtimeObject } from './realtimeobject';

/**
 * @internal
 * @spec RTO3
 */
export class ObjectsPool {
  private _client: BaseClient;
  private _pool: Map<string, LiveObject>; // RTO3a
  private _gcInterval: ReturnType<typeof setInterval>;

  constructor(private _realtimeObject: RealtimeObject) {
    this._client = this._realtimeObject.getClient();
    this._pool = this._createInitialPool();
    this._gcInterval = setInterval(() => {
      this._onGCInterval();
    }, DEFAULTS.gcInterval);
    // call nodejs's Timeout.unref to not require Node.js event loop to remain active due to this interval. see https://nodejs.org/api/timers.html#timeoutunref
    this._gcInterval.unref?.();
  }

  get(objectId: string): LiveObject | undefined {
    return this._pool.get(objectId);
  }

  getRoot(): LiveMap {
    return this._pool.get(ROOT_OBJECT_ID) as LiveMap;
  }

  /**
   * Returns all objects in the pool as an iterable.
   * Used internally for operations that need to process all objects.
   */
  getAll(): IterableIterator<LiveObject> {
    return this._pool.values();
  }

  /**
   * Deletes objects from the pool for which object ids are not found in the provided array of ids.
   *
   * @spec RTO5c2 - remove objects whose ids were not received during the sync sequence
   * @spec RTO5c2a - the root object must never be removed (RTO3b), even if absent from the sync
   */
  deleteExtraObjectIds(objectIds: string[]): void {
    const poolObjectIds = [...this._pool.keys()];
    const extraObjectIds = poolObjectIds.filter((x) => !objectIds.includes(x) && x !== ROOT_OBJECT_ID);

    extraObjectIds.forEach((x) => this._pool.delete(x));
  }

  set(objectId: string, liveObject: LiveObject): void {
    this._pool.set(objectId, liveObject);
  }

  /**
   * Removes all objects but root from the pool and clears the data for root.
   * Does not create a new root object, so the reference to the root object remains the same.
   */
  resetToInitialPool(emitUpdateEvents: boolean): void {
    // clear the pool first and keep the root object
    const root = this.getRoot();
    this._pool.clear();
    this._pool.set(root.getObjectId(), root);

    // clear the data, this will only clear the root object
    this.clearObjectsData(emitUpdateEvents);
  }

  /**
   * Clears the data stored for all objects in the pool.
   */
  clearObjectsData(emitUpdateEvents: boolean): void {
    for (const object of this._pool.values()) {
      const update = object.clearData();
      if (emitUpdateEvents) {
        object.notifyUpdated(update);
      }
    }
  }

  /** @spec RTO6 */
  createZeroValueObjectIfNotExists(objectId: string): LiveObject {
    const existingObject = this.get(objectId);
    if (existingObject) {
      return existingObject; // RTO6a
    }

    const parsedObjectId = ObjectId.fromString(this._client, objectId); // RTO6b
    let zeroValueObject: LiveObject;
    switch (parsedObjectId.type) {
      case 'map': {
        zeroValueObject = LiveMap.zeroValue(this._realtimeObject, objectId); // RTO6b2
        break;
      }

      case 'counter':
        zeroValueObject = LiveCounter.zeroValue(this._realtimeObject, objectId); // RTO6b3
        break;
    }

    this.set(objectId, zeroValueObject);
    return zeroValueObject;
  }

  private _createInitialPool(): Map<string, LiveObject> {
    const pool = new Map<string, LiveObject>();
    // RTO3b
    const root = LiveMap.zeroValue(this._realtimeObject, ROOT_OBJECT_ID);
    pool.set(root.getObjectId(), root);
    return pool;
  }

  private _onGCInterval(): void {
    const toDelete: string[] = [];
    for (const [objectId, obj] of this._pool.entries()) {
      // tombstoned objects should be removed from the pool if they have been tombstoned for longer than grace period.
      // by removing them from the local pool, LiveObjects plugin no longer keeps a reference to those objects, allowing JS's
      // Garbage Collection to eventually free the memory for those objects, provided the user no longer references them either.
      // RTO10c1b1 - the root object must never be removed from the pool (RTO3b). it can never
      // become tombstoned per RTLO4e10, so this exclusion is an additional safeguard
      if (
        objectId !== ROOT_OBJECT_ID &&
        obj.isTombstoned() &&
        Date.now() - obj.tombstonedAt()! >= this._realtimeObject.gcGracePeriod
      ) {
        toDelete.push(objectId);
        continue;
      }

      obj.onGCInterval();
    }

    toDelete.forEach((x) => this._pool.delete(x));
  }
}
