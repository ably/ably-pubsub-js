/**
 * UTS: Channel Publish Tests
 *
 * Spec points: RTL6, RTL6c1, RTL6c2, RTL6c4, RTL6c5, RTL6i1, RTL6i2, RTL6i3,
 *   RTL6j, RTN7d, RTN7e, RTN19a, RTN19a2, RTN19b
 * Source: uts/test/realtime/unit/channels/channel_publish_test.md
 *
 * Tests message publishing: single/array/Message object, immediate/queued
 * delivery, ACK/NACK handling, PublishResult, state validation, queueMessages,
 * and transport resume retransmission.
 */

import { expect } from 'chai';
import { MockWebSocket, PendingWSConnection } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import {
  Ably,
  installMockWebSocket,
  installMockHttp,
  enableFakeTimers,
  restoreAll,
  trackClient,
  flushAsync,
} from '../../../helpers';

describe('uts/realtime/unit/channels/channel_publish', function () {
  afterEach(function () {
    restoreAll();
  });

  // Helper: standard mock that auto-connects and auto-attaches
  function setupMock(opts?: {
    onMessage?: (msg: any, conn: PendingWSConnection | undefined) => void;
    onConnect?: (conn: PendingWSConnection) => void;
  }) {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        if (opts?.onConnect) {
          opts.onConnect(conn);
        } else {
          conn.respond_with_connected();
        }
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
        if (msg.action === 15) {
          // MESSAGE
          captured.push(msg);
        }
        if (opts?.onMessage) {
          opts.onMessage(msg, conn);
        }
      },
    });
    return { mock, captured };
  }

  /**
   * RTL6i1 - Publish single message by name and data
   */
  // UTS: realtime/unit/RTL6i1/publish-name-and-data-0
  it('RTL6i1 - publish single message by name and data', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['serial-1'] }],
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

    const channel = client.channels.get('test-RTL6i1', { attachOnSubscribe: false });
    await channel.attach();

    await channel.publish('greeting', 'hello');

    expect(captured.length).to.equal(1);
    expect(captured[0].messages.length).to.equal(1);
    expect(captured[0].messages[0].name).to.equal('greeting');
    expect(captured[0].messages[0].data).to.equal('hello');
    client.close();
  });

  /**
   * RTL6i2 - Publish array of Message objects
   */
  // UTS: realtime/unit/RTL6i2/publish-message-array-0
  it('RTL6i2 - publish array of messages in single ProtocolMessage', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1', 's2', 's3'] }],
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

    const channel = client.channels.get('test-RTL6i2', { attachOnSubscribe: false });
    await channel.attach();

    await channel.publish([
      { name: 'msg1', data: 'one' },
      { name: 'msg2', data: 'two' },
      { name: 'msg3', data: 'three' },
    ]);

    expect(captured.length).to.equal(1);
    expect(captured[0].messages.length).to.equal(3);
    expect(captured[0].messages[0].name).to.equal('msg1');
    expect(captured[0].messages[1].name).to.equal('msg2');
    expect(captured[0].messages[2].name).to.equal('msg3');
    client.close();
  });

  /**
   * RTL6i3 - Null fields omitted from JSON wire encoding
   *
   * Spec: "If any of the values are null, then key is not sent to Ably
   * i.e. a payload with a null value for data would be sent as { "name": "click" }"
   */
  // UTS: realtime/unit/RTL6i3/null-fields-json-0
  it('RTL6i3 - null name/data fields handled correctly', async function () {
    if (!process.env.RUN_DEVIATIONS) this.skip(); // ably-js includes null fields in wire JSON; see #2199
    const rawFrames: string[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          conn!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
          });
        }
      },
      onTextDataFrame: (raw) => rawFrames.push(raw),
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

    const channel = client.channels.get('test-RTL6i3', { attachOnSubscribe: false });
    await channel.attach();

    // Publish name-only (no data)
    rawFrames.length = 0;
    await channel.publish('name-only', undefined);
    const nameOnlyFrame = rawFrames.find((f) => f.includes('"name-only"'));
    expect(nameOnlyFrame).to.exist;
    const nameOnlyMsg = JSON.parse(nameOnlyFrame!).messages[0];
    expect(nameOnlyMsg.name).to.equal('name-only');
    expect('data' in nameOnlyMsg).to.be.false;

    // Publish data-only (no name)
    rawFrames.length = 0;
    await channel.publish(null as any, 'data-only');
    const dataOnlyFrame = rawFrames.find((f) => f.includes('"data-only"'));
    expect(dataOnlyFrame).to.exist;
    const dataOnlyMsg = JSON.parse(dataOnlyFrame!).messages[0];
    expect(dataOnlyMsg.data).to.equal('data-only');
    expect('name' in dataOnlyMsg).to.be.false;
  });

  /**
   * RTL6i3 - Null fields omitted from msgpack wire encoding
   *
   * DEVIATION: ably-js does not support msgpack protocol
   */
  // UTS: realtime/unit/RTL6i3/null-fields-msgpack-1
  it.skip('RTL6i3 - null fields omitted from msgpack wire encoding (msgpack not supported)', function () {
    // DEVIATION: ably-js does not support msgpack protocol
  });

  /**
   * RTL6i1 - Publish Message object
   */
  // UTS: realtime/unit/RTL6i1/publish-message-object-1
  it('RTL6i1 - publish Message object', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
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

    const channel = client.channels.get('test-RTL6i1-obj', { attachOnSubscribe: false });
    await channel.attach();

    await channel.publish({ name: 'event', data: 'payload' });

    expect(captured.length).to.equal(1);
    expect(captured[0].messages[0].name).to.equal('event');
    expect(captured[0].messages[0].data).to.equal('payload');
    client.close();
  });

  /**
   * RTL6c1 - Publish immediately when CONNECTED and channel ATTACHED
   */
  // UTS: realtime/unit/RTL6c1/publish-when-attached-0
  it('RTL6c1 - publish immediately when connected and attached', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
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

    const channel = client.channels.get('test-RTL6c1-attached', { attachOnSubscribe: false });
    await channel.attach();
    expect(client.connection.state).to.equal('connected');
    expect(channel.state).to.equal('attached');

    const result = await channel.publish('msg', 'data');

    expect(captured.length).to.equal(1);
    // Message was sent immediately (ACK already received)
    expect(result).to.have.property('serials');
    client.close();
  });

  /**
   * RTL6c1 - Publish immediately when CONNECTED and channel INITIALIZED
   */
  // UTS: realtime/unit/RTL6c1/publish-when-initialized-2
  it('RTL6c1 - publish immediately when connected and channel initialized', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
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

    const channel = client.channels.get('test-RTL6c1-init', { attachOnSubscribe: false });
    expect(channel.state).to.equal('initialized');

    await channel.publish('msg', 'data');

    // Message was sent immediately (connection CONNECTED)
    expect(captured.length).to.equal(1);
    // Channel should remain initialized — no implicit attach (RTL6c5)
    expect(channel.state).to.equal('initialized');
    client.close();
  });

  /**
   * RTL6c5 - Publish does not trigger implicit attach
   */
  // UTS: realtime/unit/RTL6c5/no-implicit-attach-0
  it('RTL6c5 - publish does not trigger implicit attach', async function () {
    let attachCount = 0;
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 10) attachCount++;
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
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

    const channel = client.channels.get('test-RTL6c5', { attachOnSubscribe: false });
    expect(channel.state).to.equal('initialized');

    await channel.publish('msg', 'data');
    await flushAsync();

    expect(channel.state).to.equal('initialized');
    expect(attachCount).to.equal(0);
    client.close();
  });

  /**
   * RTL6c2 - Publish queued when connection is CONNECTING
   */
  // UTS: realtime/unit/RTL6c2/queued-when-connecting-0
  it('RTL6c2 - publish queued when connecting', async function () {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        // Delay connection — don't respond yet
        mock.active_connection = conn;
        setImmediate(() => conn.respond_with_connected());
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          captured.push(msg);
          conn!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
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
    // Connection is CONNECTING now
    expect(client.connection.state).to.equal('connecting');

    const channel = client.channels.get('test-RTL6c2-connecting', { attachOnSubscribe: false });

    // Publish while connecting — should be queued
    const publishPromise = channel.publish('queued', 'data');

    // Not yet sent
    expect(captured.length).to.equal(0);

    // Wait for publish to complete (will happen after connection)
    await publishPromise;

    expect(captured.length).to.equal(1);
    expect(captured[0].messages[0].name).to.equal('queued');
    client.close();
  });

  /**
   * RTL6c2 - Publish queued when connection is INITIALIZED
   */
  // UTS: realtime/unit/RTL6c2/queued-when-initialized-2
  it('RTL6c2 - publish queued when initialized', async function () {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          captured.push(msg);
          conn!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
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

    // Connection is INITIALIZED — not yet connected
    expect(client.connection.state).to.equal('initialized');

    const channel = client.channels.get('test-RTL6c2-init', { attachOnSubscribe: false });

    // Publish before connect — should be queued
    const publishPromise = channel.publish('before-connect', 'data');
    expect(captured.length).to.equal(0);

    // Now connect
    client.connect();
    await publishPromise;

    expect(captured.length).to.equal(1);
    expect(captured[0].messages[0].name).to.equal('before-connect');
    client.close();
  });

  /**
   * RTL6c2 - Publish queued when connection is DISCONNECTED
   */
  // UTS: realtime/unit/RTL6c2/queued-when-disconnected-1
  it('RTL6c2 - publish queued when disconnected', async function () {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          captured.push(msg);
          conn!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL6c2-disconn', { attachOnSubscribe: false });
    await channel.attach();

    const capturedBefore = captured.length;

    // Disconnect
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    // Publish while disconnected — queued
    const publishPromise = channel.publish('while-disconn', 'data');

    // Should not have been sent yet
    expect(captured.length).to.equal(capturedBefore);

    // Wait for reconnect and publish to complete
    await publishPromise;

    expect(captured.length).to.be.greaterThan(capturedBefore);
    const lastMsg = captured[captured.length - 1];
    expect(lastMsg.messages[0].name).to.equal('while-disconn');
    client.close();
  });

  /**
   * RTL6c2 - Multiple queued messages sent in order
   */
  // UTS: realtime/unit/RTL6c2/queued-messages-order-4
  it('RTL6c2 - multiple queued messages sent in order', async function () {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          captured.push(msg);
          conn!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['s1'] }],
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

    const channel = client.channels.get('test-RTL6c2-order', { attachOnSubscribe: false });

    // Queue 3 messages before connecting
    const p1 = channel.publish('first', 'data1');
    const p2 = channel.publish('second', 'data2');
    const p3 = channel.publish('third', 'data3');

    client.connect();
    await Promise.all([p1, p2, p3]);

    expect(captured.length).to.equal(3);
    expect(captured[0].messages[0].name).to.equal('first');
    expect(captured[1].messages[0].name).to.equal('second');
    expect(captured[2].messages[0].name).to.equal('third');
    client.close();
  });

  /**
   * RTL6c4 - Publish fails when connection is CLOSED
   */
  // UTS: realtime/unit/RTL6c4/fails-conn-closed-1
  it('RTL6c4 - publish fails when connection closed', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 7) {
          // CLOSE
          conn!.send_to_client({ action: 8 }); // CLOSED
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

    client.close();
    await new Promise<void>((resolve) => client.connection.once('closed', resolve));

    const channel = client.channels.get('test-RTL6c4-closed', { attachOnSubscribe: false });

    try {
      await channel.publish('msg', 'data');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
  });

  /**
   * RTL6c4 - Publish fails when connection is FAILED
   */
  // UTS: realtime/unit/RTL6c4/fails-channel-failed-4
  it('RTL6c4 - publish fails when connection failed', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
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

    // Fatal error → FAILED
    mock.active_connection!.send_to_client({
      action: 9, // ERROR (connection-level)
      error: { message: 'Fatal', code: 40198, statusCode: 400 },
    });
    await new Promise<void>((resolve) => client.connection.once('failed', resolve));

    const channel = client.channels.get('test-RTL6c4-failed', { attachOnSubscribe: false });

    try {
      await channel.publish('msg', 'data');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
    client.close();
  });

  /**
   * RTL6c4 - Publish fails when channel is FAILED
   */
  // UTS: realtime/unit/RTL6c4/fails-conn-failed-2
  it('RTL6c4 - publish fails when channel failed', async function () {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          captured.push(msg);
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

    const channel = client.channels.get('test-RTL6c4-ch-failed', { attachOnSubscribe: false });
    await channel.attach();

    // Channel ERROR → FAILED
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTL6c4-ch-failed',
      error: { message: 'Channel error', code: 90001, statusCode: 500 },
    });
    await new Promise<void>((resolve) => channel.once('failed', resolve));

    const capturedBefore = captured.length;

    try {
      await channel.publish('msg', 'data');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.equal(90001);
    }

    // No MESSAGE sent to server
    expect(captured.length).to.equal(capturedBefore);
    client.close();
  });

  /**
   * RTL6c2 - Publish fails when queueMessages is false and not connected
   */
  // UTS: realtime/unit/RTL6c2/fails-no-queue-messages-3
  it('RTL6c2 - publish fails when queueMessages false and not connected', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        // Don't respond — stay connecting
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      queueMessages: false,
    });
    trackClient(client);

    client.connect();
    // Connection is CONNECTING (not yet connected)
    expect(client.connection.state).to.equal('connecting');

    const channel = client.channels.get('test-RTL6c2-noqueue', { attachOnSubscribe: false });

    try {
      await channel.publish('msg', 'data');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
    client.close();
  });

  /**
   * RTL6j - Publish returns PublishResult with serials from ACK
   */
  // UTS: realtime/unit/RTL6j/publish-result-serials-0
  it('RTL6j - PublishResult with serial from ACK', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          expect(msg.msgSerial).to.equal(0);
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: 0,
            count: 1,
            res: [{ serials: ['abc123'] }],
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

    const channel = client.channels.get('test-RTL6j', { attachOnSubscribe: false });
    await channel.attach();

    const result = await channel.publish('msg', 'data');

    expect(result).to.have.property('serials');
    expect(result.serials).to.deep.equal(['abc123']);
    client.close();
  });

  /**
   * RTL6j - Batch publish returns PublishResult with multiple serials
   */
  // UTS: realtime/unit/RTL6j/batch-publish-serials-1
  it('RTL6j - batch PublishResult with multiple serials including null', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['serial-1', null, 'serial-3'] }],
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

    const channel = client.channels.get('test-RTL6j-batch', { attachOnSubscribe: false });
    await channel.attach();

    const result = await channel.publish([
      { name: 'msg1', data: 'one' },
      { name: 'msg2', data: 'two' },
      { name: 'msg3', data: 'three' },
    ]);

    expect(result.serials).to.deep.equal(['serial-1', null, 'serial-3']);
    client.close();
  });

  /**
   * RTL6j - Sequential publishes get incrementing msgSerial
   */
  // UTS: realtime/unit/RTL6j/incrementing-msg-serial-2
  it('RTL6j - sequential publishes get incrementing msgSerial', async function () {
    const serials: number[] = [];
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          serials.push(msg.msgSerial);
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: [`serial-${msg.msgSerial}`] }],
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

    const channel = client.channels.get('test-RTL6j-incr', { attachOnSubscribe: false });
    await channel.attach();

    const r1 = await channel.publish('msg1', 'data1');
    const r2 = await channel.publish('msg2', 'data2');
    const r3 = await channel.publish('msg3', 'data3');

    expect(serials).to.deep.equal([0, 1, 2]);
    expect(r1.serials).to.deep.equal(['serial-0']);
    expect(r2.serials).to.deep.equal(['serial-1']);
    expect(r3.serials).to.deep.equal(['serial-2']);
    client.close();
  });

  /**
   * RTL6j - NACK results in error
   */
  // UTS: realtime/unit/RTL6j/nack-results-error-3
  it('RTL6j - NACK results in publish error', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 2, // NACK
            msgSerial: msg.msgSerial,
            count: 1,
            error: { message: 'Publish rejected', code: 40160, statusCode: 401 },
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

    const channel = client.channels.get('test-RTL6j-nack', { attachOnSubscribe: false });
    await channel.attach();

    try {
      await channel.publish('msg', 'data');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40160);
      expect(err.message).to.equal('Publish rejected');
    }
    client.close();
  });

  /**
   * RTN7e - Pending publishes fail when connection enters CLOSED
   */
  // UTS: realtime/unit/RTN7e/pending-fail-closed-1
  it('RTN7e - pending publishes fail on connection closed', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        // Don't ACK — leave publish pending
        if (msg.action === 7) {
          // CLOSE
          mock.active_connection!.send_to_client({ action: 8 }); // CLOSED
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

    const channel = client.channels.get('test-RTN7e-closed', { attachOnSubscribe: false });
    await channel.attach();

    // Publish but don't ACK
    const publishPromise = channel.publish('pending', 'data');

    // Close connection — pending publish should fail
    client.close();

    try {
      await publishPromise;
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
  });

  /**
   * RTN7e - Pending publishes fail when connection enters FAILED
   */
  // UTS: realtime/unit/RTN7e/pending-fail-failed-2
  it('RTN7e - pending publishes fail on connection failed', async function () {
    const { mock } = setupMock({
      onMessage: () => {
        // Don't ACK anything
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

    const channel = client.channels.get('test-RTN7e-failed', { attachOnSubscribe: false });
    await channel.attach();

    const publishPromise = channel.publish('pending', 'data');

    // Fatal error → FAILED
    mock.active_connection!.send_to_client({
      action: 9,
      error: { message: 'Fatal', code: 40198, statusCode: 400 },
    });

    try {
      await publishPromise;
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
    client.close();
  });

  /**
   * RTN7e - Pending publishes fail when connection enters SUSPENDED
   */
  // UTS: realtime/unit/RTN7e/pending-fail-suspended-0
  it('RTN7e - pending publishes fail on connection suspended', async function () {
    let firstConnect = true;
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        if (firstConnect) {
          firstConnect = false;
          conn.respond_with_connected();
        } else {
          // Refuse all reconnection attempts so connection enters SUSPENDED
          conn.respond_with_refused();
        }
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        // Don't ACK MESSAGE — leave publish pending
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      fallbackHosts: [],
      disconnectedRetryTimeout: 500,
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTN7e-suspended', { attachOnSubscribe: false } as any);
    await channel.attach();

    // Publish but don't ACK — message stays pending
    const publishPromise = channel.publish('pending', 'data');

    // Disconnect and refuse all reconnection attempts so connection enters SUSPENDED
    mock.active_connection!.simulate_disconnect();

    // Pump event loop to let disconnect processing happen
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // Advance past connectionStateTtl to reach SUSPENDED
    await clock.tickAsync(121000);

    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(client.connection.state).to.equal('suspended');

    // The pending publish should now fail
    try {
      await publishPromise;
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
    client.close();
  });

  /**
   * RTN7e - Multiple pending publishes all fail on state change
   */
  // UTS: realtime/unit/RTN7e/multiple-pending-fail-3
  it('RTN7e - multiple pending publishes all fail on close', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 7) {
          // CLOSE
          mock.active_connection!.send_to_client({ action: 8 }); // CLOSED
        }
        // Don't ACK publishes
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

    const channel = client.channels.get('test-RTN7e-multi', { attachOnSubscribe: false });
    await channel.attach();

    const p1 = channel.publish('msg1', 'data1');
    const p2 = channel.publish('msg2', 'data2');
    const p3 = channel.publish('msg3', 'data3');

    client.close();

    const results = await Promise.allSettled([p1, p2, p3]);
    for (const r of results) {
      expect(r.status).to.equal('rejected');
      expect((r as PromiseRejectedResult).reason.code).to.be.a('number');
    }
  });

  /**
   * RTN7d - New publish fails on DISCONNECTED when queueMessages is false
   */
  // UTS: realtime/unit/RTN7d/fail-disconnected-no-queue-0
  it('RTN7d - new publish fails when disconnected with queueMessages false', async function () {
    const { mock } = setupMock();
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      queueMessages: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTN7d-noq', { attachOnSubscribe: false });
    await channel.attach();

    // Disconnect
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    // New publish while disconnected with queueMessages=false should fail
    try {
      await channel.publish('new-msg', 'data');
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
    client.close();
  });

  /**
   * RTN7d - Pending publishes survive DISCONNECTED when queueMessages is true
   */
  // UTS: realtime/unit/RTN7d/survive-disconnected-queue-1
  it('RTN7d - pending survive disconnected with queueMessages true', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['after-reconnect'] }],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTN7d-q', { attachOnSubscribe: false });
    await channel.attach();

    // Disconnect, then publish while disconnected (message will be queued)
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    // Publish while disconnected — queued because queueMessages defaults to true
    const result = await channel.publish('queued', 'data');

    expect(result).to.have.property('serials');
    expect(result.serials).to.deep.equal(['after-reconnect']);
    client.close();
  });

  /**
   * RTN19a - Pending messages resent on new transport after disconnect
   */
  // UTS: realtime/unit/RTN19a/resent-on-new-transport-0
  it('RTN19a - pending message resent on new transport', async function () {
    let connectCount = 0;
    const messagesPerConn: any[][] = [[], []];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        const idx = connectCount++;
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          // MESSAGE
          const idx = connectCount - 1;
          if (idx < messagesPerConn.length) {
            messagesPerConn[idx].push(msg);
          }
          // ACK only on second connection
          if (idx >= 1) {
            conn!.send_to_client({
              action: 1,
              msgSerial: msg.msgSerial,
              count: 1,
              res: [{ serials: ['resent-serial'] }],
            });
          }
          // Don't ACK on first connection
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTN19a', { attachOnSubscribe: false });
    await channel.attach();

    // Publish — sent on first transport but not ACKed
    const publishPromise = channel.publish('resend-me', 'data');

    // Wait for message to be sent
    await flushAsync();
    expect(messagesPerConn[0].length).to.equal(1);

    // Disconnect — ably-js will auto-reconnect and resend
    mock.active_connection!.simulate_disconnect();

    // Wait for publish to complete (after reconnect + resend + ACK)
    const result = await publishPromise;

    expect(result.serials).to.deep.equal(['resent-serial']);
    // Message was resent on second transport
    expect(messagesPerConn[1].length).to.be.at.least(1);
    const resentMsg = messagesPerConn[1].find((m: any) => m.messages?.some((m2: any) => m2.name === 'resend-me'));
    expect(resentMsg).to.not.be.undefined;
    client.close();
  });

  /**
   * RTN19a2 - Resent messages keep same msgSerial on successful resume
   */
  // UTS: realtime/unit/RTN19a2/same-serial-on-resume-0
  it('RTN19a2 - resent messages keep msgSerial on successful resume', async function () {
    let connectCount = 0;
    const conn1Msgs: any[] = [];
    const conn2Msgs: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectCount++;
        mock.active_connection = conn;
        if (connectCount === 1) {
          conn.respond_with_connected({
            connectionId: 'conn-1',
            connectionDetails: { connectionKey: 'key-1' } as any,
          });
        } else {
          // Same connectionId = successful resume
          conn.respond_with_connected({
            connectionId: 'conn-1',
            connectionDetails: { connectionKey: 'key-1-resumed' } as any,
          });
        }
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          if (connectCount === 1) {
            conn1Msgs.push(msg);
            // Don't ACK
          } else {
            conn2Msgs.push(msg);
            // ACK on second connection
            conn!.send_to_client({
              action: 1,
              msgSerial: msg.msgSerial,
              count: 1,
              res: [{ serials: [`serial-${msg.msgSerial}`] }],
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTN19a2-resume', { attachOnSubscribe: false });
    await channel.attach();

    // Publish 2 messages without ACK
    const p1 = channel.publish('msg1', 'data1');
    const p2 = channel.publish('msg2', 'data2');

    await flushAsync();
    expect(conn1Msgs.length).to.equal(2);
    const origSerial1 = conn1Msgs[0].msgSerial;
    const origSerial2 = conn1Msgs[1].msgSerial;

    // Disconnect and reconnect (successful resume — same connectionId)
    mock.active_connection!.simulate_disconnect();

    await Promise.all([p1, p2]);

    // Resent messages should keep same msgSerials
    expect(conn2Msgs.length).to.be.at.least(2);
    const resent1 = conn2Msgs.find((m: any) => m.messages?.[0]?.name === 'msg1');
    const resent2 = conn2Msgs.find((m: any) => m.messages?.[0]?.name === 'msg2');
    expect(resent1?.msgSerial).to.equal(origSerial1);
    expect(resent2?.msgSerial).to.equal(origSerial2);
    client.close();
  });

  /**
   * RTN19a2 - Resent messages get new msgSerial on failed resume
   */
  // UTS: realtime/unit/RTN19a2/new-serial-failed-resume-1
  it('RTN19a2 - resent messages get new msgSerial on failed resume', async function () {
    let connectCount = 0;
    const conn1Msgs: any[] = [];
    const conn2Msgs: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectCount++;
        mock.active_connection = conn;
        if (connectCount === 1) {
          conn.respond_with_connected({
            connectionId: 'conn-1',
            connectionDetails: { connectionKey: 'key-1' } as any,
          });
        } else {
          // Different connectionId = failed resume
          conn.respond_with_connected({
            connectionId: 'conn-2',
            connectionDetails: { connectionKey: 'key-2' } as any,
          });
        }
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          if (connectCount === 1) {
            conn1Msgs.push(msg);
            // Don't ACK
          } else {
            conn2Msgs.push(msg);
            conn!.send_to_client({
              action: 1,
              msgSerial: msg.msgSerial,
              count: 1,
              res: [{ serials: [`new-serial-${msg.msgSerial}`] }],
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTN19a2-newid', { attachOnSubscribe: false });
    await channel.attach();

    // Publish 2 messages without ACK
    const p1 = channel.publish('msg1', 'data1');
    const p2 = channel.publish('msg2', 'data2');

    await flushAsync();
    expect(conn1Msgs.length).to.equal(2);

    // Disconnect — reconnect with new connectionId (failed resume)
    mock.active_connection!.simulate_disconnect();

    await Promise.all([p1, p2]);

    // Resent messages should have new msgSerials starting from 0
    expect(conn2Msgs.length).to.be.at.least(2);
    const msgSerials = conn2Msgs.filter((m: any) => m.messages?.length).map((m: any) => m.msgSerial);
    expect(msgSerials).to.include(0);
    expect(msgSerials).to.include(1);
    client.close();
  });

  /**
   * RTN19b - Pending ATTACH resent on new transport after disconnect
   */
  // UTS: realtime/unit/RTN19b/attach-resent-on-reconnect-0
  it('RTN19b - pending ATTACH resent after disconnect', async function () {
    let connectCount = 0;
    const attachMsgsPerConn: any[][] = [[], []];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        const idx = connectCount++;
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          const idx = connectCount - 1;
          if (idx < attachMsgsPerConn.length) {
            attachMsgsPerConn[idx].push(msg);
          }
          // Only respond on second connection
          if (idx >= 1) {
            conn!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          }
          // Don't respond on first connection — leave ATTACHING
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTN19b-attach');

    // Start attach — won't get response on first connection
    const attachPromise = channel.attach();

    await flushAsync();
    expect(attachMsgsPerConn[0].length).to.equal(1);
    expect(channel.state).to.equal('attaching');

    // Disconnect — ably-js reconnects and resends pending ATTACH
    mock.active_connection!.simulate_disconnect();

    await attachPromise;
    expect(channel.state).to.equal('attached');

    // ATTACH was resent on second connection
    expect(attachMsgsPerConn[1].length).to.be.at.least(1);
    client.close();
  });

  /**
   * RTN19b - Pending DETACH resent on new transport after disconnect
   */
  // UTS: realtime/unit/RTN19b/detach-resent-on-reconnect-1
  it('RTN19b - pending DETACH resent after disconnect', async function () {
    let connectCount = 0;
    const detachMsgsPerConn: any[][] = [[], []];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        const idx = connectCount++;
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 12) {
          // DETACH
          const idx = connectCount - 1;
          if (idx < detachMsgsPerConn.length) {
            detachMsgsPerConn[idx].push(msg);
          }
          // Only respond on second connection
          if (idx >= 1) {
            conn!.send_to_client({ action: 13, channel: msg.channel });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTN19b-detach');
    await channel.attach();

    // Start detach — won't get response on first connection
    const detachPromise = channel.detach();

    await flushAsync();
    expect(detachMsgsPerConn[0].length).to.equal(1);
    expect(channel.state).to.equal('detaching');

    // Disconnect — ably-js reconnects and resends pending DETACH
    mock.active_connection!.simulate_disconnect();

    await detachPromise;
    expect(channel.state).to.equal('detached');

    expect(detachMsgsPerConn[1].length).to.be.at.least(1);
    client.close();
  });

  /**
   * RTL6c1 - Publish immediately when CONNECTED and channel ATTACHING
   *
   * Messages are sent immediately when the connection is CONNECTED and the
   * channel is in ATTACHING state (which is neither SUSPENDED nor FAILED).
   */
  // UTS: realtime/unit/RTL6c1/publish-when-attaching-1
  it('RTL6c1 - publish immediately when connected and channel attaching', async function () {
    const capturedMessages: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH — don't respond, leave channel in ATTACHING
        } else if (msg.action === 15) {
          // MESSAGE
          capturedMessages.push(msg);
          mock.active_connection!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
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

    const channel = client.channels.get('test-RTL6c1-attaching', { attachOnSubscribe: false } as any);
    channel.attach().catch(() => {});
    await new Promise<void>((resolve) => {
      if (channel.state === 'attaching') return resolve();
      channel.once('attaching', () => resolve());
    });

    await channel.publish('while-attaching', 'data');

    expect(capturedMessages.length).to.equal(1);
    expect(capturedMessages[0].messages[0].name).to.equal('while-attaching');
    client.close();
  });

  /**
   * RTL6c4 - Publish fails when channel is SUSPENDED
   */
  // UTS: realtime/unit/RTL6c4/fails-conn-suspended-0
  it('RTL6c4 - publish fails when channel suspended', async function () {
    const clock = enableFakeTimers();
    const capturedMessages: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH — don't respond, leave channel hanging so it times out to SUSPENDED
        } else if (msg.action === 15) {
          // MESSAGE
          capturedMessages.push(msg);
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      realtimeRequestTimeout: 100,
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL6c4-ch-suspended', { attachOnSubscribe: false } as any);

    // Start attach — will timeout and channel enters SUSPENDED
    const attachPromise = channel.attach();

    // Advance time past realtimeRequestTimeout so the attach times out
    for (let i = 0; i < 10; i++) {
      await clock.tickAsync(200);
      for (let j = 0; j < 5; j++) {
        clock.tick(0);
        await flushAsync();
      }
      if (channel.state === 'suspended') break;
    }

    // The attach should have failed
    try {
      await attachPromise;
    } catch (e) {
      // Expected — attach timed out
    }

    expect(channel.state).to.equal('suspended');

    const capturedBefore = capturedMessages.length;

    try {
      await channel.publish('fail', 'should-error');
      expect.fail('Expected publish to fail');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }

    // No MESSAGE sent to server
    expect(capturedMessages.length).to.equal(capturedBefore);
    client.close();
  });

  /**
   * RTN7e - Error passed to publish callback represents the reason for the state change
   *
   * Tests that the error passed to the publish callback contains the same
   * reason that caused the connection state change (e.g. the ErrorInfo from
   * a fatal ERROR ProtocolMessage).
   */
  // UTS: realtime/unit/RTN7e/error-represents-reason-4
  it('RTN7e - error passed to publish callback represents the reason for the state change', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          // Don't ACK — instead send a fatal error to force FAILED state
          mock.active_connection!.send_to_client_and_close({
            action: 9, // ERROR (connection-level)
            error: { message: 'Connection closed due to admin action', code: 80019, statusCode: 400 },
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

    const channel = client.channels.get('test-RTN7e-error-reason', { attachOnSubscribe: false });
    await channel.attach();

    // Publish — server responds with fatal ERROR instead of ACK
    const publishPromise = channel.publish('pending', 'data');

    try {
      await publishPromise;
      expect.fail('Should have thrown');
    } catch (err: any) {
      // The error should represent the reason for the state change
      expect(err).to.exist;
      expect(err.code).to.equal(80019);
      expect(err.statusCode).to.equal(400);
      expect(err.message).to.equal('Connection closed due to admin action');
    }

    // Verify the connection entered FAILED with the matching errorReason
    expect(client.connection.state).to.equal('failed');
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(80019);
    client.close();
  });

  /**
   * RTL6c4 - Publish fails when connection is SUSPENDED
   */
  // UTS: realtime/unit/RTL6c4/fails-channel-suspended-3
  it('RTL6c4 - publish fails when connection suspended', async function () {
    const clock = enableFakeTimers();

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        conn.respond_with_refused();
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      disconnectedRetryTimeout: 1000,
      connectionStateTtl: 5000,
    } as any);
    trackClient(client);

    client.connect();

    // Advance time until SUSPENDED
    for (let i = 0; i < 15; i++) {
      await clock.tickAsync(2000);
      for (let j = 0; j < 10; j++) {
        clock.tick(0);
        await flushAsync();
      }
      if (client.connection.state === 'suspended') break;
    }
    expect(client.connection.state).to.equal('suspended');

    const channel = client.channels.get('test-RTL6c4-suspended', { attachOnSubscribe: false } as any);
    try {
      await channel.publish('fail', 'should-error');
      expect.fail('Expected publish to fail');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }
    client.close();
  });
});
