/**
 * UTS Proxy Integration: Connection Resume and Recovery Tests
 *
 * Spec points: RTN14h, RTN15a, RTN15b, RTN15c6, RTN15c7, RTN15h1, RTN15h3, RTN15j, RTN19a, RTN19a2, RTN16d, RTN16k, RTN16l
 * Source: specification/uts/realtime/integration/proxy/connection_resume.md
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
  pollUntil,
  uniqueChannelName,
  SANDBOX_ENDPOINT,
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

describe('uts/realtime/integration/proxy/connection_resume', function () {
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
   * RTN15a — Unexpected disconnect triggers resume
   *
   * Proxy passthrough, then imperative disconnect. Verify state sequence
   * (disconnected -> connecting -> connected) and that the 2nd ws_connect
   * has a `resume` query parameter.
   */
  // UTS: realtime/proxy/RTN15a/disconnect-triggers-resume-0
  it('RTN15a - unexpected disconnect triggers resume', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'delay_after_ws_connect', delayMs: 1000 },
          action: { type: 'close' },
          times: 1,
          comment: 'RTN15a: Close WebSocket after 1s to trigger unexpected disconnect',
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

    // Record state changes before connecting
    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    // Connect through proxy — proxy will close WebSocket after 1s
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Wait for disconnected (triggered by temporal close), then reconnected
    await waitForState(client, 'disconnected', 10000);
    await waitForState(client, 'connected', 15000);

    // State changes should include disconnected -> connecting -> connected (after initial connect)
    expect(stateChanges).to.include('disconnected');
    const disconnectedIdx = stateChanges.indexOf('disconnected');
    const reconnectingIdx = stateChanges.indexOf('connecting', disconnectedIdx);
    const reconnectedIdx = stateChanges.indexOf('connected', reconnectingIdx);
    expect(reconnectingIdx).to.be.greaterThan(disconnectedIdx);
    expect(reconnectedIdx).to.be.greaterThan(reconnectingIdx);

    // Verify resume was attempted via proxy log
    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(2);

    // Second WebSocket connection should include resume query parameter
    expect(wsConnects[1].queryParams).to.exist;
    expect(wsConnects[1].queryParams!['resume']).to.exist;

    await closeAndWait(client);
  });

  /**
   * RTN15a — Unexpected disconnect triggers resume (TCP close without close frame)
   *
   * Same as the test above, but the proxy closes the underlying TCP connection
   * without sending a WebSocket close frame. The Node.js ws library detects
   * the TCP FIN and fires its close event, so ably-js should transition to
   * disconnected with minimal delay — identical to the close-frame case.
   */
  // UTS: realtime/proxy/RTN15a/tcp-close-triggers-resume-1
  it('RTN15a - unexpected disconnect triggers resume (TCP close without close frame)', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'delay_after_ws_connect', delayMs: 1000 },
          action: { type: 'disconnect' },
          times: 1,
          comment: 'RTN15a: Close TCP connection (no close frame) after 1s to trigger unexpected disconnect',
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

    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await waitForState(client, 'connected', 15000);

    await waitForState(client, 'disconnected', 10000);
    await waitForState(client, 'connected', 15000);

    expect(stateChanges).to.include('disconnected');
    const disconnectedIdx = stateChanges.indexOf('disconnected');
    const reconnectingIdx = stateChanges.indexOf('connecting', disconnectedIdx);
    const reconnectedIdx = stateChanges.indexOf('connected', reconnectingIdx);
    expect(reconnectingIdx).to.be.greaterThan(disconnectedIdx);
    expect(reconnectedIdx).to.be.greaterThan(reconnectingIdx);

    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(2);

    expect(wsConnects[1].queryParams).to.exist;
    expect(wsConnects[1].queryParams!['resume']).to.exist;

    await closeAndWait(client);
  });

  /**
   * RTN15b, RTN15c6 — Resume preserves connectionId
   *
   * After unexpected disconnect and successful resume, the connection ID
   * remains the same and the resume query parameter contains the connection key.
   */
  // UTS: realtime/proxy/RTN15b/resume-preserves-connid-0
  it('RTN15b/RTN15c6 - resume preserves connectionId', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'delay_after_ws_connect', delayMs: 1000 },
          action: { type: 'close' },
          times: 1,
          comment: 'RTN15b: Close WebSocket after 1s to trigger disconnect',
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

    // Connect through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Record connection identity before disconnect
    const originalConnectionId = client.connection.id;
    const originalConnectionKey = client.connection.key;
    expect(originalConnectionId).to.exist;
    expect(originalConnectionKey).to.exist;

    // Temporal trigger closes WebSocket after 1s — wait for disconnect, then reconnect
    await waitForState(client, 'disconnected', 10000);
    await waitForState(client, 'connected', 15000);

    // RTN15c6: Connection ID is preserved (successful resume)
    expect(client.connection.id).to.equal(originalConnectionId);

    // RTN15b: Second ws_connect URL includes resume={connectionKey}
    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(2);
    expect(wsConnects[1].queryParams).to.exist;
    expect(wsConnects[1].queryParams!['resume']).to.equal(originalConnectionKey);

    // No error reason on successful resume
    expect(client.connection.errorReason).to.be.null;

    await closeAndWait(client);
  });

  /**
   * RTN15c7 — Failed resume gets new connectionId
   *
   * Proxy replaces the 2nd CONNECTED (the resume response) with one containing
   * a different connectionId and error code 80008. SDK should accept the new
   * connection identity and expose the error.
   */
  // UTS: realtime/proxy/RTN15c7/failed-resume-new-connid-0
  it('RTN15c7 - failed resume gets new connectionId', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'delay_after_ws_connect', delayMs: 1000 },
          action: { type: 'close' },
          times: 1,
          comment: 'RTN15c7: Close WebSocket after 1s to trigger disconnect',
        },
        {
          match: { type: 'ws_frame_to_client', action: 'CONNECTED', count: 2 },
          action: {
            type: 'replace',
            message: {
              action: 4,
              connectionId: 'proxy-injected-new-id',
              connectionKey: 'proxy-injected-new-key',
              connectionDetails: {
                connectionKey: 'proxy-injected-new-key',
                clientId: null,
                maxMessageSize: 65536,
                maxInboundRate: 250,
                maxOutboundRate: 100,
                maxFrameSize: 524288,
                serverId: 'test-server',
                connectionStateTtl: 120000,
                maxIdleInterval: 15000,
              },
              error: {
                code: 80008,
                statusCode: 400,
                message: 'Unable to recover connection',
              },
            },
          },
          times: 1,
          comment: 'RTN15c7: Replace 2nd CONNECTED with failed resume (different connectionId + error 80008)',
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

    // Connect through proxy — first CONNECTED passes through normally
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Record original identity
    const originalConnectionId = client.connection.id;
    expect(originalConnectionId).to.exist;
    expect(originalConnectionId).to.not.equal('proxy-injected-new-id');

    // Temporal trigger closes WebSocket after 1s — SDK will attempt resume
    // Proxy replaces the CONNECTED response with a new connectionId
    await waitForState(client, 'disconnected', 10000);
    await waitForState(client, 'connected', 15000);

    // RTN15c7: Connection ID changed (resume failed, got new connection)
    expect(client.connection.id).to.equal('proxy-injected-new-id');
    expect(client.connection.id).to.not.equal(originalConnectionId);

    // Connection key updated to the new one
    expect(client.connection.key).to.equal('proxy-injected-new-key');

    // Error reason is set indicating why resume failed
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(80008);

    // Connection is still CONNECTED (not FAILED — the server gave a new connection)
    expect(client.connection.state).to.equal('connected');

    // Verify resume was attempted in the proxy log
    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(2);
    expect(wsConnects[1].queryParams).to.exist;
    expect(wsConnects[1].queryParams!['resume']).to.exist;

    await closeAndWait(client);
  });

  /**
   * RTN15h1 — DISCONNECTED with token error + non-renewable token -> FAILED
   *
   * Proxy injects DISCONNECTED with error 40142 after 1s and closes the socket.
   * Client is configured with a token string only (no key, no authCallback)
   * so it cannot renew. SDK should transition to FAILED.
   */
  // UTS: realtime/proxy/RTN15h1/token-error-nonrenewable-failed-0
  it('RTN15h1 - DISCONNECTED with token error and non-renewable token causes FAILED', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'delay_after_ws_connect', delayMs: 1000 },
          action: {
            type: 'inject_to_client_and_close',
            message: {
              action: 6,
              error: {
                code: 40142,
                statusCode: 401,
                message: 'Token expired',
              },
            },
          },
          times: 1,
          comment: 'RTN15h1: Inject DISCONNECTED with token error (40142) after 1s',
        },
      ],
    });

    // Provision a real token from the sandbox so the initial connection succeeds
    const restClient = new Ably.Rest({ key: getApiKey(), endpoint: SANDBOX_ENDPOINT } as any);
    const tokenDetails = await restClient.auth.requestToken();

    // Use only the token string — no key, no authCallback — making it non-renewable
    const client = new Ably.Realtime({
      token: tokenDetails.token,
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
    } as any);
    trackClient(client);

    // Connect through proxy — initial connection succeeds with the real token
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Record state changes
    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    // After 1s the proxy injects DISCONNECTED with 40142 and closes the socket.
    // The SDK has a non-renewable token, so it cannot renew -> FAILED.
    await waitForState(client, 'failed', 15000);

    // RTN15h1: Ended in FAILED state
    expect(client.connection.state).to.equal('failed');

    // Error reason reflects the non-renewable token condition — ably-js reports
    // 40171 ("Token not renewable") rather than the original 40142 because the SDK
    // detects it has no means to renew (no key, no authCallback, no authUrl)
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(40171);

    // State changes should show the transition to FAILED
    expect(stateChanges).to.include('failed');

    // No need to close — already in FAILED state
  });

  /**
   * RTN15h3 — DISCONNECTED with non-token error triggers reconnect
   *
   * Proxy injects DISCONNECTED with error 80003 after 1s and closes the socket.
   * Rule fires once, so the reconnection attempt passes through cleanly.
   * SDK should reconnect and resume rather than transitioning to FAILED.
   */
  // UTS: realtime/proxy/RTN15h3/non-token-error-reconnects-0
  it('RTN15h3 - DISCONNECTED with non-token error triggers reconnect', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'delay_after_ws_connect', delayMs: 1000 },
          action: {
            type: 'inject_to_client_and_close',
            message: {
              action: 6,
              error: {
                code: 80003,
                statusCode: 500,
                message: 'Service temporarily unavailable',
              },
            },
          },
          times: 1,
          comment: 'RTN15h3: Inject DISCONNECTED with non-token error (80003) after 1s, once only',
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

    // Connect through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Record state changes
    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    // After 1s the proxy injects DISCONNECTED with non-token error and closes.
    // The rule fires once, so the reconnection attempt passes through to the real server.

    // Wait for DISCONNECTED (from the injected message)
    await waitForState(client, 'disconnected', 10000);

    // SDK should automatically reconnect
    await waitForState(client, 'connected', 15000);

    // RTN15h3: SDK reconnected successfully (not FAILED)
    expect(client.connection.state).to.equal('connected');

    // State changes should show: disconnected -> connecting -> connected
    expect(stateChanges).to.include('disconnected');
    expect(stateChanges).to.include('connecting');
    expect(stateChanges).to.include('connected');
    const disconnectedIdx = stateChanges.indexOf('disconnected');
    const connectingIdx = stateChanges.indexOf('connecting');
    const connectedIdx = stateChanges.indexOf('connected');
    expect(disconnectedIdx).to.be.lessThan(connectingIdx);
    expect(connectingIdx).to.be.lessThan(connectedIdx);

    // Verify resume was attempted
    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(2);
    expect(wsConnects[1].queryParams).to.exist;
    expect(wsConnects[1].queryParams!['resume']).to.exist;

    // No error reason after successful reconnection
    expect(client.connection.errorReason).to.be.null;

    await closeAndWait(client);
  });

  /**
   * RTN15j — Fatal ERROR on established connection
   *
   * Inject a connection-level ERROR (action 9) with a fatal error code.
   * SDK should transition to FAILED and all attached channels should also
   * transition to FAILED with the same error.
   */
  // UTS: realtime/proxy/RTN15j/fatal-error-established-conn-0
  it('RTN15j - fatal ERROR on established connection causes FAILED and channels FAILED', async function () {
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

    // Connect through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Attach two channels
    const channelNameA = uniqueChannelName('test-fatal-error-a');
    const channelNameB = uniqueChannelName('test-fatal-error-b');
    const channelA = client.channels.get(channelNameA);
    const channelB = client.channels.get(channelNameB);

    channelA.attach();
    channelB.attach();
    await Promise.all([
      waitForChannelState(channelA, 'attached', 15000),
      waitForChannelState(channelB, 'attached', 15000),
    ]);

    // Record state changes for connection and both channels
    const connectionStateChanges: string[] = [];
    const channelAStateChanges: string[] = [];
    const channelBStateChanges: string[] = [];

    client.connection.on((change: any) => {
      connectionStateChanges.push(change.current);
    });
    channelA.on((change: any) => {
      channelAStateChanges.push(change.current);
    });
    channelB.on((change: any) => {
      channelBStateChanges.push(change.current);
    });

    // Inject a connection-level ERROR (action 9) with a fatal error code
    // No channel field — this is a connection-level error
    await session.triggerAction({
      type: 'inject_to_client',
      message: {
        action: 9,
        error: {
          code: 50000,
          statusCode: 500,
          message: 'Internal server error',
        },
      },
    });

    // Wait for connection to reach FAILED
    await waitForState(client, 'failed', 15000);

    // Connection is in FAILED state
    expect(client.connection.state).to.equal('failed');

    // Connection error reason reflects the injected error
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(50000);
    expect(client.connection.errorReason!.statusCode).to.equal(500);

    // Both channels should be in FAILED state
    expect(channelA.state).to.equal('failed');
    expect(channelB.state).to.equal('failed');

    // Both channels should have the same error
    expect(channelA.errorReason).to.not.be.null;
    expect(channelA.errorReason.code).to.equal(50000);
    expect(channelB.errorReason).to.not.be.null;
    expect(channelB.errorReason.code).to.equal(50000);

    // State changes include 'failed' for connection and both channels
    expect(connectionStateChanges).to.include('failed');
    expect(channelAStateChanges).to.include('failed');
    expect(channelBStateChanges).to.include('failed');

    // Proxy log should show exactly 1 ws_connect (no reconnection attempt)
    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects).to.have.length(1);
  });

  /**
   * RTN14h — reconnection still attempts resume after connectionStateTtl expiry
   *
   * As of specification version 6.1.0 this replaces RTN15g (deleted). The
   * client no longer clears its connection state based on how long it has been
   * disconnected: it always attempts to resume and lets the server decide
   * whether continuity can be preserved. The reconnection made after the TTL
   * has expired and the connection has become SUSPENDED still carries the
   * resume param. (The real server will have discarded the connection state by
   * then, so the resume fails server-side and the client gets a new
   * connectionId — but the client still attempts the resume.)
   */
  // UTS: realtime/proxy/RTN14h/resume-after-ttl-expiry-0
  it('RTN14h - reconnection still attempts resume after connectionStateTtl expiry', async function () {
    // Strategy: replace the first CONNECTED with connectionStateTtl=2000ms,
    // then close the WebSocket after 1s. The SDK immediately retries (since it
    // was connected), but we refuse the 2nd ws_connect so the SDK stays in
    // disconnected. After the connectionStateTtl (2s) expires, the SDK enters
    // SUSPENDED. The 3rd ws_connect (after suspended retry) still attempts a
    // resume, so it carries the resume param.
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: 'CONNECTED', count: 1 },
          action: {
            type: 'replace',
            message: {
              action: 4,
              connectionId: 'proxy-ttl-test-id',
              connectionKey: 'proxy-ttl-test-key',
              connectionDetails: {
                connectionKey: 'proxy-ttl-test-key',
                clientId: null,
                maxMessageSize: 65536,
                maxInboundRate: 250,
                maxOutboundRate: 100,
                maxFrameSize: 524288,
                serverId: 'test-server',
                connectionStateTtl: 2000,
                maxIdleInterval: 15000,
              },
            },
          },
          times: 1,
          comment: 'RTN14h: Replace 1st CONNECTED with short connectionStateTtl (2s)',
        },
        {
          match: { type: 'delay_after_ws_connect', delayMs: 1000 },
          action: { type: 'close' },
          times: 1,
          comment: 'RTN14h: Close WebSocket after 1s to trigger disconnect',
        },
        {
          match: { type: 'ws_connect', count: 2 },
          action: { type: 'refuse_connection' },
          times: 1,
          comment: 'RTN14h: Refuse 2nd connection so SDK stays in disconnected until TTL expires',
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
      suspendedRetryTimeout: 1000,
    } as any);
    trackClient(client);

    // Connect through proxy — first CONNECTED is replaced with short TTLs
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Record the connection ID from the replaced CONNECTED
    const originalConnectionId = client.connection.id;
    expect(originalConnectionId).to.equal('proxy-ttl-test-id');

    // T=1: proxy closes WebSocket → SDK enters DISCONNECTED, retries immediately
    // T=1: 2nd ws_connect is refused → SDK stays in DISCONNECTED
    // T=3: connectionStateTtl (2s) expires → SDK enters SUSPENDED
    // T=4: suspendedRetryTimeout (1s) fires → SDK reconnects, still attempting a
    //      resume; the server has discarded the state so it responds with a new
    //      connectionId
    await waitForState(client, 'suspended', 15000);

    // Wait for the reconnection
    await waitForState(client, 'connected', 15000);

    // The server discarded the connection state, so the resume failed
    // server-side and the connectionId changed
    expect(client.connection.id).to.not.equal(originalConnectionId);

    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    // At least 3: initial, refused retry (with resume), reconnect from suspended (with resume)
    expect(wsConnects.length).to.be.at.least(3);

    // 1st ws_connect: initial connection, no resume
    expect(wsConnects[0].queryParams == null || wsConnects[0].queryParams!['resume'] == null).to.be.true;

    // RTN14h: the reconnection made after the TTL expired and the connection
    // became suspended still attempts a resume, so it carries the resume param
    const lastConnect = wsConnects[wsConnects.length - 1];
    expect(lastConnect.queryParams?.['resume']).to.equal('proxy-ttl-test-key');

    await closeAndWait(client);
  });

  /**
   * RTN19a/a2 — Unacked messages resent on new transport after resume
   *
   * Proxy suppresses the first ACK so the client's publish is left unacked.
   * After disconnect and resume, the SDK should resend the MESSAGE on the
   * new transport and the publish should eventually resolve successfully.
   */
  // UTS: realtime/proxy/RTN19a/unacked-resent-on-resume-0
  it('RTN19a/a2 - unacked messages resent on new transport after resume', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: 'ACK', count: 1 },
          action: { type: 'suppress' },
          times: 1,
          comment: 'RTN19a: Suppress the first ACK so the MESSAGE remains unacked',
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

    // Connect through proxy
    client.connect();
    await waitForState(client, 'connected', 15000);

    // Attach a channel
    const channelName = uniqueChannelName('test-rtn19a-resend');
    const channel = client.channels.get(channelName);
    channel.attach();
    await waitForChannelState(channel, 'attached', 15000);

    // Start publish but don't await — the ACK will be suppressed
    const publishPromise = channel.publish('event', 'test-data');

    // Wait until the proxy log shows the MESSAGE was sent and its ACK suppressed
    await pollUntil(
      async () => {
        const log = await session!.getLog();
        const messageFrames = log.filter(
          (e) => e.type === 'ws_frame' && e.direction === 'client_to_server' && e.message?.action === 15,
        );
        const suppressedAcks = log.filter(
          (e) =>
            e.type === 'ws_frame' && e.direction === 'server_to_client' && e.message?.action === 1 && e.ruleMatched,
        );
        return messageFrames.length > 0 && suppressedAcks.length > 0;
      },
      { interval: 100, timeout: 10000 },
    );

    // Now close the WebSocket — SDK will attempt resume with the unacked message
    await session.triggerAction({ type: 'close' });

    // Wait for disconnected, then reconnected via resume
    await waitForState(client, 'disconnected', 10000);
    await waitForState(client, 'connected', 15000);

    // Await the publish — should resolve successfully after resend on new transport
    await publishPromise;

    // Verify resume was attempted
    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(2);
    expect(wsConnects[1].queryParams).to.exist;
    expect(wsConnects[1].queryParams!['resume']).to.exist;

    // Verify MESSAGE frames were sent at least twice (original + resend)
    const messageFrames = log.filter(
      (e) => e.type === 'ws_frame' && e.direction === 'client_to_server' && e.message?.action === 15,
    );
    expect(messageFrames.length).to.be.at.least(2);

    await closeAndWait(client);
  });

  /**
   * RTN16d, RTN16k — Successful recovery preserves connectionId and updates connectionKey
   *
   * Phase 1: Connect through proxy, attach a channel, get recoveryKey, then
   * forcibly close the transport (server keeps connection state alive).
   * Phase 2: Create a NEW client with `recover: recoveryKey`, connect through
   * a second proxy session.
   * Verify: connectionId same, connectionKey updated, recover param in log.
   */
  // UTS: realtime/proxy/RTN16d/recovery-preserves-connid-0
  it('RTN16d/RTN16k - successful recovery preserves connectionId and updates connectionKey', async function () {
    // --- Phase 1: Establish initial connection and obtain recovery key ---
    const session1 = await createProxySession({
      rules: [],
    });

    const { keyName, keySecret } = getKeyParts(getApiKey());
    const client1 = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session1.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
    } as any);
    trackClient(client1);

    client1.connect();
    await waitForState(client1, 'connected', 15000);

    const originalConnectionId = client1.connection.id;
    const originalConnectionKey = client1.connection.key;
    expect(originalConnectionId).to.exist;
    expect(originalConnectionKey).to.exist;

    // Attach a channel so it appears in the recovery key
    const channelName = uniqueChannelName('recovery-test');
    const channel1 = client1.channels.get(channelName);
    channel1.attach();
    await waitForChannelState(channel1, 'attached', 15000);

    // Get the recovery key
    const recoveryKey = client1.connection.createRecoveryKey();
    expect(recoveryKey).to.not.be.null;

    // Forcibly close the WebSocket transport (server keeps connection state alive)
    await session1.triggerAction({ type: 'close' });

    // Wait for the client to detect the disconnect
    await waitForState(client1, 'disconnected', 10000);

    // Close client1 without allowing it to reconnect
    client1.connection.close();
    await waitForState(client1, 'closed', 10000);
    await session1.close();

    // --- Phase 2: Recover using the recovery key ---
    session = await createProxySession({
      rules: [],
    });

    const client2 = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
      recover: recoveryKey,
    } as any);
    trackClient(client2);

    client2.connect();
    await waitForState(client2, 'connected', 15000);

    // RTN16d: Connection ID is preserved (same as original connection)
    expect(client2.connection.id).to.equal(originalConnectionId);

    // RTN16d: Connection key is updated (new key from server)
    expect(client2.connection.key).to.exist;
    expect(client2.connection.key).to.not.equal(originalConnectionKey);

    // RTN16k: Verify the recover query parameter was sent via proxy log
    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(1);
    expect(wsConnects[0].queryParams).to.exist;
    expect(wsConnects[0].queryParams!['recover']).to.equal(originalConnectionKey);

    // No resume param (this is recovery, not resume)
    expect(wsConnects[0].queryParams!['resume'] == null).to.be.true;

    // No error on successful recovery
    expect(client2.connection.errorReason).to.be.null;

    await closeAndWait(client2);
  });

  /**
   * RTN16l — Recovery failure treated as fresh connection (per RTN15c7)
   *
   * Proxy replaces the first CONNECTED response with one that has a different
   * connectionId and an error (code 80008), simulating the server rejecting
   * the recovery attempt. SDK should handle it as a fresh connection.
   */
  // UTS: realtime/proxy/RTN16l/recovery-failure-fresh-conn-0
  it('RTN16l - recovery failure treated as fresh connection', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: 'CONNECTED', count: 1 },
          action: {
            type: 'replace',
            message: {
              action: 4,
              connectionId: 'recovery-failed-new-id',
              connectionKey: 'recovery-failed-new-key',
              connectionDetails: {
                connectionKey: 'recovery-failed-new-key',
                clientId: null,
                maxMessageSize: 65536,
                maxInboundRate: 250,
                maxOutboundRate: 100,
                maxFrameSize: 524288,
                serverId: 'test-server',
                connectionStateTtl: 120000,
                maxIdleInterval: 15000,
              },
              error: {
                code: 80008,
                statusCode: 400,
                message: 'Unable to recover connection',
              },
            },
          },
          times: 1,
          comment: 'RTN16l: Replace CONNECTED with recovery failure (new connectionId + error 80008)',
        },
      ],
    });

    // Fabricated recovery key — connectionKey doesn't need to be valid since
    // the proxy will replace the server response anyway
    const fabricatedRecoveryKey = JSON.stringify({
      connectionKey: 'stale-old-key',
      msgSerial: 99,
      channelSerials: {
        'old-channel': 'old-serial',
      },
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
      recover: fabricatedRecoveryKey,
    } as any);
    trackClient(client);

    // Connect with the fabricated recovery key
    client.connect();
    await waitForState(client, 'connected', 15000);

    // RTN16l + RTN15c7: Connection got a new ID (recovery failed)
    expect(client.connection.id).to.equal('recovery-failed-new-id');
    expect(client.connection.key).to.equal('recovery-failed-new-key');

    // RTN15c7: Error is set on the connection indicating recovery failure
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(80008);

    // Connection is still CONNECTED (not FAILED — the server gave a new connection)
    expect(client.connection.state).to.equal('connected');

    // Verify the recover param was sent via proxy log
    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(1);
    expect(wsConnects[0].queryParams).to.exist;
    expect(wsConnects[0].queryParams!['recover']).to.equal('stale-old-key');

    await closeAndWait(client);
  });
});
