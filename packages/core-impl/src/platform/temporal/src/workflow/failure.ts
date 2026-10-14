import { ApplicationFailure } from '@temporalio/common';
import { ABLY_ERROR_TYPE, type AblyErrorDetails } from '../common/errors.js';

/**
 * Creates the failure to throw for an error detected in workflow code, before any activity runs.
 *
 * It has the same shape as the failure an Ably activity fails with, so `getAblyErrorDetails` finds its details.
 * Throwing an `ApplicationFailure` fails the workflow. Any other error would fail the workflow task instead,
 * which retries it indefinitely.
 */
export function ablyFailure(details: Omit<AblyErrorDetails, 'href'>): ApplicationFailure {
  return ApplicationFailure.create({
    type: ABLY_ERROR_TYPE,
    message: details.message,
    nonRetryable: true,
    details: [{ ...details, href: `https://help.ably.io/error/${details.code}` }],
  });
}
