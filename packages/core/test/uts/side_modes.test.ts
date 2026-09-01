/**
 * Harness self-test for the UTS_SIDE modes — not a UTS spec translation.
 *
 * The suite can construct its clients through the core constructors or through the per-side
 * package factories (see the UTS_SIDE handling in helpers.ts). The factories' one observable
 * behavior is the side-declaring Ably-Agent entry they stamp, so this file asserts that the
 * stamp matches the selected mode. It exists to fail loudly if the seam silently degrades —
 * for example if the tsconfig paths mapping breaks and a "device" or "server" run quietly
 * constructs plain core clients, turning the per-side CI legs into duplicates of the core leg.
 */

import { expect } from 'chai';
import { MockHttpClient } from './mock_http';
import { Ably, trackClient, installMockHttp, restoreAll } from './helpers';

const side = process.env.UTS_SIDE || 'core';

// What each mode must stamp, per client kind. Device REST is deliberately unstamped: the device
// package ships no HTTP factory, only the core `Rest` re-export.
const expectedStamp: Record<string, { rest: string | null; realtime: string | null }> = {
  core: { rest: null, realtime: null },
  device: { rest: null, realtime: 'ably-pubsub-device/' },
  server: { rest: 'ably-pubsub-server/', realtime: 'ably-pubsub-server/' },
};

describe(`uts harness: side mode '${side}'`, function () {
  afterEach(function () {
    restoreAll();
  });

  async function agentHeaderFrom(makeClient: () => any): Promise<string> {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [1704067200000]);
      },
    });
    installMockHttp(mock);

    const client = makeClient();
    trackClient(client);
    await client.time();

    expect(captured).to.have.length(1);
    const agent = captured[0].headers['Ably-Agent'];
    expect(agent, 'expected an Ably-Agent header').to.be.a('string');
    return agent;
  }

  function assertStamp(agent: string, stamp: string | null) {
    if (stamp === null) {
      expect(agent).to.not.include('ably-pubsub-');
    } else {
      expect(agent).to.include(stamp);
    }
  }

  it('REST clients carry the agent stamp of the selected entry point', async function () {
    const agent = await agentHeaderFrom(() => new Ably.Rest({ key: 'app.key:secret' }));
    assertStamp(agent, expectedStamp[side].rest);
  });

  it('realtime clients carry the agent stamp of the selected entry point', async function () {
    const agent = await agentHeaderFrom(() => new Ably.Realtime({ key: 'app.key:secret', autoConnect: false }));
    assertStamp(agent, expectedStamp[side].realtime);
  });
});
