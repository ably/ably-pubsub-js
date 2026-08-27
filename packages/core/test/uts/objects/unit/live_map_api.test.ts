/**
 * UTS: LiveMap API Tests
 *
 * Spec points: RTLM5, RTLM10-RTLM13, RTLM20-RTLM21, RTLM24, RTLMV4, RTLCV4
 * Source: uts/objects/unit/live_map_api.md
 *
 * Tests LiveMap read operations (get, size, entries, keys) and
 * write operations (set, remove) including wire message format,
 * value type handling, and error cases.
 *
 * Deviations:
 * - RTLM20/set-invalid-values-table-0: 'symbol' test case uses Symbol('test').
 * - RTLM12 (keys): read via root.instance().keys() — RTLM12 is an internal LiveMap-level point.
 */

import { expect } from 'chai';
import { restoreAll } from '../../helpers';
import {
  setupSyncedChannel,
  buildAckMessage,
  buildObjectSyncMessage,
  STANDARD_POOL_OBJECTS,
  HAS_OBJECTS,
  PM_ACTION,
  OBJ_OP,
} from '../helpers/standard_test_pool';
import { MockWebSocket } from '../../mock_websocket';
import { Ably, installMockWebSocket, trackClient } from '../../helpers';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';

describe('uts/objects/unit/live_map_api', function () {
  afterEach(function () {
    restoreAll();
  });

  // ---------- RTLM5: get() ----------

  // UTS: objects/unit/RTLM5/get-string-value-0
  it('RTLM5 - get() returns resolved value from LiveMap', async function () {
    const { root } = await setupSyncedChannel('test-RTLM5-get');

    expect(root.get('name').value()).to.equal('Alice');
    expect(root.get('age').value()).to.equal(30);
    expect(root.get('active').value()).to.equal(true);
  });

  // UTS: objects/unit/RTLM5/get-nonexistent-key-0
  it('RTLM5 - get() returns undefined for non-existent key', async function () {
    const { root } = await setupSyncedChannel('test-RTLM5-nokey');

    expect(root.get('nonexistent').value()).to.be.undefined;
  });

  // UTS: objects/unit/RTLM5/get-objectid-reference-0
  it('RTLM5 - get() resolves objectId to LiveObject', async function () {
    const { root } = await setupSyncedChannel('test-RTLM5-objref');

    expect(root.get('score').value()).to.equal(100);
    expect(root.get('profile').get('email').value()).to.equal('alice@example.com');
  });

  // ---------- RTLM10: size() ----------

  // UTS: objects/unit/RTLM10/size-non-tombstoned-0
  it('RTLM10 - size() returns non-tombstoned entry count', async function () {
    const { root } = await setupSyncedChannel('test-RTLM10');

    expect(root.size()).to.equal(7);
  });

  // ---------- RTLM11: entries() ----------

  // UTS: objects/unit/RTLM11/entries-yields-pairs-0
  it('RTLM11 - entries() yields key-value pairs', async function () {
    const { root } = await setupSyncedChannel('test-RTLM11');

    const entries: string[] = [];
    for (const [key] of root.entries()) {
      entries.push(key as string);
    }

    expect(entries).to.include('name');
    expect(entries).to.include('age');
    expect(entries).to.include('active');
    expect(entries).to.include('score');
    expect(entries).to.include('profile');
    expect(entries).to.include('data');
    expect(entries).to.include('avatar');
    expect(entries).to.have.length(7);
  });

  // ---------- RTLM12: keys() ----------

  // UTS: objects/unit/RTLM12/keys-0
  // RTLM12 is an internal LiveMap-level point, so it is read via instance().keys(). (PathObject also
  // exposes keys() directly — see the RTPO10 tests — so this is a level-appropriate route, not a deviation.)
  it('RTLM12 - keys() yields only keys', async function () {
    const { root } = await setupSyncedChannel('test-RTLM12');

    const rootInst = root.instance()!;
    const keys = [...rootInst.keys()];

    expect(keys).to.have.length(7);
    expect(keys).to.include('name');
  });

  // ---------- RTLM20: set() sends MAP_SET message ----------

  // UTS: objects/unit/RTLM20/set-sends-map-set-0
  it('RTLM20 - set() sends MAP_SET message with correct format', async function () {
    const capturedMessages: any[] = [];

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
            siteCode: 'test',
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
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          capturedMessages.push(msg);
          const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
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

    const channel = client.channels.get('test-RTLM20-set', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.set('name', 'Bob');

    expect(capturedMessages).to.have.length(1);
    const objMsg = capturedMessages[0].state[0];
    // Wire format uses numeric actions (OBJ_OP.MAP_SET = 1); spec pseudo-code string names are renderings
    expect(objMsg.operation.action).to.equal(OBJ_OP.MAP_SET);
    expect(objMsg.operation.objectId).to.equal('root');
    expect(objMsg.operation.mapSet.key).to.equal('name');
    expect(objMsg.operation.mapSet.value.string).to.equal('Bob');
  });

  // ---------- RTLM20: set() with different value types ----------

  // UTS: objects/unit/RTLM20/set-value-types-0
  it('RTLM20 - set() with different value types', async function () {
    const capturedMessages: any[] = [];

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
            siteCode: 'test',
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
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          capturedMessages.push(msg);
          const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
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

    const channel = client.channels.get('test-RTLM20-types', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.set('num_key', 42);
    await root.set('bool_key', false);
    await root.set('json_key', { nested: true });

    expect(capturedMessages).to.have.length(3);
    expect(capturedMessages[0].state[0].operation.mapSet.value.number).to.equal(42);
    expect(capturedMessages[1].state[0].operation.mapSet.value.boolean).to.equal(false);
    // Per OD2g the json value is serialized as a JSON string on the wire, not a parsed object
    expect(JSON.parse(capturedMessages[2].state[0].operation.mapSet.value.json)).to.deep.equal({ nested: true });
  });

  // ---------- RTLM20e7g: set() with LiveCounterValueType ----------

  // UTS: objects/unit/RTLM20e7g/set-counter-value-type-0
  it('RTLM20e7g - set() with LiveCounter.create() sends COUNTER_CREATE + MAP_SET', async function () {
    const capturedMessages: any[] = [];

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
            siteCode: 'test',
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
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          capturedMessages.push(msg);
          const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
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

    const channel = client.channels.get('test-RTLM20e7g', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.set('new_counter', LiveObjectsPlugin.LiveCounter.create(50));

    expect(capturedMessages).to.have.length(1);
    const state = capturedMessages[0].state;
    expect(state).to.have.length(2);
    // Wire format uses numeric action values (spec pseudo-code string names are renderings)
    expect(state[0].operation.action).to.equal(OBJ_OP.COUNTER_CREATE);
    expect(state[0].operation.objectId).to.match(/^counter:/);
    expect(state[1].operation.action).to.equal(OBJ_OP.MAP_SET);
    expect(state[1].operation.mapSet.value.objectId).to.equal(state[0].operation.objectId);
  });

  // ---------- RTLM20e7g: set() with LiveMapValueType ----------

  // UTS: objects/unit/RTLM20e7g/set-map-value-type-0
  it('RTLM20e7g - set() with LiveMap.create() sends MAP_CREATE + MAP_SET', async function () {
    const capturedMessages: any[] = [];

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
            siteCode: 'test',
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
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          capturedMessages.push(msg);
          const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
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

    const channel = client.channels.get('test-RTLM20e7g-map', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.set('nested_map', LiveObjectsPlugin.LiveMap.create({ key1: 'value1' }));

    expect(capturedMessages).to.have.length(1);
    const state = capturedMessages[0].state;
    expect(state).to.have.length(2);
    // Wire format uses numeric action values (spec pseudo-code string names are renderings)
    expect(state[0].operation.action).to.equal(OBJ_OP.MAP_CREATE);
    expect(state[0].operation.objectId).to.match(/^map:/);
    expect(state[1].operation.action).to.equal(OBJ_OP.MAP_SET);
    expect(state[1].operation.mapSet.key).to.equal('nested_map');
    expect(state[1].operation.mapSet.value.objectId).to.equal(state[0].operation.objectId);
  });

  // ---------- RTLM20h1: set() with nested value types ----------

  // UTS: objects/unit/RTLM20h1/set-nested-value-types-0
  it('RTLM20h1 - set() with nested LiveMapValueType containing LiveCounterValueType', async function () {
    const capturedMessages: any[] = [];

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
            siteCode: 'test',
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
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          capturedMessages.push(msg);
          const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
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

    const channel = client.channels.get('test-RTLM20h1', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.set(
      'stats',
      LiveObjectsPlugin.LiveMap.create({
        count: LiveObjectsPlugin.LiveCounter.create(0),
        label: 'test',
      }),
    );

    expect(capturedMessages).to.have.length(1);
    const state = capturedMessages[0].state;
    // Expect: COUNTER_CREATE, MAP_CREATE, MAP_SET (depth-first, then the MAP_SET at root)
    expect(state).to.have.length(3);
    // Wire format uses numeric action values (spec pseudo-code string names are renderings)
    expect(state[0].operation.action).to.equal(OBJ_OP.COUNTER_CREATE);
    expect(state[0].operation.objectId).to.match(/^counter:/);
    expect(state[1].operation.action).to.equal(OBJ_OP.MAP_CREATE);
    expect(state[1].operation.objectId).to.match(/^map:/);
    expect(state[2].operation.action).to.equal(OBJ_OP.MAP_SET);
    expect(state[2].operation.mapSet.key).to.equal('stats');
    expect(state[2].operation.mapSet.value.objectId).to.equal(state[1].operation.objectId);
  });

  // ---------- RTLM21: remove() ----------

  // UTS: objects/unit/RTLM21/remove-sends-map-remove-0
  it('RTLM21 - remove() sends MAP_REMOVE message', async function () {
    const capturedMessages: any[] = [];

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
            siteCode: 'test',
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
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          capturedMessages.push(msg);
          const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
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

    const channel = client.channels.get('test-RTLM21', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.remove('name');

    expect(capturedMessages).to.have.length(1);
    const objMsg = capturedMessages[0].state[0];
    // Wire format uses numeric action values (spec pseudo-code string names are renderings)
    expect(objMsg.operation.action).to.equal(OBJ_OP.MAP_REMOVE);
    expect(objMsg.operation.objectId).to.equal('root');
    expect(objMsg.operation.mapRemove.key).to.equal('name');
  });

  // ---------- RTLM20: set() applies locally after ACK ----------

  // UTS: objects/unit/RTLM20/set-applies-locally-0
  it('RTLM20 - set() applies locally after ACK', async function () {
    const { root } = await setupSyncedChannel('test-RTLM20-apply');

    await root.set('name', 'Bob');
    expect(root.get('name').value()).to.equal('Bob');
  });

  // ---------- RTLM20: set() with invalid value types ----------

  // UTS: objects/unit/RTLM20/set-invalid-values-table-0
  it('RTLM20 - set() rejects invalid value types with error 40013', async function () {
    const { root } = await setupSyncedChannel('test-RTLM20-invalid');

    const invalidValues = [
      { value: function () {}, label: 'function' },
      { value: undefined, label: 'undefined' },
      { value: Symbol('test'), label: 'symbol' },
    ];

    for (const scenario of invalidValues) {
      try {
        await root.set('key', scenario.value as any);
        expect.fail(`should have thrown for ${scenario.label}`);
      } catch (err: any) {
        expect(err.code, `expected error 40013 for ${scenario.label}`).to.equal(40013);
      }
    }
  });

  // ---------- RTLM20: set() with bytes value ----------

  // UTS: objects/unit/RTLM20/set-bytes-value-0
  it('RTLM20 - set() with bytes value sends base64-encoded bytes', async function () {
    const capturedMessages: any[] = [];

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
            siteCode: 'test',
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
          mockWs.active_connection!.send_to_client(
            buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS),
          );
        } else if (msg.action === PM_ACTION.OBJECT) {
          capturedMessages.push(msg);
          const serials = (msg.state || []).map((_: any, i: number) => `ack-${msg.msgSerial}:${i}`);
          mockWs.active_connection!.send_to_client(buildAckMessage(msg.msgSerial, serials));
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

    const channel = client.channels.get('test-RTLM20-bytes', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.set('binary_data', Buffer.from([1, 2, 3]));

    expect(capturedMessages).to.have.length(1);
    expect(capturedMessages[0].state[0].operation.mapSet.value.bytes).to.equal('AQID');
  });
});
