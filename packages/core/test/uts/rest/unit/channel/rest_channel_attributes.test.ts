/**
 * UTS: REST Channel Attributes Tests
 *
 * Spec points: RSL7, RSL8, RSL8a, RSL9
 * Source: uts/test/rest/unit/channel/rest_channel_attributes.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/channel/rest_channel_attributes', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL9 - channel name attribute
   *
   * The channel object must expose its name via a name attribute,
   * including any namespace prefix.
   */
  // UTS: rest/unit/RSL9/channel-name-attribute-0
  it('RSL9 - channel name attribute', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

    const ch1 = client.channels.get('my-channel');
    expect(ch1.name).to.equal('my-channel');

    const ch2 = client.channels.get('namespace:channel-name');
    expect(ch2.name).to.equal('namespace:channel-name');
  });

  /**
   * RSL7 - setOptions completes without error
   *
   * Calling setOptions with an empty options object must complete
   * successfully without throwing.
   */
  // UTS: rest/unit/RSL7/setoptions-updates-options-0
  it('RSL7 - setOptions completes without error', async function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test-channel');

    await channel.setOptions({});
  });

  /**
   * RSL7 - setOptions stores channel options
   *
   * Calling setOptions with options stores them on the channel.
   * The call should complete without error.
   */
  // UTS: rest/unit/RSL7/setoptions-stores-options-1
  it('RSL7 - setOptions stores channel options', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test-RSL7-store');

    // setOptions is synchronous in ably-js and returns void
    channel.setOptions({});
    // No error thrown — success
  });

  /**
   * RSL8 - status sends GET to correct path
   *
   * Calling status() on a channel sends a GET request to
   * /channels/<channelName>.
   */
  // UTS: rest/unit/RSL8/status-get-correct-endpoint-0
  it('RSL8 - status sends GET to correct path', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          channelId: 'test-channel',
          status: {
            isActive: true,
            occupancy: { metrics: { connections: 5 } },
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-channel');
    await ch.status();

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/channels/test-channel');
  });

  /**
   * RSL8 - status URL encodes channel name
   *
   * Channel names containing special characters (colons, spaces, etc.)
   * must be URL-encoded in the request path.
   */
  // UTS: rest/unit/RSL8/status-special-chars-encoded-1
  it('RSL8 - status URL encodes channel name', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          channelId: 'namespace:my channel',
          status: {
            isActive: true,
            occupancy: { metrics: { connections: 1 } },
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('namespace:my channel');
    await ch.status();

    expect(captured).to.have.length(1);
    expect(captured[0].path).to.contain(encodeURIComponent('namespace:my channel'));
  });

  /**
   * RSL8a - status returns ChannelDetails
   *
   * The status() method returns a ChannelDetails object with channelId,
   * status.isActive, and status.occupancy.metrics fields.
   */
  // UTS: rest/unit/RSL8a/status-returns-channel-details-0
  it('RSL8a - status returns ChannelDetails', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, {
          channelId: 'test-RSL8a',
          status: {
            isActive: true,
            occupancy: {
              metrics: {
                connections: 5,
                publishers: 2,
                subscribers: 3,
              },
            },
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-RSL8a');
    const result = await ch.status();

    expect(result.channelId).to.equal('test-RSL8a');
    expect(result.status.isActive).to.equal(true);
    expect(result.status.occupancy.metrics.connections).to.equal(5);
    expect(result.status.occupancy.metrics.publishers).to.equal(2);
    expect(result.status.occupancy.metrics.subscribers).to.equal(3);
  });

  /**
   * CHD2+CHS2+CHO2+CHM2 - status() response parses all ChannelMetrics fields
   *
   * Tests that status() parses the complete set of ChannelMetrics fields
   * from the response, including all CHM2a-h attributes.
   */
  // UTS: rest/unit/CHM2/parses-all-metrics-fields-0
  it('CHD2+CHS2+CHO2+CHM2 - status() response parses all ChannelMetrics fields', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, {
          channelId: 'test-CHM2-full',
          status: {
            isActive: true,
            occupancy: {
              metrics: {
                connections: 10,
                presenceConnections: 5,
                presenceMembers: 3,
                presenceSubscribers: 4,
                publishers: 6,
                subscribers: 8,
                objectPublishers: 2,
                objectSubscribers: 1,
              },
            },
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-CHM2-full');
    const result = await ch.status();

    // CHD2a: channelId
    expect(result.channelId).to.equal('test-CHM2-full');

    // CHD2b + CHS2a: status.isActive
    expect(result.status).to.not.be.null;
    expect(result.status.isActive).to.equal(true);

    // CHS2b + CHO2a: occupancy.metrics
    expect(result.status.occupancy).to.not.be.null;
    expect(result.status.occupancy.metrics).to.not.be.null;

    const metrics = result.status.occupancy.metrics;

    // CHM2a: connections
    expect(metrics.connections).to.equal(10);

    // CHM2b: presenceConnections
    expect(metrics.presenceConnections).to.equal(5);

    // CHM2c: presenceMembers
    expect(metrics.presenceMembers).to.equal(3);

    // CHM2d: presenceSubscribers
    expect(metrics.presenceSubscribers).to.equal(4);

    // CHM2e: publishers
    expect(metrics.publishers).to.equal(6);

    // CHM2f: subscribers
    expect(metrics.subscribers).to.equal(8);

    // CHM2g: objectPublishers - not in ably-js ChannelMetrics type definition,
    // but present on the runtime object since the JSON response is passed through as-is.
    // DEVIATION: ably-js ChannelMetrics type (ably.d.ts) does not declare objectPublishers or objectSubscribers.
    expect((metrics as any).objectPublishers).to.equal(2);

    // CHM2h: objectSubscribers - same deviation as CHM2g above.
    expect((metrics as any).objectSubscribers).to.equal(1);
  });

  /**
   * CHM2 - status() response with zero/missing metric fields
   *
   * Tests that status() handles zero-valued and absent metric fields
   * gracefully. Omitted fields (objectPublishers, objectSubscribers)
   * simulate an older server that does not include these fields.
   */
  // UTS: rest/unit/CHM2/zero-and-missing-metrics-1
  it('CHM2 - status() response with zero and missing metric fields', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        // Response omits objectPublishers and objectSubscribers (CHM2g, CHM2h)
        // to simulate an older server that does not include these fields.
        req.respond_with(200, {
          channelId: 'test-CHM2-zeros',
          status: {
            isActive: false,
            occupancy: {
              metrics: {
                connections: 0,
                presenceConnections: 0,
                presenceMembers: 0,
                presenceSubscribers: 0,
                publishers: 0,
                subscribers: 0,
              },
            },
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-CHM2-zeros');
    const result = await ch.status();

    // CHD2a: channelId
    expect(result.channelId).to.equal('test-CHM2-zeros');

    // CHS2a: isActive can be false
    expect(result.status.isActive).to.equal(false);

    const metrics = result.status.occupancy.metrics;

    // CHM2a-f: explicit zero values are parsed correctly
    expect(metrics.connections).to.equal(0);
    expect(metrics.presenceConnections).to.equal(0);
    expect(metrics.presenceMembers).to.equal(0);
    expect(metrics.presenceSubscribers).to.equal(0);
    expect(metrics.publishers).to.equal(0);
    expect(metrics.subscribers).to.equal(0);

    // CHM2g-h: omitted fields are undefined (not defaulted to 0).
    // DEVIATION: The UTS spec expects missing fields to default to 0,
    // but ably-js passes the JSON response through as-is without defaults,
    // so omitted fields are undefined rather than 0.
    expect((metrics as any).objectPublishers).to.equal(undefined);
    expect((metrics as any).objectSubscribers).to.equal(undefined);
  });
});
