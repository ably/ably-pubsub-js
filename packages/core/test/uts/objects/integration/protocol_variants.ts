/**
 * Protocol variant helper for UTS integration tests.
 *
 * Integration spec files declare "Protocol Variants: json, msgpack" — every
 * test in the file runs once per variant with useBinaryProtocol set
 * accordingly. This mirrors the legacy suite's SharedHelper.testOnJsonMsgpack
 * pattern (test/common/modules/shared_helper.js) at describe level, so both
 * variants always run without any command-line or environment parameter.
 */

export type Protocol = 'json' | 'msgpack';

// Structural stand-ins for mocha's Suite and global describe so this file
// needs no mocha type definitions. mocha provides describe at runtime.
interface SuiteContext {
  timeout(ms: number): unknown;
}

declare function describe(title: string, fn: (this: SuiteContext) => void): unknown;

export function describeWithProtocols(
  title: string,
  body: (this: SuiteContext, useBinaryProtocol: boolean, protocol: Protocol) => void,
): void {
  for (const protocol of ['json', 'msgpack'] as const) {
    describe(`${title} (${protocol})`, function (this: SuiteContext) {
      body.call(this, protocol === 'msgpack', protocol);
    });
  }
}
