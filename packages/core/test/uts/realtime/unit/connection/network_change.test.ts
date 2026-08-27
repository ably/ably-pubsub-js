/**
 * UTS: Network Change Tests
 *
 * Spec points: RTN20, RTN20a, RTN20b, RTN20c
 * Source: specification/uts/realtime/unit/connection/network_change_test.md
 *
 * RTN20 defines how the client should respond to OS-level network connectivity
 * change events. The spec begins with "When the client library can subscribe to
 * OS events for network/internet connectivity changes" -- this means the feature
 * is optional for platforms where network monitoring is not feasible.
 *
 * ably-js Node.js does not subscribe to OS network change events. The RTN20
 * functionality is browser-only (using navigator.onLine and online/offline
 * window events). Since these tests run in Node.js, all RTN20 tests are
 * marked as pending.
 */

import { expect } from 'chai';

describe('uts/realtime/unit/connection/network_change', function () {
  /**
   * RTN20a - Network loss while CONNECTED triggers immediate DISCONNECTED transition
   *
   * When CONNECTED, if the OS indicates that the underlying internet connection
   * is no longer available, the client should immediately transition to DISCONNECTED.
   */
  // UTS: realtime/unit/RTN20a/network-loss-connected-disconnects-0
  it('RTN20a - network loss while connected triggers disconnected', function () {
    // ably-js Node.js does not subscribe to OS network change events (RTN20 is browser-only).
    // In the browser, ably-js uses window.addEventListener('online'/'offline') events,
    // which are not available in Node.js.
    this.skip();
  });

  /**
   * RTN20a - Network loss while CONNECTING triggers DISCONNECTED transition
   *
   * When CONNECTING, if the OS indicates that the underlying internet connection
   * is no longer available, the client should immediately transition to DISCONNECTED.
   */
  // UTS: realtime/unit/RTN20a/network-loss-connecting-disconnects-1
  it('RTN20a - network loss while connecting triggers disconnected', function () {
    // ably-js Node.js does not subscribe to OS network change events (RTN20 is browser-only).
    this.skip();
  });

  /**
   * RTN20b - Network available while DISCONNECTED triggers immediate connect attempt
   *
   * When DISCONNECTED, if the OS indicates that the underlying internet connection
   * is now available, the client should immediately attempt to connect, bypassing
   * the disconnectedRetryTimeout timer.
   */
  // UTS: realtime/unit/RTN20b/network-available-disconnected-connects-0
  it('RTN20b - network available while disconnected triggers immediate connect', function () {
    // ably-js Node.js does not subscribe to OS network change events (RTN20 is browser-only).
    this.skip();
  });

  /**
   * RTN20c - Network available while CONNECTING restarts the connection attempt
   *
   * When CONNECTING, if the OS indicates that the underlying internet connection
   * is now available, the client should restart (abandon and retry) the pending
   * connection attempt.
   */
  // UTS: realtime/unit/RTN20c/network-available-connecting-restarts-0
  it('RTN20c - network available while connecting restarts connection attempt', function () {
    // ably-js Node.js does not subscribe to OS network change events (RTN20 is browser-only).
    this.skip();
  });
});
