/**
 * UTS: Channels Collection Tests
 *
 * Spec points: RTS1, RTS2, RTS3a, RTS4c, RTS4d, RTS4e
 * Source: uts/test/realtime/unit/channels/channels_collection.md
 *
 * Tests the RealtimeChannels collection: get, release, existence checks,
 * iteration, and identity semantics.
 *
 * Deviation: ably-js has no channels.exists() method — use `name in channels.all`.
 * Deviation: ably-js has no channels.names — use Object.keys(channels.all).
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/channels/channels_collection', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTS1 - Channels collection accessible via RealtimeClient
   */
  // UTS: realtime/unit/RTS1/channels-collection-accessible-0
  it('RTS1 - channels collection accessible via client.channels', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channels = client.channels;
    expect(channels).to.not.be.null;
    expect(channels).to.not.be.undefined;
    expect(channels).to.have.property('get');
    expect(channels).to.have.property('release');
    client.close();
  });

  /**
   * RTS2 - Check if channel exists
   *
   * Deviation: ably-js has no exists() method. Use `name in channels.all`.
   */
  // UTS: realtime/unit/RTS2/channel-exists-check-0
  it('RTS2 - check channel existence', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const name = 'test-RTS2';

    // Before creation
    expect(name in client.channels.all).to.be.false;

    // After creation
    client.channels.get(name);
    expect(name in client.channels.all).to.be.true;

    // Different channel does not exist
    expect('other-channel' in client.channels.all).to.be.false;
    client.close();
  });

  /**
   * RTS2 - Iterate through existing channels
   *
   * Deviation: ably-js has no channels.names — use Object.keys(channels.all).
   */
  // UTS: realtime/unit/RTS2/iterate-channels-1
  it('RTS2 - iterate through existing channels', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.channels.get('chan-a');
    client.channels.get('chan-b');
    client.channels.get('chan-c');

    const names = Object.keys(client.channels.all);
    expect(names).to.include('chan-a');
    expect(names).to.include('chan-b');
    expect(names).to.include('chan-c');
    expect(names).to.have.length(3);
    client.close();
  });

  /**
   * RTS3a - Get creates new channel if none exists
   */
  // UTS: realtime/unit/RTS3a/get-creates-new-channel-0
  it('RTS3a - get creates new channel', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTS3a');
    expect(channel).to.not.be.null;
    expect(channel.name).to.equal('test-RTS3a');
    expect('test-RTS3a' in client.channels.all).to.be.true;
    client.close();
  });

  /**
   * RTS3a - Get returns existing channel (same reference)
   */
  // UTS: realtime/unit/RTS3a/get-returns-existing-channel-1
  it('RTS3a - get returns same channel instance', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel1 = client.channels.get('test-RTS3a-same');
    const channel2 = client.channels.get('test-RTS3a-same');

    expect(channel1).to.equal(channel2);
    expect(channel1.name).to.equal('test-RTS3a-same');
    client.close();
  });

  /**
   * RTS4c - Release on non-existent channel is no-op
   */
  // UTS: realtime/unit/RTS4c/release-nonexistent-noop-0
  it('RTS4c - release non-existent channel is no-op', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.channels.release('does-not-exist');
    expect('does-not-exist' in client.channels.all).to.be.false;
    client.close();
  });

  /**
   * RTS4d - Release removes an initialized channel
   */
  // UTS: realtime/unit/RTS4d/release-removes-channel-0
  it('RTS4d - release removes initialized channel', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel = client.channels.get('test-RTS4d');
    expect(channel.state).to.equal('initialized');
    expect('test-RTS4d' in client.channels.all).to.be.true;

    client.channels.release('test-RTS4d');
    expect('test-RTS4d' in client.channels.all).to.be.false;
    client.close();
  });

  function setupAttachDetachMock() {
    const detachMessages: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11,
            channel: msg.channel,
            flags: 0,
          });
        } else if (msg.action === 12) {
          // DETACH
          detachMessages.push(msg);
          mock.active_connection!.send_to_client({
            action: 13,
            channel: msg.channel,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);
    return { detachMessages };
  }

  /**
   * RTS4d - Release removes a channel once detached
   */
  // UTS: realtime/unit/RTS4d/release-after-detach-1
  it('RTS4d - release removes channel once detached', async function () {
    setupAttachDetachMock();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTS4d-detached');
    await channel.attach();
    await channel.detach();
    expect(channel.state).to.equal('detached');

    client.channels.release('test-RTS4d-detached');
    expect('test-RTS4d-detached' in client.channels.all).to.be.false;
    client.close();
  });

  /**
   * RTS4e - Release of an attached channel fails
   */
  // UTS: realtime/unit/RTS4e/release-attached-fails-0
  it('RTS4e - release of attached channel fails', async function () {
    const { detachMessages } = setupAttachDetachMock();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTS4e-attached');
    await channel.attach();
    expect(channel.state).to.equal('attached');

    let error: any;
    try {
      client.channels.release('test-RTS4e-attached');
    } catch (err) {
      error = err;
    }

    expect(error).to.exist;
    expect(error.code).to.equal(90011);
    expect(error.statusCode).to.equal(400);
    expect(channel.state).to.equal('attached');
    expect('test-RTS4e-attached' in client.channels.all).to.be.true;
    expect(client.channels.get('test-RTS4e-attached')).to.equal(channel);
    expect(detachMessages).to.be.empty;
    client.close();
  });

  /**
   * RTS3a - Get after release creates new channel instance
   */
  // UTS: realtime/unit/RTS3a/get-after-release-new-3
  it('RTS3a - get after release creates new instance', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const channel1 = client.channels.get('test-release-reget');
    client.channels.release('test-release-reget');

    const channel2 = client.channels.get('test-release-reget');
    expect(channel1).to.not.equal(channel2);
    expect(channel2.name).to.equal('test-release-reget');
    expect('test-release-reget' in client.channels.all).to.be.true;
    client.close();
  });

  /**
   * RTS3a - Subscript operator (bracket notation) creates or returns channel
   *
   * Deviation: ably-js does not have a true subscript operator for channels,
   * but channels.all[name] provides similar read access to the channel map.
   * This test verifies that channels.all[name] returns the same channel as
   * channels.get(name) after creation.
   */
  // UTS: realtime/unit/RTS3a/subscript-operator-channel-2
  it('RTS3a - channels.all bracket access returns same channel', function () {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    // Create channel via get()
    const channel1 = client.channels.get('test-subscript');

    // Access via bracket notation on channels.all
    const channel2 = client.channels.all['test-subscript'];

    // Use get() again
    const channel3 = client.channels.get('test-subscript');

    expect(channel1).to.equal(channel2);
    expect(channel2).to.equal(channel3);
    expect(channel1.name).to.equal('test-subscript');
    client.close();
  });
});
