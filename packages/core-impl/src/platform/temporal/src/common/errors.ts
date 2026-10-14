// Shared between the workflow and worker entry points, so this module must stay workflow-safe.

import { ApplicationFailure } from '@temporalio/common';

/**
 * The `type` of the `ApplicationFailure` that an Ably activity fails with when the Ably HTTP client returns an
 * error. It can be listed in a retry policy's `nonRetryableErrorTypes` to stop Temporal from retrying any failed
 * Ably request.
 */
export const ABLY_ERROR_TYPE = 'AblyError';

/**
 * The details of an Ably `ErrorInfo`, carried across the activity boundary as the first entry in the
 * `details` of an `ApplicationFailure` whose `type` is {@link ABLY_ERROR_TYPE}.
 */
export interface AblyErrorDetails {
  /**
   * The Ably error code, or `null` if the error has none. An error response that did not come from Ably, such as
   * one from a proxy, has no Ably error code.
   */
  code: number | null;
  /** The HTTP status code of the error, if the error has one. */
  statusCode?: number;
  /** The error message. */
  message: string;
  /** A link to documentation for the error code, if available. */
  href?: string;
  /** How to fix the error, if the Ably SDK provided a remediation. */
  remediation?: string;
  /** Additional key-value details about the error, if the error has any. */
  detail?: Record<string, string>;
}

/**
 * Finds the details of the Ably error that caused an operation to fail.
 *
 * When an Ably operation fails in workflow code, the error thrown is the Temporal `ActivityFailure` for the
 * activity that ran it, with an `ApplicationFailure` of type {@link ABLY_ERROR_TYPE} as its cause. This walks the
 * `cause` chain of `error` and returns the Ably error details from the first such failure.
 *
 * @param error - The error caught from an Ably operation.
 * @returns The Ably error details, or `undefined` if `error` was not caused by an Ably error.
 */
export function getAblyErrorDetails(error: unknown): AblyErrorDetails | undefined {
  let current: unknown = error;
  // Guard against cyclic cause chains.
  for (let depth = 0; depth < 32 && current != null; depth++) {
    if (current instanceof ApplicationFailure && current.type === ABLY_ERROR_TYPE) {
      const details = current.details?.[0];
      return isAblyErrorDetails(details) ? details : undefined;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function isAblyErrorDetails(value: unknown): value is AblyErrorDetails {
  return (
    value !== null &&
    typeof value === 'object' &&
    (typeof (value as AblyErrorDetails).code === 'number' || (value as AblyErrorDetails).code === null) &&
    typeof (value as AblyErrorDetails).message === 'string'
  );
}
