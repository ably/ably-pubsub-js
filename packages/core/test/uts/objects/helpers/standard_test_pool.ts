/**
 * Standard test pool and helpers for LiveObjects UTS tests.
 *
 * Source: uts/objects/helpers/standard_test_pool.md
 *
 * Provides builder functions for constructing protocol/object messages,
 * a standard fixture tree (STANDARD_POOL_OBJECTS), setupSyncedChannel
 * for mock WebSocket tests, buildObjectMessageWithState for wrapping
 * state objects into ObjectMessages, and buildPublicObjectMessage for
 * constructing public API ObjectMessages with string-based actions.
 */

import { MockWebSocket } from '../../mock_websocket';
import { Ably, installMockWebSocket, trackClient, flushAsync } from '../../helpers';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';

// --- Protocol message action constants ---

export const PM_ACTION = {
  ACK: 1,
  CONNECTED: 4,
  ERROR: 9,
  ATTACH: 10,
  ATTACHED: 11,
  DETACH: 12,
  DETACHED: 13,
  OBJECT: 19,
  OBJECT_SYNC: 20,
} as const;

export const HAS_OBJECTS = 1 << 7; // 128

// --- Object operation action constants (numeric wire values) ---

export const OBJ_OP = {
  MAP_CREATE: 0,
  MAP_SET: 1,
  MAP_REMOVE: 2,
  COUNTER_CREATE: 3,
  COUNTER_INC: 4,
  OBJECT_DELETE: 5,
  MAP_CLEAR: 6,
} as const;

// LWW semantics (numeric)
export const MAP_SEMANTICS_LWW = 0;

/**
 * Canonical constants (spec: helpers/standard_test_pool.md "Canonical Constants").
 * Tests that reuse the apply-on-ACK serial/siteCode must reference these — never
 * hardcode a literal. The ack serial must sort AFTER the standard pool's "t:0"
 * entry timeserials under the string LWW comparison (RTLM9).
 */
export const SITE_CODE = 'test-site';

/**
 * The baseline timeserial every standard-pool entry/object is seeded with. Every synthetic
 * serial below is chosen relative to this value under the lexicographic string LWW comparison
 * (RTLM9e). The pool builder spells it out literally as 't:0' for readability.
 */
export const POOL_SERIAL = 't:0';

export function ackSerial(msgSerial: number, i: number): string {
  return `t:${msgSerial + 1}:${i}`;
}

/**
 * Serial for a REMOTE inbound MAP_SET / MAP_REMOVE on an EXISTING pool entry (siteCode 'remote').
 * Sorts AFTER POOL_SERIAL so it wins the per-entry LWW comparison (RTLM9e) — a bare number like
 * '99' sorts BEFORE 't:0' ('9' < 't') and would be rejected as stale. 0-based: remoteSerial(0) === 't:1'.
 * (Counter increments and other object-level ops from a fresh siteCode compare per-site, not per-entry,
 *  so they apply regardless of serial value and need NOT use this helper.)
 */
export function remoteSerial(i: number): string {
  return `t:${i + 1}`;
}

/**
 * A serial that is NOT an ackSerial (so it escapes the RTO9a3 apply-on-ACK echo dedup) yet sorts
 * BELOW the first ackSerial (ackSerial(0, 0) === 't:1:0'), while still after POOL_SERIAL. Used by
 * RTO20f to prove a LOCAL apply-on-ACK left siteTimeserials untouched (RTLC7c): had the LOCAL apply
 * wrongly recorded siteTimeserials[SITE_CODE] = 't:1:0', this lower serial would be rejected by the
 * per-site newness check. 0-based: belowAckSerial(9) === 't:0:9'.
 */
export function belowAckSerial(i: number): string {
  return `t:0:${i}`;
}

// --- Protocol message builders ---

export function buildObjectSyncMessage(channel: string, channelSerial: string, objectMessages: any[]) {
  return {
    action: PM_ACTION.OBJECT_SYNC,
    channel,
    channelSerial,
    state: objectMessages,
  };
}

export function buildObjectMessage(channel: string, objectMessages: any[]) {
  return {
    action: PM_ACTION.OBJECT,
    channel,
    state: objectMessages,
  };
}

