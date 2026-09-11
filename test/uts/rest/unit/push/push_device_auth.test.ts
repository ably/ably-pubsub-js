/**
 * UTS: Push Device Authentication Tests
 *
 * Spec points: RSH6, RSH6a, RSH6b, RSH1b3, RSH1b5, RSH1c3, RSH1c4, RSH3d2b
 * Source: uts/rest/unit/push/push_device_auth.md
 *
 * Push device authentication (RSH6): how an activated (or partially activated)
 * push target device authenticates itself for requests operating on its own
 * registration, and the admin API clauses (RSH1b3/RSH1b5/RSH1c3/RSH1c4) that
 * require it when the referenced deviceId is that of the present client.
 *
 * DEVIATIONS (per the spec's Notes; see the report accompanying these tests):
 * - ably-js's common push admin implementation (src/common/lib/client/push.ts)
 *   does not implement the own-device auth clauses of RSH1b3/RSH1b5/RSH1c3/RSH1c4
 *   at all — its admin requests never carry device auth. The RSH6a header
 *   assertions below are guarded behind RUN_DEVIATIONS.
 * - ably-js does not implement RSH6b (X-Ably-DeviceSecret): its device-auth path
 *   (LocalDevice.getAuthDetails) throws "Unable to update device registration;
 *   no deviceIdentityToken" (50000) when there is no deviceIdentityToken, and
 *   its identity-token auth uses `authorization: Bearer <base64(token)>` rather
 *   than X-Ably-DeviceToken. The RSH6b test is skipped as a whole-test deviation.
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

/** Case-insensitive request header lookup. */
function headerValue(req: any, name: string): string | undefined {
  const lower = name.toLowerCase();
  for (const [key, value] of Object.entries(req.headers ?? {})) {
    if (key.toLowerCase() === lower) {
      return value as string;
    }
  }
  return undefined;
}

/**
 * mockRegistrationServer() 500s unrouted paths, so tests exercising the admin
 * channelSubscriptions endpoints route them through this overrides handler.
 */
function channelSubscriptionRoutes(req: any): boolean {
  if (req.method === 'post' && req.path === '/push/channelSubscriptions') {
    req.respond_with(200, JSON.parse(req.body));
    return true;
  }
  if (req.method === 'delete' && req.path === '/push/channelSubscriptions') {
    req.respond_with(204, '');
    return true;
  }
  return false;
}

