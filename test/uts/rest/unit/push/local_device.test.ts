/**
 * UTS: LocalDevice Tests
 *
 * Spec points: RSH8, RSH8a, RSH8d, RSH8e, RSH8f, RSH8k, RSH8k1, RSH8k2
 * Source: uts/rest/unit/push/local_device.md
 *
 * The device accessor (RSH8) and the LocalDevice attributes: population after a
 * full activation (RSH8k/RSH8k1/RSH8k2), pure load from persisted state (RSH8a),
 * clientId adoption from the registration response (RSH8f), and the late-identified
 * client flow (RSH8d/RSH8e).
 *
 * Per the spec's Notes, `AWAIT client.device()` maps to ably-js's async
 * `await client.getDevice()` (push storage is asynchronous in the React Native
 * plugin; the sync `device()` throws pre-hydration).
 */

import { expect } from 'chai';
import { restoreAll } from '../../../helpers';
import {
  MockPushStorage,
  mockRegistrationServer,
  pushClient,
  activateInto,
  waitFor,
  installReactNativeFake,
  restoreReactNativeFake,
} from './push_helpers';

/**
 * UTS `late_identified_client(storage)`: a client using token auth via authCallback,
 * so that its identity can change after construction (RSA7b2/RSA7b3): the first token
 * is anonymous, every later token is identified as "alice". No HTTP is involved — the
 * callback returns TokenDetails directly (RSA8d).
 *
 * The TokenDetails carry `issued`/`expires`: ably-js's requestToken() classifies the
 * callback result as TokenDetails by the presence of an `issued` field (auth.ts), and
 * without `expires` a token older than a minute would be discarded as expired.
 */
function lateIdentifiedClient(storage: MockPushStorage): any {
  let authCalls = 0;
  return pushClient(storage, {
    clientOptions: {
      authCallback: (_tokenParams: any, callback: (err: any, tokenDetails: any) => void) => {
        authCalls += 1;
        const validity = { issued: Date.now(), expires: Date.now() + 60 * 60 * 1000 };
        if (authCalls === 1) {
          callback(null, { token: 'anon-token-1', ...validity });
        } else {
          callback(null, { token: 'alice-token-1', clientId: 'alice', ...validity });
        }
      },
    },
  });
}

