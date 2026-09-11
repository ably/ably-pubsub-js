/**
 * UTS: Push Activation Persistence Tests
 *
 * Spec points: RSH3h, RSH3a2c, RSH8a, RSH8a1, RSH8b, RSH8c
 * Source: uts/rest/unit/push/push_activation_persistence.md
 *
 * The persistence seam of push activation: what the SDK loads from storage on a
 * fresh start (RSH3h, RSH8a, RSH3a2c), recovery from corrupt or partial persisted
 * state (RSH8a1), behaviour when persistence itself fails (RSH8b), and when the
 * registration outcome is persisted (RSH8c).
 *
 * Black-box: events are produced by driving the public API and by responding to
 * the mocked HTTP requests; state is observed through behaviour and, after
 * operations settle, through the persisted ably.push.* keys.
 */

import { expect } from 'chai';
import { restoreAll } from '../../../helpers';
import {
  MockPushStorage,
  mockRegistrationServer,
  pushClient,
  waitFor,
  rejectionOf,
  installReactNativeFake,
  restoreReactNativeFake,
} from './push_helpers';

describe('uts/rest/unit/push/push_activation_persistence', function () {
  before(function () {
    installReactNativeFake();
  });

  after(function () {
    restoreReactNativeFake();
  });

  afterEach(function () {
    restoreAll();
  });

  // UTS: rest/unit/RSH8a1/corrupt-device-state-discarded-0
  it('RSH8a1 - corrupt persisted device state discards all persisted state', async function () {
    // DEVIATION(RSH8a1-discard): ably-js does not discard persisted state when the
    // id/deviceSecret pair is incomplete — loadPersistedAsync() loads the seeded id with
    // an undefined deviceSecret and the stale identity token, so the machine treats the
    // device as already registered and activate() resolves with no token request and no
    // HTTP request at all (no fresh POST registration, no discarding of the seeded id).
    if (!process.env.RUN_DEVIATIONS) this.skip();

    let tokenRequests = 0;
    const capturedRequests = mockRegistrationServer();
    const storage = new MockPushStorage();
    storage.seed({
      'ably.push.deviceId': 'seeded-device-1',
      // deviceSecret missing — the id/secret pair is incomplete, so the device load must fail
      'ably.push.deviceIdentityToken': '"stale-token"',
      'ably.push.activationState': 'WaitingForNewPushDeviceDetails',
    });
    const client = pushClient(storage, {
      requestToken: async () => {
        tokenRequests += 1;
        return { transportType: 'fcm', token: 'fcm-token-1' };
      },
    });

    await client.push.activate();
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );

    // Full first-time registration — not the registration sync the stale state would imply
    expect(tokenRequests).to.equal(1);
    expect(capturedRequests.length).to.equal(1);
    const request = capturedRequests[0];
    expect(request.method).to.equal('post');
    expect(request.path).to.equal('/push/deviceRegistrations');

    // RSH8a1 (1) — the seeded device identity was discarded; a fresh id was generated
    const body = JSON.parse(request.body);
    expect(body.id).to.not.equal('seeded-device-1');

    // The stale identity token was discarded and replaced by the registration result
    const persisted = storage.dump();
    expect(persisted['ably.push.deviceId']).to.not.equal('seeded-device-1');
    expect(JSON.parse(persisted['ably.push.deviceIdentityToken'])).to.equal('ident-token-1');
  });

  // UTS: rest/unit/RSH8a1/corrupt-machine-state-recovers-1
  it('RSH8a1 - corrupt persisted machine state recovers without crashing', async function () {
    // DEVIATION(RSH8a1-corrupt-machine-state): ably-js rehydration does
    // `new ActivationStates[persistedName](null)` (ensureInitialized(), pushactivation.ts),
    // so an unrecognised state name makes activate() reject with a TypeError rather than
    // falling back to NotActivated per RSH3h. Note also that even the spec's fallback path
    // would deviate: ably-js performs no re-activation sync at all — activate() over a
    // registered device resolves with no PATCH (the RSH3a2a validation sync asserted below
    // does not exist in ably-js).
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const capturedRequests = mockRegistrationServer();
    const storage = new MockPushStorage();
    storage.seed({
      'ably.push.deviceId': 'seeded-device-1',
      'ably.push.deviceSecret': 'seeded-secret',
      'ably.push.deviceIdentityToken': '"seeded-ident-token"',
      'ably.push.pushRecipient': '{"transportType":"fcm","registrationToken":"seeded-token-1"}',
      'ably.push.activationState': 'BogusStateName',
    });
    const client = pushClient(storage);

    // Must not crash: the machine falls back to NotActivated (RSH3h), where the
    // registered device (it has a deviceIdentityToken) is validated per RSH3a2a
    await client.push.activate();

    expect(capturedRequests.length).to.equal(1);
    const request = capturedRequests[0];
    expect(request.method).to.equal('patch');
    expect(request.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent('seeded-device-1'));
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );
  });

  // UTS: rest/unit/RSH3a2c/existing-push-details-skip-token-request-0
  it('RSH3a2c - persisted push details skip the platform token request', async function () {
    let tokenRequests = 0;
    const capturedRequests = mockRegistrationServer();
    const storage = new MockPushStorage();
    storage.seed({
      'ably.push.deviceId': 'seeded-device-1',
      'ably.push.deviceSecret': 'seeded-secret',
      // no deviceIdentityToken — the device is not yet registered
      'ably.push.pushRecipient': '{"transportType":"fcm","registrationToken":"persisted-token-1"}',
      'ably.push.activationState': 'NotActivated',
    });
    const client = pushClient(storage, {
      requestToken: async () => {
        tokenRequests += 1;
        return { transportType: 'fcm', token: 'unexpected-token' };
      },
    });

    await client.push.activate();
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );

    // RSH3a2c — the platform was not consulted
    expect(tokenRequests).to.equal(0);

    expect(capturedRequests.length).to.equal(1);
    const request = capturedRequests[0];
    expect(request.method).to.equal('post');
    expect(request.path).to.equal('/push/deviceRegistrations');

    const body = JSON.parse(request.body);
    // RSH3a2b — id and deviceSecret already exist, so they are not regenerated
    expect(body.id).to.equal('seeded-device-1');
    // RSH8a — the recipient came from persisted state
    expect(body.push.recipient).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'persisted-token-1',
    });
  });

  // UTS: rest/unit/RSH8b/persist-failure-fails-activate-then-recovers-0
  it('RSH8b - a persistence failure fails activate; activation recovers once it clears', async function () {
    const capturedRequests = mockRegistrationServer();
    const storage = new MockPushStorage();
    storage.failWrites = true;
    const client = pushClient(storage);

    // The generated identifiers cannot be persisted: activation fails, no HTTP request
    const err = await rejectionOf(client.push.activate());
    expect(err).to.exist;
    expect(capturedRequests.length).to.equal(0);

    // Once storage works again, the SAME client can activate: the failed device
    // load must not be cached
    storage.failWrites = false;
    await client.push.activate();

    expect(capturedRequests.length).to.equal(1);
    expect(capturedRequests[0].method).to.equal('post');
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );
  });

  // UTS: rest/unit/RSH8c/identity-token-persisted-only-after-registration-0
  it('RSH8c - deviceIdentityToken is persisted only after successful registration', async function () {
    let heldPost: any = null;
    mockRegistrationServer((req) => {
      if (req.method === 'post' && req.path === '/push/deviceRegistrations' && heldPost === null) {
        heldPost = req; // hold the registration open
        return true;
      }
      return false;
    });
    const storage = new MockPushStorage();
    const client = pushClient(storage);

    const activation = client.push.activate();
    await waitFor(() => heldPost !== null, 'the registration POST');

    // Registration in flight: the identity token must not be persisted yet
    expect(storage.dump()).to.not.have.property('ably.push.deviceIdentityToken');

    heldPost.respond_with(201, { ...JSON.parse(heldPost.body), deviceIdentityToken: { token: 'ident-token-1' } });
    await activation;

    // After activate resolves and the fire-and-forget writes settle
    await waitFor(
      () => storage.dump()['ably.push.deviceIdentityToken'] != null,
      'the deviceIdentityToken to be persisted',
    );
    expect(JSON.parse(storage.dump()['ably.push.deviceIdentityToken'])).to.equal('ident-token-1');
  });

  // UTS: rest/unit/RSH3h/no-persisted-state-starts-not-activated-0
  it('RSH3h - with no persisted state the machine starts in NotActivated', async function () {
    const capturedRequests = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = pushClient(storage);

    // NotActivated is the initial state: deactivate resolves immediately (RSH3a1d)
    await client.push.deactivate(undefined as any);
    expect(capturedRequests.length).to.equal(0);

    // and activate runs the full first-time registration flow from NotActivated
    await client.push.activate();
    expect(capturedRequests.length).to.equal(1);
    expect(capturedRequests[0].method).to.equal('post');
    expect(capturedRequests[0].path).to.equal('/push/deviceRegistrations');
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );
  });
});
