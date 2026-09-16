'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  var http;
  var expect = chai.expect;
  var Defaults = Ably.Http.Platform.Defaults;

  describe('http/http', function () {
    this.timeout(60 * 1000);
    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function () {
        http = helper.AblyHttp({
          agents: {
            'custom-agent': '0.1.2',
          },
        });
        done();
      });
    });

    /**
     * @spec RSC7a
     * @specpartial RSC7d2 - tests Ably-Agent only for http
     */
    it('Should send X-Ably-Version and Ably-Agent headers in get/post requests', async function () {
      const helper = this.test.helper;
      var originalDo = http.httpRequester.do;

      // Intercept Http.do with test
      async function testRequestHandler(method, path, headers, body, params) {
        expect('X-Ably-Version' in headers, 'Verify version header exists').to.be.ok;
        expect('Ably-Agent' in headers, 'Verify agent header exists').to.be.ok;

        // This test should not directly validate version against Defaults.version, as
        // ultimately the version header has been derived from that value.
        expect(headers['X-Ably-Version']).to.equal('6', 'Verify current version number');
        helper.recordPrivateApi('read.Defaults.version');
        expect(headers['Ably-Agent'].indexOf('ably-pubsub-js/' + Defaults.version) > -1, 'Verify agent').to.be.ok;
        expect(headers['Ably-Agent'].indexOf('custom-agent/0.1.2') > -1, 'Verify custom agent').to.be.ok;

        // We don't test on NativeScript so a check for that platform is excluded here
        if (typeof document !== 'undefined') {
          // browser
          expect(headers['Ably-Agent'].indexOf('browser') > -1, 'Verify agent').to.be.ok;
        } else if (typeof navigator !== 'undefined' && navigator.product === 'ReactNative') {
          // reactnative
          expect(headers['Ably-Agent'].indexOf('reactnative') > -1, 'Verify agent').to.be.ok;
        } else {
          // node
          expect(headers['Ably-Agent'].indexOf('nodejs') > -1, 'Verify agent').to.be.ok;
        }

        helper.recordPrivateApi('call.http.httpRequester.do');
        return originalDo.call(http.httpRequester, method, path, headers, body, params);
      }

      helper.recordPrivateApi('replace.http.httpRequester.do');
      http.httpRequester.do = testRequestHandler;

      // Call all methods that use HTTP calls
      await http.auth.requestToken();
      await http.time();
      await http.stats();
      var channel = http.channels.get('http_test_channel');
      await channel.publish('test', 'Testing http headers');
      await channel.presence.get();
    });

    /** @nospec */
    it('Should handle no content responses', async function () {
      const helper = this.test.helper;
      //Intercept Http.do with test

      async function testRequestHandler() {
        return { error: null, body: null, headers: { 'X-Ably-Foo': 'headerValue' }, unpacked: false, statusCode: 204 };
      }

      helper.recordPrivateApi('replace.http.httpRequester.do');
      http.httpRequester.do = testRequestHandler;

      const response = await http.request('GET', '/foo', {}, null, {});

      expect(response.statusCode).to.equal(204);
      expect(response.items).to.be.empty;
      expect(response.headers).to.deep.equal({ 'X-Ably-Foo': 'headerValue' });
    });
  });
});
