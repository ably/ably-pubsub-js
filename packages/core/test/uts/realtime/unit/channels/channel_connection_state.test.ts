/**
 * UTS: Channel Connection State Tests
 *
 * Spec points: RTL3a, RTL3b, RTL3c, RTL3d, RTL3e, RTL4c1
 * Source: uts/test/realtime/unit/channels/channel_connection_state_test.md
 *
 * Tests how connection state transitions affect channel states:
 * - DISCONNECTED → no effect on channels
 * - FAILED → channels move to FAILED
 * - CLOSED → channels move to DETACHED
 * - SUSPENDED → channels move to SUSPENDED
 * - CONNECTED (recovery) → channels re-attach with channelSerial
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
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

describe('uts/realtime/unit/channels/channel_connection_state', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL3e - DISCONNECTED has no effect on ATTACHED channel
   */
  // UTS: realtime/unit/RTL3e/disconnected-attached-noop-0
  it('RTL3e - DISCONNECTED does not affect attached channel', async function () {
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

    const channel = client.channels.get('test-RTL3e');
    await channel.attach();
    expect(channel.state).to.equal('attached');

    const stateChanges: any[] = [];
    channel.on((change: any) => stateChanges.push(change));

    // Simulate disconnect
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    expect(channel.state).to.equal('attached');
    expect(stateChanges.length).to.equal(0);
  });

  /**
   * RTL3a - FAILED connection transitions ATTACHED channel to FAILED
   */
  // UTS: realtime/unit/RTL3a/other-states-unaffected-2
  it('RTL3a - FAILED connection → channel FAILED', async function () {
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

    const channel = client.channels.get('test-RTL3a');
    await channel.attach();

    const stateChanges: any[] = [];
    channel.on((change: any) => stateChanges.push(change));

    // Send fatal ERROR to put connection in FAILED
    mock.active_connection!.send_to_client({
      action: 9, // ERROR (connection-level, no channel)
      error: {
        message: 'Fatal error',
        code: 40198,
        statusCode: 400,
      },
    });
    await new Promise<void>((resolve) => client.connection.once('failed', resolve));

    expect(channel.state).to.equal('failed');
    expect(stateChanges.some((c: any) => c.current === 'failed')).to.be.true;
  });

  /**
   * RTL3a - INITIALIZED and DETACHED channels unaffected by FAILED connection
   */
  // UTS: realtime/unit/RTL3a/failed-attached-to-failed-0
  it('RTL3a - non-attached channels unaffected by FAILED', async function () {
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

    const channelInit = client.channels.get('test-RTL3a-init');
    const channelDetached = client.channels.get('test-RTL3a-detached');

    // Attach and detach one channel
    await channelDetached.attach();
    await channelDetached.detach();
    expect(channelDetached.state).to.equal('detached');
    expect(channelInit.state).to.equal('initialized');

    const initChanges: any[] = [];
    const detachedChanges: any[] = [];
    channelInit.on((c: any) => initChanges.push(c));
    channelDetached.on((c: any) => detachedChanges.push(c));

    // Send fatal ERROR
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      error: { message: 'Fatal', code: 40198, statusCode: 400 },
    });
    await new Promise<void>((resolve) => client.connection.once('failed', resolve));

    expect(channelInit.state).to.equal('initialized');
    expect(channelDetached.state).to.equal('detached');
    expect(initChanges.length).to.equal(0);
    expect(detachedChanges.length).to.equal(0);
  });

  /**
   * RTL3b - CLOSED connection transitions ATTACHED channel to DETACHED
   */
  // UTS: realtime/unit/RTL3b/closed-attached-to-detached-0
  it('RTL3b - CLOSED connection → channel DETACHED', async function () {
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
        if (msg.action === 7) {
          // CLOSE
          mock.active_connection!.send_to_client({
            action: 8, // CLOSED
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

    const channel = client.channels.get('test-RTL3b');
    await channel.attach();

    const stateChanges: any[] = [];
    channel.on((change: any) => stateChanges.push(change));

    client.close();
    await new Promise<void>((resolve) => client.connection.once('closed', resolve));

    expect(channel.state).to.equal('detached');
    expect(stateChanges.some((c: any) => c.current === 'detached')).to.be.true;
  });

  /**
   * RTL3c - SUSPENDED connection transitions ATTACHED channel to SUSPENDED
   */
  // UTS: realtime/unit/RTL3c/suspended-attached-to-suspended-0
  it('RTL3c - SUSPENDED connection → channel SUSPENDED', async function () {
    let connectCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectCount++;
        if (connectCount === 1) {
          mock.active_connection = conn;
          conn.respond_with_connected();
        } else {
          // Refuse reconnection attempts
          conn.respond_with_refused();
        }
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
    });
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-RTL3c');
    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Simulate disconnect (subsequent reconnections will be refused)
    mock.active_connection!.simulate_disconnect();

    // Pump through disconnected retries and advance past connectionStateTtl
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }
    await clock.tickAsync(121000);
    for (let i = 0; i < 30; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(client.connection.state).to.equal('suspended');
    expect(channel.state).to.equal('suspended');
  });

  /**
   * RTL3d, RTL4c1 - CONNECTED recovery re-attaches channels with channelSerial
   */
  // UTS: realtime/unit/RTL3d/reattach-attached-with-serial-0
  it('RTL3d - reconnect re-attaches channels with channelSerial', async function () {
    let connectCount = 0;
    const capturedAttachMsgs: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectCount++;
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          capturedAttachMsgs.push({ ...msg });
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'serial-001',
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
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL3d');
    await channel.attach();
    expect(capturedAttachMsgs.length).to.equal(1);

    // Simulate disconnect — ably-js will auto-reconnect
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    // Wait for reconnection and re-attach
    await new Promise<void>((resolve) => {
      channel.once('attached', () => resolve());
    });

    expect(channel.state).to.equal('attached');
    expect(capturedAttachMsgs.length).to.equal(2);
    // Re-attach should include the channelSerial
    expect(capturedAttachMsgs[1].channelSerial).to.equal('serial-001');
    client.close();
  });

  /**
   * RTL3d - INITIALIZED and DETACHED channels NOT re-attached on reconnect
   */
  // UTS: realtime/unit/RTL3d/init-detached-not-reattached-2
  it('RTL3d - initialized/detached channels not re-attached', async function () {
    let connectCount = 0;
    const attachedChannels: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectCount++;
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachedChannels.push(msg.channel);
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
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channelInit = client.channels.get('test-RTL3d-init');
    const channelDetached = client.channels.get('test-RTL3d-detached');

    // Leave channelInit in INITIALIZED
    // Attach then detach channelDetached
    await channelDetached.attach();
    await channelDetached.detach();

    const attachCountBefore = attachedChannels.length;

    // Simulate disconnect and reconnect
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    // Wait a bit for any re-attach messages
    await flushAsync();

    client.close();
    // No new ATTACH messages for these channels
    const newAttaches = attachedChannels.slice(attachCountBefore);
    expect(newAttaches).to.not.include('test-RTL3d-init');
    expect(newAttaches).to.not.include('test-RTL3d-detached');
    expect(channelInit.state).to.equal('initialized');
    expect(channelDetached.state).to.equal('detached');
  });

  /**
   * RTL3d - Multiple channels re-attached on reconnect
   */
  // UTS: realtime/unit/RTL3d/multiple-channels-reattached-3
  it('RTL3d - multiple channels re-attached on reconnect', async function () {
    const attachedChannels: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          attachedChannels.push(msg.channel);
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
      disconnectedRetryTimeout: 100,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const chanA = client.channels.get('test-RTL3d-multiA');
    const chanB = client.channels.get('test-RTL3d-multiB');
    await chanA.attach();
    await chanB.attach();

    const attachCountBefore = attachedChannels.length;

    // Simulate disconnect
    mock.active_connection!.simulate_disconnect();

    // Wait for both to re-attach
    await new Promise<void>((resolve) => {
      let count = 0;
      const check = () => {
        if (++count === 2) resolve();
      };
      chanA.once('attached', check);
      chanB.once('attached', check);
    });

    expect(chanA.state).to.equal('attached');
    expect(chanB.state).to.equal('attached');

    const newAttaches = attachedChannels.slice(attachCountBefore);
    expect(newAttaches).to.include('test-RTL3d-multiA');
    expect(newAttaches).to.include('test-RTL3d-multiB');
    client.close();
  });

  /**
   * RTL3e - DISCONNECTED has no effect on ATTACHING channel
   */
  // UTS: realtime/unit/RTL3e/disconnected-attaching-noop-1
  it('RTL3e - DISCONNECTED does not affect attaching channel', async function () {
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

    const channel = client.channels.get('test-RTL3e-attaching');
    const attachFuture = channel.attach().catch(() => {});

    await new Promise<void>((resolve) => {
      if (channel.state === 'attaching') return resolve();
      channel.once('attaching', () => resolve());
    });

    const channelStateChanges: any[] = [];
    channel.on((change: any) => channelStateChanges.push(change));

    // Simulate disconnect
    mock.active_connection!.simulate_disconnect();
    await new Promise<void>((resolve) => client.connection.once('disconnected', resolve));

    // Channel state must remain ATTACHING
    expect(channel.state).to.equal('attaching');
    // No channel state change events should have been emitted
    expect(channelStateChanges.length).to.equal(0);
  });

  /**
   * RTL3b - CLOSED connection transitions ATTACHING channel to DETACHED
   */
  // UTS: realtime/unit/RTL3b/closed-attaching-to-detached-1
  it('RTL3b - CLOSED connection transitions ATTACHING channel to DETACHED', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH — don't respond, leave channel in ATTACHING
        }
        if (msg.action === 7) {
          // CLOSE
          mock.active_connection!.send_to_client({
            action: 8, // CLOSED
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

    const channel = client.channels.get('test-RTL3b-attaching');
    const attachFuture = channel.attach().catch(() => {});

    await new Promise<void>((resolve) => {
      if (channel.state === 'attaching') return resolve();
      channel.once('attaching', () => resolve());
    });

    const channelStateChanges: any[] = [];
    channel.on((change: any) => channelStateChanges.push(change));

    // Close the connection
    client.close();
    await new Promise<void>((resolve) => client.connection.once('closed', resolve));

    // The pending attach should fail
    await attachFuture;

    expect(channel.state).to.equal('detached');
    const detachedChange = channelStateChanges.find((c: any) => c.current === 'detached');
    expect(detachedChange).to.not.be.undefined;
    expect(detachedChange.previous).to.equal('attaching');
  });

  /**
   * RTL3a - FAILED connection transitions ATTACHING channel to FAILED
   */
  // UTS: realtime/unit/RTL3a/failed-attaching-to-failed-1
  it('RTL3a - FAILED connection transitions ATTACHING channel to FAILED', async function () {
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

    const channel = client.channels.get('test-RTL3a-attaching');
    const attachFuture = channel.attach().catch(() => {});

    await new Promise<void>((resolve) => {
      if (channel.state === 'attaching') return resolve();
      channel.once('attaching', () => resolve());
    });

    const channelStateChanges: any[] = [];
    channel.on((change: any) => channelStateChanges.push(change));

    // Send fatal connection ERROR
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      error: { code: 40198, statusCode: 403, message: 'Account disabled' },
    });

    await new Promise<void>((resolve) => client.connection.once('failed', resolve));
    await attachFuture;

    expect(channel.state).to.equal('failed');
    const failedChange = channelStateChanges.find((c: any) => c.current === 'failed');
    expect(failedChange).to.not.be.undefined;
    expect(failedChange.previous).to.equal('attaching');
    client.close();
  });

  /**
   * RTL3c - SUSPENDED connection transitions ATTACHING channel to SUSPENDED
   */
  // UTS: realtime/unit/RTL3c/suspended-attaching-to-suspended-1
  it('RTL3c - SUSPENDED connection transitions ATTACHING channel to SUSPENDED', async function () {
    const clock = enableFakeTimers();

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, {}),
    });
    installMockHttp(httpMock);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionDetails: { connectionStateTtl: 5000 },
        });
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
      disconnectedRetryTimeout: 1000,
      connectionStateTtl: 5000,
    } as any);
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-RTL3c-attaching');
    channel.attach().catch(() => {});
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(channel.state).to.equal('attaching');

    const channelStateChanges: any[] = [];
    channel.on((change: any) => channelStateChanges.push(change));

    // Disconnect — all reconnection attempts will fail
    mock.onConnectionAttempt = (conn) => conn.respond_with_refused();
    mock.active_connection!.simulate_disconnect();

    // Advance time past connectionStateTtl to reach SUSPENDED
    for (let i = 0; i < 15; i++) {
      await clock.tickAsync(2000);
      for (let j = 0; j < 10; j++) {
        clock.tick(0);
        await flushAsync();
      }
      if (client.connection.state === 'suspended') break;
    }

    expect(client.connection.state).to.equal('suspended');
    expect(channel.state).to.equal('suspended');

    const suspendedChange = channelStateChanges.find((c: any) => c.current === 'suspended');
    expect(suspendedChange).to.not.be.undefined;
    expect(suspendedChange.previous).to.equal('attaching');
    client.close();
  });

  /**
   * RTL3d - CONNECTED connection re-attaches SUSPENDED channels
   */
  // UTS: realtime/unit/RTL3d/reattach-suspended-channels-1
  it('RTL3d - CONNECTED connection re-attaches SUSPENDED channels', async function () {
    const clock = enableFakeTimers();
    let attachCount = 0;

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, {}),
    });
    installMockHttp(httpMock);

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionDetails: { connectionStateTtl: 5000 },
        });
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          attachCount++;
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
      disconnectedRetryTimeout: 1000,
      connectionStateTtl: 5000,
      suspendedRetryTimeout: 2000,
    } as any);
    trackClient(client);

    client.connect();
    for (let i = 0; i < 20; i++) {
      clock.tick(0);
      await flushAsync();
    }
    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get('test-RTL3d-suspended');
    await channel.attach();
    expect(attachCount).to.equal(1);

    // Disconnect — all reconnection attempts fail
    mock.onConnectionAttempt = (conn) => conn.respond_with_refused();
    mock.active_connection!.simulate_disconnect();

    // Advance to SUSPENDED
    for (let i = 0; i < 15; i++) {
      await clock.tickAsync(2000);
      for (let j = 0; j < 10; j++) {
        clock.tick(0);
        await flushAsync();
      }
      if (client.connection.state === 'suspended') break;
    }
    expect(client.connection.state).to.equal('suspended');
    expect(channel.state).to.equal('suspended');

    // Allow reconnection to succeed
    mock.onConnectionAttempt = (conn) => {
      mock.active_connection = conn;
      conn.respond_with_connected();
    };

    // Advance past suspendedRetryTimeout
    for (let i = 0; i < 10; i++) {
      await clock.tickAsync(2500);
      for (let j = 0; j < 10; j++) {
        clock.tick(0);
        await flushAsync();
      }
      if (client.connection.state === 'connected') break;
    }
    expect(client.connection.state).to.equal('connected');

    // Wait for channel to re-attach
    for (let i = 0; i < 10; i++) {
      clock.tick(0);
      await flushAsync();
    }

    expect(channel.state).to.equal('attached');
    expect(attachCount).to.be.at.least(2);
    client.close();
  });
});
