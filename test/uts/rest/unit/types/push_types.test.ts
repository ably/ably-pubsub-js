/**
 * UTS: Push Type Tests
 *
 * Spec points: PCD1, PCD2, PCD3, PCD4, PCD5, PCD6, PCD7, PCP1, PCP2, PCP3, PCP4,
 *              PCS1, PCS2, PCS3, PCS4, PCS5
 * Source: uts/rest/unit/types/push_types.md
 *
 * Pure type construction and serialization tests — no HTTP mock needed.
 *
 * Per the spec's Notes, mapped onto ably-js as follows:
 * - The spec's `DeviceDetails.fromJson(wire)` / `device.toJson()` map to ably-js's
 *   `DeviceDetails.fromValues(wire)` / `device.toJSON()` (likewise for
 *   PushChannelSubscription).
 * - Push state wire casing (PCP4): ably-js types the wire value as uppercase
 *   ('ACTIVE' | 'FAILING' | 'FAILED') and exposes the raw wire string — there is
 *   no DevicePushState enum. State assertions use the wire string (recorded as a
 *   deviation per the Notes).
 * - errorReason wire field (PCP2): ably-js's wire mapping writes the push error
 *   as `error` under `push` (see toJSON()), and only converts a *top-level*
 *   `error` field to ErrorInfo on fromValues — a spec-named `push.errorReason`
 *   passes through as a plain object and is dropped by toJSON(). Guarded as
 *   deviations.
 * - metadata (PCD5): ably-js *types* metadata as a plain string, but fromValues
 *   copies values as-received, so a map round-trips at runtime. The deviation is
 *   type-level only; the runtime assertions follow the spec.
 * - PCS5: ably-js exposes neither the forDevice/forClientId factories nor any
 *   exactly-one enforcement (fromValues copies fields as-received). Factory
 *   existence is guarded as a deviation; subscriptions are constructed by the
 *   equivalent means the Notes sanction (fromValues with exactly one identifier).
 */

import { expect } from 'chai';
import DeviceDetails, { DeviceFormFactor, DevicePlatform } from '../../../../../src/common/lib/types/devicedetails';
import PushChannelSubscription from '../../../../../src/common/lib/types/pushchannelsubscription';
import ErrorInfo from '../../../../../src/common/lib/types/errorinfo';

