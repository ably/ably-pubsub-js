/**
 * UTS Integration: Push Activation Tests
 *
 * Spec points: RSH1a, RSH2a, RSH2b, RSH2f, RSH3a2a3, RSH3a2c, RSH3b3c, RSH6a, RSH8a, RSH8c
 * Source: uts/rest/integration/push_activation.md
 *
 * These tests drive the real push activation state machine (via the
 * ReactNativePush plugin carrying a MockPushStorage) against the Ably
 * sandbox. Per the spec's seeded-ablyChannel-recipient design, storage is
 * pre-seeded with an `ablyChannel` push recipient so `requestToken` is never
 * consulted (RSH3a2c) and the registration/sync/deregistration requests and
 * push delivery are exercised end to end against the real server.
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  pollUntil,
  pollUntilSuccess,
} from './sandbox';
import { MockPushStorage, installReactNativeFake, restoreReactNativeFake } from '../unit/push/push_helpers';
import ReactNativePush from '../../../../src/plugins/react-native-push';

const SANDBOX_REST_URL = 'https://sandbox.realtime.ably-nonprod.net';

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * UTS `seeded_storage(recipient_channel)`: storage pre-seeded with an
 * ablyChannel recipient — a first-ever activation with known push details.
 *
 * DEVIATION (RSH8a): the spec seeds only ably.push.pushRecipient — a partial
 * persisted state implementations must tolerate ("to the extent that they
 * exist"). ably-js does not: LocalDevice.loadPersistedAsync() reads
 * pushRecipient only when ably.push.deviceId is present in storage
 * (src/plugins/push/pushactivation.ts:196-206; the no-id branch calls
 * resetId() and never reads the recipient key), so activate() over a
 * recipient-only seed falls through to requestToken and rejects with
 * "Failed to get react-native push device details: requestToken must not be
 * called: recipient is pre-seeded (RSH3a2c)" (verified against the sandbox).
 * Adapted by also seeding deviceId/deviceSecret (their eager generation is
 * sanctioned by the spec's RSH8k2 note); the seeded-recipient design and all
 * server interactions are otherwise unchanged.
 */
function seededStorage(recipientChannel: string): MockPushStorage {
  const storage = new MockPushStorage();
  storage.seed({
    'ably.push.pushRecipient': JSON.stringify({
      transportType: 'ablyChannel',
      channel: recipientChannel,
      ablyKey: getApiKey(0),
      ablyUrl: SANDBOX_REST_URL,
    }),
    'ably.push.deviceId': 'uts-device-' + randomId(),
    'ably.push.deviceSecret': 'uts-secret-' + randomId() + randomId(),
  });
  return storage;
}

/**
 * UTS `push_client(storage, key?)`: real HTTP against the sandbox; only the
 * push platform (storage + requestToken) is mocked, via the ReactNativePush
 * plugin (ably-js's per-client push platform injection seam). Per RSH3a2c the
 * seeded recipient means requestToken must never be consulted.
 */
function pushClient(storage: MockPushStorage, key?: string): any {
  const plugin = ReactNativePush.create({
    storage,
    requestToken: async () => {
      throw new Error('requestToken must not be called: recipient is pre-seeded (RSH3a2c)');
    },
  });
  return new Ably.Rest({
    key: key ?? getApiKey(0),
    endpoint: SANDBOX_ENDPOINT,
    useBinaryProtocol: false,
    plugins: { Push: plugin },
  } as any);
}

/** UTS `admin_client()`: separate client for server-side verification. */
function adminClient(): any {
  return new Ably.Rest({
    key: getApiKey(0),
    endpoint: SANDBOX_ENDPOINT,
    useBinaryProtocol: false,
  });
}

