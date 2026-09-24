/**
 * Shared helpers for the UTS push activation test suite.
 *
 * Maps the UTS harness constructs (uts/rest/unit/helpers/mock_push_platform.md)
 * onto ably-js's push seam: `install_push_platform(...)` becomes a per-client
 * ReactNativePush plugin carrying the mock storage and requestToken;
 * `MockPushStorage` implements the AsyncStorage-shaped ReactNativePushStorage
 * with the UTS mock extensions (dump/seed/fail flags/onOperation).
 *
 * The ReactNativePush plugin reads require('react-native').Platform.OS inside
 * create(); react-native is not resolvable in Node, so installReactNativeFake()
 * intercepts module loading (call in before(), restore in after()).
 */

import Module from 'module';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp } from '../../../helpers';
import ReactNativePush from '../../../../../src/plugins/react-native-push';
import type { ReactNativePushToken } from '../../../../../src/plugins/react-native-push';

// ---------------------------------------------------------------------------
// react-native module fake

export const fakeReactNative = { Platform: { OS: 'android' } };
const originalModuleLoad = (Module as any)._load;

export function installReactNativeFake(): void {
  (Module as any)._load = function (request: string, ...rest: any[]) {
    if (request === 'react-native') {
      return fakeReactNative;
    }
    return originalModuleLoad.call(this, request, ...rest);
  };
}

export function restoreReactNativeFake(): void {
  (Module as any)._load = originalModuleLoad;
  fakeReactNative.Platform.OS = 'android';
}

// ---------------------------------------------------------------------------
// MockPushStorage (mock_push_platform.md)

export interface StorageOperation {
  type: 'getItem' | 'setItem' | 'removeItem';
  key: string;
  value?: string;
}

/**
 * In-memory PushKeyValueStorage with the UTS mock extensions. The optional
 * onOperation handler runs synchronously before each operation is applied;
 * if it throws, the operation rejects and the contents are not modified.
 */
export class MockPushStorage {
  private data = new Map<string, string>();
  failWrites = false;
  failReads = false;

  constructor(private onOperation?: (op: StorageOperation) => void) {}

  async getItem(key: string): Promise<string | null> {
    this.onOperation?.({ type: 'getItem', key });
    if (this.failReads) {
      throw new Error('storage unavailable (reads)');
    }
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.onOperation?.({ type: 'setItem', key, value });
    if (this.failWrites) {
      throw new Error('storage unavailable (writes)');
    }
    this.data.set(key, value);
  }

  async removeItem(key: string): Promise<void> {
    this.onOperation?.({ type: 'removeItem', key });
    if (this.failWrites) {
      throw new Error('storage unavailable (writes)');
    }
    this.data.delete(key);
  }

  /** Test-only synchronous inspection of the current contents. */
  dump(): Record<string, string> {
    return Object.fromEntries(this.data);
  }

  /** Test-only seeding: simulate state persisted by a previous app run. */
  seed(entries: Record<string, string>): void {
    for (const [key, value] of Object.entries(entries)) {
      this.data.set(key, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Deferred

export interface Deferred<T> {
  future: Promise<T>;
  complete(value: T): void;
  fail(error: unknown): void;
}

export function deferred<T>(): Deferred<T> {
  let complete!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const future = new Promise<T>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  return { future, complete, fail };
}

// ---------------------------------------------------------------------------
// mock_registration_server

/**
 * Installs a MockHttpClient routing the device-registration endpoints, per the
 * UTS shared setup. `overrides(req)` is consulted first; return true if the
 * override handled (or held) the request. Returns the captured-requests array.
 */
export function mockRegistrationServer(overrides?: (req: any) => boolean): any[] {
  const captured: any[] = [];
  const mock = new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      captured.push(req);
      if (overrides && overrides(req)) {
        return;
      }
      if (req.method === 'post' && req.path === '/push/deviceRegistrations') {
        req.respond_with(201, { ...JSON.parse(req.body), deviceIdentityToken: { token: 'ident-token-1' } });
      } else if (req.method === 'put' && req.path.startsWith('/push/deviceRegistrations/')) {
        req.respond_with(200, JSON.parse(req.body));
      } else if (req.method === 'patch' && req.path.startsWith('/push/deviceRegistrations/')) {
        req.respond_with(200, JSON.parse(req.body));
      } else if (req.method === 'delete' && req.path === '/push/deviceRegistrations') {
        req.respond_with(204, '');
      } else {
        req.respond_with(500, { error: { message: 'unexpected request ' + req.method + ' ' + req.path, code: 50000 } });
      }
    },
  });
  installMockHttp(mock);
  return captured;
}

// ---------------------------------------------------------------------------
// push_client / activate_into

export interface PushClientOptions {
  clientId?: string;
  /** Literal token for requestToken to resolve with (default fcm-token-1). */
  token?: ReactNativePushToken;
  /** Full requestToken override; takes precedence over `token`. */
  requestToken?: () => Promise<ReactNativePushToken>;
  /** react-native Platform.OS for this client's plugin ('android' | 'ios'). */
  platform?: string;
  /** Extra ClientOptions merged in (e.g. authCallback instead of key). */
  clientOptions?: Record<string, any>;
}

/**
 * UTS `push_client(storage, ...)`: installs the push platform (as a per-client
 * ReactNativePush plugin — ably-js's injection mechanism) and constructs the
 * REST client.
 */
export function pushClient(storage: MockPushStorage, opts: PushClientOptions = {}): any {
  const token = opts.token ?? ({ transportType: 'fcm', token: 'fcm-token-1' } as ReactNativePushToken);
  if (opts.platform) {
    fakeReactNative.Platform.OS = opts.platform === 'ios' ? 'ios' : 'android';
  }
  const plugin = ReactNativePush.create({
    storage,
    requestToken: opts.requestToken ?? (async () => token),
  });
  const clientOptions: Record<string, any> = {
    useBinaryProtocol: false,
    plugins: { Push: plugin },
    ...(opts.clientOptions ?? {}),
  };
  if (!clientOptions.authCallback && !clientOptions.token && !clientOptions.key) {
    clientOptions.key = 'appId.keyId:keySecret';
  }
  if (opts.clientId) {
    clientOptions.clientId = opts.clientId;
  }
  return new Ably.Rest(clientOptions as any);
}

/**
 * UTS `activate_into(storage, clientId?)`: runs a full activation so that
 * `storage` holds a registered device and the persisted activation state is
 * WaitingForNewPushDeviceDetails. Returns the client.
 */
export async function activateInto(storage: MockPushStorage, opts: PushClientOptions = {}): Promise<any> {
  const client = pushClient(storage, opts);
  await client.push.activate();
  await waitFor(
    () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
    'activation state to persist as WaitingForNewPushDeviceDetails',
  );
  return client;
}

// ---------------------------------------------------------------------------
// polling

/** Let pending microtasks/promise chains settle (UTS process_pending_events). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * UTS poll_until / poll_until_success: repeatedly flush the microtask queue
 * until the condition holds (fire-and-forget syncs and storage writes settle
 * asynchronously).
 */
export async function waitFor(condition: () => boolean, description: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (condition()) {
      return;
    }
    await flush();
  }
  throw new Error('timed out waiting for ' + description);
}

/** Await a promise rejection (UTS `AWAIT op() FAILS WITH error`). */
export async function rejectionOf(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('expected promise to reject');
}
