/**
 * UTS: Push Admin createApnsBroadcast Tests
 *
 * Spec points: RSH1, RSH1d
 * Source: uts/test/rest/unit/push/push_admin_apns_broadcast.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/push/push_admin_apns_broadcast', function () {
  afterEach(restoreAll);

  /**
   * createApnsBroadcast sends POST to /push/apnsBroadcastChannels
   */
  // UTS: rest/unit/RSH1d/create-apns-broadcast-post-0
  it('RSH1d - createApnsBroadcast sends POST to /push/apnsBroadcastChannels', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { id: 'broadcast-1', apnsChannelId: 'apns-1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.createApnsBroadcast({ messageStoragePolicy: 1 });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/push/apnsBroadcastChannels');
  });

  /**
   * createApnsBroadcast body contains messageStoragePolicy
   */
  // UTS: rest/unit/RSH1d/message-storage-policy-1
  it('RSH1d - createApnsBroadcast body contains messageStoragePolicy', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { id: 'broadcast-1', apnsChannelId: 'apns-1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.createApnsBroadcast({ messageStoragePolicy: 0 });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.messageStoragePolicy).to.equal(0);
  });

  /**
   * createApnsBroadcast returns { id, apnsChannelId }
   */
  // UTS: rest/unit/RSH1d/returns-ids-2
  it('RSH1d - createApnsBroadcast returns id and apnsChannelId', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(201, { id: 'broadcast-xyz', apnsChannelId: 'apple-channel-abc' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.push.admin.createApnsBroadcast({ messageStoragePolicy: 1 });

    expect(result.id).to.equal('broadcast-xyz');
    expect(result.apnsChannelId).to.equal('apple-channel-abc');
  });

  /**
   * createApnsBroadcast request includes an auth header
   */
  // UTS: rest/unit/RSH1d/auth-header-3
  it('RSH1d - createApnsBroadcast auth header included', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { id: 'broadcast-1', apnsChannelId: 'apns-1' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.createApnsBroadcast({ messageStoragePolicy: 1 });

    expect(captured).to.have.length(1);
    expect(captured[0].headers.authorization).to.match(/^Basic /);
  });

  /**
   * createApnsBroadcast propagates server error
   */
  // UTS: rest/unit/RSH1d/server-error-4
  it('RSH1d - createApnsBroadcast propagates server error', async function () {
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
      await client.push.admin.createApnsBroadcast({ messageStoragePolicy: 1 });
      expect.fail('Expected createApnsBroadcast to throw');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
  });
});
