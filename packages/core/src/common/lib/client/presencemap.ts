import * as Utils from '../util/utils';
import EventEmitter from '../util/eventemitter';
import Logger from '../util/logger';
import PresenceMessage from '../types/presencemessage';

import type RealtimePresence from './realtimepresence';

type compFn = (item: PresenceMessage, existing: PresenceMessage) => boolean;

export interface RealtimePresenceParams {
  waitForSync?: boolean;
  clientId?: string;
  connectionId?: string;
}

function newerThan(item: PresenceMessage, existing: PresenceMessage): boolean {
  /* RTP2b1: if either is synthesised, compare by timestamp */
  if (item.isSynthesized() || existing.isSynthesized()) {
    // RTP2b1a: if equal, prefer the newly-arrived one
    return (item.timestamp as number) >= (existing.timestamp as number);
  }

  /* RTP2b2 */
  const itemOrderings = item.parseId(),
    existingOrderings = existing.parseId();
  if (itemOrderings.msgSerial === existingOrderings.msgSerial) {
    return itemOrderings.index > existingOrderings.index;
  } else {
    return itemOrderings.msgSerial > existingOrderings.msgSerial;
  }
}

export class PresenceMap extends EventEmitter {
  map: Record<string, PresenceMessage>;
  residualMembers: Record<string, PresenceMessage> | null;
  syncInProgress: boolean;
  presence: RealtimePresence;
  memberKey: (item: PresenceMessage) => string;
  newerThan: compFn;

  constructor(presence: RealtimePresence, memberKey: (item: PresenceMessage) => string, newer: compFn = newerThan) {
    super(presence.logger);
    this.presence = presence;
    this.map = Object.create(null);
    this.syncInProgress = false;
    this.residualMembers = null;
    this.memberKey = memberKey;
    this.newerThan = newer;
  }

  get(key: string) {
    return this.map[key];
  }

  getClient(clientId: string) {
    const map = this.map,
      result = [];
    for (const key in map) {
      const item = map[key];
      if (item.clientId == clientId && item.action != 'absent') result.push(item);
    }
    return result;
  }

  list(params: RealtimePresenceParams) {
    const map = this.map,
      clientId = params && params.clientId,
      connectionId = params && params.connectionId,
      result = [];

    for (const key in map) {
      const item = map[key];
      if (item.action === 'absent') continue;
      if (clientId && clientId != item.clientId) continue;
      if (connectionId && connectionId != item.connectionId) continue;
      result.push(item);
    }
    return result;
  }

  put(item: PresenceMessage) {
    if (item.action === 'enter' || item.action === 'update') {
      item = PresenceMessage.fromValues(item);
      item.action = 'present';
    }
    const map = this.map,
      key = this.memberKey(item);
    /* we've seen this member, so do not remove it at the end of sync */
    if (this.residualMembers) delete this.residualMembers[key];

    /* compare the timestamp of the new item with any existing member (or ABSENT witness) */
    const existingItem = map[key];
    if (existingItem && !this.newerThan(item, existingItem)) {
      return false;
    }
    map[key] = item;
    return true;
  }

  values() {
    const map = this.map,
      result = [];
    for (const key in map) {
      const item = map[key];
      if (item.action != 'absent') result.push(item);
    }
    return result;
  }

  remove(item: PresenceMessage) {
    const map = this.map,
      key = this.memberKey(item);
    const existingItem = map[key];

    if (existingItem && !this.newerThan(item, existingItem)) {
      return false;
    }

    /* RTP2f */
    if (this.syncInProgress) {
      item = PresenceMessage.fromValues(item);
      item.action = 'absent';
      map[key] = item;
    } else {
      delete map[key];
    }

    return !!existingItem;
  }

  startSync() {
    const map = this.map,
      syncInProgress = this.syncInProgress;
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'PresenceMap.startSync()',
      'channel = ' + this.presence.channel.name + '; syncInProgress = ' + syncInProgress,
    );
    /* RTP18a: a new sync replaces any sync already in progress. Exclude
     * tombstones that have already emitted their leave event. */
    this.residualMembers = Object.create(null) as Record<string, PresenceMessage>;
    for (const memberKey in map) {
      if (map[memberKey].action !== 'absent') {
        this.residualMembers[memberKey] = map[memberKey];
      }
    }
    this.setInProgress(true);
  }

  endSync() {
    const map = this.map,
      syncInProgress = this.syncInProgress;
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'PresenceMap.endSync()',
      'channel = ' + this.presence.channel.name + '; syncInProgress = ' + syncInProgress,
    );
    if (syncInProgress) {
      /* we can now strip out the ABSENT members, as we have
       * received all of the out-of-order sync messages */
      for (const memberKey in map) {
        const entry = map[memberKey];
        if (entry.action === 'absent') {
          delete map[memberKey];
        }
      }
      /* any members that were present at the start of the sync,
       * and have not been seen in sync, can be removed, and leave events emitted */
      this.presence._synthesizeLeaves(Utils.valuesArray(this.residualMembers as Record<string, PresenceMessage>));
      for (const memberKey in this.residualMembers) {
        delete map[memberKey];
      }
      this.residualMembers = null;

      /* finish, notifying any waiters */
      this.setInProgress(false);
    }
    this.emit('sync');
  }

  async waitSync(): Promise<void> {
    const syncInProgress = this.syncInProgress;
    Logger.logAction(
      this.logger,
      Logger.LOG_MINOR,
      'PresenceMap.waitSync()',
      'channel = ' + this.presence.channel.name + '; syncInProgress = ' + syncInProgress,
    );
    if (!syncInProgress) {
      return;
    }

    await this.once('sync');
  }

  clear() {
    this.map = {};
    this.setInProgress(false);
    this.residualMembers = null;
  }

  setInProgress(inProgress: boolean) {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'PresenceMap.setInProgress()', 'inProgress = ' + inProgress);
    this.syncInProgress = inProgress;
    this.presence.syncComplete = !inProgress;
  }
}
