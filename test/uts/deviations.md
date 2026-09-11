# UTS Test Deviations

Tracks confirmed ably-js non-compliance with the Ably spec. Each entry corresponds to a test that fails because ably-js behavior differs from the spec requirement. Tests assert spec behavior and are allowed to fail — the failures document genuine deviations.

Tests marked with `if (!process.env.RUN_DEVIATIONS) this.skip()` are skipped by default but can be run with `RUN_DEVIATIONS=1 npm run test:uts`.

## Skipped Deviations (RUN_DEVIATIONS=1 to run)

These tests assert spec behavior but are skipped by default because they are known to fail. Run with `RUN_DEVIATIONS=1` to execute them.

### realtime_client: RTC1a - echoMessages default does not send echo=true

**Spec (RTC1a)**: The `echoMessages` option (default true) should be sent as `echo=true` query parameter.

**ably-js behavior**: ably-js only sends `echo=false` when `echoMessages` is explicitly false. When `echoMessages` is true (default), no `echo` parameter is sent — the server defaults to echoing.

**Test**: `RTC1a - echoMessages default sends echo=true` — asserts `echo=true` per spec.

---

### channel_detach: RTL5k - ATTACHED while detached does not send DETACH

**Spec (RTL5k)**: If the channel receives an ATTACHED message while in the DETACHED state, it should send a new DETACH message.

**ably-js behavior**: ably-js re-enters 'attached' state instead of sending DETACH when ATTACHED is received while detached.

**Test**: `RTL5k - ATTACHED while detached sends DETACH` — asserts `detachMessageCount == 2` and `channel.state == 'detached'` per spec.

---

### presence_reentry: RTP17e - re-entry error message missing clientId

**Spec (RTP17e)**: Failed re-entry should emit UPDATE with error code 91004 and message indicating the failure and clientId.

**ably-js behavior**: The error message is `'Presence auto re-enter failed'` without including the clientId.

**Test**: `RTP17e - failed re-entry emits UPDATE with error` — asserts `message.includes('my-client')` per spec.

---

### channel_publish: RTL6i3 / RSL1e - null fields included in wire JSON

**Spec (RTL6i3/RSL1e)**: Null values should be omitted from wire JSON.

**ably-js behavior**: Includes `"data": null` instead of omitting the key. Similarly for `name`.

**Tests**: `RTL6i3 - null name/data fields handled correctly` (realtime), `RSL1e - null name omitted from body`, `RSL1e - null data omitted from body` (REST).