export function buildAckMessage(msgSerial: number, serials: string[]) {
  return {
    action: PM_ACTION.ACK,
    msgSerial,
    count: 1,
    res: [{ serials }],
  };
}

// --- ObjectMessage builders (operations) ---

export function buildCounterInc(objectId: string, amount: number, serial: string, siteCode: string) {
  return {
    serial,
    siteCode,
    operation: {
      action: OBJ_OP.COUNTER_INC,
      objectId,
      counterInc: { number: amount },
    },
  };
}

export function buildMapSet(objectId: string, key: string, value: any, serial: string, siteCode: string) {
  return {
    serial,
    siteCode,
    operation: {
      action: OBJ_OP.MAP_SET,
      objectId,
      mapSet: { key, value },
    },
  };
}

export function buildMapRemove(
  objectId: string,
  key: string,
  serial: string,
  siteCode: string,
  serialTimestamp?: number,
) {
  return {
    serial,
    siteCode,
    ...(serialTimestamp != null ? { serialTimestamp } : {}),
    operation: {
      action: OBJ_OP.MAP_REMOVE,
      objectId,
      mapRemove: { key },
    },
  };
}

export function buildMapClear(objectId: string, serial: string, siteCode: string) {
  return {
    serial,
    siteCode,
    operation: {
      action: OBJ_OP.MAP_CLEAR,
      objectId,
      mapClear: {},
    },
  };
}

export function buildObjectDelete(objectId: string, serial: string, siteCode: string, serialTimestamp?: number) {
  return {
    serial,
    siteCode,
    ...(serialTimestamp != null ? { serialTimestamp } : {}),
    operation: {
      action: OBJ_OP.OBJECT_DELETE,
      objectId,
      objectDelete: {},
    },
  };
}

export function buildCounterCreate(
  objectId: string,
  counterCreate: { count: number },
  serial: string,
  siteCode: string,
) {
  return {
    serial,
    siteCode,
    operation: {
      action: OBJ_OP.COUNTER_CREATE,
      objectId,
      counterCreate,
    },
  };
}

export function buildMapCreate(
  objectId: string,
  mapCreate: { semantics: number; entries: Record<string, any> },
  serial: string,
  siteCode: string,
) {
  return {
    serial,
    siteCode,
    operation: {
      action: OBJ_OP.MAP_CREATE,
      objectId,
      mapCreate,
    },
  };
}

// --- ObjectMessage builder (state — for OBJECT_SYNC) ---

export function buildObjectState(
  objectId: string,
  siteTimeserials: Record<string, string>,
  opts: {
    map?: { semantics: number; entries: Record<string, any>; clearTimeserial?: string };
    counter?: { count: number };
    tombstone?: boolean;
    createOp?: any;
  },
) {
  const state: any = {
    objectId,
    siteTimeserials,
    tombstone: opts.tombstone === true,
  };
  if (opts.map != null) state.map = opts.map;
  if (opts.counter != null) state.counter = opts.counter;
  if (opts.createOp != null) state.createOp = opts.createOp;
  return { object: state };
}

// --- ObjectMessage wrapper (wraps a plain state into an ObjectMessage) ---

export function buildObjectMessageWithState(objectState: any) {
  return { object: objectState };
}

// --- Public API ObjectMessage builder ---

const OBJ_OP_ACTION_STRINGS: Record<number, string> = {
  [OBJ_OP.MAP_CREATE]: 'map.create',
  [OBJ_OP.MAP_SET]: 'map.set',
  [OBJ_OP.MAP_REMOVE]: 'map.remove',
  [OBJ_OP.COUNTER_CREATE]: 'counter.create',
  [OBJ_OP.COUNTER_INC]: 'counter.inc',
  [OBJ_OP.OBJECT_DELETE]: 'object.delete',
  [OBJ_OP.MAP_CLEAR]: 'map.clear',
};

