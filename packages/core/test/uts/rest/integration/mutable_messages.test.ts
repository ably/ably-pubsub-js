/**
 * UTS Integration: REST Mutable Messages Tests
 *
 * Spec points: RSL1n, RSL11, RSL14, RSL15, RSAN1, RSAN2, RSAN3
 * Source: uts/rest/integration/mutable_messages.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  uniqueChannelName,
  pollUntilSuccess,
} from './sandbox';
import { describeEachProtocol } from '../../helpers/protocol_variants';

describeEachProtocol('uts/rest/integration/mutable_messages', function (protocol) {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSL1n - publish returns serials from sandbox (single message)
   *
   * On success, returns a PublishResult containing message serials.
   */
  // UTS: rest/integration/RSL1n/publish-returns-serials-0.1
  it('RSL1n - single message publish returns result with serial', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSL1n-serials');
    const channel = client.channels.get(channelName);

    const result = await channel.publish('event1', 'data1');

    expect(result).to.have.property('serials');
    expect(result.serials).to.be.an('array');
    expect(result.serials).to.have.length(1);
    expect(result.serials[0]).to.be.a('string');
    expect((result.serials[0] as string).length).to.be.greaterThan(0);
  });

  /**
   * RSL1n - publish returns serials from sandbox (multiple messages)
   *
   * Multiple message publish returns matching count, all unique.
   */
  // UTS: rest/integration/RSL1n/publish-returns-serials-0
  it('RSL1n - multiple message publish returns unique serials', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSL1n-serials-multi');
    const channel = client.channels.get(channelName);

    const result = await channel.publish([
      { name: 'event2', data: 'data2' },
      { name: 'event3', data: 'data3' },
      { name: 'event4', data: 'data4' },
    ]);

    expect(result.serials).to.be.an('array');
    expect(result.serials).to.have.length(3);

    for (const serial of result.serials) {
      expect(serial).to.be.a('string');
      expect((serial as string).length).to.be.greaterThan(0);
    }

    // All serials should be unique
    expect(result.serials[0]).to.not.equal(result.serials[1]);
    expect(result.serials[1]).to.not.equal(result.serials[2]);
  });

  /**
   * RSL11 - getMessage retrieves published message
   *
   * A published message can be retrieved by its serial.
   */
  // UTS: rest/integration/RSL11/get-message-by-serial-0
  it('RSL11 - getMessage retrieves a published message by serial', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSL11-getMessage');
    const channel = client.channels.get(channelName);

    // Publish a message and get its serial
    const publishResult = await channel.publish('test-event', 'hello world');
    const serial = publishResult.serials[0] as string;

    // Retrieve the message by serial (polled: the store is eventually consistent and
    // getMessage throws not-found until the just-published message is visible)
    const msg = await pollUntilSuccess(() => channel.getMessage(serial));

    expect(msg).to.be.an('object');
    expect(msg.name).to.equal('test-event');
    expect(msg.data).to.equal('hello world');
    expect(msg.serial).to.equal(serial);
    expect(msg.action).to.equal('message.create');
    expect(msg.timestamp).to.be.a('number');
  });

  /**
   * RSL15 - updateMessage updates a published message
   *
   * A published message can be updated and the update is visible via getMessage().
   */
  // UTS: rest/integration/RSL15/update-message-0
  it('RSL15 - updateMessage updates a published message', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSL15-update');
    const channel = client.channels.get(channelName);

    // Publish original message
    const publishResult = await channel.publish('original', 'original-data');
    const serial = publishResult.serials[0] as string;

    // Update the message
    const updateResult = await channel.updateMessage({ serial, name: 'updated', data: 'updated-data' } as any, {
      description: 'edited content',
    });

    // Update returns a version serial
    expect(updateResult).to.have.property('versionSerial');
    expect(updateResult.versionSerial).to.be.a('string');
    expect((updateResult.versionSerial as string).length).to.be.greaterThan(0);

    // Verify via getMessage -- poll until the update is visible
    const updatedMsg = await pollUntilSuccess(async () => {
      const msg = await channel.getMessage(serial);
      if (msg.action === 'message.update') return msg;
      return null;
    });

    expect(updatedMsg.name).to.equal('updated');
    expect(updatedMsg.data).to.equal('updated-data');
    expect(updatedMsg.action).to.equal('message.update');
    expect(updatedMsg.version).to.be.an('object');
    expect(updatedMsg.version!.description).to.equal('edited content');
  });

  /**
   * RSL15 - deleteMessage deletes a published message
   *
   * A published message can be deleted and the delete is visible via getMessage().
   */
  // UTS: rest/integration/RSL15/delete-message-1
  it('RSL15 - deleteMessage deletes a published message', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSL15-delete');
    const channel = client.channels.get(channelName);

    // Publish original message
    const publishResult = await channel.publish('to-delete', 'delete-me');
    const serial = publishResult.serials[0] as string;

    // Delete the message
    const deleteResult = await channel.deleteMessage({ serial } as any);

    expect(deleteResult).to.have.property('versionSerial');
    expect(deleteResult.versionSerial).to.be.a('string');
    expect((deleteResult.versionSerial as string).length).to.be.greaterThan(0);

    // Verify via getMessage -- poll until the delete is visible
    const deletedMsg = await pollUntilSuccess(async () => {
      const msg = await channel.getMessage(serial);
      if (msg.action === 'message.delete') return msg;
      return null;
    });

    expect(deletedMsg.action).to.equal('message.delete');
  });

  /**
   * RSL14 - getMessageVersions returns version history
   *
   * Version history contains the original and all updates.
   */
  // UTS: rest/integration/RSL14/get-message-versions-0
  it('RSL14 - getMessageVersions returns version history', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSL14-versions');
    const channel = client.channels.get(channelName);

    // Publish original
    const publishResult = await channel.publish('versioned', 'v1');
    const serial = publishResult.serials[0] as string;

    // Update twice
    await channel.updateMessage({ serial, data: 'v2' } as any, { description: 'first edit' });
    await channel.updateMessage({ serial, data: 'v3' } as any, { description: 'second edit' });

    // Poll version history until all versions appear
    const versions = await pollUntilSuccess(async () => {
      const result = await channel.getMessageVersions(serial);
      if (result.items.length >= 3) return result;
      return null;
    });

    expect(versions.items.length).to.be.at.least(3);

    // All items should be Messages with the same serial
    for (const item of versions.items) {
      expect(item).to.be.an('object');
      expect(item.serial).to.equal(serial);
    }
  });

  /**
   * RSL15 - appendMessage appends to a published message
   *
   * A message can be appended to.
   */
  // UTS: rest/integration/RSL15/append-message-2
  it('RSL15 - appendMessage appends to a published message', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSL15-append');
    const channel = client.channels.get(channelName);

    // Publish original
    const publishResult = await channel.publish('appendable', 'original');
    const serial = publishResult.serials[0] as string;

    // Append to the message
    const appendResult = await channel.appendMessage({ serial, data: 'appended-data' } as any, {
      description: 'appended content',
    });

    expect(appendResult).to.have.property('versionSerial');
    expect(appendResult.versionSerial).to.be.a('string');
    expect((appendResult.versionSerial as string).length).to.be.greaterThan(0);
  });

  /**
   * RSAN1, RSAN2 - publish and delete annotations on a message
   *
   * Tests the full annotation lifecycle: create, verify, delete.
   */
  // UTS: rest/integration/RSAN1/annotation-lifecycle-0
  it('RSAN1/RSAN2/RSAN3 - annotation lifecycle: publish, get, delete', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSAN-lifecycle');
    const channel = client.channels.get(channelName);

    // Publish a message to annotate
    const publishResult = await channel.publish('annotatable', 'content');
    const serial = publishResult.serials[0] as string;

    // Create an annotation
    await channel.annotations.publish(serial, {
      type: 'com.ably.reactions',
      name: 'like',
    });

    // Verify annotation exists -- poll until it appears
    const annotations = await pollUntilSuccess(async () => {
      const result = await channel.annotations.get(serial, null);
      if (result.items.length >= 1) return result;
      return null;
    });

    expect(annotations.items.length).to.be.at.least(1);

    let found = false;
    for (const ann of annotations.items) {
      if (ann.type === 'com.ably.reactions' && ann.name === 'like') {
        found = true;
        expect(ann.action).to.equal('annotation.create');
        expect(ann.messageSerial).to.equal(serial);
      }
    }
    expect(found).to.equal(true);

    // Delete the annotation
    await channel.annotations.delete(serial, {
      type: 'com.ably.reactions',
      name: 'like',
    });
  });

  /**
   * RSAN3 - get annotations returns PaginatedResult
   *
   * Multiple annotations can be retrieved as a paginated result.
   */
  // UTS: rest/integration/RSAN3/get-annotations-paginated-0
  it('RSAN3 - paginated annotations for multiple annotation types', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('mutable:test-RSAN3-paginated');
    const channel = client.channels.get(channelName);

    // Publish a message
    const publishResult = await channel.publish('multi-annotated', 'content');
    const serial = publishResult.serials[0] as string;

    // Publish multiple annotations
    await channel.annotations.publish(serial, {
      type: 'com.ably.reactions',
      name: 'like',
    });
    await channel.annotations.publish(serial, {
      type: 'com.ably.reactions',
      name: 'heart',
    });

    // Retrieve annotations -- poll until both appear
    const result = await pollUntilSuccess(async () => {
      const r = await channel.annotations.get(serial, null);
      if (r.items.length >= 2) return r;
      return null;
    });

    expect(result.items.length).to.be.at.least(2);

    for (const ann of result.items) {
      expect(ann).to.be.an('object');
      expect(ann.messageSerial).to.equal(serial);
      expect(ann.type).to.equal('com.ably.reactions');
      expect(ann.timestamp).to.be.a('number');
    }
  });
});
