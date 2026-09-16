'use strict';

define(['shared_helper', 'chai'], function (Helper, chai) {
  var http;
  var expect = chai.expect;

  describe('http/status', function () {
    this.timeout(30 * 1000);

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

    /**
     * @spec RSL8
     * @spec RSL8a
     * @spec CHD2a
     * @spec CHD2b
     * @spec CHS2a
     * @spec CHS2b
     * @spec CHO2a
     * @spec CHM2a
     * @spec CHM2b
     * @spec CHM2c
     * @spec CHM2d
     * @spec CHM2e
     * @spec CHM2f
     */
    Helper.testOnJsonMsgpack('status0', async function (options, _, helper) {
      const http = helper.AblyHttp(options);
      var channel = http.channels.get('status0');
      var channelDetails = await channel.status();
      expect(channelDetails.channelId).to.equal('status0');
      expect(channelDetails.status.isActive).to.be.a('boolean');
      var metrics = channelDetails.status.occupancy.metrics;
      expect(metrics.connections).to.be.a('number');
      expect(metrics.presenceConnections).to.be.a('number');
      expect(metrics.presenceMembers).to.be.a('number');
      expect(metrics.presenceSubscribers).to.be.a('number');
      expect(metrics.publishers).to.be.a('number');
      expect(metrics.subscribers).to.be.a('number');
    });
  });
});
