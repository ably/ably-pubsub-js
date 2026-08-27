/**
 * Sandbox app provisioning for UTS integration tests.
 *
 * Provisions a test app on the Ably sandbox before all tests in a suite,
 * and tears it down after. Uses the standard test-app-setup.json fixture.
 */

import * as crypto from 'crypto';
import testAppSetup from '../../../common/ably-common/test-resources/test-app-setup.json';
import '../../../../src/platform/nodejs';
import { DefaultRealtime } from '../../../../src/common/lib/client/defaultrealtime';
import { DefaultRest } from '../../../../src/common/lib/client/defaultrest';
import ErrorInfo from '../../../../src/common/lib/types/errorinfo';

const Ably = {
  Rest: DefaultRest,
  Realtime: DefaultRealtime,
  ErrorInfo,
};

const SANDBOX_ENDPOINT = 'nonprod:sandbox';
const SANDBOX_REST_HOST = 'sandbox.realtime.ably-nonprod.net';

interface SandboxApp {
  appId: string;
  keys: Array<{ keyStr: string; keyName: string; keySecret: string; capability: string }>;
}

let _sandboxApp: SandboxApp | null = null;
const _trackedClients: any[] = [];

async function provisionSandboxApp(): Promise<SandboxApp> {
  const url = `https://${SANDBOX_REST_HOST}/apps`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(testAppSetup.post_apps),
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Sandbox app provisioning failed (${response.status}): ${body}`);
  }

  const app = await response.json();
  return {
    appId: app.appId,
    keys: app.keys.map((k: any) => ({
      keyStr: k.keyStr,
      keyName: k.keyName,
      keySecret: k.keySecret,
      capability: k.capability,
    })),
  };
}

async function deleteSandboxApp(app: SandboxApp): Promise<void> {
  const url = `https://${SANDBOX_REST_HOST}/apps/${app.appId}`;
  const credentials = Buffer.from(app.keys[0].keyStr).toString('base64');
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Basic ${credentials}` },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    // Best-effort cleanup — sandbox apps expire automatically
  }
}

/**
 * Get the sandbox app, provisioning it if necessary.
 * Call setupSandbox() in before() and teardownSandbox() in after().
 */
function getSandboxApp(): SandboxApp {
  if (!_sandboxApp) throw new Error('Sandbox app not provisioned — call setupSandbox() in before()');
  return _sandboxApp;
}

function getApiKey(keyIndex = 0): string {
  return getSandboxApp().keys[keyIndex].keyStr;
}

async function setupSandbox(): Promise<void> {
  _sandboxApp = await provisionSandboxApp();
}

async function teardownSandbox(): Promise<void> {
  // Close all tracked clients first
  while (_trackedClients.length > 0) {
    const client = _trackedClients.pop();
    try {
      if (typeof client.close === 'function') {
        client.close();
      }
    } catch (_) {
      // ignore
    }
  }

  if (_sandboxApp) {
    await deleteSandboxApp(_sandboxApp);
    _sandboxApp = null;
  }
}

function trackClient(client: any): void {
  _trackedClients.push(client);
}

function closeAndWait(client: any, timeout = 10000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timed out waiting for close')), timeout);
    if (client.connection.state === 'closed' || client.connection.state === 'failed') {
      clearTimeout(timer);
      resolve();
      return;
    }
    client.connection.once('closed', () => {
      clearTimeout(timer);
      resolve();
    });
    client.connection.once('failed', () => {
      clearTimeout(timer);
      resolve();
    });
    client.close();
  });
}

function connectAndWait(client: any, timeout = 15000): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for connected (state: ${client.connection.state}, error: ${client.connection.errorReason})`,
        ),
      );
    }, timeout);

    if (client.connection.state === 'connected') {
      clearTimeout(timer);
      resolve();
      return;
    }

    client.connection.once('connected', () => {
      clearTimeout(timer);
      resolve();
    });
    client.connection.once('failed', (stateChange: any) => {
      clearTimeout(timer);
      reject(new Error(`Connection failed: ${stateChange.reason?.message || 'unknown'}`));
    });

    if (client.connection.state === 'initialized') {
      client.connect();
    }
  });
}

function uniqueChannelName(prefix: string): string {
  const rand = Math.random().toString(36).substring(2, 10);
  return `${prefix}-${rand}`;
}

function base64url(data: Buffer | string): string {
  const buf = typeof data === 'string' ? Buffer.from(data) : data;
  return buf.toString('base64url');
}

function generateJWT(opts: {
  keyName: string;
  keySecret: string;
  clientId?: string;
  ttl?: number;
  expiresAt?: number;
  issuedAt?: number;
  capability?: string;
}): string {
  const now = Math.floor(Date.now() / 1000);
  const exp = opts.expiresAt != null ? Math.floor(opts.expiresAt / 1000) : now + (opts.ttl || 3600000) / 1000;
  const iat = opts.issuedAt != null ? Math.floor(opts.issuedAt / 1000) : exp < now ? exp - 60 : now;

  const header = base64url(JSON.stringify({ typ: 'JWT', alg: 'HS256', kid: opts.keyName }));

  const payload: Record<string, any> = {
    iat,
    exp,
  };
  if (opts.clientId) payload['x-ably-clientId'] = opts.clientId;
  if (opts.capability) payload['x-ably-capability'] = opts.capability;

  const payloadEncoded = base64url(JSON.stringify(payload));
  const sigInput = `${header}.${payloadEncoded}`;
  const sig = base64url(crypto.createHmac('sha256', opts.keySecret).update(sigInput).digest());

  return `${sigInput}.${sig}`;
}

function getKeyParts(keyStr: string): { keyName: string; keySecret: string } {
  const [keyName, keySecret] = keyStr.split(':');
  return { keyName, keySecret };
}

async function pollUntil<T>(
  fn: () => Promise<T | null | undefined> | T | null | undefined,
  opts: { interval?: number; timeout?: number } = {},
): Promise<T> {
  const interval = opts.interval || 500;
  const timeout = opts.timeout || 10000;
  const start = Date.now();
  while (true) {
    const result = await fn();
    if (result) return result;
    if (Date.now() - start > timeout) {
      throw new Error(`pollUntil timed out after ${timeout}ms`);
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Poll until `fn` succeeds (returns a truthy value without throwing): errors are logged and mean
 * "keep polling"; on timeout the most recent error is thrown, so failures stay diagnosable.
 * Falsy returns keep polling too (matching `pollUntil` and the spec's `poll_until_success`
 * convention, where a bare boolean condition polls until true) -- so a falsy value like 0 or ""
 * cannot be the success result; have `fn` return the containing object or `true` instead.
 */
async function pollUntilSuccess<T>(
  fn: () => Promise<T | null | undefined> | T | null | undefined,
  opts: { interval?: number; timeout?: number } = {},
): Promise<T> {
  let lastError: unknown;
  try {
    return await pollUntil(async () => {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        // pass the error object itself so the stack is preserved in the output
        console.warn('pollUntilSuccess: retrying after error:', err);
        return null;
      }
    }, opts);
  } catch (timeoutErr) {
    throw lastError ?? timeoutErr;
  }
}

export {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getSandboxApp,
  getApiKey,
  getKeyParts,
  trackClient,
  closeAndWait,
  connectAndWait,
  uniqueChannelName,
  generateJWT,
  pollUntil,
  pollUntilSuccess,
};
