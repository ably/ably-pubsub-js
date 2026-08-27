/**
 * UTS test helpers — mock installation/teardown and fake timers.
 *
 * These helpers manage the Platform singleton state, replacing HTTP,
 * WebSocket, and timer implementations with test doubles.
 */

// Import from the internal Node.js source so consumers get the real internal
// types rather than the trimmed-down public surface in ably.d.ts. The
// side-effect import wires up Platform with the Node-specific Http, Config,
// Crypto, etc. — equivalent to loading build/ably-node.js.
import '../../src/platform/nodejs';
import { DefaultRest } from '../../src/common/lib/client/defaultrest';
import { DefaultRealtime } from '../../src/common/lib/client/defaultrealtime';
import ErrorInfo from '../../src/common/lib/types/errorinfo';
import { makeFromDeserializedWithDependencies as makeProtocolMessageFromDeserialized } from '../../src/common/lib/types/protocolmessage';
import { populateFieldsFromParent } from '../../src/common/lib/types/basemessage';

const Ably = {
  Rest: DefaultRest,
  Realtime: DefaultRealtime,
  ErrorInfo,
  makeProtocolMessageFromDeserialized,
};

const Platform = DefaultRest.Platform;

// Saved originals for teardown
let _savedHttp: any = null;
let _savedWebSocket: any = null;
let _savedSetTimeout: any = null;
let _savedClearTimeout: any = null;
let _savedNow: any = null;

// Tracked clients for cleanup — ensures timers are released even if a test crashes
const _trackedClients: any[] = [];

// Track all Platform.Config.setTimeout timers so restoreAll() can cancel orphans.
// ably-js has a bug where connectWs() overwrites timer handles without cancelling
// the previous ones, leaking timers that prevent process exit.
const _allPlatformTimers = new Set<any>();
const _origPlatformSetTimeout = Platform.Config.setTimeout;
const _origPlatformClearTimeout = Platform.Config.clearTimeout;
Platform.Config.setTimeout = function (fn: any, ms?: number, ...args: any[]) {
  const timer = (_origPlatformSetTimeout as any).call(null, fn, ms, ...args);
  _allPlatformTimers.add(timer);
  return timer;
} as any;
Platform.Config.clearTimeout = function (timer: any) {
  _allPlatformTimers.delete(timer);
  return _origPlatformClearTimeout.call(null, timer);
} as any;

/**
 * Install a MockHttpClient as the platform HTTP implementation.
 * Call uninstallMockHttp() in afterEach to restore the original.
 */
function installMockHttp(mockHttpClient: { asPlatformHttp(): any }): void {
  if (_savedHttp) throw new Error('Mock HTTP already installed — call uninstallMockHttp() first');
  _savedHttp = Platform.Http;
  Platform.Http = mockHttpClient.asPlatformHttp();
}

/**
 * Restore the original platform HTTP implementation.
 */
function uninstallMockHttp(): void {
  if (_savedHttp) {
    Platform.Http = _savedHttp;
    _savedHttp = null;
  }
}

/**
 * Install a mock WebSocket constructor.
 * Call uninstallMockWebSocket() in afterEach to restore the original.
 */
function installMockWebSocket(mockWsConstructor: any): void {
  if (_savedWebSocket) throw new Error('Mock WebSocket already installed');
  _savedWebSocket = Platform.Config.WebSocket;
  Platform.Config.WebSocket = mockWsConstructor;
}

/**
 * Restore the original platform WebSocket constructor.
 */
function uninstallMockWebSocket(): void {
  if (_savedWebSocket) {
    Platform.Config.WebSocket = _savedWebSocket;
    _savedWebSocket = null;
  }
}

interface FakeTimer {
  id: number;
  fn: () => void;
  fireAt: number;
}

/**
 * FakeClock — deterministic timer replacement for Platform.Config.
 *
 * Replaces Platform.Config.setTimeout, clearTimeout, and now with
 * a fake clock that can be advanced manually. No global patching —
 * only Platform.Config is affected, so mocha's own timers work normally.
 *
 * Usage:
 *   const clock = enableFakeTimers();
 *   // ... trigger operations that use Platform.Config.setTimeout ...
 *   clock.tick(5000);  // advance 5 seconds, firing expired timers
 *   clock.uninstall(); // restore real timers
 */
class FakeClock {
  private _now: number;
  private _timers: FakeTimer[];
  private _nextId: number;

  constructor() {
    this._now = 1000000; // Must be non-zero: ably-js uses !lastActivity to check "not set" and 0 is falsy
    this._timers = [];
    this._nextId = 1;
  }

  /** Current fake time in ms */
  get now(): number {
    return this._now;
  }

  /** Schedule a callback after `ms` milliseconds of fake time */
  setTimeout(fn: () => void, ms?: number): number {
    const id = this._nextId++;
    const fireAt = this._now + (ms || 0);
    this._timers.push({ id, fn, fireAt });
    this._timers.sort((a, b) => a.fireAt - b.fireAt);
    return id;
  }

  /** Cancel a scheduled timer */
  clearTimeout(id: number): void {
    this._timers = this._timers.filter((t) => t.id !== id);
  }

