/**
 * UTS: Push Admin Live Activity Tests
 *
 * Spec points: RSH1, RSH1e, RSH1e1, RSH1e2, RSH1e3
 * Source: uts/test/rest/unit/push/push_admin_live_activity.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/push/push_admin_live_activity', function () {
  afterEach(restoreAll);

  function mockCapturing(captured: any[], status = 200, responseBody: any = {}) {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(status, responseBody);
      },
    });
    installMockHttp(mock);
  }

  /**
   * start sends POST to /push/apnsBroadcastChannels/{id}/start with channels and apns
   */
  // UTS: rest/unit/RSH1e1/start-post-0
  it('RSH1e1 - start sends POST to /push/apnsBroadcastChannels/{id}/start', async function () {
    const captured: any[] = [];
    mockCapturing(captured);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.liveActivity.start({
      recipient: { channels: ['nba:lakers', 'nba:celtics'] },
      apnsBroadcast: 'broadcast-1',
      apns: { aps: { event: 'start', 'attributes-type': 'GameAttributes' } },
      headers: { 'apns-priority': '10', 'apns-expiration': '1782948701' },
    });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/push/apnsBroadcastChannels/broadcast-1/start');

    const body = JSON.parse(captured[0].body);
    expect(body.channels).to.deep.equal(['nba:lakers', 'nba:celtics']);
    expect(body.apns.aps.event).to.equal('start');
    expect(body).to.not.have.property('deviceId');
    // The optional APNs delivery headers are sent in the request body under a `headers` key.
    expect(body.headers).to.deep.equal({ 'apns-priority': '10', 'apns-expiration': '1782948701' });
    expect(captured[0].headers.authorization).to.match(/^Basic /);
  });

  /**
   * start includes deviceId when supplied and url-encodes the broadcast id
   */
  // UTS: rest/unit/RSH1e1/start-deviceid-encode-1
  it('RSH1e1 - start includes deviceId and url-encodes the broadcast id', async function () {
    const captured: any[] = [];
    mockCapturing(captured);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.liveActivity.start({
      recipient: { deviceId: 'device-7' },
      apnsBroadcast: 'broadcast/with space',
      apns: { aps: { event: 'start' } },
    });

    expect(captured).to.have.length(1);
    expect(captured[0].path).to.equal('/push/apnsBroadcastChannels/broadcast%2Fwith%20space/start');
    const body = JSON.parse(captured[0].body);
    expect(body.deviceId).to.equal('device-7');
    expect(body).to.not.have.property('channels');
  });

  /**
   * update sends POST to /push/apnsBroadcastChannels/{id}/broadcast with apns and headers
   */
  // UTS: rest/unit/RSH1e2/update-post-0
  it('RSH1e2 - update sends POST to /push/apnsBroadcastChannels/{id}/broadcast', async function () {
    const captured: any[] = [];
    mockCapturing(captured);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.liveActivity.update({
      apnsBroadcast: 'broadcast-1',
      apns: { aps: { event: 'update', 'content-state': { homeScore: 14 } } },
      headers: { 'apns-priority': '10', 'apns-expiration': '1782948701' },
    });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/push/apnsBroadcastChannels/broadcast-1/broadcast');

    const body = JSON.parse(captured[0].body);
    expect(body.apns.aps.event).to.equal('update');
    // The optional APNs delivery headers are sent in the request body under a `headers` key.
    expect(body.headers).to.deep.equal({ 'apns-priority': '10', 'apns-expiration': '1782948701' });
    expect(captured[0].headers.authorization).to.match(/^Basic /);
  });

  /**
   * update omits headers when not supplied
   */
  // UTS: rest/unit/RSH1e2/update-no-headers-1
  it('RSH1e2 - update omits headers when not supplied', async function () {
    const captured: any[] = [];
    mockCapturing(captured);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.liveActivity.update({
      apnsBroadcast: 'broadcast-1',
      apns: { aps: { event: 'update', 'content-state': {} } },
    });

    const body = JSON.parse(captured[0].body);
    expect(body).to.not.have.property('headers');
    expect(body.apns.aps.event).to.equal('update');
  });

  /**
   * end sends POST to /push/apnsBroadcastChannels/{id}/end with apns
   */
  // UTS: rest/unit/RSH1e3/end-post-0
  it('RSH1e3 - end sends POST to /push/apnsBroadcastChannels/{id}/end', async function () {
    const captured: any[] = [];
    mockCapturing(captured);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.liveActivity.end({
      apnsBroadcast: 'broadcast-1',
      apns: { aps: { event: 'end', 'content-state': { homeScore: 112 }, 'dismissal-date': 1700000000 } },
    });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/push/apnsBroadcastChannels/broadcast-1/end');

    const body = JSON.parse(captured[0].body);
    expect(body.apns.aps.event).to.equal('end');
    expect(body.apns.aps['dismissal-date']).to.equal(1700000000);
    expect(captured[0].headers.authorization).to.match(/^Basic /);
  });

  /**
   * server errors propagate for each method
   */
  // UTS: rest/unit/RSH1e1/server-error-2
  it('RSH1e1 - start propagates server error', async function () {
    const captured: any[] = [];
    mockCapturing(captured, 400, { error: { code: 40000, statusCode: 400, message: 'Invalid request' } });

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

    try {
      await client.push.admin.liveActivity.start({
        recipient: { channels: ['nba:lakers'] },
        apnsBroadcast: 'broadcast-1',
        apns: {},
      });
      expect.fail('Expected start to throw');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
  });

  // UTS: rest/unit/RSH1e2/server-error-2
  it('RSH1e2 - update propagates server error', async function () {
    const captured: any[] = [];
    mockCapturing(captured, 400, { error: { code: 40000, statusCode: 400, message: 'Invalid request' } });

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

    try {
      await client.push.admin.liveActivity.update({ apnsBroadcast: 'broadcast-1', apns: {} });
      expect.fail('Expected update to throw');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
  });

  // UTS: rest/unit/RSH1e3/server-error-1
  it('RSH1e3 - end propagates server error', async function () {
    const captured: any[] = [];
    mockCapturing(captured, 400, { error: { code: 40000, statusCode: 400, message: 'Invalid request' } });

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

    try {
      await client.push.admin.liveActivity.end({ apnsBroadcast: 'broadcast-1', apns: {} });
      expect.fail('Expected end to throw');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
  });
});
