/**
 * UTS Proxy Integration: Presence Re-entry Tests
 *
 * Spec points: RTP17i, RTP17g
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

describe('uts/realtime/integration/proxy/presence_reentry', function () {
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
   * RTP17i/RTP17g — Automatic presence re-enter on non-resumed reattach
   *
   * When a channel receives an ATTACHED message without the RESUMED flag after
   * already being attached, the SDK should automatically re-enter any presence
   * members that were previously entered on that channel.
   *
   * We verify this by injecting a non-resumed ATTACHED via the proxy and checking
   * the proxy log for a PRESENCE ENTER frame sent by the SDK afterward. The server
   * won't broadcast the re-enter to other subscribers (since from the server's
   * perspective the member never left), so we verify the SDK's behavior via the
   * proxy log rather than via a second client.
   */
  // UTS: realtime/proxy/RTP17i/reenter-on-non-resumed-0
  it('RTP17i/RTP17g - automatic presence re-enter on non-resumed reattach', async function () {
    const channelName = uniqueChannelName('test-rtp17i');

    session = await createProxySession({});

    const { keyName, keySecret } = getKeyParts(getApiKey());
    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret, clientId: 'client-a' }));
      },
      endpoint: 'localhost',
      port: session!.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
    } as any);
    trackClient(client);

    client.connect();
    await waitForState(client, 'connected', 15000);

    const channel = client.channels.get(channelName);
    await channel.attach();
    await channel.presence.enter('hello');

    // Count PRESENCE frames before the injection
    const logBefore = await session!.getLog();
    const presenceFramesBefore = logBefore.filter(
      (e: any) => e.type === 'ws_frame' && e.direction === 'client_to_server' && e.message?.action === 14,
    ).length;

    // Inject ATTACHED without RESUMED flag — triggers RTP17i re-entry
    await session!.triggerAction({
      type: 'inject_to_client',
      message: {
        action: 11,
        channel: channelName,
        flags: 0,
        error: { code: 91001, statusCode: 500, message: 'Continuity lost' },
      },
    });

    // Wait for the SDK to process the ATTACHED and send the re-enter
    await pollUntil(
      async () => {
        const log = await session!.getLog();
        const presenceFrames = log.filter(
          (e: any) => e.type === 'ws_frame' && e.direction === 'client_to_server' && e.message?.action === 14,
        );
        return presenceFrames.length > presenceFramesBefore;
      },
      { interval: 200, timeout: 10000 },
    );

    // Get final log and verify
    const logAfter = await session!.getLog();
    const allPresenceFrames = logAfter.filter(
      (e: any) => e.type === 'ws_frame' && e.direction === 'client_to_server' && e.message?.action === 14,
    );

    // At least one new PRESENCE frame was sent after the injection
    expect(allPresenceFrames.length).to.be.greaterThan(presenceFramesBefore);

    // The re-enter PRESENCE frame should contain the presence data
    const reenterFrame = allPresenceFrames[allPresenceFrames.length - 1];
    expect(reenterFrame.message.presence).to.exist;
    expect(reenterFrame.message.presence.length).to.be.at.least(1);

    const reenterMsg = reenterFrame.message.presence[0];
    expect(reenterMsg.clientId).to.equal('client-a');
    expect(reenterMsg.data).to.equal('hello');
    // RTP17g: action should be ENTER (action=2)
    expect(reenterMsg.action).to.equal(2);

    // Channel should still be attached
    expect(channel.state).to.equal('attached');

    // Connection should still be connected
    expect(client.connection.state).to.equal('connected');

    await closeAndWait(client);
  });

  /**
   * RTP17i via real disconnect — Presence re-enter after connection loss
   *
   * Client enters presence, then the proxy closes the WebSocket via a temporal
   * trigger. On reconnection, the proxy replaces the 2nd ATTACHED with a
   * non-resumed one (simulating channel state loss). The SDK should re-enter
   * presence. We verify via proxy log that the PRESENCE ENTER was sent.
   */
  // UTS: realtime/proxy/RTP17i/reenter-after-disconnect-1
  it('RTP17i - presence re-enter after real disconnect', async function () {
    const channelName = uniqueChannelName('test-rtp17i-real');

    // Two rules:
    // 1. Close the WebSocket 3s after connect (giving time to attach + enter presence)
    // 2. Replace the 2nd ATTACHED on the channel with a non-resumed one
    session = await createProxySession({
      rules: [
        {
          match: { type: 'delay_after_ws_connect', delayMs: 3000 },
          action: { type: 'close' },
          times: 1,
          comment: 'RTP17i: Close WebSocket after 3s to trigger reconnect',
        },
        {
          match: { type: 'ws_frame_to_client', action: 'ATTACHED', channel: channelName, count: 2 },
          action: {
            type: 'replace',
            message: {
              action: 11,
              channel: channelName,
              flags: 0,
              error: { code: 91001, statusCode: 500, message: 'Continuity lost' },
            },
          },
          times: 1,
          comment: 'RTP17i: Replace 2nd ATTACHED with non-resumed to trigger re-entry',
        },
      ],
    });

    const { keyName, keySecret } = getKeyParts(getApiKey());

    const clientA = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret, clientId: 'client-a' }));
      },
      endpoint: 'localhost',
      port: session!.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
    } as any);
    trackClient(clientA);

    clientA.connect();
    await waitForState(clientA, 'connected', 15000);

    const channelA = clientA.channels.get(channelName);
    await channelA.attach();
    await channelA.presence.enter('hello');

    // The temporal trigger will close the WebSocket at T+3s.
    // Wait for disconnect and reconnect.
    await waitForState(clientA, 'disconnected', 10000);
    await waitForState(clientA, 'connected', 15000);

    // Wait for the channel to reattach (the 2nd ATTACHED will be replaced with non-resumed)
    await waitForChannelState(channelA, 'attached', 15000);

    // After reconnection with non-resumed ATTACHED, the SDK should re-enter presence.
    // Verify via proxy log: a PRESENCE frame from client after the 2nd ws_connect.
    await pollUntil(
      async () => {
        const log = await session!.getLog();
        const wsConnects = log.filter((e: any) => e.type === 'ws_connect');
        if (wsConnects.length < 2) return false;
        const secondConnectTime = wsConnects[1].timestamp;
        const presenceAfterReconnect = log.filter(
          (e: any) =>
            e.type === 'ws_frame' &&
            e.direction === 'client_to_server' &&
            e.message?.action === 14 &&
            e.timestamp > secondConnectTime,
        );
        return presenceAfterReconnect.length > 0;
      },
      { interval: 200, timeout: 10000 },
    );

    // Verify the re-enter frame details
    const log = await session!.getLog();
    const wsConnects = log.filter((e: any) => e.type === 'ws_connect');
    const secondConnectTime = wsConnects[1].timestamp;
    const reenterFrames = log.filter(
      (e: any) =>
        e.type === 'ws_frame' &&
        e.direction === 'client_to_server' &&
        e.message?.action === 14 &&
        e.timestamp > secondConnectTime,
    );

    expect(reenterFrames.length).to.be.at.least(1);
    const reenterFrame = reenterFrames[0];
    expect(reenterFrame.message.presence).to.exist;
    expect(reenterFrame.message.presence.length).to.be.at.least(1);

    const reenterMsg = reenterFrame.message.presence[0];
    expect(reenterMsg.clientId).to.equal('client-a');
    expect(reenterMsg.data).to.equal('hello');
    expect(reenterMsg.action).to.equal(2); // ENTER

    // Channel is still attached, connection is connected
    expect(channelA.state).to.equal('attached');
    expect(clientA.connection.state).to.equal('connected');

    await closeAndWait(clientA);
  });
});