  /**
   * Advance fake time by `ms` milliseconds, firing any timers that expire
   * during the advance. Timers fire in chronological order.
   */
  tick(ms: number): void {
    const targetTime = this._now + ms;
    while (this._timers.length > 0 && this._timers[0].fireAt <= targetTime) {
      const timer = this._timers.shift()!;
      this._now = timer.fireAt;
      timer.fn();
    }
    this._now = targetTime;
  }

  /**
   * Async version of tick that yields to the event loop between timer firings.
   * Use this when timer callbacks schedule microtasks or promises that must
   * settle before the next timer fires.
   */
  async tickAsync(ms: number): Promise<void> {
    const targetTime = this._now + ms;
    while (this._timers.length > 0 && this._timers[0].fireAt <= targetTime) {
      const timer = this._timers.shift()!;
      this._now = timer.fireAt;
      timer.fn();
      // Yield to the event loop (not just the microtask queue) so that all
      // chained process.nextTick callbacks (e.g. mock WebSocket error/close
      // events) are fully drained before the next fake timer fires.
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    this._now = targetTime;
  }

  /** Install this clock on Platform.Config */
  install(): this {
    if (_savedSetTimeout) throw new Error('Fake timers already installed');
    _savedSetTimeout = Platform.Config.setTimeout;
    _savedClearTimeout = Platform.Config.clearTimeout;
    _savedNow = Platform.Config.now;
    // The fake clock returns numeric ids rather than NodeJS.Timeout objects;
    // since clearTimeout is also faked, the id only flows back through our
    // own implementation, so the type mismatch is purely cosmetic.
    Platform.Config.setTimeout = this.setTimeout.bind(this) as unknown as typeof Platform.Config.setTimeout;
    Platform.Config.clearTimeout = this.clearTimeout.bind(this) as unknown as typeof Platform.Config.clearTimeout;
    Platform.Config.now = () => this._now;
    return this;
  }

  /** Uninstall and restore real timers */
  uninstall(): void {
    if (_savedSetTimeout) {
      Platform.Config.setTimeout = _savedSetTimeout;
      Platform.Config.clearTimeout = _savedClearTimeout;
      Platform.Config.now = _savedNow;
      _savedSetTimeout = null;
      _savedClearTimeout = null;
      _savedNow = null;
    }
  }
}

/**
 * Enable fake timers on Platform.Config.
 * Returns a FakeClock instance. Call clock.uninstall() in afterEach.
 *
 * Maps to UTS pseudocode: enable_fake_timers()
 */
function enableFakeTimers(): FakeClock {
  const clock = new FakeClock();
  clock.install();
  return clock;
}

/**
 * Register a client for automatic cleanup in restoreAll().
 * Call this after creating any Ably.Rest or Ably.Realtime client in a test.
 * restoreAll() will close all tracked clients, preventing timer leaks
 * even if the test throws before reaching its own cleanup code.
 */
function trackClient(client: any): void {
  _trackedClients.push(client);
}

/**
 * Restore all mocks. Call this in afterEach to clean up everything.
 */
function restoreAll(): void {
  // Close all tracked clients first (before restoring mocks/timers)
  // so their internal timers are cancelled while mocks are still in place.
  while (_trackedClients.length > 0) {
    const client = _trackedClients.pop();
    try {
      if (typeof client.close === 'function') {
        client.close();
      }
    } catch (_) {
      // Ignore errors during cleanup
    }
  }
  // Cancel all Platform.Config timers that weren't cleared by client.close().
  // Covers orphaned timers from ably-js's connectWs() overwrite bug.
  for (const timer of _allPlatformTimers) {
    _origPlatformClearTimeout(timer);
  }
  _allPlatformTimers.clear();
  uninstallMockHttp();
  uninstallMockWebSocket();
  // Restore fake timers if installed
  if (_savedSetTimeout) {
    Platform.Config.setTimeout = _savedSetTimeout;
    Platform.Config.clearTimeout = _savedClearTimeout;
    Platform.Config.now = _savedNow;
    _savedSetTimeout = null;
    _savedClearTimeout = null;
    _savedNow = null;
  }
}

/**
 * Flush the async event loop — yields to both microtasks and the macrotask
 * queue so that pending promise callbacks, nextTick handlers, and queued
 * mock WebSocket/HTTP deliveries all settle before the test continues.
 *
 * Replaces all `await new Promise(r => setTimeout(r, N))` delays in tests.
 */
function flushAsync(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Unit-tier equivalent of the UTS spec's `poll_until(condition, interval, timeout)`: polls
 * `flushAsync()` (the "interval" is one macrotask hop) until `condition()` becomes true, throwing
 * on timeout -- matching the spec convention and the integration-tier `pollUntil` (sandbox.ts).
 * NOTE: `test:uts` runs mocha with `--no-config` (2s default timeout), so tests waiting close to
 * (or beyond) that must raise their timeout (e.g. `this.timeout(6000)`). Do not use in tests that
 * stub `Date.now` (the deadline arithmetic would freeze) -- restructure the test to avoid the
 * stub instead, e.g. by backdating fixture timestamps.
 */
async function pollUntil(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error(`pollUntil timed out after ${timeoutMs}ms`);
    }
    await flushAsync();
  }
}

export {
  Ably,
  Platform,
  installMockHttp,
  uninstallMockHttp,
  installMockWebSocket,
  uninstallMockWebSocket,
  enableFakeTimers,
  FakeClock,
  trackClient,
  restoreAll,
  flushAsync,
  pollUntil,
  populateFieldsFromParent,
};
