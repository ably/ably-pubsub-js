/**
 * UTS: Channel Additional ATTACHED Tests
 *
 * Spec points: RTL12
 * Source: uts/test/realtime/unit/channels/channel_additional_attached_test.md
 *
 * Tests UPDATE event emission when an additional ATTACHED message is
 * received while the channel is already ATTACHED:
 * - resumed=false → UPDATE emitted
 * - resumed=true → UPDATE NOT emitted (unless updateOnAttached set)
 * - error field propagated to UPDATE event reason
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_additional_attached', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL12 - Additional ATTACHED with resumed=false emits UPDATE with error
   */
  // UTS: realtime/unit/RTL12/update-emits-with-error-0
  it('RTL12 - UPDATE emitted with error on non-resumed ATTACHED', async function () {
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

    const channel = client.channels.get('test-RTL12-update');
    await channel.attach();

    const updateEvents: any[] = [];
    channel.on('update', (change: any) => {
      updateEvents.push(change);
    });

    // Send additional ATTACHED without RESUMED flag, with error
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL12-update',
      flags: 0, // No RESUMED
      error: {
        message: 'Continuity lost',
        code: 50000,
        statusCode: 500,
      },
    });

    await flushAsync();

    expect(channel.state).to.equal('attached');
    expect(updateEvents.length).to.equal(1);
    expect(updateEvents[0].current).to.equal('attached');
    expect(updateEvents[0].previous).to.equal('attached');
    expect(updateEvents[0].resumed).to.equal(false);
    expect(updateEvents[0].reason).to.not.be.null;
    expect(updateEvents[0].reason).to.not.be.undefined;
    expect(updateEvents[0].reason.code).to.equal(50000);
    client.close();
  });

  /**
   * RTL12 - Additional ATTACHED with resumed=true does NOT emit UPDATE
   */
  // UTS: realtime/unit/RTL12/resumed-no-update-1
  it('RTL12 - no UPDATE on resumed ATTACHED', async function () {
    const RESUMED = 4; // 1 << 2

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

    const channel = client.channels.get('test-RTL12-resumed');
    await channel.attach();

    const updateEvents: any[] = [];
    channel.on('update', (change: any) => {
      updateEvents.push(change);
    });

    // Send additional ATTACHED WITH RESUMED flag
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL12-resumed',
      flags: RESUMED,
    });

    await flushAsync();

    expect(channel.state).to.equal('attached');
    expect(updateEvents.length).to.equal(0); // No UPDATE emitted
    client.close();
  });

  /**
   * RTL12 - Additional ATTACHED without error has null reason
   */
  // UTS: realtime/unit/RTL12/no-error-null-reason-2
  it('RTL12 - UPDATE without error has null reason', async function () {
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

    const channel = client.channels.get('test-RTL12-no-error');
    await channel.attach();

    const updateEvents: any[] = [];
    channel.on('update', (change: any) => {
      updateEvents.push(change);
    });

    // Send additional ATTACHED without RESUMED flag and WITHOUT error
    mock.active_connection!.send_to_client({
      action: 11, // ATTACHED
      channel: 'test-RTL12-no-error',
      flags: 0, // No RESUMED
    });

    await flushAsync();

    expect(channel.state).to.equal('attached');
    expect(updateEvents.length).to.equal(1);
    expect(updateEvents[0].resumed).to.equal(false);
    // reason should be absent/null/undefined
    expect(updateEvents[0].reason).to.satisfy((r: any) => !r, 'reason should be null/undefined when no error');
    client.close();
  });
});
