/**
 * UTS: Channel getMessageVersions Tests
 *
 * Spec points: RTL31
 * Source: uts/test/realtime/unit/channels/channel_message_versions_test.md
 *
 * Tests that RealtimeChannel.getMessageVersions() delegates to the REST endpoint.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockWebSocket, installMockHttp, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/channels/channel_message_versions', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTL31 - getMessageVersions delegates to REST endpoint
   */
  // UTS: realtime/unit/RTL31/identical-to-rest-0
  it('RTL31 - getMessageVersions calls REST /messages/{serial}/versions', async function () {
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
          [
            { name: 'msg', data: 'v1', serial: 'msg-serial-abc' },
            { name: 'msg', data: 'v2', serial: 'msg-serial-abc' },
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

    const channel = client.channels.get('test-RTL31');

    const result = await channel.getMessageVersions('msg-serial-abc');

    client.close();
    // Verify REST endpoint was called with serial/versions path
    const req = httpMock.captured_requests.find(
      (r: any) => r.path.includes('msg-serial-abc') && r.path.includes('versions'),
    );
    expect(req).to.not.be.undefined;
    expect(req!.method.toUpperCase()).to.equal('GET');
  });
});