export function buildPublicObjectMessage(objectMessage: any, channelName: string) {
  const op = objectMessage.operation;
  const publicOp: any = {
    action: OBJ_OP_ACTION_STRINGS[op.action],
    objectId: op.objectId,
  };
  if (op.mapSet) publicOp.mapSet = op.mapSet;
  if (op.mapRemove) publicOp.mapRemove = op.mapRemove;
  if (op.counterInc) publicOp.counterInc = op.counterInc;
  if (op.objectDelete) publicOp.objectDelete = op.objectDelete;
  if (op.mapClear) publicOp.mapClear = op.mapClear;
  if (op.mapCreate) publicOp.mapCreate = op.mapCreate;
  if (op.counterCreate) publicOp.counterCreate = op.counterCreate;

  return {
    id: objectMessage.id,
    clientId: objectMessage.clientId,
    connectionId: objectMessage.connectionId,
    timestamp: objectMessage.timestamp,
    channel: channelName,
    serial: objectMessage.serial,
    serialTimestamp: objectMessage.serialTimestamp,
    siteCode: objectMessage.siteCode,
    extras: objectMessage.extras,
    operation: publicOp,
  };
}

// --- Standard test pool fixtures ---

export const STANDARD_POOL_OBJECTS = [
  buildObjectState(
    'root',
    { aaa: 't:0' },
    {
      map: {
        semantics: MAP_SEMANTICS_LWW,
        entries: {
          name: { data: { string: 'Alice' }, timeserial: 't:0' },
          age: { data: { number: 30 }, timeserial: 't:0' },
          active: { data: { boolean: true }, timeserial: 't:0' },
          score: { data: { objectId: 'counter:score@1000' }, timeserial: 't:0' },
          profile: { data: { objectId: 'map:profile@1000' }, timeserial: 't:0' },
          data: { data: { json: JSON.stringify({ tags: ['a', 'b'] }) }, timeserial: 't:0' },
          avatar: { data: { bytes: 'AQID' }, timeserial: 't:0' },
        },
      },
      createOp: {
        action: OBJ_OP.MAP_CREATE,
        objectId: 'root',
        mapCreate: { semantics: MAP_SEMANTICS_LWW, entries: {} },
      },
    },
  ),
  buildObjectState(
    'counter:score@1000',
    { aaa: 't:0' },
    {
      counter: { count: 0 },
      createOp: {
        action: OBJ_OP.COUNTER_CREATE,
        objectId: 'counter:score@1000',
        counterCreate: { count: 100 },
      },
    },
  ),
  buildObjectState(
    'map:profile@1000',
    { aaa: 't:0' },
    {
      map: {
        semantics: MAP_SEMANTICS_LWW,
        entries: {
          email: { data: { string: 'alice@example.com' }, timeserial: 't:0' },
          nested_counter: { data: { objectId: 'counter:nested@1000' }, timeserial: 't:0' },
          prefs: { data: { objectId: 'map:prefs@1000' }, timeserial: 't:0' },
        },
      },
      createOp: {
        action: OBJ_OP.MAP_CREATE,
        objectId: 'map:profile@1000',
        mapCreate: { semantics: MAP_SEMANTICS_LWW, entries: {} },
      },
    },
  ),
  buildObjectState(
    'counter:nested@1000',
    { aaa: 't:0' },
    {
      counter: { count: 0 },
      createOp: {
        action: OBJ_OP.COUNTER_CREATE,
        objectId: 'counter:nested@1000',
        counterCreate: { count: 5 },
      },
    },
  ),
  buildObjectState(
    'map:prefs@1000',
    { aaa: 't:0' },
    {
      map: {
        semantics: MAP_SEMANTICS_LWW,
        entries: {
          theme: { data: { string: 'dark' }, timeserial: 't:0' },
        },
      },
      createOp: {
        action: OBJ_OP.MAP_CREATE,
        objectId: 'map:prefs@1000',
        mapCreate: { semantics: MAP_SEMANTICS_LWW, entries: {} },
      },
    },
  ),
];

// --- Synced channel setup ---

export interface SyncedChannelResult {
  client: InstanceType<typeof Ably.Realtime>;
  channel: any;
  root: any;
  mockWs: MockWebSocket;
}

