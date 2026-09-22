# Realtime UTS Test Audit

Comprehensive review of all 37 realtime UTS test files in `ably-js/test/uts/realtime/`, checking:

1. Does the UTS spec correctly interpret the features spec?
2. Does the ably-js test correctly implement the UTS spec?

Each finding was verified against the features spec (`specification/md/features.md`), the UTS spec (`specification/uts/realtime/unit/`), and the ably-js test code.

---

## Critical: Tests That Are Wrong

These tests actively assert incorrect behavior or are mislabeled in a way that hides real issues.

### 1. RTL4g errorReason clearing mislabeled as "UTS spec error"

**File**: `channels/channel_attributes.test.ts` ~line 147

**Problem**: Two tests are labeled "UTS spec error" and assert that `errorReason` persists after re-attach from FAILED. The comment claims: "the features spec only says when errorReason is SET... it never says it should be cleared."

**This is wrong.** RTL4g (features spec) explicitly states: "If the channel is in the `FAILED` state, the `attach` request sets its `errorReason` to `null`, and proceeds with a channel attach." The UTS spec correctly asserts `errorReason IS null` after re-attach from FAILED.

**What it actually is**: An ably-js deviation, not a UTS spec error. ably-js does not clear `errorReason` during attach from FAILED state.

**Fix**: Relabel as a deviation. Assert `errorReason === null` (spec behavior) with `RUN_DEVIATIONS` guard.

### 2. RTN15c7 missing error field and errorReason assertions

**File**: `connection/connection_failures.test.ts` ~line 159

**Problem**: The test for failed connection resume sends a CONNECTED message with a new `connectionId` but **omits the `error` field entirely**. The test only checks `connection.id`, `connection.key`, and `connection.state`.

**Features spec (RTN15c7)**: "CONNECTED ProtocolMessage with a new connectionId and an **ErrorInfo in the error field**. The error should be set as the reason in the CONNECTED event, and as the Connection#errorReason."

**UTS spec**: Correctly includes `error: ErrorInfo(code: 80008, statusCode: 400, message: "Unable to recover connection")` and asserts `connection.errorReason IS NOT null` and `errorReason.code == 80008`.

**Fix**: Add `error` field to the mock CONNECTED message. Add assertions on `connection.errorReason` and the CONNECTED event's `reason`.

### 3. RTN14g tests wrong scenario

**File**: `connection/connection_open_failures.test.ts` ~line 352

**Problem**: The test first connects successfully (receives CONNECTED), then sends an ERROR protocol message. This is the RTN15j scenario (ERROR during an established connection), not RTN14g (ERROR during initial connection opening).

**Features spec (RTN14g)**: Lives under "Connection opening failures" — ERROR received before the connection is established.

**UTS spec**: Correctly has the ERROR sent during connection opening (`onConnectionAttempt` sends ERROR before any CONNECTED message).

**Fix**: Restructure the test to send the ERROR during the opening phase, before any CONNECTED message is received.

---

## High Priority: Missing Tests

### 4. RTN15h2 token renewal failure sub-case missing

**File**: `connection/connection_failures.test.ts`

**Present**: The happy-path RTN15h2 test exists (line ~364) — token error triggers renewal and successful reconnect.

**Missing**: The UTS spec also defines a failure sub-case (token renewal itself fails → connection transitions to DISCONNECTED). This test is not present in the ably-js file.

**Features spec (RSA4a2)**: If token renewal fails and there are no means to renew, the connection should transition to FAILED with error code 40171.

### 5. RTL17 test missing

**File**: `channels/channel_subscribe.test.ts`

RTL17 is listed in the file header comment but has no corresponding `it(...)` block.

**Features spec (RTL17)**: "No messages should be passed to subscribers if the channel is in any state other than ATTACHED."

**UTS spec**: Defines a complete test — subscribe with `attachOnSubscribe: false`, send a MESSAGE while ATTACHING, assert no messages delivered.

### 6. RTN25/RTN14b token error — wrong expected state and error code (non-renewable case)

**File**: `connection/error_reason.test.ts` ~line 133

**Scenario**: ERROR ProtocolMessage with token error (40142) during initial connection. Client has `token: "expired_token"` — no key, no authCallback → no means to renew.

