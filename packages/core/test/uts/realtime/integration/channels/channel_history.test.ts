/**
 * UTS Integration: Channel History Tests
 *
 * Spec points: RTL10d
 * Source: uts/realtime/integration/channel_history_test.md
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

describeEachProtocol('uts/realtime/integration/channels/channel_history', function (protocol) {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTL10d - History contains messages published by another client
   */
  // UTS: realtime/integration/RTL10d/history-cross-client-0
  it('RTL10d - history contains messages from another client', async function () {
    const channelName = uniqueChannelName('history-RTL10d');

    const publisher = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(publisher);

    const subscriber = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(subscriber);

    await connectAndWait(publisher);
    await connectAndWait(subscriber);

    const pubChannel = publisher.channels.get(channelName);
    const subChannel = subscriber.channels.get(channelName);

    await pubChannel.attach();
    await subChannel.attach();

    await pubChannel.publish('event1', 'data1');
    await pubChannel.publish('event2', 'data2');
    await pubChannel.publish('event3', 'data3');

    const history = await pollUntil(
      async () => {
        const result = await subChannel.history();
        return result.items.length === 3 ? result : null;
      },
      { interval: 500, timeout: 10000 },
    );

    expect(history.items).to.have.length(3);

    expect(history.items[0].name).to.equal('event3');
    expect(history.items[0].data).to.equal('data3');

    expect(history.items[1].name).to.equal('event2');
    expect(history.items[1].data).to.equal('data2');

    expect(history.items[2].name).to.equal('event1');
    expect(history.items[2].data).to.equal('data1');

    await closeAndWait(publisher);
    await closeAndWait(subscriber);
  });
});
