/**
 * UTS Integration: Channel Publish Tests
 *
 * Spec points: RTL6, RTL6f, RSL4d1, RSL4d2, RSL4d3, RSL6a, RSL6a2
 * Source: uts/realtime/integration/channels/channel_publish_test.md
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

describeEachProtocol('uts/realtime/integration/channels/channel_publish', function (protocol) {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTL6, RSL4d2 - String data round-trip
   */
  // UTS: realtime/integration/RTL6/string-data-roundtrip-0
  it('RTL6/RSL4d2 - string data round-trip', async function () {
    const channelName = uniqueChannelName('publish-string');

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

    const received: any[] = [];
    await subChannel.subscribe((msg: any) => received.push(msg));
    await pubChannel.attach();

    await pubChannel.publish('string-event', 'hello world');

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(received).to.have.length(1);
    expect(received[0].name).to.equal('string-event');
    expect(received[0].data).to.equal('hello world');
    expect(received[0].data).to.be.a('string');

    await closeAndWait(publisher);
    await closeAndWait(subscriber);
  });

  /**
   * RTL6, RSL4d3 - JSON object data round-trip
   */
  // UTS: realtime/integration/RTL6/json-data-roundtrip-1
  it('RTL6/RSL4d3 - JSON object data round-trip', async function () {
    const channelName = uniqueChannelName('publish-json');

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

    const jsonData = { key: 'value', nested: { count: 42 }, list: [1, 2, 3] };

    const received: any[] = [];
    await subChannel.subscribe((msg: any) => received.push(msg));
    await pubChannel.attach();

    await pubChannel.publish('json-event', jsonData);

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(received).to.have.length(1);
    expect(received[0].name).to.equal('json-event');
    expect(received[0].data.key).to.equal('value');
    expect(received[0].data.nested.count).to.equal(42);
    expect(received[0].data.list).to.deep.equal([1, 2, 3]);

    await closeAndWait(publisher);
    await closeAndWait(subscriber);
  });

  /**
   * RTL6, RSL4d1 - Binary data round-trip
   */
  // UTS: realtime/integration/RTL6/binary-data-roundtrip-2
  it('RTL6/RSL4d1 - binary data round-trip', async function () {
    const channelName = uniqueChannelName('publish-binary');

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

    const binaryData = Buffer.from([0, 1, 2, 255, 128, 64]);

    const received: any[] = [];
    await subChannel.subscribe((msg: any) => received.push(msg));
    await pubChannel.attach();

    await pubChannel.publish('binary-event', binaryData);

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(received).to.have.length(1);
    expect(received[0].name).to.equal('binary-event');
    expect(Buffer.isBuffer(received[0].data)).to.be.true;
    expect(Buffer.from(received[0].data)).to.deep.equal(binaryData);

    await closeAndWait(publisher);
    await closeAndWait(subscriber);
  });

  /**
   * RTL6f - connectionId matches publisher
   */
  // UTS: realtime/integration/RTL6f/connectionid-matches-publisher-0
  it('RTL6f - connectionId matches publisher', async function () {
    const channelName = uniqueChannelName('publish-connid');

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

    const publisherConnectionId = publisher.connection.id;

    const pubChannel = publisher.channels.get(channelName);
    const subChannel = subscriber.channels.get(channelName);

    const received: any[] = [];
    await subChannel.subscribe((msg: any) => received.push(msg));
    await pubChannel.attach();

    await pubChannel.publish('connid-test', 'data');

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(received[0].connectionId).to.equal(publisherConnectionId);
    expect(received[0].connectionId).to.not.equal(subscriber.connection.id);

    await closeAndWait(publisher);
    await closeAndWait(subscriber);
  });

  /**
   * RSL6a2 - Message extras round-trip
   */
  // UTS: realtime/integration/RSL6a2/message-extras-roundtrip-0
  it('RSL6a2 - message extras round-trip', async function () {
    const channelName = uniqueChannelName('pushenabled:publish-extras');

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

    const extras = { push: { notification: { title: 'Testing' } } };

    const received: any[] = [];
    await subChannel.subscribe((msg: any) => received.push(msg));
    await pubChannel.attach();

    await pubChannel.publish({ name: 'extras-test', data: 'payload', extras });

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(received[0].extras).to.not.be.null;
    expect(received[0].extras.push.notification.title).to.equal('Testing');

    await closeAndWait(publisher);
    await closeAndWait(subscriber);
  });
});