describe('uts/rest/unit/push/push_device_auth', function () {
  before(function () {
    installReactNativeFake();
  });

  after(function () {
    restoreReactNativeFake();
  });

  afterEach(restoreAll);

  /**
   * RSH6a, RSH1b3 - deviceRegistrations.save for the present activated device
   * includes device auth: after full activation, an admin save() whose
   * DeviceDetails.id is the local device's id carries the X-Ably-DeviceToken
   * header with the registered deviceIdentityToken.
   */
  // UTS: rest/unit/RSH6a/admin-device-registrations-save-own-device-0
  it('RSH6a, RSH1b3 - deviceRegistrations.save for the present activated device includes device auth', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    await client.push.admin.deviceRegistrations.save({
      id: deviceId,
      platform: 'android',
      formFactor: 'phone',
      push: {
        recipient: { transportType: 'fcm', registrationToken: 'fcm-token-1' },
      },
    });

    // The seeding activation POST, then the admin save PUT
    expect(captured).to.have.length(2);

    const request = captured[1];
    expect(request.method).to.equal('put');
    expect(request.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));

    // RSH1b3 + RSH6a — the deviceId is that of the present activated client,
    // so the request must include push device authentication.
    // DEVIATION(RSH6a, RSH1b3): ably-js's push admin adds no device-auth headers
    // at all — the PUT carries only normal key/token auth (Authorization: Basic).
    if (process.env.RUN_DEVIATIONS) {
      expect(headerValue(request, 'X-Ably-DeviceToken')).to.equal('ident-token-1');
    }
  });

  /**
   * RSH6a, RSH1b3 - deviceRegistrations.save for a different device carries no
   * device auth: the same activated client saving a DeviceDetails for a
   * different deviceId sends no device-auth header.
   */
  // UTS: rest/unit/RSH6a/admin-save-other-device-no-device-auth-1
  it('RSH6a, RSH1b3 - deviceRegistrations.save for a different device carries no device auth', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);

    await client.push.admin.deviceRegistrations.save({
      id: 'other-device-1',
      platform: 'ios',
      formFactor: 'tablet',
      push: {
        recipient: { transportType: 'apns', deviceToken: 'apns-token-1' },
      },
    });

    expect(captured).to.have.length(2);

    const request = captured[1];
    expect(request.method).to.equal('put');
    expect(request.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent('other-device-1'));

    // The deviceId is not that of the present client — no device auth
    expect(headerValue(request, 'X-Ably-DeviceToken')).to.equal(undefined);
    expect(headerValue(request, 'X-Ably-DeviceSecret')).to.equal(undefined);
  });

  /**
   * RSH6a, RSH1c3, RSH1c4 - channelSubscriptions save/remove for the present
   * device include device auth: an activated client saving, then removing, a
   * channel subscription for its own deviceId includes the X-Ably-DeviceToken
   * header on both requests.
   */
  // UTS: rest/unit/RSH6a/admin-channel-subscriptions-save-own-device-2
  it('RSH6a, RSH1c3, RSH1c4 - channelSubscriptions save/remove for the present device include device auth', async function () {
    const captured = mockRegistrationServer(channelSubscriptionRoutes);
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    // ably-js has no PushChannelSubscription.forDevice factory (PCS5); per the
    // spec's Notes the subscription may be constructed by an equivalent means.
    const subscription = { channel: 'push-test-channel', deviceId };

    await client.push.admin.channelSubscriptions.save(subscription); // RSH1c3
    await client.push.admin.channelSubscriptions.remove(subscription); // RSH1c4

    // Seeding POST, then the subscription POST, then the subscription DELETE
    expect(captured).to.have.length(3);

    // RSH1c3 — the save POST includes device auth
    const saveRequest = captured[1];
    expect(saveRequest.method).to.equal('post');
    expect(saveRequest.path).to.equal('/push/channelSubscriptions');
    const body = JSON.parse(saveRequest.body);
    expect(body.channel).to.equal('push-test-channel');
    expect(body.deviceId).to.equal(deviceId);

    // RSH1c4 — the remove DELETE includes device auth
    const removeRequest = captured[2];
    expect(removeRequest.method).to.equal('delete');
    expect(removeRequest.path).to.equal('/push/channelSubscriptions');
    expect(removeRequest.url.searchParams.get('channel')).to.equal('push-test-channel');
    expect(removeRequest.url.searchParams.get('deviceId')).to.equal(deviceId);

    // DEVIATION(RSH6a, RSH1c3, RSH1c4): ably-js's push admin adds no device-auth
    // headers at all — both requests carry only normal key/token auth.
    if (process.env.RUN_DEVIATIONS) {
      expect(headerValue(saveRequest, 'X-Ably-DeviceToken')).to.equal('ident-token-1');
      expect(headerValue(removeRequest, 'X-Ably-DeviceToken')).to.equal('ident-token-1');
    }
  });

  /**
   * RSH6a, RSH1b5 - deviceRegistrations.removeWhere for the present device
   * includes device auth: an activated client issuing removeWhere(deviceId:
   * <own id>) includes the X-Ably-DeviceToken header on the DELETE.
   */
  // UTS: rest/unit/RSH6a/admin-remove-where-own-device-3
  it('RSH6a, RSH1b5 - deviceRegistrations.removeWhere for the present device includes device auth', async function () {
    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = await activateInto(mockStorage);
    const deviceId = mockStorage.dump()['ably.push.deviceId'];

    await client.push.admin.deviceRegistrations.removeWhere({ deviceId });

    expect(captured).to.have.length(2);

    const request = captured[1];
    expect(request.method).to.equal('delete');
    expect(request.path).to.equal('/push/deviceRegistrations');
    expect(request.url.searchParams.get('deviceId')).to.equal(deviceId);

    // RSH1b5 + RSH6a — the deviceId param is that of the present activated client
    // DEVIATION(RSH6a, RSH1b5): ably-js's push admin adds no device-auth headers
    // at all — the DELETE carries only normal key/token auth.
    if (process.env.RUN_DEVIATIONS) {
      expect(headerValue(request, 'X-Ably-DeviceToken')).to.equal('ident-token-1');
    }
  });

  /**
   * RSH6b, RSH3d2b - a device with a deviceSecret but no deviceIdentityToken
   * authenticates with X-Ably-DeviceSecret: activation via a custom
   * registerCallback whose result confers no deviceIdentityToken, then
   * deactivate() must carry X-Ably-DeviceSecret on the deregistration DELETE.
   */
  // UTS: rest/unit/RSH6b/device-secret-auth-before-identity-token-0
  it('RSH6b, RSH3d2b - a device with a deviceSecret but no deviceIdentityToken authenticates with X-Ably-DeviceSecret', async function () {
    // DEVIATION(RSH6b, RSH3d2b): ably-js does not implement deviceSecret device
    // auth. A registerCallback result without a deviceIdentityToken crashes the
    // activation state machine (TypeError reading `.token` of undefined in
    // WaitingForDeviceRegistration.processEvent), so activate() never settles;
    // and the deregistration path (LocalDevice.getAuthDetails) throws
    // "Unable to update device registration; no deviceIdentityToken" (50000)
    // instead of falling back to X-Ably-DeviceSecret, so deactivate() never
    // settles either. Even with an identity token, ably-js's device auth is
    // `authorization: Bearer <base64(token)>`, not the RSH6a/RSH6b headers.
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const captured = mockRegistrationServer();
    const mockStorage = new MockPushStorage();
    const client = pushClient(mockStorage);

    // Registration succeeds but confers no deviceIdentityToken (ably-js's
    // RegisterCallback is callback-style).
    const registerCallback = (_device: any, callback: (err: any, deviceRegistration?: any) => void) => {
      callback(null, {});
    };

    await client.push.activate(registerCallback);
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );

    const deviceId = mockStorage.dump()['ably.push.deviceId'];
    const deviceSecret = mockStorage.dump()['ably.push.deviceSecret'];

    await client.push.deactivate();
    await waitFor(
      () => mockStorage.dump()['ably.push.activationState'] === 'NotActivated',
      'activation state to persist as NotActivated',
    );

    // Registration went through the callback, so the only HTTP request is the DELETE
    expect(captured).to.have.length(1);

    const request = captured[0];
    expect(request.method).to.equal('delete');
    expect(request.path).to.equal('/push/deviceRegistrations');
    expect(request.url.searchParams.get('deviceId')).to.equal(deviceId);

    // RSH6b — deviceSecret auth, since the device has no deviceIdentityToken
    expect(headerValue(request, 'X-Ably-DeviceSecret')).to.equal(deviceSecret);
    expect(headerValue(request, 'X-Ably-DeviceToken')).to.equal(undefined);
  });
});
