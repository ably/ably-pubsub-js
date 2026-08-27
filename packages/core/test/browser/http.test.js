'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  var rest;
  var expect = chai.expect;

  describe('rest/http/fetch', function () {
    this.timeout(60 * 1000);
    let initialXhrSupported;
    before(function (done) {
      const helper = Helper.forHook(this);
      initialXhrSupported = Ably.Rest.Platform.Config.xhrSupported;
      Ably.Rest.Platform.Config.xhrSupported = false;
      helper.setupApp(function () {
        rest = helper.AblyRest();
        done();
      });
    });

    after((done) => {
      Ably.Rest.Platform.Config.xhrSupported = initialXhrSupported;
      done();
    });

    /** @nospec */
    it('Should use fetch when XHR is not supported', function (done) {
      let oldFetch = window.fetch;
      window.fetch = () => {
        done();
        window.fetch = oldFetch;
      };
      const channel = rest.channels.get('http_test_channel');
      channel.publish('test', 'Testing fetch support');
    });

    /** @nospec */
    it('Should succeed in using fetch to publish a message', function (done) {
      const channel = rest.channels.get('http_test_channel');
      Helper.whenPromiseSettles(channel.publish('test', 'Testing fetch support'), (err) => {
        expect(err).to.not.exist;
        done();
      });
    });

    /**
     * RTL6b talks about a callback which should receive an error object (which what we're doing here), but suggests to test other things.
     * This test simply tests that with fetch API we're still receiving an error, so it's probably @nospec.
     *
     * @nospec
     */
    it('Should pass errors correctly', function (done) {
      const channel = rest.channels.get('');
      Helper.whenPromiseSettles(channel.publish('test', 'Invalid message'), (err) => {
        expect(err).to.exist;
        done();
      });
    });
  });
});
