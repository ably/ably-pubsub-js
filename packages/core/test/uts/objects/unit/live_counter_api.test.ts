/**
 * UTS: LiveCounter API Tests
 *
 * Spec points: RTLC5, RTLC11-RTLC13
 * Source: uts/objects/unit/live_counter_api.md
 *
 * Tests LiveCounter API methods — increment, decrement, value —
 * through the channel/publish flow. Tests use setupSyncedChannel for
 * simple cases and custom MockWebSocket setups for message capture
 * and mode/echoMessages error scenarios.
 */

import { expect } from 'chai';
import { restoreAll, flushAsync } from '../../helpers';
import {
  setupSyncedChannel,
  buildObjectMessage,
  buildCounterInc,
  buildAckMessage,
  PM_ACTION,
} from '../helpers/standard_test_pool';
import { MockWebSocket } from '../../mock_websocket';
import { Ably, installMockWebSocket, trackClient } from '../../helpers';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';
import { buildObjectSyncMessage, STANDARD_POOL_OBJECTS, HAS_OBJECTS } from '../helpers/standard_test_pool';

describe('uts/objects/unit/live_counter_api', function () {
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RTLC5/value-returns-data-0
  it('RTLC5 - value() returns current counter data', async function () {
    const { root } = await setupSyncedChannel('test-RTLC5');

    const counter = root.get('score');
    expect(counter.value()).to.equal(100);
  });

  // UTS: objects/unit/RTLC12/increment-sends-counter-inc-0
  it('RTLC12 - increment sends v6 COUNTER_INC message', async function () {
    const capturedMessages: any[] = [];
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
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

    const channel = client.channels.get('test-RTLC12-msg', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.get('score').increment(25);

    expect(capturedMessages.length).to.equal(1);
    const objMsg = capturedMessages[0].state[0];
    expect(objMsg.operation.action).to.equal(4); // COUNTER_INC
    expect(objMsg.operation.objectId).to.equal('counter:score@1000');
    expect(objMsg.operation.counterInc.number).to.equal(25);
  });

  // UTS: objects/unit/RTLC12/increment-applies-locally-0
  it('RTLC12 - increment applies locally after ACK', async function () {
    const { root } = await setupSyncedChannel('test-RTLC12-apply');

    await root.get('score').increment(50);
    expect(root.get('score').value()).to.equal(150);
  });

  // UTS: objects/unit/RTLC12e1/increment-non-number-0
  it('RTLC12e1 - increment with non-number throws 40003', async function () {
    const { root } = await setupSyncedChannel('test-RTLC12e1');

    try {
      await root.get('score').increment('not_a_number' as any);
      expect.fail('should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40003);
    }
  });

  // UTS: objects/unit/RTLC12e1/increment-invalid-amounts-table-0
  // The null row does not assert 40003 here, per the spec's language-applicability note on
  // this table: the ably-js public API defines a nullish amount as equivalent to an omitted
  // argument (amount ?? 1), so the failure path is unreachable for null. Instead the null
  // case pins the null-means-omitted contract by asserting the default of 1 (see deviations.md).
  describe('RTLC12e1 - table-driven invalid increment amounts', function () {
    it('null is treated as omitted and increments by the default of 1', async function () {
      const { root } = await setupSyncedChannel('test-RTLC12e1-null');

      await root.get('score').increment(null as any);

      expect(root.get('score').value()).to.equal(101);
    });

    const invalidAmounts = [
      { value: NaN, label: 'NaN' },
      { value: Infinity, label: 'Infinity' },
      { value: -Infinity, label: '-Infinity' },
      { value: '10', label: 'string' },
      { value: true, label: 'boolean' },
      { value: [1, 2], label: 'array' },
      { value: { n: 1 }, label: 'object' },
    ];

    for (const scenario of invalidAmounts) {
      it(`rejects ${scenario.label}`, async function () {
        const { root } = await setupSyncedChannel(`test-RTLC12e1-${scenario.label}`);

        try {
          await root.get('score').increment(scenario.value as any);
          expect.fail('should have thrown');
        } catch (err: any) {
          expect(err.code).to.equal(40003);
        }
      });
    }
  });

  // UTS: objects/unit/RTLC13/decrement-negates-0
  it('RTLC13 - decrement delegates to increment with negated amount', async function () {
    const capturedMessages: any[] = [];
    const mockWs = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mockWs.active_connection = conn;
        conn.respond_with_connected({
          action: PM_ACTION.CONNECTED,
          connectionId: 'conn-1',
          connectionDetails: {
            connectionKey: 'key-1',
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

    const channel = client.channels.get('test-RTLC13', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
    const root = await channel.object.get();

    await root.get('score').decrement(15);

    expect(capturedMessages[0].state[0].operation.counterInc.number).to.equal(-15);
    expect(root.get('score').value()).to.equal(85);
  });

  // UTS: objects/unit/RTLC11/counter-update-on-inc-0
  it('RTLC11 - LiveCounterUpdate emitted on increment', async function () {
    const { root, mockWs } = await setupSyncedChannel('test-RTLC11');

    const updates: any[] = [];
    const instance = root.get('score').instance()!;
    instance.subscribe((event: any) => updates.push(event));

    mockWs.active_connection!.send_to_client(
      buildObjectMessage('test-RTLC11', [buildCounterInc('counter:score@1000', 7, '99', 'remote')]),
    );
    await flushAsync();

    expect(updates).to.have.length(1);
    expect(updates[0].message.operation.counterInc.number).to.equal(7);
  });
});