**Issue**: [#2199](https://github.com/ably/ably-js/issues/2199)

---

### connection_ping: RTN13d - ping does not defer in non-connected states

**Spec (RTN13d)**: Ping should be deferred until the connection reaches a resolvable state.

**ably-js behavior**: `ping()` immediately rejects with "not connected".

**Test**: `RTN13d - ping deferred from CONNECTING until CONNECTED`.

**Issue**: [#2203](https://github.com/ably/ably-js/issues/2203)

---

### client_id: RSA7b - auth.clientId not derived from TokenDetails (REST)

**Spec (RSA7b)**: The clientId attribute of the Auth object should be derived from tokenDetails returned from auth requests.

**ably-js behavior**: `auth.clientId` is only set from `ClientOptions.clientId`, not extracted from tokenDetails.

**Tests**: `RSA7b - clientId from TokenDetails`, `RSA7b - clientId from authCallback TokenDetails`, `RSA7 - clientId updated after authorize()`, `RSA12 - Wildcard clientId`, `RSA7 - case 5: clientId inherited from token`.

**Issue**: [#2192](https://github.com/ably/ably-js/issues/2192)

---

### token_renewal: RSA4b - Authorization header overwritten on retry / no retry limit

**Spec (RSA4b/RSC10)**: Token renewal should use the new token's header and retry at most once.

**ably-js behavior**: The retry sends the old token's authorization header. The retry loop is unbounded.

**Tests**: `RSA4b - renewal on 40142 error`, `RSC10 - transparent retry after renewal`, `RSA4b - renewal limit`.

**Issue**: [#2193](https://github.com/ably/ably-js/issues/2193)

---

### annotations: RSAN1a3 - type validation missing

**Spec (RSAN1a3)**: The SDK must validate that the user supplied a `type`.

**ably-js behavior**: `constructValidateAnnotation()` does not validate that `type` is present.

**Tests**: `RSAN1a3 - type required` (realtime), `RTAN1a - publish validates type is required` (REST).

**Issue**: [#2194](https://github.com/ably/ably-js/issues/2194)

---

### annotations: RSAN1c4 / RSC22d - idempotent IDs not generated

**Spec (RSAN1c4)**: Annotations with empty `id` should get a generated idempotent ID. **Spec (RSC22d)**: Same for batch publish.

**ably-js behavior**: Neither `RestAnnotations.publish()` nor `batchPublish()` generates idempotent IDs.

**Tests**: `RSAN1c4 - idempotent ID generated`, `RSC22d - batch publish generates idempotent IDs`.

**Issue**: [#2195](https://github.com/ably/ably-js/issues/2195)

---

### rest_client: RSC7c - addRequestIds not implemented

**Spec (RSC7c)**: The `addRequestIds` option should add a `request_id` query parameter to all REST requests.

**ably-js behavior**: The option is accepted but has no effect.

**Tests**: `RSC7c - request_id query param when addRequestIds is true`, `RSC22_Headers2 - request_id included when addRequestIds enabled`.

**Issue**: [#2196](https://github.com/ably/ably-js/issues/2196)

---

### fallback: RSC15l4 - CloudFront Server header does not trigger fallback

**Spec (RSC15l4)**: A response with a `Server: CloudFront` header and HTTP status `>= 400` should trigger fallback.

**ably-js behavior**: `shouldFallback` only receives the error object, not response headers. The `Server` header is not inspected anywhere in the fallback decision path.

**Tests**: `RSC15l4 - CloudFront Server header triggers fallback` (unit, `rest/unit/fallback.test.ts`; also skipped at integration tier in `rest/integration/proxy/rest_fallback.test.ts`).

**Issue**: [#2197](https://github.com/ably/ably-js/issues/2197)

---

### fallback: REC1b2 - IPv6 endpoint address not bracketed

**Spec (REC1b2)**: IPv6 addresses should be supported as endpoint values.

**ably-js behavior**: URL construction produces `https://::1:443/time` instead of `https://[::1]:443/time`.

**Test**: `REC1b2 - endpoint as IPv6 address`.

**Issue**: [#2198](https://github.com/ably/ably-js/issues/2198)

---

### options_types: AO2 - authMethod default not stored

**Spec (AO2)**: `authMethod` should default to `'GET'` and be stored in auth options.

**ably-js behavior**: Default `authMethod` is not stored.

**Test**: `AO2 - authMethod defaults to GET`.

**Issue**: [#2205](https://github.com/ably/ably-js/issues/2205)

---

### presence_message_types: TP3h - memberKey not exposed

**Spec (TP3h)**: `PresenceMessage` should expose a `memberKey` property.

**ably-js behavior**: `memberKey` is not exposed on `PresenceMessage`.

**Test**: `TP3h - memberKey format`.

**Issue**: [#2202](https://github.com/ably/ably-js/issues/2202)

---

### channels: RTL4c - errorReason not cleared on successful re-attach

**Spec (RTL4c, proposed)**: When a confirmation ATTACHED is received, the channel's errorReason should be set to null.

**ably-js behavior**: After a channel enters FAILED state, a subsequent successful `attach()` does not clear `errorReason`.

**Note**: This is a proposed spec change (see [specification#459](https://github.com/ably/specification/issues/459)).

**Tests**: `RTL4g - errorReason cleared on re-attach from FAILED`, `RTL4g - errorReason cleared on re-attach and detach`.

---

### presence_sync: RTP18a - new sync does not discard in-flight sync

**Spec (RTP18a)**: If a new SYNC sequence begins while one is in progress, the previous sync should be discarded.

**ably-js behavior**: Does not discard the previous sync.

**Test**: `RTP18a - new sync discards previous in-flight sync`.

---

### integration/auth: RSC10 - token renewal infinite loop with expired JWT

**Spec (RSC10)**: When a REST request fails with a token error (40140-40149), the client should renew the token and retry.

**ably-js behavior**: Same root cause as the unit test RSA4b deviation — `withAuthDetails` overwrites the new authorization header with the stale one from the previous attempt, causing an infinite retry loop. Confirmed against the sandbox: the authCallback is called hundreds of times, each returning a valid JWT, but the request always sends the old expired token.

**Test**: `RSC10 - token renewal with expired JWT` in `rest/integration/auth.test.ts`.

**Issue**: [#2193](https://github.com/ably/ably-js/issues/2193) (same root cause as unit test deviations RSA4b/RSC10)

---

### push: RSH1b3/RSH1b5/RSH1c3/RSH1c4 - admin operations for the local device lack push device authentication

**Spec (RSH1b3, RSH1b5, RSH1c3, RSH1c4)**: When the client has been activated as a push target device and an admin operation (`deviceRegistrations.save/remove/removeWhere`, `channelSubscriptions.save/remove`) references the present client's own `deviceId`, the request must include push device authentication (RSH6).

**ably-js behavior**: `DeviceRegistrations` and `ChannelSubscriptions` (`src/common/lib/client/push.ts`) never add device-auth headers; the local device is not consulted when building admin requests.

**Tests**: `push_device_auth.test.ts` — `RSH6a/admin-device-registrations-save-own-device-0`, `RSH6a/admin-channel-subscriptions-save-own-device-2`, `RSH6a/admin-remove-where-own-device-3`: the header assertions are `RUN_DEVIATIONS`-guarded (the rest of each test passes; observed admin request headers carry only basic key auth).

**Fix**: planned as a separate PR. Note ably-java conforms (Android `Push.pushRequestHeaders(deviceId)` merges `X-Ably-DeviceToken` when the deviceId is the local device's).

---

### push: RSH3h/RSH8a1 - corrupt persisted state neither discarded nor survivable

**Spec (RSH3h, RSH8a1)**: If loading the `LocalDevice` `id` or `deviceSecret` fails, all persisted LocalDevice attributes and all persisted machine data must be discarded, so the machine starts in `NotActivated`; an unrecognised persisted machine state must likewise fall back, never crash.

**ably-js behavior**: two gaps. (1) `loadPersistedAsync()` loads an incomplete pair (seeded `deviceId`, missing `deviceSecret`) without discarding anything — the stale identity token and machine state are honoured, so `activate()` resolves immediately with zero requests. (2) Machine rehydration does `new ActivationStates[name]()` (`src/plugins/push/pushactivation.ts:314`); an unrecognised `ably.push.activationState` value throws `TypeError: ... is not a constructor`, rejecting `activate()` outright.

**Tests**: `RSH8a1 - corrupt device state is discarded`, `RSH8a1 - unrecognised machine state falls back to NotActivated` (`push_activation_persistence.test.ts`), skipped via `RUN_DEVIATIONS`.

**Fix**: planned as a separate PR.

---

### push: RSH3a2a/RSH3f1 - re-activation registration sync not implemented

**Spec (RSH3a2a, RSH3a2a1–RSH3a2a4, RSH3f1a)**: `CalledActivate` on a device that already has a `deviceIdentityToken` validates the registration: the RSH3d3b PATCH sync (or custom `registerCallback`), preceded by the RSH3a2a1 clientId-compatibility check (61002), transitioning through `WaitingForRegistrationSync`.

**ably-js behavior**: `NotActivated` + `CalledActivate` with a registered device re-queues the event into `WaitingForNewPushDeviceDetails`, which resolves `activate()` immediately — no sync request, no `registerCallback` validation call. The 61002 check exists (`pushactivation.ts:678`) but is dead code: `loadPersistedAsync()` overwrites `device.clientId` with the present client's `auth.clientId` (line 194) and clientId is never persisted, so a mismatch can never be observed. Consequently `AfterRegistrationSyncFailed` is unreachable via `activate()` (it is reachable via a failed `updateToken` sync).

**Tests** (all `RUN_DEVIATIONS`-skipped): `RSH3a2a3/activate-existing-registration-sync-0`, `RSH3a2a2/...-register-callback-0`, `RSH3a2a1/activate-clientid-mismatch-0`, `RSH3e3c/sync-failure-then-reactivate-0`, `RSH3f2a/deactivate-after-sync-failure-0`, `RSH3g3b/deregister-failure-rollback-after-sync-failed-1` (`push_activation_state_machine.test.ts`); `RSH4/second-activate-queued-during-activate-sync-1` (`push_activation_event_queue.test.ts`).

**Fix**: planned as a separate PR (implement the sync per the amended RSH3a2a3 — a PATCH, which ably-js's existing `updateRegistration()` already performs elsewhere).

---

### push: RSH3b1a/RSH3c1a/RSH3g1a - concurrent activate/deactivate rejected instead of coalesced

**Spec**: a repeated `CalledActivate`/`CalledDeactivate` while one is in flight self-transitions; both calls resolve when the operation completes.

**ably-js behavior**: `Push.activate()`/`deactivate()` reject a second concurrent call with ErrorInfo 40000 "Activation/Deactivation already in progress" (`src/common/lib/client/push.ts:67-74, 116-123`) before any event reaches the machine. Core single-request behaviour conforms.

**Tests**: assertion-level guards in `RSH3b1a/activate-while-waiting-push-details-0`, `RSH3c1a/activate-while-registering-0`, `RSH3g1a/deactivate-while-deregistering-0` — the adapted branch asserts the 40000 rejection.

---

### push: RSH6a/RSH6b/RSH3d2b - device auth via bearer Authorization; no deviceSecret auth; no-token registration crashes

**Spec (RSH6a)**: device auth adds an `X-Ably-DeviceToken` header carrying the `deviceIdentityToken`. **(RSH6b)**: with a `deviceSecret` but no identity token, `X-Ably-DeviceSecret` is used instead.

**ably-js behavior**: the activation plugin's PATCH/DELETE use `authorization: Bearer base64(deviceIdentityToken)` (`pushactivation.ts:253`), or an `access_token` param; only `LocalDevice.listSubscriptions()` uses `X-Ably-DeviceToken` (`pushactivation.ts:126`). Observed live through the proxy: the device bearer **replaces** the client's key/token auth on those requests (both write the lowercase `authorization` header), so per RSH3d2b no other auth is present — and it works against the real service only because the `deviceIdentityToken` is itself an Ably token, authenticating as ordinary token auth rather than via the device-auth path (the same bearer is NOT accepted as device auth on `/push/channelSubscriptions`). There is no `X-Ably-DeviceSecret` path: `getAuthDetails` throws 50000 without an identity token, outside `deregister()`'s try/catch, so `deactivate()` never settles. Additionally, a `registerCallback` result lacking `deviceIdentityToken` crashes the machine (`TypeError` at `pushactivation.ts:776` via nextTick; `activate()` never settles) — the guard at line 384 only rejects a falsy registration.

**Tests**: assertion-level guards in `RSH2b/deactivate-full-flow-0`, `RSH3d3b/update-token-patch-0` (adapted branch asserts the bearer header); full skip `RSH6b/device-secret-auth-before-identity-token-0` (`push_device_auth.test.ts`).

**Fix**: header form planned as a separate PR; note ably-java/ably-cocoa send `X-Ably-DeviceToken` with a **base64-encoded** value, which RSH6a's wording doesn't mention — spec clarification needed on the value encoding.

---

### push: RSH3a1c - deactivate from NotActivated does not deregister a registered device

**Spec (RSH3a1c)**: in `NotActivated`, on `CalledDeactivate`, a device with a `deviceIdentityToken` deregisters per RSH3d2.

**ably-js behavior**: `NotActivated` resolves `CalledDeactivate` immediately without checking for a `deviceIdentityToken` — zero requests where the spec expects a DELETE with device auth.

**Tests**: `RSH3a1c/deactivate-not-activated-with-token-0`, skipped via `RUN_DEVIATIONS`.

---

### push: RSH3d2c1 - deregistration status classification unimplemented

**Spec (RSH3d2c1)**: `Deregistered` on 2xx, 401, or error code 40005; `DeregistrationFailed` otherwise.

**ably-js behavior**: `deregister()` fires `DeregistrationFailed` on any request error — a 401 or 40005 DELETE makes `deactivate()` reject and roll back instead of clearing the registration.

**Tests**: `RSH3d2c1/deregister-401-succeeds-0`, `RSH3d2c1/deregister-40005-succeeds-1` (unit), and `rest/proxy/RSH3d2c1/deregister-401-classified-0`, `rest/proxy/RSH3d2c1/deregister-40005-classified-1` (`test/uts/rest/integration/proxy/push_activation.test.ts` — observed live through the proxy: deactivate() rejects with the injected 40100/40005 error and rolls back), all skipped via `RUN_DEVIATIONS`.

---

### push: RSH3a2b - deviceSecret entropy below spec

**Spec (RSH3a2b)**: `deviceSecret` must be created from secure random data with a digest of at least 32 bytes, base64-encoded.

**ably-js behavior**: `resetId()` generates a ulid (26-char Crockford base32, ~19 bytes when base64-decoded per the test's method), well short of the 32-byte digest requirement.

**Tests**: assertion-level guard in `RSH3a2b/device-id-secret-generation-0` (uniqueness assertions pass).

---

### push: RSH8d/RSH8e/RSH8f - clientId lifecycle not wired into LocalDevice

**Spec**: a `clientId` learned late (RSA7b2/RSA7b3, per RSH8d) is set and persisted on the LocalDevice, triggering a registration sync when registered (RSH8e); a `clientId` in the registration response is adopted (RSH8f).

**ably-js behavior**: `GotDeviceRegistration` captures only `deviceIdentityToken` — a response `clientId` is discarded (RSH8f). There is no hook from auth into the LocalDevice, and `auth.clientId` is not derived from TokenDetails at all (same root cause as the RSA7b deviation, issue [#2192](https://github.com/ably/ably-js/issues/2192)) — a late-identified token is silently ignored by the push layer (RSH8d/RSH8e).

**Tests**: `RSH8f/clientid-from-registration-response-0`, `RSH8d/late-clientid-persisted-0`, `RSH8e/late-clientid-triggers-sync-0` (`local_device.test.ts`), skipped via `RUN_DEVIATIONS`.

---

### push: RSH8a - partial persisted state not loaded (recipient ignored without a device id)

**Spec (RSH8a)**: the LocalDevice attributes are populated from persisted state "to the extent that they exist" — a persisted `ably.push.pushRecipient` with no id/secret pair is a legitimate partial state (consumed by RSH3a2c, which then skips the platform token request).

**ably-js behavior**: `loadPersistedAsync()` reads `ably.push.pushRecipient` (and the identity token) only when `ably.push.deviceId` is persisted (`pushactivation.ts:196-206`); otherwise it calls `resetId()` and never reads the recipient, so activation falls through to `getPushDeviceDetails`/`requestToken`.

**Tests**: `test/uts/rest/integration/push_activation.test.ts` seeds a deviceId/deviceSecret pair alongside the recipient as a workaround (DEVIATION-commented); ably-dart exhibited the same gap and was fixed.

**Fix**: candidate for the same PR as the RSH3h/RSH8a1 discard fixes.

---

### push: AfterRegistrationSyncFailed not persisted

**Spec**: which machine states are persisted is not prescribed, but the UTS suite observes settled state via the persisted `ably.push.activationState`.

**ably-js behavior**: only `NotActivated` and `WaitingForNewPushDeviceDetails` are persistent (`isPersistentState`, `pushactivation.ts:896`); after a failed sync the persisted value still reads `WaitingForNewPushDeviceDetails`.

**Tests**: assertion-level guards where the spec asserts a persisted `AfterRegistrationSyncFailed` (`push_update_token.test.ts` sync-failure test; `rest/proxy/RSH3e3d/sync-failure-recovery-0` in `test/uts/rest/integration/proxy/push_activation.test.ts`).

---

### push: RSH8l/PCP3a/PDT4 - APNs token variants unimplemented (pending token-variants spec extension)

**Spec (PDT4, PCP3a, RSH8l2 — pending extension)**: `updateToken` with `apnsTokenType` targets a recipient slot in `apnsDeviceTokens`, preserving other registered variants.

**ably-js behavior**: `apnsTokenType` is silently ignored; `updateToken({transportType: 'apns', token, apnsTokenType: 'pushToStart'})` resolves and PATCHes `{push: {recipient: {transportType: 'apns', deviceToken: token}}}` — clobbering the default token; no `apnsDeviceTokens` map exists (`push.ts:194-197` unconditionally replaces the recipient).

**Tests**: `RSH8l2/update-token-push-to-start-10`, `RSH8l2/update-token-variant-preserves-others-11`, skipped via `RUN_DEVIATIONS`.

**Fix**: to follow the token-variants spec extension PR.

---

### push_types: PCP2/PCP4/PCS5 - push type surface differences

**Spec**: `DevicePushDetails.errorReason` (`ErrorInfo`), `state` enum (`Active`/`Failing`/`Failed`), `PushChannelSubscription.forDevice`/`forClientId` factories with exactly-one enforcement (PCS5); `DeviceDetails.metadata` a string map (PCD5).

**ably-js behavior**: `fromValues` converts only a top-level `error` to `ErrorInfo` — a `push.errorReason` passes through as a plain object, and `toJSON()` writes the push error as `push.error`, dropping a spec-named `errorReason` from serialization; there is no `DevicePushState` enum (raw uppercase wire strings `ACTIVE`/`FAILING`/`FAILED`); the PCS5 factories do not exist (`fromValues` copies as-received, no exactly-one enforcement); `metadata` is *typed* `string` but round-trips a map at runtime (type-level only).

**Tests**: assertion-level guards in `rest/unit/types/push_types.test.ts` (factories constructed via `fromValues` per the spec's sanctioned equivalent).

---

### push: RSH3e2c/RSH3e3d - updatedCallback not implemented (only the deprecated updateFailedCallback)

**Spec (RSH3e2c, RSH3e3d)**: `Push#activate` accepts an `updatedCallback` which is called with no error on `RegistrationSynced` (when the sync was not triggered by `CalledActivate`) and with the error on `SyncRegistrationFailed`. RSH3e3a (`updateFailedCallback`, failure-only) is deprecated.

**ably-js behavior**: `push.activate(registerCallback, updateFailedCallback)` exposes only the deprecated failure-only callback; there is no success notification path for background registration syncs.

**Tests**: `push_update_token.test.ts` — `RSH3e3d/update-token-sync-failure-callback-4`: failure delivery adapted to `updateFailedCallback` (passes); the RSH3e2c success-callback assertion is `RUN_DEVIATIONS`-guarded.

**Fix**: planned as a separate PR (additive: accept `updatedCallback`, keep `updateFailedCallback` as a deprecated alias for the failure case).

---

### integration/push_admin: RSH1b2 - push device list pagination missing Link headers

**Spec (RSH1b2)**: `deviceRegistrations.list` with `limit` should support pagination via `hasNext()`.

**Server behavior**: The push admin `GET /push/deviceRegistrations` endpoint does not return `Link` headers when `limit` is used, even when more results exist. With 3 devices registered and `limit=2`, the response returns 2 items but `hasNext()` is false because there is no `Link: rel="next"` header.

**Test**: `RSH1b2 - list supports pagination with limit` in `rest/integration/push_admin.test.ts`.

**Issue**: [ably/realtime#8380](https://github.com/ably/realtime/issues/8380)

---

### integration/push_activation: registration-update PATCH rejected for ablyChannel-recipient devices (server issue, fixed pending deploy)

**Server behavior**: `PATCH /push/deviceRegistrations/:deviceId` fails with 400 (code 40000, `unknown transport type 'ablyChannel'`) for any device whose **stored** recipient is `ablyChannel`, regardless of the PATCH body — so the registration sync can never land against an `ablyChannel`-registered device.

**Tests**: `rest/integration/RSH2f/update-token-synced-0` (`rest/integration/push_activation.test.ts`) and `rest/proxy/RSH3e3d/sync-failure-recovery-0` (`rest/integration/proxy/push_activation.test.ts`), both of which sync a rotated token against an `ablyChannel`-seeded device. Skipped unconditionally (`this.skip()`) until the fix is deployed to the sandbox, then unskip.

**Issue**: [ably/realtime#8591](https://github.com/ably/realtime/pull/8591) (fix merged, pending sandbox deploy)

---

## Adapted Deviations (tests modified to match ably-js behavior)

These tests have been adapted from the UTS spec to account for ably-js API differences. The test still validates the underlying behavior but uses ably-js's actual API surface.

### objects/value_types: RTLMV4b - key-type validation untranslatable to JavaScript

**Spec (RTLMV4b)**: `objects/unit/RTLMV4b/evaluate-validates-keys-0` — LiveMap value type consumption validates that entry keys are strings.

**ably-js behavior**: JavaScript object keys are always coerced to strings, so a non-string key cannot reach the validation (the check itself exists at `livemap.ts` `validateKeyValue`). The test is omitted (the only spec Test ID without a derived test); the sibling RTLMV4a/RTLMV4c validation tests cover the reachable cases. The spec test now carries a language-applicability note sanctioning this omission (see the pseudocode conventions in the spec's `uts/README.md`).

---

### objects/internal_live_counter_api: RTLC12e1 - null increment amount defaults to 1 in JS (failure row not applicable)

**Spec (RTLC12e1)**: `increment(null)` is one of the invalid-amount table rows and must fail with 40003 — in languages where `null` is passable and distinguishable from an omitted argument.

**ably-js behavior**: `increment(null)` is runtime-reachable in JS, but the public API defines a nullish amount as equivalent to an omitted argument (`amount ?? 1` at the PathObject/Instance layer), so it increments by 1. What is unreachable is the 40003 failure path for the null row — not the input itself. The spec table carries a language-applicability note sanctioning this and directing such SDKs to assert the default-of-1 behavior instead.

**Test**: `RTLC12e1 - table-driven invalid increment amounts` (`test/uts/objects/unit/live_counter_api.test.ts`) — the null row asserts the increment-by-1 default, pinning the null-means-omitted contract; the remaining rows (NaN, ±Infinity, string, boolean, array, object) assert 40003.

---

### objects: user-facing ObjectData carries a deprecated `value` field

**Spec**: `PublicAPI::ObjectData` exposes the typed value fields (`boolean`/`bytes`/`number`/`string`/`json`).

**ably-js behavior**: `toUserFacingObjectData` (`src/plugins/liveobjects/objectmessage.ts`) additionally populates a legacy `value` convenience field on the public ObjectData. Harmless extra field; removal is a breaking change reserved for a future major.

**Tests**: `objects/unit/public_object_message.test.ts` exercises the public mapping.

---

### objects: harness and wire-format conventions (not behavioral deviations)

The wire protocol uses numeric operation actions and JSON-stringified `json`/`initialValue` payloads (OM/OD/TM definitions) — the UTS pseudo-code's string action names and parsed objects are readable renderings, and derived tests assert the real wire shapes. Internal-state tests (`objects_pool.test.ts`) observe private fields via `(channel as any)._object._state` etc., since internal-state observation is inherently SDK-specific.

---

## Spec Points Under Review (compliant, but questioned)

### objects/realtime_object: RTO18d - additive listener registration is a questioned spec point

**Spec (RTO18d / RTE4)**: registering the same listener instance twice for a sync-state event makes it fire twice per emission (additive registration).

**ably-js behavior**: **compliant** — ably-js's `EventEmitter` is list-backed, so the same listener registered twice fires twice; `RTO18d - Duplicate listener registered twice fires twice` passes.

**Why it's here**: the spec point itself is considered questionable — a listener registered twice runs identical logic, so invoking it twice for one event has no practical purpose. ably-java intentionally deviates (its core `EventEmitter` deduplicates by listener instance, firing once) and documents this as a deliberate deviation. Recorded here as a flag for spec reconsideration; ably-js is **not** changed (its behavior currently follows the spec). If the spec point is removed/relaxed, or if alignment on de-duplication is agreed, this becomes a no-op.

---

## Mock Infrastructure Limitations

### MsgPack encoding/decoding not supported (in this repo's harness — not a UTS limitation)

The UTS mock HTTP contract supports msgpack: `PendingRequest.body` is bytes, responses can carry raw byte bodies with a Content-Type, and the specs use `msgpack_encode`/`msgpack_decode` harness helpers (see the msgpack unit tests in `uts/rest/unit/{encoding/message_encoding.md, auth/token_renewal.md, presence/rest_presence.md, rest_client.md}`). It is **this repo's port** (`test/uts/mock_http.ts`) that operates at the JSON level (`respond_with` JSON-stringifies bodies; `PendingRequest.body` is `string | null`). Catch-up work: extend the mock to byte bodies and wire `@ably/msgpack-js` (already a dependency, and the platform's own msgpack implementation) as the encode/decode helpers, then implement the skipped tests below.

**Tests affected (10 skipped)**:

- `RSL4c` — binary data with msgpack protocol
- `RSL6` — msgpack bin/str type decoding (2 tests)
- `RSC8a` — default msgpack protocol Content-Type
- `RSC8d` — mismatched Content-Type response
- `RSC8e` — unsupported Content-Type response
- `RSC8` — msgpack error response decoding
- `RSC19c` — msgpack request headers/body/response (3 tests)
