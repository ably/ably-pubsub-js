/**
 * Push Activation State Machine tests
 *
 * Spec points: RSH2a, RSH2b, RSH3a1c, RSH3a1d, RSH3a2a, RSH3a2a1, RSH3a2a2, RSH3a2a3, RSH3a2a4,
 * RSH3a2b, RSH3a2c, RSH3a2d, RSH3a2e, RSH3a3a, RSH3b1a, RSH3b2a, RSH3b2b, RSH3b3a, RSH3b3b,
 * RSH3b3c, RSH3b3d, RSH3b4a, RSH3b4b, RSH3c1a, RSH3c2a, RSH3c2b, RSH3c2c, RSH3c3a, RSH3c3b,
 * RSH3d1a, RSH3d1b, RSH3d2a, RSH3d2b, RSH3d2c, RSH3d2c1, RSH3d2d, RSH3e1a, RSH3e1b, RSH3e2a,
 * RSH3e2b, RSH3e3b, RSH3e3c, RSH3f1a, RSH3f2a, RSH3g1a, RSH3g2a, RSH3g2b, RSH3g2c, RSH3g3a,
 * RSH3g3b, RSH6a, RSH8h
 *
 * Source: uts/rest/unit/push/push_activation_state_machine.md
 *
 * Black-box tests of the activation state machine, driven through push.activate()/deactivate()
 * with mocked HTTP (mockRegistrationServer) and a mocked push platform (MockPushStorage +
 * requestToken via the ReactNativePush plugin).
 *
 * UTS harness adaptations (not deviations):
 * - registerCallback/deregisterCallback use ably-js's CPS signature (device, callback) rather
 *   than the UTS return-value form; deregisterCallback receives the whole device, so the
 *   "deviceId passed to the callback" is read as device.id.
 * - Device auth (RSH6a): ably-js authenticates device requests with an
 *   `authorization: Bearer base64(deviceIdentityToken)` header rather than X-Ably-DeviceToken;
 *   per the spec file's Notes this is an adapt-with-deviation — the adapted check asserts the
 *   authorization header, and the literal X-Ably-DeviceToken assertion runs under RUN_DEVIATIONS.
 */

import { expect } from 'chai';
import { restoreAll } from '../../../helpers';
import {
  MockPushStorage,
  deferred,
  mockRegistrationServer,
  pushClient,
  activateInto,
  waitFor,
  flush,
  rejectionOf,
  installReactNativeFake,
  restoreReactNativeFake,
} from './push_helpers';

/** Settle an operation's outcome without risking an unhandled rejection while other awaits run. */
function outcomeOf(promise: Promise<unknown>): Promise<{ resolved: boolean; err?: any }> {
  return promise.then(
    () => ({ resolved: true }),
    (err) => ({ resolved: false, err }),
  );
}

