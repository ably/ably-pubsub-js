import { expect } from 'chai';
import { ApplicationFailure, DefaultFailureConverter, defaultPayloadConverter } from '@temporalio/common';
import { Ably } from '../../uts/helpers';
import { toActivityFailure } from '../../../src/platform/temporal/src/worker/errors';
import { ABLY_ERROR_TYPE, getAblyErrorDetails } from '../../../src/platform/temporal/src/common/errors';

// The ErrorInfo class from the built `@ably/pubsub-server` package, a different class from the source ErrorInfo above.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const BuiltErrorInfo = require('@ably/pubsub-server').ErrorInfo;

function sourceErrorInfo(code: number, statusCode: number | undefined, message = 'Something went wrong') {
  return new Ably.ErrorInfo(message, code as any, statusCode as any);
}

describe('temporal/worker/errors', function () {
  it('maps an Ably error to an AblyError failure with its details', function () {
    const err = Ably.ErrorInfo.fromValues({
      message: 'Token expired',
      code: 40142,
      statusCode: 401,
      remediation: 'Renew the token.',
    });

    const failure = toActivityFailure(err) as ApplicationFailure;

    expect(failure).to.be.instanceOf(ApplicationFailure);
    expect(failure.type).to.equal(ABLY_ERROR_TYPE);
    expect(failure.message).to.equal('Token expired');
    expect(failure.nonRetryable).to.equal(true);
    expect(failure.details).to.deep.equal([
      {
        code: 40142,
        statusCode: 401,
        message: 'Token expired',
        href: 'https://help.ably.io/error/40142',
        remediation: 'Renew the token.',
      },
    ]);
    expect(failure.cause).to.equal(err);
  });

  for (const statusCode of [400, 401, 403, 404, 409, 422]) {
    it(`maps a ${statusCode} error to a non-retryable failure`, function () {
      const failure = toActivityFailure(sourceErrorInfo(statusCode * 100, statusCode)) as ApplicationFailure;
      expect(failure.nonRetryable).to.equal(true);
    });
  }

  for (const statusCode of [500, 502, 503, 504, 408, 429]) {
    it(`maps a ${statusCode} error to a retryable failure`, function () {
      const failure = toActivityFailure(sourceErrorInfo(statusCode * 100, statusCode)) as ApplicationFailure;
      expect(failure.nonRetryable).to.equal(false);
    });
  }

  it('maps an error without a status code to a retryable failure', function () {
    const failure = toActivityFailure(sourceErrorInfo(80000, undefined)) as ApplicationFailure;
    expect(failure.nonRetryable).to.equal(false);
    expect(failure.details?.[0]).to.deep.equal({ code: 80000, message: 'Something went wrong' });
  });

  it('maps an error response without an Ably error code to details with a null code', function () {
    // The SDK reports a code of NaN when a response, such as one from a proxy, has no X-Ably-Errorcode header.
    const failure = toActivityFailure(sourceErrorInfo(NaN, 502, 'Bad Gateway')) as ApplicationFailure;
    expect(failure.nonRetryable).to.equal(false);

    const converter = new DefaultFailureConverter();
    const decoded = converter.failureToError(
      converter.errorToFailure(failure, defaultPayloadConverter),
      defaultPayloadConverter,
    );
    expect(getAblyErrorDetails(decoded)).to.deep.equal({ code: null, statusCode: 502, message: 'Bad Gateway' });
  });

  it('maps a failed token callback to a retryable failure', function () {
    const failure = toActivityFailure(sourceErrorInfo(40170, 401)) as ApplicationFailure;
    expect(failure.nonRetryable).to.equal(false);
  });

  it('includes the error detail in the failure details', function () {
    const err = new Ably.ErrorInfo('Bad request', 40000, 400, undefined, { field: 'name' });

    const failure = toActivityFailure(err) as ApplicationFailure;

    expect(failure.details?.[0]).to.deep.include({ detail: { field: 'name' } });
  });

  it('recognises an ErrorInfo from the built @ably/pubsub-server package', function () {
    const err = new BuiltErrorInfo('Forbidden', 40300, 403);

    const failure = toActivityFailure(err) as ApplicationFailure;

    expect(failure).to.be.instanceOf(ApplicationFailure);
    expect(failure.nonRetryable).to.equal(true);
    expect(failure.details?.[0]).to.include({ code: 40300, statusCode: 403, message: 'Forbidden' });
  });

  it('recognises an ErrorInfo-shaped object that is not an Error, without a cause', function () {
    const failure = toActivityFailure({ code: 40000, statusCode: 400, message: 'Bad request' }) as ApplicationFailure;

    expect(failure).to.be.instanceOf(ApplicationFailure);
    expect(failure.cause).to.equal(undefined);
  });

  it('returns other errors unchanged', function () {
    const networkError = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    const typeError = new TypeError('oops');

    expect(toActivityFailure(networkError)).to.equal(networkError);
    expect(toActivityFailure(typeError)).to.equal(typeError);
    expect(toActivityFailure('a string')).to.equal('a string');
  });

  it('keeps the details and cause across the failure converter', function () {
    const cause = sourceErrorInfo(40000, 400, 'Inner');
    const err = new Ably.ErrorInfo('Outer', 40160, 401, cause);
    const converter = new DefaultFailureConverter();

    const decoded = converter.failureToError(
      converter.errorToFailure(toActivityFailure(err), defaultPayloadConverter),
      defaultPayloadConverter,
    );

    expect(decoded).to.be.instanceOf(ApplicationFailure);
    expect(getAblyErrorDetails(decoded)).to.deep.equal({ code: 40160, statusCode: 401, message: 'Outer' });
    const decodedCause = (decoded as ApplicationFailure).cause as (Error & { cause?: Error }) | undefined;
    expect(decodedCause?.message).to.equal('Outer');
    expect(decodedCause?.cause?.message).to.equal('Inner');
  });
});
