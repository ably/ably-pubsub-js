/**
 * UTS: Realtime Time API Tests
 *
 * Spec points: RTC6, RTC6a
 * Source: specification/uts/realtime/unit/client/realtime_time.md
 *
 * RTC6a: RealtimeClient#time proxies to RestClient#time.
 * These are the same tests as uts/rest/time but using a Realtime client
 * with autoConnect: false to avoid WebSocket connection.
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, trackClient, installMockHttp, restoreAll } from '../../helpers';

describe('uts/realtime/unit/time', function () {
  let mock;

  afterEach(function () {
    restoreAll();
  });

  /**
   * RTC6a - time() returns server time (proxied from REST)
   */
  // UTS: realtime/unit/RTC6/time-proxies-rest-0
  it('RTC6a - time() returns server time', async function () {
    const captured: any[] = [];
    const serverTimeMs = 1704067200000;

    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [serverTimeMs]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({ key: 'app.key:secret', autoConnect: false });
    trackClient(client);
    const result = await client.time();

    expect(result).to.be.a('number');
    expect(result).to.equal(serverTimeMs);

    expect(captured).to.have.length(1);
    expect(captured[0].method.toUpperCase()).to.equal('GET');
    expect(captured[0].path).to.equal('/time');
    client.close();
  });

  /**
   * RTC6a - time() request format (proxied from REST)
   */
  // UTS: rest/unit/RSC16/request-format-get-time-1.1
  it('RTC6a - time() request format', async function () {
    const captured: any[] = [];

    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1704067200000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({ key: 'app.key:secret', autoConnect: false });
    trackClient(client);
    await client.time();

    expect(captured).to.have.length(1);
    const request = captured[0];

    expect(request.method.toUpperCase()).to.equal('GET');
    expect(request.path).to.equal('/time');
    expect(request.headers).to.have.property('X-Ably-Version');
    expect(request.headers).to.have.property('Ably-Agent');
    expect(request.headers['X-Ably-Version']).to.match(/[0-9.]+/);
    expect(request.headers['Ably-Agent']).to.match(/ably-js\/[0-9]+\.[0-9]+\.[0-9]+/);
    client.close();
  });

  /**
   * RTC6a - time() does not require authentication (proxied from REST)
   */
  // UTS: rest/unit/RSC16/no-auth-required-2.1
  it('RTC6a - time() does not require authentication', async function () {
    const captured: any[] = [];

    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1704067200000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({ key: 'app.key:secret', autoConnect: false });
    trackClient(client);
    const result = await client.time();

    expect(result).to.be.a('number');
    expect(captured).to.have.length(1);
    expect(captured[0].headers).to.not.have.property('Authorization');
    expect(captured[0].headers).to.not.have.property('authorization');
    client.close();
  });

  /**
   * RTC6a - time() works without TLS (proxied from REST)
   */
  // UTS: rest/unit/RSC16/works-without-tls-3.1
  it('RTC6a - time() works without TLS', async function () {
    const captured: any[] = [];

    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1704067200000]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({
      key: 'app.key:secret',
      tls: false,
      useTokenAuth: true,
      autoConnect: false,
    });
    trackClient(client);
    const result = await client.time();

    expect(result).to.be.a('number');
    expect(captured).to.have.length(1);
    expect(captured[0].url.protocol).to.equal('http:');
    expect(captured[0].headers).to.not.have.property('Authorization');
    expect(captured[0].headers).to.not.have.property('authorization');
    client.close();
  });

  /**
   * RTC6a - time() error handling (proxied from REST)
   */
  // UTS: realtime/unit/RTC6/time-proxies-rest-0.1
  it('RTC6a - time() error handling', async function () {
    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(500, {
          error: {
            message: 'Internal server error',
            code: 50000,
            statusCode: 500,
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Realtime({ key: 'app.key:secret', autoConnect: false });
    trackClient(client);

    try {
      await client.time();
      expect.fail('Expected time() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(500);
      expect(error.code).to.equal(50000);
    }
    client.close();
  });
});
