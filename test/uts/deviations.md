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

### integration/push_admin: RSH1b2 - push device list pagination missing Link headers

**Spec (RSH1b2)**: `deviceRegistrations.list` with `limit` should support pagination via `hasNext()`.

**Server behavior**: The push admin `GET /push/deviceRegistrations` endpoint does not return `Link` headers when `limit` is used, even when more results exist. With 3 devices registered and `limit=2`, the response returns 2 items but `hasNext()` is false because there is no `Link: rel="next"` header.

**Test**: `RSH1b2 - list supports pagination with limit` in `rest/integration/push_admin.test.ts`.

**Issue**: [ably/realtime#8380](https://github.com/ably/realtime/issues/8380)

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

### MsgPack encoding/decoding not supported

The UTS mock HTTP infrastructure operates at the JSON level. It has no mechanism to encode/decode msgpack binary format.

**Tests affected (10 skipped)**:

- `RSL4c` — binary data with msgpack protocol
- `RSL6` — msgpack bin/str type decoding (2 tests)
- `RSC8a` — default msgpack protocol Content-Type
- `RSC8d` — mismatched Content-Type response
- `RSC8e` — unsupported Content-Type response
- `RSC8` — msgpack error response decoding
- `RSC19c` — msgpack request headers/body/response (3 tests)
