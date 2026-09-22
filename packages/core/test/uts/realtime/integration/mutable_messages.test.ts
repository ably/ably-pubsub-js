/**
 * UTS Integration: Realtime Mutable Messages & Annotations Tests
 *
 * Spec points: RTL28, RTL31, RTL32, RTAN1, RTAN2, RTAN4
 * Source: uts/realtime/integration/mutable_messages_test.md
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
  pollUntilSuccess,
} from './sandbox';
import { describeEachProtocol } from '../../helpers/protocol_variants';

describeEachProtocol('uts/realtime/integration/mutable_messages', function (protocol) {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTL32 — Update a message via realtime and observe on subscriber
   *
   * updateMessage() sends a MESSAGE ProtocolMessage with MESSAGE_UPDATE action.
   * Returns UpdateDeleteResult from ACK.
   */
  // UTS: realtime/integration/RTL32/update-message-observed-0
  it('RTL32 - update message observed on subscriber', async function () {
    const channelName = uniqueChannelName('mutable:rt-update');

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

    await channelB.attach();

    const received: any[] = [];
    await channelB.subscribe((msg: any) => received.push(msg));

    await channelA.attach();

    await channelA.publish('original', 'v1');

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const serial = received[0].serial;

    const updateResult = await channelA.updateMessage({ serial, name: 'updated', data: 'v2' } as any, {
      description: 'edited',
    });

    await pollUntil(() => (received.length >= 2 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(updateResult).to.have.property('versionSerial');
    expect(updateResult.versionSerial).to.be.a('string');
    expect((updateResult.versionSerial as string).length).to.be.greaterThan(0);

    expect(received[0].action).to.equal('message.create');
    expect(received[0].name).to.equal('original');
    expect(received[0].data).to.equal('v1');
    expect(received[0].serial).to.be.a('string');
    expect(received[0].serial.length).to.be.greaterThan(0);

    const updateMsg = received[1];
    expect(updateMsg.action).to.equal('message.update');
    expect(updateMsg.name).to.equal('updated');
    expect(updateMsg.data).to.equal('v2');
    expect(updateMsg.serial).to.equal(serial);

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTL32 — Delete a message via realtime and observe on subscriber
   *
   * deleteMessage() sends a MESSAGE ProtocolMessage with MESSAGE_DELETE action.
   */
  // UTS: realtime/integration/RTL32/delete-message-observed-1
  it('RTL32 - delete message observed on subscriber', async function () {
    const channelName = uniqueChannelName('mutable:rt-delete');

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

    await channelB.attach();

    const received: any[] = [];
    await channelB.subscribe((msg: any) => received.push(msg));

    await channelA.attach();

    await channelA.publish('to-delete', 'ephemeral');

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const serial = received[0].serial;

    const deleteResult = await channelA.deleteMessage({ serial } as any);

    await pollUntil(() => (received.length >= 2 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(deleteResult).to.have.property('versionSerial');
    expect(deleteResult.versionSerial).to.be.a('string');
    expect((deleteResult.versionSerial as string).length).to.be.greaterThan(0);

    const deleteMsg = received[1];
    expect(deleteMsg.action).to.equal('message.delete');
    expect(deleteMsg.serial).to.equal(serial);

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTL32 — Append to a message via realtime and observe on subscriber
   *
   * appendMessage() sends a MESSAGE ProtocolMessage with MESSAGE_APPEND action.
   */
  // UTS: realtime/integration/RTL32/append-message-observed-2
  it('RTL32 - append message observed on subscriber', async function () {
    const channelName = uniqueChannelName('mutable:rt-append');

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

    await channelB.attach();

    const received: any[] = [];
    await channelB.subscribe((msg: any) => received.push(msg));

    await channelA.attach();

    await channelA.publish('appendable', 'original');

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const serial = received[0].serial;

    const appendResult = await channelA.appendMessage({ serial, data: 'appended-data' } as any, {
      description: 'thread reply',
    });

    await pollUntil(() => (received.length >= 2 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(appendResult).to.have.property('versionSerial');
    expect(appendResult.versionSerial).to.be.a('string');
    expect((appendResult.versionSerial as string).length).to.be.greaterThan(0);

    const appendMsg = received[1];
    expect(appendMsg.action).to.equal('message.append');
    expect(appendMsg.data).to.equal('appended-data');
    expect(appendMsg.serial).to.equal(serial);

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTL32 — Full mutation lifecycle: update, append, delete observed in sequence
   *
   * Subscriber receives create -> update -> append -> delete in order.
   */
  // UTS: realtime/integration/RTL32/full-mutation-lifecycle-3
  it('RTL32 - full mutation lifecycle', async function () {
    const channelName = uniqueChannelName('mutable:rt-lifecycle');

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

    await channelB.attach();

    const received: any[] = [];
    await channelB.subscribe((msg: any) => received.push(msg));

    await channelA.attach();

    // 1. Publish original
    await channelA.publish('lifecycle', 'v1');

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const serial = received[0].serial;

    // 2. Update
    await channelA.updateMessage({ serial, name: 'lifecycle', data: 'v2' } as any, { description: 'edit 1' });

    await pollUntil(() => (received.length >= 2 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    // 3. Append
    await channelA.appendMessage({ serial, data: 'reply-data' } as any, { description: 'thread reply' });

    await pollUntil(() => (received.length >= 3 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    // 4. Delete
    await channelA.deleteMessage({ serial } as any);

    await pollUntil(() => (received.length >= 4 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(received).to.have.length(4);

    expect(received[0].action).to.equal('message.create');
    expect(received[0].name).to.equal('lifecycle');
    expect(received[0].data).to.equal('v1');
    expect(received[0].serial).to.equal(serial);

    expect(received[1].action).to.equal('message.update');
    expect(received[1].name).to.equal('lifecycle');
    expect(received[1].data).to.equal('v2');
    expect(received[1].serial).to.equal(serial);

    expect(received[2].action).to.equal('message.append');
    expect(received[2].data).to.equal('reply-data');
    expect(received[2].serial).to.equal(serial);

    expect(received[3].action).to.equal('message.delete');
    expect(received[3].serial).to.equal(serial);

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTL28, RTL31 — getMessage and getMessageVersions from realtime channel
   *
   * RTL28: RealtimeChannel#getMessage same as RestChannel#getMessage.
   * RTL31: RealtimeChannel#getMessageVersions same as RestChannel#getMessageVersions.
   */
  // UTS: realtime/integration/RTL28/get-message-and-versions-0
  it('RTL28/RTL31 - getMessage and getMessageVersions', async function () {
    const channelName = uniqueChannelName('mutable:rt-get-versions');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName);
    await channel.attach();

    const received: any[] = [];
    await channel.subscribe((msg: any) => received.push(msg));

    await channel.publish('versioned', 'v1');

    await pollUntil(() => (received.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const serial = received[0].serial;

    await channel.updateMessage({ serial, data: 'v2' } as any, { description: 'first edit' });
    await channel.updateMessage({ serial, data: 'v3' } as any, { description: 'second edit' });

    // The message store is eventually consistent: poll until the second update is
    // visible rather than sleeping a fixed interval before the HTTP-based reads
    // (a found message may still be a stale version).
    const msg = await pollUntilSuccess(async () => {
      const m = await channel.getMessage(serial);
      if (m.action === 'message.update' && m.data === 'v3') return m;
      return null;
    });

    expect(msg).to.be.an('object');
    expect(msg.serial).to.equal(serial);
    expect(msg.data).to.equal('v3');
    expect(msg.action).to.equal('message.update');

    const versions = await pollUntilSuccess(async () => {
      const result = await channel.getMessageVersions(serial);
      if (result.items.length >= 3) return result;
      return null;
    });

    expect(versions).to.have.property('items');
    expect(versions.items.length).to.be.at.least(3);

    for (const item of versions.items) {
      expect(item).to.be.an('object');
      expect(item.serial).to.equal(serial);
    }

    await closeAndWait(client);
  });

  /**
   * RTAN1, RTAN2, RTAN4 — Annotation publish, subscribe, and delete via realtime
   *
   * RTAN1c: publish sends ANNOTATION ProtocolMessage.
   * RTAN2a: delete sends ANNOTATION_DELETE.
   * RTAN4b: annotations delivered to subscribers.
   */
  // UTS: realtime/integration/RTAN1/annotation-publish-delete-0
  it('RTAN1/RTAN2/RTAN4 - annotation publish, subscribe, and delete', async function () {
    const channelName = uniqueChannelName('mutable:rt-annotations');

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

    const channelA = clientA.channels.get(channelName, {
      modes: ['PUBLISH', 'SUBSCRIBE', 'ANNOTATION_PUBLISH', 'ANNOTATION_SUBSCRIBE'],
    });
    const channelB = clientB.channels.get(channelName, {
      modes: ['SUBSCRIBE', 'ANNOTATION_SUBSCRIBE'],
    });

    await channelB.attach();

    const receivedAnnotations: any[] = [];
    await channelB.annotations.subscribe((ann: any) => {
      receivedAnnotations.push(ann);
    });

    const receivedMessages: any[] = [];
    await channelA.subscribe((msg: any) => receivedMessages.push(msg));

    await channelA.attach();

    await channelA.publish('annotatable', 'content');

    await pollUntil(() => (receivedMessages.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const serial = receivedMessages[0].serial;

    await channelA.annotations.publish(serial, {
      type: 'com.ably.reactions',
      name: 'like',
    });

    await pollUntil(() => (receivedAnnotations.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    await channelA.annotations.delete(serial, {
      type: 'com.ably.reactions',
      name: 'like',
    });

    await pollUntil(() => (receivedAnnotations.length >= 2 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(receivedAnnotations).to.have.length(2);

    const createAnn = receivedAnnotations[0];
    expect(createAnn.action).to.equal('annotation.create');
    expect(createAnn.type).to.equal('com.ably.reactions');
    expect(createAnn.name).to.equal('like');
    expect(createAnn.messageSerial).to.equal(serial);

    const deleteAnn = receivedAnnotations[1];
    expect(deleteAnn.action).to.equal('annotation.delete');
    expect(deleteAnn.type).to.equal('com.ably.reactions');
    expect(deleteAnn.name).to.equal('like');
    expect(deleteAnn.messageSerial).to.equal(serial);

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTAN4c — Annotation subscribe with type filtering
   *
   * Subscribe with a type filter delivers only annotations whose type matches.
   */
  // UTS: realtime/integration/RTAN4c/annotation-type-filtering-0
  it('RTAN4c - annotation type filtering', async function () {
    const channelName = uniqueChannelName('mutable:rt-ann-filter');

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

    const channelA = clientA.channels.get(channelName, {
      modes: ['PUBLISH', 'SUBSCRIBE', 'ANNOTATION_PUBLISH', 'ANNOTATION_SUBSCRIBE'],
    });
    const channelB = clientB.channels.get(channelName, {
      modes: ['SUBSCRIBE', 'ANNOTATION_SUBSCRIBE'],
    });

    await channelB.attach();

    const filteredAnnotations: any[] = [];
    await channelB.annotations.subscribe('com.ably.reactions', (ann: any) => {
      filteredAnnotations.push(ann);
    });

    const allAnnotations: any[] = [];
    await channelB.annotations.subscribe((ann: any) => {
      allAnnotations.push(ann);
    });

    const receivedMessages: any[] = [];
    await channelA.subscribe((msg: any) => receivedMessages.push(msg));

    await channelA.attach();

    await channelA.publish('multi-type', 'content');

    await pollUntil(() => (receivedMessages.length >= 1 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    const serial = receivedMessages[0].serial;

    await channelA.annotations.publish(serial, {
      type: 'com.ably.reactions',
      name: 'like',
    });
    await channelA.annotations.publish(serial, {
      type: 'com.example.comments',
      name: 'comment',
    });
    await channelA.annotations.publish(serial, {
      type: 'com.ably.reactions',
      name: 'heart',
    });

    await pollUntil(() => (allAnnotations.length >= 3 ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(allAnnotations).to.have.length(3);

    expect(filteredAnnotations).to.have.length(2);
    expect(filteredAnnotations[0].type).to.equal('com.ably.reactions');
    expect(filteredAnnotations[0].name).to.equal('like');
    expect(filteredAnnotations[1].type).to.equal('com.ably.reactions');
    expect(filteredAnnotations[1].name).to.equal('heart');

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTAN4d — Annotation subscribe implicitly attaches channel
   *
   * Calling annotations.subscribe() on an unattached channel triggers implicit attach.
   */
  // UTS: realtime/integration/RTAN4d/annotation-implicit-attach-0
  it('RTAN4d - annotation subscribe implicitly attaches channel', async function () {
    const channelName = uniqueChannelName('mutable:rt-ann-implicit-attach');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      modes: ['ANNOTATION_SUBSCRIBE'],
    });

    expect(channel.state).to.equal('initialized');

    await channel.annotations.subscribe((_ann: any) => {
      // no-op
    });

    await pollUntil(() => (channel.state === 'attached' ? true : null), {
      interval: 200,
      timeout: 10000,
    });

    expect(channel.state).to.equal('attached');

    await closeAndWait(client);
  });
});
