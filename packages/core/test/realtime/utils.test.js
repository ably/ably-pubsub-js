'use strict';

define(['shared_helper', 'chai'], function (Helper, chai) {
  var expect = chai.expect;

  describe('incremental backoff and jitter', function () {
    /** @spec RTB1 */
    it('should calculate retry timeouts using incremental backoff and jitter', function () {
      const helper = this.test.helper;
      var retryAttempts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
      var initialTimeout = 15;

      helper.recordPrivateApi('call.Utils.getRetryTime');
      var retryTimeouts = retryAttempts.map((attempt) => helper.Utils.getRetryTime(initialTimeout, attempt));
      expect(retryTimeouts.filter((timeout) => timeout >= 30).length).to.equal(0);

      function checkIsBetween(value, min, max) {
        expect(value).to.be.above(min);
        expect(value).to.be.below(max);
      }

      // Upper bound = min((retryAttempt + 2) / 3, 2) * initialTimeout
      // Lower bound = 0.8 * Upper bound
      checkIsBetween(retryTimeouts[0], 12, 15);
      checkIsBetween(retryTimeouts[1], 16, 20);
      checkIsBetween(retryTimeouts[2], 20, 25);

      for (var i = 3; i < retryTimeouts.length; i++) {
        checkIsBetween(retryTimeouts[i], 24, 30);
      }

      function calculateBounds(retryAttempt, initialTimeout) {
        var upperBound = Math.min((retryAttempt + 2) / 3, 2) * initialTimeout;
        var lowerBound = 0.8 * upperBound;
        return { lower: lowerBound, upper: upperBound };
      }

      for (var i = 0; i < retryTimeouts.length; i++) {
        var bounds = calculateBounds(retryAttempts[i], initialTimeout);
        checkIsBetween(retryTimeouts[i], bounds.lower, bounds.upper);
      }
    });
  });
});