**UTS spec** (`error_reason_test.md` ~line 178): Labels this "RTN14b, RTN15h". Expects DISCONNECTED with `errorReason.code == 40142`.

**Features spec**: RTN14b says for token ERROR during connection opening: "If no means to renew the token is provided, RSA4a applies." RSA4a2 says: "transition the connection to the FAILED state" with error code 40171.

**Both the expected state (should be FAILED, not DISCONNECTED) and error code (should be 40171, not 40142) are wrong in the UTS spec.** This is a UTS spec error — it describes ably-js's actual behavior (which has an explicit workaround at `connectionmanager.ts` line 804: `TODO remove below line once realtime sends token errors as DISCONNECTEDs`) rather than the features spec requirement.

**Note**: The RSA4a (non-renewable) and RSA4b (renewable) cases ARE tested separately, but in different files:

- **RTN14b (ERROR during connection, non-renewable)**: `error_reason.test.ts` — this test (wrong expectations as described above)
- **RTN15h1 (DISCONNECTED while connected, non-renewable)**: `connection_failures.test.ts` ~line 317 — correctly expects FAILED state
- **RTN15h2 (DISCONNECTED while connected, renewable)**: `connection_failures.test.ts` ~line 364 — correctly expects reconnect

So the RTN15h tests in `connection_failures.test.ts` correctly distinguish the two cases. The error is only in the RTN14b/RTN25 test in `error_reason.test.ts`, where the non-renewable initial-connection case expects DISCONNECTED instead of FAILED.

---

## UTS Spec Errors

These are errors in the UTS specs in the specification repo that need fixing regardless of the ably-js tests.

### 7. RTL4j — ATTACH_RESUME after detach+reattach

**UTS spec**: `channel_attach.md` ~line 793 — tests attach → detach → reattach and asserts the second attach SHOULD have `ATTACH_RESUME` flag.

**Features spec (RTL4j1)**: `attachResume` is set to `false` when the channel moves to DETACHING. A detach+reattach is therefore a clean attach and should NOT have `ATTACH_RESUME`.

**Fix**: UTS spec should assert the second attach does NOT have `ATTACH_RESUME`.

### 8. "Detach clears errorReason" — no spec basis

**UTS spec**: `channel_detach.md` ~line 700 — test "RTL5 - Detach clears errorReason" asserts `channel.errorReason IS null` after detach.

**Features spec (RTL5)**: Defines detach behavior across RTL5a through RTL5l. None mention clearing `errorReason`. The only spec points that clear channel `errorReason` are RTL4g (attach from FAILED) and RTN11d (reconnect clears all channel errorReasons).

**Fix**: Remove or relabel this UTS test. If the intent was to test errorReason clearing on re-attach, it belongs under RTL4g.

### 9. `suspendedRetryTimeout` used instead of `channelRetryTimeout`

**UTS specs**: Multiple channel-related UTS files use `suspendedRetryTimeout` for channel retry after SUSPENDED state: `channel_server_initiated_detach.md`, `channel_connection_state.md`, `channel_error.md`, `channel_attach.md`.

**Features spec**: `suspendedRetryTimeout` (TO3l2) is for CONNECTION suspended state retry (default 30s). `channelRetryTimeout` (TO3l7) is for CHANNEL suspended state retry (default 15s). RTB1 explicitly distinguishes them.

**Fix**: Replace `suspendedRetryTimeout` with `channelRetryTimeout` in all channel-related UTS specs. These have different defaults (30s vs 15s) so using the wrong one can mask timing bugs.

---

## Stale Documentation

### 10. `channels_collection.test.ts` header comment

**File**: `channels/channels_collection.test.ts` line 13

**Comment**: "ably-js release() is synchronous and throws on attached channels."

**Reality**: Commit `861bdc76` changed `release()` to implement RTS4a — it now detaches first, then removes. The test body at line ~176 correctly tests this behavior. Only the header comment is stale.

### 11. `deviations.md` RTS4a entry is stale

**File**: `deviations.md` — "channels_collection: RTS4a - release throws on attached channels"

