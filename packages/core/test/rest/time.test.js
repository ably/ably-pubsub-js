'use strict';

define(['shared_helper', 'chai'], function (Helper, chai) {
  var http;
  var expect = chai.expect;

  describe('http/time', function () {
    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }
        http = helper.AblyHttp();
        done();
      });
    });

    /** @spec RSC16 */
    it('time0', async function () {
      var serverTime = await http.time();
      var localFiveMinutesAgo = Date.now() - 5 * 60 * 1000;
      expect(
        serverTime > localFiveMinutesAgo,
        'Verify returned time matches current local time with 5 minute leeway for badly synced local clocks',
      ).to.be.ok;
    });
  });
});
