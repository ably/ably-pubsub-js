/**
 * UTS: RealtimeChannel PatchMessage Tests
 *
 * Spec points: RTL32b, RTL32b1, RTL32d, RTL32f, MPD3, MPD4, MPD4a, TM2v, TM9
 * Source: uts/realtime/unit/channels/channel_patch_message.md
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, pollUntil, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_patch_message', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * A mock that connects, captures every ProtocolMessage from the client, ACKs
   * each MESSAGE, and attaches a channel if the client asks it to
   */
  function setupMock() {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        captured.push(msg);
        if (msg.action === 10) {
          // ATTACHED with the PUBLISH and MESSAGE_SUBSCRIBE modes
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: (1 << 17) | (1 << 18) });
        } else if (msg.action === 15) {
          // MESSAGE
          conn!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['version-serial-1'] }],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);
    return { mock, captured };
  }

  async function connect() {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));
    return client;
  }

  /** The captured MESSAGE ProtocolMessages */
  function messages(captured: any[]) {
    return captured.filter((pm) => pm.action === 15);
  }

  /** The wire form of a captured message, as JSON.stringify sends it */
  function wireJson(message: any) {
    return JSON.parse(JSON.stringify(message));
  }

  /**
   * RTL32b, RTL32b1, RTL32d - patchMessage sends MESSAGE ProtocolMessage with action MESSAGE_PATCH
   */
  // UTS: realtime/unit/RTL32b1/patch-message-action-0
  it('RTL32b1 - patchMessage sends MESSAGE with action MESSAGE_PATCH', async function () {
    const { captured } = setupMock();
    const client = await connect();
    const channelName = 'test-RTL32-patch';
    const channel = client.channels.get(channelName);

    const result = await channel.patchMessage({
      serial: 'msg-serial-1',
      patches: {
        data: [{ op: 'append', path: '/text', data: 'lo' }],
        extras: { headers: [{ op: 'set', key: 'status', value: 'complete' }] },
      },
    });

    const sent = messages(captured);
    expect(sent).to.have.length(1);
    expect(sent[0].channel).to.equal(channelName);
    expect(sent[0].messages).to.have.length(1);

    const msg = wireJson(sent[0].messages[0]);
    expect(msg.action).to.equal(6);
    expect(msg.serial).to.equal('msg-serial-1');
    expect(msg.patches.data).to.deep.equal([{ op: 'append', path: '/text', data: 'lo' }]);
    expect(msg.patches.extras.headers).to.deep.equal([{ op: 'set', key: 'status', value: 'complete' }]);

    expect(result.versionSerial).to.equal('version-serial-1');

    // The patch was sent without attaching the channel
    expect(captured.some((pm) => pm.action === 10)).to.equal(false);
    expect(channel.state).to.equal('initialized');
    client.close();
  });

  /**
   * RTL32f, MPD3 - patch operation values encoded per MPD3
   */
  // UTS: realtime/unit/RTL32f/patch-values-encoded-0
  it('RTL32f - patch operation values encoded per MPD3', async function () {
    const { captured } = setupMock();
    const client = await connect();
    const channel = client.channels.get('test-RTL32f');

    await channel.patchMessage({
      serial: 's1',
      patches: {
        data: [
          { op: 'set', path: '/obj', data: { b: 1 } },
          { op: 'set', path: '/bin', data: Buffer.from([0x01, 0x02]) },
          { op: 'set', path: '/done', data: true },
        ],
      },
    });

    const ops = wireJson(messages(captured)[0].messages[0]).patches.data;
    expect(JSON.parse(ops[0].data)).to.deep.equal({ b: 1 });
    expect(ops[0].encoding).to.equal('json');
    expect(ops[1].data).to.equal('AQI=');
    expect(ops[1].encoding).to.equal('base64');
    expect(ops[2].data).to.equal('true');
    expect(ops[2].encoding).to.equal('json');
    client.close();
  });

  /**
   * MPD4, TM2v - received MESSAGE_PATCH is decoded and delivered to subscribers
   */
  // UTS: realtime/unit/MPD4/patch-received-decoded-0
  it('MPD4 - received MESSAGE_PATCH is decoded and delivered to subscribers', async function () {
    const { mock } = setupMock();
    const client = await connect();
    const channelName = 'test-MPD4';
    const channel = client.channels.get(channelName);
    const received: any[] = [];
    await channel.subscribe((msg: any) => received.push(msg));

    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: channelName,
      id: 'conn:0',
      timestamp: 1700000002000,
      messages: [
        {
          action: 6,
          serial: 'msg-serial-1',
          version: { serial: 'version-serial-2', timestamp: 1700000002000 },
          patches: {
            data: [
              { op: 'set', path: '/a', data: '{"b":1}', encoding: 'json' },
              { op: 'set', path: '/c', data: 'AQI=', encoding: 'base64' },
              { op: 'append', path: '/d', data: 'text' },
            ],
            extras: { headers: [{ op: 'set', key: 'status', value: 'complete' }] },
          },
        },
      ],
    });
    await pollUntil(() => received.length === 1);

    const msg = received[0];
    expect(msg.action).to.equal('message.patch');
    expect(msg.serial).to.equal('msg-serial-1');
    expect(msg.version.serial).to.equal('version-serial-2');

    const ops = msg.patches.data;
    expect(ops).to.have.length(3);

    // MPD4a - JSON value stays as JSON text
    expect(ops[0].op).to.equal('set');
    expect(ops[0].path).to.equal('/a');
    expect(ops[0].data).to.equal('{"b":1}');
    expect(ops[0].encoding).to.equal('json');

    // MPD4 - Base64 is decoded to binary, leaving no encoding
    expect(Buffer.isBuffer(ops[1].data)).to.equal(true);
    expect([...ops[1].data]).to.deep.equal([0x01, 0x02]);
    expect(ops[1].encoding || null).to.equal(null);

    expect(ops[2].data).to.equal('text');
    expect(ops[2].encoding || null).to.equal(null);

    expect(msg.patches.extras.headers[0]).to.deep.equal({ op: 'set', key: 'status', value: 'complete' });
    client.close();
  });

  /**
   * TM9 - subscriber keeps its message up to date with Message.applyPatch
   */
  // UTS: realtime/unit/TM9/subscriber-applies-patch-0
  it('TM9 - subscriber keeps its message up to date with Message.applyPatch', async function () {
    const { mock } = setupMock();
    const client = await connect();
    const channelName = 'test-TM9-subscriber';
    const channel = client.channels.get(channelName);

    let patchedMessage: any = null;
    let patchesApplied = 0;
    await channel.subscribe((msg: any) => {
      if (msg.action === 'message.create') {
        patchedMessage = msg;
      } else if (msg.action === 'message.patch') {
        patchedMessage = Ably.Realtime.Message.applyPatch(patchedMessage, msg);
        patchesApplied++;
      }
    });

    function sendMessage(msgSerial: string, wireMessage: any) {
      mock.active_connection!.send_to_client({
        action: 15, // MESSAGE
        channel: channelName,
        id: 'conn:' + msgSerial,
        timestamp: 1700000000000,
        messages: [wireMessage],
      });
    }

    sendMessage('0', {
      action: 0,
      serial: 'msg-serial-1',
      clientId: 'author',
      name: 'reply',
      data: '{"text":"Hel","toolCalls":[]}',
      encoding: 'json',
    });
    sendMessage('1', {
      action: 6,
      serial: 'msg-serial-1',
      clientId: 'patcher',
      version: { serial: 'version-serial-2', timestamp: 1700000001000 },
      patches: { data: [{ op: 'append', path: '/text', data: 'lo' }] },
    });
    sendMessage('2', {
      action: 6,
      serial: 'msg-serial-1',
      version: { serial: 'version-serial-3', timestamp: 1700000002000 },
      patches: {
        data: [{ op: 'set', path: '/toolCalls/-', data: '{"name":"search"}', encoding: 'json' }],
        extras: { headers: [{ op: 'set', key: 'status', value: 'complete' }] },
      },
    });
    await pollUntil(() => patchesApplied === 2);

    expect(patchedMessage.action).to.equal('message.update');
    expect(patchedMessage.serial).to.equal('msg-serial-1');
    expect(patchedMessage.version.serial).to.equal('version-serial-3');
    expect(patchedMessage.data).to.deep.equal({ text: 'Hello', toolCalls: [{ name: 'search' }] });
    expect(patchedMessage.extras.headers).to.deep.equal({ status: 'complete' });

    // Kept from the MESSAGE_CREATE, not taken from the patches
    expect(patchedMessage.clientId).to.equal('author');
    expect(patchedMessage.name).to.equal('reply');
    client.close();
  });
});
