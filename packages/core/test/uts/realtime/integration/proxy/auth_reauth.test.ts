/**
 * UTS Proxy Integration: Auth Re-authorization Tests
 *
 * Spec points: RTN22, RTC8a
 * Source: specification/uts/realtime/integration/proxy/auth_reauth.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  getKeyParts,
  trackClient,
  closeAndWait,
  generateJWT,
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

describe('uts/realtime/integration/proxy/auth_reauth', function () {
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
   * RTN22/RTC8a — Server-initiated AUTH triggers re-authentication
   *
   * When the server sends an AUTH ProtocolMessage (action 17) to the client,
   * the SDK should invoke the authCallback to obtain a new token and send
   * an AUTH message back to the server, all without disrupting the connection.
   */
  // UTS: realtime/proxy/RTN22/server-initiated-reauth-0
  it('RTN22/RTC8a - server-initiated AUTH triggers re-authentication', async function () {
    // 1. Create proxy session with no rules (passthrough)
    session = await createProxySession({
      rules: [],
    });

    // 2. Track authCallback invocations
    let authCallbackCount = 0;
    const { keyName, keySecret } = getKeyParts(getApiKey());
    const client = new Ably.Realtime({
      authCallback: (_params: any, cb: any) => {
        authCallbackCount++;
        cb(null, generateJWT({ keyName, keySecret }));
      },
      endpoint: 'localhost',
      port: session.proxyPort,
      tls: false,
      useBinaryProtocol: false,
      autoConnect: false,
    } as any);
    trackClient(client);

    // 3. Connect and wait for connected
    client.connect();
    await waitForState(client, 'connected', 15000);

    // 4. Record baseline
    const originalConnectionId = client.connection.id;
    const originalCallbackCount = authCallbackCount;

    // 5. Record state changes from this point
    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    // 6. Inject AUTH ProtocolMessage (action 17) from server to client
    await session.triggerAction({
      type: 'inject_to_client',
      message: { action: 17 },
    });

    // 7. Poll until authCallbackCount increases
    await pollUntil(() => authCallbackCount > originalCallbackCount, { timeout: 15000 });

    // Assertions
    // Auth callback was invoked exactly once more
    expect(authCallbackCount).to.equal(originalCallbackCount + 1);

    // Connection remains connected
    expect(client.connection.state).to.equal('connected');

    // Connection ID is unchanged (no reconnect occurred)
    expect(client.connection.id).to.equal(originalConnectionId);

    // No non-connected state transitions occurred
    const nonConnectedTransitions = stateChanges.filter((s) => s !== 'connected');
    expect(nonConnectedTransitions).to.be.empty;

    // Proxy log: at least 1 AUTH frame (action 17) from client to server with auth attribute
    const log = await session.getLog();
    const authFrames = log.filter(
      (e: any) =>
        e.type === 'ws_frame' &&
        e.direction === 'client_to_server' &&
        (e.message?.action === 17 || e.message?.action === 'AUTH') &&
        e.message?.auth != null,
    );
    expect(authFrames.length).to.be.at.least(1);

    await closeAndWait(client);
  });
});