describe('uts/rest/integration/push_activation', function () {
  this.timeout(120000);

  before(async function () {
    // The ReactNativePush plugin resolves require('react-native').Platform.OS
    // inside create(); fake the module for the whole suite (platform: android).
    installReactNativeFake();
    await setupSandbox();
  });

  after(async function () {
    restoreReactNativeFake();
    await teardownSandbox();
  });

  // ---------------------------------------------------------------------------
  // RSH2a — activate registers the device with the real server
  // ---------------------------------------------------------------------------

  /**
   * RSH2a, RSH3a2c, RSH3b3b, RSH8c - full happy-path activation round-trip:
   * the seeded ablyChannel recipient is registered via POST
   * /push/deviceRegistrations, the server grants a deviceIdentityToken, and
   * the registration is visible through the admin API.
   */
  // UTS: rest/integration/RSH2a/activate-registers-device-0
  it('RSH2a - activate registers the device with the real server', async function () {
    const recipientChannel = 'push-recipient-RSH2a-' + randomId();
    const storage = seededStorage(recipientChannel);
    const client = pushClient(storage);
    const admin = adminClient();
    let deviceId: string | undefined;

    try {
      await client.push.activate();

      // ADAPTATION: the spec reads client.device(); with the ReactNativePush
      // plugin storage is asynchronous, so ably-js requires await client.getDevice().
      const device = await client.getDevice();
      deviceId = device.id;
      expect(device.id).to.be.a('string').and.not.be.empty;
      expect(device.deviceIdentityToken).to.be.a('string').and.not.be.empty;

      // Persistence settles fire-and-forget after activate resolves
      await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails', {
        interval: 100,
        timeout: 10000,
      });

      // Server-side verification via a separate admin client
      const registration = await admin.push.admin.deviceRegistrations.get(device.id);
      expect(registration.id).to.equal(device.id);
      expect(registration.platform).to.equal('android');
      expect(registration.formFactor).to.equal('phone');
      expect((registration.push!.recipient as any).transportType).to.equal('ablyChannel');
      expect((registration.push!.recipient as any).channel).to.equal(recipientChannel);
    } finally {
      if (deviceId) {
        await admin.push.admin.deviceRegistrations.remove(deviceId);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // RSH8c, RSH6a — persisted deviceIdentityToken is usable by a fresh client
  // ---------------------------------------------------------------------------

  /**
   * RSH8c, RSH8a, RSH6a - the identity token granted at registration
   * round-trips through storage: a fresh client over the same storage, using
   * the restricted push_subscribe_key (keys[1]), performs a device-authenticated
   * channel.push.subscribeDevice() without calling activate() and without
   * re-registering. The push-subscribe capability authorizes subscribing only
   * the authenticated device, so this succeeds only if the server accepts the
   * SDK's device authentication.
   *
   * FINDING (RSH6a raw-token open question): ably-js's subscribeDevice sends
   * `X-Ably-DeviceToken: <raw deviceIdentityToken>` (src/plugins/push/
   * pushchannel.ts:130 — LocalDevice.deviceIdentityToken holds the raw token
   * string, set from tokenDetails.token at pushactivation.ts:776; no base64,
   * no Authorization bearer), alongside normal basic key auth. Verified by
   * direct probing with a push-subscribe-only key: the sandbox accepts the
   * RAW token (201), and ALSO accepts a base64-encoded token (201) — so both
   * the spec's raw form and ably-java/ably-cocoa's base64 form work; without
   * the header the same request is rejected 401/40160 "action not permitted"
   * (proving the subscription is authorized by device auth, not the key), and
   * `Authorization: Bearer base64(token)` in place of key auth is rejected
   * 401/40160.
   */
  // UTS: rest/integration/RSH8c/identity-token-usable-0
  it('RSH8c, RSH6a - persisted deviceIdentityToken is usable by a fresh client', async function () {
    const recipientChannel = 'push-recipient-RSH8c-' + randomId();
    const storage = seededStorage(recipientChannel);
    const admin = adminClient();
    const channelName = 'pushenabled:test-RSH8c-' + randomId();
    let deviceId: string | undefined;
    let subscribed = false;

    try {
      // First app run: register the device
      const client1 = pushClient(storage);
      await client1.push.activate();
      deviceId = (await client1.getDevice()).id;

      // Second app run: fresh client over the same storage, restricted key.
      // No activate() call — the LocalDevice must hydrate from storage (RSH8a).
      const client2 = pushClient(storage, getApiKey(1));
      const channel = client2.channels.get(channelName);
      await channel.push.subscribeDevice();
      subscribed = true;

      const device2 = await client2.getDevice();
      expect(device2.id).to.equal(deviceId);
      expect(device2.deviceIdentityToken).to.be.a('string').and.not.be.empty;

      // Server-side verification: the subscription exists
      const result = await admin.push.admin.channelSubscriptions.list({
        channel: channelName,
        deviceId,
      });
      expect(result.items).to.have.length(1);
      expect((result.items[0] as any).deviceId).to.equal(deviceId);
      expect((result.items[0] as any).channel).to.equal(channelName);
    } finally {
      if (subscribed) {
        await admin.push.admin.channelSubscriptions.remove({ channel: channelName, deviceId });
      }
      if (deviceId) {
        await admin.push.admin.deviceRegistrations.remove(deviceId);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // RSH2b — deactivate deregisters the device from the real server
  // ---------------------------------------------------------------------------

  /**
   * RSH2b, RSH3g3a - after deactivate() resolves, the registration no longer
   * exists server-side (admin get reports 404). Note ably-js's deregistration
   * DELETE adds `authorization: Bearer base64(deviceIdentityToken)`
   * (pushactivation.ts:253), not X-Ably-DeviceToken — see deviations.md
   * "push: RSH6a/RSH6b/RSH3d2b". This test's full-access key authorizes the
   * DELETE by itself, so the bearer device auth is not isolated here (probing
   * shows bearer alone, without key auth, is rejected 401/40160).
   */
  // UTS: rest/integration/RSH2b/deactivate-deregisters-0
  it('RSH2b - deactivate deregisters the device from the real server', async function () {
    const recipientChannel = 'push-recipient-RSH2b-' + randomId();
    const storage = seededStorage(recipientChannel);
    const client = pushClient(storage);
    const admin = adminClient();

    await client.push.activate();
    const deviceId = (await client.getDevice()).id;

    // Confirm the registration exists before deactivating
    await admin.push.admin.deviceRegistrations.get(deviceId);

    await client.push.deactivate();

    try {
      await admin.push.admin.deviceRegistrations.get(deviceId);
      expect.fail('deviceRegistrations.get should have failed after deactivate');
    } catch (error: any) {
      expect(error.statusCode).to.equal(404);
    }
  });

  // ---------------------------------------------------------------------------
  // RSH3a2a3 — reactivation over registered state syncs against the real server
  // ---------------------------------------------------------------------------

  /**
   * RSH3a2a3, RSH3a2a - a second app run's activate() over already-registered
   * state resolves and the server-side registration survives intact.
   *
   * DEVIATION (deviations.md "push: RSH3a2a/RSH3f1 - re-activation registration
   * sync not implemented"): ably-js performs NO re-activation registration sync —
   * NotActivated + CalledActivate with a registered device re-queues into
   * WaitingForNewPushDeviceDetails, which resolves activate() immediately
   * without contacting the server. The RSH3d3b PATCH is therefore not
   * exercised here; the behavioural assertions below (activate resolves, the
   * registration is unchanged server-side) pass trivially.
   */
  // UTS: rest/integration/RSH3a2a3/reactivation-validates-0
  it('RSH3a2a3 - reactivation over registered state syncs against the real server', async function () {
    const recipientChannel = 'push-recipient-RSH3a2a3-' + randomId();
    const storage = seededStorage(recipientChannel);
    const admin = adminClient();
    let deviceId: string | undefined;

    try {
      // First app run: register the device
      const client1 = pushClient(storage);
      await client1.push.activate();
      deviceId = (await client1.getDevice()).id;

      // Second app run: fresh client over the same storage
      const client2 = pushClient(storage);
      await client2.push.activate();

      const device2 = await client2.getDevice();
      expect(device2.id).to.equal(deviceId);
      expect(device2.deviceIdentityToken).to.be.a('string').and.not.be.empty;

      const registration = await admin.push.admin.deviceRegistrations.get(deviceId);
      expect(registration.id).to.equal(deviceId);
      expect((registration.push!.recipient as any).transportType).to.equal('ablyChannel');
      expect((registration.push!.recipient as any).channel).to.equal(recipientChannel);
    } finally {
      if (deviceId) {
        await admin.push.admin.deviceRegistrations.remove(deviceId);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // RSH1a — direct publish to the activated device is received end to end
  // ---------------------------------------------------------------------------

  /**
   * RSH1a - push.admin.publish({deviceId}, data) delivers a push notification
   * to the registered ablyChannel recipient: the sandbox delivers it as an
   * `__ably_push__` message on the recipient channel, with the push payload
   * JSON-encoded as a string in the message data.
   */
  // UTS: rest/integration/RSH1a/direct-publish-received-0
  it('RSH1a - direct publish to the activated device is received end to end', async function () {
    const recipientChannel = 'push-recipient-RSH1a-' + randomId();
    const storage = seededStorage(recipientChannel);
    const client = pushClient(storage);
    const admin = adminClient();
    let deviceId: string | undefined;
    let realtime: any;

    try {
      await client.push.activate();
      deviceId = (await client.getDevice()).id;

      // A realtime client subscribed to the recipient channel receives the push
      realtime = new Ably.Realtime({
        key: getApiKey(0),
        endpoint: SANDBOX_ENDPOINT,
        useBinaryProtocol: false,
      });
      const rtChannel = realtime.channels.get(recipientChannel);
      const received: any[] = [];
      await rtChannel.subscribe('__ably_push__', (msg: any) => received.push(msg));

      const pushPayload = {
        notification: { title: 'Integration Test', body: 'Push activation e2e' },
        data: { foo: 'bar' },
      };

      await admin.push.admin.publish({ deviceId }, pushPayload);

      const msg = await pollUntil(() => (received.length >= 1 ? received[0] : null), {
        interval: 100,
        timeout: 15000,
      });

      expect(msg.name).to.equal('__ably_push__');
      const receivedPayload = JSON.parse(msg.data);
      expect(receivedPayload.notification.title).to.equal('Integration Test');
      expect(receivedPayload.notification.body).to.equal('Push activation e2e');
      expect(receivedPayload.data).to.deep.equal({ foo: 'bar' });
    } finally {
      if (realtime) {
        realtime.close();
      }
      if (deviceId) {
        await admin.push.admin.deviceRegistrations.remove(deviceId);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // RSH3b3c — registration rejected by the server fails activation
  // ---------------------------------------------------------------------------

  /**
   * RSH3b3c, RSH3b4a - a registration the real server rejects (invalid
   * platform) surfaces the server's error through activate(), and the machine
   * settles back in NotActivated.
   *
   * ADAPTATION: the spec injects the invalid platform via the platform config
   * (push_client(storage, platform: "not_a_real_platform")); ably-js's
   * ReactNativePush plugin maps react-native Platform.OS onto only
   * ios/android, so an arbitrary platform cannot be injected there. Instead
   * the hydrated LocalDevice's platform is mutated directly before activate(),
   * mirroring ably-js's own failed_registration test (test/rest/push.test.js).
   */
  // UTS: rest/integration/RSH3b3c/registration-failure-invalid-platform-0
  it('RSH3b3c - registration rejected by the server fails activation', async function () {
    const recipientChannel = 'push-recipient-RSH3b3c-' + randomId();
    const storage = seededStorage(recipientChannel);
    const client = pushClient(storage);

    const device = await client.getDevice();
    device.platform = 'not_a_real_platform';

    let error: any;
    try {
      await client.push.activate();
    } catch (err) {
      error = err;
    }
    expect(error, 'activate() should have rejected with the server error').to.exist;
    expect(error.statusCode).to.be.at.least(400).and.below(500);

    // The machine settles back in NotActivated
    await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'NotActivated', {
      interval: 100,
      timeout: 10000,
    });

    expect((await client.getDevice()).deviceIdentityToken).to.not.exist;
  });

  // ---------------------------------------------------------------------------
  // RSH2f — updateToken's fire-and-forget sync is accepted by the real server
  // ---------------------------------------------------------------------------

  /**
   * RSH2f, RSH3d3b - on an activated device, updateToken resolves and the
   * fire-and-forget PATCH sync (carrying the new fcm push.recipient) lands
   * server-side: the admin API eventually shows the new recipient. Per the
   * spec's isolation notes this test replaces the device's ablyChannel
   * recipient with an fcm one (the rotated token is necessarily fcm — RSH2f1
   * accepts only fcm/apns), after which the device can no longer receive
   * ablyChannel deliveries — so it uses its own storage, device and channel.
   *
   * A sync rejection would surface via updateFailedCallback (activate's 2nd
   * arg), never through the updateToken() promise — captured below so the
   * server's actual response is reported precisely.
   *
   * SKIPPED (server issue, fixed pending deploy): see deviations.md
   * "integration/push_activation: registration-update PATCH rejected for
   * ablyChannel-recipient devices" — the sandbox rejects the sync PATCH for
   * any device whose stored recipient is ablyChannel (400, code 40000,
   * "unknown transport type 'ablyChannel'").
   */
  // UTS: rest/integration/RSH2f/update-token-synced-0
  it('RSH2f - updateToken fire-and-forget sync is accepted by the real server', async function () {
    // SERVER ISSUE(ablyChannel PATCH): pending sandbox deploy of https://github.com/ably/realtime/pull/8591 — unskip once deployed
    this.skip();

    const recipientChannel = 'push-recipient-RSH2f-' + randomId();
    const storage = seededStorage(recipientChannel);
    const client = pushClient(storage);
    const admin = adminClient();
    let deviceId: string | undefined;
    const syncFailures: any[] = [];

    try {
      // updateToken sync failures surface via updateFailedCallback, not the
      // activate()/updateToken() promises — capture them for diagnosis.
      await client.push.activate(undefined, (err: any) => syncFailures.push(err));
      deviceId = (await client.getDevice()).id;
      const newToken = 'fake-fcm-token-' + randomId();

      await client.push.updateToken({ transportType: 'fcm', token: newToken });

      // The sync is fire-and-forget: poll the admin API until the PATCH lands
      const registration: any = await pollUntil(
        async () => {
          if (syncFailures.length > 0) {
            throw new Error(
              'updateToken registration sync failed (server rejected the PATCH): ' +
                JSON.stringify(syncFailures[0], Object.getOwnPropertyNames(syncFailures[0] ?? {})),
            );
          }
          const reg = await admin.push.admin.deviceRegistrations.get(deviceId);
          return (reg.push?.recipient as any)?.transportType === 'fcm' ? reg : null;
        },
        { interval: 500, timeout: 20000 },
      );

      expect(registration.id).to.equal(deviceId);
      expect((registration.push!.recipient as any).transportType).to.equal('fcm');
      expect((registration.push!.recipient as any).registrationToken).to.equal(newToken);
    } finally {
      if (deviceId) {
        await admin.push.admin.deviceRegistrations.remove(deviceId);
      }
    }
  });
});
