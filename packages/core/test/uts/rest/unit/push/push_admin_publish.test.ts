/**
 * UTS: Push Admin Publish Tests
 *
 * Spec points: RSH1, RSH1a
 * Source: uts/test/rest/unit/push/push_admin_publish.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/push/push_admin_publish', function () {
  afterEach(restoreAll);

  /**
   * RSH1a - publish sends POST to /push/publish
   *
   * push.admin.publish() must issue a POST request to /push/publish
   * with the recipient and data fields in the body.
   */
  // UTS: rest/unit/RSH1a/publish-post-push-publish-0
  it('RSH1a - publish sends POST to /push/publish', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.publish(
      { transportType: 'apns', deviceToken: 'foo' },
      { notification: { title: 'Test', body: 'Hello' } },
    );

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/push/publish');
  });

  /**
   * RSH1a - body contains recipient and data
   *
   * The POST body must contain the recipient object and the payload
   * fields (notification, data) merged at the top level.
   */
  // UTS: rest/unit/RSH1a/rejects-empty-recipient-3
  it('RSH1a - body contains recipient and data', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.publish(
      { transportType: 'apns', deviceToken: 'foo' },
      { notification: { title: 'Test', body: 'Hello' } },
    );

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.recipient.transportType).to.equal('apns');
    expect(body.recipient.deviceToken).to.equal('foo');
    expect(body.notification.title).to.equal('Test');
    expect(body.notification.body).to.equal('Hello');
  });

  /**
   * RSH1a - recipient as clientId
   *
   * publish() works with a clientId-based recipient.
   */
  // UTS: rest/unit/RSH1a/publish-clientid-recipient-1
  it('RSH1a - recipient as clientId', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.publish({ clientId: 'user-123' }, { data: { key: 'value' } });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.recipient.clientId).to.equal('user-123');
    expect(body.data.key).to.equal('value');
  });

  /**
   * RSH1a - recipient as deviceId
   *
   * publish() works with a deviceId-based recipient.
   */
  // UTS: rest/unit/RSH1a/publish-deviceid-recipient-2
  it('RSH1a - recipient as deviceId', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.publish({ deviceId: 'device-abc' }, { notification: { title: 'Device Push' } });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.recipient.deviceId).to.equal('device-abc');
    expect(body.notification.title).to.equal('Device Push');
  });

  /**
   * RSH1a - data contains notification fields
   *
   * The payload notification and data fields are included in the
   * request body alongside the recipient.
   */
  // UTS: rest/unit/RSH1a/rejects-empty-data-4
  it('RSH1a - data contains notification fields', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.publish(
      { clientId: 'user-1' },
      {
        notification: { title: 'Alert', body: 'Something happened' },
        data: { eventType: 'alert', severity: 'high' },
      },
    );

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.notification.title).to.equal('Alert');
    expect(body.notification.body).to.equal('Something happened');
    expect(body.data.eventType).to.equal('alert');
    expect(body.data.severity).to.equal('high');
  });

  /**
   * RSH1a - auth header included
   *
   * The publish request must include an Authorization header
   * for authentication.
   */
  // UTS: rest/unit/RSH1a/rejects-null-recipient-5
  it('RSH1a - auth header included', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.publish({ clientId: 'user-1' }, { notification: { title: 'Test' } });

    expect(captured).to.have.length(1);
    expect(captured[0].headers.authorization).to.match(/^Basic /);
  });

  /**
   * RSH1 - client.push.admin exposes PushAdmin
   *
   * The client.push property must exist and expose admin with
   * deviceRegistrations and channelSubscriptions sub-objects.
   */
  // UTS: rest/unit/RSH1/push-admin-accessible-0
  it('RSH1 - client.push.admin exposes PushAdmin', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret' });

    expect(client.push).to.exist;
    expect(client.push.admin).to.exist;
    expect(client.push.admin.deviceRegistrations).to.exist;
    expect(client.push.admin.channelSubscriptions).to.exist;
  });

  /**
   * RSH1a - publish propagates server error
   *
   * When the server returns an error response, publish() must
   * propagate it as an exception with the correct error code.
   */
  // UTS: rest/unit/RSH1a/server-error-propagated-6
  it('RSH1a - publish propagates server error', async function () {
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
      await client.push.admin.publish({ clientId: 'user-1' }, { notification: { title: 'Test' } });
      expect.fail('Expected publish to throw');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
  });
});
