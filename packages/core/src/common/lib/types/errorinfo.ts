import Platform from 'common/platform';
import * as Utils from '../util/utils';
import * as API from '../../../../ably';
import type { ErrorCode } from './errorcodes';

export interface IPartialErrorInfo extends Error {
  code: ErrorCode | null;
  statusCode?: number;
  cause?: ErrorInfo | PartialErrorInfo;
  href?: string;
  detail?: Record<string, string>;
  remediation?: string;
}

function toString(err: ErrorInfo | PartialErrorInfo) {
  let result = '[' + err.constructor.name;
  if (err.message) result += ': ' + err.message;
  if (err.statusCode) result += '; statusCode=' + err.statusCode;
  if (err.code) result += '; code=' + err.code;
  if (err.cause) result += '; cause=' + Utils.inspectError(err.cause);
  if (err.remediation) result += '; remediation=' + err.remediation;
  if (err.detail && Object.keys(err.detail).length > 0) result += '; detail=' + JSON.stringify(err.detail);
  if (err.href && !(err.message && err.message.indexOf('help.ably.io') > -1)) result += '; see ' + err.href + ' ';
  result += ']';
  return result;
}

/**
 * The values of an error decoded from a server response body or a ProtocolMessage. `code` is
 * a plain `number` rather than an {@link ErrorCode} because the server chose it, and may use
 * codes this version of the client does not know about, so it cannot be checked against the
 * registry. Reached only via {@link ErrorInfo.fromWireValues}; errors this SDK raises itself
 * use {@link ErrorInfoValues}.
 */
export interface IConvertibleToErrorInfo {
  message: string;
  code: number;
  statusCode: number;
  detail?: Record<string, string>;
  remediation?: string;
  cause?: ErrorInfo | PartialErrorInfo;
  href?: string;
}

/** As {@link IConvertibleToErrorInfo}, for the partial case. */
export interface IConvertibleToPartialErrorInfo {
  message: string;
  code: number | null;
  statusCode?: number;
  detail?: Record<string, string>;
  remediation?: string;
  cause?: ErrorInfo | PartialErrorInfo;
  href?: string;
}

/**
 * The values an error raised by this SDK is constructed from. Identical to
 * {@link IConvertibleToErrorInfo} except that `code` must be a registered Ably error code,
 * so that an unregistered code, or a `code`/`statusCode` transposition, fails to compile.
 * This is the shape to use for any error written in this repository.
 */
export interface ErrorInfoValues extends IConvertibleToErrorInfo {
  code: ErrorCode;
}

/** As {@link ErrorInfoValues}, for the partial case. */
export interface PartialErrorInfoValues extends IConvertibleToPartialErrorInfo {
  code: ErrorCode | null;
}

/**
 * Apply the help.ably.io href default shared by the `fromValues` factories. Errors built
 * with `new ErrorInfo(...)` deliberately do not get it.
 */
function withHelpHref<T extends ErrorInfo | PartialErrorInfo>(err: T): T {
  if (err.code && !err.href) {
    err.href = 'https://help.ably.io/error/' + err.code;
  }
  return err;
}

export default class ErrorInfo extends Error implements IPartialErrorInfo, API.ErrorInfo {
  code: ErrorCode;
  statusCode: number;
  cause?: ErrorInfo;
  href?: string;
  detail?: Record<string, string>;
  remediation?: string;

