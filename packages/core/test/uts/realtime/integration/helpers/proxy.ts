/**
 * TypeScript helper for the Go test proxy.
 *
 * Wraps the proxy's REST control API to create sessions, add rules,
 * trigger imperative actions, retrieve event logs, and clean up.
 *
 * The proxy binary is downloaded from GitHub releases on first use
 * via ensureProxy(). It is killed when the Node.js process exits.
 */

import { execSync, spawn, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import { pipeline } from 'stream/promises';

const PROXY_VERSION = 'v0.2.0';
const PROXY_REPO = 'ably/uts-proxy';

const CONTROL_PORT = process.env.PROXY_CONTROL_PORT || '9100';
const PROXY_CONTROL_HOST = process.env.PROXY_CONTROL_HOST || `http://localhost:${CONTROL_PORT}`;
// The cache lives in the repo root's node_modules, which is where the monorepo's single
// dependency tree is installed — seven levels up from this file, not five.
const CACHE_DIR = path.resolve(__dirname, '../../../../../../../node_modules/.cache/uts-proxy', PROXY_VERSION);
const PROXY_BIN = path.join(CACHE_DIR, 'uts-proxy');

let _proxyProcess: ChildProcess | null = null;
let _proxyEnsured = false;

const SANDBOX_REALTIME_HOST = 'sandbox.realtime.ably-nonprod.net';
const SANDBOX_REST_HOST = 'sandbox.realtime.ably-nonprod.net';

interface ProxyRule {
  match: {
    type: string;
    count?: number;
    action?: string;
    channel?: string;
    method?: string;
    pathContains?: string;
    queryContains?: Record<string, string>;
    delayMs?: number;
  };
  action: {
    type: string;
    closeCode?: number;
    delayMs?: number;
    message?: Record<string, any>;
    status?: number;
    body?: Record<string, any>;
    headers?: Record<string, string>;
  };
  times?: number;
  comment?: string;
}

interface ProxyEvent {
  timestamp: string;
  type: string;
  direction?: string;
  url?: string;
  queryParams?: Record<string, string>;
  message?: any;
  method?: string;
  path?: string;
  status?: number;
  initiator?: string;
  closeCode?: number;
  ruleMatched?: string | null;
  headers?: Record<string, string>;
}

interface ImperativeAction {
  type: string;
  message?: Record<string, any>;
  closeCode?: number;
}

class ProxySession {
  readonly sessionId: string;
  readonly proxyHost: string;
  readonly proxyPort: number;
  private controlUrl: string;

  constructor(sessionId: string, proxyHost: string, proxyPort: number, controlUrl: string) {
    this.sessionId = sessionId;
    this.proxyHost = proxyHost;
    this.proxyPort = proxyPort;
    this.controlUrl = controlUrl;
  }

  async addRules(rules: ProxyRule[], position: 'append' | 'prepend' = 'append'): Promise<void> {
    const resp = await fetch(`${this.controlUrl}/sessions/${this.sessionId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules, position }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`addRules failed (${resp.status}): ${body}`);
    }
  }

  async triggerAction(action: ImperativeAction): Promise<void> {
    const resp = await fetch(`${this.controlUrl}/sessions/${this.sessionId}/actions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(action),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`triggerAction failed (${resp.status}): ${body}`);
    }
  }

  async getLog(): Promise<ProxyEvent[]> {
    const resp = await fetch(`${this.controlUrl}/sessions/${this.sessionId}/log`);
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`getLog failed (${resp.status}): ${body}`);
    }
    const data = await resp.json();
    return data.events || [];
  }

  async close(): Promise<void> {
    try {
      await fetch(`${this.controlUrl}/sessions/${this.sessionId}`, { method: 'DELETE' });
    } catch {
      // Ignore errors during cleanup
    }
  }
}

interface CreateProxySessionOpts {
  endpoint?: 'nonprod:sandbox';
  port?: number;
  rules?: ProxyRule[];
  timeoutMs?: number;
}

