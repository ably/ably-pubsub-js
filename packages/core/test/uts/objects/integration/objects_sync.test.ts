/**
 * UTS Integration: Objects Sync Tests
 *
 * Spec points: RTO4, RTO5, RTO17
 * Source: uts/objects/integration/objects_sync_test.md
 *
 * Verify the sync sequence against the real server: attach with HAS_OBJECTS,
 * receive OBJECT_SYNC, reach SYNCED state. Also tests re-attach behaviour
 * where the client detaches and re-attaches to verify the pool is re-synced.
 */

import { expect } from 'chai';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';
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
import { describeWithProtocols } from './protocol_variants';

describeWithProtocols('uts/objects/integration/objects_sync', function (useBinaryProtocol) {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTO4, RTO5 - Attach triggers sync, get() resolves after SYNCED
   *
   * On ATTACHED with HAS_OBJECTS flag, client transitions to SYNCING,
   * processes OBJECT_SYNC messages, then transitions to SYNCED. get() waits for SYNCED.
   */
  // UTS: objects/integration/RTO4-RTO5/attach-sync-get-0
  it('RTO4, RTO5 - attach triggers sync, get() resolves after SYNCED', async function () {
    const channelName = uniqueChannelName('objects-sync');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    const root = await channel.object.get();

    // root should be a PathObject at the root path
    expect(root).to.not.be.undefined;
    expect(root).to.not.be.null;
    expect(root.path()).to.equal('');

    await closeAndWait(client);
  });

  /**
   * RTO5, RTO17 - Two clients sync same channel with pre-existing data
   *
   * Both clients complete sync and see the same object pool state.
   */
  // UTS: objects/integration/RTO5-RTO17/two-clients-sync-0
  it('RTO5, RTO17 - two clients sync same channel with pre-existing data', async function () {
    const channelName = uniqueChannelName('objects-two-sync');

    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(clientA);

    const clientB = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(clientB);

    await connectAndWait(clientA);
    await connectAndWait(clientB);

    const channelA = clientA.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });
    const channelB = clientB.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    // Client A creates data
    const rootA = await channelA.object.get();
    await rootA.set('key1', 'value1');

    // Client B attaches and syncs -- should see the data
    const rootB = await channelB.object.get();
    await pollUntil(() => (rootB.get('key1').value() === 'value1' ? true : null));

    expect(rootB.get('key1').value()).to.equal('value1');

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTO17 - Re-attach re-syncs object pool
   *
   * On re-attach, the sync state machine restarts and the pool
   * is re-populated from the server.
   */
  // UTS: objects/integration/RTO17/reattach-resyncs-0
  it('RTO17 - re-attach re-syncs object pool', async function () {
    const channelName = uniqueChannelName('objects-reattach');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    let root = await channel.object.get();

    // Set some data
    await root.set('before_detach', 'hello');

    // Verify the data is accessible via polling (echo from server)
    await pollUntil(() => (root.get('before_detach').value() === 'hello' ? true : null));

    expect(root.get('before_detach').value()).to.equal('hello');

    // Detach and re-attach
    await channel.detach();
    await channel.attach();

    // Re-sync should restore data
    root = await channel.object.get();
    await pollUntil(() => (root.get('before_detach').value() === 'hello' ? true : null));

    expect(root.get('before_detach').value()).to.equal('hello');

    await closeAndWait(client);
  });

  /**
   * RTO4 - Attach without OBJECT_PUBLISH still resolves get() with empty pool
   *
   * Channel attached with only OBJECT_SUBSCRIBE mode. Server
   * sends HAS_OBJECTS, sync completes, root is an empty LiveMap.
   *
   */
  // UTS: objects/integration/RTO4/attach-subscribe-only-0
  it('RTO4 - Attach without OBJECT_PUBLISH still resolves get() with empty pool', async function () {
    const channelName = uniqueChannelName('objects-subscribe-only');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE'],
    });

    const root = await channel.object.get();

    // root should be a PathObject
    expect(root).to.not.be.undefined;
    expect(root).to.not.be.null;
    expect(root.path()).to.equal('');
    expect(root.size()).to.equal(0);

    await closeAndWait(client);
  });
});
