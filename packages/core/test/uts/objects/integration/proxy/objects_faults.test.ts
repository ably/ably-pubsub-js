/**
 * UTS Proxy Integration: Objects Fault Tests
 *
 * Spec points: RTO5a2, RTO7, RTO8, RTO17, RTO20e, RTO20e1, RTO5c6
 * Source: specification/uts/objects/integration/proxy/objects_faults.md
 *
 * Tests LiveObjects fault tolerance: sync interrupted by disconnect,
 * mutations buffered during re-sync, server-initiated detach triggers
 * re-sync, in-flight publish fails when channel enters FAILED during
 * the sync wait, and publish during sync with delayed OBJECT_SYNC.
 */

import { expect } from 'chai';
import * as LiveObjectsPlugin from '../../../../../src/plugins/liveobjects';
import {
  Ably,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  getKeyParts,
  trackClient,
  closeAndWait,
  connectAndWait,
  generateJWT,
  uniqueChannelName,
  pollUntil,
  pollUntilSuccess,
} from '../../../realtime/integration/sandbox';
import { createProxySession, waitForProxy, ProxySession } from '../../../realtime/integration/helpers/proxy';

function waitForState(client: any, targetState: string, timeout = 15000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for state '${targetState}' (current: ${client.connection.state})`)),
      timeout,
    );
    if (client.connection.state === targetState) {
      clearTimeout(timer);
      resolve();
      return;
    }
    const listener = (stateChange: any) => {
      if (stateChange.current === targetState) {
        clearTimeout(timer);
        client.connection.off(listener);
        resolve();
      }
    };
    client.connection.on(listener);
  });
}

function waitForChannelState(channel: any, targetState: string, timeout = 15000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for channel state '${targetState}' (current: ${channel.state})`)),
      timeout,
    );
    if (channel.state === targetState) {
      clearTimeout(timer);
      resolve();
      return;
    }
    const listener = (stateChange: any) => {
      if (stateChange.current === targetState) {
        clearTimeout(timer);
        channel.off(listener);
        resolve();
      }
    };
    channel.on(listener);
  });
}

