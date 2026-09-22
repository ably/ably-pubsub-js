/**
 * UTS: Message Field Population Tests
 *
 * Spec points: TM2a, TM2c, TM2f
 * Source: uts/test/realtime/unit/channels/message_field_population_test.md
 *
 * Tests that message fields (id, connectionId, timestamp) are populated
 * from the enclosing ProtocolMessage when not set on individual messages.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/channels/message_field_population', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * TM2a - Message id populated from ProtocolMessage id and index
   */
  // UTS: realtime/unit/TM2a/id-from-protocol-message-0
  it('TM2a - id derived from ProtocolMessage id:index', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
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
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-TM2a', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    // Send ProtocolMessage with id and 3 messages without ids
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-TM2a',
      id: 'abc123:5',
      messages: [
        { name: 'msg1', data: 'one' },
        { name: 'msg2', data: 'two' },
        { name: 'msg3', data: 'three' },
      ],
    });

    await flushAsync();

    expect(received.length).to.equal(3);
    expect(received[0].id).to.equal('abc123:5:0');
    expect(received[1].id).to.equal('abc123:5:1');
    expect(received[2].id).to.equal('abc123:5:2');
    client.close();
  });

  /**
   * TM2a - Message with existing id is not overwritten
   */
  // UTS: realtime/unit/TM2a/existing-id-not-overwritten-1
  it('TM2a - existing id not overwritten', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
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
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-TM2a-existing', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-TM2a-existing',
      id: 'proto-id:0',
      messages: [{ name: 'msg', data: 'data', id: 'my-custom-id' }],
    });

    await flushAsync();

    expect(received.length).to.equal(1);
    expect(received[0].id).to.equal('my-custom-id');
    client.close();
  });

  /**
   * TM2c - Message connectionId populated from ProtocolMessage
   */
  // UTS: realtime/unit/TM2c/connectionid-from-protocol-0
  it('TM2c - connectionId from ProtocolMessage', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
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
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-TM2c', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-TM2c',
      connectionId: 'server-conn-xyz',
      messages: [{ name: 'msg', data: 'data' }],
    });

    await flushAsync();

    expect(received.length).to.equal(1);
    expect(received[0].connectionId).to.equal('server-conn-xyz');
    client.close();
  });

  /**
   * TM2f - Message timestamp populated from ProtocolMessage
   */
  // UTS: realtime/unit/TM2f/timestamp-from-protocol-0
  it('TM2f - timestamp from ProtocolMessage', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
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
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-TM2f', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-TM2f',
      timestamp: 1700000000000,
      messages: [{ name: 'msg', data: 'data' }],
    });

    await flushAsync();

    expect(received.length).to.equal(1);
    expect(received[0].timestamp).to.equal(1700000000000);
    client.close();
  });

  /**
   * TM2a, TM2c, TM2f - All fields populated together
   */
  // UTS: realtime/unit/TM2a/all-fields-populated-together-3
  it('TM2a+c+f - all fields populated from ProtocolMessage', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
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
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-TM2-all', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-TM2-all',
      id: 'connId:7',
      connectionId: 'connId',
      timestamp: 1700000000000,
      messages: [
        { name: 'msg1', data: 'one' },
        { name: 'msg2', data: 'two' },
      ],
    });

    await flushAsync();

    expect(received.length).to.equal(2);
    expect(received[0].id).to.equal('connId:7:0');
    expect(received[0].connectionId).to.equal('connId');
    expect(received[0].timestamp).to.equal(1700000000000);
    expect(received[1].id).to.equal('connId:7:1');
    expect(received[1].connectionId).to.equal('connId');
    expect(received[1].timestamp).to.equal(1700000000000);
    client.close();
  });

  /**
   * TM2a - No id when ProtocolMessage has no id
   *
   * When the ProtocolMessage itself has no id field, messages without
   * their own id should remain without one.
   */
  // UTS: realtime/unit/TM2a/no-id-without-protocol-id-2
  it('TM2a - no id when ProtocolMessage has no id', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
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
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-TM2a-no-proto-id', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    // ProtocolMessage has no id field — messages should not get computed ids
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-TM2a-no-proto-id',
      connectionId: 'abc123',
      messages: [{ name: 'msg', data: 'hello' }],
    });

    await flushAsync();

    expect(received.length).to.equal(1);
    expect(received[0].id).to.satisfy(
      (v: any) => v === null || v === undefined,
      'Message id should be null/undefined when ProtocolMessage has no id',
    );
    client.close();
  });

  /**
   * TM2c - Message with existing connectionId is not overwritten
   *
   * A message that already has its own connectionId should retain it,
   * not have it overwritten by the ProtocolMessage connectionId.
   */
  // UTS: realtime/unit/TM2c/existing-connectionid-kept-1
  it('TM2c - existing connectionId not overwritten', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
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
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-TM2c-existing', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    // Message already has its own connectionId
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-TM2c-existing',
      connectionId: 'proto-conn',
      messages: [{ connectionId: 'msg-conn', name: 'msg', data: 'hello' }],
    });

    await flushAsync();

    expect(received.length).to.equal(1);
    expect(received[0].connectionId).to.equal('msg-conn');
    client.close();
  });

  /**
   * TM2f - Message with existing timestamp is not overwritten
   *
   * A message that already has its own timestamp should retain it,
   * not have it overwritten by the ProtocolMessage timestamp.
   */
  // UTS: realtime/unit/TM2f/existing-timestamp-kept-1
  it('TM2f - existing timestamp not overwritten', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
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
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-TM2f-existing', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    // Message already has its own timestamp
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-TM2f-existing',
      timestamp: 1700000000000,
      messages: [{ timestamp: 1600000000000, name: 'msg', data: 'hello' }],
    });

    await flushAsync();

    expect(received.length).to.equal(1);
    expect(received[0].timestamp).to.equal(1600000000000);
    client.close();
  });
});
