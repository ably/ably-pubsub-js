/**
 * UTS: Channel Subscribe Tests
 *
 * Spec points: RTL7a, RTL7b, RTL7f, RTL7g, RTL7h, RTL8a, RTL8b, RTL8c, RTL17
 * Source: uts/test/realtime/unit/channels/channel_subscribe_test.md
 *
 * Tests message subscription, name filtering, implicit attach,
 * echoMessages, and unsubscribe patterns.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_subscribe', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL7a - Subscribe with no name receives all messages
   */
  // UTS: realtime/unit/RTL7a/subscribe-all-messages-0
  it('RTL7a - subscribe receives all messages', async function () {
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

    const channel = client.channels.get('test-RTL7a', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    // Send three messages with different names
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL7a',
      messages: [
        { name: 'msg1', data: 'one' },
        { name: 'msg2', data: 'two' },
        { name: 'msg3', data: 'three' },
      ],
    });

    await flushAsync();

    expect(received.length).to.equal(3);
    expect(received[0].name).to.equal('msg1');
    expect(received[1].name).to.equal('msg2');
    expect(received[2].name).to.equal('msg3');
    client.close();
  });

  /**
   * RTL7b - Subscribe with name only receives matching messages
   */
  // UTS: realtime/unit/RTL7b/name-filtered-subscribe-0
  it('RTL7b - name-filtered subscribe', async function () {
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

    const channel = client.channels.get('test-RTL7b', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe('target', (msg: any) => received.push(msg));

    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL7b',
      messages: [
        { name: 'other', data: 'skip' },
        { name: 'target', data: 'match' },
        { name: 'another', data: 'skip' },
      ],
    });

    await flushAsync();

    expect(received.length).to.equal(1);
    expect(received[0].name).to.equal('target');
    expect(received[0].data).to.equal('match');
    client.close();
  });

  /**
   * RTL7g - Subscribe triggers implicit attach
   */
  // UTS: realtime/unit/RTL7g/implicit-attach-initialized-0
  it('RTL7g - subscribe triggers implicit attach', async function () {
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

    const channel = client.channels.get('test-RTL7g');
    expect(channel.state).to.equal('initialized');

    // Subscribe triggers implicit attach (attachOnSubscribe defaults to true)
    channel.subscribe((msg: any) => {});

    // Wait for implicit attach to complete
    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    expect(channel.state).to.equal('attached');
    expect(attachCount).to.equal(1);
    client.close();
  });

  /**
   * RTL7h - Subscribe does not attach when attachOnSubscribe is false
   */
  // UTS: realtime/unit/RTL7h/no-attach-on-subscribe-0
  it('RTL7h - subscribe without attach when attachOnSubscribe false', async function () {
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

    const channel = client.channels.get('test-RTL7h', { attachOnSubscribe: false });
    expect(channel.state).to.equal('initialized');

    channel.subscribe((msg: any) => {});
    await flushAsync();

    expect(channel.state).to.equal('initialized');
    expect(attachCount).to.equal(0);
    client.close();
  });

  /**
   * RTL7g - Subscribe does not re-attach when already attached
   */
  // UTS: realtime/unit/RTL7g/no-attach-when-attached-3
  it('RTL7g - subscribe does not re-attach when already attached', async function () {
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

    const channel = client.channels.get('test-RTL7g-nodup');
    await channel.attach();
    expect(attachCount).to.equal(1);

    channel.subscribe((msg: any) => {});
    await flushAsync();

    expect(attachCount).to.equal(1);
    client.close();
  });

  /**
   * RTL7f - echoMessages=false sends echo=false in connection URL
   *
   * UTS spec error: The UTS spec tests client-side echo suppression by
   * sending a MESSAGE with matching connectionId and asserting it's not
   * delivered. However, the features spec (RTL7f) only says "ensuring
   * published messages are not echoed back" — it does not specify client-side
   * vs server-side mechanism. ably-js uses server-side suppression via
   * echo=false URL parameter. Test verifies the parameter is set.
   */
  // UTS: realtime/unit/RTL7f/no-echo-messages-0
  it('RTL7f - echoMessages false sets echo param in URL', async function () {
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
      echoMessages: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Check the WebSocket URL has echo=false
    const connUrl = mock.active_connection!.url;
    expect(connUrl.searchParams.get('echo')).to.equal('false');
    client.close();
  });

  /**
   * RTL8a - Unsubscribe specific listener
   */
  // UTS: realtime/unit/RTL8a/unsubscribe-specific-listener-0
  it('RTL8a - unsubscribe specific listener', async function () {
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

    const channel = client.channels.get('test-RTL8a', { attachOnSubscribe: false });
    await channel.attach();

    const received1: any[] = [];
    const received2: any[] = [];
    const listener1 = (msg: any) => received1.push(msg);
    const listener2 = (msg: any) => received2.push(msg);

    channel.subscribe(listener1);
    channel.subscribe(listener2);

    // First message — both listeners get it
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL8a',
      messages: [{ name: 'msg1', data: 'first' }],
    });
    await flushAsync();

    // Unsubscribe listener1
    channel.unsubscribe(listener1);

    // Second message — only listener2 gets it
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL8a',
      messages: [{ name: 'msg2', data: 'second' }],
    });
    await flushAsync();

    expect(received1.length).to.equal(1);
    expect(received2.length).to.equal(2);
    client.close();
  });

  /**
   * RTL8b - Unsubscribe listener from specific name
   */
  // UTS: realtime/unit/RTL8b/unsubscribe-named-listener-0
  it('RTL8b - unsubscribe from specific name', async function () {
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

    const channel = client.channels.get('test-RTL8b', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    const listener = (msg: any) => received.push(msg);

    channel.subscribe('alpha', listener);
    channel.subscribe('beta', listener);

    // First batch
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL8b',
      messages: [
        { name: 'alpha', data: 'a1' },
        { name: 'beta', data: 'b1' },
      ],
    });
    await flushAsync();
    expect(received.length).to.equal(2);

    // Unsubscribe from 'alpha' only
    channel.unsubscribe('alpha', listener);

    // Second batch
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL8b',
      messages: [
        { name: 'alpha', data: 'a2' },
        { name: 'beta', data: 'b2' },
      ],
    });
    await flushAsync();

    // Should have received alpha+beta (2) + beta only (1) = 3
    expect(received.length).to.equal(3);
    expect(received[2].name).to.equal('beta');
    client.close();
  });

  /**
   * RTL8c - Unsubscribe with no args removes all listeners
   */
  // UTS: realtime/unit/RTL8c/unsubscribe-all-listeners-0
  it('RTL8c - unsubscribe all', async function () {
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

    const channel = client.channels.get('test-RTL8c', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));
    channel.subscribe('named', (msg: any) => received.push(msg));

    // First message
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL8c',
      messages: [{ name: 'named', data: 'first' }],
    });
    await flushAsync();
    const countBefore = received.length;
    expect(countBefore).to.be.at.least(1);

    // Unsubscribe all
    channel.unsubscribe();

    // Second message
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL8c',
      messages: [{ name: 'named', data: 'second' }],
    });
    await flushAsync();

    expect(received.length).to.equal(countBefore); // No new messages
    client.close();
  });

  /**
   * RTL17 - Messages not delivered when channel is not ATTACHED
   *
   * Per spec: "No messages should be passed to subscribers if the channel
   * is in any state other than ATTACHED."
   */
  // UTS: realtime/unit/RTL17/no-delivery-when-not-attached-0
  it('RTL17 - messages not delivered when channel is not ATTACHED', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH — don't respond, leave channel in ATTACHING
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

    const channel = client.channels.get('test-RTL17');
    const received: any[] = [];
    channel.subscribe((msg: any) => {
      received.push(msg);
    });

    // Channel should be in ATTACHING (subscribe triggers implicit attach)
    await flushAsync();
    expect(channel.state).to.equal('attaching');

    // Send a MESSAGE while channel is ATTACHING
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL17',
      messages: [{ name: 'premature', data: 'should-not-deliver' }],
    });

    await flushAsync();

    // Message should NOT have been delivered
    expect(received.length).to.equal(0);
    client.close();
  });

  /**
   * RTL7a - Subscribe receives multiple messages from a single ProtocolMessage
   */
  // UTS: realtime/unit/RTL7a/multiple-messages-per-protocol-1
  it('RTL7a - subscribe receives multiple messages from single ProtocolMessage', async function () {
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

    const channel = client.channels.get('test-RTL7a-multi', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    // Server sends a single ProtocolMessage with multiple messages
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL7a-multi',
      messages: [
        { name: 'batch1', data: 'first' },
        { name: 'batch2', data: 'second' },
        { name: 'batch3', data: 'third' },
      ],
    });

    await flushAsync();

    expect(received.length).to.equal(3);
    expect(received[0].name).to.equal('batch1');
    expect(received[1].name).to.equal('batch2');
    expect(received[2].name).to.equal('batch3');
    client.close();
  });

  /**
   * RTL7b - Multiple name-specific subscriptions are independent
   */
  // UTS: realtime/unit/RTL7b/multiple-name-subscriptions-1
  it('RTL7b - multiple name-specific subscriptions are independent', async function () {
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

    const channel = client.channels.get('test-RTL7b-multi', { attachOnSubscribe: false });
    await channel.attach();

    const alphaMessages: any[] = [];
    const betaMessages: any[] = [];

    channel.subscribe('alpha', (msg: any) => alphaMessages.push(msg));
    channel.subscribe('beta', (msg: any) => betaMessages.push(msg));

    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL7b-multi',
      messages: [
        { name: 'alpha', data: 'a1' },
        { name: 'beta', data: 'b1' },
        { name: 'alpha', data: 'a2' },
        { name: 'gamma', data: 'g1' },
      ],
    });

    await flushAsync();

    expect(alphaMessages.length).to.equal(2);
    expect(alphaMessages[0].data).to.equal('a1');
    expect(alphaMessages[1].data).to.equal('a2');

    expect(betaMessages.length).to.equal(1);
    expect(betaMessages[0].data).to.equal('b1');
    client.close();
  });

  /**
   * RTL7g - Subscribe triggers implicit attach from DETACHED state
   */
  // UTS: realtime/unit/RTL7g/implicit-attach-detached-1
  it('RTL7g - subscribe triggers implicit attach from DETACHED state', async function () {
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
            action: 11, // ATTACHED
            channel: msg.channel,
            flags: 0,
          });
        }
        if (msg.action === 12) {
          // DETACH
          mock.active_connection!.send_to_client({
            action: 13, // DETACHED
            channel: msg.channel,
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

    const channel = client.channels.get('test-RTL7g-detached');
    await channel.attach();
    await channel.detach();
    expect(channel.state).to.equal('detached');
    expect(attachCount).to.equal(1);

    // Subscribe should trigger implicit attach from DETACHED
    channel.subscribe((msg: any) => {});

    await new Promise<void>((resolve) => {
      if (channel.state === 'attached') return resolve();
      channel.once('attached', () => resolve());
    });

    expect(channel.state).to.equal('attached');
    expect(attachCount).to.equal(2);
    client.close();
  });

  /**
   * RTL7g - Listener registered even if implicit attach fails
   */
  // UTS: realtime/unit/RTL7g/listener-registered-attach-fails-2
  it('RTL7g - listener registered even if implicit attach fails', async function () {
    let attachAttempts = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachAttempts++;
          if (attachAttempts === 1) {
            // First attach fails with channel error
            mock.active_connection!.send_to_client({
              action: 9, // ERROR
              channel: msg.channel,
              error: { code: 40160, statusCode: 401, message: 'Not permitted' },
            });
          } else {
            // Subsequent attaches succeed
            mock.active_connection!.send_to_client({
              action: 11, // ATTACHED
              channel: msg.channel,
              flags: 0,
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
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL7g-fail');

    const received: any[] = [];
    channel.subscribe((msg: any) => received.push(msg));

    // Wait for channel to enter FAILED from the rejected attach
    await new Promise<void>((resolve) => {
      if (channel.state === 'failed') return resolve();
      channel.once('failed', () => resolve());
    });
    expect(channel.state).to.equal('failed');

    // Re-attach the channel (second attempt will succeed)
    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Verify the listener was registered despite the failed attach
    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL7g-fail',
      messages: [{ name: 'test', data: 'after-reattach' }],
    });

    await flushAsync();

    expect(received.length).to.equal(1);
    expect(received[0].data).to.equal('after-reattach');
    client.close();
  });

  /**
   * RTL7g - Subscribe does not attach when already attaching
   */
  // UTS: realtime/unit/RTL7g/no-attach-when-attaching-4
  it('RTL7g - subscribe does not attach when already attaching', async function () {
    let attachCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH — don't respond, leave channel in ATTACHING
          attachCount++;
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

    const channel = client.channels.get('test-RTL7g-attaching');

    // Start attach but don't complete it
    channel.attach();
    await flushAsync();
    expect(channel.state).to.equal('attaching');
    expect(attachCount).to.equal(1);

    // Subscribe while attaching — should not trigger another attach
    channel.subscribe((msg: any) => {});
    await flushAsync();

    expect(channel.state).to.equal('attaching');
    expect(attachCount).to.equal(1); // No additional ATTACH message sent
    client.close();
  });

  /**
   * RTL7f - echoMessages=false sets echo=false in connection URL
   *
   * ably-js delegates echo suppression to the server via the echo=false
   * URL parameter. It does NOT filter messages client-side by connectionId.
   * This test verifies the URL parameter is set correctly.
   */
  // UTS: realtime/unit/RTL7f/no-echo-messages-0.1
  it('RTL7f - echoMessages false sets echo param in URL', async function () {
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
      echoMessages: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Verify the echo=false parameter is set in the URL
    const connUrl = mock.active_connection!.url;
    expect(connUrl.searchParams.get('echo')).to.equal('false');
    client.close();
  });

  /**
   * RTL22a - Subscribe with MessageFilter matching name
   *
   * Tests that subscribing with a MessageFilter specifying `name` delivers
   * only messages whose name matches the filter.
   */
  // UTS: realtime/unit/RTL22a/filter-matching-name-0
  it('RTL22a - subscribe with name filter', async function () {
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

    const channel = client.channels.get('test-RTL22a-name', { attachOnSubscribe: false });
    await channel.attach();

    const filtered: any[] = [];
    await channel.subscribe({ name: 'target-event' }, (msg: any) => filtered.push(msg));

    // Message with matching name
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-name',
      messages: [{ name: 'target-event', data: 'match-1' }],
    });

    // Message with different name
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-name',
      messages: [{ name: 'other-event', data: 'no-match' }],
    });

    // Another matching message
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-name',
      messages: [{ name: 'target-event', data: 'match-2' }],
    });

    // Message with no name
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-name',
      messages: [{ data: 'no-name' }],
    });

    await flushAsync();

    expect(filtered.length).to.equal(2);
    expect(filtered[0].name).to.equal('target-event');
    expect(filtered[0].data).to.equal('match-1');
    expect(filtered[1].name).to.equal('target-event');
    expect(filtered[1].data).to.equal('match-2');
    client.close();
  });

  /**
   * RTL22a - Subscribe with MessageFilter matching extras.ref.timeserial
   *
   * Tests that subscribing with a MessageFilter specifying `refTimeserial`
   * delivers only messages whose `extras.ref.timeserial` matches.
   */
  // UTS: realtime/unit/RTL22a/filter-matching-ref-timeserial-1
  it('RTL22a - subscribe with refTimeserial filter', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          mock.active_connection!.send_to_client({
            action: 11,
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

    const channel = client.channels.get('test-RTL22a-ref', { attachOnSubscribe: false });
    await channel.attach();

    const filtered: any[] = [];
    await channel.subscribe({ refTimeserial: 'abc123@1700000000000-0' }, (msg: any) => filtered.push(msg));

    // Message with matching extras.ref.timeserial
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-ref',
      messages: [
        {
          name: 'reply',
          data: 'match',
          extras: { ref: { timeserial: 'abc123@1700000000000-0', type: 'com.ably.reply' } },
        },
      ],
    });

    // Message with different extras.ref.timeserial
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-ref',
      messages: [
        {
          name: 'reply',
          data: 'no-match',
          extras: { ref: { timeserial: 'xyz789@1700000000000-0', type: 'com.ably.reply' } },
        },
      ],
    });

    // Message with no extras.ref
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-ref',
      messages: [{ name: 'plain', data: 'no-ref' }],
    });

    // Another message with matching extras.ref.timeserial
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-ref',
      messages: [
        {
          name: 'reaction',
          data: 'match-2',
          extras: { ref: { timeserial: 'abc123@1700000000000-0', type: 'com.ably.reaction' } },
        },
      ],
    });

    await flushAsync();

    expect(filtered.length).to.equal(2);
    expect(filtered[0].data).to.equal('match');
    expect(filtered[1].data).to.equal('match-2');
    client.close();
  });

  /**
   * RTL22b - Subscribe with MessageFilter isRef false delivers only
   * messages without extras.ref
   */
  // UTS: realtime/unit/RTL22b/filter-isref-false-0
  it('RTL22b - subscribe with isRef false filter', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          mock.active_connection!.send_to_client({
            action: 11,
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

    const channel = client.channels.get('test-RTL22b-isref', { attachOnSubscribe: false });
    await channel.attach();

    const filtered: any[] = [];
    await channel.subscribe({ isRef: false }, (msg: any) => filtered.push(msg));

    // Message WITHOUT extras.ref (no extras at all) — should be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22b-isref',
      messages: [{ name: 'plain', data: 'no-extras' }],
    });

    // Message WITH extras.ref — should NOT be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22b-isref',
      messages: [
        {
          name: 'reply',
          data: 'has-ref',
          extras: { ref: { timeserial: 'abc123@1700000000000-0', type: 'com.ably.reply' } },
        },
      ],
    });

    // Message with extras but no ref field — should be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22b-isref',
      messages: [
        {
          name: 'annotated',
          data: 'extras-no-ref',
          extras: { headers: { 'custom-key': 'custom-value' } },
        },
      ],
    });

    // Another message WITH extras.ref — should NOT be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22b-isref',
      messages: [
        {
          name: 'reaction',
          data: 'also-has-ref',
          extras: { ref: { timeserial: 'xyz789@1700000000000-0', type: 'com.ably.reaction' } },
        },
      ],
    });

    await flushAsync();

    expect(filtered.length).to.equal(2);
    expect(filtered[0].name).to.equal('plain');
    expect(filtered[0].data).to.equal('no-extras');
    expect(filtered[1].name).to.equal('annotated');
    expect(filtered[1].data).to.equal('extras-no-ref');
    client.close();
  });

  /**
   * RTL22c - Subscribe with MessageFilter matching multiple criteria (name + refType)
   *
   * Tests that when a MessageFilter specifies multiple criteria (name AND refType),
   * only messages matching ALL criteria are delivered.
   */
  // UTS: realtime/unit/RTL22c/filter-multiple-criteria-0
  it('RTL22c - subscribe with multiple criteria filter (name + refType)', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          mock.active_connection!.send_to_client({
            action: 11,
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

    const channel = client.channels.get('test-RTL22c-multi', { attachOnSubscribe: false });
    await channel.attach();

    const filtered: any[] = [];
    await channel.subscribe({ name: 'comment', refType: 'com.ably.reply' }, (msg: any) => filtered.push(msg));

    // Message matching BOTH name AND refType — should be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22c-multi',
      messages: [
        {
          name: 'comment',
          data: 'both-match',
          extras: { ref: { timeserial: 'abc@1700000000000-0', type: 'com.ably.reply' } },
        },
      ],
    });

    // Message matching name but NOT refType — should NOT be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22c-multi',
      messages: [
        {
          name: 'comment',
          data: 'name-only',
          extras: { ref: { timeserial: 'def@1700000000000-0', type: 'com.ably.reaction' } },
        },
      ],
    });

    // Message matching refType but NOT name — should NOT be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22c-multi',
      messages: [
        {
          name: 'update',
          data: 'type-only',
          extras: { ref: { timeserial: 'ghi@1700000000000-0', type: 'com.ably.reply' } },
        },
      ],
    });

    // Message matching NEITHER — should NOT be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22c-multi',
      messages: [{ name: 'update', data: 'neither' }],
    });

    // Another message matching BOTH — should be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22c-multi',
      messages: [
        {
          name: 'comment',
          data: 'both-match-2',
          extras: { ref: { timeserial: 'jkl@1700000000000-0', type: 'com.ably.reply' } },
        },
      ],
    });

    await flushAsync();

    expect(filtered.length).to.equal(2);
    expect(filtered[0].data).to.equal('both-match');
    expect(filtered[1].data).to.equal('both-match-2');
    client.close();
  });

  /**
   * RTL22a, MFI2e - Subscribe with MessageFilter matching clientId
   *
   * Tests that subscribing with a MessageFilter specifying `clientId` delivers
   * only messages whose clientId matches the filter value.
   */
  // UTS: realtime/unit/RTL22a/filter-matching-clientid-2
  it('RTL22a+MFI2e - subscribe with clientId filter', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          mock.active_connection!.send_to_client({
            action: 11,
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

    const channel = client.channels.get('test-RTL22a-clientid', { attachOnSubscribe: false });
    await channel.attach();

    const filtered: any[] = [];
    await channel.subscribe({ clientId: 'user-42' }, (msg: any) => filtered.push(msg));

    // Message with matching clientId
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-clientid',
      messages: [{ name: 'chat', data: 'hello', clientId: 'user-42' }],
    });

    // Message with different clientId — should NOT be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-clientid',
      messages: [{ name: 'chat', data: 'hi', clientId: 'user-99' }],
    });

    // Message with no clientId — should NOT be delivered
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-clientid',
      messages: [{ name: 'system', data: 'broadcast' }],
    });

    // Another message with matching clientId
    mock.active_connection!.send_to_client({
      action: 15,
      channel: 'test-RTL22a-clientid',
      messages: [{ name: 'chat', data: 'world', clientId: 'user-42' }],
    });

    await flushAsync();

    expect(filtered.length).to.equal(2);
    expect(filtered[0].data).to.equal('hello');
    expect(filtered[0].clientId).to.equal('user-42');
    expect(filtered[1].data).to.equal('world');
    expect(filtered[1].clientId).to.equal('user-42');
    client.close();
  });

  /**
   * RTL8a - Unsubscribe listener not currently subscribed is no-op
   */
  // UTS: realtime/unit/RTL8a/unsubscribe-noop-not-subscribed-1
  it('RTL8a - unsubscribe non-subscribed listener is no-op', async function () {
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

    const channel = client.channels.get('test-RTL8a-noop', { attachOnSubscribe: false });
    await channel.attach();

    const received: any[] = [];
    const activeListener = (msg: any) => received.push(msg);
    const unusedListener = (msg: any) => {};

    channel.subscribe(activeListener);

    // Unsubscribe a listener that was never subscribed — should be no-op
    channel.unsubscribe(unusedListener);

    mock.active_connection!.send_to_client({
      action: 15, // MESSAGE
      channel: 'test-RTL8a-noop',
      messages: [{ name: 'test', data: 'still-works' }],
    });

    await flushAsync();

    // Existing subscription should be unaffected
    expect(received.length).to.equal(1);
    expect(received[0].data).to.equal('still-works');
    client.close();
  });
});