describe('uts/rest/unit/push/push_activation_state_machine', function () {
  this.timeout(10000);

  before(installReactNativeFake);
  after(restoreReactNativeFake);
  afterEach(restoreAll);

  // UTS: rest/unit/RSH2a/activate-full-flow-0
  it('RSH2a - activate performs the full registration flow', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = pushClient(mockStorage);

    await client.push.activate();
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state WaitingForNewPushDeviceDetails',
    );

    expect(captured.length).to.equal(1);

    const request = captured[0];
    expect(request.method).to.equal('post');
    expect(request.path).to.equal('/push/deviceRegistrations');

    const body = JSON.parse(request.body);
    // RSH3b3b — the LocalDevice with push details and deviceSecret
    expect(body.id).to.not.be.oneOf([null, undefined]);
    expect(body.deviceSecret).to.not.be.oneOf([null, undefined]);
    expect(body.platform).to.equal('android');
    expect(body.formFactor).to.equal('phone');
    expect(body.push.recipient).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-1',
    });

    // RSH3c2a + RSH8c — the registration response was applied and persisted
    const persisted = mockStorage.dump();
    expect(persisted['ably.push.deviceId']).to.equal(body.id);
    expect(persisted['ably.push.deviceSecret']).to.not.be.oneOf([null, undefined]);
    expect(JSON.parse(persisted['ably.push.deviceIdentityToken'])).to.equal('ident-token-1');
    expect(JSON.parse(persisted['ably.push.pushRecipient'])).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-1',
    });
  });

  // UTS: rest/unit/RSH3a2b/device-id-secret-generation-0
  it('RSH3a2b - generated device identifiers are unique and the secret has sufficient entropy', async function () {
    mockRegistrationServer();
    const storageA = new MockPushStorage();
    const storageB = new MockPushStorage();

    await pushClient(storageA).push.activate();
    await pushClient(storageB).push.activate();
    await waitFor(() => storageA.dump()['ably.push.deviceId'] != null, 'storage A deviceId');
    await waitFor(() => storageB.dump()['ably.push.deviceId'] != null, 'storage B deviceId');

    const a = storageA.dump();
    const b = storageB.dump();

    // Unique per device
    expect(a['ably.push.deviceId']).to.not.equal(b['ably.push.deviceId']);
    expect(a['ably.push.deviceSecret']).to.not.equal(b['ably.push.deviceSecret']);

    expect(a['ably.push.deviceSecret']).to.be.a('string').and.to.not.be.empty;
    if (process.env.RUN_DEVIATIONS) {
      // DEVIATION(device-secret-entropy): ably-js generates deviceSecret as a ulid (26-char
      // Crockford base32, ~16 bytes of entropy), not a base64-encoded digest of >= 32 bytes
      const decoded = Buffer.from(a['ably.push.deviceSecret'], 'base64');
      expect(decoded.length).to.be.at.least(32);
    }
  });

  // UTS: rest/unit/RSH3b3a/activate-register-callback-0
  it('RSH3b3a - activate with a custom registerCallback routes registration through the callback', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = pushClient(mockStorage);

    const registeredDevices: any[] = [];
    const registerCallback = (device: any, callback: any) => {
      registeredDevices.push(device);
      callback(null, { deviceIdentityToken: { token: 'custom-ident-1' } });
    };

    await client.push.activate(registerCallback);
    await waitFor(() => mockStorage.dump()['ably.push.deviceIdentityToken'] != null, 'deviceIdentityToken persisted');

    // Registration went through the callback, not HTTP
    expect(captured.length).to.equal(0);
    expect(registeredDevices.length).to.equal(1);
    expect(registeredDevices[0].push.recipient).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-1',
    });

    // RSH8c — the callback's identity token was persisted
    expect(JSON.parse(mockStorage.dump()['ably.push.deviceIdentityToken'])).to.equal('custom-ident-1');
  });

  // UTS: rest/unit/RSH3c3a/registration-failure-0
  it('RSH3c3a - failed registration fails activate and returns to NotActivated', async function () {
    let failRegistration = true;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'post' && req.path === '/push/deviceRegistrations' && failRegistration) {
        req.respond_with(400, { error: { message: 'registration rejected', code: 40198, statusCode: 400 } });
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    const client = pushClient(mockStorage);

    const error = await rejectionOf(client.push.activate());
    expect(error.code).to.equal(40198);
    expect(captured.length).to.equal(1);
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');

    // RSH3c3b — from NotActivated, activation can be retried successfully
    failRegistration = false;
    await client.push.activate();
    expect(captured.length).to.equal(2);
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'WaitingForNewPushDeviceDetails persisted',
    );
  });

  // UTS: rest/unit/RSH3b4a/token-failure-0
  it('RSH3b4a - failed token acquisition fails activate and returns to NotActivated', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = pushClient(mockStorage, {
      requestToken: async () => {
        throw new Error('permission denied');
      },
    });

    const error = await rejectionOf(client.push.activate());
    expect(error.message).to.contain('permission denied');

    // No registration was attempted
    expect(captured.length).to.equal(0);
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
  });

  // UTS: rest/unit/RSH3a2a3/activate-existing-registration-sync-0
  it('RSH3a2a3 - activate on an already-registered device syncs the registration via PATCH', async function () {
    // DEVIATION(no-reactivation-sync): ably-js performs no RSH3a2a validation — a fresh client
    // over registered storage resolves activate() immediately with no PATCH/PUT request
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    // A fresh client over the same storage simulates an app restart
    const client = pushClient(mockStorage);
    await client.push.activate();
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'WaitingForNewPushDeviceDetails persisted',
    );

    // One POST from the seeding activation, then exactly one sync PATCH — no second POST
    expect(captured.length).to.equal(2);
    const request = captured[1];
    expect(request.method).to.equal('patch');
    expect(request.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));

    // RSH3d3b — changed fields only, with the complete recipient
    const body = JSON.parse(request.body);
    expect(body.push.recipient).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-1',
    });
  });

  // UTS: rest/unit/RSH3a2a2/activate-existing-registration-register-callback-0
  it('RSH3a2a2 - activate on an already-registered device with a custom registerCallback', async function () {
    // DEVIATION(no-reactivation-sync): ably-js performs no RSH3a2a validation on a fresh client
    // over registered storage — activate() resolves immediately without calling registerCallback
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    const registeredDevices: any[] = [];
    const registerCallback = (device: any, callback: any) => {
      registeredDevices.push(device);
      callback(null, { deviceIdentityToken: { token: 'ident-token-1' } });
    };

    const client = pushClient(mockStorage);
    await client.push.activate(registerCallback);

    // The validation went through the callback: no requests beyond the seeding POST
    expect(captured.length).to.equal(1);
    expect(registeredDevices.length).to.equal(1);
    expect(registeredDevices[0].id).to.equal(deviceId);
  });

  // UTS: rest/unit/RSH3a2a1/activate-clientid-mismatch-0
  it('RSH3a2a1 - activate fails with 61002 when the client identity conflicts with the registered device', async function () {
    // DEVIATION(no-reactivation-sync): ably-js does not persist the registered device's clientId
    // (LocalDevice.clientId is always overwritten with the current client's auth.clientId on
    // load), so the RSH3a2a1 61002 check never fires — activate() resolves immediately
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    await activateInto(mockStorage, { clientId: 'alice' });

    const client = pushClient(mockStorage, { clientId: 'bob' });
    const error = await rejectionOf(client.push.activate());
    expect(error.code).to.equal(61002);

    // No validation request was made — only the seeding POST
    expect(captured.length).to.equal(1);
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'AfterRegistrationSyncFailed',
      'AfterRegistrationSyncFailed persisted',
    );
  });

  // UTS: rest/unit/RSH3d1a/activate-when-registered-resolves-0
  it('RSH3d1a - activate when already registered in the same session resolves without any request', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);

    await client.push.activate();

    // No additional request beyond the original registration POST
    expect(captured.length).to.equal(1);
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'WaitingForNewPushDeviceDetails persisted',
    );
  });

  // UTS: rest/unit/RSH3b1a/activate-while-waiting-push-details-0
  it('RSH3b1a - repeated activate while waiting for push device details is idempotent', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();

    const tokenDeferred = deferred<any>();
    let tokenRequests = 0;
    const client = pushClient(mockStorage, {
      requestToken: () => {
        tokenRequests += 1;
        return tokenDeferred.future;
      },
    });

    const first = client.push.activate(); // pends on requestToken
    const second = outcomeOf(client.push.activate()); // RSH3b1a — self-transition

    tokenDeferred.complete({ transportType: 'fcm', token: 'fcm-token-1' });

    await first;
    const secondOutcome = await second;
    if (process.env.RUN_DEVIATIONS) {
      // DEVIATION(concurrent-activate-rejected): ably-js rejects a second activate() while one is
      // in flight (40000 'Activation already in progress') instead of resolving both per RSH3b1a
      expect(secondOutcome.resolved).to.equal(true);
    } else {
      expect(secondOutcome.resolved).to.equal(false);
      expect(secondOutcome.err.code).to.equal(40000);
      expect(secondOutcome.err.message).to.match(/already in progress/);
    }

    expect(tokenRequests).to.equal(1);
    expect(captured.length).to.equal(1);
    expect(captured[0].method).to.equal('post');
  });

  // UTS: rest/unit/RSH3b2a/deactivate-while-waiting-push-details-0
  it('RSH3b2a - deactivate while waiting for push device details returns to NotActivated', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();

    const tokenDeferred = deferred<any>();
    const client = pushClient(mockStorage, { requestToken: () => tokenDeferred.future });

    const activation = client.push.activate(); // pends on requestToken
    void activation.catch(() => {}); // never settles in ably-js; guard against a surprise rejection

    await client.push.deactivate(); // RSH3b2a — resolves with no error
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');

    // The token arrives late: RSH3a3a — consumed in NotActivated, no registration
    tokenDeferred.complete({ transportType: 'fcm', token: 'fcm-token-1' });

    // allow any erroneous request to surface (UTS poll_until(() => false, ...))
    for (let i = 0; i < 5; i++) {
      await flush();
    }
    expect(captured.length).to.equal(0);
    expect(mockStorage.dump()['ably.push.activationState']).to.equal('NotActivated');
  });

  // UTS: rest/unit/RSH3c1a/activate-while-registering-0
  it('RSH3c1a - repeated activate while device registration is in flight is idempotent', async function () {
    let heldPost: any = null;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'post' && req.path === '/push/deviceRegistrations' && heldPost == null) {
        heldPost = req; // hold the registration open
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    const client = pushClient(mockStorage);

    const first = client.push.activate();
    await waitFor(() => heldPost != null, 'the held registration POST');

    const second = outcomeOf(client.push.activate()); // RSH3c1a — self-transition, no second POST

    heldPost.respond_with(201, { ...JSON.parse(heldPost.body), deviceIdentityToken: { token: 'ident-token-1' } });

    await first;
    const secondOutcome = await second;
    if (process.env.RUN_DEVIATIONS) {
      // DEVIATION(concurrent-activate-rejected): ably-js rejects a second activate() while one is
      // in flight (40000 'Activation already in progress') instead of resolving both per RSH3c1a
      expect(secondOutcome.resolved).to.equal(true);
    } else {
      expect(secondOutcome.resolved).to.equal(false);
      expect(secondOutcome.err.code).to.equal(40000);
      expect(secondOutcome.err.message).to.match(/already in progress/);
    }

    expect(captured.length).to.equal(1);
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'WaitingForNewPushDeviceDetails persisted',
    );
  });

  // UTS: rest/unit/RSH2b/deactivate-full-flow-0
  it('RSH2b - deactivate deregisters the device and clears local state', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    await client.push.deactivate();
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');

    expect(captured.length).to.equal(2);
    const request = captured[1];
    expect(request.method).to.equal('delete');
    expect(request.path).to.equal('/push/deviceRegistrations');
    expect(request.url.searchParams.get('deviceId')).to.equal(deviceId);
    expect(request.params.deviceId).to.equal(deviceId);

    // RSH3d2b + RSH6a — push device authentication. Adapted check: ably-js authenticates the
    // device with an authorization Bearer header carrying base64(deviceIdentityToken).
    expect(request.headers.authorization).to.equal('Bearer ' + Buffer.from('ident-token-1').toString('base64'));
    if (process.env.RUN_DEVIATIONS) {
      // DEVIATION(device-auth-header): ably-js sends no X-Ably-DeviceToken header (RSH6a)
      expect(request.headers['X-Ably-DeviceToken'] ?? request.headers['x-ably-devicetoken']).to.equal('ident-token-1');
    }

    // RSH3g2a — the registered identity is cleared from storage, not just memory
    const persisted = mockStorage.dump();
    expect(persisted).to.not.have.property('ably.push.deviceIdentityToken');
    expect(persisted).to.not.have.property('ably.push.pushRecipient');
  });

  // UTS: rest/unit/RSH3d2a/deactivate-deregister-callback-0
  it('RSH3d2a - deactivate with a custom deregisterCallback routes deregistration through the callback', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    const deregisteredIds: string[] = [];
    const deregisterCallback = (device: any, callback: any) => {
      deregisteredIds.push(device.id);
      callback(null);
    };

    await client.push.deactivate(deregisterCallback);

    // Deregistration went through the callback: no DELETE
    expect(captured.length).to.equal(1); // just the seeding POST
    expect(deregisteredIds).to.deep.equal([deviceId]);
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
  });

  // UTS: rest/unit/RSH3a1c/deactivate-not-activated-with-token-0
  it('RSH3a1c - deactivate from NotActivated with a registered device still deregisters', async function () {
    // DEVIATION(no-deregister-from-notactivated): ably-js's NotActivated state resolves
    // CalledDeactivate immediately without checking deviceIdentityToken — no DELETE is issued
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    mockStorage.seed({
      'ably.push.deviceId': 'seeded-device-1',
      'ably.push.deviceSecret': 'seeded-secret',
      'ably.push.deviceIdentityToken': '"seeded-ident-token"',
      'ably.push.activationState': 'NotActivated',
    });
    const client = pushClient(mockStorage);

    await client.push.deactivate();

    expect(captured.length).to.equal(1);
    const request = captured[0];
    expect(request.method).to.equal('delete');
    expect(request.url.searchParams.get('deviceId')).to.equal('seeded-device-1');
    expect(request.headers['X-Ably-DeviceToken'] ?? request.headers['x-ably-devicetoken']).to.equal(
      'seeded-ident-token',
    );
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
  });

  // UTS: rest/unit/RSH3a1d/deactivate-not-activated-0
  it('RSH3a1d - deactivate from NotActivated with no registration resolves without any request', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = pushClient(mockStorage);

    await client.push.deactivate();

    expect(captured.length).to.equal(0);
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
  });

  // UTS: rest/unit/RSH3d2c1/deregister-401-succeeds-0
  it('RSH3d2c1 - deregistration treats 401 as success', async function () {
    // DEVIATION(deregister-status-classification): ably-js does not implement RSH3d2c1 — any
    // non-2xx DELETE response (including 401) fires DeregistrationFailed, so deactivate() rejects
    // and the registration is not cleared
    if (!process.env.RUN_DEVIATIONS) this.skip();

    mockRegistrationServer((req) => {
      if (req.method === 'delete') {
        req.respond_with(401, { error: { message: 'unauthorized', code: 40100, statusCode: 401 } });
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);

    await client.push.deactivate(); // resolves despite the 401

    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
    const persisted = mockStorage.dump();
    expect(persisted).to.not.have.property('ably.push.deviceIdentityToken');
  });

  // UTS: rest/unit/RSH3d2c1/deregister-40005-succeeds-1
  it('RSH3d2c1 - deregistration treats error code 40005 as success', async function () {
    // DEVIATION(deregister-status-classification): ably-js does not implement RSH3d2c1 — a DELETE
    // failing with error code 40005 fires DeregistrationFailed, so deactivate() rejects
    if (!process.env.RUN_DEVIATIONS) this.skip();

    mockRegistrationServer((req) => {
      if (req.method === 'delete') {
        req.respond_with(400, { error: { message: 'invalid credentials', code: 40005, statusCode: 400 } });
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);

    await client.push.deactivate(); // resolves despite the 40005

    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
  });

  // UTS: rest/unit/RSH3g3b/deregister-failure-rollback-0
  it('RSH3g3b - deregistration failure fails deactivate and rolls back to the previous state', async function () {
    let failDelete = true;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'delete' && failDelete) {
        // a non-retriable 4xx: a 5xx would additionally exercise RSC15 fallback-host retries
        req.respond_with(400, { error: { message: 'deregistration rejected', code: 40198, statusCode: 400 } });
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);

    const error = await rejectionOf(client.push.deactivate());
    expect(error.code).to.equal(40198);

    // RSH3g3b — still registered: the identity token survives the failed deregistration
    expect(mockStorage.dump()['ably.push.deviceIdentityToken']).to.not.be.oneOf([null, undefined]);

    // Retry succeeds from the rolled-back state
    failDelete = false;
    await client.push.deactivate();
    expect(captured.length).to.equal(3); // POST + failed DELETE + successful DELETE
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
  });

  // UTS: rest/unit/RSH3g1a/deactivate-while-deregistering-0
  it('RSH3g1a - repeated deactivate while deregistration is in flight is idempotent', async function () {
    let heldDelete: any = null;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'delete' && heldDelete == null) {
        heldDelete = req; // hold the deregistration open
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);

    const first = client.push.deactivate();
    await waitFor(() => heldDelete != null, 'the held deregistration DELETE');

    const second = outcomeOf(client.push.deactivate()); // RSH3g1a — self-transition, no second DELETE

    heldDelete.respond_with(204, '');

    await first;
    const secondOutcome = await second;
    if (process.env.RUN_DEVIATIONS) {
      // DEVIATION(concurrent-deactivate-rejected): ably-js rejects a second deactivate() while one
      // is in flight (40000 'Deactivation already in progress') instead of resolving both per RSH3g1a
      expect(secondOutcome.resolved).to.equal(true);
    } else {
      expect(secondOutcome.resolved).to.equal(false);
      expect(secondOutcome.err.code).to.equal(40000);
      expect(secondOutcome.err.message).to.match(/already in progress/);
    }

    // Exactly one DELETE was issued
    const deleteRequests = captured.filter((req: any) => req.method === 'delete');
    expect(deleteRequests.length).to.equal(1);
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
  });

  // UTS: rest/unit/RSH3e3c/sync-failure-then-reactivate-0
  it('RSH3e3c - a failed registration sync fails activate; re-activating retries the sync', async function () {
    // DEVIATION(no-reactivation-sync): ably-js performs no RSH3a2a PATCH sync on a fresh client
    // over registered storage — activate() resolves immediately, so the failing-sync setup this
    // test depends on is unreachable via activate()
    if (!process.env.RUN_DEVIATIONS) this.skip();

    let failPatch = true;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'patch' && failPatch) {
        req.respond_with(400, { error: { message: 'sync rejected', code: 40199, statusCode: 400 } });
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    // Fresh client over registered storage: activate syncs via PATCH, which fails
    const client = pushClient(mockStorage);
    const error = await rejectionOf(client.push.activate());
    expect(error.code).to.equal(40199);
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'AfterRegistrationSyncFailed',
      'AfterRegistrationSyncFailed persisted',
    );

    // RSH3f1a — activate again; the machine re-runs the RSH3a2a validation
    failPatch = false;
    await client.push.activate();

    const patchRequests = captured.filter((req: any) => req.method === 'patch');
    expect(patchRequests.length).to.equal(2);
    expect(patchRequests[1].path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'WaitingForNewPushDeviceDetails persisted',
    );
  });

  // UTS: rest/unit/RSH3f2a/deactivate-after-sync-failure-0
  it('RSH3f2a - deactivate from AfterRegistrationSyncFailed deregisters normally', async function () {
    // DEVIATION(no-reactivation-sync): the setup drives AfterRegistrationSyncFailed via a failing
    // PATCH issued by activate() on a fresh client, but ably-js issues no such PATCH — activate()
    // resolves immediately, making the written setup unreachable
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const captured = mockRegistrationServer((req) => {
      if (req.method === 'patch') {
        req.respond_with(400, { error: { message: 'sync rejected', code: 40199, statusCode: 400 } });
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    const client = pushClient(mockStorage);
    await rejectionOf(client.push.activate()); // drive into AfterRegistrationSyncFailed
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'AfterRegistrationSyncFailed',
      'AfterRegistrationSyncFailed persisted',
    );

    await client.push.deactivate();

    const deleteRequests = captured.filter((req: any) => req.method === 'delete');
    expect(deleteRequests.length).to.equal(1);
    expect(deleteRequests[0].url.searchParams.get('deviceId')).to.equal(deviceId);
    await waitFor(() => mockStorage.dump()['ably.push.activationState'] === 'NotActivated', 'NotActivated persisted');
  });

  // UTS: rest/unit/RSH3g3b/deregister-failure-rollback-after-sync-failed-1
  it('RSH3g3b - deregistration failure from AfterRegistrationSyncFailed rolls back to AfterRegistrationSyncFailed', async function () {
    // DEVIATION(no-reactivation-sync): the setup drives AfterRegistrationSyncFailed via a failing
    // PATCH issued by activate() on a fresh client, but ably-js issues no such PATCH — activate()
    // resolves immediately, making the written setup unreachable
    if (!process.env.RUN_DEVIATIONS) this.skip();

    let failPatch = true;
    let failDelete = true;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'patch' && failPatch) {
        req.respond_with(400, { error: { message: 'sync rejected', code: 40199, statusCode: 400 } });
        return true;
      }
      if (req.method === 'delete' && failDelete) {
        // a non-retriable 4xx: a 5xx would additionally exercise RSC15 fallback-host retries
        req.respond_with(400, { error: { message: 'deregistration rejected', code: 40198, statusCode: 400 } });
        return true;
      }
      return false;
    });
    const mockStorage = new MockPushStorage();
    await activateInto(mockStorage);

    const client = pushClient(mockStorage);
    await rejectionOf(client.push.activate()); // -> AfterRegistrationSyncFailed
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'AfterRegistrationSyncFailed',
      'AfterRegistrationSyncFailed persisted',
    );

    const error = await rejectionOf(client.push.deactivate());
    expect(error.code).to.equal(40198);

    // Back in AfterRegistrationSyncFailed: activate re-syncs via PATCH (RSH3f1a)
    failPatch = false;
    await client.push.activate();
    const patchRequests = captured.filter((req: any) => req.method === 'patch');
    expect(patchRequests.length).to.equal(2);
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'WaitingForNewPushDeviceDetails persisted',
    );
  });
});
