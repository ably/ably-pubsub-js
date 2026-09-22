/**
 * UTS: Value Types Tests
 *
 * Spec points: RTLCV1-4, RTLMV1-4
 * Source: uts/objects/unit/value_types.md
 *
 * Tests LiveCounterValueType and LiveMapValueType — immutable blueprints
 * created via LiveCounter.create() and LiveMap.create() static factories.
 * When consumed by a mutation method, they generate ObjectMessages with
 * v6 wire format fields (counterCreateWithObjectId, mapCreateWithObjectId).
 *
 * Consumption ("evaluation by a mutation method" per the UTS spec) happens
 * internally when LiveMap#set() is called with a value type; the tests drive
 * root.set() and verify the generated ObjectMessages captured from the mock
 * WebSocket, using the initialValue JSON string on the *WithObjectId ops.
 */

import { expect } from 'chai';
import { restoreAll, flushAsync } from '../../helpers';
import { MockWebSocket } from '../../mock_websocket';
import { Ably, installMockWebSocket, trackClient } from '../../helpers';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';
import {
  PM_ACTION,
  HAS_OBJECTS,
  OBJ_OP,
  MAP_SEMANTICS_LWW,
  STANDARD_POOL_OBJECTS,
  buildObjectSyncMessage,
  buildAckMessage,
} from '../helpers/standard_test_pool';

/**
 * Helper: set up a synced channel that captures OBJECT messages from the client
 * instead of auto-ACKing. Returns the captured messages array and a function
 * to manually send the ACK.
 */
interface CapturedMessage {
  raw: any;
  state: any[];
}

