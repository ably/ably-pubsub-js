/**
 * push.updateToken() tests
 *
 * Exercises feeding a rotated FCM/APNs token into an activated device via the ReactNativePush
 * plugin, with HTTP mocked. updateToken() persists the new recipient and hands a
 * GotPushDeviceDetails event to the activation state machine (the same flow the plugin's
 * getPushDeviceDetails hook uses on activation), so the registration sync is fire-and-forget.
 * The tests cover: the registration sync (PATCH /push/deviceRegistrations/:deviceId),
 * cold-start updates from persisted state, sync failure reporting via updateFailedCallback and
 * retry, the pre-activation guard, routing through a custom registerCallback, and serialization
 * with an in-flight sync or deactivation.
 */

import Module from 'module';
import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll, flushAsync } from '../../../helpers';
import ReactNativePush from '../../../../../src/plugins/react-native-push';
import type { ReactNativePushToken } from '../../../../../src/plugins/react-native-push';

// The plugin reads require('react-native').Platform.OS inside create(). react-native is not
// resolvable in Node, so intercept module loading and serve this fake; tests set its OS per case.
const fakeReactNative = { Platform: { OS: 'android' } };
const originalModuleLoad = (Module as any)._load;

/** In-memory fake of @react-native-async-storage/async-storage. */
class FakeAsyncStorage {
  private data = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  async setItem(key: string, value: string): Promise<void> {
    this.data.set(key, value);
  }
  async removeItem(key: string): Promise<void> {
    this.data.delete(key);
  }

  // test-only synchronous accessor
  dump(): Record<string, string> {
    return Object.fromEntries(this.data);
  }
}

