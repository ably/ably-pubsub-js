/**
 * UTS: REST Channels Collection Tests
 *
 * Spec points: RSN1, RSN2, RSN3a, RSN3b, RSN3c, RSN4a, RSN4b
 * Source: uts/test/rest/unit/channels_collection.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';

describe('uts/rest/unit/channels_collection', function () {
  let mock;

  beforeEach(function () {
    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, []),
    });
    installMockHttp(mock);
  });

  afterEach(function () {
    restoreAll();
  });

  /**
   * RSN1 - Channels collection accessible via RestClient
   *
   * The RestClient exposes a channels collection with a get() method
   * for obtaining RestChannel instances.
   */
  // UTS: rest/unit/RSN1/channels-collection-accessible-0
  it('RSN1 - Channels collection accessible via RestClient', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    expect(client.channels).to.exist;
    expect(client.channels.get).to.be.a('function');
  });

  /**
   * RSN2 - Check channel existence
   *
   * Before a channel is created, it should not appear in the collection.
   * After get() is called, it should be present.
   */
  // UTS: rest/unit/RSN2/check-channel-exists-0
  it('RSN2 - Check channel existence', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    // Before creating any channel
    expect('test' in client.channels.all).to.be.false;

    // Create the channel via get
    client.channels.get('test');

    // After creating the channel
    expect('test' in client.channels.all).to.be.true;

    // Non-existent channel should not be present
    expect('other' in client.channels.all).to.be.false;
  });

  /**
   * RSN2 - Iterate through existing channels
   *
   * Multiple channels created via get() should all be iterable
   * through the channels.all property.
   */
  // UTS: rest/unit/RSN2/iterate-channels-1
  it('RSN2 - Iterate through existing channels', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    client.channels.get('channel-a');
    client.channels.get('channel-b');
    client.channels.get('channel-c');

    const channelNames = Object.keys(client.channels.all);

    expect(channelNames).to.have.length(3);
    expect(channelNames).to.include('channel-a');
    expect(channelNames).to.include('channel-b');
    expect(channelNames).to.include('channel-c');
  });

  /**
   * RSN3a - Get creates new channel if none exists
   *
   * Calling get() with a channel name that does not yet exist
   * creates a new RestChannel with the specified name.
   */
  // UTS: rest/unit/RSN3a/get-creates-new-channel-0
  it('RSN3a - Get creates new channel if none exists', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const channel = client.channels.get('test');

    expect(channel).to.exist;
    expect(channel.name).to.equal('test');
    expect('test' in client.channels.all).to.be.true;
  });

  /**
   * RSN3a - Get returns same instance for existing channel
   *
   * Calling get() with the same channel name returns the same
   * cached RestChannel instance (identity equality).
   */
  // UTS: rest/unit/RSN3a/get-returns-existing-channel-1
  it('RSN3a - Get returns same instance for existing channel', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const channel1 = client.channels.get('test');
    const channel2 = client.channels.get('test');

    expect(channel1).to.equal(channel2);
  });

  /**
   * RSN4a - Release removes channel from collection
   *
   * Calling release() with a channel name removes that channel
   * from the internal cache, so it no longer appears in all.
   */
  // UTS: rest/unit/RSN4a/release-removes-channel-0
  it('RSN4a - Release removes channel from collection', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    client.channels.get('test');
    expect('test' in client.channels.all).to.be.true;

    client.channels.release('test');
    expect('test' in client.channels.all).to.be.false;
  });

  /**
   * RSN4b - Release on non-existent channel is no-op
   *
   * Calling release() with a channel name that does not correspond
   * to an existing channel must return without error.
   */
  // UTS: rest/unit/RSN4b/release-nonexistent-noop-0
  it('RSN4b - Release on non-existent channel is no-op', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    // Should not throw
    expect(() => client.channels.release('nonexistent')).to.not.throw();

    // Collection should still be empty
    expect(Object.keys(client.channels.all)).to.have.length(0);
  });

  /**
   * RSN3a - Get after release creates new instance
   *
   * After releasing a channel and calling get() again with the same name,
   * a new RestChannel instance is created (not the previously cached one).
   */
  // UTS: rest/unit/RSN3a/get-after-release-new-instance-3
  it('RSN3a - Get after release creates new instance', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const channel1 = client.channels.get('test');
    client.channels.release('test');
    const channel2 = client.channels.get('test');

    expect(channel1).to.not.equal(channel2);
    expect(channel2.name).to.equal('test');
    expect('test' in client.channels.all).to.be.true;
  });

  /**
   * RSN3c - Get with channelOptions updates options on channel
   *
   * When get() is called with channelOptions, those options are applied
   * to the channel (either new or existing).
   */
  // UTS: rest/unit/RSN3a/subscript-creates-or-returns-2
  it('RSN3c - Get with channelOptions updates options', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    const channel = client.channels.get('test', { params: { rewind: '1' } });

    expect(channel.name).to.equal('test');
    expect(channel.channelOptions).to.deep.include({ params: { rewind: '1' } });
  });
});
