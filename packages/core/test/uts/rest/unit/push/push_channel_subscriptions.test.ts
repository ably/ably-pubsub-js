/**
 * UTS: Push Channel Subscriptions Tests
 *
 * Spec points: RSH1c, RSH1c1 (list), RSH1c2 (listChannels), RSH1c3 (save), RSH1c5 (removeWhere)
 * Source: uts/test/rest/unit/push/push_channel_subscriptions.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/push/push_channel_subscriptions', function () {
  afterEach(restoreAll);

  /**
   * RSH1c3 - save sends POST to /push/channelSubscriptions
   *
   * save() issues a POST request to the channelSubscriptions endpoint
   * with the subscription in the body.
   */
  // UTS: rest/unit/RSH1c3/save-post-subscription-0
  it('RSH1c3 - save sends POST to /push/channelSubscriptions', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          channel: 'my-channel',
          deviceId: 'device-001',
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.save({
      channel: 'my-channel',
      deviceId: 'device-001',
    });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/push/channelSubscriptions');
  });

  /**
   * RSH1c3 - save body contains channel and subscription details
   *
   * The POST body must contain the channel name and either
   * deviceId or clientId. The response is parsed into a
   * PushChannelSubscription object.
   */
  // UTS: rest/unit/RSH1c3/save-updates-existing-1
  it('RSH1c3 - save body contains channel and subscription details', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          channel: 'my-channel',
          deviceId: 'device-001',
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.push.admin.channelSubscriptions.save({
      channel: 'my-channel',
      deviceId: 'device-001',
    });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.channel).to.equal('my-channel');
    expect(body.deviceId).to.equal('device-001');

    // Response is parsed as PushChannelSubscription
    expect(result.channel).to.equal('my-channel');
    expect(result.deviceId).to.equal('device-001');
  });

  /**
   * RSH1c1 - list sends GET to /push/channelSubscriptions
   *
   * list() issues a GET request to the channelSubscriptions endpoint.
   */
  // UTS: rest/unit/RSH1c4/remove-nonexistent-succeeds-2
  it('RSH1c1 - list sends GET to /push/channelSubscriptions', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [{ channel: 'my-channel', deviceId: 'device-001' }]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.list({});

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/push/channelSubscriptions');
  });

  /**
   * RSH1c1 - list with channel filter
   *
   * list() forwards the channel parameter as a query parameter
   * and returns matching subscriptions.
   */
  // UTS: rest/unit/RSH1c1/list-filtered-by-channel-0
  it('RSH1c1 - list with channel filter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          { channel: 'my-channel', deviceId: 'device-001' },
          { channel: 'my-channel', clientId: 'client-abc' },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.list({ channel: 'my-channel' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('channel')).to.equal('my-channel');
  });

  /**
   * RSH1c1 - list returns PaginatedResult
   *
   * list() returns a PaginatedResult containing PushChannelSubscription objects.
   */
  // UTS: rest/unit/RSH1c1/list-filtered-by-channel-0.1
  it('RSH1c1 - list returns PaginatedResult', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          { channel: 'my-channel', deviceId: 'device-001' },
          { channel: 'my-channel', clientId: 'client-abc' },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.push.admin.channelSubscriptions.list({ channel: 'my-channel' });

    expect(result.items).to.have.length(2);
    expect((result.items[0] as any).channel).to.equal('my-channel');
    expect((result.items[0] as any).deviceId).to.equal('device-001');
    expect((result.items[1] as any).clientId).to.equal('client-abc');
  });

  /**
   * RSH1c5 - removeWhere sends DELETE to /push/channelSubscriptions
   *
   * removeWhere() issues a DELETE request to the channelSubscriptions
   * endpoint with filter parameters as query params.
   */
  // UTS: rest/unit/RSH1c5/remove-where-clientid-0
  it('RSH1c5 - removeWhere sends DELETE to /push/channelSubscriptions', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(204, null);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.removeWhere({ clientId: 'client-abc' });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].path).to.equal('/push/channelSubscriptions');
    expect(captured[0].url.searchParams.get('clientId')).to.equal('client-abc');
  });

  /**
   * RSH1c5 - removeWhere with channel param
   *
   * removeWhere() forwards the channel parameter along with other
   * filter params to delete matching subscriptions.
   */
  // UTS: rest/unit/RSH1c5/remove-where-no-match-succeeds-2
  it('RSH1c5 - removeWhere with channel param', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(204, null);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.removeWhere({
      channel: 'my-channel',
      deviceId: 'device-001',
    });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].path).to.equal('/push/channelSubscriptions');
    expect(captured[0].url.searchParams.get('channel')).to.equal('my-channel');
    expect(captured[0].url.searchParams.get('deviceId')).to.equal('device-001');
  });

  /**
   * RSH1c2 - listChannels sends GET to /push/channels
   *
   * listChannels() issues a GET request to the /push/channels endpoint.
   */
  // UTS: rest/unit/RSH1c2/list-channels-with-limit-1
  it('RSH1c2 - listChannels sends GET to /push/channels', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, ['channel-1', 'channel-2', 'channel-3']);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.listChannels({});

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/push/channels');
  });

  /**
   * RSH1c2 - listChannels returns PaginatedResult
   *
   * listChannels() returns a PaginatedResult containing channel
   * name strings.
   */
  // UTS: rest/unit/RSH1c2/list-channels-paginated-0
  it('RSH1c2 - listChannels returns PaginatedResult', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, ['channel-1', 'channel-2', 'channel-3']);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.push.admin.channelSubscriptions.listChannels({});

    expect(result.items).to.have.length(3);
    expect(result.items[0]).to.equal('channel-1');
    expect(result.items[1]).to.equal('channel-2');
    expect(result.items[2]).to.equal('channel-3');
  });

  /**
   * RSH1c2 - listChannels with params
   *
   * listChannels() forwards the limit parameter as a query parameter.
   */
  // UTS: rest/unit/RSH1c4/remove-delete-clientid-0
  it('RSH1c2 - listChannels with params', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, ['channel-1']);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.push.admin.channelSubscriptions.listChannels({ limit: '1' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('1');
    expect(result.items).to.have.length(1);
  });

  /**
   * RSH1c1 - list with deviceId and clientId filters
   *
   * list() forwards both deviceId and clientId as query parameters
   * when both are provided.
   */
  // UTS: rest/unit/RSH1c1/list-filtered-by-device-client-1
  it('RSH1c1 - list with deviceId and clientId filters', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [{ channel: 'my-channel', deviceId: 'device-001', clientId: 'client-abc' }]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.list({ deviceId: 'device-001', clientId: 'client-abc' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('deviceId')).to.equal('device-001');
    expect(captured[0].url.searchParams.get('clientId')).to.equal('client-abc');
  });

  /**
   * RSH1c1 - list supports limit
   *
   * list() forwards the limit parameter as a query parameter.
   */
  // UTS: rest/unit/RSH1c1/list-with-limit-param-2
  it('RSH1c1 - list supports limit', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [{ channel: 'ch1', deviceId: 'device-001' }]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.list({ limit: '5' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('5');
  });

  /**
   * RSH1c3 - save propagates server error
   *
   * When the server returns an error response, save() must
   * propagate it as an exception with the correct error code.
   */
  // UTS: rest/unit/RSH1c3/save-error-propagated-2
  it('RSH1c3 - save propagates server error', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(400, {
          error: { code: 40000, statusCode: 400, message: 'Invalid request' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

    try {
      await client.push.admin.channelSubscriptions.save({
        channel: 'my-channel',
        deviceId: 'device-001',
      });
      expect.fail('Expected save to throw');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
  });

  /**
   * RSH1c4 - remove with deviceId
   *
   * remove() issues a DELETE request to the channelSubscriptions
   * endpoint with channel and deviceId as query parameters.
   */
  // UTS: rest/unit/RSH1c4/remove-delete-deviceid-1
  it('RSH1c4 - remove with deviceId', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.remove({ channel: 'ch', deviceId: 'dev-1' });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].url.searchParams.get('channel')).to.equal('ch');
    expect(captured[0].url.searchParams.get('deviceId')).to.equal('dev-1');
  });

  /**
   * RSH1c5 - removeWhere with deviceId
   *
   * removeWhere() issues a DELETE request with deviceId as a
   * query parameter.
   */
  // UTS: rest/unit/RSH1c5/remove-where-deviceid-1
  it('RSH1c5 - removeWhere with deviceId', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(204, null);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.channelSubscriptions.removeWhere({ deviceId: 'device-001' });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].url.searchParams.get('deviceId')).to.equal('device-001');
  });
});
