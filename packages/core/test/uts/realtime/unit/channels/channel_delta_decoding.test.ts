/**
 * UTS: Channel Delta Decoding Tests
 *
 * Spec points: RTL18, RTL18a, RTL18b, RTL18c, RTL19, RTL19a, RTL19b, RTL19c,
 *              RTL20, RTL21, PC3, PC3a
 * Source: specification/uts/realtime/unit/channels/channel_delta_decoding.md
 *
 * Tests delta message decoding via the VCDiff plugin. In ably-js, the plugin
 * is passed via `options.plugins.vcdiff` with a `decode(delta, base)` method.
 *
 * Mock VCDiff: The "delta" is just the target value itself (pass-through).
 * Tests use encoding "utf-8/vcdiff" so the result is decoded to string.
 *
 * Protocol actions: CONNECTED=4, ATTACH=10, ATTACHED=11, MESSAGE=15
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

const mockVcdiffPlugin = {
  decode(delta: any, base: any): any {
    return delta;
  },
};

function createRecordingPlugin() {
  const calls: any[] = [];
  return {
    calls,
    decode(delta: any, base: any): any {
      calls.push({ delta: Buffer.from(delta), base: Buffer.from(base) });
      return delta;
    },
  };
}

function createFailingPlugin() {
  return {
    decode(): never {
      throw new Error('Simulated decode failure');
    },
  };
}

function setupConnectedClient(mock: MockWebSocket, plugin?: any) {
  const opts: any = {
    key: 'appId.keyId:keySecret',
    autoConnect: false,
    useBinaryProtocol: false,
  };
  if (plugin) {
    opts.plugins = { vcdiff: plugin };
  }
  const client = new Ably.Realtime(opts);
  trackClient(client);
  return client;
}

function createMockWithAutoAttach(channelName: string) {
  const mock = new MockWebSocket({
    onConnectionAttempt: (conn) => {
      mock.active_connection = conn;
      conn.respond_with_connected();
    },
    onMessageFromClient: (msg, conn) => {
      if (msg.action === 10) {
        conn!.send_to_client({ action: 11, channel: msg.channel });
      }
    },
  });
  return mock;
}

describe('uts/realtime/unit/channels/channel_delta_decoding', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL21 - Messages in array decoded in ascending index order
   *
   * Multiple messages in a ProtocolMessage where later messages are deltas
   * referencing earlier ones — works because processing is in array order.
   */
  // UTS: realtime/unit/RTL21/ascending-index-order-0
  it('RTL21 - messages decoded in ascending index order', async function () {
    const channelName = 'test-RTL21';
    const received: any[] = [];

    const mock = createMockWithAutoAttach(channelName);
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, mockVcdiffPlugin);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    await channel.attach();

    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'serial:0',
      messages: [
        { id: 'serial:0', data: 'first message', encoding: null },
        {
          id: 'serial:1',
          data: Buffer.from('second message').toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'serial:0', format: 'vcdiff' } },
        },
        {
          id: 'serial:2',
          data: Buffer.from('third message').toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'serial:1', format: 'vcdiff' } },
        },
      ],
    });

    await flushAsync();
    expect(received.length).to.equal(3);
    expect(received[0].data).to.equal('first message');
    expect(received[1].data).to.equal('second message');
    expect(received[2].data).to.equal('third message');
    client.close();
  });

  /**
   * RTL19b - Non-delta message stores base payload
   */
  // UTS: realtime/unit/RTL19b/stores-base-payload-0
  it('RTL19b - non-delta then delta succeeds', async function () {
    const channelName = 'test-RTL19b';
    const received: any[] = [];

    const mock = createMockWithAutoAttach(channelName);
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, mockVcdiffPlugin);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    await channel.attach();

    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      messages: [{ id: 'msg-1:0', data: 'base payload', encoding: null }],
    });
    await flushAsync();

    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from('updated payload').toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'msg-1:0', format: 'vcdiff' } },
        },
      ],
    });
    await flushAsync();

    expect(received.length).to.equal(2);
    expect(received[0].data).to.equal('base payload');
    expect(received[1].data).to.equal('updated payload');
    client.close();
  });

  /**
   * RTL19c - Delta application result stored as new base payload (chained)
   */
  // UTS: realtime/unit/RTL19c/delta-result-becomes-base-0
  it('RTL19c - chained deltas decode correctly', async function () {
    const channelName = 'test-RTL19c';
    const received: any[] = [];

    const mock = createMockWithAutoAttach(channelName);
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, mockVcdiffPlugin);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    await channel.attach();

    // Message 1: non-delta
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      messages: [{ id: 'msg-1:0', data: 'value-A', encoding: null }],
    });
    await flushAsync();

    // Message 2: delta from msg-1
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from('value-B').toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'msg-1:0', format: 'vcdiff' } },
        },
      ],
    });
    await flushAsync();

    // Message 3: delta from msg-2 (verifies base updated to value-B)
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-3:0',
      messages: [
        {
          id: 'msg-3:0',
          data: Buffer.from('value-C').toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'msg-2:0', format: 'vcdiff' } },
        },
      ],
    });
    await flushAsync();

    expect(received.length).to.equal(3);
    expect(received[0].data).to.equal('value-A');
    expect(received[1].data).to.equal('value-B');
    expect(received[2].data).to.equal('value-C');
    client.close();
  });

  /**
   * RTL20 - Last message ID updated after successful decode
   */
  // UTS: realtime/unit/RTL20/last-id-updated-on-decode-1
  it('RTL20 - last message ID updated correctly', async function () {
    const channelName = 'test-RTL20-id';
    const received: any[] = [];

    const mock = createMockWithAutoAttach(channelName);
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, mockVcdiffPlugin);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    await channel.attach();

    // ProtocolMessage with 2 messages — last ID should be serial:1
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'serial:0',
      messages: [
        { id: 'serial:0', data: 'first', encoding: null },
        { id: 'serial:1', data: 'second', encoding: null },
      ],
    });
    await flushAsync();

    // Delta referencing serial:1 (the last message) — should succeed
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from('third').toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'serial:1', format: 'vcdiff' } },
        },
      ],
    });
    await flushAsync();

    expect(received.length).to.equal(3);
    expect(received[0].data).to.equal('first');
    expect(received[1].data).to.equal('second');
    expect(received[2].data).to.equal('third');
    client.close();
  });

  /**
   * RTL20 - Delta with mismatched base message ID triggers recovery
   */
  // UTS: realtime/unit/RTL20/mismatched-id-triggers-recovery-0
  it('RTL20 - mismatched base ID triggers recovery', async function () {
    const channelName = 'test-RTL20-mismatch';
    const attachMessages: any[] = [];
    const stateChanges: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          attachMessages.push(msg);
          conn!.send_to_client({ action: 11, channel: msg.channel });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, mockVcdiffPlugin);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    await channel.attach();

    // Establish base
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      channelSerial: 'serial-1',
      messages: [{ id: 'msg-1:0', data: 'base payload', encoding: null }],
    });
    await flushAsync();

    const initialAttachCount = attachMessages.length;
    channel.on((change: any) => stateChanges.push(change));

    // Delta with wrong base ID
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from('delta-data').toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'msg-999:0', format: 'vcdiff' } },
        },
      ],
    });

    await new Promise<void>((r) => {
      if (channel.state === 'attaching') return r();
      channel.once('attaching', () => r());
    });

    expect(attachMessages.length).to.be.greaterThan(initialAttachCount);
    const recoveryAttach = attachMessages[attachMessages.length - 1];
    expect(recoveryAttach.channelSerial).to.equal('serial-1');

    const attachingChange = stateChanges.find((c: any) => c.current === 'attaching');
    expect(attachingChange).to.not.be.undefined;
    expect(attachingChange.reason.code).to.equal(40018);
    client.close();
  });

  /**
   * PC3 - No vcdiff plugin causes FAILED state
   */
  // UTS: realtime/unit/PC3/no-plugin-fails-1
  it('PC3 - no vcdiff plugin causes channel FAILED', async function () {
    const channelName = 'test-PC3-no-plugin';
    const stateChanges: any[] = [];

    const mock = createMockWithAutoAttach(channelName);
    installMockWebSocket(mock.constructorFn);

    // No vcdiff plugin
    const client = setupConnectedClient(mock);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.on((change: any) => stateChanges.push(change));
    await channel.attach();

    stateChanges.length = 0;

    // Base message first (so lastPayload.messageId is set)
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-0:0',
      messages: [{ id: 'msg-0:0', data: 'base', encoding: null }],
    });
    await flushAsync();

    // Delta message without plugin
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      messages: [
        {
          id: 'msg-1:0',
          data: Buffer.from('some-delta').toString('base64'),
          encoding: 'vcdiff/base64',
          extras: { delta: { from: 'msg-0:0', format: 'vcdiff' } },
        },
      ],
    });

    await new Promise<void>((r) => {
      if (channel.state === 'failed') return r();
      channel.once('failed', () => r());
    });

    expect(channel.state).to.equal('failed');
    expect(channel.errorReason!.code).to.equal(40019);
    client.close();
  });

  /**
   * RTL18 - Decode failure triggers recovery (RTL18a, RTL18b, RTL18c)
   */
  // UTS: realtime/unit/RTL18/decode-failure-recovery-0
  it('RTL18 - decode failure triggers recovery', async function () {
    const channelName = 'test-RTL18-recovery';
    const received: any[] = [];
    const attachMessages: any[] = [];
    const stateChanges: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          attachMessages.push(msg);
          conn!.send_to_client({ action: 11, channel: msg.channel });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, createFailingPlugin());
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    channel.on((change: any) => stateChanges.push(change));
    await channel.attach();

    // Establish base with non-delta
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      channelSerial: 'serial-100',
      messages: [{ id: 'msg-1:0', data: 'base payload', encoding: null }],
    });
    await flushAsync();
    expect(received.length).to.equal(1);

    stateChanges.length = 0;
    const initialAttachCount = attachMessages.length;

    // Delta message that will fail to decode
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      channelSerial: 'serial-200',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from('fake-delta').toString('base64'),
          encoding: 'vcdiff/base64',
          extras: { delta: { from: 'msg-1:0', format: 'vcdiff' } },
        },
      ],
    });

    await new Promise<void>((r) => {
      if (channel.state === 'attaching') return r();
      channel.once('attaching', () => r());
    });

    // RTL18b: failed message NOT delivered
    expect(received.length).to.equal(1);
    expect(received[0].data).to.equal('base payload');

    // RTL18c: recovery ATTACH sent
    expect(attachMessages.length).to.be.greaterThan(initialAttachCount);
    const recoveryAttach = attachMessages[attachMessages.length - 1];
    expect(recoveryAttach.channelSerial).to.equal('serial-100');

    // RTL18c: attaching state with error 40018
    const attachingChange = stateChanges.find((c: any) => c.current === 'attaching');
    expect(attachingChange).to.not.be.undefined;
    expect(attachingChange.reason.code).to.equal(40018);
    client.close();
  });

  /**
   * RTL18c - Recovery completes when server sends ATTACHED
   */
  // UTS: realtime/unit/RTL18c/recovery-completes-on-attached-0
  it('RTL18c - recovery completes and new messages work', async function () {
    const channelName = 'test-RTL18c';
    const received: any[] = [];
    let decodeAttempt = 0;

    const conditionalPlugin = {
      decode(delta: any, base: any): any {
        decodeAttempt++;
        if (decodeAttempt === 1) throw new Error('Simulated failure');
        return delta;
      },
    };

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, conditionalPlugin);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    await channel.attach();

    // Base message
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      channelSerial: 'serial-1',
      messages: [{ id: 'msg-1:0', data: 'original base', encoding: null }],
    });
    await flushAsync();

    // Delta that fails on first attempt → triggers recovery → ATTACHING → ATTACHED
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      channelSerial: 'serial-2',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from('bad-delta').toString('base64'),
          encoding: 'vcdiff/base64',
          extras: { delta: { from: 'msg-1:0', format: 'vcdiff' } },
        },
      ],
    });

    // Wait for recovery: first attaching (recovery starts), then attached (recovery completes)
    await new Promise<void>((r) => {
      if (channel.state === 'attaching') {
        channel.once('attached', () => r());
      } else {
        channel.once('attaching', () => {
          channel.once('attached', () => r());
        });
      }
    });

    // Fresh message after recovery
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-3:0',
      channelSerial: 'serial-3',
      messages: [{ id: 'msg-3:0', data: 'fresh after recovery', encoding: null }],
    });
    await flushAsync();

    expect(channel.state).to.equal('attached');
    expect(received[0].data).to.equal('original base');
    expect(received[received.length - 1].data).to.equal('fresh after recovery');
    client.close();
  });

  /**
   * RTL18 - Only one recovery in progress at a time
   */
  // UTS: realtime/unit/RTL18/single-recovery-at-time-1
  it('RTL18 - only one recovery at a time', async function () {
    const channelName = 'test-RTL18-single';
    const attachMessages: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          attachMessages.push(msg);
          // Only respond to initial attach (first one)
          if (attachMessages.length === 1) {
            conn!.send_to_client({ action: 11, channel: msg.channel });
          }
          // Don't respond to recovery attach — leave recovery in progress
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, createFailingPlugin());
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    await channel.attach();

    const initialAttachCount = attachMessages.length;

    // Base message
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      channelSerial: 'serial-1',
      messages: [{ id: 'msg-1:0', data: 'base', encoding: null }],
    });
    await flushAsync();

    // First failed delta → triggers recovery
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from('bad-1').toString('base64'),
          encoding: 'vcdiff/base64',
          extras: { delta: { from: 'msg-1:0', format: 'vcdiff' } },
        },
      ],
    });
    await new Promise<void>((r) => {
      if (channel.state === 'attaching') return r();
      channel.once('attaching', () => r());
    });

    // Second failed delta while recovery in progress
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-3:0',
      messages: [
        {
          id: 'msg-3:0',
          data: Buffer.from('bad-2').toString('base64'),
          encoding: 'vcdiff/base64',
          extras: { delta: { from: 'msg-2:0', format: 'vcdiff' } },
        },
      ],
    });
    await flushAsync();

    // Only one recovery ATTACH was sent
    const recoveryAttaches = attachMessages.length - initialAttachCount;
    expect(recoveryAttaches).to.equal(1);
    client.close();
  });

  /**
   * RTL19a - Base64 encoding step decoded before storing base payload
   *
   * When a non-delta message arrives with encoding containing a base64 step
   * (e.g. "base64"), the SDK decodes the base64 before storing the base
   * payload for future delta application.
   */
  // UTS: realtime/unit/RTL19a/base64-decoded-before-store-0
  it('RTL19a - base64 decoded before storing base payload', async function () {
    const channelName = 'test-RTL19a';
    const received: any[] = [];

    const mock = createMockWithAutoAttach(channelName);
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, mockVcdiffPlugin);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    await channel.attach();

    // Send a non-delta message with base64 encoding.
    // The wire data is base64("Hello") = "SGVsbG8="
    // After decoding, subscriber sees a Buffer. The stored base payload
    // should be the decoded binary, not the base64 string.
    const baseBinary = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
    const baseAsBase64 = baseBinary.toString('base64'); // "SGVsbG8="

    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      messages: [
        {
          id: 'msg-1:0',
          data: baseAsBase64,
          encoding: 'base64',
        },
      ],
    });
    await flushAsync();

    // Now send a delta referencing the binary base payload.
    // The mock vcdiff decoder is pass-through, so delta data = new value.
    const newBinary = Buffer.from([0x57, 0x6f, 0x72, 0x6c, 0x64]); // "World"
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      messages: [
        {
          id: 'msg-2:0',
          data: newBinary.toString('base64'),
          encoding: 'vcdiff/base64',
          extras: { delta: { from: 'msg-1:0', format: 'vcdiff' } },
        },
      ],
    });
    await flushAsync();

    expect(received.length).to.equal(2);
    // First message: base64 decoded to binary buffer
    expect(Buffer.isBuffer(received[0].data) || received[0].data instanceof Uint8Array).to.be.true;
    expect(Buffer.from(received[0].data).compare(baseBinary)).to.equal(0);
    // Second message: delta decoded using binary base, delivered as binary
    expect(Buffer.isBuffer(received[1].data) || received[1].data instanceof Uint8Array).to.be.true;
    expect(Buffer.from(received[1].data).compare(newBinary)).to.equal(0);
    client.close();
  });

  /**
   * RTL19b - JSON-encoded non-delta message stores wire-form base payload
   *
   * When a non-delta message has encoding: "json", the stored base payload
   * is the wire-form (JSON string), not the decoded object. This is critical
   * because the vcdiff delta is computed by the server against the wire-form.
   */
  // UTS: realtime/unit/RTL19b/json-wire-form-base-1
  it('RTL19b - JSON-encoded non-delta stores wire-form base', async function () {
    const channelName = 'test-RTL19b-json';
    const received: any[] = [];

    const mock = createMockWithAutoAttach(channelName);
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, mockVcdiffPlugin);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    await channel.attach();

    // Send a non-delta message with JSON encoding.
    // The wire data is a JSON string; after decoding, the subscriber sees an object.
    // The base payload stored for delta decoding should be the JSON string,
    // not the parsed object.
    const jsonString = '{"foo":"bar","count":1}';

    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      messages: [
        {
          id: 'msg-1:0',
          data: jsonString,
          encoding: 'json',
        },
      ],
    });
    await flushAsync();

    // Send a delta referencing the JSON string base.
    // The delta is computed against the JSON string, not the parsed object.
    // The mock vcdiff decoder is pass-through, so delta data = new value.
    const newJsonString = '{"foo":"baz","count":2}';

    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from(newJsonString).toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'msg-1:0', format: 'vcdiff' } },
        },
      ],
    });
    await flushAsync();

    expect(received.length).to.equal(2);
    // First message: subscriber receives the parsed JSON object
    expect(received[0].data).to.deep.equal({ foo: 'bar', count: 1 });
    // Second message: delta decoded against JSON string base, then utf-8 decoded
    // to produce the new JSON string, which is delivered as-is (no json encoding
    // step in the delta message's encoding)
    expect(received[1].data).to.equal(newJsonString);
    client.close();
  });

  /**
   * PC3, PC3a - VCDiff plugin decodes delta messages
   */
  // UTS: realtime/unit/PC3/vcdiff-plugin-decodes-0
  it('PC3 - vcdiff plugin called with correct arguments', async function () {
    const channelName = 'test-PC3';
    const received: any[] = [];
    const recording = createRecordingPlugin();

    const mock = createMockWithAutoAttach(channelName);
    installMockWebSocket(mock.constructorFn);

    const client = setupConnectedClient(mock, recording);
    client.connect();
    await new Promise<void>((r) => client.connection.once('connected', r));

    const channel = client.channels.get(channelName);
    channel.subscribe((msg: any) => received.push(msg));
    await channel.attach();

    // Non-delta message (string base)
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-1:0',
      messages: [{ id: 'msg-1:0', data: 'hello world', encoding: null }],
    });
    await flushAsync();

    // Delta message
    mock.active_connection!.send_to_client({
      action: 15,
      channel: channelName,
      id: 'msg-2:0',
      messages: [
        {
          id: 'msg-2:0',
          data: Buffer.from('goodbye world').toString('base64'),
          encoding: 'utf-8/vcdiff/base64',
          extras: { delta: { from: 'msg-1:0', format: 'vcdiff' } },
        },
      ],
    });
    await flushAsync();

    // PC3: decoder was called
    expect(recording.calls.length).to.equal(1);

    // PC3a: base was UTF-8 encoded to binary
    expect(recording.calls[0].base.toString('utf-8')).to.equal('hello world');

    // Result delivered
    expect(received[1].data).to.equal('goodbye world');
    client.close();
  });
});
