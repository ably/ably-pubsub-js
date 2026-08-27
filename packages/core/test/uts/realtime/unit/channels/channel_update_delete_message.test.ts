/**
 * UTS: Channel Update/Delete Message Tests
 *
 * Spec points: RTL32a, RTL32b, RTL32b1, RTL32b2, RTL32c, RTL32d, RTL32e
 * Source: uts/test/realtime/unit/channels/channel_update_delete_message_test.md
 *
 * Tests updateMessage, deleteMessage, appendMessage: wire format,
 * serial validation, immutability, UpdateDeleteResult, NACK, params.
 */

import { expect } from 'chai';
import { MockWebSocket, PendingWSConnection } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_update_delete_message', function () {
  afterEach(function () {
    restoreAll();
  });

  // Helper: standard mock that auto-connects, auto-attaches, and captures messages
  function setupMock(opts?: { onMessage?: (msg: any, conn: PendingWSConnection | undefined) => void }) {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          conn!.send_to_client({
            action: 11,
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
   * RTL32b, RTL32b1 - updateMessage sends MESSAGE with action=message.update
   */
  // UTS: realtime/unit/RTL32b/update-message-action-0
  it('RTL32b - updateMessage sends correct wire format', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['version-serial-1'] }],
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

    const channel = client.channels.get('test-RTL32b-update', { attachOnSubscribe: false });
    await channel.attach();

    await channel.updateMessage({
      serial: 'orig-serial-123',
      name: 'event',
      data: 'updated-data',
    });

    expect(captured.length).to.equal(1);
    expect(captured[0].action).to.equal(15); // MESSAGE
    const wireMsg = captured[0].messages[0];
    expect(wireMsg.serial).to.equal('orig-serial-123');
    expect(wireMsg.data).to.equal('updated-data');
    // message.update = action index 1
    expect(wireMsg.action).to.equal(1);
    client.close();
  });

  /**
   * RTL32b, RTL32b1 - deleteMessage sends MESSAGE with action=message.delete
   */
  // UTS: realtime/unit/RTL32b/delete-message-action-1
  it('RTL32b - deleteMessage sends correct wire format', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['version-serial-1'] }],
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

    const channel = client.channels.get('test-RTL32b-delete', { attachOnSubscribe: false });
    await channel.attach();

    await channel.deleteMessage({ serial: 'orig-serial-456' });

    expect(captured.length).to.equal(1);
    const wireMsg = captured[0].messages[0];
    expect(wireMsg.serial).to.equal('orig-serial-456');
    // message.delete = action index 2
    expect(wireMsg.action).to.equal(2);
    client.close();
  });

  /**
   * RTL32b, RTL32b1 - appendMessage sends MESSAGE with action=message.append
   */
  // UTS: realtime/unit/RTL32b/append-message-action-2
  it('RTL32b - appendMessage sends correct wire format', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['version-serial-1'] }],
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

    const channel = client.channels.get('test-RTL32b-append', { attachOnSubscribe: false });
    await channel.attach();

    await channel.appendMessage({
      serial: 'orig-serial-789',
      data: 'appended-data',
    });

    expect(captured.length).to.equal(1);
    const wireMsg = captured[0].messages[0];
    expect(wireMsg.serial).to.equal('orig-serial-789');
    expect(wireMsg.data).to.equal('appended-data');
    // message.append = action index 5
    expect(wireMsg.action).to.equal(5);
    client.close();
  });

  /**
   * RTL32b2 - version field from MessageOperation
   */
  // UTS: realtime/unit/RTL32b2/version-from-operation-0
  it('RTL32b2 - operation included as version field', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['vs-1'] }],
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

    const channel = client.channels.get('test-RTL32b2', { attachOnSubscribe: false });
    await channel.attach();

    // With operation
    await channel.updateMessage(
      { serial: 'serial-1', data: 'data' },
      { description: 'Edit reason', metadata: { key: 'val' } },
    );

    const wireMsg = captured[0].messages[0];
    expect(wireMsg.version).to.be.an('object');
    expect(wireMsg.version.description).to.equal('Edit reason');
    expect(wireMsg.version.metadata).to.deep.equal({ key: 'val' });
    client.close();
  });

  /**
   * RTL32c - Does not mutate user Message
   */
  // UTS: realtime/unit/RTL32c/no-message-mutation-0
  it('RTL32c - original message not mutated', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['vs-1'] }],
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

    const channel = client.channels.get('test-RTL32c', { attachOnSubscribe: false });
    await channel.attach();

    const original = { serial: 'serial-1', name: 'event', data: 'original-data' };
    await channel.updateMessage(original);

    // Original object should not be mutated
    expect(original.serial).to.equal('serial-1');
    expect(original.name).to.equal('event');
    expect(original.data).to.equal('original-data');
    expect((original as any).action).to.be.undefined;
    client.close();
  });

  /**
   * RTL32d - Returns UpdateDeleteResult with versionSerial from ACK
   */
  // UTS: realtime/unit/RTL32d/ack-returns-result-0
  it('RTL32d - returns UpdateDeleteResult with versionSerial', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['version-abc-123'] }],
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

    const channel = client.channels.get('test-RTL32d', { attachOnSubscribe: false });
    await channel.attach();

    const result = await channel.updateMessage({ serial: 'serial-1', data: 'new' });

    expect(result).to.have.property('versionSerial');
    expect(result.versionSerial).to.equal('version-abc-123');
    client.close();
  });

  /**
   * RTL32d - NACK returns error
   */
  // UTS: realtime/unit/RTL32d/nack-returns-error-1
  it('RTL32d - NACK returns error', async function () {
    const { mock } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 2, // NACK
            msgSerial: msg.msgSerial,
            count: 1,
            error: { message: 'Update rejected', code: 40160, statusCode: 401 },
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

    const channel = client.channels.get('test-RTL32d-nack', { attachOnSubscribe: false });
    await channel.attach();

    try {
      await channel.updateMessage({ serial: 'serial-1', data: 'new' });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40160);
    }
    client.close();
  });

  /**
   * RTL32e - params sent in ProtocolMessage.params
   */
  // UTS: realtime/unit/RTL32e/params-in-protocol-message-0
  it('RTL32e - params included in ProtocolMessage', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg) => {
        if (msg.action === 15) {
          mock.active_connection!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: ['vs-1'] }],
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

    const channel = client.channels.get('test-RTL32e', { attachOnSubscribe: false });
    await channel.attach();

    await channel.updateMessage({ serial: 'serial-1', data: 'data' }, undefined, { key1: 'value1', key2: 'value2' });

    expect(captured.length).to.equal(1);
    expect(captured[0].params).to.deep.equal({ key1: 'value1', key2: 'value2' });
    client.close();
  });

  /**
   * RTL32a - Serial validation: empty serial throws
   */
  // UTS: realtime/unit/RTL32a/serial-validation-required-0
  it('RTL32a - empty serial throws error', async function () {
    const { mock } = setupMock();
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL32a', { attachOnSubscribe: false });
    await channel.attach();

    // No serial
    try {
      await channel.updateMessage({ name: 'event', data: 'data' } as any);
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40003);
    }

    // Empty serial
    try {
      await channel.deleteMessage({ serial: '', data: 'data' });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40003);
    }
    client.close();
  });
});
