/**
 * UTS: Push Device Registrations Tests
 *
 * Spec points: RSH1b, RSH1b1 (get), RSH1b2 (list), RSH1b3 (save), RSH1b4 (remove), RSH1b5 (removeWhere)
 * Source: uts/test/rest/unit/push/push_device_registrations.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/push/push_device_registrations', function () {
  afterEach(restoreAll);

  /**
   * RSH1b3 - save sends PUT to /push/deviceRegistrations/{id}
   *
   * save() issues a PUT request to the device-specific endpoint
   * with the device details in the body.
   */
  // UTS: rest/unit/RSH1b3/save-put-device-details-0
  it('RSH1b3 - save sends PUT to /push/deviceRegistrations/{id}', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          id: 'device-001',
          clientId: 'client-abc',
          platform: 'ios',
          formFactor: 'phone',
          metadata: {},
          push: {
            recipient: { transportType: 'apns', deviceToken: 'token-123' },
            state: 'Active',
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.deviceRegistrations.save({
      id: 'device-001',
      clientId: 'client-abc',
      platform: 'ios',
      formFactor: 'phone',
      push: {
        recipient: { transportType: 'apns', deviceToken: 'token-123' },
      },
    });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('put');
    expect(captured[0].path).to.equal('/push/deviceRegistrations/' + encodeURIComponent('device-001'));
  });

  /**
   * RSH1b3 - save body contains device details
   *
   * The PUT body must contain the device's id, clientId, platform,
   * formFactor, and push recipient fields.
   */
  // UTS: rest/unit/RSH1b3/save-updates-existing-1
  it('RSH1b3 - save body contains device details', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          id: 'device-001',
          clientId: 'client-abc',
          platform: 'ios',
          formFactor: 'phone',
          push: {
            recipient: { transportType: 'apns', deviceToken: 'token-123' },
            state: 'Active',
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.push.admin.deviceRegistrations.save({
      id: 'device-001',
      clientId: 'client-abc',
      platform: 'ios',
      formFactor: 'phone',
      push: {
        recipient: { transportType: 'apns', deviceToken: 'token-123' },
      },
    });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body.id).to.equal('device-001');
    expect(body.clientId).to.equal('client-abc');
    expect(body.platform).to.equal('ios');
    expect(body.formFactor).to.equal('phone');
    expect(body.push.recipient.transportType).to.equal('apns');

    // Response is parsed as DeviceDetails
    expect(result.id).to.equal('device-001');
    expect(result.push!.state).to.equal('Active');
  });

  /**
   * RSH1b1 - get sends GET to /push/deviceRegistrations/{id}
   *
   * get() issues a GET request to the device-specific endpoint.
   */
  // UTS: rest/unit/RSH1b1/get-device-details-0.1
  it('RSH1b1 - get sends GET to /push/deviceRegistrations/{id}', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          id: 'device-001',
          clientId: 'client-abc',
          formFactor: 'phone',
          platform: 'ios',
          metadata: { model: 'iPhone 14' },
          push: {
            recipient: { transportType: 'apns', deviceToken: 'token-123' },
            state: 'Active',
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.deviceRegistrations.get('device-001');

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/push/deviceRegistrations/' + encodeURIComponent('device-001'));
  });

  /**
   * RSH1b1 - get returns device object
   *
   * get() returns a DeviceDetails object with all the fields
   * from the server response.
   */
  // UTS: rest/unit/RSH1b1/get-device-details-0
  it('RSH1b1 - get returns device object', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, {
          id: 'device-001',
          clientId: 'client-abc',
          formFactor: 'phone',
          platform: 'ios',
          metadata: { model: 'iPhone 14' },
          push: {
            recipient: { transportType: 'apns', deviceToken: 'token-123' },
            state: 'Active',
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const device = await client.push.admin.deviceRegistrations.get('device-001');

    expect(device.id).to.equal('device-001');
    expect(device.clientId).to.equal('client-abc');
    expect(device.formFactor).to.equal('phone');
    expect(device.platform).to.equal('ios');
    expect(device.push!.recipient!.transportType).to.equal('apns');
    expect(device.push!.state).to.equal('Active');
  });

  /**
   * RSH1b2 - list sends GET to /push/deviceRegistrations
   *
   * list() issues a GET request to the deviceRegistrations collection endpoint.
   */
  // UTS: rest/unit/RSH1b2/list-filtered-by-deviceid-0.1
  it('RSH1b2 - list sends GET to /push/deviceRegistrations', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          {
            id: 'device-001',
            clientId: 'client-abc',
            platform: 'ios',
            formFactor: 'phone',
            push: { recipient: {}, state: 'Active' },
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.deviceRegistrations.list({});

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/push/deviceRegistrations');
  });

  /**
   * RSH1b2 - list with params (deviceId filter)
   *
   * list() forwards the deviceId parameter as a query parameter and
   * returns only matching results.
   */
  // UTS: rest/unit/RSH1b2/list-filtered-by-deviceid-0
  it('RSH1b2 - list with params (deviceId filter)', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          {
            id: 'device-001',
            clientId: 'client-abc',
            platform: 'ios',
            formFactor: 'phone',
            push: { recipient: {}, state: 'Active' },
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.deviceRegistrations.list({ deviceId: 'device-001' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('deviceId')).to.equal('device-001');
  });

  /**
   * RSH1b2 - list returns PaginatedResult
   *
   * list() returns a PaginatedResult containing DeviceDetails objects.
   */
  // UTS: rest/unit/RSH1b2/list-filtered-by-deviceid-0.2
  it('RSH1b2 - list returns PaginatedResult', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            id: 'device-001',
            clientId: 'client-abc',
            platform: 'ios',
            formFactor: 'phone',
            push: { recipient: {}, state: 'Active' },
          },
          {
            id: 'device-002',
            clientId: 'client-abc',
            platform: 'android',
            formFactor: 'tablet',
            push: { recipient: {}, state: 'Active' },
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.push.admin.deviceRegistrations.list({ clientId: 'client-abc' });

    expect(result.items).to.have.length(2);
    expect((result.items[0] as any).id).to.equal('device-001');
    expect((result.items[1] as any).id).to.equal('device-002');
  });

  /**
   * RSH1b4 - remove sends DELETE to /push/deviceRegistrations/{id}
   *
   * remove() issues a DELETE request to the device-specific endpoint.
   */
  // UTS: rest/unit/RSH1b4/remove-delete-device-0
  it('RSH1b4 - remove sends DELETE to /push/deviceRegistrations/{id}', async function () {
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
    await client.push.admin.deviceRegistrations.remove('device-001');

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].path).to.equal('/push/deviceRegistrations/' + encodeURIComponent('device-001'));
  });

  /**
   * RSH1b4 - remove accepts string deviceId
   *
   * remove() accepts a plain string deviceId (not just a DeviceDetails object).
   */
  // UTS: rest/unit/RSH1b5/remove-where-no-match-succeeds-2
  it('RSH1b4 - remove accepts string deviceId', async function () {
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
    // Pass a plain string, not a DeviceDetails object
    await client.push.admin.deviceRegistrations.remove('my-device-id');

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].path).to.equal('/push/deviceRegistrations/' + encodeURIComponent('my-device-id'));
  });

  /**
   * RSH1b5 - removeWhere sends DELETE to /push/deviceRegistrations with params
   *
   * removeWhere() issues a DELETE request to the collection endpoint
   * with filter parameters as query params.
   */
  // UTS: rest/unit/RSH1b5/remove-where-clientid-0
  it('RSH1b5 - removeWhere sends DELETE to /push/deviceRegistrations with params', async function () {
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
    await client.push.admin.deviceRegistrations.removeWhere({ clientId: 'client-abc' });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].path).to.equal('/push/deviceRegistrations');
    expect(captured[0].url.searchParams.get('clientId')).to.equal('client-abc');
  });

  /**
   * RSH1b1 - get returns 404 for unknown device
   *
   * When the server returns a 404 for an unknown deviceId, get()
   * must propagate it as an exception with error code 40400.
   */
  // UTS: rest/unit/RSH1b1/get-unknown-device-error-1
  it('RSH1b1 - get returns 404 for unknown device', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(404, {
          error: { code: 40400, statusCode: 404, message: 'Not found' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });

    try {
      await client.push.admin.deviceRegistrations.get('unknown-device');
      expect.fail('Expected get to throw');
    } catch (err: any) {
      expect(err.code).to.equal(40400);
    }
  });

  /**
   * RSH1b1 - get URL-encodes deviceId
   *
   * get() must URL-encode the deviceId in the request path so that
   * special characters are handled correctly.
   */
  // UTS: rest/unit/RSH1b1/get-url-encodes-deviceid-2
  it('RSH1b1 - get URL-encodes deviceId', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          id: 'device/special:id',
          platform: 'ios',
          formFactor: 'phone',
          push: { recipient: {}, state: 'Active' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.deviceRegistrations.get('device/special:id');

    expect(captured).to.have.length(1);
    expect(captured[0].path).to.equal('/push/deviceRegistrations/' + encodeURIComponent('device/special:id'));
  });

  /**
   * RSH1b2 - list with clientId filter
   *
   * list() forwards the clientId parameter as a query parameter.
   */
  // UTS: rest/unit/RSH1b2/list-filtered-by-clientid-1
  it('RSH1b2 - list with clientId filter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          {
            id: 'device-001',
            clientId: 'client-abc',
            platform: 'ios',
            formFactor: 'phone',
            push: { recipient: {}, state: 'Active' },
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.deviceRegistrations.list({ clientId: 'client-abc' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('clientId')).to.equal('client-abc');
  });

  /**
   * RSH1b2 - list supports limit
   *
   * list() forwards the limit parameter as a query parameter.
   */
  // UTS: rest/unit/RSH1b2/list-with-limit-param-2
  it('RSH1b2 - list supports limit', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          {
            id: 'device-001',
            platform: 'ios',
            formFactor: 'phone',
            push: { recipient: {}, state: 'Active' },
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.push.admin.deviceRegistrations.list({ limit: '2' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('2');
  });

  /**
   * RSH1b3 - save propagates server error
   *
   * When the server returns an error response, save() must
   * propagate it as an exception with the correct error code.
   */
  // UTS: rest/unit/RSH1b3/save-error-propagated-2
  it('RSH1b3 - save propagates server error', async function () {
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
      await client.push.admin.deviceRegistrations.save({
        id: 'device-001',
        platform: 'ios',
        formFactor: 'phone',
        push: {
          recipient: { transportType: 'apns', deviceToken: 'token-123' },
        },
      });
      expect.fail('Expected save to throw');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
  });

  /**
   * RSH1b4 - remove nonexistent succeeds
   *
   * remove() for a nonexistent device should not throw when the
   * server returns a successful response.
   */
  // UTS: rest/unit/RSH1b4/remove-nonexistent-succeeds-1
  it('RSH1b4 - remove nonexistent succeeds', async function () {
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
    await client.push.admin.deviceRegistrations.remove('nonexistent');

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].path).to.equal('/push/deviceRegistrations/' + encodeURIComponent('nonexistent'));
  });

  /**
   * RSH1b5 - removeWhere with deviceId
   *
   * removeWhere() forwards the deviceId parameter as a query
   * parameter in the DELETE request.
   */
  // UTS: rest/unit/RSH1b5/remove-where-deviceid-1
  it('RSH1b5 - removeWhere with deviceId', async function () {
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
    await client.push.admin.deviceRegistrations.removeWhere({ deviceId: 'device-001' });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('delete');
    expect(captured[0].path).to.equal('/push/deviceRegistrations');
    expect(captured[0].url.searchParams.get('deviceId')).to.equal('device-001');
  });
});