describe('push_update_token', function () {
  before(function () {
    (Module as any)._load = function (request: string, ...rest: any[]) {
      if (request === 'react-native') {
        return fakeReactNative;
      }
      return originalModuleLoad.call(this, request, ...rest);
    };
  });

  after(function () {
    (Module as any)._load = originalModuleLoad;
  });

  afterEach(function () {
    restoreAll();
    fakeReactNative.Platform.OS = 'android';
  });

  function mockRegistrationServer(opts?: { onPatch?: (req: any) => void }) {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        if (req.method === 'post' && req.path === '/push/deviceRegistrations') {
          req.respond_with(201, { ...JSON.parse(req.body), deviceIdentityToken: { token: 'ident-token-1' } });
        } else if (req.method === 'patch' && req.path.startsWith('/push/deviceRegistrations/')) {
          if (opts?.onPatch) {
            opts.onPatch(req);
          } else {
            req.respond_with(200, JSON.parse(req.body));
          }
        } else {
          req.respond_with(500, { error: { message: 'unexpected request ' + req.method + ' ' + req.path } });
        }
      },
    });
    installMockHttp(mock);
    return captured;
  }

  function rnClient(
    storage: FakeAsyncStorage,
    opts?: { token?: ReactNativePushToken | (() => Promise<ReactNativePushToken>) },
  ) {
    const token = opts?.token ?? { transportType: 'fcm' as const, token: 'fcm-token-1' };
    return new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: {
        Push: ReactNativePush.create({
          storage,
          requestToken: typeof token === 'function' ? token : async () => token,
        }),
      },
    });
  }

  async function rejectionOf(promise: Promise<unknown>): Promise<any> {
    try {
      await promise;
    } catch (err) {
      return err;
    }
    throw new Error('expected promise to reject');
  }

  // the registration sync runs fire-and-forget after updateToken() resolves, so tests poll for
  // its observable effects rather than awaiting a promise
  async function waitFor(condition: () => boolean, description: string): Promise<void> {
    for (let i = 0; i < 100; i++) {
      if (condition()) {
        return;
      }
      await flushAsync();
    }
    throw new Error('timed out waiting for ' + description);
  }

  it('updates a rotated fcm token via PATCH and persists the new recipient', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);

    await client.push.activate();
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });

    await waitFor(() => captured.length === 2, 'the registration sync PATCH');
    await flushAsync(); // let fire-and-forget storage writes settle

    expect(captured[1].method).to.equal('patch');
    expect(captured[1].headers.authorization).to.be.a('string'); // deviceIdentityToken bearer auth

    const persisted = storage.dump();
    // the device id travels in the URL; the body carries only the new recipient
    expect(captured[1].path).to.equal('/push/deviceRegistrations/' + persisted['ably.push.deviceId']);
    const body = JSON.parse(captured[1].body);
    expect(body).to.deep.equal({ push: { recipient: { transportType: 'fcm', registrationToken: 'fcm-token-2' } } });

    expect(JSON.parse(persisted['ably.push.pushRecipient'])).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-2',
    });
    expect(persisted['ably.push.activationState']).to.equal('WaitingForNewPushDeviceDetails');
  });

  it('maps an apns token to an apns recipient', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    fakeReactNative.Platform.OS = 'ios';
    const client = rnClient(storage, { token: { transportType: 'apns', token: 'apns-token-1' } });

    await client.push.activate();
    await client.push.updateToken({ transportType: 'apns', token: 'apns-token-2' });

    await waitFor(() => captured.length === 2, 'the registration sync PATCH');
    const body = JSON.parse(captured[1].body);
    expect(body.push.recipient).to.deep.equal({ transportType: 'apns', deviceToken: 'apns-token-2' });
  });

  it('rejects when the device is not activated, and a later activation still works', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);

    const err = await rejectionOf(client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' }));
    expect(err.code).to.equal(40000);
    expect(err.message).to.match(/not activated/);
    expect(err.remediation).to.match(/push\.activate/);
    expect(captured).to.have.length(0);

    // the guard fires before anything reaches the state machine, so activation is not affected
    await client.push.activate();
    expect(captured).to.have.length(1);
  });

  it('updates from persisted state on a cold start without re-calling activate()', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();

    await rnClient(storage).push.activate();
    await flushAsync();

    // a fresh client over the same storage stands in for an app restart: the persisted state is
    // WaitingForNewPushDeviceDetails, so updateToken must work without activate() this session
    const restarted = rnClient(storage);
    await restarted.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });

    await waitFor(() => captured.length === 2, 'the registration sync PATCH');
    expect(captured[1].method).to.equal('patch');
    const body = JSON.parse(captured[1].body);
    expect(body.push.recipient.registrationToken).to.equal('fcm-token-2');
    // the restarted client loaded the persisted device id and addressed the same registration
    expect(captured[1].path).to.equal('/push/deviceRegistrations/' + storage.dump()['ably.push.deviceId']);
  });

  it('reports a failed sync to updateFailedCallback, then a retry with the same token succeeds', async function () {
    let failPatch = true;
    const captured = mockRegistrationServer({
      onPatch: (req) => {
        if (failPatch) {
          // a 4xx response: a 5xx would additionally exercise the client's fallback-host retries
          req.respond_with(400, { error: { message: 'server rejected sync', code: 40000, statusCode: 400 } });
        } else {
          req.respond_with(200, JSON.parse(req.body));
        }
      },
    });
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);
    const updateFailures: any[] = [];
    await client.push.activate(undefined, (err) => updateFailures.push(err));

    // the sync is fire-and-forget: updateToken resolves once the new token is persisted, and the
    // server's rejection surfaces through the updateFailedCallback passed to activate()
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await waitFor(() => updateFailures.length === 1, 'the sync failure to reach updateFailedCallback');
    expect(updateFailures[0].message).to.match(/server rejected sync/);
    expect(JSON.parse(storage.dump()['ably.push.pushRecipient']).registrationToken).to.equal('fcm-token-2');

    failPatch = false;
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await waitFor(() => captured.filter((req) => req.method === 'patch').length === 2, 'the retry PATCH');
    await flushAsync();

    expect(storage.dump()['ably.push.activationState']).to.equal('WaitingForNewPushDeviceDetails');
  });

  it('rejects malformed tokens without touching the machine or the network', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);
    await client.push.activate();
    await flushAsync();
    const persistedBefore = storage.dump();

    for (const bad of [undefined, { transportType: 'web', token: 'x' }, { transportType: 'fcm', token: '' }]) {
      const err = await rejectionOf(client.push.updateToken(bad as any));
      expect(err.code).to.equal(40000);
      expect(err.message).to.match(/transportType/);
    }

    await flushAsync();
    expect(captured).to.have.length(1); // just the activation POST
    expect(storage.dump()).to.deep.equal(persistedBefore);
  });

  it('routes the sync through a custom registerCallback supplied to activate()', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);

    const registeredRecipients: any[] = [];
    await client.push.activate((device, callback) => {
      registeredRecipients.push(device.push?.recipient);
      callback(null as any, { deviceIdentityToken: { token: 'custom-ident-1' } } as any);
    });
    expect(registeredRecipients).to.have.length(1);
    expect(captured).to.have.length(0); // registration went through the callback

    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await waitFor(() => registeredRecipients.length === 2, 'the sync to reach registerCallback');
    await flushAsync();

    // the device was registered through the customer's registerCallback, so the sync is routed
    // through the same callback (with the new recipient) rather than PATCHed to Ably directly
    expect(captured).to.have.length(0);
    expect(registeredRecipients[1]).to.deep.equal({ transportType: 'fcm', registrationToken: 'fcm-token-2' });
    expect(JSON.parse(storage.dump()['ably.push.pushRecipient']).registrationToken).to.equal('fcm-token-2');
  });

  it('an update issued while a sync is in flight is applied after it settles', async function () {
    let heldPatch: any = null;
    const captured = mockRegistrationServer({
      onPatch: (req) => {
        if (heldPatch) {
          req.respond_with(200, JSON.parse(req.body));
        } else {
          heldPatch = req; // held open until the test releases it
        }
      },
    });
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);
    await client.push.activate();

    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await waitFor(() => !!heldPatch, 'the first sync PATCH');
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-3' });
    await flushAsync();

    // the second update is queued in the state machine behind the in-flight sync
    expect(captured.filter((req) => req.method === 'patch')).to.have.length(1);

    heldPatch.respond_with(200, JSON.parse(heldPatch.body));
    await waitFor(() => captured.filter((req) => req.method === 'patch').length === 2, 'the queued sync PATCH');
    await flushAsync();

    const patches = captured.filter((req) => req.method === 'patch');
    expect(JSON.parse(patches[1].body).push.recipient.registrationToken).to.equal('fcm-token-3');
    expect(JSON.parse(storage.dump()['ably.push.pushRecipient']).registrationToken).to.equal('fcm-token-3');
  });

  it('an update racing a deactivation is discarded once the device is deregistered', async function () {
    let heldDelete: any = null;
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        if (req.method === 'post' && req.path === '/push/deviceRegistrations') {
          req.respond_with(201, { ...JSON.parse(req.body), deviceIdentityToken: { token: 'ident-token-1' } });
        } else if (req.method === 'delete' && req.path === '/push/deviceRegistrations') {
          heldDelete = req; // held open until the test releases it
        } else {
          req.respond_with(500, { error: { message: 'unexpected request ' + req.method + ' ' + req.path } });
        }
      },
    });
    installMockHttp(mock);
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);
    await client.push.activate();

    const deactivated = client.push.deactivate(undefined as any);
    await waitFor(() => !!heldDelete, 'the deregistration DELETE');
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await flushAsync();

    heldDelete.respond_with(200, {});
    await deactivated;
    await flushAsync();

    // the queued sync was discarded rather than re-registering the deregistered device, and
    // deregistration removed the recipient the update had persisted
    expect(captured.filter((req) => req.method === 'patch')).to.have.length(0);
    expect(storage.dump()).to.not.have.property('ably.push.pushRecipient');
  });
});
