/**
 * UTS: Forwards Compatibility Tests
 *
 * Spec points: RTF1, RSF1
 * Source: specification/uts/realtime/unit/connection/forwards_compatibility_test.md
 *
 * The Ably client library must apply the robustness principle to deserialization:
 * - RTF1: ProtocolMessages must tolerate unrecognised attributes (ignored) and
 *         unknown enum values (handled gracefully).
 * - RSF1: Messages must tolerate unrecognised attributes (ignored) and unknown
 *         enum values (ignored).
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, trackClient, installMockWebSocket, restoreAll, flushAsync } from '../../../helpers';

async function pumpTimers(clock: any, iterations = 30) {
  for (let i = 0; i < iterations; i++) {
    await flushAsync();
  }
}

describe('uts/realtime/unit/connection/forwards_compatibility', function () {
  afterEach(function () {
    restoreAll();
  });

  // --- RTF1: Unrecognised attributes on ProtocolMessage ---

  /**
   * RTF1 - ProtocolMessage with unrecognised attributes is deserialized without error
   *
   * Tests that the client correctly processes a ProtocolMessage containing extra
   * unknown fields that are not part of the current spec, without throwing errors.
   * A MESSAGE with extra ProtocolMessage-level fields should still deliver to
   * subscribers normally.
   */
  // UTS: realtime/unit/RTF1/unrecognised-attributes-ignored-0
  it('RTF1 - ProtocolMessage with unrecognised attributes is deserialized without error', async function () {
    const channelName = 'test-RTF1-extra-attrs';
    const receivedMessages: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          conn!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => {
      receivedMessages.push(msg);
    });
    channel.attach();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(channel.state).to.equal('attached');

    // Send a MESSAGE ProtocolMessage with extra unknown attributes.
    // The raw JSON includes fields that don't exist in the current spec.
    // Using ws._fireMessage to inject raw JSON with unknown fields.
    mock.active_connection!.ws._fireMessage({
      action: 15, // MESSAGE
      channel: channelName,
      messages: [
        {
          name: 'test-event',
          data: 'hello',
          serial: 'msg-serial-1',
        },
      ],
      unknownField1: 'some-future-value',
      unknownField2: 42,
      unknownNestedObject: {
        nestedKey: 'nestedValue',
      },
      unknownArray: [1, 2, 3],
    });

    // Wait for the message to be delivered
    for (let i = 0; i < 20; i++) {
      await flushAsync();
      if (receivedMessages.length >= 1) break;
    }

    // Message was delivered successfully despite unknown fields
    expect(receivedMessages.length).to.equal(1);
    expect(receivedMessages[0].name).to.equal('test-event');
    expect(receivedMessages[0].data).to.equal('hello');

    // Connection remains healthy
    expect(client.connection.state).to.equal('connected');
    expect(channel.state).to.equal('attached');
    client.close();
  });

  // --- RTF1: Unknown action enum value ---

  /**
   * RTF1 - ProtocolMessage with unknown action enum value is handled gracefully
   *
   * Tests that the client does not crash or disconnect when receiving a
   * ProtocolMessage with an action value that is not defined in the current spec.
   */
  // UTS: realtime/unit/RTF1/unknown-action-handled-1
  it('RTF1 - ProtocolMessage with unknown action enum value is handled gracefully', async function () {
    const stateChanges: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    // Record connection state changes to detect unexpected disconnections
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(client.connection.state).to.equal('connected');

    // Send a ProtocolMessage with an unknown action value.
    // Action 254 is not defined in the current spec.
    mock.active_connection!.ws._fireMessage({
      action: 254,
      channel: 'test-RTF1-unknown-action',
      unknownPayload: 'future-feature-data',
    });

    // Send a normal HEARTBEAT to verify the connection is still processing messages
    mock.active_connection!.send_to_client({
      action: 0, // HEARTBEAT
    });

    // Give the client time to process both messages
    for (let i = 0; i < 10; i++) {
      await flushAsync();
    }

    // Connection should still be CONNECTED - the unknown action was silently ignored
    expect(client.connection.state).to.equal('connected');

    // No unexpected state transitions occurred (only the initial connecting -> connected)
    expect(stateChanges).to.deep.equal(['connecting', 'connected']);

    // Verify no disconnected or failed states appeared
    expect(stateChanges).to.not.include('disconnected');
    expect(stateChanges).to.not.include('failed');

    client.close();
  });

  // --- RSF1: Unrecognised attributes on Message ---

  /**
   * RSF1 - Message with unrecognised attributes is deserialized without error
   *
   * Tests that a Message containing extra unknown fields is delivered to
   * subscribers without error, and the known fields are correctly parsed.
   */
  // UTS: realtime/unit/RSF1/message-unrecognised-attrs-0
  it('RSF1 - Message with unrecognised attributes is deserialized without error', async function () {
    const channelName = 'test-RSF1-extra-attrs';
    const receivedMessages: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          conn!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => {
      receivedMessages.push(msg);
    });
    channel.attach();
    await flushAsync();
    await flushAsync();
    await flushAsync();

    expect(channel.state).to.equal('attached');

    // Send a MESSAGE ProtocolMessage where the individual messages within
    // the messages array contain unknown fields. The ProtocolMessage itself
    // is well-formed, but the Message objects have extra attributes.
    mock.active_connection!.ws._fireMessage({
      action: 15, // MESSAGE
      channel: channelName,
      messages: [
        {
          name: 'event-1',
          data: 'payload-1',
          serial: 'serial-1',
          futureField: 'future-value',
          futureNumber: 99,
          futureObject: { nested: true },
        },
        {
          name: 'event-2',
          data: 'payload-2',
          serial: 'serial-2',
          anotherUnknownField: [1, 2, 3],
        },
      ],
    });

    // Wait for both messages to be delivered
    for (let i = 0; i < 20; i++) {
      await flushAsync();
      if (receivedMessages.length >= 2) break;
    }

    // Both messages were delivered successfully despite unknown fields
    expect(receivedMessages.length).to.equal(2);

    // Known fields were correctly parsed
    expect(receivedMessages[0].name).to.equal('event-1');
    expect(receivedMessages[0].data).to.equal('payload-1');

    expect(receivedMessages[1].name).to.equal('event-2');
    expect(receivedMessages[1].data).to.equal('payload-2');

    // Connection and channel remain healthy
    expect(client.connection.state).to.equal('connected');
    expect(channel.state).to.equal('attached');
    client.close();
  });
});
