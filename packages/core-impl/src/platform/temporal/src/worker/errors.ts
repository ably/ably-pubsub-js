import { ApplicationFailure } from '@temporalio/common';
import { ABLY_ERROR_TYPE } from '../common/errors.js';
import type { AblyErrorDetails } from '../common/errors.js';

/** The fields of an Ably `ErrorInfo` that the activities read. */
interface ErrorInfoLike {
  code: number;
  message: string;
  statusCode?: unknown;
  href?: unknown;
  remediation?: unknown;
  detail?: unknown;
}

/**
 * Whether `err` is an Ably `ErrorInfo`. This is a structural check, because the error may come from a different
 * copy of the Ably SDK than the one this module would import. A numeric `code` distinguishes an Ably error from a
 * Node.js system error, whose `code` is a string such as `ECONNREFUSED`.
 */
function isErrorInfoLike(err: unknown): err is ErrorInfoLike {
  return (
    typeof err === 'object' &&
    err !== null &&
    typeof (err as ErrorInfoLike).code === 'number' &&
    typeof (err as ErrorInfoLike).message === 'string'
  );
}

/** The code of the error the Ably SDK reports when the client's `authUrl` or `authCallback` fails. */
const TOKEN_CALLBACK_ERROR_CODE = 40170;

/**
 * Whether a failed request is likely to succeed if retried: a server error, a timeout, a rate limit, or an error
 * with no status at all, such as a network failure. A failed `authUrl` or `authCallback` is also retryable, because
 * the cause is often a timeout or network error reaching the application's auth endpoint.
 */
function isRetryable(code: number | null, statusCode: number | undefined): boolean {
  return (
    statusCode === undefined ||
    statusCode >= 500 ||
    statusCode === 408 ||
    statusCode === 429 ||
    code === TOKEN_CALLBACK_ERROR_CODE
  );
}

/**
 * Converts an error thrown by the Ably HTTP client into the error that an Ably activity fails with.
 *
 * An Ably `ErrorInfo` becomes an `ApplicationFailure` of type {@link ABLY_ERROR_TYPE}, with the error's fields as
 * an {@link AblyErrorDetails} in `details[0]`. The failure is non-retryable unless the error is likely to be
 * transient. The original error is kept as the failure's `cause`, so that its stack trace and any nested cause
 * are recorded in the workflow history.
 *
 * Any other error is returned unchanged, and Temporal retries the activity according to its retry policy.
 *
 * @param err - The error thrown by the Ably HTTP client.
 * @returns The error for the activity to throw.
 */
export function toActivityFailure(err: unknown): unknown {
  if (!isErrorInfoLike(err)) {
    return err;
  }

  const statusCode = typeof err.statusCode === 'number' && err.statusCode > 0 ? err.statusCode : undefined;
  // The SDK reports a code of NaN for an error response without an Ably error code, such as one from a proxy.
  const code = Number.isFinite(err.code) ? err.code : null;
  const details: AblyErrorDetails = { code, message: err.message };
  if (statusCode !== undefined) {
    details.statusCode = statusCode;
  }
  if (typeof err.href === 'string') {
    details.href = err.href;
  }
  if (typeof err.remediation === 'string') {
    details.remediation = err.remediation;
  }
  if (typeof err.detail === 'object' && err.detail !== null) {
    details.detail = err.detail as Record<string, string>;
  }

  return ApplicationFailure.create({
    type: ABLY_ERROR_TYPE,
    message: err.message,
    nonRetryable: !isRetryable(code, statusCode),
    details: [details],
    cause: err instanceof Error ? err : undefined,
  });
}
