/**
 * UTS: Channel Error Tests
 *
 * Spec points: RTL14
 * Source: uts/test/realtime/unit/channels/channel_error_test.md
 *
 * Tests channel-scoped ERROR protocol messages: transitions to FAILED,
 * errorReason population, isolation between channels.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, enableFakeTimers, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_error', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL14 - Channel ERROR transitions ATTACHED channel to FAILED
   */
  // UTS: realtime/unit/RTL14/attached-to-failed-0
  it('RTL14 - channel ERROR on attached channel', async function () {
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

    const channel = client.channels.get('test-RTL14-attached');
    await channel.attach();
    expect(channel.state).to.equal('attached');

    const stateChanges: any[] = [];
    channel.on((change: any) => stateChanges.push(change));

    // Server sends channel-scoped ERROR
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTL14-attached',
      error: {
        message: 'Channel error',
        code: 40160,
        statusCode: 401,
      },
    });

    await new Promise<void>((resolve) => channel.once('failed', resolve));

    expect(channel.state).to.equal('failed');
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason!.code).to.equal(40160);
    expect(stateChanges.some((c: any) => c.current === 'failed')).to.be.true;
    // Connection should remain connected
    expect(client.connection.state).to.equal('connected');
    client.close();
  });

  /**
   * RTL14 - Channel ERROR transitions ATTACHING channel to FAILED
   */
  // UTS: realtime/unit/RTL14/attaching-to-failed-1
  it('RTL14 - channel ERROR on attaching channel', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          // Respond with channel-scoped ERROR instead of ATTACHED
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

    const channel = client.channels.get('test-RTL14-attaching');

    try {
      await channel.attach();
      expect.fail('Expected attach to fail');
    } catch (err: any) {
      expect(err.code).to.equal(40160);
    }

    expect(channel.state).to.equal('failed');
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason!.code).to.equal(40160);
    // Connection should remain connected
    expect(client.connection.state).to.equal('connected');
    client.close();
  });

  /**
   * RTL14 - Channel ERROR does not affect other channels
   */
  // UTS: realtime/unit/RTL14/other-channels-unaffected-3
  it('RTL14 - channel ERROR isolated to target channel', async function () {
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

    const channelA = client.channels.get('test-RTL14-chanA');
    const channelB = client.channels.get('test-RTL14-chanB');
    await channelA.attach();
    await channelB.attach();

    // Send ERROR only for channel A
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTL14-chanA',
      error: {
        message: 'Channel A error',
        code: 40160,
        statusCode: 401,
      },
    });

    await new Promise<void>((resolve) => channelA.once('failed', resolve));

    expect(channelA.state).to.equal('failed');
    expect(channelA.errorReason!.code).to.equal(40160);
    // Channel B should be unaffected
    expect(channelB.state).to.equal('attached');
    // Connection should remain connected
    expect(client.connection.state).to.equal('connected');
    client.close();
  });

  /**
   * RTL14 - Channel ERROR completes pending detach with error
   */
  // UTS: realtime/unit/RTL14/pending-detach-error-2
  it('RTL14 - channel ERROR during detach', async function () {
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
          // Respond with ERROR instead of DETACHED
          mock.active_connection!.send_to_client({
            action: 9, // ERROR
            channel: msg.channel,
            error: {
              message: 'Detach denied',
              code: 90198,
              statusCode: 500,
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

    const channel = client.channels.get('test-RTL14-detach-error');
    await channel.attach();

    try {
      await channel.detach();
      expect.fail('Expected detach to fail');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }

    // Channel should be FAILED (not DETACHED)
    expect(channel.state).to.equal('failed');
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason!.code).to.equal(90198);
    // Connection should remain connected
    expect(client.connection.state).to.equal('connected');
    client.close();
  });

  /**
   * RTL14 - Channel ERROR cancels pending timers
   *
   * When a channel ERROR is received while a channel retry timer is pending
   * (channel in SUSPENDED state), the timer should be cancelled and the
   * channel should remain in FAILED state without retrying.
   */
  // UTS: realtime/unit/RTL14/cancels-pending-timers-4
  it('RTL14 - channel ERROR cancels pending retry timer', async function () {
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
              action: 11, // ATTACHED
              channel: msg.channel,
              flags: 0,
            });
          }
          // Don't respond to subsequent attaches (timeout -> SUSPENDED)
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
      channelRetryTimeout: 200,
    } as any);
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-RTL14-timers');
    await channel.attach();
    expect(attachCount).to.equal(1);

    // Trigger server-initiated DETACHED -> reattach -> timeout -> SUSPENDED
    mock.active_connection!.send_to_client({
      action: 13, // DETACHED
      channel: 'test-RTL14-timers',
      error: { code: 90198, statusCode: 500, message: 'Detach' },
    });

    // Pump and advance to get to SUSPENDED
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    await clock.tickAsync(150);
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(channel.state).to.equal('suspended');

    // Channel retry timer is now pending (channelRetryTimeout = 200ms)
    // Send ERROR before the retry fires
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTL14-timers',
      error: { code: 40160, statusCode: 401, message: 'Not permitted' },
    });

    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(channel.state).to.equal('failed');

    const attachCountAfterError = attachCount;

    // Advance time well past the channelRetryTimeout
    await clock.tickAsync(500);
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }

    // Channel remains FAILED — no retry was attempted
    expect(channel.state).to.equal('failed');
    expect(attachCount).to.equal(attachCountAfterError);
    client.close();
  });
});
