/**
 * UTS: Push Activation Event Queue Tests
 *
 * Exercises the Activation State Machine's pending-event queue (RSH4) and its atomic,
 * sequential event handling (RSH5), black-box: events are produced by driving the public
 * API (push.activate()/push.deactivate()), the mocked requestToken, and by responding to
 * (or holding) the mocked HTTP requests the machine issues.
 *
 * Spec points: RSH3a2a3, RSH3a2a4, RSH3a2b, RSH3a2d, RSH3a2e, RSH3a3a, RSH3b2a, RSH3b2b,
 *   RSH3b3b, RSH3c2b, RSH3d1a, RSH3e1, RSH3e2a, RSH3e2b, RSH3g2a, RSH3g2b, RSH3g2c, RSH4, RSH5
 * Source: specification/uts/rest/unit/push/push_activation_event_queue.md
 */

import { expect } from 'chai';
import { restoreAll } from '../../../helpers';
import type { ReactNativePushToken } from '../../../../../src/plugins/react-native-push';
import {
  installReactNativeFake,
  restoreReactNativeFake,
  MockPushStorage,
  mockRegistrationServer,
  pushClient,
  activateInto,
  waitFor,
  flush,
  deferred,
} from './push_helpers';

describe('uts/rest/unit/push/push_activation_event_queue', function () {
  before(function () {
    installReactNativeFake();
  });

  after(function () {
    restoreReactNativeFake();
  });

  afterEach(function () {
    restoreAll();
  });

  /**
   * RSH4 — the spec's own worked example, driven black-box: with the deregistration DELETE
   * held open, an activate() produces a CalledActivate with no defined transition in
   * WaitingForDeregistration, so the event queues (no new request while held). Releasing the
   * DELETE lands the machine in NotActivated (RSH3g2c), where the queued event is consumed
   * and the full registration flow re-runs against a NEW device identity (RSH3g2a cleared
   * the old one; RSH3a2b/RSH3a2d regenerate it).
   */
  // UTS: rest/unit/RSH4/activate-queued-during-deregistration-0
  it('RSH4 - activate queued during deregistration is consumed after it and re-registers a new device', async function () {
    let heldDelete: any = null;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'delete' && !heldDelete) {
        heldDelete = req; // hold the deregistration open
        return true;
      }
      return false;
    });
    const storage = new MockPushStorage();

    let tokenRequests = 0;
    const client = pushClient(storage, {
      requestToken: async () => {
        tokenRequests += 1;
        return { transportType: 'fcm', token: 'fcm-token-1' } as ReactNativePushToken;
      },
    });
    await client.push.activate();
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'activation state to persist as WaitingForNewPushDeviceDetails',
    );

    const deactivation = client.push.deactivate(undefined as any);
    await waitFor(() => !!heldDelete, 'the deregistration DELETE');

    // No transition defined for CalledActivate in WaitingForDeregistration: it queues (RSH4)
    const activation = client.push.activate();
    await flush();
    expect(captured).to.have.length(2); // activation POST + held DELETE; nothing new while queued

    heldDelete.respond_with(204, '');

    await deactivation; // RSH3g2b
    await activation; // RSH3c2b — resolves after the dequeued event's full re-registration
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'the re-registration to settle in WaitingForNewPushDeviceDetails',
    );

    // RSH3a2d — the platform token was requested again for the re-registration
    expect(tokenRequests).to.equal(2);

    // RSH3b3b — a second registration POST ran after the deregistration
    const posts = captured.filter((req) => req.method === 'post');
    expect(posts).to.have.length(2);

    // RSH3g2a + RSH3a2b — the old device was cleared, so a NEW deviceId was registered
    const firstId = JSON.parse(posts[0].body).id;
    const secondId = JSON.parse(posts[1].body).id;
    expect(secondId).to.not.equal(firstId);
    expect(storage.dump()['ably.push.deviceId']).to.equal(secondId);
  });

  /**
   * RSH5 — with requestToken pending on a Deferred, activate() and deactivate() are called
   * back-to-back without awaiting. Per RSH5 the events are handled strictly in call order:
   * CalledActivate → WaitingForPushDeviceDetails (RSH3a2e), then CalledDeactivate resolves
   * deactivate() (RSH3b2a) and lands in NotActivated (RSH3b2b). Completing the deferred
   * token afterwards delivers GotPushDeviceDetails into NotActivated, where RSH3a3a consumes
   * it — so no registration POST is ever made. (Had the ordering not been respected, the
   * activation would have proceeded to register, which the zero-requests assertion rules out.)
   *
   * The spec defines no resolution for the in-flight activate() in this scenario (RSH3b2
   * resolves only deactivate), so the test does not await it.
   */
  // UTS: rest/unit/RSH5/back-to-back-activate-deactivate-ordered-0
  it('RSH5 - back-to-back activate then deactivate are handled strictly in order', async function () {
    const captured = mockRegistrationServer();
    const storage = new MockPushStorage();

    const tokenDeferred = deferred<ReactNativePushToken>();
    const client = pushClient(storage, { requestToken: () => tokenDeferred.future });

    const activation = client.push.activate(); // RSH3a2e — handled first
    const deactivation = client.push.deactivate(undefined as any); // RSH5 — handled only after CalledActivate has transitioned
    // the spec defines no resolution for `activation` here; guard against a spec-violating
    // rejection crashing the process (the assertions below would still catch it)
    activation.catch(() => {});

    await deactivation; // RSH3b2a — resolves with no error
    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'NotActivated',
      'activation state to persist as NotActivated',
    );

    // The token arrives late: RSH3a3a — consumed in NotActivated, no registration
    tokenDeferred.complete({ transportType: 'fcm', token: 'fcm-token-1' });

    await flush();
    expect(captured).to.have.length(0);
    expect(storage.dump()['ably.push.activationState']).to.equal('NotActivated');
  });

  /**
   * RSH3e1, RSH4 — with the RSH3a2a3 validation PATCH held open (machine in
   * WaitingForRegistrationSync entered via CalledActivate, RSH3a2a4), a second activate()
   * hits the RSH3e1 carve-out: no transition is defined, so the event queues (RSH4).
   * Releasing the PATCH resolves the first activate (RSH3e2b), transitions to
   * WaitingForNewPushDeviceDetails (RSH3e2a), and the dequeued CalledActivate resolves the
   * second activate from there (RSH3d1a) — with exactly one sync PATCH ever issued.
   */
  // UTS: rest/unit/RSH4/second-activate-queued-during-activate-sync-1
  it('RSH3e1 - a second activate during an activate-triggered sync queues until the sync settles', async function () {
    // DEVIATION(ably-js): ably-js does not implement the RSH3a2a3 re-activation sync — a
    // CalledActivate on a device that already has a deviceIdentityToken resolves activate()
    // immediately from the hydrated WaitingForNewPushDeviceDetails state (or re-queues into it
    // from NotActivated), with no validation PATCH. The WaitingForRegistrationSync-entered-
    // via-CalledActivate scenario is therefore unreachable as specced: no PATCH is ever
    // issued, and waiting for the held PATCH times out.
    if (!process.env.RUN_DEVIATIONS) {
      this.skip();
    }

    let heldPatch: any = null;
    const captured = mockRegistrationServer((req) => {
      if (req.method === 'patch' && !heldPatch) {
        heldPatch = req; // hold the validation sync open
        return true;
      }
      return false;
    });
    const storage = new MockPushStorage();
    await activateInto(storage);
    const deviceId = storage.dump()['ably.push.deviceId'];

    // A fresh client over registered storage: activate syncs the registration via PATCH (RSH3a2a3)
    const client = pushClient(storage);
    const first = client.push.activate();
    await waitFor(() => !!heldPatch, 'the validation sync PATCH (RSH3a2a3)'); // machine in WaitingForRegistrationSync via CalledActivate (RSH3a2a4)

    // RSH3e1 carve-out applies: no transition defined, so the event queues (RSH4)
    const second = client.push.activate();
    await flush();
    expect(captured).to.have.length(2); // seeding POST + held PATCH; no additional request

    heldPatch.respond_with(200, JSON.parse(heldPatch.body));

    await first; // RSH3e2b
    await second; // RSH3d1a — the dequeued CalledActivate resolves it from WaitingForNewPushDeviceDetails

    // Exactly one sync PATCH: the queued CalledActivate was consumed by RSH3d1a, not by a second validation
    const patches = captured.filter((req) => req.method === 'patch');
    expect(patches).to.have.length(1);
    expect(patches[0].path).to.equal('/push/deviceRegistrations/' + encodeURIComponent(deviceId));

    await waitFor(
      () => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails',
      'the released sync to settle in WaitingForNewPushDeviceDetails',
    );
  });
});
