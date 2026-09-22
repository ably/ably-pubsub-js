/**
 * UTS Integration: Presence Sync Tests
 *
 * Spec points: RTP2, RTP11a
 * Source: uts/realtime/integration/presence/presence_sync_test.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  trackClient,
  connectAndWait,
  closeAndWait,
  uniqueChannelName,
} from '../sandbox';

describe('uts/realtime/integration/presence/presence_sync', function () {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTP2, RTP11a - Presence SYNC delivers existing members
   */
  // UTS: realtime/integration/RTP2/sync-delivers-members-0
  it('RTP2/RTP11a - presence SYNC delivers existing member', async function () {
    const channelName = uniqueChannelName('presence-sync');

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      clientId: 'sync-member-a',
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(clientB);

    await connectAndWait(clientA);

    const channelA = clientA.channels.get(channelName);
    await channelA.attach();
    await channelA.presence.enter('sync-data');

    await connectAndWait(clientB);

    const channelB = clientB.channels.get(channelName);
    await channelB.attach();

    const members = await channelB.presence.get();

    expect(members).to.have.length(1);
    expect(members[0].clientId).to.equal('sync-member-a');
    expect(members[0].data).to.equal('sync-data');
    expect(members[0].action).to.equal('present');

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTP2 - Presence SYNC with multiple members
   */
  // UTS: realtime/integration/RTP2/sync-multiple-members-1
  it('RTP2 - presence SYNC delivers multiple members', async function () {
    const channelName = uniqueChannelName('presence-sync-multi');
    const memberCount = 10;

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(clientB);

    await connectAndWait(clientA);

    const channelA = clientA.channels.get(channelName);
    await channelA.attach();

    for (let i = 0; i < memberCount; i++) {
      await channelA.presence.enterClient(`sync-user-${i}`, `data-${i}`);
    }

    await connectAndWait(clientB);

    const channelB = clientB.channels.get(channelName);
    await channelB.attach();

    const members = await channelB.presence.get();

    expect(members).to.have.length(memberCount);

    for (let i = 0; i < memberCount; i++) {
      const member = members.find((m: any) => m.clientId === `sync-user-${i}`);
      expect(member, `sync-user-${i} should be present`).to.not.be.undefined;
      expect(member!.data).to.equal(`data-${i}`);
    }

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });
});
