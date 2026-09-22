/**
 * UTS: Channel Detach Tests
 *
 * Spec points: RTL5a, RTL5b, RTL5d, RTL5f, RTL5i, RTL5j, RTL5k, RTL5l
 * Source: uts/test/realtime/unit/channels/channel_detach_test.md
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, enableFakeTimers, restoreAll, trackClient, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_detach', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL5a - Detach when initialized
   */
  // UTS: realtime/unit/RTL5a/detach-initialized-noop-0
  it('RTL5a - detach from initialized state', async function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTL5a-init');
    expect(channel.state).to.equal('initialized');

    await channel.detach();
    client.close();
    expect(channel.state).to.satisfy((s: string) => s === 'initialized' || s === 'detached');
  });

  /**
   * RTL5a - Detach when already detached is no-op
   */
  // UTS: realtime/unit/RTL5a/detach-already-detached-noop-1
  it('RTL5a - detach when already detached is no-op', async function () {
    let detachMessageCount = 0;

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
        if (msg.action === 12) {
          // DETACH
          detachMessageCount++;
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

    const channel = client.channels.get('test-RTL5a-detached');
    await channel.attach();
    await channel.detach();
    expect(channel.state).to.equal('detached');
    expect(detachMessageCount).to.equal(1);

    // Second detach should be no-op
    await channel.detach();
    client.close();
    expect(channel.state).to.equal('detached');
    expect(detachMessageCount).to.equal(1);
  });

  /**
   * RTL5i - Concurrent detach while detaching waits for completion
   */
  // UTS: realtime/unit/RTL5i/detach-while-detaching-0
  it('RTL5i - concurrent detach while detaching', async function () {
    let detachMessageCount = 0;
    let pendingDetachChannel: string | null = null;

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
        if (msg.action === 12) {
          // DETACH
          detachMessageCount++;
          pendingDetachChannel = msg.channel;
          // Don't respond — let test control timing
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

    const channel = client.channels.get('test-RTL5i');
    await channel.attach();

    // Start first detach
    const detach1 = channel.detach();

    // Wait for detaching state
    await new Promise<void>((resolve) => {
      if (channel.state === 'detaching') return resolve();
      channel.once('detaching', () => resolve());
    });

    // Start second detach while detaching
    const detach2 = channel.detach();

    // Now respond with DETACHED
    mock.active_connection!.send_to_client({
      action: 13, // DETACHED
      channel: pendingDetachChannel!,
    });

    await detach1;
    await detach2;

    client.close();
    expect(channel.state).to.equal('detached');
    expect(detachMessageCount).to.equal(1);
  });

  /**
   * RTL5b - Detach from failed state results in error
   */
  // UTS: realtime/unit/RTL5b/detach-failed-errors-0
  it('RTL5b - detach from failed state errors', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 9, // ERROR
            channel: msg.channel,
            error: {
              message: 'Channel denied',
              code: 40160,
              statusCode: 401,
            },
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

    const channel = client.channels.get('test-RTL5b');

    // Attach fails → channel enters FAILED
    try {
      await channel.attach();
    } catch (err) {
      // Expected
    }
    expect(channel.state).to.equal('failed');

    // Detach from FAILED should throw
    try {
      await channel.detach();
      expect.fail('Expected detach to throw');
    } catch (err: any) {
      expect(err).to.not.be.null;
      expect(err.code).to.equal(90001);
    }
    client.close();
    expect(channel.state).to.equal('failed');
  });

  /**
   * RTL5j - Detach from suspended transitions to detached immediately
   */
  // UTS: realtime/unit/RTL5j/detach-suspended-to-detached-0
  it('RTL5j - detach from suspended is immediate', async function () {
    let detachMessageCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          // Don't respond — let it timeout
        }
        if (msg.action === 12) {
          // DETACH
          detachMessageCount++;
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      realtimeRequestTimeout: 100,
    });
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const channel = client.channels.get('test-RTL5j');

    // Start attach (will timeout)
    const attachPromise = channel.attach().catch(() => {});

    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // Advance past timeout
    await clock.tickAsync(150);
    await attachPromise;

    expect(channel.state).to.equal('suspended');

    // Detach from suspended should be immediate
    await channel.detach();
    client.close();
    expect(channel.state).to.equal('detached');
    expect(detachMessageCount).to.equal(0); // No DETACH message sent
  });

  /**
   * RTL5d - Normal detach flow
   */
  // UTS: realtime/unit/RTL5d/normal-detach-flow-0
  it('RTL5d - normal detach flow', async function () {
    let capturedDetachMsg: any = null;

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
        if (msg.action === 12) {
          // DETACH
          capturedDetachMsg = msg;
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

    const channel = client.channels.get('test-RTL5d');
    await channel.attach();

    let stateDuringDetach: string | null = null;
    channel.once('detaching', () => {
      stateDuringDetach = channel.state;
    });

    await channel.detach();

    client.close();
    expect(stateDuringDetach).to.equal('detaching');
    expect(channel.state).to.equal('detached');
    expect(capturedDetachMsg).to.not.be.null;
    expect(capturedDetachMsg.action).to.equal(12);
    expect(capturedDetachMsg.channel).to.equal('test-RTL5d');
  });

  /**
   * RTL5f - Detach timeout returns to previous state
   */
  // UTS: realtime/unit/RTL5f/timeout-returns-previous-state-0
  it('RTL5f - detach timeout returns to attached', async function () {
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
        if (msg.action === 12) {
          // DETACH
          // Don't respond — simulate timeout
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      realtimeRequestTimeout: 100,
    });
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const channel = client.channels.get('test-RTL5f');
    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Start detach (will timeout)
    let detachError: any = null;
    const detachPromise = channel.detach().catch((err: any) => {
      detachError = err;
    });

    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // Advance past timeout
    await clock.tickAsync(150);
    await detachPromise;

    // Should return to attached state
    expect(channel.state).to.equal('attached');
    expect(detachError).to.not.be.null;
  });

  /**
   * RTL5k - ATTACHED received while detaching sends new DETACH
   */
  // UTS: realtime/unit/RTL5k/attached-while-detaching-0
  it('RTL5k - ATTACHED while detaching triggers new DETACH', async function () {
    let detachMessageCount = 0;

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
        if (msg.action === 12) {
          // DETACH
          detachMessageCount++;
          if (detachMessageCount === 1) {
            // First DETACH: respond with ATTACHED (simulating race condition)
            mock.active_connection!.send_to_client({
              action: 11, // ATTACHED
              channel: msg.channel,
              flags: 0,
            });
          } else {
            // Second DETACH: respond normally
            mock.active_connection!.send_to_client({
              action: 13, // DETACHED
              channel: msg.channel,
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

    const channel = client.channels.get('test-RTL5k');
    await channel.attach();

    await channel.detach();
    client.close();
    expect(channel.state).to.equal('detached');
    expect(detachMessageCount).to.equal(2); // Two DETACH messages sent
  });

  /**
   * RTL5l - Detach when connection not connected transitions immediately
   */
  // UTS: realtime/unit/RTL5l/detach-not-connected-immediate-0
  it('RTL5l - detach when disconnected is immediate', async function () {
    let detachMessageCount = 0;
    let pendingConnection: any = null;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        pendingConnection = conn;
        // Don't respond — hold in connecting state
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 12) {
          // DETACH
          detachMessageCount++;
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
    await new Promise<void>((resolve) => {
      if (client.connection.state === 'connecting') return resolve();
      client.connection.once('connecting', () => resolve());
    });

    const channel = client.channels.get('test-RTL5l');

    // Start attach while connecting
    const attachPromise = channel.attach();

    await flushAsync();
    expect(channel.state).to.equal('attaching');

    // Now detach — should transition immediately since not connected
    await channel.detach();
    client.close();
    expect(channel.state).to.equal('detached');
    expect(detachMessageCount).to.equal(0);
  });

  /**
   * RTL5l - Detach ATTACHED channel when connection disconnected
   */
  // UTS: realtime/unit/RTL5l/detach-attached-when-disconnected-1
  it('RTL5l - detach attached channel when disconnected is immediate', async function () {
    let detachMessageCount = 0;

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
        if (msg.action === 12) {
          // DETACH
          detachMessageCount++;
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

    const channel = client.channels.get('test-RTL5l-attached');
    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Disconnect the transport
    mock.onConnectionAttempt = (_conn) => {
      // Don't respond — hold in connecting
    };
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    // Now detach while disconnected
    detachMessageCount = 0;
    await channel.detach();

    expect(channel.state).to.equal('detached');
    expect(detachMessageCount).to.equal(0); // No DETACH message sent
    client.close();
  });

  /**
   * RTL5 - Detach emits state change events
   */
  // UTS: realtime/unit/RTL5/detach-state-change-events-0
  it('RTL5 - detach emits state change events', async function () {
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

    const channel = client.channels.get('test-RTL5-events');
    await channel.attach();

    const stateChanges: any[] = [];
    channel.on((change: any) => {
      stateChanges.push(change);
    });

    await channel.detach();

    client.close();
    expect(stateChanges.length).to.be.at.least(2);
    expect(stateChanges[0].current).to.equal('detaching');
    expect(stateChanges[0].previous).to.equal('attached');
    expect(stateChanges[1].current).to.equal('detached');
    expect(stateChanges[1].previous).to.equal('detaching');
  });

  /**
   * RTL5i - Detach while attaching waits then detaches
   *
   * Calling detach while an attach is pending should wait for the attach
   * to complete and then perform the detach.
   */
  // UTS: realtime/unit/RTL5i/detach-while-attaching-1
  it('RTL5i - detach while attaching waits then detaches', async function () {
    const messagesFromClient: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        messagesFromClient.push({ ...msg });
        if (msg.action === 10) {
          // ATTACH — delay response
        } else if (msg.action === 12) {
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

    const channel = client.channels.get('test-RTL5i-attaching');

    // Start attach (don't await — ably-js will reject it when detach supersedes)
    const attachFuture = channel.attach().catch(() => {});

    // Wait for attaching state
    await new Promise<void>((resolve) => {
      if (channel.state === 'attaching') return resolve();
      channel.once('attaching', () => resolve());
    });

    // Start detach while attaching — ably-js supersedes the attach
    const detachFuture = channel.detach();

    // Send ATTACHED response — attach completes on the wire
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL5i-attaching',
      flags: 0,
    });

    // Wait for both operations
    await attachFuture;
    await detachFuture;

    expect(channel.state).to.equal('detached');
    // Should have: ATTACH, DETACH
    const relevantMessages = messagesFromClient.filter((m) => m.action === 10 || m.action === 12);
    expect(relevantMessages.length).to.equal(2);
    expect(relevantMessages[0].action).to.equal(10); // ATTACH
    expect(relevantMessages[1].action).to.equal(12); // DETACH
    client.close();
  });

  /**
   * RTL5k - ATTACHED received while detached sends DETACH
   */
  // UTS: realtime/unit/RTL5k/attached-while-detached-1
  it('RTL5k - ATTACHED while detached sends DETACH', async function () {
    if (!process.env.RUN_DEVIATIONS) this.skip(); // ably-js doesn't send DETACH for unsolicited ATTACHED in detached state
    let detachMessageCount = 0;

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
        if (msg.action === 12) {
          // DETACH
          detachMessageCount++;
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

    const channel = client.channels.get('test-RTL5k-detached');
    await channel.attach();
    await channel.detach();
    expect(channel.state).to.equal('detached');
    expect(detachMessageCount).to.equal(1);

    // Server unexpectedly sends ATTACHED while detached
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL5k-detached',
      flags: 0,
    });

    await flushAsync();

    expect(detachMessageCount).to.equal(2);
    expect(channel.state).to.equal('detached');
    client.close();
  });

  /**
   * RTL5 - Detach from ATTACHED while connection not connected
   *
   * Per RTL5l, if the connection state is anything other than CONNECTED and
   * none of the preceding channel state conditions apply, the channel
   * transitions immediately to DETACHED without sending a DETACH message.
   * This test specifically covers the case where a channel is ATTACHED
   * (not just ATTACHING) and connection drops to connecting.
   */
  // UTS: realtime/unit/RTL5l/detach-attached-when-disconnected-1.1
  it('RTL5 - detach from attached when connection disconnected', async function () {
    let detachMessageCount = 0;

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
        if (msg.action === 12) {
          // DETACH
          detachMessageCount++;
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

    const channel = client.channels.get('test-RTL5-disconnected');
    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Disconnect the connection (don't respond to reconnect)
    mock.onConnectionAttempt = (_conn) => {
      // Don't respond — hold in connecting
    };
    mock.active_connection!.simulate_disconnect();

    // Wait for disconnected state
    await new Promise<void>((resolve) => {
      if (client.connection.state !== 'connected') return resolve();
      client.connection.once('disconnected', resolve);
    });

    // Detach while connection is not connected
    await channel.detach();
    expect(channel.state).to.equal('detached');
    client.close();
  });
});
