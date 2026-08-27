/**
 * UTS: Channel getMessage Tests
 *
 * Spec points: RTL28
 * Source: uts/test/realtime/unit/channels/channel_get_message_test.md
 *
 * Tests that RealtimeChannel.getMessage() delegates to the REST endpoint.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockWebSocket, installMockHttp, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_get_message', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL28 - getMessage delegates to REST endpoint
   */
  // UTS: realtime/unit/RTL28/identical-to-rest-0
  it('RTL28 - getMessage calls REST /messages/{serial}', async function () {
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg) => {
        if (msg.action === 10) {
          mock.active_connection!.send_to_client({
            action: 11,
            channel: msg.channel,
            flags: 0,
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
          {
            name: 'test-msg',
            data: 'hello',
            serial: 'msg-serial-123',
          },
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

    const channel = client.channels.get('test-RTL28');

    const result = await channel.getMessage('msg-serial-123');

    client.close();
    // Verify REST endpoint was called with the serial
    const req = httpMock.captured_requests.find((r: any) => r.path.includes('msg-serial-123'));
    expect(req).to.not.be.undefined;
    expect(req!.method.toUpperCase()).to.equal('GET');
    expect(result.name).to.equal('test-msg');
  });
});
