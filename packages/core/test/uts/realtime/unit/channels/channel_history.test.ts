/**
 * UTS: Channel History Tests
 *
 * Spec points: RTL10a, RTL10b, RTL10c
 * Source: uts/test/realtime/unit/channels/channel_history_test.md
 *
 * Tests RealtimeChannel.history() — delegates to REST, with untilAttach support.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockWebSocket, installMockHttp, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_history', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL10a, RTL10c - RealtimeChannel#history supports all RestChannel#history params
   *
   * RealtimeChannel#history uses the same underlying REST endpoint as
   * RestChannel#history. It supports start, end, direction, limit params
   * and returns a PaginatedResult containing Message objects.
   */
  // UTS: realtime/unit/RTL10a/supports-rest-params-0
  it('RTL10a - history supports REST params and returns PaginatedResult', async function () {
    const captured: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(
          200,
          [
            { id: '1', name: 'event1', data: 'hello' },
            { id: '2', name: 'event2', data: 'world' },
          ],
          { 'content-type': 'application/json' },
        );
      },
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL10a');
    await channel.attach();

    const result = await channel.history({ start: 1000, end: 2000, direction: 'backwards', limit: 50 });

    // RTL10c: returns PaginatedResult with Message objects
    expect(result.items).to.have.length(2);
    expect(result.items[0].name).to.equal('event1');
    expect(result.items[0].data).to.equal('hello');
    expect(result.items[1].name).to.equal('event2');
    expect(result.items[1].data).to.equal('world');

    // RTL10a: REST params are passed through to the HTTP request
    expect(captured.length).to.be.greaterThan(0);
    const historyReq = captured.find((r: any) => r.path.includes('/history') || r.path.includes('test-RTL10a'));
    expect(historyReq).to.not.be.undefined;
    const params = historyReq!.url.searchParams;
    expect(params.get('start')).to.equal('1000');
    expect(params.get('end')).to.equal('2000');
    expect(params.get('direction')).to.equal('backwards');
    expect(params.get('limit')).to.equal('50');

    client.close();
  });

  /**
   * RTL10b - untilAttach adds fromSerial query parameter
   */
  // UTS: realtime/unit/RTL10b/adds-from-serial-0
  it('RTL10b - untilAttach adds from_serial param', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          // ATTACH
          mock.active_connection!.send_to_client({
            action: 11, // ATTACHED
            channel: msg.channel,
            channelSerial: 'attach-serial-abc',
            flags: 0,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        // Return empty paginated result
        req.respond_with(200, [], { 'content-type': 'application/json' });
      },
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL10b');
    await channel.attach();
    expect(channel.properties.attachSerial).to.equal('attach-serial-abc');

    await channel.history({ untilAttach: true });

    client.close();
    // Check that the HTTP request included from_serial
    const historyReq = httpMock.captured_requests.find(
      (r: any) => r.path.includes('/history') || r.path.includes('test-RTL10b'),
    );
    expect(historyReq).to.not.be.undefined;
    // from_serial should be in query params
    const urlParams = historyReq!.url.searchParams;
    expect(urlParams.get('fromSerial') || urlParams.get('from_serial')).to.equal('attach-serial-abc');
  });

  /**
   * RTL10b - untilAttach errors when not attached
   */
  // UTS: realtime/unit/RTL10b/errors-when-not-attached-1
  it('RTL10b - untilAttach throws when not attached', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-RTL10b-error');
    expect(channel.state).to.equal('initialized');

    try {
      await channel.history({ untilAttach: true });
      expect.fail('Should have thrown');
    } catch (err: any) {
      expect(err).to.exist;
      expect(err.code).to.be.a('number');
    }
    client.close();
  });
});
