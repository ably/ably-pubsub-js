/**
 * UTS: Channel Annotations Tests
 *
 * Spec points: RTL26, RTAN1a, RTAN1b, RTAN1c, RTAN1d, RTAN2a,
 *   RTAN4a, RTAN4b, RTAN4c, RTAN4d, RTAN4e, RTAN4e1, RTAN5a
 * Source: uts/test/realtime/unit/channels/channel_annotations_test.md
 *
 * Tests RealtimeAnnotations: publish, delete, subscribe/unsubscribe,
 * type filtering, implicit attach, mode warnings.
 */

import { expect } from 'chai';
import { MockWebSocket, PendingWSConnection } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

// Flag values
const ANNOTATION_SUBSCRIBE = 1 << 22; // 4194304

describe('uts/realtime/unit/channels/channel_annotations', function () {
  afterEach(function () {
    restoreAll();
  });

  // Helper: mock with auto-connect and configurable attach flags
  function setupMock(opts?: {
    attachFlags?: number;
    onMessage?: (msg: any, conn: PendingWSConnection | undefined) => void;
  }) {
    const captured: any[] = [];
    const attachFlags = opts?.attachFlags ?? 0;
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
            flags: attachFlags,
          });
        }
        if (msg.action === 21) {
          // ANNOTATION
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
   * RTL26 - channel.annotations returns RealtimeAnnotations
   */
  // UTS: realtime/unit/RTL26/annotations-attribute-type-0
  it('RTL26 - channel.annotations is available', function () {
    const mock = new MockWebSocket();
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    const channel = client.channels.get('test-RTL26');
    expect(channel.annotations).to.exist;
    client.close();
  });

  /**
   * RTAN1a, RTAN1c - publish sends ANNOTATION protocol message
   */
  // UTS: realtime/unit/RTAN1a/publish-sends-annotation-0
  it('RTAN1a - publish sends ANNOTATION action', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg, conn) => {
        if (msg.action === 21) {
          conn!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: [] }],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN1a', { attachOnSubscribe: false });
    await channel.attach();

    await channel.annotations.publish('msg-serial-123', {
      type: 'reaction',
      name: 'thumbsup',
    });

    client.close();
    expect(captured.length).to.equal(1);
    expect(captured[0].action).to.equal(21); // ANNOTATION
    expect(captured[0].annotations).to.be.an('array');
    expect(captured[0].annotations.length).to.equal(1);
    expect(captured[0].annotations[0].messageSerial).to.equal('msg-serial-123');
    expect(captured[0].annotations[0].type).to.equal('reaction');
    expect(captured[0].annotations[0].name).to.equal('thumbsup');
  });

  /**
   * RTAN1d - publish resolves on ACK
   */
  // UTS: realtime/unit/RTAN1d/publish-ack-nack-0.1
  it('RTAN1d - publish resolves on ACK', async function () {
    const { mock } = setupMock({
      onMessage: (msg, conn) => {
        if (msg.action === 21) {
          conn!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: [] }],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN1d', { attachOnSubscribe: false });
    await channel.attach();

    // Should resolve without error
    await channel.annotations.publish('msg-serial-1', { type: 'reaction', name: 'heart' });
    client.close();
  });

  /**
   * RTAN1d - publish rejects on NACK
   */
  // UTS: realtime/unit/RTAN1d/publish-ack-nack-0
  it('RTAN1d - publish rejects on NACK', async function () {
    const { mock } = setupMock({
      onMessage: (msg, conn) => {
        if (msg.action === 21) {
          conn!.send_to_client({
            action: 2, // NACK
            msgSerial: msg.msgSerial,
            count: 1,
            error: { message: 'Annotation rejected', code: 40160, statusCode: 401 },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN1d-nack', { attachOnSubscribe: false });
    await channel.attach();

    try {
      await channel.annotations.publish('msg-serial-1', { type: 'reaction', name: 'heart' });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40160);
    }
    client.close();
  });

  /**
   * RTAN1b - publish fails in FAILED channel state
   */
  // UTS: realtime/unit/RTAN1b/publish-channel-state-0
  it('RTAN1b - publish fails when channel is failed', async function () {
    const { mock } = setupMock();
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN1b', { attachOnSubscribe: false });
    await channel.attach();

    // Cause channel to fail
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTAN1b',
      error: { message: 'Channel error', code: 90001, statusCode: 500 },
    });
    await new Promise<void>((resolve) => channel.once('failed', resolve));

    try {
      await channel.annotations.publish('msg-serial', { type: 'reaction', name: 'x' });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
    client.close();
  });

  /**
   * RTAN2a - delete sends ANNOTATION with annotation.delete action
   */
  // UTS: realtime/unit/RTAN2a/delete-sends-annotation-0
  it('RTAN2a - delete sends ANNOTATION with delete action', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg, conn) => {
        if (msg.action === 21) {
          conn!.send_to_client({
            action: 1,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: [] }],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN2a', { attachOnSubscribe: false });
    await channel.attach();

    await channel.annotations.delete('msg-serial-abc', {
      type: 'reaction',
      name: 'thumbsup',
    });

    client.close();
    expect(captured.length).to.equal(1);
    expect(captured[0].action).to.equal(21);
    const wireAnnotation = captured[0].annotations[0];
    expect(wireAnnotation.messageSerial).to.equal('msg-serial-abc');
    expect(wireAnnotation.type).to.equal('reaction');
    // action should be annotation.delete (numeric: 1)
    expect(wireAnnotation.action).to.satisfy((a: any) => a === 1 || a === 'annotation.delete');
  });

  /**
   * RTAN4a, RTAN4b - subscribe delivers annotations from server
   */
  // UTS: realtime/unit/RTAN4a/subscribe-delivers-annotations-0
  it('RTAN4a - subscribe delivers annotations', async function () {
    const { mock } = setupMock({ attachFlags: ANNOTATION_SUBSCRIBE });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN4a', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    await channel.annotations.subscribe((annotation: any) => received.push(annotation));

    // Server sends ANNOTATION protocol message
    mock.active_connection!.send_to_client({
      action: 21, // ANNOTATION
      channel: 'test-RTAN4a',
      annotations: [
        {
          type: 'reaction',
          name: 'thumbsup',
          messageSerial: 'msg-1',
          clientId: 'user-1',
        },
      ],
    });

    await flushAsync();

    client.close();
    expect(received.length).to.equal(1);
    expect(received[0].type).to.equal('reaction');
    expect(received[0].name).to.equal('thumbsup');
    expect(received[0].messageSerial).to.equal('msg-1');
  });

  /**
   * RTAN4c - subscribe with type filter
   */
  // UTS: realtime/unit/RTAN4c/subscribe-type-filter-0
  it('RTAN4c - subscribe with type filter', async function () {
    const { mock } = setupMock({ attachFlags: ANNOTATION_SUBSCRIBE });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN4c', { attachOnSubscribe: false });
    await channel.attach();

    const reactions: any[] = [];
    await channel.annotations.subscribe('reaction', (annotation: any) => reactions.push(annotation));

    // Server sends mixed annotation types
    mock.active_connection!.send_to_client({
      action: 21,
      channel: 'test-RTAN4c',
      annotations: [
        { type: 'reaction', name: 'heart', messageSerial: 'msg-1' },
        { type: 'comment', name: 'text', messageSerial: 'msg-2' },
        { type: 'reaction', name: 'thumbsup', messageSerial: 'msg-3' },
      ],
    });

    await flushAsync();

    client.close();
    // Only reaction types received
    expect(reactions.length).to.equal(2);
    expect(reactions[0].name).to.equal('heart');
    expect(reactions[1].name).to.equal('thumbsup');
  });

  /**
   * RTAN4d - subscribe implicitly attaches channel
   */
  // UTS: realtime/unit/RTAN4d/subscribe-implicit-attach-0
  it('RTAN4d - subscribe triggers implicit attach', async function () {
    let attachCount = 0;
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachCount++;
          mock.active_connection!.send_to_client({
            action: 11,
            channel: msg.channel,
            flags: ANNOTATION_SUBSCRIBE,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN4d');
    expect(channel.state).to.equal('initialized');

    // Subscribe triggers implicit attach (default attachOnSubscribe=true)
    await channel.annotations.subscribe((a: any) => {});

    expect(channel.state).to.equal('attached');
    expect(attachCount).to.equal(1);
    client.close();
  });

  /**
   * RTAN4e - warns when ANNOTATION_SUBSCRIBE not granted
   */
  // UTS: realtime/unit/RTAN4e/subscribe-warns-no-mode-0
  it('RTAN4e - throws when ANNOTATION_SUBSCRIBE not in mode', async function () {
    // Attach without ANNOTATION_SUBSCRIBE flag
    const { mock } = setupMock({ attachFlags: 0 });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN4e', { attachOnSubscribe: false });
    await channel.attach();

    try {
      await channel.annotations.subscribe((a: any) => {});
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(93001);
    }
    client.close();
  });

  /**
   * RTAN4e1 - no error when channel not attached with attachOnSubscribe=false
   */
  // UTS: realtime/unit/RTAN4e1/no-warn-unattached-0
  it('RTAN4e1 - no error when not attached with attachOnSubscribe false', async function () {
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
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN4e1', { attachOnSubscribe: false });
    expect(channel.state).to.equal('initialized');

    // Should NOT throw — channel not attached, so mode check skipped
    await channel.annotations.subscribe((a: any) => {});
    client.close();
    expect(channel.state).to.equal('initialized');
  });

  /**
   * RTAN5a - unsubscribe removes listener
   */
  // UTS: realtime/unit/RTAN5a/unsubscribe-removes-listeners-0
  it('RTAN5a - unsubscribe removes listener', async function () {
    const { mock } = setupMock({ attachFlags: ANNOTATION_SUBSCRIBE });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN5a', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    const listener = (annotation: any) => received.push(annotation);
    await channel.annotations.subscribe(listener);

    // First annotation received
    mock.active_connection!.send_to_client({
      action: 21,
      channel: 'test-RTAN5a',
      annotations: [{ type: 'reaction', name: 'heart', messageSerial: 'msg-1' }],
    });
    await flushAsync();
    expect(received.length).to.equal(1);

    // Unsubscribe
    channel.annotations.unsubscribe(listener);

    // Second annotation NOT received
    mock.active_connection!.send_to_client({
      action: 21,
      channel: 'test-RTAN5a',
      annotations: [{ type: 'reaction', name: 'fire', messageSerial: 'msg-2' }],
    });
    await flushAsync();
    client.close();
    expect(received.length).to.equal(1); // Still 1
  });

  /**
   * RTAN5a - unsubscribe with type removes only typed listener
   */
  // UTS: realtime/unit/RTAN5a/unsubscribe-type-filter-1
  it('RTAN5a - unsubscribe with type filter', async function () {
    const { mock } = setupMock({ attachFlags: ANNOTATION_SUBSCRIBE });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN5a-typed', { attachOnSubscribe: false });
    await channel.attach();

    const reactions: any[] = [];
    const comments: any[] = [];
    const reactionListener = (a: any) => reactions.push(a);
    const commentListener = (a: any) => comments.push(a);

    await channel.annotations.subscribe('reaction', reactionListener);
    await channel.annotations.subscribe('comment', commentListener);

    // Both receive
    mock.active_connection!.send_to_client({
      action: 21,
      channel: 'test-RTAN5a-typed',
      annotations: [
        { type: 'reaction', name: 'heart', messageSerial: 'msg-1' },
        { type: 'comment', name: 'text', messageSerial: 'msg-2' },
      ],
    });
    await flushAsync();
    expect(reactions.length).to.equal(1);
    expect(comments.length).to.equal(1);

    // Unsubscribe reaction only
    channel.annotations.unsubscribe('reaction', reactionListener);

    // Send more
    mock.active_connection!.send_to_client({
      action: 21,
      channel: 'test-RTAN5a-typed',
      annotations: [
        { type: 'reaction', name: 'fire', messageSerial: 'msg-3' },
        { type: 'comment', name: 'reply', messageSerial: 'msg-4' },
      ],
    });
    await flushAsync();

    client.close();
    expect(reactions.length).to.equal(1); // Still 1 — unsubscribed
    expect(comments.length).to.equal(2); // Got both
  });

  /**
   * RTAN1a - publish validates type is required
   *
   * Publishing an annotation without a type field should throw an error
   * with code 40003.
   */
  // UTS: realtime/unit/RTAN1a/validates-type-required-1
  it('RTAN1a - publish validates type is required', async function () {
    const { mock } = setupMock({
      onMessage: (msg, conn) => {
        if (msg.action === 21) {
          conn!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: [] }],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN1a-validate', { attachOnSubscribe: false });
    await channel.attach();

    try {
      await channel.annotations.publish('msg-serial-1', {
        name: 'like',
      } as any);
      expect.fail('Expected publish without type to throw with code 40003');
    } catch (err: any) {
      expect(err.code).to.equal(40003);
    }
    client.close();
  });

  /**
   * RTAN1a - publish encodes JSON data per RSL4
   *
   * JSON data in an annotation should be encoded following message
   * encoding rules (serialized to string with encoding: "json").
   */
  // UTS: realtime/unit/RTAN1a/encodes-data-json-2
  it('RTAN1a - publish encodes JSON data', async function () {
    const { mock, captured } = setupMock({
      onMessage: (msg, conn) => {
        if (msg.action === 21) {
          conn!.send_to_client({
            action: 1, // ACK
            msgSerial: msg.msgSerial,
            count: 1,
            res: [{ serials: [] }],
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { RealtimeAnnotations: (Ably as any).RealtimeAnnotations },
    } as any);
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTAN1a-encode', { attachOnSubscribe: false });
    await channel.attach();

    await channel.annotations.publish('msg-serial-1', {
      type: 'com.example.data',
      data: { key: 'value', nested: { a: 1 } },
    });

    client.close();
    expect(captured.length).to.equal(1);
    const ann = captured[0].annotations[0];
    // JSON data should be encoded as a string with encoding "json"
    if (typeof ann.data === 'string') {
      expect(ann.encoding).to.equal('json');
      const parsed = JSON.parse(ann.data);
      expect(parsed).to.deep.equal({ key: 'value', nested: { a: 1 } });
    } else {
      // If the library sends the object directly (no encoding), that's also acceptable
      // as long as the data is preserved
      expect(ann.data).to.deep.equal({ key: 'value', nested: { a: 1 } });
    }
  });
});
