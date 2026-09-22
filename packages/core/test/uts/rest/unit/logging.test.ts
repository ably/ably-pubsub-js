/**
 * UTS: REST Logging Tests
 *
 * Spec points: RSC2, RSC4, TO3b, TO3c
 * Source: uts/test/rest/unit/logging.md
 *
 * ably-js logging API:
 *   logLevel: 0=NONE, 1=ERROR, 2=MAJOR, 3=MINOR, 4=MICRO
 *   logHandler: function(msg, level) — receives a pre-formatted string and numeric level
 *   Default logLevel is 1 (ERROR)
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';

describe('uts/rest/unit/logging', function () {
  let mock;

  afterEach(function () {
    restoreAll();
  });

  /**
   * Helper: create a mock that responds to /time with a valid response.
   */
  function setupMock() {
    mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [1704067200000]);
      },
    });
    installMockHttp(mock);
  }

  /**
   * RSC2 - Default log level is error
   *
   * The default log level in ably-js is ERROR (1). At this level, only
   * error-level messages are emitted. Normal client construction and
   * time() calls produce MINOR/MICRO messages which should be filtered out.
   */
  // UTS: rest/unit/RSC2/default-log-level-warn-0
  it('RSC2 - default log level filters non-error messages', async function () {
    setupMock();

    const capturedLogs: any[] = [];
    const client = new Ably.Rest({
      key: 'app.key:secret',
      logHandler: function (msg, level) {
        capturedLogs.push({ msg, level });
      },
    });

    await client.time();

    // Default level is ERROR (1). Normal operations produce MINOR (3)
    // and MICRO (4) level messages, which should all be filtered out.
    // Any messages that do get through must be at ERROR level (1).
    for (const log of capturedLogs) {
      expect(log.level).to.equal(1, 'Only error-level messages should pass at default log level');
    }
  });

  /**
   * TO3b - Log level can be changed to capture more messages
   *
   * Setting logLevel to MICRO (4) should capture all log events
   * including MINOR and MICRO level messages.
   */
  // UTS: rest/unit/TO3b/log-level-changeable-0
  it('TO3b - logLevel MICRO captures all messages', async function () {
    setupMock();

    const capturedLogs: any[] = [];
    const client = new Ably.Rest({
      key: 'app.key:secret',
      logLevel: 4, // MICRO
      logHandler: function (msg, level) {
        capturedLogs.push({ msg, level });
      },
    });

    await client.time();

    // With MICRO level, we should have captured messages
    expect(capturedLogs.length).to.be.greaterThan(0);

    // Should have MINOR (3) level messages (e.g. "started; version = ...")
    const minorLogs = capturedLogs.filter((l) => l.level === 3);
    expect(minorLogs.length).to.be.greaterThan(0, 'Should capture MINOR level messages');

    // Should have MICRO (4) level messages (e.g. HTTP request details)
    const microLogs = capturedLogs.filter((l) => l.level === 4);
    expect(microLogs.length).to.be.greaterThan(0, 'Should capture MICRO level messages');
  });

  /**
   * TO3c - Custom logHandler receives messages with level information
   *
   * A custom logHandler provided via ClientOptions receives a formatted
   * string message and a numeric level argument.
   */
  // UTS: rest/unit/TO3c/custom-handler-structured-events-0
  it('TO3c - custom logHandler receives messages with level', async function () {
    setupMock();

    const capturedLogs: any[] = [];
    const client = new Ably.Rest({
      key: 'app.key:secret',
      logLevel: 4, // MICRO — capture everything
      logHandler: function (msg, level) {
        capturedLogs.push({ msg, level });
      },
    });

    await client.time();

    // Handler was called
    expect(capturedLogs.length).to.be.greaterThan(0);

    // Each log entry has a string message and numeric level
    for (const log of capturedLogs) {
      expect(log.msg).to.be.a('string');
      expect(log.level).to.be.a('number');
      expect(log.level).to.be.within(0, 4);
    }

    // Messages should be prefixed with "Ably:"
    expect(capturedLogs.some((l) => l.msg.startsWith('Ably:'))).to.be.true;
  });

  /**
   * RSC4 / RSC2b - logLevel NONE (0) suppresses all log output
   *
   * Setting logLevel to 0 (NONE) should prevent all log messages
   * from reaching the handler.
   */
  // UTS: rest/unit/RSC2b/log-level-none-suppresses-all-0
  it('RSC4 - logLevel NONE suppresses all messages', async function () {
    setupMock();

    const capturedLogs: any[] = [];
    const client = new Ably.Rest({
      key: 'app.key:secret',
      logLevel: 0, // NONE
      logHandler: function (msg, level) {
        capturedLogs.push({ msg, level });
      },
    });

    await client.time();

    // No logs should be captured at all
    expect(capturedLogs).to.have.length(0);
  });

  /**
   * TO3b - logLevel MINOR (3) captures MINOR but not MICRO
   *
   * Intermediate log levels should filter correctly: MINOR captures
   * levels 1-3 but excludes MICRO (4).
   */
  // UTS: rest/unit/TO3b/log-level-changeable-0.1
  it('TO3b - logLevel MINOR filters MICRO messages', async function () {
    setupMock();

    const capturedLogs: any[] = [];
    const client = new Ably.Rest({
      key: 'app.key:secret',
      logLevel: 3, // MINOR
      logHandler: function (msg, level) {
        capturedLogs.push({ msg, level });
      },
    });

    await client.time();

    // Should have some messages (MINOR level messages from construction)
    expect(capturedLogs.length).to.be.greaterThan(0);

    // No MICRO (4) messages should have passed through
    const microLogs = capturedLogs.filter((l) => l.level === 4);
    expect(microLogs).to.have.length(0, 'MICRO messages should be filtered at MINOR level');

    // All captured messages should be at level <= 3
    for (const log of capturedLogs) {
      expect(log.level).to.be.at.most(3);
    }
  });

  /**
   * TO3c2 - Log messages contain HTTP request details
   *
   * At MICRO level, HTTP operations emit log messages that contain
   * request details such as the URL/path being requested.
   */
  // UTS: rest/unit/TO3c2/context-contains-expected-keys-0
  it('TO3c2 - HTTP request logs contain URL details', async function () {
    setupMock();

    const capturedLogs: any[] = [];
    const client = new Ably.Rest({
      key: 'app.key:secret',
      logLevel: 4, // MICRO
      logHandler: function (msg, level) {
        capturedLogs.push({ msg, level });
      },
    });

    await client.time();

    // Find HTTP-related log messages
    const httpLogs = capturedLogs.filter((l) => l.msg.includes('/time'));
    expect(httpLogs.length).to.be.greaterThan(0, 'Should have log messages mentioning /time endpoint');

    // HTTP request log should mention the path
    const requestLog = capturedLogs.find((l) => l.msg.includes('Http') && l.msg.includes('/time'));
    expect(requestLog).to.not.be.undefined;
  });
});
