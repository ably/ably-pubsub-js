/**
 * UTS: Realtime Client Request Tests
 *
 * Spec points: RTC9
 * Source: uts/test/realtime/unit/client/realtime_request.md
 *
 * RTC9: RealtimeClient#request proxies to RestClient#request.
 * These are representative tests from the REST request suite using a Realtime client.
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, trackClient, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/realtime/unit/client/realtime_request', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTC9 / RSC19 - GET request
   */
  // UTS: realtime/unit/RTC9/request-proxies-rest-0
  it('RTC9 - request() sends GET', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({ key: 'appId.keyId:keySecret', autoConnect: false, useBinaryProtocol: false });
    trackClient(client);
    const result = await client.request('get', '/test', 2, null as any, null as any, null as any);

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/test');
    expect(result.statusCode).to.equal(200);
    expect(result.success).to.be.true;
    client.close();
  });

  /**
   * RTC9 / RSC19 - POST request with body
   */
  // UTS: realtime/unit/RTC9/request-proxies-rest-0.1
  it('RTC9 - request() sends POST with body', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { id: 'created' });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);
    const result = await client.request('post', '/items', 2, null as any, { name: 'test' }, null as any);

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(result.statusCode).to.equal(201);
    client.close();
  });

  /**
   * RTC9 / RSC19 - request() with query params
   */
  // UTS: rest/unit/RSC19f1/version-param-sets-header-0
  it('RTC9 - request() passes query params', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({ key: 'appId.keyId:keySecret', autoConnect: false, useBinaryProtocol: false });
    trackClient(client);
    const result = await client.request(
      'get',
      '/test',
      2,
      { limit: '5', direction: 'forwards' },
      null as any,
      null as any,
    );

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('5');
    expect(captured[0].url.searchParams.get('direction')).to.equal('forwards');
    client.close();
  });

  /**
   * RTC9 / RSC19 - HttpPaginatedResponse structure
   */
  // UTS: realtime/unit/RTC9/request-proxies-rest-0.2
  it('RTC9 - returns HttpPaginatedResponse', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [{ id: 'item1' }, { id: 'item2' }]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({ key: 'appId.keyId:keySecret', autoConnect: false, useBinaryProtocol: false });
    trackClient(client);
    const result = await client.request('get', '/items', 2, null as any, null as any, null as any);

    expect(result.statusCode).to.equal(200);
    expect(result.success).to.be.true;
    expect(result.items).to.be.an('array');
    expect(result.items).to.have.length(2);
    client.close();
  });

  /**
   * RTC9 / RSC19 - Error response
   */
  // UTS: rest/unit/RSC19d/empty-response-handling-8
  it('RTC9 - error response has correct fields', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(404, { error: { message: 'Not found', code: 40400, statusCode: 404 } });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({ key: 'appId.keyId:keySecret', autoConnect: false, useBinaryProtocol: false });
    trackClient(client);
    const result = await client.request('get', '/missing', 2, null as any, null as any, null as any);

    expect(result.statusCode).to.equal(404);
    expect(result.success).to.be.false;
    expect(result.errorCode).to.equal(40400);
    client.close();
  });
});
