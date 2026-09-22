/**
 * UTS: Channel Attributes Tests
 *
 * Spec points: RTL23, RTL24
 * Source: uts/test/realtime/unit/channels/channel_attributes.md
 *
 * Tests channel name attribute and errorReason lifecycle.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_attributes', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL23 - RealtimeChannel name attribute
   */
  // UTS: realtime/unit/RTL23/name-attribute-0
  it('RTL23 - channel name attribute', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('my-channel');
    expect(channel.name).to.equal('my-channel');

    const channel2 = client.channels.get('namespace:channel-name');
    expect(channel2.name).to.equal('namespace:channel-name');
    client.close();
  });

  /**
   * RTL24 - errorReason set on channel error
   */
  // UTS: realtime/unit/RTL24/error-reason-channel-error-0
  it('RTL24 - errorReason set on channel ERROR', async function () {
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

    const channel = client.channels.get('test-RTL24-error');
    await channel.attach();
    expect(channel.errorReason).to.be.null;

    // Send channel ERROR
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTL24-error',
      error: {
        message: 'Channel error occurred',
        code: 90001,
        statusCode: 500,
      },
    });

    await new Promise<void>((resolve) => channel.once('failed', resolve));
    client.close();
    expect(channel.state).to.equal('failed');
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason!.code).to.equal(90001);
    expect(channel.errorReason!.statusCode).to.equal(500);
  });

  /**
   * RTL24 - errorReason set on attach failure
   */
  // UTS: realtime/unit/RTL24/error-reason-attach-failure-1
  it('RTL24 - errorReason set on attach failure', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          // Respond with DETACHED + error (attach rejected)
          mock.active_connection!.send_to_client({
            action: 13, // DETACHED
            channel: msg.channel,
            error: {
              message: 'Permission denied',
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

    const channel = client.channels.get('test-RTL24-attach-fail');
    try {
      await channel.attach();
      expect.fail('Expected attach to fail');
    } catch (err: any) {
      expect(err.code).to.equal(40160);
    }

    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason!.code).to.equal(40160);
    expect(channel.errorReason!.statusCode).to.equal(401);
    client.close();
  });

  /**
   * RTL4g/RTL24 - errorReason cleared on successful re-attach from FAILED
   *
   * Per RTL4g: "If the channel is in the FAILED state, the attach request
   * sets its errorReason to null, and proceeds with a channel attach."
   */
  // UTS: realtime/unit/RTL4c/error-cleared-on-attach-0
  it('RTL4g - errorReason cleared on re-attach from FAILED', async function () {
    // DEVIATION: see deviations.md — ably-js does not clear errorReason on successful re-attach (RTL4c)
    if (!process.env.RUN_DEVIATIONS) this.skip();

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
            // First attach fails
            mock.active_connection!.send_to_client({
              action: 13, // DETACHED
              channel: msg.channel,
              error: {
                message: 'Temporary error',
                code: 50000,
                statusCode: 500,
              },
            });
          } else {
            // Second attach succeeds
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

    const channel = client.channels.get('test-RTL4g-clear-attach');

    // First attach fails — errorReason set
    try {
      await channel.attach();
      expect.fail('Expected attach to fail');
    } catch (err: any) {
      expect(err.code).to.equal(50000);
    }
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason!.code).to.equal(50000);

    // Second attach succeeds — per RTL4g, errorReason must be cleared
    await channel.attach();
    expect(channel.state).to.equal('attached');
    expect(channel.errorReason).to.be.null;
    client.close();
  });

  /**
   * RTL4g/RTL24 - errorReason cleared on re-attach from FAILED, then detach
   *
   * Per RTL4g: attach from FAILED clears errorReason. After re-attach and
   * detach, errorReason should remain null (detach does not set it).
   */
  // UTS: realtime/unit/RTL4c/error-cleared-preserved-detach-1
  it('RTL4g - errorReason cleared on re-attach and detach', async function () {
    // DEVIATION: see deviations.md — ably-js does not clear errorReason on successful re-attach (RTL4c)
    if (!process.env.RUN_DEVIATIONS) this.skip();

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

    const channel = client.channels.get('test-RTL4g-clear-detach');
    await channel.attach();

    // Send channel ERROR to put it in FAILED state
    mock.active_connection!.send_to_client({
      action: 9, // ERROR
      channel: 'test-RTL4g-clear-detach',
      error: {
        message: 'Channel error',
        code: 90002,
        statusCode: 500,
      },
    });

    await new Promise<void>((resolve) => channel.once('failed', resolve));
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason!.code).to.equal(90002);

    // Re-attach — per RTL4g, errorReason cleared
    await channel.attach();
    expect(channel.state).to.equal('attached');
    expect(channel.errorReason).to.be.null;

    // Detach — errorReason stays null
    await channel.detach();
    expect(channel.state).to.equal('detached');
    expect(channel.errorReason).to.be.null;
    client.close();
  });
});
