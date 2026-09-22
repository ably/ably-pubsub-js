import type BaseClient from 'common/lib/client/baseclient';
import type RealtimeChannel from 'common/lib/client/realtimechannel';
import { ObjectMessage } from './objectmessage';
import { RealtimeObject } from './realtimeobject';

/**
 * @internal
 */
export class SyncObjectsPool {
  private _client: BaseClient;
  private _channel: RealtimeChannel;
  /** Used to accumulate object state during a sync sequence, keyed by object ID */
  private _pool: Map<string, ObjectMessage>;

  constructor(private _realtimeObject: RealtimeObject) {
    this._client = this._realtimeObject.getClient();
    this._channel = this._realtimeObject.getChannel();
    this._pool = new Map<string, ObjectMessage>();
  }

  entries() {
    return this._pool.entries();
  }

  size(): number {
    return this._pool.size;
  }

  isEmpty(): boolean {
    return this._pool.size === 0;
  }

  clear(): void {
    this._pool.clear();
  }

  /** @spec RTO5f */
  applyObjectSyncMessages(objectMessages: ObjectMessage[]): void {
    for (const objectMessage of objectMessages) {
      if (!objectMessage.object) {
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MAJOR,
          'SyncObjectsPool.applyObjectSyncMessages()',
          `received OBJECT_SYNC message without 'object' field, skipping message; message id: ${objectMessage.id}, channel: ${this._channel.name}`,
        );
        continue;
      }

      const objectState = objectMessage.object;

      if (!objectState.counter && !objectState.map) {
        // RTO5f3
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MAJOR,
          'SyncObjectsPool.applyObjectSyncMessages()',
          `received OBJECT_SYNC message with unsupported object type, expected 'counter' or 'map' to be present, skipping message; message id: ${objectMessage.id}, channel: ${this._channel.name}`,
        );
        continue;
      }

      const objectId = objectState.objectId;
      const existingEntry = this._pool.get(objectId);

      if (!existingEntry) {
        // RTO5f1 - no entry with this objectId exists yet, store it
        this._pool.set(objectId, objectMessage);
        continue;
      }

      // RTO5f2 - an object is split across multiple sync messages, merge the new state with the existing entry in the pool based on the object type
      if (objectState.counter) {
        // RTO5f2b - counter objects have a bounded size and should never be split
        // across multiple sync messages. Skip the unexpected partial state.
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_ERROR,
          'SyncObjectsPool.applyObjectSyncMessages()',
          `received partial OBJECT_SYNC state for a counter object, skipping message; object id: ${objectId}, message id: ${objectMessage.id}, channel: ${this._channel.name}`,
        );
        continue;
      }

      if (objectState.map) {
        // RTO5f2a
        this._mergeMapSyncState(existingEntry, objectMessage);
        continue;
      }
    }
  }

  /**
   * Merges map entries from a partial sync message into an existing entry in the pool.
   * @spec RTO5f2a
   */
  private _mergeMapSyncState(existingEntry: ObjectMessage, newObjectMessage: ObjectMessage): void {
    const existingObjectState = existingEntry.object!;
    const newObjectState = newObjectMessage.object!;

    if (newObjectState.tombstone) {
      // RTO5f2a1 - a tombstone flag on any partial message takes precedence over previously accumulated entries
      this._pool.set(existingObjectState.objectId, newObjectMessage);
      return;
    }

    // Other fields on the ObjectState envelope (such as siteTimeserials) and the map envelope
    // (such as semantics) are identical across all partial messages for the same object,
    // so only the entries need to be merged.
    if (!existingObjectState.map!.entries) {
      existingObjectState.map!.entries = {};
    }

    // RTO5f2a2 - during partial sync, no two messages contain the same map key,
    // so entries can be merged directly without conflict checking.
    Object.assign(existingObjectState.map!.entries, newObjectState.map!.entries);
  }
}