async function createProxySession(opts: CreateProxySessionOpts = {}): Promise<ProxySession> {
  const controlUrl = PROXY_CONTROL_HOST;

  const target = {
    realtimeHost: SANDBOX_REALTIME_HOST,
    restHost: SANDBOX_REST_HOST,
  };

  const body: Record<string, any> = {
    target,
    rules: opts.rules || [],
  };
  if (opts.port) {
    body.port = opts.port;
  }
  if (opts.timeoutMs) {
    body.timeoutMs = opts.timeoutMs;
  }

  const resp = await fetch(`${controlUrl}/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`createProxySession failed (${resp.status}): ${text}`);
  }

  const data = await resp.json();
  const proxyPort = data.proxy?.port ?? opts.port;
  // fail fast with the actual response rather than letting tests connect to localhost:undefined
  if (typeof proxyPort !== 'number') {
    throw new Error(
      `createProxySession: proxy control server did not return a numeric port; response: ${JSON.stringify(data)}`,
    );
  }
  return new ProxySession(data.sessionId, 'localhost', proxyPort, controlUrl);
}

const CHECKSUMS: Record<string, string> = {
  'uts-proxy_0.2.0_darwin_amd64.tar.gz': '4abc4bd0682b61d53889c3ad3b240b44cf942878ed9fb04e8912a48070d2666d',
  'uts-proxy_0.2.0_darwin_arm64.tar.gz': '2b95cdb5659988f54ad3d413c713f94f944e3b0014011aba2e339b9537c59b2f',
  'uts-proxy_0.2.0_linux_amd64.tar.gz': 'aa6d536101ebc3bfa6870ca4cfb75be1947360dc5c1c77d7a8536baa1fee7caa',
  'uts-proxy_0.2.0_linux_arm64.tar.gz': 'c8f9363ae579508004727175a098bd0b73518ee3f08cf9071b0c372f8199767a',
};

function assetName(): string {
  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  const version = PROXY_VERSION.replace(/^v/, '');
  return `uts-proxy_${version}_${platform}_${arch}.tar.gz`;
}

async function downloadProxy(): Promise<void> {
  if (fs.existsSync(PROXY_BIN)) return;

  const asset = assetName();
  const expectedHash = CHECKSUMS[asset];
  if (!expectedHash) {
    throw new Error(`No checksum for ${asset} — unsupported platform/arch`);
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const url = `https://github.com/${PROXY_REPO}/releases/download/${PROXY_VERSION}/${asset}`;
  console.log(`Downloading uts-proxy ${PROXY_VERSION} (${asset})...`);

  const resp = await fetch(url, { redirect: 'follow' });
  if (!resp.ok || !resp.body) {
    throw new Error(`Failed to download ${url}: ${resp.status} ${resp.statusText}`);
  }

  const tarball = path.join(CACHE_DIR, asset);
  const fileStream = fs.createWriteStream(tarball);
  // @ts-ignore — Node fetch body is a web ReadableStream; pipeline handles it in Node 18+
  await pipeline(resp.body, fileStream);

  const hash = crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex');
  if (hash !== expectedHash) {
    fs.unlinkSync(tarball);
    throw new Error(`Checksum mismatch for ${asset}: expected ${expectedHash}, got ${hash}`);
  }

  execSync(`tar xzf ${JSON.stringify(asset)}`, { cwd: CACHE_DIR });
  fs.chmodSync(PROXY_BIN, 0o755);
  fs.unlinkSync(tarball);
}

function spawnProxy(): ChildProcess {
  const child = spawn(PROXY_BIN, ['--port', CONTROL_PORT], {
    stdio: ['ignore', 'inherit', 'inherit'],
    detached: false,
  });

  child.on('error', (err) => {
    console.error(`Proxy process error: ${err.message}`);
  });

  process.on('exit', () => {
    if (child.exitCode === null) {
      child.kill();
    }
  });

  return child;
}

async function ensureProxy(timeoutMs = 15000): Promise<void> {
  if (_proxyEnsured) return;

  // Check if proxy is already running (e.g. started externally)
  try {
    const resp = await fetch(`${PROXY_CONTROL_HOST}/health`);
    if (resp.ok) {
      _proxyEnsured = true;
      return;
    }
  } catch {
    // Not running — we'll start it
  }

  await downloadProxy();
  _proxyProcess = spawnProxy();

  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const resp = await fetch(`${PROXY_CONTROL_HOST}/health`);
      if (resp.ok) {
        _proxyEnsured = true;
        return;
      }
    } catch {
      // Not ready yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  _proxyProcess.kill();
  _proxyProcess = null;
  throw new Error(`Proxy failed to start within ${timeoutMs}ms`);
}

async function waitForProxy(timeoutMs = 15000): Promise<void> {
  await ensureProxy(timeoutMs);
}

function stopProxy(): void {
  if (_proxyProcess && _proxyProcess.exitCode === null) {
    _proxyProcess.kill();
    _proxyProcess = null;
  }
  _proxyEnsured = false;
}

export {
  ProxySession,
  ProxyRule,
  ProxyEvent,
  ImperativeAction,
  createProxySession,
  waitForProxy,
  ensureProxy,
  stopProxy,
};
