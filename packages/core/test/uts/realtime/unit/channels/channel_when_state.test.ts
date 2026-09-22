/**
 * UTS: Channel whenState Tests
 *
 * Spec points: RTL25, RTL25a, RTL25b
 * Source: uts/test/realtime/unit/channels/channel_when_state_test.md
 *
 * Tests the whenState convenience function:
 * - Resolves immediately if already in target state (with null)
 * - Waits for state transition if not in target state (with ChannelStateChange)
 * - Only fires once per call
 * - Does not resolve for past states
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_when_state', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL25a - whenState resolves immediately if already in target state
   */
  // UTS: realtime/unit/RTL25a/resolves-immediately-current-0
  it('RTL25a - whenState resolves immediately when in target state', async function () {
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

    const channel = client.channels.get('test-RTL25a');
    await channel.attach();

    // Already attached — should resolve immediately with null
    const result = await channel.whenState('attached');
    expect(result).to.be.null;
    client.close();
  });

  /**
   * RTL25b - whenState waits for state transition
   */
  // UTS: realtime/unit/RTL25b/waits-for-state-change-0
  it('RTL25b - whenState waits for state then resolves', async function () {
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

    const channel = client.channels.get('test-RTL25b');

    // Channel is in initialized state — start waiting for attached
    const whenStatePromise = channel.whenState('attached');

    // Attach triggers the transition
    await channel.attach();

    const result = await whenStatePromise;

    // Result should be a ChannelStateChange (not null)
    expect(result).to.not.be.null;
    expect(result!.current).to.equal('attached');
    expect(result!.previous).to.satisfy((p: string) => p === 'initialized' || p === 'attaching');
    client.close();
  });

  /**
   * RTL25b - whenState only fires once
   */
  // UTS: realtime/unit/RTL25b/fires-once-only-1
  it('RTL25b - whenState is one-shot', async function () {
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

    const channel = client.channels.get('test-RTL25b-once');

    let attachCount = 0;
    channel.once('attached', () => {
      attachCount++;
    });

    // Start whenState before attach
    const whenStatePromise = channel.whenState('attached');

    // First attach
    await channel.attach();
    const result = await whenStatePromise;
    expect(result).to.not.be.null;
    expect(attachCount).to.equal(1);

    // Detach then re-attach
    await channel.detach();
    await channel.attach();

    // Wait a bit
    await flushAsync();

    // once listener fired only once
    expect(attachCount).to.equal(1);
    client.close();
  });

  /**
   * RTL25a - whenState for past state does NOT resolve
   */
  // UTS: realtime/unit/RTL25a/past-state-does-not-resolve-1
  it('RTL25a - whenState for past state does not resolve', async function () {
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

    const channel = client.channels.get('test-RTL25a-past');

    // Attach — channel passes through attaching to attached
    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Call whenState for 'attaching' — a past state
    let resolved = false;
    channel.whenState('attaching').then(() => {
      resolved = true;
    });

    // Wait to see if it resolves
    await flushAsync();

    // Should NOT have resolved
    expect(resolved).to.be.false;
    client.close();
  });
});