describe('uts/rest/unit/types/push_types', function () {
  /**
   * PCD1-PCD7 - DeviceDetails round-trips all attributes through wire JSON:
   * a full DeviceDetails parses every attribute from wire JSON, and
   * serializing it back reproduces the same wire fields.
   */
  // UTS: rest/unit/PCD1/device-details-round-trip-0
  it('PCD1-PCD7 - DeviceDetails round-trips all attributes through wire JSON', function () {
    const wire = {
      id: 'device-001',
      clientId: 'client-abc',
      platform: 'android',
      formFactor: 'phone',
      metadata: { environment: 'test' },
      push: {
        recipient: { transportType: 'fcm', registrationToken: 'reg-token-1' },
        state: 'ACTIVE',
        errorReason: { code: 40000, statusCode: 400, message: 'example error' },
      },
    };

    const device = DeviceDetails.fromValues({ ...wire });

    expect(device.id).to.equal('device-001'); // PCD2
    expect(device.clientId).to.equal('client-abc'); // PCD3
    expect(device.formFactor).to.equal(DeviceFormFactor.Phone); // PCD4
    // PCD5 — the spec defines metadata as a map; ably-js *types* it as a string
    // but preserves the map as-received at runtime (type-level deviation only)
    expect(device.metadata).to.deep.equal({ environment: 'test' });
    expect(device.platform).to.equal(DevicePlatform.Android); // PCD6

    // PCD7 — push is a DevicePushDetails (PCP1). In ably-js DevicePushDetails is
    // a structural type, not a runtime class, so assert the structure.
    expect(device.push).to.be.an('object');
    expect(device.push!.recipient).to.deep.equal({
      // PCP3
      transportType: 'fcm',
      registrationToken: 'reg-token-1',
    });
    // PCP4 — ably-js exposes the raw wire string; there is no DevicePushState enum
    expect(device.push!.state).to.equal('ACTIVE');
    // DEVIATION(PCP2): ably-js does not parse push.errorReason as an ErrorInfo —
    // fromValues only converts a top-level `error` field; the nested object
    // passes through as a plain object.
    if (process.env.RUN_DEVIATIONS) {
      expect((device.push as any).errorReason).to.be.instanceOf(ErrorInfo);
    }
    expect((device.push as any).errorReason.code).to.equal(40000);
    expect((device.push as any).errorReason.statusCode).to.equal(400);
    expect((device.push as any).errorReason.message).to.equal('example error');

    // Round trip — serialization reproduces the wire fields
    const jsonData = device.toJSON() as any;
    expect(jsonData.id).to.equal('device-001');
    expect(jsonData.clientId).to.equal('client-abc');
    expect(jsonData.platform).to.equal('android');
    expect(jsonData.formFactor).to.equal('phone');
    expect(jsonData.metadata).to.deep.equal({ environment: 'test' });
    expect(jsonData.push.recipient).to.deep.equal({
      transportType: 'fcm',
      registrationToken: 'reg-token-1',
    });
    expect(jsonData.push.state).to.equal('ACTIVE');
    // DEVIATION(PCP2): ably-js's toJSON() writes the push error under the wire
    // field `error` (sourced from push.error), so a spec-named `errorReason`
    // input is dropped from the serialized form entirely.
    if (process.env.RUN_DEVIATIONS) {
      expect(jsonData.push.errorReason.code).to.equal(40000);
    }
  });

  /**
   * PCD4 - all DeviceFormFactor values are accepted: phone, tablet, desktop,
   * tv, watch, car, embedded, other.
   */
  // UTS: rest/unit/PCD4/form-factor-values-0
  it('PCD4 - all DeviceFormFactor values are accepted', function () {
    const formFactors = ['phone', 'tablet', 'desktop', 'tv', 'watch', 'car', 'embedded', 'other'];

    for (const formFactor of formFactors) {
      const device = DeviceDetails.fromValues({
        id: 'device-001',
        platform: 'android',
        formFactor: formFactor,
      });

      // DeviceFormFactor(x) denotes the enum member whose wire value is x
      expect(Object.values(DeviceFormFactor)).to.include(formFactor);
      expect(device.formFactor).to.equal(formFactor);
      expect((device.toJSON() as any).formFactor).to.equal(formFactor);
    }
  });

  /**
   * PCD6 - all DevicePlatform values are accepted: android, ios, browser.
   */
  // UTS: rest/unit/PCD6/platform-values-0
  it('PCD6 - all DevicePlatform values are accepted', function () {
    const platforms = ['android', 'ios', 'browser'];

    for (const platform of platforms) {
      const device = DeviceDetails.fromValues({
        id: 'device-001',
        platform: platform,
        formFactor: 'phone',
      });

      // DevicePlatform(x) denotes the enum member whose wire value is x
      expect(Object.values(DevicePlatform)).to.include(platform);
      expect(device.platform).to.equal(platform);
      expect((device.toJSON() as any).platform).to.equal(platform);
    }
  });

  /**
   * PCP2, PCP3, PCP4 - DevicePushDetails state values, errorReason, and
   * recipient parse from wire JSON. Wire states are uppercase per ably-js's
   * type declarations (see the spec's Notes).
   */
  // UTS: rest/unit/PCP4/device-push-state-values-0
  it('PCP2, PCP3, PCP4 - DevicePushDetails state values, errorReason, and recipient parse from wire JSON', function () {
    // The spec maps each wire state to a DevicePushState enum member
    // (Active/Failing/Failed); ably-js has no such enum and exposes the raw
    // wire string, so the parsed-state assertion uses the wire form (recorded
    // as a deviation per the spec's Notes).
    const testCases = ['ACTIVE', 'FAILING', 'FAILED'];

    for (const wireState of testCases) {
      const device = DeviceDetails.fromValues({
        id: 'device-001',
        platform: 'ios',
        formFactor: 'phone',
        push: {
          recipient: { transportType: 'apns', deviceToken: 'apns-token-1' },
          state: wireState,
          errorReason: { code: 71103, statusCode: 500, message: 'upstream failure' },
        },
      });

      // PCP4 — state parses to (ably-js: is exposed as) the wire value
      expect(device.push!.state).to.equal(wireState);

      // PCP2 — errorReason parses as ErrorInfo
      // DEVIATION(PCP2): ably-js leaves push.errorReason as a plain object (its
      // wire field is `error`, and no nested ErrorInfo conversion is applied).
      if (process.env.RUN_DEVIATIONS) {
        expect((device.push as any).errorReason).to.be.instanceOf(ErrorInfo);
      }
      expect((device.push as any).errorReason.code).to.equal(71103);

      // PCP3 — recipient is an opaque string map, preserved as-received
      expect(device.push!.recipient).to.deep.equal({
        transportType: 'apns',
        deviceToken: 'apns-token-1',
      });
    }
  });

  /**
   * PCS5 - forDevice sets channel and deviceId, leaving clientId null.
   * ably-js has no forDevice factory; the subscription is constructed by the
   * equivalent means the spec's Notes sanction (fromValues with exactly the
   * channel and deviceId), asserting the same exactly-one outcome.
   */
  // UTS: rest/unit/PCS5/push-channel-subscription-for-device-0
  it('PCS5 - forDevice sets channel and deviceId, leaving clientId null', function () {
    // DEVIATION(PCS5): ably-js exposes no PushChannelSubscription.forDevice factory
    if (process.env.RUN_DEVIATIONS) {
      expect(typeof (PushChannelSubscription as any).forDevice).to.equal('function');
    }

    const subscription = PushChannelSubscription.fromValues({
      channel: 'push-test-channel',
      deviceId: 'device-001',
    });

    expect(subscription.channel).to.equal('push-test-channel'); // PCS4
    expect(subscription.deviceId).to.equal('device-001'); // PCS2
    expect(subscription.clientId ?? null).to.equal(null); // PCS5 — the other identifier stays null

    const jsonData = subscription.toJSON();
    expect(jsonData.channel).to.equal('push-test-channel');
    expect(jsonData.deviceId).to.equal('device-001');
    expect(jsonData.clientId ?? null).to.equal(null);
  });

  /**
   * PCS5 - forClientId sets channel and clientId, leaving deviceId null.
   * ably-js has no forClientId factory; constructed by the sanctioned
   * equivalent means (fromValues with exactly the channel and clientId).
   */
  // UTS: rest/unit/PCS5/push-channel-subscription-for-client-1
  it('PCS5 - forClientId sets channel and clientId, leaving deviceId null', function () {
    // DEVIATION(PCS5): ably-js exposes no PushChannelSubscription.forClientId factory
    if (process.env.RUN_DEVIATIONS) {
      expect(typeof (PushChannelSubscription as any).forClientId).to.equal('function');
    }

    const subscription = PushChannelSubscription.fromValues({
      channel: 'push-test-channel',
      clientId: 'client-abc',
    });

    expect(subscription.channel).to.equal('push-test-channel'); // PCS4
    expect(subscription.clientId).to.equal('client-abc'); // PCS3
    expect(subscription.deviceId ?? null).to.equal(null); // PCS5 — the other identifier stays null

    const jsonData = subscription.toJSON();
    expect(jsonData.channel).to.equal('push-test-channel');
    expect(jsonData.clientId).to.equal('client-abc');
    expect(jsonData.deviceId ?? null).to.equal(null);
  });

  /**
   * PCS5 - precisely one of deviceId or clientId is non-null. Asserts the two
   * portable facets: construction with one identifier leaves the other null,
   * and a (server-invalid) wire object carrying both identifiers is handled
   * deterministically — ably-js takes the spec's as-received branch (fromValues
   * copies fields without validation).
   */
  // UTS: rest/unit/PCS5/exactly-one-of-device-client-2
  it('PCS5 - precisely one of deviceId or clientId is non-null', function () {
    // 1. Construction — each factory populates exactly one identifier (PCS5).
    // DEVIATION(PCS5): ably-js has no forDevice/forClientId factories and no
    // exactly-one enforcement; the adapted equivalent construction below shows
    // the observable outcome (the unset identifier stays null).
    if (process.env.RUN_DEVIATIONS) {
      expect(typeof (PushChannelSubscription as any).forDevice).to.equal('function');
      expect(typeof (PushChannelSubscription as any).forClientId).to.equal('function');
    }
    expect(PushChannelSubscription.fromValues({ channel: 'ch', deviceId: 'device-001' }).clientId ?? null).to.equal(
      null,
    );
    expect(PushChannelSubscription.fromValues({ channel: 'ch', clientId: 'client-abc' }).deviceId ?? null).to.equal(
      null,
    );

    // 2. Wire parsing — both identifiers present: reject, or expose as-received.
    // ably-js takes branch (b): exposed as-received.
    const wire = { channel: 'ch', deviceId: 'device-001', clientId: 'client-abc' };
    const subscription = PushChannelSubscription.fromValues(wire);
    expect(subscription.channel).to.equal('ch');
    expect(subscription.deviceId).to.equal('device-001');
    expect(subscription.clientId).to.equal('client-abc');
  });
});