async function setupCapturingChannel(channelName: string): Promise<{
  client: InstanceType<typeof Ably.Realtime>;
  channel: any;
  root: any;
  mockWs: MockWebSocket;
  captured: CapturedMessage[];
  ackLast: () => void;
}> {
  const captured: CapturedMessage[] = [];

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
        mockWs.active_connection!.send_to_client(buildObjectSyncMessage(msg.channel, 'sync1:', STANDARD_POOL_OBJECTS));
      } else if (msg.action === PM_ACTION.OBJECT) {
        captured.push({ raw: msg, state: msg.state || [] });
        // Auto-ACK with serials
        const serials = (msg.state || []).map((_: any, i: number) => `t:${msg.msgSerial + 1}:${i}`);
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

  const channel = client.channels.get(channelName, { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
  const root = await channel.object.get();

  const ackLast = () => {
    const last = captured[captured.length - 1];
    if (last) {
      const serials = last.state.map((_: any, i: number) => `t:${last.raw.msgSerial + 1}:${i}`);
      mockWs.active_connection!.send_to_client(buildAckMessage(last.raw.msgSerial, serials));
    }
  };

  return { client, channel, root, mockWs, captured, ackLast };
}

describe('uts/objects/unit/value_types', function () {
  afterEach(function () {
    restoreAll();
  });

  // ============================================================
  // RTLCV3 — LiveCounter.create
  // ============================================================

  // UTS: objects/unit/RTLCV3/create-with-count-0
  it('RTLCV3 - LiveCounter.create with initial count', function () {
    const vt = LiveObjectsPlugin.LiveCounter.create(42);
    expect(vt).to.exist;
    // RTLCV3b: the value type is a LiveCounter branded object
    // Verify via the internal _livetype property
    expect((vt as any)._livetype).to.equal('LiveCounter');
    // RTLCV3d: the returned value is frozen (immutable)
    expect(Object.isFrozen(vt)).to.be.true;
  });

  // UTS: objects/unit/RTLCV3/create-default-zero-0
  it('RTLCV3 - LiveCounter.create defaults to 0', function () {
    const vt = LiveObjectsPlugin.LiveCounter.create();
    expect(vt).to.exist;
    // The internal _count should be 0
    expect((vt as any)._count).to.equal(0);
  });

  // UTS: objects/unit/RTLCV3c/no-validation-at-create-0
  it('RTLCV3c - no validation at creation time', function () {
    // RTLCV3c: No input validation is performed at creation time
    const vt = LiveObjectsPlugin.LiveCounter.create('not_a_number' as any);
    expect(vt).to.exist;
    expect((vt as any)._livetype).to.equal('LiveCounter');
  });

  // ============================================================
  // RTLCV4 — Consumption generates COUNTER_CREATE ObjectMessage
  // ============================================================

  // UTS: objects/unit/RTLCV4/evaluate-generates-message-0
  it('RTLCV4 - consumption generates COUNTER_CREATE ObjectMessage', async function () {
    const { root, captured } = await setupCapturingChannel('test-RTLCV4-consume');

    await root.set('name', LiveObjectsPlugin.LiveCounter.create(42));
    await flushAsync();

    // The captured message should contain the COUNTER_CREATE + MAP_SET operations
    expect(captured.length).to.be.greaterThanOrEqual(1);
    const allOps = captured.flatMap((c) => c.state);

    // Find the COUNTER_CREATE operation
    const counterCreateOps = allOps.filter((op: any) => op.operation?.action === OBJ_OP.COUNTER_CREATE);
    expect(counterCreateOps.length).to.equal(1);

    const msg = counterCreateOps[0];
    expect(msg.operation.action).to.equal(OBJ_OP.COUNTER_CREATE);
    // objectId starts with "counter:" and contains "@"
    expect(msg.operation.objectId).to.match(/^counter:/);
    expect(msg.operation.objectId).to.include('@');
    // counterCreateWithObjectId is set
    expect(msg.operation.counterCreateWithObjectId).to.exist;
    expect(msg.operation.counterCreateWithObjectId.nonce).to.be.a('string');
    expect(msg.operation.counterCreateWithObjectId.nonce.length).to.be.greaterThanOrEqual(16);
    expect(msg.operation.counterCreateWithObjectId.initialValue).to.be.a('string');
  });

  // UTS: objects/unit/RTLCV4g5/retains-local-counter-create-0
  // _derivedFrom is a local-only field stripped from wire messages.
  // We verify CounterCreate data via the initialValue JSON string in
  // counterCreateWithObjectId, which encodes the CounterCreate payload.
  it('RTLCV4g5 - consumption retains local CounterCreate (via initialValue)', async function () {
    const { root, captured } = await setupCapturingChannel('test-RTLCV4g5');

    await root.set('name', LiveObjectsPlugin.LiveCounter.create(42));
    await flushAsync();

    const allOps = captured.flatMap((c) => c.state);
    const counterCreateOp = allOps.find((op: any) => op.operation?.action === OBJ_OP.COUNTER_CREATE);
    expect(counterCreateOp).to.exist;

    // The initialValue is a JSON string encoding of the CounterCreate
    const initialValue = JSON.parse(counterCreateOp.operation.counterCreateWithObjectId.initialValue);
    expect(initialValue).to.exist;
    expect(initialValue.count).to.equal(42);
  });

  // UTS: objects/unit/RTLCV4a/evaluate-validates-count-0
  it('RTLCV4a - consumption validates count type', async function () {
    const { root } = await setupCapturingChannel('test-RTLCV4a');

    const vt = LiveObjectsPlugin.LiveCounter.create('not_a_number' as any);
    try {
      await root.set('name', vt);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40003);
    }
  });

  // UTS: objects/unit/RTLCV4/evaluate-zero-count-0
  it('RTLCV4 - consumption with count 0 is valid', async function () {
    const { root, captured } = await setupCapturingChannel('test-RTLCV4-zero');

    await root.set('name', LiveObjectsPlugin.LiveCounter.create(0));
    await flushAsync();

    const allOps = captured.flatMap((c) => c.state);
    const counterCreateOp = allOps.find((op: any) => op.operation?.action === OBJ_OP.COUNTER_CREATE);
    expect(counterCreateOp).to.exist;

    const initialValue = JSON.parse(counterCreateOp.operation.counterCreateWithObjectId.initialValue);
    expect(initialValue).to.exist;
    expect(initialValue.count).to.equal(0);
  });

  // ============================================================
  // RTLMV3 — LiveMap.create
  // ============================================================

  // UTS: objects/unit/RTLMV3/create-with-entries-0
  it('RTLMV3 - LiveMap.create with entries', function () {
    const vt = LiveObjectsPlugin.LiveMap.create({ name: 'Alice', age: 30 });
    expect(vt).to.exist;
    expect((vt as any)._livetype).to.equal('LiveMap');
    // Check internal entries
    expect((vt as any)._entries).to.deep.equal({ name: 'Alice', age: 30 });
    // RTLMV3d: the returned value is frozen (immutable)
    expect(Object.isFrozen(vt)).to.be.true;
  });

  // UTS: objects/unit/RTLMV3/create-no-entries-0
  it('RTLMV3 - LiveMap.create with no entries', function () {
    const vt = LiveObjectsPlugin.LiveMap.create();
    expect(vt).to.exist;
    expect((vt as any)._livetype).to.equal('LiveMap');
  });

  // ============================================================
  // RTLMV4 — Consumption generates MAP_CREATE ObjectMessage
  // ============================================================

  // UTS: objects/unit/RTLMV4/evaluate-generates-message-0
  it('RTLMV4 - consumption generates MAP_CREATE ObjectMessage', async function () {
    const { root, captured } = await setupCapturingChannel('test-RTLMV4-consume');

    await root.set('name', LiveObjectsPlugin.LiveMap.create({ name: 'Alice' }));
    await flushAsync();

    const allOps = captured.flatMap((c) => c.state);

    // Find the MAP_CREATE operation (there will be one for the new map)
    const mapCreateOps = allOps.filter((op: any) => op.operation?.action === OBJ_OP.MAP_CREATE);
    expect(mapCreateOps.length).to.equal(1);

    const msg = mapCreateOps[0];
    expect(msg.operation.action).to.equal(OBJ_OP.MAP_CREATE);
    expect(msg.operation.objectId).to.match(/^map:/);
    expect(msg.operation.mapCreateWithObjectId).to.exist;
    expect(msg.operation.mapCreateWithObjectId.nonce).to.be.a('string');
    expect(msg.operation.mapCreateWithObjectId.nonce.length).to.be.greaterThanOrEqual(16);
    expect(msg.operation.mapCreateWithObjectId.initialValue).to.be.a('string');
  });

  // UTS: objects/unit/RTLMV4j5/retains-local-map-create-0
  // _derivedFrom is a local-only field stripped from wire messages.
  // We verify MapCreate data via the initialValue JSON string in
  // mapCreateWithObjectId, which encodes the MapCreate payload.
  it('RTLMV4j5 - consumption retains local MapCreate (via initialValue)', async function () {
    const { root, captured } = await setupCapturingChannel('test-RTLMV4j5');

    await root.set('name', LiveObjectsPlugin.LiveMap.create({ name: 'Alice' }));
    await flushAsync();

    const allOps = captured.flatMap((c) => c.state);
    const mapCreateOp = allOps.find((op: any) => op.operation?.action === OBJ_OP.MAP_CREATE);
    expect(mapCreateOp).to.exist;

    // The initialValue is a JSON string encoding of the MapCreate
    const initialValue = JSON.parse(mapCreateOp.operation.mapCreateWithObjectId.initialValue);
    expect(initialValue).to.exist;
    expect(initialValue.semantics).to.equal(MAP_SEMANTICS_LWW);
    expect(initialValue.entries).to.exist;
    expect(initialValue.entries['name']).to.exist;
    expect(initialValue.entries['name'].data.string).to.equal('Alice');
  });

  // UTS: objects/unit/RTLMV4d/entry-value-types-0
  // Entry types are verified via the initialValue JSON string in mapCreateWithObjectId.
  it('RTLMV4d - entry value type mapping', async function () {
    const { root, captured } = await setupCapturingChannel('test-RTLMV4d');

    await root.set(
      'name',
      LiveObjectsPlugin.LiveMap.create({
        str: 'hello',
        num: 42,
        bool: true,
        json_arr: [1, 2, 3] as any,
        json_obj: { key: 'value' } as any,
      }),
    );
    await flushAsync();

    const allOps = captured.flatMap((c) => c.state);
    const mapCreateOp = allOps.find((op: any) => op.operation?.action === OBJ_OP.MAP_CREATE);
    expect(mapCreateOp).to.exist;

    const initialValue = JSON.parse(mapCreateOp.operation.mapCreateWithObjectId.initialValue);
    const entries = initialValue.entries;
    expect(entries['str'].data.string).to.equal('hello');
    expect(entries['num'].data.number).to.equal(42);
    expect(entries['bool'].data.boolean).to.equal(true);
    // JSON values on the wire are JSON-stringified strings
    expect(JSON.parse(entries['json_arr'].data.json)).to.deep.equal([1, 2, 3]);
    expect(JSON.parse(entries['json_obj'].data.json)).to.deep.equal({ key: 'value' });
  });

  // UTS: objects/unit/RTLMV4d1/nested-value-types-0
  // Nested objectId references are verified via the initialValue JSON strings.
  it('RTLMV4d1 - nested value types produce depth-first ObjectMessages', async function () {
    const { root, captured } = await setupCapturingChannel('test-RTLMV4d1');

    const innerCounter = LiveObjectsPlugin.LiveCounter.create(10);
    const innerMap = LiveObjectsPlugin.LiveMap.create({
      nested_count: innerCounter as any,
    });
    const outer = LiveObjectsPlugin.LiveMap.create({
      child: innerMap as any,
    });

    await root.set('name', outer);
    await flushAsync();

    const allOps = captured.flatMap((c) => c.state);

    // Filter out the MAP_SET operation — we only want the CREATE operations
    const createOps = allOps.filter(
      (op: any) => op.operation?.action === OBJ_OP.COUNTER_CREATE || op.operation?.action === OBJ_OP.MAP_CREATE,
    );

    // Depth-first: inner counter, inner map, outer map
    expect(createOps.length).to.equal(3);
    expect(createOps[0].operation.action).to.equal(OBJ_OP.COUNTER_CREATE);
    expect(createOps[0].operation.objectId).to.match(/^counter:/);
    expect(createOps[1].operation.action).to.equal(OBJ_OP.MAP_CREATE);
    expect(createOps[1].operation.objectId).to.match(/^map:/);
    expect(createOps[2].operation.action).to.equal(OBJ_OP.MAP_CREATE);
    expect(createOps[2].operation.objectId).to.match(/^map:/);

    const innerCounterId = createOps[0].operation.objectId;
    const innerMapId = createOps[1].operation.objectId;

    // Inner map's entries should reference inner counter via initialValue
    const innerMapInitialValue = JSON.parse(createOps[1].operation.mapCreateWithObjectId.initialValue);
    expect(innerMapInitialValue.entries['nested_count'].data.objectId).to.equal(innerCounterId);

    // Outer map's entries should reference inner map via initialValue
    const outerMapInitialValue = JSON.parse(createOps[2].operation.mapCreateWithObjectId.initialValue);
    expect(outerMapInitialValue.entries['child'].data.objectId).to.equal(innerMapId);
  });

  // UTS: objects/unit/RTLMV4a/evaluate-validates-entries-0
  it('RTLMV4a - consumption validates entries type', async function () {
    const { root } = await setupCapturingChannel('test-RTLMV4a');

    const vt = LiveObjectsPlugin.LiveMap.create(null as any);
    try {
      await root.set('name', vt);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40003);
    }
  });

  // UTS: objects/unit/RTLMV4c/evaluate-validates-values-0
  it('RTLMV4c - consumption validates value types', async function () {
    const { root } = await setupCapturingChannel('test-RTLMV4c');

    const vt = LiveObjectsPlugin.LiveMap.create({ fn: (() => {}) as any });
    try {
      await root.set('name', vt);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40013);
    }
  });

  // UTS: objects/unit/RTLMV4e2/empty-entries-0
  it('RTLMV4e2 - empty entries produces MapCreate with empty entries', async function () {
    const { root, captured } = await setupCapturingChannel('test-RTLMV4e2');

    await root.set('name', LiveObjectsPlugin.LiveMap.create());
    await flushAsync();

    const allOps = captured.flatMap((c) => c.state);
    const mapCreateOp = allOps.find((op: any) => op.operation?.action === OBJ_OP.MAP_CREATE);
    expect(mapCreateOp).to.exist;

    const initialValue = JSON.parse(mapCreateOp.operation.mapCreateWithObjectId.initialValue);
    expect(initialValue.entries).to.deep.equal({});
  });

  // UTS: objects/unit/RTLMV4d/map-set-all-types-table-0
  // Entry types are verified via the initialValue JSON string.
  // JSON values on the wire are double-encoded (JSON-stringified strings),
  // so we parse them before comparison.
  it('RTLMV4d - table-driven value type mapping via MapCreate', async function () {
    // Each scenario performs a real publish/ACK round-trip (~150ms); the aggregate
    // sits right at mocha's default 2s timeout, so give it explicit headroom.
    this.timeout(30000);
    const scenarios = [
      { input: 'hello', expectedField: 'string', expectedValue: 'hello', isJson: false },
      { input: 42, expectedField: 'number', expectedValue: 42, isJson: false },
      { input: 3.14, expectedField: 'number', expectedValue: 3.14, isJson: false },
      { input: 0, expectedField: 'number', expectedValue: 0, isJson: false },
      { input: -1, expectedField: 'number', expectedValue: -1, isJson: false },
      { input: true, expectedField: 'boolean', expectedValue: true, isJson: false },
      { input: false, expectedField: 'boolean', expectedValue: false, isJson: false },
      { input: [1, 'a', null], expectedField: 'json', expectedValue: [1, 'a', null], isJson: true },
      { input: { k: 'v' }, expectedField: 'json', expectedValue: { k: 'v' }, isJson: true },
      { input: Buffer.from([1, 2, 3]), expectedField: 'bytes', expectedValue: 'AQID', isJson: false },
    ];

    for (const scenario of scenarios) {
      const { root, captured } = await setupCapturingChannel(
        `test-RTLMV4d-table-${scenario.expectedField}-${JSON.stringify(scenario.input)}`,
      );

      await root.set('name', LiveObjectsPlugin.LiveMap.create({ test_key: scenario.input as any }));
      await flushAsync();

      const allOps = captured.flatMap((c) => c.state);
      const mapCreateOp = allOps.find((op: any) => op.operation?.action === OBJ_OP.MAP_CREATE);
      expect(mapCreateOp, `MAP_CREATE not found for input ${JSON.stringify(scenario.input)}`).to.exist;

      const initialValue = JSON.parse(mapCreateOp.operation.mapCreateWithObjectId.initialValue);
      const entry = initialValue.entries['test_key'];
      expect(entry, `entry not found for input ${JSON.stringify(scenario.input)}`).to.exist;

      let actual = entry.data[scenario.expectedField];
      if (scenario.isJson && typeof actual === 'string') {
        actual = JSON.parse(actual);
      }
      expect(actual, `expected ${scenario.expectedField} for input ${JSON.stringify(scenario.input)}`).to.deep.equal(
        scenario.expectedValue,
      );

      restoreAll();
    }
  });

  // ============================================================
  // RTLMV4b — key validation (deviation note below)
  // ============================================================

  // Deviation: The UTS spec tests `LiveMap.create({ 123: "value" })` where the
  // key is a non-string. In JavaScript/TypeScript, object keys are always strings
  // (or symbols), so `{ 123: "value" }` is equivalent to `{ "123": "value" }`.
  // Therefore this test cannot be directly translated — JS coerces 123 to "123".
  // We skip RTLMV4b as it's a language-specific validation that doesn't apply to JS.
});
