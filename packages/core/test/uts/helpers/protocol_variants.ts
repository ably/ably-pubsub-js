/**
 * Protocol variant helpers for G1 compliance.
 *
 * Data-path integration tests should use describeEachProtocol() to run
 * once per supported protocol (JSON and MessagePack).
 */

export type Protocol = 'json' | 'msgpack';

const PROTOCOLS: Protocol[] = ['json', 'msgpack'];

/**
 * Wraps a describe block to run once per protocol variant.
 * Produces test output like:
 *   suite name [json]
 *     ✓ test
 *   suite name [msgpack]
 *     ✓ test
 *
 * The callback receives mocha's Suite `this` context via `.call()`,
 * so `this.timeout()` works inside the callback when using `function()` syntax.
 */
export function describeEachProtocol(name: string, fn: (this: Mocha.Suite, protocol: Protocol) => void): void {
  for (const protocol of PROTOCOLS) {
    describe(`${name} [${protocol}]`, function (this: Mocha.Suite) {
      fn.call(this, protocol);
    });
  }
}
