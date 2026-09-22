/**
 * UTS: Backoff and Jitter Tests
 *
 * Spec points: RTB1, RTB1a, RTB1b
 * Source: specification/uts/realtime/unit/connection/backoff_jitter_test.md
 *
 * RTB1 defines how retry delays are calculated for connections in the
 * DISCONNECTED state and channels in the SUSPENDED state. The delay is:
 *   initialRetryTimeout * backoffCoefficient * jitterCoefficient
 *
 * RTB1a: backoff = min((n+2)/3, 2) for the nth retry
 * RTB1b: jitter is uniformly distributed in [0.8, 1.0]
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import {
  Ably,
  Platform,
  trackClient,
  installMockWebSocket,
  installMockHttp,
  enableFakeTimers,
  restoreAll,
  flushAsync,
} from '../../../helpers';

// Import the backoff/jitter functions directly from utils for unit testing
import { getBackoffCoefficient, getJitterCoefficient, getRetryTime } from '../../../../../src/common/lib/util/utils';
import { InternalClientOptions } from '../../../types';

async function pumpTimers(clock: any, iterations = 30) {
  for (let i = 0; i < iterations; i++) {
    clock.tick(0);
    await flushAsync();
  }
}

describe('uts/realtime/unit/connection/backoff_jitter', function () {
  afterEach(function () {
    restoreAll();
  });

  // --- RTB1a: Backoff coefficient ---

  /**
   * RTB1a - Backoff coefficient follows min((n+2)/3, 2) for successive retries
   *
   * The backoff coefficient for the nth retry is calculated as
   * min((n+2)/3, 2), producing the sequence [1, 4/3, 5/3, 2, 2, ...].
   */
  // UTS: realtime/unit/RTB1a/backoff-coefficient-sequence-0
  it('RTB1a - backoff coefficient follows min((n+2)/3, 2)', function () {
    // Calculate backoff coefficients for retries 1 through 10
    const coefficients: number[] = [];
    for (let n = 1; n <= 10; n++) {
      coefficients.push(getBackoffCoefficient(n));
    }

    // Verify exact values for the first few retries
    expect(coefficients[0]).to.equal(1.0); // n=1: (1+2)/3 = 1
    expect(coefficients[1]).to.equal(4.0 / 3.0); // n=2: (2+2)/3 = 4/3
    expect(coefficients[2]).to.equal(5.0 / 3.0); // n=3: (3+2)/3 = 5/3
    expect(coefficients[3]).to.equal(2.0); // n=4: (4+2)/3 = 2, capped at 2

    // Verify all subsequent retries are capped at 2.0
    for (let i = 3; i < 10; i++) {
      expect(coefficients[i]).to.equal(2.0);
    }
  });

  // --- RTB1b: Jitter coefficient ---

  /**
   * RTB1b - Jitter coefficient is between 0.8 and 1.0
   *
   * The jitter coefficient is a random number between 0.8 and 1.0,
   * approximately uniformly distributed.
   */
  // UTS: realtime/unit/RTB1b/jitter-coefficient-range-0
  it('RTB1b - jitter coefficient is between 0.8 and 1.0 with uniform distribution', function () {
    const sampleCount = 1000;
    const jitterValues: number[] = [];

    for (let i = 0; i < sampleCount; i++) {
      jitterValues.push(getJitterCoefficient());
    }

    // All values must be within [0.8, 1.0]
    for (const jitter of jitterValues) {
      expect(jitter).to.be.at.least(0.8);
      expect(jitter).to.be.at.most(1.0);
    }

    // Verify approximate uniformity: the mean should be close to 0.9
    const mean = jitterValues.reduce((a, b) => a + b, 0) / sampleCount;
    expect(mean).to.be.at.least(0.85);
    expect(mean).to.be.at.most(0.95);

    // Verify spread: not all values are the same
    const minValue = Math.min(...jitterValues);
    const maxValue = Math.max(...jitterValues);
    expect(maxValue - minValue).to.be.greaterThan(0.05);
  });

  // --- RTB1: Combined retry delay for DISCONNECTED connections ---

  /**
   * RTB1 - Combined retry delay for DISCONNECTED connections
   *
   * Verifies that the retryIn value on ConnectionStateChange events during
   * DISCONNECTED retries follows the formula:
   *   disconnectedRetryTimeout * min((n+2)/3, 2) * jitter(0.8-1.0)
   */
  // UTS: realtime/unit/RTB1/disconnected-retry-delay-0
  it('RTB1 - DISCONNECTED retry delays follow backoff * jitter formula', async function () {
    let connectionAttemptCount = 0;
    const retryDelays: number[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          // Initial connection succeeds
          conn.respond_with_connected({
            connectionId: 'connection-id',
            connectionDetails: {
              connectionKey: 'connection-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 60000,
            } as any,
          });
        } else {
          // All reconnection attempts fail
          conn.respond_with_refused();
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const disconnectedRetryTimeout = 2000; // 2 seconds

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      disconnectedRetryTimeout: disconnectedRetryTimeout,
      autoConnect: false,
      useBinaryProtocol: false,
      fallbackHosts: [],
    });
    trackClient(client);

    // Capture retryIn from DISCONNECTED state changes
    client.connection.on((change: any) => {
      if (change.current === 'disconnected' && change.retryIn != null) {
        retryDelays.push(change.retryIn);
      }
    });

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');

    // Simulate unexpected disconnect to trigger reconnection cycle
    mock.active_connection!.simulate_disconnect();

    // Advance time in increments to allow multiple retry cycles.
    // Each retry fails (respond_with_refused), producing another DISCONNECTED
    // state change with a retryIn value.
    for (let i = 0; i < 30; i++) {
      await clock.tickAsync(5000);
      await pumpTimers(clock);
      if (retryDelays.length >= 5) break;
    }

    expect(retryDelays.length).to.be.at.least(5);

    // Retry 1: backoff = 1.0, range = [2000*0.8, 2000*1.0] = [1600, 2000]
    expect(retryDelays[0]).to.be.at.least(disconnectedRetryTimeout * 1.0 * 0.8);
    expect(retryDelays[0]).to.be.at.most(disconnectedRetryTimeout * 1.0 * 1.0);

    // Retry 2: backoff = 4/3, range = [2000*4/3*0.8, 2000*4/3*1.0]
    expect(retryDelays[1]).to.be.at.least(disconnectedRetryTimeout * (4.0 / 3.0) * 0.8);
    expect(retryDelays[1]).to.be.at.most(disconnectedRetryTimeout * (4.0 / 3.0) * 1.0);

    // Retry 3: backoff = 5/3, range = [2000*5/3*0.8, 2000*5/3*1.0]
    expect(retryDelays[2]).to.be.at.least(disconnectedRetryTimeout * (5.0 / 3.0) * 0.8);
    expect(retryDelays[2]).to.be.at.most(disconnectedRetryTimeout * (5.0 / 3.0) * 1.0);

    // Retry 4: backoff = 2.0 (capped), range = [2000*2*0.8, 2000*2*1.0] = [3200, 4000]
    expect(retryDelays[3]).to.be.at.least(disconnectedRetryTimeout * 2.0 * 0.8);
    expect(retryDelays[3]).to.be.at.most(disconnectedRetryTimeout * 2.0 * 1.0);

    // Retry 5: backoff = 2.0 (capped), same range
    expect(retryDelays[4]).to.be.at.least(disconnectedRetryTimeout * 2.0 * 0.8);
    expect(retryDelays[4]).to.be.at.most(disconnectedRetryTimeout * 2.0 * 1.0);

    client.close();
  });

  // --- RTB1: Combined retry delay for SUSPENDED channels ---

  /**
   * RTB1 - Combined retry delay for SUSPENDED channels
   *
   * Verifies that the retry timing for SUSPENDED channel re-attach attempts
   * follows the formula: channelRetryTimeout * backoff * jitter.
   *
   * Note: ably-js ChannelStateChange does not expose a retryIn property.
   * Instead, we verify the timing by observing when the channel transitions
   * from SUSPENDED to ATTACHING (i.e., when the retry timer fires). The
   * elapsed time between SUSPENDED and ATTACHING should match the expected
   * retry delay.
   */
  // UTS: realtime/unit/RTB1/suspended-channel-retry-delay-1
  it('RTB1 - SUSPENDED channel retry timing follows backoff * jitter formula', async function () {
    const channelName = 'test-RTB1-channel';
    let connectionAttemptCount = 0;
    let attachCount = 0;
    const retryTimings: number[] = [];
    let lastSuspendedTime = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          // ATTACH
          attachCount++;
          if (attachCount === 1) {
            // First attach succeeds
            conn!.send_to_client({
              action: 11, // ATTACHED
              channel: msg.channel,
              flags: 0,
            });
          } else {
            // All subsequent re-attach attempts fail with DETACHED
            // (per RTL13b, when attaching state receives DETACHED, channel goes to SUSPENDED)
            conn!.send_to_client({
              action: 13, // DETACHED
              channel: msg.channel,
              error: {
                code: 90001,
                statusCode: 500,
                message: 'Channel re-attach failed',
              },
            });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const httpMock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, 'yes'),
    });
    installMockHttp(httpMock);

    const channelRetryTimeout = 3000; // 3 seconds

    const clock = enableFakeTimers();

    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      channelRetryTimeout: channelRetryTimeout,
      autoConnect: false,
      useBinaryProtocol: false,
    } as InternalClientOptions);
    trackClient(client);

    client.connect();
    await pumpTimers(clock);

    expect(client.connection.state).to.equal('connected');

    const channel = client.channels.get(channelName);

    // Track transitions to measure retry timing
    channel.on((change: any) => {
      if (change.current === 'suspended') {
        lastSuspendedTime = clock.now;
      }
      if (change.current === 'attaching' && lastSuspendedTime > 0) {
        const elapsed = clock.now - lastSuspendedTime;
        retryTimings.push(elapsed);
      }
    });

    // Initial attach succeeds
    channel.attach();
    await pumpTimers(clock);

    expect(channel.state).to.equal('attached');

    // Server sends DETACHED error on the channel while attached.
    // Per RTL13a, when attached and receiving DETACHED, it triggers attaching.
    // Then the re-attach fails with DETACHED response, which puts it into SUSPENDED.
    mock.active_connection!.send_to_client({
      action: 13, // DETACHED
      channel: channelName,
      error: {
        code: 90001,
        statusCode: 500,
        message: 'Channel error',
      },
    });

    // Advance time in increments to allow multiple SUSPENDED -> ATTACHING cycles.
    for (let i = 0; i < 30; i++) {
      await clock.tickAsync(7000);
      await pumpTimers(clock);
      if (retryTimings.length >= 4) break;
    }

    expect(retryTimings.length).to.be.at.least(4);

    // Retry 1: backoff = 1.0, range = [3000*0.8, 3000*1.0] = [2400, 3000]
    expect(retryTimings[0]).to.be.at.least(channelRetryTimeout * 1.0 * 0.8);
    expect(retryTimings[0]).to.be.at.most(channelRetryTimeout * 1.0 * 1.0);

    // Retry 2: backoff = 4/3, range = [3000*4/3*0.8, 3000*4/3*1.0] = [3200, 4000]
    expect(retryTimings[1]).to.be.at.least(channelRetryTimeout * (4.0 / 3.0) * 0.8);
    expect(retryTimings[1]).to.be.at.most(channelRetryTimeout * (4.0 / 3.0) * 1.0);

    // Retry 3: backoff = 5/3, range = [3000*5/3*0.8, 3000*5/3*1.0] = [4000, 5000]
    expect(retryTimings[2]).to.be.at.least(channelRetryTimeout * (5.0 / 3.0) * 0.8);
    expect(retryTimings[2]).to.be.at.most(channelRetryTimeout * (5.0 / 3.0) * 1.0);

    // Retry 4: backoff = 2.0 (capped), range = [3000*2*0.8, 3000*2*1.0] = [4800, 6000]
    expect(retryTimings[3]).to.be.at.least(channelRetryTimeout * 2.0 * 0.8);
    expect(retryTimings[3]).to.be.at.most(channelRetryTimeout * 2.0 * 1.0);

    client.close();
  });
});
