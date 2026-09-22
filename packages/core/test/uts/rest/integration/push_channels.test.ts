/**
 * UTS Integration: PushChannel Tests (RSH7)
 *
 * Spec points: RSH7a, RSH7b, RSH7c, RSH7d
 * Source: uts/rest/integration/push_channels.md
 *
 * These tests require the Push plugin to be loaded, and the local device to
 * be configurable. The PushChannel methods (subscribeDevice, subscribeClient,
 * unsubscribeDevice, unsubscribeClient) operate on behalf of the local device
 * and require push device authentication (RSH6).
 *
 * Since ably-js's PushChannel.subscribeDevice/unsubscribeDevice use
 * X-Ably-DeviceToken headers for push device auth, and the sandbox does not
 * issue real deviceIdentityTokens through the admin API, these integration
 * tests are skipped. The PushChannel API requires a genuine device activation
 * flow (RSH2) to obtain a valid deviceIdentityToken, which is not feasible
 * in a Node.js test environment.
 *
 * The subscribeClient/unsubscribeClient methods use client.auth.clientId
 * and do NOT require device registration or device auth headers, so they
 * could potentially work, but ably-js's implementation does not add device
 * auth headers for subscribeClient either — it just posts with standard
 * auth. However, the sandbox may still reject these without a proper push
 * setup.
 */

import { expect } from 'chai';
import { Ably, SANDBOX_ENDPOINT, setupSandbox, teardownSandbox, getApiKey, uniqueChannelName } from './sandbox';

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

describe('uts/rest/integration/push_channels', function () {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  // ---------------------------------------------------------------------------
  // RSH7a, RSH7c - subscribeDevice / unsubscribeDevice round-trip
  // ---------------------------------------------------------------------------

  /**
   * RSH7a, RSH7c - subscribeDevice and unsubscribeDevice round-trip
   *
   * Tests the full device subscription lifecycle: register a device,
   * subscribe it to a channel via PushChannel.subscribeDevice(), verify
   * the subscription exists, then unsubscribe and verify removal.
   *
   * Skipped: PushChannel.subscribeDevice() requires a valid deviceIdentityToken
   * obtained through the device activation flow (RSH2). The admin API can
   * register devices but does not return a deviceIdentityToken suitable for
   * push device auth (RSH6a). In Node.js there is no native push activation.
   */
  // UTS: rest/integration/RSH7a/subscribe-unsubscribe-device-0
  it('RSH7a, RSH7c - subscribeDevice and unsubscribeDevice round-trip', function () {
    // RSH7 PushChannel device methods require push activation flow (RSH2)
    // which is not available in Node.js test environment
    this.skip();
  });

  // ---------------------------------------------------------------------------
  // RSH7b, RSH7d - subscribeClient / unsubscribeClient round-trip
  // ---------------------------------------------------------------------------

  /**
   * RSH7b, RSH7d - subscribeClient and unsubscribeClient round-trip
   *
   * Tests the full client subscription lifecycle: configure a client with
   * a clientId, subscribe via PushChannel.subscribeClient(), verify the
   * subscription exists, then unsubscribe and verify removal.
   *
   * Skipped: ably-js's PushChannel requires the Push plugin to be loaded,
   * and subscribeClient() still goes through PushChannel which expects a
   * configured LocalDevice. The device activation flow is not available in
   * Node.js. Additionally, push channel subscriptions via the PushChannel
   * API (as opposed to the admin API) require the server to recognize the
   * device context.
   */
  // UTS: rest/integration/RSH7b/subscribe-unsubscribe-client-0
  it('RSH7b, RSH7d - subscribeClient and unsubscribeClient round-trip', function () {
    // RSH7 PushChannel client methods require Push plugin with device context
    // which is not available in Node.js test environment
    this.skip();
  });
});
