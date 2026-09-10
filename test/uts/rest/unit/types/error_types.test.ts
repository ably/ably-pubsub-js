/**
 * UTS: ErrorInfo Type Tests
 *
 * Spec points: TI1, TI2, TI3, TI4, TI5
 * Source: uts/test/rest/unit/types/error_types.md
 */

import { expect } from 'chai';
import { Ably } from '../../../helpers';

describe('uts/rest/unit/types/error_types', function () {
  /**
   * TI1 - code attribute
   */
  // UTS: rest/unit/TI1/errorinfo-attributes-0
  it('TI1 - code attribute', function () {
    const error = new Ably.ErrorInfo('Bad request', 40000, 400);
    expect(error.code).to.equal(40000);
  });

  /**
   * TI2 - statusCode attribute
   */
  // UTS: rest/unit/TI1/errorinfo-attributes-0.1
  it('TI2 - statusCode attribute', function () {
    const error = new Ably.ErrorInfo('Unauthorized', 40100, 401);
    expect(error.statusCode).to.equal(401);
  });

  /**
   * TI3 - message attribute
   */
  // UTS: rest/unit/TI1/errorinfo-attributes-0.2
  it('TI3 - message attribute', function () {
    const error = new Ably.ErrorInfo('Bad request: invalid parameter', 40000, 400);
    expect(error.message).to.equal('Bad request: invalid parameter');
  });

  /**
   * TI4 - href attribute (auto-generated from code)
   */
  // UTS: rest/unit/TI1/errorinfo-attributes-0.3
  it('TI4 - href attribute', function () {
    const error = Ably.ErrorInfo.fromValues({
      code: 40000,
      statusCode: 400,
      message: 'Bad request',
    });
    expect(error.href).to.equal('https://help.ably.io/error/40000');
  });

  /**
   * TI5 - cause attribute
   */
  // UTS: rest/unit/TI1/errorinfo-attributes-0.4
  it('TI5 - cause attribute', function () {
    const cause = new Error('Network failure');
    const error = Ably.ErrorInfo.fromValues({
      code: 50003,
      statusCode: 500,
      message: 'Timeout',
      cause: cause,
    } as any);
    expect(error.cause).to.equal(cause);
  });

  /**
   * TI - ErrorInfo is an Error instance
   */
  // UTS: rest/unit/TI/errorinfo-from-json-0
  it('TI - ErrorInfo is an Error instance', function () {
    const error = new Ably.ErrorInfo('test', 40000, 400);
    expect(error).to.be.an.instanceOf(Error);
  });

  /**
   * TI - ErrorInfo from JSON-like object
   */
  // UTS: rest/unit/TI/ably-exception-wraps-errorinfo-2
  it('TI - ErrorInfo from object', function () {
    const error = Ably.ErrorInfo.fromValues({
      code: 40100,
      statusCode: 401,
      message: 'Token expired',
    });

    expect(error.code).to.equal(40100);
    expect(error.statusCode).to.equal(401);
    expect(error.message).to.equal('Token expired');
    expect(error.href).to.equal('https://help.ably.io/error/40100');
  });

  /**
   * TI - Common error codes
   */
  // UTS: rest/unit/TI/common-error-codes-3
  it('TI - common error codes', function () {
    const cases = [
      { code: 40000, status: 400, meaning: 'Bad request' },
      { code: 40100, status: 401, meaning: 'Unauthorized' },
      { code: 40101, status: 401, meaning: 'Invalid credentials' },
      { code: 40140, status: 401, meaning: 'Token error' },
      { code: 40142, status: 401, meaning: 'Token expired' },
      { code: 40160, status: 401, meaning: 'Invalid capability' },
      { code: 40300, status: 403, meaning: 'Forbidden' },
      { code: 40400, status: 404, meaning: 'Not found' },
      { code: 50000, status: 500, meaning: 'Internal server error' },
      { code: 50003, status: 500, meaning: 'Timeout' },
    ] as const;

    for (const tc of cases) {
      const error = new Ably.ErrorInfo(tc.meaning, tc.code, tc.status);
      expect(error.code).to.equal(tc.code);
      expect(error.statusCode).to.equal(tc.status);
    }
  });

  /**
   * TI - Error string representation
   */
  // UTS: rest/unit/TI/error-string-representation-4
  it('TI - string representation', function () {
    const error = new Ably.ErrorInfo('Unauthorized: token expired', 40100, 401);
    const str = error.toString();
    expect(str).to.include('40100');
    expect(str).to.include('401');
  });

  /**
   * TI5 - nested error cause
   *
   * When an ErrorInfo is created with a cause that is itself an ErrorInfo,
   * the cause's attributes should be accessible.
   */
  // UTS: rest/unit/TI/errorinfo-nested-cause-1
  it('TI5 - nested error cause', function () {
    const inner = new Ably.ErrorInfo('inner', 40100, 401);
    const outer = Ably.ErrorInfo.fromValues({
      code: 50000,
      statusCode: 500,
      message: 'Outer error',
      cause: inner,
    } as any);

    expect(outer.cause).to.equal(inner);
    expect(outer.cause!.code).to.equal(40100);
    expect(outer.cause!.statusCode).to.equal(401);
    expect(outer.cause!.message).to.equal('inner');
  });

  /**
   * TI - ErrorInfo with all attributes
   *
   * Verify that an ErrorInfo constructed with code, statusCode, message,
   * and href exposes all properties correctly.
   */
  // UTS: rest/unit/TI/error-equality-5
  it('TI - ErrorInfo with all attributes', function () {
    const error = Ably.ErrorInfo.fromValues({
      code: 40300,
      statusCode: 403,
      message: 'Forbidden: account disabled',
      href: 'https://help.ably.io/error/40300',
    } as any);

    expect(error.code).to.equal(40300);
    expect(error.statusCode).to.equal(403);
    expect(error.message).to.equal('Forbidden: account disabled');
    expect(error.href).to.equal('https://help.ably.io/error/40300');
  });
});
