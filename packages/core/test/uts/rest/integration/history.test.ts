/**
 * UTS Integration: REST Channel History Tests
 *
 * Spec points: RSL2a, RSL2b1, RSL2b2, RSL2b3
 * Source: specification/uts/rest/integration/history.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  uniqueChannelName,
  pollUntil,
} from './sandbox';
import { describeEachProtocol } from '../../helpers/protocol_variants';

describeEachProtocol('uts/rest/integration/history', function (protocol) {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSL2a - History returns published messages in backwards order (newest first)
   */
  // UTS: rest/integration/RSL2a/history-returns-messages-0
  it('RSL2a - history returns published messages', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('history-test-RSL2a');
    const channel = client.channels.get(channelName);

    // Publish some messages
    await channel.publish('event1', 'data1');
    await channel.publish('event2', 'data2');
    await channel.publish('event3', { key: 'value' });

    // Poll until messages appear in history
    const history = await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === 3 ? result : null;
      },
      { interval: 500, timeout: 10000 },
    );

    expect(history.items).to.have.length(3);

    // Default order is backwards (newest first)
    expect(history.items[0].name).to.equal('event3');
    expect(history.items[0].data).to.deep.equal({ key: 'value' });

    expect(history.items[1].name).to.equal('event2');
    expect(history.items[1].data).to.equal('data2');

    expect(history.items[2].name).to.equal('event1');
    expect(history.items[2].data).to.equal('data1');

    // All messages should have timestamps
    for (const msg of history.items) {
      expect(msg.timestamp).to.not.be.null;
      expect(msg.timestamp).to.not.be.undefined;
    }
  });

  /**
   * RSL2b1 - History direction forwards returns messages oldest first
   */
  // UTS: rest/integration/RSL2b1/history-direction-forwards-0
  it('RSL2b1 - history direction forwards', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('history-direction');
    const channel = client.channels.get(channelName);

    // Publish messages - ordering is determined by server timestamp
    await channel.publish('first', '1');
    await channel.publish('second', '2');
    await channel.publish('third', '3');

    // Poll until all messages appear
    await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === 3 ? result : null;
      },
      { interval: 500, timeout: 10000 },
    );

    const history = await channel.history({ direction: 'forwards' });

    expect(history.items).to.have.length(3);
    expect(history.items[0].name).to.equal('first');
    expect(history.items[1].name).to.equal('second');
    expect(history.items[2].name).to.equal('third');
  });

  /**
   * RSL2b2 - History limit parameter restricts number of returned messages
   */
  // UTS: rest/integration/RSL2b2/history-limit-parameter-0
  it('RSL2b2 - history limit parameter', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('history-limit');
    const channel = client.channels.get(channelName);

    // Publish multiple messages
    for (let i = 1; i <= 10; i++) {
      await channel.publish(`event-${i}`, String(i));
    }

    // Poll until all messages are persisted
    await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === 10 ? result : null;
      },
      { interval: 500, timeout: 10000 },
    );

    const history = await channel.history({ limit: 5 });

    expect(history.items).to.have.length(5);

    // Should get the 5 most recent (backwards direction by default)
    expect(history.items[0].name).to.equal('event-10');
    expect(history.items[4].name).to.equal('event-6');
  });

  /**
   * RSL2b3 - History time range parameters filter messages by timestamp
   */
  // UTS: rest/integration/RSL2b3/history-time-range-0
  it('RSL2b3 - history time range parameters', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('history-timerange');
    const channel = client.channels.get(channelName);

    // Publish early messages
    await channel.publish('early1', 'e1');
    await channel.publish('early2', 'e2');

    // Small delay to ensure server timestamps differ between batches
    await new Promise((r) => setTimeout(r, 2));

    // Publish late messages
    await channel.publish('late1', 'l1');
    await channel.publish('late2', 'l2');

    // Poll until all messages appear and retrieve with timestamps
    const allMessages: any[] = await pollUntil(
      async () => {
        const result = await channel.history();
        return result.items.length === 4 ? result.items : null;
      },
      { interval: 500, timeout: 10000 },
    );

    // Use server-assigned timestamps to define the time boundary
    const earlyTimestamps = allMessages.filter((m: any) => m.name.startsWith('early')).map((m: any) => m.timestamp);
    const lateTimestamps = allMessages.filter((m: any) => m.name.startsWith('late')).map((m: any) => m.timestamp);

    const maxEarlyTs = Math.max(...earlyTimestamps);
    const minLateTs = Math.min(...lateTimestamps);

    // The boundary is between the two batches
    const timeBoundary = Math.floor((maxEarlyTs + minLateTs) / 2);

    // Query only early messages (up to the boundary)
    const earlyHistory = await channel.history({
      start: maxEarlyTs - 1000,
      end: timeBoundary,
    });

    // Query only late messages (from the boundary onwards)
    const lateHistory = await channel.history({
      start: timeBoundary + 1,
      end: minLateTs + 1000,
    });

    expect(earlyHistory.items.length).to.be.at.least(1);
    expect(lateHistory.items.length).to.be.at.least(1);

    const hasEarly = earlyHistory.items.some((msg: any) => msg.name.startsWith('early'));
    expect(hasEarly).to.be.true;

    const hasLate = lateHistory.items.some((msg: any) => msg.name.startsWith('late'));
    expect(hasLate).to.be.true;
  });

  /**
   * RSL2 - History on channel with no messages returns empty result
   */
  // UTS: rest/integration/RSL2/history-empty-channel-0
  it('RSL2 - history on empty channel returns empty result', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    // Use a fresh channel with no messages
    const channelName = uniqueChannelName('history-empty');
    const channel = client.channels.get(channelName);

    const history = await channel.history();

    expect(history.items).to.be.an('array');
    expect(history.items).to.have.length(0);
    expect(history.hasNext()).to.equal(false);
    expect(history.isLast()).to.equal(true);
  });
});
