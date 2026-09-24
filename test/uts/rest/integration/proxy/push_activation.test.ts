/**
 * UTS Proxy Integration: Push Activation Tests
 *
 * Spec points: RSH3a2c, RSH3c3a, RSH3d2c1, RSH3e3d, RSH3f1, RSH3g2a, RSH3g3b, RSH4
 * Source: specification/uts/rest/integration/proxy/push_activation.md
 *
 * These tests drive the real push activation state machine (via the
 * ReactNativePush plugin carrying a MockPushStorage) against the Ably sandbox
 * THROUGH the uts-proxy, injecting faults on the registration endpoints. A
 * direct admin client (bypassing the proxy) provides server-side ground
 * truth — e.g. proving a faulted DELETE never reached the server.
 *
 * Per the spec's seeded-recipient design (RSH3a2c), storage is pre-seeded
 * with an ablyChannel push recipient so `requestToken` is never consulted.
 * The proxy serves plain HTTP, so clients authenticate via an authCallback
 * whose inner client talks directly to the sandbox (RSA1: no Basic auth over
 * an insecure connection).
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
} from '../sandbox';
import { MockPushStorage, installReactNativeFake, restoreReactNativeFake } from '../../unit/push/push_helpers';
import ReactNativePush from '../../../../../src/plugins/react-native-push';
import { createProxySession, waitForProxy, ProxySession, ProxyEvent } from '../../../realtime/integration/helpers/proxy';

const SANDBOX_REST_URL = 'https://sandbox.realtime.ably-nonprod.net';

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/**
 * UTS `ably_channel_recipient(channel_name)`: the server-consumable recipient
 * pre-seeded into storage. ablyUrl is the DIRECT sandbox URL — never the
 * proxy — since it is consumed server-side.
 */
function ablyChannelRecipient(channelName: string): Record<string, string> {
  return {
    transportType: 'ablyChannel',
    channel: channelName,
    ablyKey: getApiKey(0),
    ablyUrl: SANDBOX_REST_URL,
  };
}

/**
 * Storage pre-seeded with a push recipient — a first-ever activation with
 * known push details (RSH3a2c).
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
function seededStorage(recipient: Record<string, string>): MockPushStorage {
  const storage = new MockPushStorage();
  storage.seed({
    'ably.push.pushRecipient': JSON.stringify(recipient),
    'ably.push.deviceId': 'uts-device-' + randomId(),
    'ably.push.deviceSecret': 'uts-secret-' + randomId() + randomId(),
  });
  return storage;
}

/**
 * UTS `proxy_push_client(session, storage, channel_name, recipient?)`: a push
 * client routed through the proxy over pre-seeded storage. Token auth via an
 * authCallback whose inner client talks DIRECTLY to the sandbox, so token
 * requests are never intercepted by fault-injection rules. endpoint:
 * "localhost" auto-disables fallback hosts (REC2c2).
 */
function proxyPushClient(session: ProxySession, storage: MockPushStorage): any {
  const plugin = ReactNativePush.create({
    storage,
    requestToken: async () => {
      throw new Error('requestToken must not be called: recipient is pre-seeded (RSH3a2c)');
    },
  });
  return new Ably.Rest({
    authCallback: (_params: any, cb: any) => {
      const innerRest = new Ably.Rest({ key: getApiKey(0), endpoint: SANDBOX_ENDPOINT } as any);
      innerRest.auth.requestToken().then(
        (token: any) => cb(null, token),
        (err: any) => cb(err, null),
      );
    },
    endpoint: 'localhost',
    port: session.proxyPort,
    tls: false,
    useBinaryProtocol: false,
    plugins: { Push: plugin },
  } as any);
}

/**
 * UTS `direct_admin_client()`: an admin client that bypasses the proxy
 * entirely — the source of server-side ground truth for these tests.
 */
function directAdminClient(): any {
  return new Ably.Rest({
    key: getApiKey(0),
    endpoint: SANDBOX_ENDPOINT,
    useBinaryProtocol: false,
  });
}

/**
 * UTS `activate_through_proxy(client, storage)`: runs a fully real activation
 * through the proxy (no rules firing) and returns the registered device id.
 */
async function activateThroughProxy(client: any, storage: MockPushStorage): Promise<string> {
  await client.push.activate();
  await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails', {
    interval: 100,
    timeout: 10000,
  });
  return storage.dump()['ably.push.deviceId'];
}

