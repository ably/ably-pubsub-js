/**
 * UTS: RealtimeClient Time Tests
 *
 * Spec points: RTC6, RTC6a
 * Source: uts/test/realtime/unit/client/realtime_time.md
 *
 * RTC6a: RealtimeClient#time proxies to RestClient#time.
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll, trackClient } from '../../../helpers';

describe('uts/realtime/unit/client/realtime_time', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTC6a - RealtimeClient#time proxies to RestClient#time
   *
   * time() makes a GET request to /time and returns the server timestamp.
   */
  // UTS: rest/unit/RSC16/returns-server-time-0.1
  it('RTC6a - time() returns server time', async function () {
    const serverTime = 1625000000000;

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        if (req.path.includes('/time')) {
          req.respond_with(200, [serverTime]);
        } else {
          req.respond_with(404, { error: 'Not found' });
        }
      },
    });
    installMockHttp(httpMock);

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    const time = await client.time();
    expect(time).to.equal(serverTime);
    client.close();
  });
});
