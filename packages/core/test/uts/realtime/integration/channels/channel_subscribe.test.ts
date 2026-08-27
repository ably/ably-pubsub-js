/**
 * UTS Integration: Channel Subscribe Tests
 *
 * Spec points: RTL7, RTL7a, RTL7b, RTL7d
 * Source: uts/realtime/integration/channels/channel_subscribe_test.md
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

describe('uts/realtime/integration/channels/channel_subscribe', function () {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTL7a - Subscribe with no name filter receives all messages
   */
  // UTS: realtime/integration/RTL7a/subscribe-all-messages-0
  it('RTL7a - subscribe with no name filter receives all messages', async function () {
    const channelName = uniqueChannelName('subscribe-all');

    const publisher = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(publisher);

    const subscriber = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(subscriber);

    await connectAndWait(publisher);
    await connectAndWait(subscriber);

    const pubChannel = publisher.channels.get(channelName);
    const subChannel = subscriber.channels.get(channelName);

    const received: any[] = [];
    await subChannel.subscribe((msg: any) => received.push(msg));
    await pubChannel.attach();

    await pubChannel.publish('event-a', 'data-a');
    await pubChannel.publish('event-b', 'data-b');
    await pubChannel.publish('event-c', 'data-c');

    await pollUntil(() => (received.length >= 3 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(received).to.have.length(3);

    const names = received.map((m: any) => m.name);
    expect(names).to.include('event-a');
    expect(names).to.include('event-b');
    expect(names).to.include('event-c');

    await closeAndWait(publisher);
    await closeAndWait(subscriber);
  });

  /**
   * RTL7b - Subscribe with name filter receives only matching messages
   */
  // UTS: realtime/integration/RTL7b/subscribe-filtered-by-name-0
  it('RTL7b - subscribe with name filter receives only matching messages', async function () {
    const channelName = uniqueChannelName('subscribe-filtered');

    const publisher = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(publisher);

    const subscriber = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(subscriber);

    await connectAndWait(publisher);
    await connectAndWait(subscriber);

    const pubChannel = publisher.channels.get(channelName);
    const subChannel = subscriber.channels.get(channelName);

    const targetReceived: any[] = [];
    await subChannel.subscribe('target', (msg: any) => targetReceived.push(msg));

    const allReceived: any[] = [];
    subChannel.subscribe((msg: any) => allReceived.push(msg));

    await pubChannel.attach();

    await pubChannel.publish('other', 'ignored');
    await pubChannel.publish('target', 'wanted-1');
    await pubChannel.publish('other', 'ignored');
    await pubChannel.publish('target', 'wanted-2');

    await pollUntil(() => (allReceived.length >= 4 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(allReceived).to.have.length(4);

    expect(targetReceived).to.have.length(2);
    expect(targetReceived[0].name).to.equal('target');
    expect(targetReceived[0].data).to.equal('wanted-1');
    expect(targetReceived[1].name).to.equal('target');
    expect(targetReceived[1].data).to.equal('wanted-2');

    await closeAndWait(publisher);
    await closeAndWait(subscriber);
  });

  /**
   * RTL7 - Bidirectional message flow
   */
  // UTS: realtime/integration/RTL7/bidirectional-message-flow-0
  it('RTL7 - bidirectional message flow between two clients', async function () {
    const channelName = uniqueChannelName('subscribe-bidir');

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
      clientId: 'client-a',
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
      clientId: 'client-b',
    });
    trackClient(clientB);

    await connectAndWait(clientA);
    await connectAndWait(clientB);

    const channelA = clientA.channels.get(channelName);
    const channelB = clientB.channels.get(channelName);

    const receivedByA: any[] = [];
    const receivedByB: any[] = [];

    await channelA.subscribe((msg: any) => receivedByA.push(msg));
    await channelB.subscribe((msg: any) => receivedByB.push(msg));

    await channelA.publish('from-a', 'hello from a');
    await channelB.publish('from-b', 'hello from b');

    await pollUntil(() => (receivedByA.length >= 2 && receivedByB.length >= 2 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const aNNames = receivedByA.map((m: any) => m.name);
    const bNames = receivedByB.map((m: any) => m.name);

    expect(aNNames).to.include('from-a');
    expect(aNNames).to.include('from-b');
    expect(bNames).to.include('from-a');
    expect(bNames).to.include('from-b');

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });
});