  constructor(message: string, code: ErrorCode, statusCode: number, cause?: ErrorInfo, detail?: Record<string, string>);
  constructor(values: ErrorInfoValues);
  constructor(
    messageOrValues: string | ErrorInfoValues,
    code?: ErrorCode,
    statusCode?: number,
    cause?: ErrorInfo,
    detail?: Record<string, string>,
  ) {
    if (typeof messageOrValues === 'object') {
      const values = messageOrValues;
      if (
        typeof values.message !== 'string' ||
        typeof values.code !== 'number' ||
        typeof values.statusCode !== 'number' ||
        (!Utils.isNil(values.detail) && (typeof values.detail !== 'object' || Array.isArray(values.detail)))
      ) {
        throw new Error('ErrorInfo: invalid values: ' + Platform.Config.inspect(values));
      }
      super(values.message);
      if (typeof Object.setPrototypeOf !== 'undefined') {
        Object.setPrototypeOf(this, ErrorInfo.prototype);
      }
      this.code = values.code;
      this.statusCode = values.statusCode;
      this.detail = values.detail;
      Object.assign(this, values);
    } else {
      super(messageOrValues);
      if (typeof Object.setPrototypeOf !== 'undefined') {
        Object.setPrototypeOf(this, ErrorInfo.prototype);
      }
      this.code = code as ErrorCode;
      this.statusCode = statusCode as number;
      this.cause = cause;
      this.detail = detail;
    }
  }

  toString(): string {
    return toString(this);
  }

  /**
   * Build an error this SDK is raising itself, adding the help.ably.io href default. `code`
   * is checked against the registry. To build an error out of a server response body or a
   * ProtocolMessage, use {@link ErrorInfo.fromWireValues} instead.
   */
  static fromValues(values: ErrorInfoValues): ErrorInfo {
    // Shape validation and field assignment are delegated to the options-object constructor.
    return withHelpHref(new ErrorInfo(values));
  }

  /**
   * Build an error out of data received from the server — a response body, or the `error`
   * field of a ProtocolMessage. The cast is deliberate: the server chose this `code`, so
   * unlike {@link ErrorInfo.fromValues} it is not checked against the registry. Prefer
   * `fromValues` unless the code really did come from the server.
   */
  static fromWireValues(values: IConvertibleToErrorInfo): ErrorInfo {
    return withHelpHref(new ErrorInfo(values as ErrorInfoValues));
  }
}

export class PartialErrorInfo extends Error implements IPartialErrorInfo {
  code: ErrorCode | null;
  statusCode?: number;
  cause?: ErrorInfo | PartialErrorInfo;
  href?: string;
  detail?: Record<string, string>;
  remediation?: string;

  constructor(
    message: string,
    code: ErrorCode | null,
    statusCode?: number,
    cause?: ErrorInfo | PartialErrorInfo,
    detail?: Record<string, string>,
  );
  constructor(values: PartialErrorInfoValues);
  constructor(
    messageOrValues: string | PartialErrorInfoValues,
    code?: ErrorCode | null,
    statusCode?: number,
    cause?: ErrorInfo | PartialErrorInfo,
    detail?: Record<string, string>,
  ) {
    if (typeof messageOrValues === 'object') {
      const values = messageOrValues;
      if (
        typeof values.message !== 'string' ||
        (!Utils.isNil(values.code) && typeof values.code !== 'number') ||
        (!Utils.isNil(values.statusCode) && typeof values.statusCode !== 'number') ||
        (!Utils.isNil(values.detail) && (typeof values.detail !== 'object' || Array.isArray(values.detail)))
      ) {
        throw new Error('PartialErrorInfo: invalid values: ' + Platform.Config.inspect(values));
      }
      super(values.message);
      if (typeof Object.setPrototypeOf !== 'undefined') {
        Object.setPrototypeOf(this, PartialErrorInfo.prototype);
      }
      this.code = values.code;
      this.statusCode = values.statusCode;
      this.detail = values.detail;
      Object.assign(this, values);
    } else {
      super(messageOrValues);
      if (typeof Object.setPrototypeOf !== 'undefined') {
        Object.setPrototypeOf(this, PartialErrorInfo.prototype);
      }
      this.code = code as ErrorCode | null;
      this.statusCode = statusCode;
      this.cause = cause;
      this.detail = detail;
    }
  }

  toString(): string {
    return toString(this);
  }

  /** As {@link ErrorInfo.fromValues}, for the partial case. */
  static fromValues(values: PartialErrorInfoValues): PartialErrorInfo {
    return withHelpHref(new PartialErrorInfo(values));
  }
}
