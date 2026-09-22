/**
 * UTS Proxy Integration: Connection Opening Failures
 *
 * Spec points: RTN14a, RTN14b, RTN14c, RTN14d, RTN14g
 * Source: specification/uts/realtime/integration/proxy/connection_open_failures.md
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

describe('uts/realtime/integration/proxy/connection_open_failures', function () {
  this.timeout(60000);

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
   * RTN14a — Fatal error during connection open causes FAILED
   */
  // UTS: realtime/proxy/RTN14a/fatal-connect-error-0
  it('RTN14a - fatal error during connection open causes FAILED', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: 'CONNECTED' },
          action: {
            type: 'replace',
            message: {
              action: 9,
              error: { code: 40005, statusCode: 400, message: 'Invalid key' },
            },
          },
          times: 1,
          comment: 'RTN14a: Replace CONNECTED with fatal ERROR',
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
    await waitForState(client, 'failed', 15000);

    expect(client.connection.state).to.equal('failed');
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(40005);
    expect(client.connection.errorReason!.statusCode).to.equal(400);

    expect(stateChanges).to.include('connecting');
    expect(stateChanges).to.include('failed');
    const connectingIdx = stateChanges.indexOf('connecting');
    const failedIdx = stateChanges.indexOf('failed');
    expect(connectingIdx).to.be.lessThan(failedIdx);

    expect(client.connection.id).to.not.exist;
    expect(client.connection.key).to.not.exist;
  });

  /**
   * RTN14b — Token error during connection, SDK renews and reconnects
   */
  // UTS: realtime/proxy/RTN14b/token-error-renew-reconnect-0
  it('RTN14b - token error during connection triggers renewal and reconnect', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: 'CONNECTED' },
          action: {
            type: 'replace',
            message: {
              action: 9,
              error: { code: 40142, statusCode: 401, message: 'Token expired' },
            },
          },
          times: 1,
          comment: 'RTN14b: Token error on first connect, renewal should succeed',
        },
      ],
    });

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

    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await waitForState(client, 'connected', 30000);

    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.exist;
    expect(client.connection.key).to.exist;
    expect(authCallbackCount).to.be.at.least(2);

    expect(stateChanges).to.include('connecting');
    expect(stateChanges).to.include('connected');

    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(2);

    expect(client.connection.errorReason).to.be.null;

    await closeAndWait(client);
  });

  /**
   * RTN14c — Connection timeout (no CONNECTED received)
   */
  // UTS: realtime/proxy/RTN14c/connection-timeout-0
  it('RTN14c - connection timeout when CONNECTED is suppressed', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: 'CONNECTED' },
          action: { type: 'suppress' },
          comment: 'RTN14c: Suppress CONNECTED to force timeout',
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

    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await waitForState(client, 'disconnected', 15000);

    expect(client.connection.state).to.equal('disconnected');
    expect(client.connection.errorReason).to.not.be.null;

    expect(stateChanges).to.include('connecting');
    expect(stateChanges).to.include('disconnected');
    const connectingIdx = stateChanges.indexOf('connecting');
    const disconnectedIdx = stateChanges.indexOf('disconnected');
    expect(connectingIdx).to.be.lessThan(disconnectedIdx);

    expect(client.connection.id).to.not.exist;
    expect(client.connection.key).to.not.exist;

    await closeAndWait(client);
  });

  /**
   * RTN14d — Retry after connection refused
   */
  // UTS: realtime/proxy/RTN14d/retry-after-refused-0
  it('RTN14d - retry after connection refused', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_connect', count: 1 },
          action: { type: 'refuse_connection' },
          times: 1,
          comment: 'RTN14d: Refuse first WebSocket connection',
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
      disconnectedRetryTimeout: 2000,
    } as any);
    trackClient(client);

    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    client.connect();
    await waitForState(client, 'connected', 30000);

    expect(client.connection.state).to.equal('connected');
    expect(client.connection.id).to.exist;
    expect(client.connection.key).to.exist;

    expect(stateChanges).to.include('connecting');
    expect(stateChanges).to.include('disconnected');
    expect(stateChanges).to.include('connected');

    const connectingIdx = stateChanges.indexOf('connecting');
    const disconnectedIdx = stateChanges.indexOf('disconnected');
    const lastConnectedIdx = stateChanges.lastIndexOf('connected');
    expect(connectingIdx).to.be.lessThan(disconnectedIdx);
    expect(disconnectedIdx).to.be.lessThan(lastConnectedIdx);

    const log = await session.getLog();
    const wsConnects = log.filter((e) => e.type === 'ws_connect');
    expect(wsConnects.length).to.be.at.least(2);

    await closeAndWait(client);
  });

  /**
   * RTN14g — Connection-level ERROR during open causes FAILED
   */
  // UTS: realtime/proxy/RTN14g/server-error-causes-failed-0
  it('RTN14g - server error during connection open causes FAILED', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'ws_frame_to_client', action: 'CONNECTED' },
          action: {
            type: 'replace',
            message: {
              action: 9,
              error: { code: 50000, statusCode: 500, message: 'Internal server error' },
            },
          },
          times: 1,
          comment: 'RTN14g: Connection-level ERROR (server error) during open',
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
    await waitForState(client, 'failed', 15000);

    expect(client.connection.state).to.equal('failed');
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(50000);
    expect(client.connection.errorReason!.statusCode).to.equal(500);

    expect(stateChanges).to.include('connecting');
    expect(stateChanges).to.include('failed');
    const connectingIdx = stateChanges.indexOf('connecting');
    const failedIdx = stateChanges.indexOf('failed');
    expect(connectingIdx).to.be.lessThan(failedIdx);

    expect(client.connection.id).to.not.exist;
    expect(client.connection.key).to.not.exist;
  });
});
