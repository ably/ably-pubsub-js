/**
 * UTS: Channel Server-Initiated Detach Tests
 *
 * Spec points: RTL13, RTL13a, RTL13b, RTL13c
 * Source: uts/test/realtime/unit/channels/channel_server_initiated_detach_test.md
 *
 * Tests behavior when the server sends an unsolicited DETACHED:
 * - ATTACHED → immediate reattach (RTL13a)
 * - ATTACHING → SUSPENDED with automatic retry (RTL13b)
 * - Failed reattach cycles SUSPENDED → ATTACHING → SUSPENDED (RTL13b)
 * - Retry cancelled when connection drops (RTL13c)
 * - DETACHING → normal detach (not reattach)
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import {
  Ably,
  installMockWebSocket,
  enableFakeTimers,
  restoreAll,
  trackClient,
  flushAsync,
  pollUntil,
} from '../../../helpers';

describe('uts/realtime/unit/channels/channel_server_initiated_detach', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL13a - Server DETACHED on ATTACHED channel triggers immediate reattach
   */
  // UTS: realtime/unit/RTL13a/detaching-not-server-initiated-2
  it('RTL13a - server DETACHED on attached triggers reattach', async function () {
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

    const channel = client.channels.get('test-RTL13a');
    await channel.attach();
    expect(attachCount).to.equal(1);
    expect(channel.state).to.equal('attached');

    const stateChanges: any[] = [];
    channel.on((change: any) => stateChanges.push(change));

    // Server sends unsolicited DETACHED with error
    mock.active_connection!.send_to_client({
      action: 13, // DETACHED
      channel: 'test-RTL13a',
      error: { message: 'Server detach', code: 90198, statusCode: 500 },
    });

    // Wait for reattach to complete
    await pollUntil(() => channel.state === 'attached' && attachCount >= 2);

    expect(attachCount).to.equal(2);
    expect(channel.state).to.equal('attached');

    // Should have gone through attaching state with error
    const attachingChange = stateChanges.find((c: any) => c.current === 'attaching');
    expect(attachingChange).to.not.be.undefined;
    expect(attachingChange.reason?.code).to.equal(90198);
    client.close();
  });

  /**
   * RTL13b - Server DETACHED while ATTACHING → SUSPENDED → automatic retry
   */
  // UTS: realtime/unit/RTL13b/attaching-detached-to-suspended-1
  it('RTL13b - server DETACHED while attaching → suspended → retry', async function () {
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
          if (attachCount === 1) {
            // First attach — don't respond, then send DETACHED
            // (will be sent after we detect attaching state below)
          } else {
            // Subsequent attaches succeed
            mock.active_connection!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      channelRetryTimeout: 100,
    } as any);
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const channel = client.channels.get('test-RTL13b');
    const stateChanges: any[] = [];
    channel.on((change: any) => stateChanges.push(change));

    // Start attach — won't get response
    channel.attach();
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(channel.state).to.equal('attaching');
    expect(attachCount).to.equal(1);

    // Server sends DETACHED while ATTACHING → goes to SUSPENDED
    mock.active_connection!.send_to_client({
      action: 13,
      channel: 'test-RTL13b',
      error: { message: 'Server detach', code: 90198, statusCode: 500 },
    });

    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(channel.state).to.equal('suspended');

    // Advance past channelRetryTimeout → automatic retry
    await clock.tickAsync(200);
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(channel.state).to.equal('attached');
    expect(attachCount).to.equal(2);

    // Verify state sequence
    const states = stateChanges.map((c: any) => c.current);
    expect(states).to.include('attaching');
    expect(states).to.include('suspended');
    expect(states).to.include('attached');
    client.close();
  });

  /**
   * RTL13b - Failed reattach → SUSPENDED → retry cycle
   */
  // UTS: realtime/unit/RTL13b/failed-reattach-suspended-retry-0
  it('RTL13b - failed reattach cycles through suspended', async function () {
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
          if (attachCount === 1) {
            // First attach succeeds
            mock.active_connection!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          } else if (attachCount === 2) {
            // Second attach (reattach after DETACHED): server sends DETACHED again
            mock.active_connection!.send_to_client({
              action: 13, // DETACHED again
              channel: msg.channel,
              error: { message: 'Still detached', code: 90198, statusCode: 500 },
            });
          } else {
            // Third attach succeeds
            mock.active_connection!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      channelRetryTimeout: 100,
    } as any);
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const channel = client.channels.get('test-RTL13b-cycle');
    await channel.attach();
    expect(attachCount).to.equal(1);

    const stateChanges: any[] = [];
    channel.on((change: any) => stateChanges.push(change));

    // Server sends DETACHED → triggers reattach (attachCount 2)
    // Reattach will be DETACHED again → SUSPENDED
    mock.active_connection!.send_to_client({
      action: 13,
      channel: 'test-RTL13b-cycle',
      error: { message: 'Server detach', code: 90198, statusCode: 500 },
    });

    // Process reattach attempt and its failure
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(channel.state).to.equal('suspended');
    expect(attachCount).to.equal(2);

    // Advance past retry timeout → third attach succeeds
    await clock.tickAsync(200);
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(channel.state).to.equal('attached');
    expect(attachCount).to.equal(3);
    client.close();
  });

  /**
   * RTL13b - Repeated failures cycle indefinitely
   */
  // UTS: realtime/unit/RTL13b/repeated-failure-cycle-2
  it('RTL13b - repeated failures cycle suspended → attaching', async function () {
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
          if (attachCount === 1) {
            mock.active_connection!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          } else if (attachCount <= 3) {
            // Reattach attempts 2 and 3 fail with DETACHED
            mock.active_connection!.send_to_client({
              action: 13,
              channel: msg.channel,
              error: { message: 'Still detached', code: 90198, statusCode: 500 },
            });
          } else {
            // Attempt 4 succeeds
            mock.active_connection!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      channelRetryTimeout: 100,
    } as any);
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const channel = client.channels.get('test-RTL13b-repeat');
    await channel.attach();
    expect(attachCount).to.equal(1);

    const stateChanges: any[] = [];
    channel.on((change: any) => stateChanges.push(change));

    // First DETACHED → reattach attempt 2 fails → SUSPENDED
    mock.active_connection!.send_to_client({
      action: 13,
      channel: 'test-RTL13b-repeat',
      error: { message: 'Detach 1', code: 90198, statusCode: 500 },
    });

    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(channel.state).to.equal('suspended');

    // Advance past first retry → attempt 3 fails → SUSPENDED again
    // retryCount=1: delay = channelRetryTimeout * (1+2)/3 * jitter = 100 * 1.0 * [0.8-1.0] = 80-100ms
    await clock.tickAsync(150);
    for (let i = 0; i < 40; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(channel.state).to.equal('suspended');
    expect(attachCount).to.equal(3);

    // Advance past second retry → attempt 4 succeeds
    // retryCount=2: delay = channelRetryTimeout * (2+2)/3 * jitter = 100 * 1.333 * [0.8-1.0] = 107-134ms
    await clock.tickAsync(200);
    for (let i = 0; i < 40; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(channel.state).to.equal('attached');
    expect(attachCount).to.equal(4);
    client.close();
  });

  /**
   * RTL13c - Retry cancelled when connection is no longer CONNECTED
   */
  // UTS: realtime/unit/RTL13c/retry-cancelled-disconnected-0
  it('RTL13c - retry cancelled when connection drops', async function () {
    let attachCount = 0;
    let connectCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectCount++;
        mock.active_connection = conn;
        if (connectCount === 1) {
          conn.respond_with_connected();
        } else {
          // Don't respond to reconnection
          conn.respond_with_refused();
        }
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachCount++;
          if (attachCount === 1) {
            mock.active_connection!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          }
          // Don't respond to reattach — it should be cancelled
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
      channelRetryTimeout: 100,
    } as any);
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const channel = client.channels.get('test-RTL13c');
    await channel.attach();
    expect(attachCount).to.equal(1);

    // Server sends DETACHED → channel goes to ATTACHING
    mock.active_connection!.send_to_client({
      action: 13,
      channel: 'test-RTL13c',
      error: { message: 'Server detach', code: 90198, statusCode: 500 },
    });

    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(attachCount).to.equal(2);

    const attachCountAfterDetach = attachCount;

    // Disconnect — connection drops
    mock.active_connection!.simulate_disconnect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // Advance past retry timeout — no retry since connection is not CONNECTED
    await clock.tickAsync(500);
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // No additional ATTACH messages should have been sent
    expect(attachCount).to.equal(attachCountAfterDetach);
    client.close();
  });

  /**
   * RTL13 - DETACHED while DETACHING is normal detach flow (not reattach)
   */
  // UTS: realtime/unit/RTL13a/attached-reattach-triggered-0
  it('RTL13 - DETACHED while detaching is normal detach', async function () {
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

    const channel = client.channels.get('test-RTL13-detaching');
    await channel.attach();
    expect(attachCount).to.equal(1);

    await channel.detach();

    // Channel should be cleanly detached, not re-attached
    expect(channel.state).to.equal('detached');
    expect(attachCount).to.equal(1);
    client.close();
  });

  /**
   * RTL13a - Server DETACHED on SUSPENDED channel triggers immediate reattach
   *
   * When a channel is in SUSPENDED state (e.g. after a failed reattach timeout)
   * and receives a server-initiated DETACHED, it should immediately attempt
   * to reattach.
   */
  // UTS: realtime/unit/RTL13a/suspended-reattach-triggered-1
  it('RTL13a - server DETACHED on suspended triggers reattach', async function () {
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
          if (attachCount === 1) {
            // First attach succeeds
            mock.active_connection!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          } else if (attachCount === 2) {
            // Second attach (reattach after first DETACHED) — don't respond (timeout -> SUSPENDED)
          } else {
            // Third attach (after second DETACHED on SUSPENDED) — succeed
            mock.active_connection!.send_to_client({
              action: 11,
              channel: msg.channel,
              flags: 0,
            });
          }
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
      channelRetryTimeout: 60000, // Large so auto-retry doesn't interfere
    } as any);
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    const channel = client.channels.get('test-RTL13a-suspended');
    await channel.attach();
    expect(channel.state).to.equal('attached');
    expect(attachCount).to.equal(1);

    // Send server-initiated DETACHED to trigger RTL13a reattach
    mock.active_connection!.send_to_client({
      action: 13, // DETACHED
      channel: 'test-RTL13a-suspended',
      error: { message: 'Detach 1', code: 90198, statusCode: 500 },
    });

    // Let channel enter ATTACHING state
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(channel.state).to.equal('attaching');

    // Let the reattach timeout -> SUSPENDED
    await clock.tickAsync(150);
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(channel.state).to.equal('suspended');

    // Now send another server-initiated DETACHED while SUSPENDED
    mock.active_connection!.send_to_client({
      action: 13, // DETACHED
      channel: 'test-RTL13a-suspended',
      error: { message: 'Detach 2', code: 90199, statusCode: 500 },
    });

    // Channel should immediately attempt to reattach and succeed
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(channel.state).to.equal('attached');
    // 3 total ATTACH messages
    expect(attachCount).to.equal(3);
    client.close();
  });
});
