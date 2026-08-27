/**
 * ReactNativePush activation tests
 *
 * Exercises the ReactNativePush plugin's activation flow against a fake async storage and a
 * stubbed requestToken, with HTTP mocked: full activation (RSH2a) for fcm and apns transports,
 * re-activation from persisted state, deactivation (RSH2b), the deprecated sync device() guard,
 * and token acquisition failure (RSH8h).
 */

import Module from 'module';
import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, Platform, installMockHttp, restoreAll, flushAsync } from '../../../helpers';
import ReactNativePush from '../../../../../src/plugins/react-native-push';
import type { ReactNativePushToken } from '../../../../../src/plugins/react-native-push';
import WebPushPlugin from '../../../../../src/plugins/push';

// The plugin reads require('react-native').Platform.OS inside create(). react-native is not
// resolvable in Node, so intercept module loading and serve this fake; tests set its OS per case.
const fakeReactNative = { Platform: { OS: 'android' } };
const originalModuleLoad = (Module as any)._load;

/** In-memory fake of @react-native-async-storage/async-storage. */
class FakeAsyncStorage {
  private data = new Map<string, string>();
  failWrites = false;

  async getItem(key: string): Promise<string | null> {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) {
      throw new Error('storage unavailable');
    }
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

function registrationResponse(requestBody: any) {
  return {
    ...requestBody,
    deviceIdentityToken: { token: 'ident-token-1' },
  };
}

describe('push_activation_react_native', function () {
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
    // the web-style storage test below sets the global Platform.Config.push directly; reset it
    // so it cannot leak into other tests
    Platform.Config.push = undefined;
    fakeReactNative.Platform.OS = 'android';
  });

