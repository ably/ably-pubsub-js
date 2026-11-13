import { asyncLocalStorage } from '@temporalio/activity';
import { ApplicationFailure, TemporalFailure } from '@temporalio/common';
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
 * The rule that decides whether a failed request is retried. A request is likely to succeed if retried after a
 * server error (`5xx`), a timeout (`408`), a rate limit (`429`), or an error with no status at all (`noStatus`), such
 * as a network failure. A failed `authUrl` or `authCallback` (`40170`) is also retryable, because the cause is often a
 * timeout or network error reaching the application's auth endpoint. Any other error (`4xx`) is not retried.
 */
type RetryRule = '5xx' | '408' | '429' | 'noStatus' | '40170' | '4xx';

function retryRule(code: number | null, statusCode: number | undefined): RetryRule {
  if (statusCode === undefined) {
    return 'noStatus';
  }
  if (statusCode >= 500) {
    return '5xx';
  }
  if (statusCode === 408) {
    return '408';
  }
  if (statusCode === 429) {
    return '429';
  }
  if (code === TOKEN_CALLBACK_ERROR_CODE) {
    return '40170';
  }
  return '4xx';
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
 * When called from an activity, it logs how it classified an Ably error at DEBUG. It logs any other error, except a
 * Temporal failure, at WARN on the activity's first attempt only, since Temporal logs every failed attempt itself. It
 * logs through the activity context's logger, and does not log outside an activity.
 *
 * @param err - The error thrown by the Ably HTTP client.
 * @returns The error for the activity to throw.
 */
export function toActivityFailure(err: unknown): unknown {
  // Undefined outside an activity, where `Context.current()` would throw.
  const activity = asyncLocalStorage.getStore();
  if (!isErrorInfoLike(err)) {
    // A Temporal failure, such as a cancellation, is Temporal's own, and Temporal decides whether to retry it.
    if (activity?.info.attempt === 1 && !(err instanceof TemporalFailure)) {
      const message = (err as { message?: unknown } | null)?.message;
      // The stack is not logged. Temporal drops an undefined attribute, such as the message of a value that has none.
      activity.log.warn(
        'Ably: passing an error that is not an Ably error to Temporal, which retries it according to the retry policy',
        {
          errorName: err instanceof Error ? err.name : typeof err,
          errorMessage: typeof message === 'string' ? message : undefined,
          retriedByTemporal: true,
        },
      );
    }
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

  const rule = retryRule(code, statusCode);
  const retryable = rule !== '4xx';
  // The message and detail are not logged, since they can name channels or clients. Temporal drops a null code and
  // an undefined status code from the attributes.
  activity?.log.debug(`Ably: classified the Ably error as ${retryable ? 'retryable' : 'non-retryable'}`, {
    code,
    statusCode,
    retryable,
    rule,
  });

  return ApplicationFailure.create({
    type: ABLY_ERROR_TYPE,
    message: err.message,
    nonRetryable: !retryable,
    details: [details],
    cause: err instanceof Error ? err : undefined,
  });
}
