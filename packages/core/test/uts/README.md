# UTS Tests for ably-js

Universal Test Specification (UTS) tests — portable tests translated from the pseudocode specs in `specification/uts/`.

## Running

```bash
npm run test:uts
```

This builds the Node.js bundle and runs all UTS tests via mocha. UTS tests are isolated from the main test suite (no shared_helper, no sandbox setup).

## Architecture

UTS tests run against the **Node.js build** (`build/ably-node.js`) with mock implementations injected at the Platform level:

- **HTTP** is mocked by replacing `Platform.Http`
- **WebSocket** is mocked by replacing `Platform.Config.WebSocket`
- **Timers/clock** are mocked by replacing `Platform.Config.setTimeout`, `.clearTimeout`, `.now`

No global patching — only the Platform singleton is modified, so mocha's own timers and I/O work normally.

## Mock HTTP Client

The `MockHttpClient` implements the UTS mock HTTP spec. It maps ably-js's single `doUri()` call onto the UTS two-phase model (connection attempt + HTTP request).

### Handler pattern (recommended for most tests)

```typescript
import { MockHttpClient } from '../mock_http';
import { installMockHttp, uninstallMockHttp, Ably } from '../helpers';

const captured: any[] = [];
const mock = new MockHttpClient({
  onConnectionAttempt: (conn) => conn.respond_with_success(),
  onRequest: (req) => {
    captured.push(req);
    req.respond_with(200, [1704067200000]);
  },
});

installMockHttp(mock);
const client = new Ably.Rest({ key: 'app.key:secret' });
const time = await client.time();
// captured[0].method === 'GET'
// captured[0].path === '/time'
uninstallMockHttp();
```

### Await pattern (for advanced scenarios)

```typescript
import { MockHttpClient } from '../mock_http';
import { installMockHttp, uninstallMockHttp, Ably } from '../helpers';

const mock = new MockHttpClient();
installMockHttp(mock);

const client = new Ably.Rest({ key: 'app.key:secret' });
const timePromise = client.time();

const conn = await mock.await_connection_attempt();
conn.respond_with_success();

const req = await mock.await_request();
assert(req.headers['X-Ably-Version']);
req.respond_with(200, [1704067200000]);

const time = await timePromise;
uninstallMockHttp();
```

### PendingConnection methods

| Method                     | Effect                                   |
| -------------------------- | ---------------------------------------- |
| `respond_with_success()`   | Connection succeeds, allows HTTP request |
| `respond_with_refused()`   | TCP connection refused                   |
| `respond_with_timeout()`   | Connection times out                     |
| `respond_with_dns_error()` | DNS resolution fails                     |

### PendingRequest methods

| Method                                 | Effect                             |
| -------------------------------------- | ---------------------------------- |
| `respond_with(status, body, headers?)` | Return HTTP response               |
| `respond_with_timeout()`               | Request times out after connection |

### PendingRequest properties

| Property  | Description                   |
| --------- | ----------------------------- |
| `method`  | HTTP method (GET, POST, etc.) |
| `url`     | Parsed URL object             |
| `path`    | URL pathname (e.g., `/time`)  |
| `headers` | Request headers               |
| `body`    | Request body                  |

## Fake Timers

For tests that need to control time (timeouts, retries, etc.):

```typescript
import { enableFakeTimers, restoreAll } from '../helpers';

const clock = enableFakeTimers();
// Platform.Config.now() returns 0
// Platform.Config.setTimeout callbacks are queued

clock.tick(5000); // advance 5s, fire expired timers synchronously
await clock.tickAsync(5000); // same but yields between timer firings

clock.uninstall(); // restore real timers
```

Maps to UTS pseudocode:

- `enable_fake_timers()` → `enableFakeTimers()`
- `ADVANCE_TIME(ms)` → `clock.tick(ms)` or `clock.tickAsync(ms)`

## Writing a new test file

```typescript
import { expect } from 'chai';
import { MockHttpClient } from '../mock_http';
import { Ably, installMockHttp, restoreAll } from '../helpers';

describe('uts/rest/my-feature', function () {
  let mock: MockHttpClient;

  beforeEach(function () {
    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, {}),
    });
    installMockHttp(mock);
  });

  afterEach(function () {
    restoreAll();
  });

  it('RSC99 - does something', async function () {
    const client = new Ably.Rest({ key: 'app.key:secret' });
    // ... test ...
  });
});
```

## Directory structure

```
test/uts/
  README.md           # This file
  helpers.ts          # install/uninstall, FakeClock, Ably re-export
  mock_http.ts        # MockHttpClient (PendingConnection, PendingRequest)
  mock_websocket.ts   # MockWebSocket (PendingWSConnection, MockWSInstance)
  deviations.md       # Known spec/implementation deviations
  rest/               # REST API tests
    time.test.ts      # RSC16 — time() tests
    ...               # (37 test files)
  realtime/           # Realtime API tests
    time.test.ts      # RTC6a — RealtimeClient#time proxy tests
    client/           # Realtime client tests
      client_options.test.ts      # RSC1, RTC12
      realtime_client.test.ts     # RTC1a-f, RTC2-4, RTC13-17
      realtime_request.test.ts    # RTC9
      realtime_stats.test.ts      # RTC5
      realtime_timeouts.test.ts   # RTC7
```
