/**
 * UTS Integration: Presence Lifecycle Tests
 *
 * Spec points: RTP4, RTP6, RTP8, RTP9, RTP10, RTP11a
 * Source: uts/realtime/integration/presence_lifecycle_test.md
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
  pollUntil,
} from '../sandbox';
import { describeEachProtocol } from '../../../helpers/protocol_variants';

describeEachProtocol('uts/realtime/integration/presence/presence_lifecycle', function (protocol) {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTP4, RTP6, RTP11a - Bulk enterClient observed on different connection
   */
  // UTS: realtime/integration/RTP4/bulk-enter-observed-0
  it('RTP4/RTP6/RTP11a - bulk enterClient observed via subscribe and get', async function () {
    const channelName = uniqueChannelName('presence-bulk');
    const memberCount = 20;

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(clientB);

    await connectAndWait(clientA);
    await connectAndWait(clientB);

    const channelA = clientA.channels.get(channelName);
    const channelB = clientB.channels.get(channelName);

    // Attach B and subscribe before A enters any members. Members are counted by
    // clientId from both 'enter' and 'present' events: if B's connection blips
    // mid-test, members it missed arrive via the presence re-sync as 'present'
    // events rather than 'enter', and an enter-only count would undercount forever.
    const enteredClientIds = new Set<string>();
    await channelB.presence.subscribe(['enter', 'present'], (msg: any) => {
      enteredClientIds.add(msg.clientId);
    });

    await channelA.attach();

    // Enter members sequentially to avoid server rate limits
    for (let i = 0; i < memberCount; i++) {
      await channelA.presence.enterClient(`user-${i}`, `data-${i}`);
    }

    await pollUntil(() => (enteredClientIds.size >= memberCount ? true : null), {
      interval: 200,
      timeout: 30000,
    });

    expect(enteredClientIds.size).to.equal(memberCount);

    const members = await channelB.presence.get();
    expect(members).to.have.length(memberCount);

    for (let i = 0; i < memberCount; i++) {
      const member = members.find((m: any) => m.clientId === `user-${i}`);
      expect(member, `user-${i} should be present`).to.not.be.undefined;
      expect(member.data).to.equal(`data-${i}`);
    }

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTP8, RTP9, RTP10 - Enter, update, leave lifecycle
   */
  // UTS: realtime/integration/RTP8/enter-update-leave-lifecycle-0
  it('RTP8/RTP9/RTP10 - enter, update, leave lifecycle observed on second connection', async function () {
    const channelName = uniqueChannelName('presence-lifecycle');

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      clientId: 'lifecycle-client',
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(clientB);

    await connectAndWait(clientA);
    await connectAndWait(clientB);

    const channelA = clientA.channels.get(channelName);
    const channelB = clientB.channels.get(channelName);

    // Attach B and subscribe for all presence events before A enters
    const allEvents: any[] = [];
    await channelB.presence.subscribe((msg: any) => {
      allEvents.push(msg);
    });

    // Now attach A and enter
    await channelA.attach();

    // Phase 1: Enter
    await channelA.presence.enter('hello');

    await pollUntil(() => (allEvents.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const membersAfterEnter = await channelB.presence.get();
    expect(membersAfterEnter).to.have.length(1);
    expect(membersAfterEnter[0].clientId).to.equal('lifecycle-client');
    expect(membersAfterEnter[0].data).to.equal('hello');

    // Phase 2: Update
    await channelA.presence.update('world');

    await pollUntil(() => (allEvents.length >= 2 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const membersAfterUpdate = await channelB.presence.get();
    expect(membersAfterUpdate).to.have.length(1);
    expect(membersAfterUpdate[0].data).to.equal('world');

    // Phase 3: Leave
    await channelA.presence.leave('goodbye');

    await pollUntil(() => (allEvents.length >= 3 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const membersAfterLeave = await channelB.presence.get();
    expect(membersAfterLeave).to.have.length(0);

    // Verify event sequence
    expect(allEvents).to.have.length.at.least(3);

    // First event should be 'enter' (not 'present' from SYNC, because
    // B was subscribed and attached before A entered)
    expect(allEvents[0].action).to.equal('enter');
    expect(allEvents[0].clientId).to.equal('lifecycle-client');
    expect(allEvents[0].data).to.equal('hello');

    expect(allEvents[1].action).to.equal('update');
    expect(allEvents[1].clientId).to.equal('lifecycle-client');
    expect(allEvents[1].data).to.equal('world');

    expect(allEvents[2].action).to.equal('leave');
    expect(allEvents[2].clientId).to.equal('lifecycle-client');
    expect(allEvents[2].data).to.equal('goodbye');

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });
});
