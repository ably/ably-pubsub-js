/**
 * UTS: Push updateToken Tests
 *
 * Exercises push.updateToken(token) (RSH2f): feeding a rotated or additional platform token
 * into an activated device, producing the RSH8g GotPushDeviceDetails event. Covers the
 * registration sync (PATCH /push/deviceRegistrations/:deviceId, RSH3d3b), cold-start updates
 * from persisted state (RSH3h), sync failure reporting and retry (RSH3e3d/RSH3f1a), the
 * RSH2f1/RSH2f2 client-side guards, routing through a custom registerCallback (RSH3d3a),
 * serialization with an in-flight sync or deactivation (RSH4), and APNs token variants
 * (RSH8l2/PCP3a).
 *
 * Spec points: RSH2f, RSH2f1, RSH2f2, RSH2f3, RSH3a2a3, RSH3a3a, RSH3d3, RSH3d3a, RSH3d3b,
 *   RSH3d3c, RSH3d3d, RSH3e1a, RSH3e1b, RSH3e2a, RSH3e2c, RSH3e3b, RSH3e3d, RSH3f1a,
 *   RSH3g2a, RSH3h, RSH4, RSH6a, RSH8g, RSH8l2, PCP3a, PDT4
 * Source: specification/uts/rest/unit/push/push_update_token.md
 */

import { expect } from 'chai';
import { restoreAll } from '../../../helpers';
import {
  installReactNativeFake,
  restoreReactNativeFake,
  MockPushStorage,
  mockRegistrationServer,
  pushClient,
  activateInto,
  waitFor,
  flush,
  rejectionOf,
} from './push_helpers';