describe('uts/objects/integration/proxy/objects_faults', function () {
  this.timeout(120000);

  let session: ProxySession | null = null;

  before(async function () {
    await waitForProxy();
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  afterEach(async function () {
    if (session) {
      await session.close();
      session = null;
    }
  });

  /**
   * RTO5a2, RTO17 - Sync interrupted by disconnect, re-syncs on reconnect
   *
   * When the connection drops mid-OBJECT_SYNC, the client discards partial
   * sync state and re-syncs cleanly on reconnect. The proxy disconnects after
   * the first OBJECT_SYNC frame so the sync is never completed, then on
   * reconnect the client re-attaches and syncs fully.
   */
  // UTS: objects/proxy/RTO5a2-RTO17/sync-interrupted-reconnect-0
  it('RTO5a2, RTO17 - sync interrupted by disconnect, re-syncs on reconnect', async function () {
    const channelName = uniqueChannelName('objects-sync-interrupt');

    // Disconnect after first OBJECT_SYNC frame (action 20)
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: '20' },
          action: { type: 'disconnect' },
          times: 1,
          comment: 'RTO5a2: Disconnect after first OBJECT_SYNC to interrupt sync',
        },
      ],
    });

    const { keyName, keySecret } = getKeyParts(getApiKey());
    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    // Connect through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    // First attach triggers sync; proxy disconnects mid-sync
    channel.attach();
    await waitForState(client, 'disconnected', 15000);

    // Client auto-reconnects; re-attach triggers fresh sync
    await waitForState(client, 'connected', 30000);

    // get() waits for SYNCED -- will only resolve if re-sync completes
    const root = await channel.object.get();

    // root should be a PathObject at the root path
    expect(root).to.not.be.null;
    expect(root).to.not.be.undefined;
    expect(root.path()).to.equal('');

    await closeAndWait(client);
  });

  /**
   * RTO7, RTO8 - Mutations during re-sync are buffered and applied
   *
   * Client A publishes mutations while client B is re-syncing after reconnect.
   * The mutations should be buffered and applied after the sync completes.
   */
  // UTS: objects/proxy/RTO7-RTO8/mutations-buffered-during-resync-0
  it('RTO7, RTO8 - mutations during re-sync are buffered and applied', async function () {
    const channelName = uniqueChannelName('objects-buffer-resync');

    // Client A: direct connection (no proxy), publishes mutations
    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: 'nonprod:sandbox',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(clientA);

    await connectAndWait(clientA);

    const channelA = clientA.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });
    const rootA = await channelA.object.get();

    // Set initial data
    await rootA.set('key1', 'initial');

    // Client B: through proxy, will be disconnected
    session = await createProxySession({
      rules: [],
    });

    const { keyName, keySecret } = getKeyParts(getApiKey());
    const clientB = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(clientB);

    const channelB = clientB.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    // Client B connects and syncs
    await connectAndWait(clientB);

    const rootB = await channelB.object.get();
    await pollUntilSuccess(() => (rootB.get('key1').value() === 'initial' ? true : null));

    // Disconnect client B via proxy (use 'close' action type to close the WebSocket)
    await session.triggerAction({ type: 'close' });
    await waitForState(clientB, 'disconnected', 15000);

    // While B is disconnected, A publishes a mutation
    await rootA.set('key1', 'updated_during_disconnect');

    // Client B reconnects and re-syncs; the mutation should be visible
    await waitForState(clientB, 'connected', 30000);

    const rootB2 = await channelB.object.get();
    await pollUntilSuccess(() => (rootB2.get('key1').value() === 'updated_during_disconnect' ? true : null), {
      timeout: 15000,
    });

    expect(rootB2.get('key1').value()).to.equal('updated_during_disconnect');

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });

  /**
   * RTO17 - Server-initiated detach triggers re-sync on re-attach
   *
   * The proxy injects a DETACHED message for the channel, simulating a
   * server-initiated detach. After the client automatically re-attaches
   * (RTL13a), it must re-sync the object pool.
   */
  // UTS: objects/proxy/RTO17/server-detach-resync-0
  it('RTO17 - server-initiated detach triggers re-sync on re-attach', async function () {
    const channelName = uniqueChannelName('objects-detach-resync');

    session = await createProxySession({
      rules: [],
    });

    const { keyName, keySecret } = getKeyParts(getApiKey());
    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    client.connect();
    await waitForState(client, 'connected', 15000);

    let root = await channel.object.get();

    // Set some data
    await root.set('before_detach', 'hello');

    // Verify the data is accessible via polling (echo from server)
    await pollUntilSuccess(() => (root.get('before_detach').value() === 'hello' ? true : null));
    expect(root.get('before_detach').value()).to.equal('hello');

    // Inject server-initiated DETACHED (action 13)
    await session.triggerAction({
      type: 'inject_to_client',
      message: {
        action: 13,
        channel: channelName,
      },
    });

    // Client should auto-re-attach (RTL13a)
    await waitForChannelState(channel, 'attached', 30000);

    // Re-sync should restore data
    root = await channel.object.get();
    await pollUntilSuccess(() => (root.get('before_detach').value() === 'hello' ? true : null), { timeout: 15000 });

    expect(root.get('before_detach').value()).to.equal('hello');

    await closeAndWait(client);
  });

  /**
   * RTO20e, RTO20e1 - publishAndApply fails when channel enters FAILED during SYNCING
   *
   * The client syncs the channel, is forced back into SYNCING by an injected
   * ATTACHED carrying the HAS_OBJECTS flag (RTO4c), then issues a mutation
   * *while* SYNCING. The publish and its ACK complete against the real
   * server, so publishAndApply parks in the RTO20e wait for SYNCED. The
   * proxy then injects a channel ERROR so the channel enters FAILED whilst
   * the operation is waiting; the pending mutation must fail with 92008,
   * statusCode 400, cause = channel errorReason (RTO20e1).
   *
   * Note: the mutation must be in flight *before* the channel fails. A
   * mutation issued on a channel already in DETACHED/FAILED/SUSPENDED fails
   * the RTO26b write precondition with 90001 and never reaches
   * publishAndApply -- that is different behaviour, not this test. The
   * unit-tier test with UTS ID objects/unit/RTO20e1/fails-on-channel-failed-0
   * (in test/uts/objects/unit/realtime_object.test.ts) uses the same sequence.
   */
  // UTS: objects/proxy/RTO20e/publish-fails-on-channel-failed-0
  it('RTO20e, RTO20e1 - publishAndApply fails when channel enters FAILED during sync wait', async function () {
    const channelName = uniqueChannelName('objects-publish-failed');

    session = await createProxySession({
      rules: [],
    });

    const { keyName, keySecret } = getKeyParts(getApiKey());
    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    client.connect();
    await waitForState(client, 'connected', 15000);

    const root = await channel.object.get();

    // Force the objects back into SYNCING: inject an ATTACHED (action 11) carrying the
    // HAS_OBJECTS flag (bit 7, i.e. flags: 128). RTO4c starts a new sync sequence on
    // every ATTACHED protocol message; the server never sent this ATTACHED, so no
    // OBJECT_SYNC follows and the objects remain SYNCING. The channel stays ATTACHED.
    await session.triggerAction({
      type: 'inject_to_client',
      message: { action: 11, channel: channelName, flags: 128 },
    });

    // Mutate WHILE SYNCING: the channel is ATTACHED so the write preconditions (RTO26)
    // pass and the publish + ACK complete against the real server; publishAndApply then
    // waits for a SYNCED that will never arrive (RTO20e). Do not await yet -- attach a
    // handler immediately so the later rejection is never unhandled.
    const pending = root.set('key', 'value');
    const pendingError = pending.then(
      () => null,
      (err: any) => err,
    );

    // Ensure the operation is in the RTO20e sync-wait, not still publishing: wait until
    // the proxy log shows the server's ACK (action 1) for the OBJECT publish, then allow
    // a brief real-time yield for the client to move the ACKed operation into the wait.
    await pollUntil(
      async () => {
        const log = await session!.getLog();
        return log.some(
          (event) => event.type === 'ws_frame' && event.direction === 'server_to_client' && event.message?.action === 1,
        )
          ? true
          : null;
      },
      { interval: 200, timeout: 10000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 500));

    // The channel enters FAILED whilst the operation waits for SYNCED (RTO20e1)
    await session.triggerAction({
      type: 'inject_to_client',
      message: {
        action: 9,
        channel: channelName,
        error: { statusCode: 400, code: 90000, message: 'injected error' },
      },
    });

    await waitForChannelState(channel, 'failed', 15000);

    const mutationError = await pendingError;

    expect(mutationError, 'set() should have failed when channel entered FAILED during sync wait').to.not.be.null;
    expect(mutationError.code).to.equal(92008);
    expect(mutationError.statusCode).to.equal(400);
    // RTO20e1: cause is set to RealtimeChannel.errorReason -- the injected channel ERROR
    expect(mutationError.cause).to.exist;
    expect(mutationError.cause.code).to.equal(90000);

    await closeAndWait(client);
  });

  /**
   * RTO5c6, RTO7 - Publish during sync, echo arrives after sync completes
   *
   * The proxy delays the OBJECT_SYNC completion so the client stays in SYNCING.
   * Client A publishes a mutation that arrives as an OBJECT message to client B
   * while B is still syncing. The mutation must be buffered and applied after
   * sync completes.
   */
  // UTS: objects/proxy/RTO5-RTO7/publish-during-sync-echo-after-0
  it('RTO5c6, RTO7 - publish during sync, echo arrives after sync completes', async function () {
    const channelName = uniqueChannelName('objects-publish-during-sync');

    // Client A: direct connection (no proxy), publishes mutations
    const clientA = new Ably.Realtime({
      key: getApiKey(),
      endpoint: 'nonprod:sandbox',
      autoConnect: false,
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(clientA);

    await connectAndWait(clientA);

    const channelA = clientA.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });
    const rootA = await channelA.object.get();

    // Set up initial data
    await rootA.set('existing', 'before');

    // Client B: through proxy with delayed OBJECT_SYNC (action 20)
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: '20' },
          action: { type: 'delay', delayMs: 3000 },
          times: 1,
          comment: 'Delay first OBJECT_SYNC to keep B in SYNCING state',
        },
      ],
    });

    const { keyName, keySecret } = getKeyParts(getApiKey());
    const clientB = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(clientB);

    const channelB = clientB.channels.get(channelName, {
      modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'],
    });

    // Start client B -- will be stuck in SYNCING due to delayed OBJECT_SYNC
    await connectAndWait(clientB);
    channelB.attach();

    // While B is syncing, A publishes a mutation
    await rootA.set('existing', 'after');

    // B's get() will resolve once delayed sync completes
    const rootB = await channelB.object.get();

    // The mutation from A should be visible (either in sync data or buffered OBJECT)
    await pollUntilSuccess(() => (rootB.get('existing').value() === 'after' ? true : null), { timeout: 15000 });

    expect(rootB.get('existing').value()).to.equal('after');

    await closeAndWait(clientA);
    await closeAndWait(clientB);
  });
});