function registrationRequests(log: ProxyEvent[], method?: string): ProxyEvent[] {
  return log.filter(
    (e) =>
      e.type === 'http_request' &&
      !!e.path &&
      e.path.includes('/push/deviceRegistrations') &&
      (!method || (e.method ?? '').toUpperCase() === method),
  );
}

describe('uts/rest/integration/proxy/push_activation', function () {
  this.timeout(120000);

  let session: ProxySession | null = null;

  before(async function () {
    // The ReactNativePush plugin resolves require('react-native').Platform.OS
    // inside create(); fake the module for the whole suite (platform: android).
    installReactNativeFake();
    await waitForProxy();
    await setupSandbox();
  });

  after(async function () {
    restoreReactNativeFake();
    await teardownSandbox();
  });

  afterEach(async function () {
    if (session) {
      await session.close();
      session = null;
    }
  });

  // ---------------------------------------------------------------------------
  // RSH3d2c1 — deregistration 401 is classified as Deregistered without the
  // DELETE reaching the server
  // ---------------------------------------------------------------------------

  /**
   * RSH3d2c1, RSH3g2a - a fully real activation registers the device through
   * the proxy; the proxy then answers the deregistration DELETE with a
   * synthetic 401 without forwarding it. deactivate() must resolve and clear
   * local state — and the server-side registration must still exist, proving
   * the 401 → Deregistered classification is purely client-side.
   *
   * DEVIATION: see deviations.md "push: RSH3d2c1 - deregistration status
   * classification unimplemented" — ably-js's deregister() fires
   * DeregistrationFailed on ANY request error, so deactivate() REJECTS on the
   * injected 401 (observed against the sandbox: ErrorInfo code 40100,
   * statusCode 401, message "unauthorized") and rolls back to
   * WaitingForNewPushDeviceDetails instead of resolving and clearing the
   * registration.
   */
  // UTS: rest/proxy/RSH3d2c1/deregister-401-classified-0
  it('RSH3d2c1 - deregistration 401 is classified as Deregistered without the DELETE reaching the server', async function () {
    if (!process.env.RUN_DEVIATIONS) this.skip();
    session = await createProxySession();

    const channelName = 'push-proxy-RSH3d2c1-401-' + randomId();
    const storage = seededStorage(ablyChannelRecipient(channelName));
    const client = proxyPushClient(session, storage);
    const admin = directAdminClient();

    // Real registration through the proxy
    const deviceId = await activateThroughProxy(client, storage);

    try {
      // Server-side ground truth: the registration exists
      const registered = await admin.push.admin.deviceRegistrations.get(deviceId);
      expect(registered.id).to.equal(deviceId);

      // Late fault injection: only the deregistration DELETE is faulted
      await session.addRules([
        {
          match: { type: 'http_request', method: 'DELETE', pathContains: '/push/deviceRegistrations' },
          action: {
            type: 'http_respond',
            status: 401,
            body: { error: { message: 'unauthorized', code: 40100, statusCode: 401 } },
          },
          times: 1,
          comment: 'RSH3d2c1: answer the deregistration DELETE with 401 without forwarding it',
        },
      ]);

      // Resolves despite the 401 — classified as Deregistered
      await client.push.deactivate();
      await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'NotActivated', {
        interval: 100,
        timeout: 10000,
      });

      // RSH3g2a — local state cleared
      const persisted = storage.dump();
      expect(persisted).to.not.have.property('ably.push.deviceIdentityToken');
      expect(persisted).to.not.have.property('ably.push.pushRecipient');

      // The DELETE never reached the server: the registration STILL exists.
      // The 401 → Deregistered classification is purely client-side.
      const stillRegistered = await admin.push.admin.deviceRegistrations.get(deviceId);
      expect(stillRegistered.id).to.equal(deviceId);

      // The proxy log confirms exactly one DELETE was issued (and answered by the rule)
      const log = await session.getLog();
      expect(registrationRequests(log, 'DELETE').length).to.equal(1);
    } finally {
      // Best-effort cleanup of the orphaned server-side registration
      await admin.push.admin.deviceRegistrations.remove(deviceId).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // RSH3d2c1 — deregistration error code 40005 is classified as Deregistered
  // without the DELETE reaching the server
  // ---------------------------------------------------------------------------

  /**
   * RSH3d2c1, RSH3g2a - as deregister-401-classified-0, but the injected
   * fault is an HTTP 400 whose body carries error code 40005 — exercising the
   * body-code (rather than status-code) branch of the classification against
   * a real HTTP response.
   *
   * DEVIATION: see deviations.md "push: RSH3d2c1 - deregistration status
   * classification unimplemented" — deactivate() REJECTS on the injected
   * 40005 (observed against the sandbox: ErrorInfo code 40005, statusCode
   * 400, message "invalid credentials") and rolls back instead of resolving.
   */
  // UTS: rest/proxy/RSH3d2c1/deregister-40005-classified-1
  it('RSH3d2c1 - deregistration error code 40005 is classified as Deregistered without the DELETE reaching the server', async function () {
    if (!process.env.RUN_DEVIATIONS) this.skip();
    session = await createProxySession();

    const channelName = 'push-proxy-RSH3d2c1-40005-' + randomId();
    const storage = seededStorage(ablyChannelRecipient(channelName));
    const client = proxyPushClient(session, storage);
    const admin = directAdminClient();

    const deviceId = await activateThroughProxy(client, storage);

    try {
      await session.addRules([
        {
          match: { type: 'http_request', method: 'DELETE', pathContains: '/push/deviceRegistrations' },
          action: {
            type: 'http_respond',
            status: 400,
            body: { error: { message: 'invalid credentials', code: 40005, statusCode: 400 } },
          },
          times: 1,
          comment: 'RSH3d2c1: answer the deregistration DELETE with 400/40005 without forwarding it',
        },
      ]);

      // Resolves despite the 40005 — classified as Deregistered
      await client.push.deactivate();
      await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'NotActivated', {
        interval: 100,
        timeout: 10000,
      });

      // RSH3g2a — local state cleared
      const persisted = storage.dump();
      expect(persisted).to.not.have.property('ably.push.deviceIdentityToken');
      expect(persisted).to.not.have.property('ably.push.pushRecipient');

      // The DELETE never reached the server: the registration STILL exists
      const stillRegistered = await admin.push.admin.deviceRegistrations.get(deviceId);
      expect(stillRegistered.id).to.equal(deviceId);
    } finally {
      // Best-effort cleanup of the orphaned server-side registration
      await admin.push.admin.deviceRegistrations.remove(deviceId).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // RSH3d2c1, RSH3g3b — deregistration failure fails deactivate and rolls
  // back; the retry deregisters end-to-end
  // ---------------------------------------------------------------------------

  /**
   * RSH3d2c1, RSH3g3a, RSH3g3b - the first DELETE is answered with a
   * synthetic 400/40198 (times: 1, not forwarded), so deactivate() fails and
   * the machine rolls back — verified both locally (identity token survives)
   * and server-side (registration still exists). The rule is then consumed,
   * so a second deactivate() runs end-to-end against the real server: local
   * state cleared AND the server-side registration gone.
   *
   * Note ably-js fires DeregistrationFailed on any DELETE error (see
   * deviations.md "push: RSH3d2c1"), which for this NON-2xx/401/40005 fault
   * happens to coincide with the conformant classification — so this test
   * passes unadapted.
   */
  // UTS: rest/proxy/RSH3d2c1/deregister-failure-rollback-2
  it('RSH3d2c1, RSH3g3b - deregistration failure fails deactivate and rolls back; the retry deregisters end-to-end', async function () {
    session = await createProxySession();

    const channelName = 'push-proxy-RSH3g3b-rollback-' + randomId();
    const storage = seededStorage(ablyChannelRecipient(channelName));
    const client = proxyPushClient(session, storage);
    const admin = directAdminClient();

    const deviceId = await activateThroughProxy(client, storage);

    try {
      await session.addRules([
        {
          match: { type: 'http_request', method: 'DELETE', pathContains: '/push/deviceRegistrations' },
          action: {
            type: 'http_respond',
            status: 400,
            body: { error: { message: 'deregistration rejected', code: 40198, statusCode: 400 } },
          },
          times: 1,
          comment: 'RSH3g3b: fail only the first deregistration DELETE with a non-retriable 400/40198',
        },
      ]);

      // RSH3g3a — deactivate returns with the error
      let error: any;
      try {
        await client.push.deactivate();
      } catch (err) {
        error = err;
      }
      expect(error, 'deactivate() should have rejected with the injected error').to.exist;
      expect(error.code).to.equal(40198);

      // RSH3g3b — still registered locally: the identity token survives the rollback
      expect(storage.dump()['ably.push.deviceIdentityToken']).to.exist;

      // ... and server-side: the faulted DELETE was never forwarded
      const stillRegistered = await admin.push.admin.deviceRegistrations.get(deviceId);
      expect(stillRegistered.id).to.equal(deviceId);

      // The rule is consumed — the retry deregisters end-to-end against the real server
      await client.push.deactivate();
      await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'NotActivated', {
        interval: 100,
        timeout: 10000,
      });

      const persisted = storage.dump();
      expect(persisted).to.not.have.property('ably.push.deviceIdentityToken');
      expect(persisted).to.not.have.property('ably.push.pushRecipient');

      // Server-side registration is gone
      try {
        await admin.push.admin.deviceRegistrations.get(deviceId);
        expect.fail('deviceRegistrations.get should have failed after the successful deregistration');
      } catch (err: any) {
        expect(err.statusCode).to.equal(404);
      }

      // Two DELETEs were issued: the faulted one and the real one
      const log = await session.getLog();
      expect(registrationRequests(log, 'DELETE').length).to.equal(2);
    } finally {
      // Best-effort cleanup in case an assertion left the registration behind
      await admin.push.admin.deviceRegistrations.remove(deviceId).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // RSH3c3a — registration failure fails activate; the retry registers
  // against the real server
  // ---------------------------------------------------------------------------

  /**
   * RSH3c3a, RSH3c3b - the first registration POST is answered with a
   * synthetic 500/50000 (times: 1), so activate() fails and the machine
   * returns to NotActivated. This is necessarily early fault injection — the
   * fault under test is the registration itself — but the retry then runs
   * fully real, and a direct admin get confirms the registration exists
   * server-side. endpoint: "localhost" disables fallback hosts (REC2c2) and
   * none are configured, so the 500 produces exactly one POST attempt.
   */
  // UTS: rest/proxy/RSH3c3a/registration-failure-then-retry-0
  it('RSH3c3a - registration failure fails activate; the retry registers against the real server', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', method: 'POST', pathContains: '/push/deviceRegistrations' },
          action: {
            type: 'http_respond',
            status: 500,
            body: { error: { message: 'internal error', code: 50000, statusCode: 500 } },
          },
          times: 1,
          comment: 'RSH3c3a: fail only the first registration POST with a synthetic 500/50000',
        },
      ],
    });

    const channelName = 'push-proxy-RSH3c3a-retry-' + randomId();
    const storage = seededStorage(ablyChannelRecipient(channelName));
    const client = proxyPushClient(session, storage);
    const admin = directAdminClient();

    let deviceId: string | undefined;
    try {
      // RSH3c3a — activate returns with the error
      let error: any;
      try {
        await client.push.activate();
      } catch (err) {
        error = err;
      }
      expect(error, 'activate() should have rejected with the injected error').to.exist;
      expect(error.code).to.equal(50000);
      await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'NotActivated', {
        interval: 100,
        timeout: 10000,
      });

      // RSH3c3b — from NotActivated the retry runs the full flow against the real server
      await client.push.activate();
      await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails', {
        interval: 100,
        timeout: 10000,
      });
      deviceId = storage.dump()['ably.push.deviceId'];

      // Server-side ground truth: the retry's registration reached the real server
      const registered = await admin.push.admin.deviceRegistrations.get(deviceId);
      expect(registered.id).to.equal(deviceId);

      // Two POSTs were issued: the faulted one and the real one
      const log = await session.getLog();
      expect(registrationRequests(log, 'POST').length).to.equal(2);
    } finally {
      if (deviceId) {
        await admin.push.admin.deviceRegistrations.remove(deviceId).catch(() => {});
      }
    }
  });

  // ---------------------------------------------------------------------------
  // RSH4 — deactivate issued during an in-flight registration is queued, then
  // deregisters after activation completes
  // ---------------------------------------------------------------------------

  /**
   * RSH4, RSH3c2b, RSH3d2 - the proxy holds the registration POST for 2s
   * (well under the default httpRequestTimeout). Because the recipient is
   * pre-seeded (RSH3a2c), activate() passes straight through to
   * WaitingForDeviceRegistration with the POST in flight — and
   * CalledDeactivate has NO defined transition there. Per RSH4 it queues: the
   * activation resolves first when the delayed registration completes, then
   * the dequeued CalledDeactivate deregisters against the real server. The
   * proxy event log verifies the wire sequence: POST, then DELETE.
   *
   * ADAPTATION: the spec reads the registered device id from storage AFTER
   * deactivation ("id/secret survive deactivation"). In ably-js they do not
   * survive as-registered: the Deregistered handler calls device.resetId()
   * (pushactivation.ts:866), which replaces the persisted
   * deviceId/deviceSecret with fresh ulids. The registered id is captured
   * from the seeded storage up front instead; all other assertions are per
   * spec.
   */
  // UTS: rest/proxy/RSH4/deactivate-queued-behind-slow-registration-0
  it('RSH4 - deactivate issued during an in-flight registration is queued, then deregisters after activation completes', async function () {
    session = await createProxySession({
      rules: [
        {
          match: { type: 'http_request', method: 'POST', pathContains: '/push/deviceRegistrations' },
          action: { type: 'http_delay', delayMs: 2000 },
          times: 1,
          comment: 'RSH4: hold the registration POST for 2s so CalledDeactivate arrives in WaitingForDeviceRegistration',
        },
      ],
    });

    const channelName = 'push-proxy-RSH4-queued-' + randomId();
    const storage = seededStorage(ablyChannelRecipient(channelName));
    // Captured before any client ops — see the resetId ADAPTATION above.
    const deviceId = storage.dump()['ably.push.deviceId'];
    const client = proxyPushClient(session, storage);
    const admin = directAdminClient();

    try {
      const resolutionOrder: string[] = [];
      const activation = client.push.activate().then(() => {
        resolutionOrder.push('activate');
      });
      // register a handler so a rejection before the await below is not
      // reported as unhandled; the await still surfaces it
      activation.catch(() => {});

      // Wait until the registration POST is in flight (visible in the proxy
      // event log while the http_delay holds it)
      await pollUntil(
        async () => {
          const log = await session!.getLog();
          return registrationRequests(log, 'POST').length === 1 || null;
        },
        { interval: 200, timeout: 10000 },
      );

      // CalledDeactivate: no transition defined in WaitingForDeviceRegistration → queued (RSH4)
      const deactivation = client.push.deactivate().then(() => {
        resolutionOrder.push('deactivate');
      });
      deactivation.catch(() => {});

      await activation; // registration completes; activate resolves first (RSH3c2b)
      await deactivation; // dequeued CalledDeactivate → RSH3d2 deregistration

      // Activation resolved before deactivation
      expect(resolutionOrder).to.deep.equal(['activate', 'deactivate']);

      await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'NotActivated', {
        interval: 100,
        timeout: 10000,
      });
      const persisted = storage.dump();
      expect(persisted).to.not.have.property('ably.push.deviceIdentityToken');
      expect(persisted).to.not.have.property('ably.push.pushRecipient');

      // Server-side: the registration was created, then removed
      try {
        await admin.push.admin.deviceRegistrations.get(deviceId);
        expect.fail('deviceRegistrations.get should have failed after the deregistration');
      } catch (err: any) {
        expect(err.statusCode).to.equal(404);
      }

      // Wire sequence: the registration POST strictly precedes the deregistration DELETE
      const log = await session.getLog();
      const regRequests = registrationRequests(log);
      expect(regRequests.length).to.equal(2);
      expect((regRequests[0].method ?? '').toUpperCase()).to.equal('POST');
      expect((regRequests[1].method ?? '').toUpperCase()).to.equal('DELETE');
    } finally {
      await admin.push.admin.deviceRegistrations.remove(deviceId).catch(() => {});
    }
  });

  // ---------------------------------------------------------------------------
  // RSH3e3d, RSH3f1 — a failed registration sync is reported via the update
  // callback; the next update syncs against the real server
  // ---------------------------------------------------------------------------

  /**
   * RSH3e3d, RSH3e3b, RSH3f1 - an activated device receives a rotated token
   * via updateToken. The proxy fails the resulting sync PATCH with a
   * synthetic 400/40199 (times: 1): the fire-and-forget sync's failure must
   * surface through the update callback (never through updateToken's return
   * value), leaving the machine in AfterRegistrationSyncFailed. A second
   * updateToken then finds the rule consumed and syncs end-to-end — verified
   * by polling the direct admin get until the server-side recipient reflects
   * the new token.
   *
   * ADAPTATION (per the spec's ably-js deviation note, RSH3e3d): the spec
   * routes sync failures to the updatedCallback provided to Push#activate;
   * ably-js delivers them to the deprecated updateFailedCallback (RSH3e3a) —
   * activate()'s SECOND argument — instead. The retry sync is a PATCH
   * (conformant).
   *
   * SKIPPED (server issue, fixed pending deploy): the second (real) sync
   * PATCH targets a device whose stored recipient is ablyChannel, which the
   * sandbox rejects (400, code 40000, "unknown transport type
   * 'ablyChannel'") — see deviations.md "integration/push_activation:
   * registration-update PATCH rejected for ablyChannel-recipient devices".
   * The deviation adaptations above still apply once unskipped.
   */
  // UTS: rest/proxy/RSH3e3d/sync-failure-recovery-0
  it('RSH3e3d, RSH3f1 - a failed registration sync is reported via the update callback; the next update syncs against the real server', async function () {
    // SERVER ISSUE(ablyChannel PATCH): pending sandbox deploy of https://github.com/ably/realtime/pull/8591 — unskip once deployed
    this.skip();

    session = await createProxySession();

    const channelName = 'push-proxy-RSH3e3d-sync-' + randomId();
    const storage = seededStorage(ablyChannelRecipient(channelName));
    const client = proxyPushClient(session, storage);
    const admin = directAdminClient();

    const updatedResults: any[] = [];
    // updateFailedCallback is activate()'s second argument — see ADAPTATION above
    await client.push.activate(undefined, (err: any) => updatedResults.push(err));
    await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails', {
      interval: 100,
      timeout: 10000,
    });
    const deviceId = storage.dump()['ably.push.deviceId'];

    try {
      // Late fault injection: fail only the first sync PATCH
      await session.addRules([
        {
          match: { type: 'http_request', method: 'PATCH', pathContains: '/push/deviceRegistrations' },
          action: {
            type: 'http_respond',
            status: 400,
            body: { error: { message: 'sync rejected', code: 40199, statusCode: 400 } },
          },
          times: 1,
          comment: 'RSH3e3d: fail only the first token-rotation sync PATCH with 400/40199',
        },
      ]);

      // updateToken resolves (the sync is fire-and-forget) ...
      await client.push.updateToken({ transportType: 'fcm', token: 'proxy-fcm-token-2' });

      // ... and the sync failure surfaces via the update callback (RSH3e3d)
      await pollUntil(() => updatedResults.length === 1 || null, { interval: 100, timeout: 10000 });
      expect(updatedResults[0]).to.exist;
      expect(updatedResults[0].code).to.equal(40199);

      // RSH3e3b — the machine is in AfterRegistrationSyncFailed.
      // DEVIATION: see deviations.md "push: AfterRegistrationSyncFailed not
      // persisted" — only NotActivated and WaitingForNewPushDeviceDetails are
      // persistent in ably-js (isPersistentState, pushactivation.ts:896), so
      // the persisted state still reads WaitingForNewPushDeviceDetails even
      // though the in-memory machine is in AfterRegistrationSyncFailed.
      if (process.env.RUN_DEVIATIONS) {
        await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'AfterRegistrationSyncFailed', {
          interval: 100,
          timeout: 10000,
        });
      } else {
        expect(storage.dump()['ably.push.activationState']).to.equal('WaitingForNewPushDeviceDetails');
      }

      // RSH3f1 — the next GotPushDeviceDetails re-runs the sync; the rule is
      // consumed, so the PATCH reaches the real server
      await client.push.updateToken({ transportType: 'fcm', token: 'proxy-fcm-token-3' });

      // Server-side ground truth: poll the direct admin get until the
      // recipient reflects the new token
      await pollUntil(
        async () => {
          const device = await admin.push.admin.deviceRegistrations.get(deviceId);
          const recipient = device.push?.recipient as any;
          return (
            (recipient?.transportType === 'fcm' && recipient?.registrationToken === 'proxy-fcm-token-3') || null
          );
        },
        { interval: 500, timeout: 15000 },
      );

      await pollUntilSuccess(() => storage.dump()['ably.push.activationState'] === 'WaitingForNewPushDeviceDetails', {
        interval: 100,
        timeout: 10000,
      });

      // Two PATCHes were issued: the faulted one and the real one
      const log = await session.getLog();
      expect(registrationRequests(log, 'PATCH').length).to.equal(2);
    } finally {
      await admin.push.admin.deviceRegistrations.remove(deviceId).catch(() => {});
    }
  });
});