describe('uts/rest/unit/push/local_device', function () {
  before(function () {
    installReactNativeFake();
  });

  after(function () {
    restoreReactNativeFake();
  });

  afterEach(function () {
    restoreAll();
  });

  // UTS: rest/unit/RSH8/device-returns-local-device-0
  it('RSH8 - the device accessor returns the activated LocalDevice', async function () {
    mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = await activateInto(storage);

    const device = await client.getDevice();

    const persisted = storage.dump();
    expect(device.id).to.equal(persisted['ably.push.deviceId']);
    expect(device.deviceSecret).to.exist; // RSH8k2
    expect(device.deviceIdentityToken).to.equal('ident-token-1'); // RSH8k1
    expect(device.platform).to.equal('android');
    expect(device.formFactor).to.equal('phone');
    expect(device.push.recipient).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-1',
    });
  });

  // UTS: rest/unit/RSH8a/device-populated-from-persisted-state-0
  it('RSH8a - LocalDevice is populated from persisted state without any request', async function () {
    const capturedRequests = mockRegistrationServer();
    const storage = new MockPushStorage();
    await activateInto(storage); // client1: register and persist
    const persisted = storage.dump();

    // A fresh client over the same storage simulates an app restart
    const client2 = pushClient(storage);
    const requestsBefore = capturedRequests.length;
    const device = await client2.getDevice();

    expect(device.id).to.equal(persisted['ably.push.deviceId']);
    expect(device.deviceSecret).to.equal(persisted['ably.push.deviceSecret']);
    expect(device.deviceIdentityToken).to.equal('ident-token-1');
    expect(device.push.recipient).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-1',
    });

    // The device accessor made no HTTP request of its own
    expect(capturedRequests.length).to.equal(requestsBefore);
  });

  // UTS: rest/unit/RSH8k1/device-identity-token-null-before-registration-0
  it('RSH8k1 - deviceIdentityToken is null before registration', async function () {
    mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = pushClient(storage);

    const device = await client.getDevice();

    expect(device.deviceIdentityToken).to.not.exist;
    // Deliberately no assertion on device.id / device.deviceSecret — see spec Notes
  });

  // UTS: rest/unit/RSH8f/clientid-from-registration-response-0
  it('RSH8f - clientId from the registration response is set on the LocalDevice', async function () {
    // DEVIATION(RSH8f): ably-js does not apply a clientId returned in the registration
    // response to the LocalDevice — GotDeviceRegistration captures only the
    // deviceIdentityToken from the response body (src/plugins/push/pushactivation.ts),
    // so device.clientId remains unset.
    if (!process.env.RUN_DEVIATIONS) this.skip();

    mockRegistrationServer((req) => {
      if (req.method === 'post' && req.path === '/push/deviceRegistrations') {
        req.respond_with(201, {
          ...JSON.parse(req.body),
          deviceIdentityToken: { token: 'ident-token-1' },
          clientId: 'client-from-server',
        });
        return true;
      }
      return false;
    });
    const storage = new MockPushStorage();
    const client = pushClient(storage); // no clientId — unidentified (RSA7)

    await client.push.activate();
    const device = await client.getDevice();

    expect(device.clientId).to.equal('client-from-server');
  });

  // UTS: rest/unit/RSH8d/late-clientid-persisted-0
  it('RSH8d - a clientId acquired after registration is set and persisted', async function () {
    // DEVIATION(RSH8d): ably-js has no late-identification plumbing — it does not derive
    // auth.clientId from TokenDetails at all (ably-js issue #2192), and there is no hook
    // from auth into the LocalDevice, so the clientId is never set or persisted.
    if (!process.env.RUN_DEVIATIONS) this.skip();

    mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = lateIdentifiedClient(storage);

    await client.push.activate();
    const device = await client.getDevice();
    expect(device.deviceIdentityToken).to.equal('ident-token-1');
    expect(device.clientId).to.not.exist; // registered while unidentified

    // The client becomes identified: the second token carries clientId "alice" (RSA7b2)
    const tokenDetails = await client.auth.authorize();
    expect(tokenDetails.clientId).to.equal('alice');

    // RSH8d — the LocalDevice clientId is set...
    await waitFor(() => device.clientId === 'alice', 'the LocalDevice clientId to be set');

    // ...and persisted: a fresh client over the same storage sees it (polled, because
    // persistence may settle asynchronously after the clientId is set)
    let device2: any = null;
    for (let i = 0; i < 50 && !device2; i++) {
      const d = await pushClient(storage).getDevice();
      if (d.clientId === 'alice') {
        device2 = d;
      }
    }
    if (!device2) {
      throw new Error('timed out waiting for the persisted clientId to be visible to a fresh client');
    }
    expect(device2.id).to.equal(device.id);
    expect(device2.clientId).to.equal('alice');
  });

  // UTS: rest/unit/RSH8e/late-clientid-triggers-sync-0
  it('RSH8e - a late clientId on a registered device triggers a registration sync', async function () {
    // DEVIATION(RSH8e): depends on the RSH8d late-identification plumbing, which ably-js
    // lacks (issue #2192) — no GotPushDeviceDetails event is ever fired on late
    // identification, so no registration sync PATCH is made.
    // Note also DEVIATION(device-auth-header): were the sync to happen, ably-js
    // authenticates device-authenticated requests with an `authorization: Bearer
    // base64(deviceIdentityToken)` header rather than the RSH6a X-Ably-DeviceToken
    // header asserted below (see the spec's Notes on device authentication).
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const capturedRequests = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = lateIdentifiedClient(storage);

    await client.push.activate(); // registered; machine in WaitingForNewPushDeviceDetails
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );
    const deviceId = storage.dump()['ably.push.deviceId'];

    await client.auth.authorize(); // client becomes identified as "alice" (RSA7b2), RSH8d sets clientId

    // RSH8e — GotPushDeviceDetails is sent once the clientId is set, observable
    // as the RSH3d3b registration sync
    await waitFor(() => capturedRequests.some((req) => req.method === 'patch'), 'the RSH3d3b registration sync PATCH');
    const patch = capturedRequests.filter((req) => req.method === 'patch')[0];

    expect(patch.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));

    // RSH3d3b + RSH6a — push device authentication
    expect(patch.headers['X-Ably-DeviceToken']).to.equal('ident-token-1');

    // The sync completes and the machine settles back into WaitingForNewPushDeviceDetails
    // (RSH3d3d -> WaitingForRegistrationSync, then RegistrationSynced -> RSH3e2a)
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'the machine to settle back into WaitingForNewPushDeviceDetails',
    );
  });
});