export async function setupSyncedChannel(channelName: string): Promise<SyncedChannelResult> {
  const mockWs = new MockWebSocket({
    onConnectionAttempt: (conn) => {
      mockWs.active_connection = conn;
      conn.respond_with_connected({
        action: PM_ACTION.CONNECTED,
        connectionId: 'conn-1',
        connectionDetails: {
          connectionKey: 'conn-key-1',
          connectionStateTtl: 120000,
          maxIdleInterval: 15000,
          maxMessageSize: 65536,
          serverId: 'test-server',
          clientId: null,
          siteCode: SITE_CODE,
          objectsGCGracePeriod: 86400000,
        },
      });
    },
    onMessageFromClient: (msg: any) => {
      if (msg.action === PM_ACTION.ATTACH) {
        mockWs.active_connection!.send_to_client({
          action: PM_ACTION.ATTACHED,
          channel: msg.channel,
          channelSerial: 'sync1:',
          flags: HAS_OBJECTS,
        });
        mockWs.active_connection!.send_to_client(buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS));
      } else if (msg.action === PM_ACTION.OBJECT) {
        const serials = (msg.state || []).map((_: any, i: number) => ackSerial(msg.msgSerial, i));
        mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
      } else if (msg.action === PM_ACTION.DETACH) {
        mockWs.active_connection!.send_to_client({
          action: PM_ACTION.DETACHED,
          channel: msg.channel,
        });
      }
    },
  });
  installMockWebSocket(mockWs.constructorFn);

  const client = new Ably.Realtime({
    key: 'appId.keyId:keySecret',
    autoConnect: false,
    useBinaryProtocol: false,
    plugins: { LiveObjects: LiveObjectsPlugin },
  });
  trackClient(client);
  client.connect();
  await new Promise<void>((resolve) => client.connection.once('connected', resolve));

  const channel = client.channels.get(channelName, { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
  const root = await channel.object.get();

  return { client, channel, root, mockWs };
}

export async function setupSyncedChannelNoAck(channelName: string): Promise<SyncedChannelResult> {
  const mockWs = new MockWebSocket({
    onConnectionAttempt: (conn) => {
      mockWs.active_connection = conn;
      conn.respond_with_connected({
        action: PM_ACTION.CONNECTED,
        connectionId: 'conn-1',
        connectionDetails: {
          connectionKey: 'conn-key-1',
          connectionStateTtl: 120000,
          maxIdleInterval: 15000,
          maxMessageSize: 65536,
          serverId: 'test-server',
          clientId: null,
          siteCode: SITE_CODE,
          objectsGCGracePeriod: 86400000,
        },
      });
    },
    onMessageFromClient: (msg: any) => {
      if (msg.action === PM_ACTION.ATTACH) {
        mockWs.active_connection!.send_to_client({
          action: PM_ACTION.ATTACHED,
          channel: msg.channel,
          channelSerial: 'sync1:',
          flags: HAS_OBJECTS,
        });
        mockWs.active_connection!.send_to_client(buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS));
      } else if (msg.action === PM_ACTION.DETACH) {
        mockWs.active_connection!.send_to_client({
          action: PM_ACTION.DETACHED,
          channel: msg.channel,
        });
      }
    },
  });
  installMockWebSocket(mockWs.constructorFn);

  const client = new Ably.Realtime({
    key: 'appId.keyId:keySecret',
    autoConnect: false,
    useBinaryProtocol: false,
    plugins: { LiveObjects: LiveObjectsPlugin },
  });
  trackClient(client);
  client.connect();
  await new Promise<void>((resolve) => client.connection.once('connected', resolve));

  const channel = client.channels.get(channelName, { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
  const root = await channel.object.get();

  return { client, channel, root, mockWs };
}

/**
 * Intercepts `notifyUpdated` on an internal LiveObject to capture the update diff passed during
 * apply/sync paths (applyOperation returns only a boolean), forwarding to the original.
 * Call `restore()` when done so the patch does not outlive the assertion it serves.
 */
export function captureNotifyUpdated(obj: any): { getUpdate: () => any; restore: () => void } {
  let capturedUpdate: any = undefined;
  const origNotify = obj.notifyUpdated.bind(obj);
  obj.notifyUpdated = (update: any) => {
    capturedUpdate = update;
    origNotify(update);
  };
  return {
    getUpdate: () => capturedUpdate,
    restore: () => {
      obj.notifyUpdated = origNotify;
    },
  };
}
