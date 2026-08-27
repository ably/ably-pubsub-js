/**
 * UTS Integration: REST Time and Stats Tests
 *
 * Spec points: RSC16, RSC6
 * Source: uts/rest/integration/time_stats.md
 */

import { expect } from 'chai';
import { Ably, SANDBOX_ENDPOINT, setupSandbox, teardownSandbox, getApiKey } from './sandbox';

describe('uts/rest/integration/time_stats', function () {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSC16 - time() returns server time
   *
   * `time()` obtains the current server time. The returned value should be
   * reasonably close to the client's local time (within 5 seconds, allowing
   * for network latency and minor clock differences).
   */
  // UTS: rest/integration/RSC16/time-returns-server-time-0
  it('RSC16 - time() returns server time', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const beforeRequest = Date.now();
    const serverTime = await client.time();
    const afterRequest = Date.now();

    // Server time should be a number (timestamp in milliseconds)
    expect(serverTime).to.be.a('number');

    // Server time should be reasonably close to client time
    // (allowing for network latency and minor clock differences)
    expect(serverTime).to.be.at.least(beforeRequest - 5000);
    expect(serverTime).to.be.at.most(afterRequest + 5000);
  });

  /**
   * RSC6 - stats() returns application statistics
   *
   * `stats()` returns a PaginatedResult containing application statistics.
   * Stats may be empty for a new sandbox app, but the call should succeed.
   */
  // UTS: rest/integration/RSC6/stats-returns-result-0
  it('RSC6 - stats() returns a PaginatedResult', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await client.stats(null);

    // Result should be a PaginatedResult with an items array
    expect(result).to.be.an('object');
    expect(result.items).to.be.an('array');

    // If there are items, they should have expected structure
    if (result.items.length > 0) {
      expect(result.items[0].intervalId).to.be.a('string');
    }
  });

  /**
   * RSC6 - stats() with parameters
   *
   * `stats()` supports `limit`, `direction`, and `unit` parameters.
   */
  // UTS: rest/integration/RSC6/stats-with-parameters-1
  it('RSC6 - stats() with parameters', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
    });

    const result = await client.stats({
      limit: '5',
      direction: 'forwards',
      unit: 'hour',
    });

    // Should succeed with parameters applied
    expect(result).to.be.an('object');
    expect(result.items).to.be.an('array');
    expect(result.items.length).to.be.at.most(5);
  });
});
