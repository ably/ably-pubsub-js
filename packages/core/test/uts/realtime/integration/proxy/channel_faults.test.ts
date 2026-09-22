/**
 * UTS Proxy Integration: Channel Fault Tests
 *
 * Spec points: RTL4f, RTL5f, RTL13a, RTL14
 * Source: specification/uts/realtime/integration/proxy/channel_faults.md
 */

import { expect } from 'chai';
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
} from '../sandbox';
import { createProxySession, waitForProxy, ProxySession } from '../helpers/proxy';

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

describe('uts/realtime/integration/proxy/channel_faults', function () {
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
   * RTL4f -- Attach timeout (server doesn't respond)
   *
   * When the proxy suppresses ATTACH messages so the server never sees them,
   * the SDK's attach timer fires and the channel transitions to SUSPENDED.
   */
  // UTS: realtime/proxy/RTL4f/attach-timeout-suppressed-0
  it('RTL4f - attach timeout when ATTACH is suppressed', async function () {
    const channelName = uniqueChannelName('test-RTL4f');

    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_server', action: 'ATTACH', channel: channelName },
          action: { type: 'suppress' },
          comment: 'RTL4f: Suppress ATTACH so server never responds',
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
      realtimeRequestTimeout: 3000,
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName);

    const channelStateChanges: string[] = [];
    channel.on((change: any) => {
      channelStateChanges.push(change.current);
    });

    // Connect through proxy -- connection itself is not faulted
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Start attach -- proxy will suppress the ATTACH, so server never responds
    const attachPromise = channel.attach();

    // Channel should enter ATTACHING immediately
    await waitForChannelState(channel, 'attaching', 5000);

    // Wait for the channel to transition to SUSPENDED after realtimeRequestTimeout
    await waitForChannelState(channel, 'suspended', 15000);

    // The attach() call should have failed with a timeout error
    try {
      await attachPromise;
      expect.fail('attach should have failed');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }

    // Channel transitioned to SUSPENDED
    expect(channel.state).to.equal('suspended');

    // State sequence: ATTACHING -> SUSPENDED
    expect(channelStateChanges).to.include('attaching');
    expect(channelStateChanges).to.include('suspended');
    const attachingIdx = channelStateChanges.indexOf('attaching');
    const suspendedIdx = channelStateChanges.indexOf('suspended');
    expect(attachingIdx).to.be.lessThan(suspendedIdx);

    // Connection remains CONNECTED (attach timeout is channel-scoped)
    expect(client.connection.state).to.equal('connected');

    // Proxy log confirms the ATTACH frames were received but suppressed by the rule.
    // The log records frames before applying rules (ruleMatched indicates which rule fired).
    const log = await session.getLog();
    const attachFrames = log.filter(
      (e: any) =>
        e.type === 'ws_frame' &&
        e.direction === 'client_to_server' &&
        e.message?.action === 10 &&
        e.message?.channel === channelName,
    );
    expect(attachFrames.length).to.be.at.least(1);
    // All ATTACH frames should have been caught by the suppress rule
    for (const frame of attachFrames) {
      expect(frame.ruleMatched).to.not.be.null;
    }

    await closeAndWait(client);
  });

  /**
   * RTL14 -- Server responds with ERROR to ATTACH
   *
   * When the proxy replaces the ATTACHED response with a channel-scoped ERROR,
   * the SDK transitions the channel to FAILED. Connection remains CONNECTED.
   */
  // UTS: realtime/proxy/RTL14/channel-error-goes-failed-1
  it('RTL14 - error on attach causes channel FAILED', async function () {
    const channelName = uniqueChannelName('test-RTL14-error-on-attach');

    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: 'ATTACHED', channel: channelName },
          action: {
            type: 'replace',
            message: {
              action: 9,
              channel: channelName,
              error: { code: 40160, statusCode: 403, message: 'Not permitted' },
            },
          },
          times: 1,
          comment: 'RTL14: Replace ATTACHED with channel ERROR',
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
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName);

    const channelStateChanges: string[] = [];
    channel.on((change: any) => {
      channelStateChanges.push(change.current);
    });

    // Connect through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Attach -- proxy replaces ATTACHED with ERROR
    let attachError: any = null;
    try {
      await channel.attach();
      expect.fail('attach should have failed');
    } catch (err: any) {
      attachError = err;
    }

    // Channel should be in FAILED state
    await waitForChannelState(channel, 'failed', 10000);

    // Channel transitioned to FAILED
    expect(channel.state).to.equal('failed');

    // Error reason matches the injected error
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason.code).to.equal(40160);
    expect(channel.errorReason.statusCode).to.equal(403);

    // The error returned from attach() matches
    expect(attachError).to.not.be.null;
    expect(attachError.code).to.equal(40160);

    // State sequence: ATTACHING -> FAILED
    expect(channelStateChanges).to.include('attaching');
    expect(channelStateChanges).to.include('failed');
    const attachingIdx = channelStateChanges.indexOf('attaching');
    const failedIdx = channelStateChanges.indexOf('failed');
    expect(attachingIdx).to.be.lessThan(failedIdx);

    // Connection remains CONNECTED (channel error does not affect connection)
    expect(client.connection.state).to.equal('connected');

    await closeAndWait(client);
  });

  /**
   * RTL5f -- Detach timeout (server doesn't respond)
   *
   * Two-phase test: first connect and attach normally with no rules,
   * then add a rule suppressing DETACH. The channel should revert to ATTACHED.
   */
  // UTS: realtime/proxy/RTL5f/detach-timeout-suppressed-0
  it('RTL5f - detach timeout reverts channel to attached', async function () {
    const channelName = uniqueChannelName('test-RTL5f');

    // Phase 1: Create proxy session with NO fault rules (clean passthrough)
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
      realtimeRequestTimeout: 3000,
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName);

    const channelStateChanges: string[] = [];
    channel.on((change: any) => {
      channelStateChanges.push(change.current);
    });

    // Phase 1: Connect and attach normally through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Clear state change history from the attach phase
    channelStateChanges.length = 0;

    // Phase 2: Add rule to suppress DETACH messages
    await session.addRules(
      [
        {
          match: { type: 'ws_frame_to_server', action: 'DETACH', channel: channelName },
          action: { type: 'suppress' },
          comment: 'RTL5f: Suppress DETACH so server never responds',
        },
      ],
      'prepend',
    );

    // Phase 3: Try to detach -- proxy suppresses DETACH, so server never sends DETACHED
    const detachPromise = channel.detach();

    // Channel should enter DETACHING
    await waitForChannelState(channel, 'detaching', 5000);

    // Wait for the channel to revert to ATTACHED after realtimeRequestTimeout
    await waitForChannelState(channel, 'attached', 15000);

    // The detach() call should have failed with a timeout error
    try {
      await detachPromise;
      expect.fail('detach should have failed');
    } catch (err: any) {
      expect(err).to.not.be.null;
    }

    // Channel reverted to ATTACHED (previous state)
    expect(channel.state).to.equal('attached');

    // State sequence: DETACHING -> ATTACHED (revert)
    expect(channelStateChanges).to.include('detaching');
    expect(channelStateChanges).to.include('attached');
    const detachingIdx = channelStateChanges.indexOf('detaching');
    const attachedIdx = channelStateChanges.indexOf('attached');
    expect(detachingIdx).to.be.lessThan(attachedIdx);

    // Connection remains CONNECTED
    expect(client.connection.state).to.equal('connected');

    await closeAndWait(client);
  });

  /**
   * RTL13a -- Server sends unsolicited DETACHED, channel re-attaches
   *
   * Connect and attach normally, then inject a DETACHED message via triggerAction.
   * The SDK should automatically re-attach against the real server.
   */
  // UTS: realtime/proxy/RTL13a/unsolicited-detach-reattach-0
  it('RTL13a - unsolicited DETACHED triggers automatic reattach', async function () {
    const channelName = uniqueChannelName('test-RTL13a');

    // Create proxy session with clean passthrough (no fault rules)
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
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName);

    // Connect and attach normally through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Record channel state changes from this point
    const channelStateChanges: string[] = [];
    channel.on((change: any) => {
      channelStateChanges.push(change.current);
    });

    // Inject an unsolicited DETACHED message with error via imperative action
    await session.triggerAction({
      type: 'inject_to_client',
      message: {
        action: 13,
        channel: channelName,
        error: { code: 90198, statusCode: 500, message: 'Channel detached by server' },
      },
    });

    // Channel should transition ATTACHING (reattach) -> ATTACHED (reattach succeeds)
    await waitForChannelState(channel, 'attached', 15000);

    // Channel re-attached successfully
    expect(channel.state).to.equal('attached');

    // State sequence: ATTACHING (with error from DETACHED) -> ATTACHED
    expect(channelStateChanges).to.include('attaching');
    expect(channelStateChanges).to.include('attached');
    const attachingIdx = channelStateChanges.indexOf('attaching');
    const attachedIdx = channelStateChanges.indexOf('attached');
    expect(attachingIdx).to.be.lessThan(attachedIdx);

    // Connection remains CONNECTED throughout
    expect(client.connection.state).to.equal('connected');

    // Proxy log shows the re-attach ATTACH message from the client
    const log = await session.getLog();
    const attachFrames = log.filter(
      (e) =>
        e.type === 'ws_frame' &&
        e.direction === 'client_to_server' &&
        e.message?.action === 10 &&
        e.message?.channel === channelName,
    );
    // At least 2 ATTACH frames: initial attach + reattach after injected DETACHED
    expect(attachFrames.length).to.be.at.least(2);

    await closeAndWait(client);
  });

  /**
   * RTL14 -- Server sends channel ERROR to attached channel
   *
   * Connect and attach normally, then inject a channel-scoped ERROR via triggerAction.
   * The channel should transition to FAILED. Connection remains CONNECTED.
   */
  // UTS: realtime/proxy/RTL14/error-on-attach-0
  it('RTL14 - injected channel ERROR causes FAILED', async function () {
    const channelName = uniqueChannelName('test-RTL14');

    // Create proxy session with clean passthrough
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
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName);

    // Connect and attach normally through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Record channel state changes from this point
    const channelStateChanges: string[] = [];
    channel.on((change: any) => {
      channelStateChanges.push(change.current);
    });

    // Inject a channel-scoped ERROR message via imperative action
    await session.triggerAction({
      type: 'inject_to_client',
      message: {
        action: 9,
        channel: channelName,
        error: { code: 40160, statusCode: 403, message: 'Not permitted' },
      },
    });

    // Channel should transition to FAILED
    await waitForChannelState(channel, 'failed', 10000);

    // Channel transitioned to FAILED
    expect(channel.state).to.equal('failed');

    // errorReason is set from the injected ERROR
    expect(channel.errorReason).to.not.be.null;
    expect(channel.errorReason.code).to.equal(40160);
    expect(channel.errorReason.statusCode).to.equal(403);
    expect(channel.errorReason.message).to.include('Not permitted');

    // State change event shows only FAILED (from ATTACHED)
    expect(channelStateChanges).to.deep.equal(['failed']);

    // Connection remains CONNECTED (channel-scoped ERROR does not close connection)
    expect(client.connection.state).to.equal('connected');

    await closeAndWait(client);
  });

  /**
   * RTL12 -- ATTACHED with resumed=false on already-attached channel
   *
   * When the server sends an ATTACHED message for a channel that is already attached
   * with resumed=false, the SDK emits an 'update' event (not 'attached') per RTL2g.
   */
  // UTS: realtime/proxy/RTL12/attached-non-resumed-update-0
  it('RTL12 - ATTACHED with resumed=false emits UPDATE not ATTACHED', async function () {
    const channelName = uniqueChannelName('test-RTL12');

    // Create proxy session with no rules (passthrough)
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
    } as any);
    trackClient(client);

    const channel = client.channels.get(channelName);

    // Connect and attach normally through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    await channel.attach();
    expect(channel.state).to.equal('attached');

    // Listen for 'update' and 'attached' events separately
    const updateEvents: any[] = [];
    const attachedEvents: any[] = [];
    channel.on('update', (change: any) => {
      updateEvents.push(change);
    });
    channel.on('attached', (change: any) => {
      attachedEvents.push(change);
    });

    // Inject an ATTACHED message with resumed=false (flags: 0) and an error
    await session.triggerAction({
      type: 'inject_to_client',
      message: {
        action: 11,
        channel: channelName,
        flags: 0,
        error: { code: 91001, statusCode: 500, message: 'Continuity lost' },
      },
    });

    // Poll until the update event arrives
    await pollUntil(() => updateEvents.length >= 1, { timeout: 10000 });

    // Exactly one 'update' event emitted
    expect(updateEvents.length).to.equal(1);
    expect(updateEvents[0].current).to.equal('attached');
    expect(updateEvents[0].previous).to.equal('attached');
    expect(updateEvents[0].resumed).to.equal(false);
    expect(updateEvents[0].reason.code).to.equal(91001);
    expect(updateEvents[0].reason.statusCode).to.equal(500);

    // No 'attached' event emitted (RTL2g: update, not attached)
    expect(attachedEvents.length).to.equal(0);

    // Channel remains attached, connection remains connected
    expect(channel.state).to.equal('attached');
    expect(client.connection.state).to.equal('connected');

    await closeAndWait(client);
  });

  /**
   * RTL3d -- Channels reattach after connection recovery
   *
   * After a transport disconnect, the SDK reconnects and automatically
   * reattaches all previously-attached channels.
   */
  // UTS: realtime/proxy/RTL3d/channels-reattach-on-reconnect-0
  it('RTL3d - channels reattach after connection recovery', async function () {
    const channelNameA = uniqueChannelName('test-RTL3d-a');
    const channelNameB = uniqueChannelName('test-RTL3d-b');

    // Create proxy session with no rules (passthrough)
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
    } as any);
    trackClient(client);

    const channelA = client.channels.get(channelNameA);
    const channelB = client.channels.get(channelNameB);

    // Connect and attach both channels normally through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    await channelA.attach();
    await channelB.attach();
    expect(channelA.state).to.equal('attached');
    expect(channelB.state).to.equal('attached');

    // Record channel state changes from this point (clear any initial states)
    const channelAStateChanges: string[] = [];
    const channelBStateChanges: string[] = [];
    channelA.on((change: any) => {
      channelAStateChanges.push(change.current);
    });
    channelB.on((change: any) => {
      channelBStateChanges.push(change.current);
    });

    // Trigger a transport disconnect via WebSocket close frame
    await session.triggerAction({
      type: 'close',
    });

    // Wait for connection to go disconnected first, then reconnect
    await waitForState(client, 'disconnected', 15000);
    await waitForState(client, 'connected', 30000);

    // Wait for both channels to reach 'attached' state after recovery
    await waitForChannelState(channelA, 'attached', 15000);
    await waitForChannelState(channelB, 'attached', 15000);

    // Both channels are in 'attached' state
    expect(channelA.state).to.equal('attached');
    expect(channelB.state).to.equal('attached');

    // Both channel state change arrays include 'attaching' followed by 'attached'
    expect(channelAStateChanges).to.include('attaching');
    expect(channelAStateChanges).to.include('attached');
    const aAttachingIdx = channelAStateChanges.indexOf('attaching');
    const aAttachedIdx = channelAStateChanges.indexOf('attached');
    expect(aAttachingIdx).to.be.lessThan(aAttachedIdx);

    expect(channelBStateChanges).to.include('attaching');
    expect(channelBStateChanges).to.include('attached');
    const bAttachingIdx = channelBStateChanges.indexOf('attaching');
    const bAttachedIdx = channelBStateChanges.indexOf('attached');
    expect(bAttachingIdx).to.be.lessThan(bAttachedIdx);

    // Connection is connected
    expect(client.connection.state).to.equal('connected');

    // Proxy log shows at least 2 ATTACH frames for each channel (initial + reattach)
    const log = await session.getLog();
    const attachFramesA = log.filter(
      (e) =>
        e.type === 'ws_frame' &&
        e.direction === 'client_to_server' &&
        e.message?.action === 10 &&
        e.message?.channel === channelNameA,
    );
    const attachFramesB = log.filter(
      (e) =>
        e.type === 'ws_frame' &&
        e.direction === 'client_to_server' &&
        e.message?.action === 10 &&
        e.message?.channel === channelNameB,
    );
    expect(attachFramesA.length).to.be.at.least(2);
    expect(attachFramesB.length).to.be.at.least(2);

    await closeAndWait(client);
  });
});