  function mockRegistrationServer() {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        if (req.method === 'post' && req.path === '/push/deviceRegistrations') {
          req.respond_with(201, registrationResponse(JSON.parse(req.body)));
        } else if (req.method === 'delete' && req.path === '/push/deviceRegistrations') {
          req.respond_with(204, '');
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

  it('activates with an fcm token and persists activation state to async storage', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);

    await client.push.activate();
    await flushAsync(); // let fire-and-forget storage writes settle

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/push/deviceRegistrations');

    const body = JSON.parse(captured[0].body);
    expect(body.push.recipient).to.deep.equal({ transportType: 'fcm', registrationToken: 'fcm-token-1' });
    expect(body.platform).to.equal('android');
    expect(body.formFactor).to.equal('phone');
    expect(body.id).to.be.a('string').and.not.be.empty;

    const persisted = storage.dump();
    expect(persisted['ably.push.deviceId']).to.equal(body.id);
    expect(persisted['ably.push.deviceSecret']).to.be.a('string').and.not.be.empty;
    expect(JSON.parse(persisted['ably.push.deviceIdentityToken'])).to.equal('ident-token-1');
    expect(JSON.parse(persisted['ably.push.pushRecipient'])).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-1',
    });
    expect(persisted['ably.push.activationState']).to.equal('WaitingForNewPushDeviceDetails');
  });

  it('activates with an apns token as an apns recipient', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    fakeReactNative.Platform.OS = 'ios';
    const client = rnClient(storage, {
      token: { transportType: 'apns', token: 'apns-token-1' },
    });

    await client.push.activate();

    const body = JSON.parse(captured[0].body);
    expect(body.push.recipient).to.deep.equal({ transportType: 'apns', deviceToken: 'apns-token-1' });
    expect(body.platform).to.equal('ios');
  });

  it('re-activation from persisted state does not register again', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();

    await rnClient(storage).push.activate();
    await flushAsync();
    expect(captured).to.have.length(1);

    // a fresh client over the same storage finds the registered device and resolves immediately
    const client = rnClient(storage);
    await client.push.activate();
    await flushAsync();

    expect(captured).to.have.length(1);
    const device = await client.getDevice();
    expect(device.deviceIdentityToken).to.equal('ident-token-1');
  });

  it('clients keep independent storage and token callbacks', async function () {
    const captured = mockRegistrationServer();
    const storageA = new FakeAsyncStorage();
    const storageB = new FakeAsyncStorage();
    const clientA = rnClient(storageA, { token: { transportType: 'fcm', token: 'token-a' } });
    const clientB = rnClient(storageB, { token: { transportType: 'fcm', token: 'token-b' } });

    await clientA.push.activate();
    await clientB.push.activate();
    await flushAsync();

    expect(captured).to.have.length(2);
    const bodyA = JSON.parse(captured[0].body);
    const bodyB = JSON.parse(captured[1].body);
    expect(bodyA.push.recipient.registrationToken).to.equal('token-a');
    expect(bodyB.push.recipient.registrationToken).to.equal('token-b');
    // each client registered its own device, persisted to its own storage
    expect(bodyA.id).to.not.equal(bodyB.id);
    expect(storageA.dump()['ably.push.deviceId']).to.equal(bodyA.id);
    expect(storageB.dump()['ably.push.deviceId']).to.equal(bodyB.id);
    expect(storageA.dump()['ably.push.pushRecipient']).to.include('token-a');
    expect(storageB.dump()['ably.push.pushRecipient']).to.include('token-b');
  });

  it('recovers once a transient storage write failure clears', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    storage.failWrites = true;
    const client = rnClient(storage);

    // the first activation fails while persisting the freshly generated device identifiers
    let thrown: any;
    try {
      await client.push.activate();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.exist;
    expect(thrown.message).to.match(/storage unavailable/);
    expect(captured).to.have.length(0);

    // once storage works again the same client can activate: the failed device load is not cached
    storage.failWrites = false;
    await client.push.activate();
    await flushAsync();

    expect(captured).to.have.length(1);
    expect(storage.dump()['ably.push.activationState']).to.equal('WaitingForNewPushDeviceDetails');
  });

  it('deactivates a registered device', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);

    await client.push.activate();
    await client.push.deactivate(undefined as any);
    await flushAsync();

    expect(captured).to.have.length(2);
    expect(captured[1].method).to.equal('delete');
    expect(captured[1].path).to.equal('/push/deviceRegistrations');
    expect(captured[1].headers.authorization).to.be.a('string'); // deviceIdentityToken bearer auth

    const persisted = storage.dump();
    expect(persisted['ably.push.activationState']).to.equal('NotActivated');
    // the device id is reset so the deregistered identity is not reused
    expect(persisted['ably.push.deviceId']).to.not.equal(captured[1].params?.deviceId);
    // the deregistered identity token and recipient are removed from storage, not just from the
    // in-memory device, so a later load cannot resurrect them
    expect(persisted).to.not.have.property('ably.push.deviceIdentityToken');
    expect(persisted).to.not.have.property('ably.push.pushRecipient');
  });

  it('device() throws before hydration and returns the cached device after getDevice()', async function () {
    mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage);

    expect(() => client.device())
      .to.throw()
      .and.satisfy((err: any) => {
        expect(err.code).to.equal(40000);
        expect(err.message).to.match(/synchronously/);
        expect(err.remediation).to.match(/getDevice/);
        return true;
      });

    const device = await client.getDevice();
    expect(device.id).to.be.a('string').and.not.be.empty;
    // once hydrated, the deprecated sync accessor returns the same cached instance
    expect(client.device()).to.equal(device);

    await flushAsync();
    // loading a fresh device persists its generated identifiers
    expect(storage.dump()['ably.push.deviceId']).to.equal(device.id);
  });

  it('create() rejects a storage missing required methods', function () {
    expect(() =>
      ReactNativePush.create({
        storage: { getItem: async () => null } as any,
        requestToken: async () => ({ transportType: 'fcm' as const, token: 't' }),
      }),
    ).to.throw(TypeError, /getItem\/setItem\/removeItem/);
  });

  it('rejects activation when requestToken returns a malformed result', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage, { token: { transportType: 'web', token: '' } as any });

    let thrown: any;
    try {
      await client.push.activate();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.exist;
    expect(thrown.code).to.equal(50000);
    expect(thrown.message).to.match(/requestToken must return/);
    expect(captured).to.have.length(0);
  });

  it('rejects activation when requestToken fails and returns to NotActivated', async function () {
    const captured = mockRegistrationServer();
    const storage = new FakeAsyncStorage();
    const client = rnClient(storage, {
      token: async () => {
        throw new Error('permission denied');
      },
    });

    let thrown: any;
    try {
      await client.push.activate();
    } catch (err) {
      thrown = err;
    }
    expect(thrown).to.exist;
    expect(thrown.code).to.equal(50000);
    expect(thrown.message).to.match(/permission denied/);
    expect(captured).to.have.length(0);

    await flushAsync();
    expect(storage.dump()['ably.push.activationState']).to.equal('NotActivated');
  });

  it('getDevice() with synchronous (web-style) storage returns the same device as device()', async function () {
    mockRegistrationServer();
    const syncData = new Map<string, string>();
    Platform.Config.push = {
      platform: 'browser' as any,
      formFactor: 'desktop' as any,
      storage: {
        get: (name: string) => (syncData.has(name) ? syncData.get(name)! : (null as any)),
        set: (name: string, value: string) => void syncData.set(name, value),
        remove: (name: string) => void syncData.delete(name),
      },
    };

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { Push: WebPushPlugin },
    });

    const device = await client.getDevice();
    expect(client.device()).to.equal(device);
    expect(syncData.get('ably.push.deviceId')).to.equal(device.id);
  });
});