describe('uts/rest/unit/push/push_update_token', function () {
  before(function () {
    installReactNativeFake();
  });

  after(function () {
    restoreReactNativeFake();
  });

  afterEach(function () {
    restoreAll();
  });

  // Activation as in activateInto, but as an ios/apns device (update-token-push-to-start-10)
  async function activateIntoApns(storage: MockPushStorage): Promise<any> {
    return activateInto(storage, { token: { transportType: 'apns', token: 'apns-token-1' }, platform: 'ios' });
  }

  /**
   * RSH8g, RSH3d3 — delivering a rotated FCM token to an activated device produces the
   * RSH3d3b sync: a PATCH addressed to the device, carrying only the new recipient,
   * authenticated as the device (RSH6a), with the new recipient persisted and the machine
   * settling back in WaitingForNewPushDeviceDetails (RSH3e2a).
   */
  // UTS: rest/unit/RSH3d3b/update-token-patch-0
  it('RSH3d3b - a rotated fcm token is synced via PATCH with changed fields only', async function () {
    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = await activateInto(storage);
    const deviceId = storage.dump()['ably.push.deviceId'];

    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });

    // The sync is fire-and-forget: poll for the PATCH it issues
    await waitFor(() => captured.length === 2, 'the registration sync PATCH');
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );

    const request = captured[1];
    expect(request.method).to.equal('patch');
    expect(request.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));

    // RSH3d3b — only the changed fields travel in the body; the device id is in the URL
    expect(JSON.parse(request.body)).to.deep.equal({
      push: { recipient: { transportType: 'fcm', registrationToken: 'fcm-token-2' } },
    });

    // RSH3d3b + RSH6a — push device authentication.
    // DEVIATION(ably-js): RSH6a specifies an X-Ably-DeviceToken header carrying the
    // deviceIdentityToken; ably-js authenticates the device with an Authorization bearer
    // header carrying the base64 of the deviceIdentityToken (the spec's Notes permit
    // adapting this assertion with a recorded deviation).
    if (process.env.RUN_DEVIATIONS) {
      expect(request.headers['X-Ably-DeviceToken']).to.equal('ident-token-1');
    } else {
      expect(request.headers.authorization).to.equal('Bearer ' + Buffer.from('ident-token-1').toString('base64'));
    }

    // The rotated recipient was persisted
    expect(JSON.parse(storage.dump()['ably.push.pushRecipient'])).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-2',
    });
  });

  /**
   * RSH8g — an apns token maps to an apns recipient, whose token field is deviceToken
   * (RSH3d3b: the PATCH body carries the changed push details).
   */
  // UTS: rest/unit/RSH8g/update-token-apns-recipient-1
  it('RSH8g - an apns token maps to an apns recipient', async function () {
    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = await activateInto(storage, {
      token: { transportType: 'apns', token: 'apns-token-1' },
      platform: 'ios',
    });

    await client.push.updateToken({ transportType: 'apns', token: 'apns-token-2' });
    await waitFor(() => captured.length === 2, 'the registration sync PATCH');

    const request = captured[1];
    expect(request.method).to.equal('patch');
    expect(JSON.parse(request.body)).to.deep.equal({
      push: { recipient: { transportType: 'apns', deviceToken: 'apns-token-2' } },
    });
  });

  /**
   * RSH2f2 — updateToken requires that the device has completed activation (has a
   * deviceIdentityToken); otherwise it is rejected with code 40000, without any effect.
   * The guard fires before any event reaches the state machine, so a subsequent activate()
   * proceeds entirely normally.
   */
  // UTS: rest/unit/RSH2f2/update-token-requires-activation-2
  it('RSH2f2 - updateToken requires an activated device, and does not disturb a later activation', async function () {
    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = pushClient(storage);

    const err = await rejectionOf(client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' }));
    expect(err.code).to.equal(40000);
    expect(err.message).to.match(/not activated/);
    expect(err.remediation).to.match(/push\.activate/);

    // Nothing reached the machine or the network
    await flush();
    expect(captured).to.have.length(0);

    // A subsequent activation is unaffected by the rejected update
    await client.push.activate();
    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );
  });

  /**
   * RSH8g, RSH3h — a fresh client over storage holding a registered device (persisted state
   * WaitingForNewPushDeviceDetails) can deliver a rotated token without activate() having
   * been called this session: the machine hydrates from storage and runs the RSH3d3 sync
   * against the persisted registration (RSH3d3b: addressed to the persisted device's id).
   */
  // UTS: rest/unit/RSH8g/update-token-cold-start-3
  it('RSH8g - updateToken works from persisted state on a cold start, without activate() this session', async function () {
    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();
    await activateInto(storage);
    const deviceId = storage.dump()['ably.push.deviceId'];

    // A fresh client over the same storage simulates an app restart
    const restarted = pushClient(storage);
    await restarted.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await waitFor(() => captured.length === 2, 'the registration sync PATCH');

    const request = captured[1];
    expect(request.method).to.equal('patch');
    // The restarted client loaded the persisted device id and addressed the same registration
    expect(request.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));
    expect(JSON.parse(request.body).push.recipient.registrationToken).to.equal('fcm-token-2');
  });

  /**
   * RSH3e3d, RSH3f1a — a server rejection of the sync surfaces through the update callback
   * provided to activate() (not through updateToken, which has already resolved — the sync
   * is fire-and-forget), the rotated recipient is nonetheless persisted, and a retry from
   * AfterRegistrationSyncFailed re-runs the RSH3a2a validation — which per RSH3a2a3 is the
   * same RSH3d3b PATCH sync.
   */
  // UTS: rest/unit/RSH3e3d/update-token-sync-failure-callback-4
  it('RSH3e3d - a failed sync is reported via updatedCallback; a retry re-validates per RSH3a2a', async function () {
    let failPatch = true;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'patch' && failPatch) {
        req.respond_with(400, { error: { message: 'sync rejected', code: 40199, statusCode: 400 } });
        return true;
      }
      return false;
    });
    const storage = new MockPushStorage();
    const client = pushClient(storage);

    // DEVIATION(ably-js): RSH3e3d wants failures delivered to the `updatedCallback` provided
    // to Push#activate; ably-js only has the deprecated updateFailedCallback (RSH3e3a),
    // taken as activate()'s second argument, so failure delivery is adapted to it here.
    const syncResults: any[] = [];
    await client.push.activate(undefined, (error: any) => syncResults.push(error));
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );
    const deviceId = storage.dump()['ably.push.deviceId'];

    // The sync is fire-and-forget: updateToken resolves despite the PATCH failing
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });

    // RSH3e3d — the failure reaches the update callback
    await waitFor(() => syncResults.length === 1, 'the sync failure to reach the update callback');
    expect(syncResults[0].code).to.equal(40199);
    expect(syncResults[0].message).to.match(/sync rejected/);

    // The rotated recipient was persisted even though the sync failed
    expect(JSON.parse(storage.dump()['ably.push.pushRecipient'])).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'fcm-token-2',
    });

    // RSH3e3b — the machine is in AfterRegistrationSyncFailed.
    // DEVIATION(ably-js): ably-js persists only NotActivated and WaitingForNewPushDeviceDetails
    // (isPersistentState), so the persisted state still reads WaitingForNewPushDeviceDetails
    // even though the in-memory machine is in AfterRegistrationSyncFailed.
    if (process.env.RUN_DEVIATIONS) {
      await waitFor(
        () => storage.dump()['ably.push.activationState'] === 'AfterRegistrationSyncFailed',
        'activation state to persist as AfterRegistrationSyncFailed',
      );
    } else {
      expect(storage.dump()['ably.push.activationState']).to.equal('WaitingForNewPushDeviceDetails');
    }

    // RSH3f1a — a retry with the server healthy re-runs the RSH3a2a validation, which
    // per RSH3a2a3 is the same RSH3d3b sync: a second PATCH with the complete recipient
    failPatch = false;
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });

    await waitFor(() => captured.filter((req) => req.method === 'patch').length === 2, 'the retry PATCH');
    const retry = captured.filter((req) => req.method === 'patch')[1];
    expect(retry.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));
    expect(JSON.parse(retry.body).push.recipient.registrationToken).to.equal('fcm-token-2');

    // RSH3e2c — the successful sync reaches the updatedCallback with no error.
    // DEVIATION(ably-js): ably-js has no success-notification path at all (the adapted
    // updateFailedCallback is only invoked on failure), so this assertion is guarded.
    if (process.env.RUN_DEVIATIONS) {
      await waitFor(() => syncResults.length === 2, 'the sync success to reach the update callback');
      expect(syncResults[1]).to.equal(null);
    }

    // RSH3e2a — settled back in WaitingForNewPushDeviceDetails
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails after the retry',
    );
  });

  /**
   * RSH2f1 — the provided token must carry a supported transportType and a non-empty token;
   * an invalid token is rejected with code 40000 without any effect on the LocalDevice or
   * the state machine: no GotPushDeviceDetails event, no HTTP request, no storage change.
   */
  // UTS: rest/unit/RSH2f1/update-token-validation-5
  it('RSH2f1 - malformed tokens are rejected without touching the machine, the network, or storage', async function () {
    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = await activateInto(storage);
    const persistedBefore = storage.dump();

    for (const bad of [
      null,
      undefined, // not in the UTS list; kept from the previous ably-js test's coverage
      { transportType: 'web', token: 'web-token-1' },
      { transportType: 'fcm', token: '' },
    ]) {
      const err = await rejectionOf(client.push.updateToken(bad as any));
      expect(err.code).to.equal(40000);
      expect(err.message).to.match(/transportType/);
    }

    await flush();
    expect(captured).to.have.length(1); // just the activation POST
    expect(storage.dump()).to.deep.equal(persistedBefore); // storage untouched, recipient included
  });

  /**
   * RSH3d3a — a device activated via a custom registerCallback routes the token-rotation
   * sync through the same callback with the new recipient (instead of the PATCH of RSH3d3b),
   * and no HTTP request is made at any point.
   */
  // UTS: rest/unit/RSH3d3a/update-token-register-callback-6
  it('RSH3d3a - a device activated via a custom registerCallback syncs through the same callback', async function () {
    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = pushClient(storage);

    const registeredRecipients: any[] = [];
    await client.push.activate((device: any, callback: any) => {
      registeredRecipients.push(device.push?.recipient);
      callback(null, { deviceIdentityToken: { token: 'custom-ident-1' } });
    });
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );
    expect(registeredRecipients).to.have.length(1);

    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await waitFor(() => registeredRecipients.length === 2, 'the sync to reach registerCallback');

    // RSH3d3a — the sync went through the same registerCallback, with the new recipient
    expect(registeredRecipients[1]).to.deep.equal({ transportType: 'fcm', registrationToken: 'fcm-token-2' });

    // No HTTP at all: neither the registration nor the sync touched the network
    expect(captured).to.have.length(0);

    // The rotated recipient was persisted
    await waitFor(
      () => JSON.parse(storage.dump()['ably.push.pushRecipient'] ?? 'null')?.registrationToken === 'fcm-token-2',
      'the rotated recipient to persist',
    );
  });

  /**
   * RSH3e1a — with the RSH3d3b PATCH held open (machine pinned in WaitingForRegistrationSync
   * entered via GotPushDeviceDetails, RSH3d3d), an activate() resolves with no error without
   * waiting for the sync and without issuing any request (RSH3e1b self-transition; the
   * RSH3e1 "unless ... as a result of a CalledActivate event" carve-out does not apply here).
   */
  // UTS: rest/unit/RSH3e1a/activate-during-token-sync-7
  it('RSH3e1a - activate during an in-flight token sync resolves immediately without a request', async function () {
    let heldPatch: any = null;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'patch' && !heldPatch) {
        heldPatch = req; // hold the sync open
        return true;
      }
      return false;
    });
    const storage = new MockPushStorage();
    const client = await activateInto(storage);

    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await waitFor(() => !!heldPatch, 'the sync PATCH'); // machine now in WaitingForRegistrationSync (RSH3d3d)

    // RSH3e1a — resolves while the PATCH is still held, so it did not wait for the sync
    await client.push.activate();

    // RSH3e1b — self-transition: no request was issued for the activate
    await flush();
    expect(captured).to.have.length(2); // activation POST + held PATCH only

    heldPatch.respond_with(200, JSON.parse(heldPatch.body));

    // RSH3e2a — the released sync settles the machine in WaitingForNewPushDeviceDetails
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'the released sync to settle in WaitingForNewPushDeviceDetails',
    );
  });

  /**
   * RSH4 — WaitingForRegistrationSync defines no transition for GotPushDeviceDetails, so the
   * second update's event queues behind the held sync; when the first sync settles
   * (RegistrationSynced → WaitingForNewPushDeviceDetails, RSH3e2a), the queued event is
   * dequeued and consumed per RSH3d3, issuing its own changed-fields PATCH (RSH3d3b).
   */
  // UTS: rest/unit/RSH4/update-token-queued-behind-inflight-sync-8
  it('RSH4 - an update issued during an in-flight sync is queued and applied after it settles', async function () {
    let heldPatch: any = null;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'patch' && !heldPatch) {
        heldPatch = req; // hold the first sync open; later PATCHes use the default route
        return true;
      }
      return false;
    });
    const storage = new MockPushStorage();
    const client = await activateInto(storage);

    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });
    await waitFor(() => !!heldPatch, 'the first sync PATCH');

    // Resolves (recipient persisted, event handed over), but its sync is queued per RSH4
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-3' });

    await flush();
    expect(captured.filter((req) => req.method === 'patch')).to.have.length(1); // only the held one

    heldPatch.respond_with(200, JSON.parse(heldPatch.body));
    await waitFor(() => captured.filter((req) => req.method === 'patch').length === 2, 'the queued sync PATCH');

    const patches = captured.filter((req) => req.method === 'patch');
    expect(JSON.parse(patches[1].body)).to.deep.equal({
      push: { recipient: { transportType: 'fcm', registrationToken: 'fcm-token-3' } },
    });

    await waitFor(
      () => JSON.parse(storage.dump()['ably.push.pushRecipient'] ?? 'null')?.registrationToken === 'fcm-token-3',
      'the second rotated recipient to persist',
    );
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );
  });

  /**
   * RSH4 — WaitingForDeregistration defines no transition for GotPushDeviceDetails, so the
   * update's event queues. Deregistration then lands the machine in NotActivated, where the
   * dequeued event is consumed per RSH3a3a — so no sync PATCH is ever issued, and the
   * recipient the update persisted has been cleared by RSH3g2a.
   */
  // UTS: rest/unit/RSH4/update-token-discarded-after-deregistration-9
  it('RSH4 - an update racing a deactivation is discarded once the device is deregistered', async function () {
    let heldDelete: any = null;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'delete' && !heldDelete) {
        heldDelete = req; // hold the deregistration open
        return true;
      }
      return false;
    });
    const storage = new MockPushStorage();
    const client = await activateInto(storage);

    const deactivation = client.push.deactivate(undefined as any);
    await waitFor(() => !!heldDelete, 'the deregistration DELETE');

    // The device still has its deviceIdentityToken, so the guard passes; the event queues
    await client.push.updateToken({ transportType: 'fcm', token: 'fcm-token-2' });

    heldDelete.respond_with(204, '');
    await deactivation;
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'NotActivated',
      'activation state to persist as NotActivated',
    );

    // RSH4 + RSH3a3a — the queued event was consumed in NotActivated: no sync ever ran
    await flush();
    expect(captured.filter((req) => req.method === 'patch')).to.have.length(0);

    // RSH3g2a — deregistration removed the recipient the update had persisted
    expect(storage.dump()).to.not.have.property('ably.push.pushRecipient');
  });

  /**
   * RSH8l2, PCP3a — delivering a Live Activity push-to-start token via updateToken on a
   * device activated with a default APNs token adds the pushToStart slot to the recipient's
   * apnsDeviceTokens map (RSH2f3) — and keeps the default token registered.
   */
  // UTS: rest/unit/RSH8l2/update-token-push-to-start-10
  it('RSH8l2 - registering a push-to-start token adds a variant slot without disturbing the default token', async function () {
    // DEVIATION(ably-js): ably-js does not implement APNs token variants (RSH8l2/PCP3a/PDT4).
    // updateToken()'s PushDeviceToken has no apnsTokenType field; the extra property is
    // silently ignored and the token is treated as a default apns token. Observed:
    // updateToken({ transportType: 'apns', token: 'pts-token-1', apnsTokenType: 'pushToStart' })
    // resolves, and the sync PATCH body is
    // { push: { recipient: { transportType: 'apns', deviceToken: 'pts-token-1' } } } —
    // replacing (clobbering) the default apns-token-1 recipient; no apnsDeviceTokens map exists.
    if (!process.env.RUN_DEVIATIONS) {
      this.skip();
    }

    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = await activateIntoApns(storage);
    const deviceId = storage.dump()['ably.push.deviceId'];

    await client.push.updateToken({ transportType: 'apns', token: 'pts-token-1', apnsTokenType: 'pushToStart' });

    await waitFor(() => captured.filter((req) => req.method === 'patch').length === 1, 'the registration sync PATCH');

    const patch = captured.filter((req) => req.method === 'patch')[0];
    expect(patch.path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));

    const recipient = JSON.parse(patch.body).push.recipient;
    expect(recipient.transportType).to.equal('apns');

    // PCP3a — the variant landed in its slot
    expect(recipient.apnsDeviceTokens ?? {}).to.have.property('pushToStart', 'pts-token-1');

    // RSH8l2 — the default token was preserved (either representation per PCP3a)
    expect(
      recipient.deviceToken === 'apns-token-1' || recipient.apnsDeviceTokens?.default === 'apns-token-1',
      'default apns token preserved',
    ).to.equal(true);

    // The full recipient, variants included, is persisted
    const persistedRecipient = JSON.parse(storage.dump()['ably.push.pushRecipient']);
    expect(persistedRecipient.apnsDeviceTokens ?? {}).to.have.property('pushToStart', 'pts-token-1');
  });

  /**
   * RSH8l2 — the registration, update or removal of any single variant is a change of the
   * push transport details, and the ensuing sync carries the complete updated recipient
   * including the unchanged variants: rotating the default token (apnsTokenType absent —
   * defaults to "default" per PDT4) after a pushToStart token has been registered must not
   * drop the pushToStart slot.
   */
  // UTS: rest/unit/RSH8l2/update-token-variant-preserves-others-11
  it('RSH8l2 - rotating the default token preserves registered variant slots', async function () {
    // DEVIATION(ably-js): ably-js does not implement APNs token variants (RSH8l2/PCP3a/PDT4);
    // see update-token-push-to-start-10. Observed: the pushToStart update replaces the whole
    // recipient with { transportType: 'apns', deviceToken: 'pts-token-1' }, and the subsequent
    // default-token rotation replaces it again with
    // { transportType: 'apns', deviceToken: 'apns-token-2' } — no variant slot survives
    // because none is ever recorded.
    if (!process.env.RUN_DEVIATIONS) {
      this.skip();
    }

    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();
    const client = await activateIntoApns(storage);

    await client.push.updateToken({ transportType: 'apns', token: 'pts-token-1', apnsTokenType: 'pushToStart' });
    await waitFor(() => captured.filter((req) => req.method === 'patch').length === 1, 'the first sync PATCH');

    // Rotate the default token (apnsTokenType absent — defaults to "default" per PDT4)
    await client.push.updateToken({ transportType: 'apns', token: 'apns-token-2' });

    await waitFor(() => captured.filter((req) => req.method === 'patch').length === 2, 'the second sync PATCH');

    const patch = captured.filter((req) => req.method === 'patch')[1];
    const recipient = JSON.parse(patch.body).push.recipient;

    // The rotated default token
    expect(
      recipient.deviceToken === 'apns-token-2' || recipient.apnsDeviceTokens?.default === 'apns-token-2',
      'rotated default apns token present',
    ).to.equal(true);

    // RSH8l2 — the pushToStart variant survived the default-token rotation
    expect(recipient.apnsDeviceTokens ?? {}).to.have.property('pushToStart', 'pts-token-1');

    const persistedRecipient = JSON.parse(storage.dump()['ably.push.pushRecipient']);
    expect(persistedRecipient.apnsDeviceTokens ?? {}).to.have.property('pushToStart', 'pts-token-1');
  });
});
