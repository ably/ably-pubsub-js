/**
 * UTS: RealtimePresence History Tests
 *
 * Spec points: RTP12, RTP12a, RTP12c, RTP12d
 * Source: specification/uts/realtime/unit/presence/realtime_presence_history.md
 *
 * Tests the RealtimePresence#history function which delegates to
 * RestPresence#history. It supports the same parameters as RestPresence#history
 * and returns a PaginatedResult.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockWebSocket, installMockHttp, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/presence/realtime_presence_history', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTP12a - history supports same params as RestPresence#history
   *
   * Supports all the same params: start, end, direction, limit.
   * Verifies the correct REST endpoint is called with the right params.
   */
  // UTS: realtime/unit/RTP12a/history-supports-rest-params-0
  it('RTP12a - history supports same params as RestPresence#history', async function () {
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

    const channel = client.channels.get('test-RTP12a');
    await channel.attach();

    await channel.presence.history({
      start: 1000,
      end: 2000,
      direction: 'backwards',
      limit: 50,
    });

    // Find the history request
    const historyReq = httpMock.captured_requests.find((r: any) => r.path.includes('/presence/history'));
    expect(historyReq).to.not.be.undefined;

    // Verify path
    expect(historyReq!.path).to.equal('/channels/test-RTP12a/presence/history');

    // Verify params
    const params = historyReq!.url.searchParams;
    expect(params.get('start')).to.equal('1000');
    expect(params.get('end')).to.equal('2000');
    expect(params.get('direction')).to.equal('backwards');
    expect(params.get('limit')).to.equal('50');
  });

  /**
   * RTP12c - history returns PaginatedResult
   *
   * Returns a PaginatedResult page containing the first page of messages
   * in the PaginatedResult#items attribute.
   */
  // UTS: realtime/unit/RTP12c/history-returns-paginated-result-0
  it('RTP12c - history returns PaginatedResult with presence messages', async function () {
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
        req.respond_with(
          200,
          [
            { action: 2, clientId: 'alice', timestamp: 1000 }, // enter
            { action: 4, clientId: 'alice', timestamp: 2000 }, // update
            { action: 3, clientId: 'alice', timestamp: 3000 }, // leave
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

    const channel = client.channels.get('test-RTP12c');
    await channel.attach();

    const result = await channel.presence.history({});

    // Result is a PaginatedResult
    expect(result).to.have.property('items');
    expect(result).to.have.property('hasNext');
    expect(result).to.have.property('isLast');

    expect(result.items.length).to.equal(3);
    expect(result.items[0].clientId).to.equal('alice');
    expect(result.items[0].action).to.equal('enter');
    expect(result.items[2].action).to.equal('leave');
  });
});
