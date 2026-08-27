/**
 * UTS Integration: Objects Lifecycle Tests
 *
 * Spec points: RTO23, RTPO15, RTPO17
 * Source: uts/objects/integration/objects_lifecycle_test.md
 *
 * End-to-end lifecycle: connect, sync, create objects via PathObject, mutate,
 * and verify propagation to a second client. Complements unit tests by verifying
 * real server sync, mutation delivery, and object creation.
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
} from '../../realtime/integration/sandbox';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';
import { describeWithProtocols } from './protocol_variants';

describeWithProtocols('uts/objects/integration/objects_lifecycle', function (useBinaryProtocol) {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTO23 - get() waits for sync and returns PathObject
   *
   * channel.object.get() returns a PathObject pointing to the root
   * after the sync sequence completes.
   */
  // UTS: objects/integration/RTO23/get-returns-path-object-0
  it('RTO23 - get() returns PathObject pointing to root', async function () {
    const channelName = uniqueChannelName('objects-get-root');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    const root = await channel.object.get();

    expect(root).to.be.an('object');
    expect(root.path()).to.equal('');
    expect(root.size()).to.equal(0);

    await closeAndWait(client);
  });

  /**
   * RTO23, RTPO15 - Set primitive via PathObject, second client reads it
   *
   * PathObject#set delegates to LiveMap#set. The mutation propagates via the
   * server and a second client sees the updated value.
   */
  // UTS: objects/integration/RTO23-RTPO15/set-primitive-propagates-0
  it('RTO23/RTPO15 - set primitive propagates to second client', async function () {
    const channelName = uniqueChannelName('objects-lifecycle');

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(clientB);

    await connectAndWait(clientA);
    await connectAndWait(clientB);

    const channelA = clientA.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });
    const channelB = clientB.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    const rootA = await channelA.object.get();
    const rootB = await channelB.object.get();

    // Client A sets a value
    await rootA.set('greeting', 'hello');

    // Client B subscribes and waits for the update
    rootB.subscribe(() => {
      // subscription active
    });
    await pollUntil(() => (rootB.get('greeting').value() === 'hello' ? true : null));

    expect(rootB.get('greeting').value()).to.equal('hello');

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTPO15 - Set with LiveCounterValueType, second client reads counter
   *
   * PathObject#set with LiveCounter.create() creates a new counter on the server.
   * Second client syncs and reads the counter value.
   */
  // UTS: objects/integration/RTPO15/set-counter-value-type-0
  it('RTPO15 - set counter value type propagates to second client', async function () {
    const channelName = uniqueChannelName('objects-counter-create');

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(clientB);

    await connectAndWait(clientA);
    await connectAndWait(clientB);

    const channelA = clientA.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });
    const channelB = clientB.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    const rootA = await channelA.object.get();
    const rootB = await channelB.object.get();

    await rootA.set('my_counter', LiveObjectsPlugin.LiveCounter.create(42));

    rootB.subscribe(() => {});
    await pollUntil(() => (rootB.get('my_counter').value() === 42 ? true : null));

    expect(rootB.get('my_counter').value()).to.equal(42);
    expect(rootB.get('my_counter').instance()).to.not.be.null;

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTPO17 - Increment counter, second client sees updated value
   *
   * PathObject#increment delegates to LiveCounter#increment. The server applies
   * the increment and propagates the updated value.
   */
  // UTS: objects/integration/RTPO17/increment-propagates-0
  it('RTPO17 - increment propagates to second client', async function () {
    const channelName = uniqueChannelName('objects-increment');

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(clientB);

    await connectAndWait(clientA);
    await connectAndWait(clientB);

    const channelA = clientA.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });
    const channelB = clientB.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    const rootA = await channelA.object.get();
    const rootB = await channelB.object.get();

    // Create a counter first
    await rootA.set('hits', LiveObjectsPlugin.LiveCounter.create(0));

    rootB.subscribe(() => {});
    await pollUntil(() => (rootB.get('hits').value() === 0 ? true : null));

    // Increment it
    await rootA.get('hits').increment(10);

    await pollUntil(() => (rootB.get('hits').value() === 10 ? true : null));

    expect(rootA.get('hits').value()).to.equal(10);
    expect(rootB.get('hits').value()).to.equal(10);

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTPO15 - Set with LiveMapValueType, second client reads nested map
   *
   * PathObject#set with LiveMap.create() creates a nested map.
   * Second client can navigate into the nested map.
   */
  // UTS: objects/integration/RTPO15/set-map-value-type-0
  it('RTPO15 - set map value type propagates to second client', async function () {
    const channelName = uniqueChannelName('objects-map-create');

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(clientB);

    await connectAndWait(clientA);
    await connectAndWait(clientB);

    const channelA = clientA.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });
    const channelB = clientB.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    const rootA = await channelA.object.get();
    const rootB = await channelB.object.get();

    await rootA.set(
      'settings',
      LiveObjectsPlugin.LiveMap.create({
        theme: 'dark',
        fontSize: 14,
      }),
    );

    rootB.subscribe(() => {});
    await pollUntil(() => (rootB.get('settings').get('theme').value() === 'dark' ? true : null));

    expect(rootB.get('settings').get('theme').value()).to.equal('dark');
    expect(rootB.get('settings').get('fontSize').value()).to.equal(14);

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTPO15 - Client syncs pre-existing data provisioned via REST
   *
   * Data created via the REST API is visible to a realtime client
   * that connects afterward.
   */
  // UTS: objects/integration/RTPO15/rest-provisioned-data-sync-0
  it('RTPO15 - client syncs pre-existing data provisioned via REST', async function () {
    const channelName = uniqueChannelName('objects-rest-provision');

    // Provision data via REST before any realtime client connects. The spec's
    // provision_objects_via_rest helper is a raw JSON POST, so the provisioning
    // client stays on json regardless of the protocol variant under test.
    const restClient = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });

    const restChannel = restClient.channels.get(channelName);
    await restChannel.object.publish({
      objectId: 'root',
      mapSet: { key: 'provisioned', value: { string: 'from_rest' } },
    });

    // Now connect a realtime client and verify it syncs the provisioned data
    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });
    const root = await channel.object.get();

    expect(root.get('provisioned').value()).to.equal('from_rest');

    await closeAndWait(client);
  });
});