**Reality**: ably-js now complies with RTS4a (detach-then-release). The `RTS4a - release detaches and removes attached channel` test passes. The deviations entry should be removed.

---

## Summary Table

| #   | Severity | Spec Point   | File                     | Issue                                                                                                                                        |
| --- | -------- | ------------ | ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Critical | RTL4g        | channel_attributes       | Deviation mislabeled as UTS spec error                                                                                                       |
| 2   | Critical | RTN15c7      | connection_failures      | Missing error field and errorReason assertions                                                                                               |
| 3   | Critical | RTN14g       | connection_open_failures | Tests wrong scenario (RTN15j instead of RTN14g)                                                                                              |
| 4   | High     | RTN15h2      | connection_failures      | Token renewal failure sub-case missing                                                                                                       |
| 5   | High     | RTL17        | channel_subscribe        | Test declared in header but not implemented                                                                                                  |
| 6   | High     | RTN14b/RTN25 | error_reason             | Non-renewable token error: wrong expected state (DISCONNECTED→FAILED) and code (40142→40171). RTN15h1/h2 in connection_failures are correct. |
| 7   | UTS fix  | RTL4j        | channel_attach.md        | Wrong ATTACH_RESUME expectation after detach+reattach                                                                                        |
| 8   | UTS fix  | RTL5         | channel_detach.md        | "Detach clears errorReason" has no spec basis                                                                                                |
| 9   | UTS fix  | Various      | 4 channel specs          | `suspendedRetryTimeout` should be `channelRetryTimeout`                                                                                      |
| 10  | Docs     | —            | channels_collection      | Stale header comment about release() throwing                                                                                                |
| 11  | Docs     | RTS4a        | deviations.md            | Stale entry — ably-js now complies                                                                                                           |

---

## Resolution Status

All findings have been addressed. UTS specs fixed, ably-js tests updated. Results:

| #   | Finding                    | Resolution                                                                                                                                                         | ably-js                                                                  |
| --- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| 1   | RTL4g mislabeled           | Test fixed to assert spec behavior (errorReason cleared)                                                                                                           | **FAILS** — ably-js does not clear errorReason on re-attach from FAILED  |
| 2   | RTN15c7 missing assertions | Added error field to mock + errorReason/event assertions                                                                                                           | **PASSES**                                                               |
| 3   | RTN14g wrong scenario      | Restructured to send ERROR during connection opening                                                                                                               | **PASSES**                                                               |
| 4   | RTN15h2 failure sub-case   | Not added (out of scope for this fix round)                                                                                                                        | —                                                                        |
| 5   | RTL17 missing              | Test added                                                                                                                                                         | **PASSES** — ably-js correctly drops messages when not ATTACHED          |
| 6   | RTN25/RTN14b token error   | UTS spec + test fixed: expect FAILED/40171                                                                                                                         | **PASSES** — ably-js correctly transitions to FAILED with 40171          |
| 7   | RTL4j ATTACH_RESUME        | UTS spec fixed: test via setOptions reattach, not detach+reattach                                                                                                  | ably-js test already correct (was not using UTS detach+reattach pattern) |
| 8   | RTL5 detach errorReason    | UTS test removed (no spec basis)                                                                                                                                   | —                                                                        |
| 9   | suspendedRetryTimeout      | Fixed in 3 UTS specs (channel_error, channel_server_initiated_detach, channel_attach). channel_connection_state left unchanged (correct: connection-level option). | ably-js tests already used correct `channelRetryTimeout`                 |
| 10  | Stale header comment       | Fixed in channels_collection.test.ts                                                                                                                               | —                                                                        |
| 11  | Stale RTS4a deviation      | Removed from deviations.md                                                                                                                                         | —                                                                        |

**Final test counts: 748 passing, 39 pending, 2 failing.**

The 2 failures are the new RTL4g tests (errorReason clearing) — a genuine ably-js deviation from the spec.

---

## Coverage Gaps (Not Audited in Detail)

Many UTS spec tests are not yet translated to ably-js across all realtime test files. This is expected — the initial translation covered priority spec points. A full coverage comparison (UTS spec tests vs ably-js tests) was not performed as part of this audit. The findings above focus on tests that exist but are wrong or misleading.
