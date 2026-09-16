'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  var expect = chai.expect;

  describe('http/init', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }
        done();
      });
    });

    /**
     * @specpartial RSC1a - test with key string
     * @specpartial RSC1c - test with key string
     */
    it('Init with key string', function () {
      const helper = this.test.helper;
      var keyStr = helper.getTestApp().keys[0].keyStr;
      var http = new helper.Ably.Http(keyStr);

      helper.recordPrivateApi('read.http.options.key');
      expect(http.options.key).to.equal(keyStr);
    });

    /**
     * @specpartial RSC1a - test with token string
     * @specpartial RSC1c - test with token string
     */
    it('Init with token string', async function () {
      const helper = this.test.helper;
      /* first generate a token ... */
      var http = helper.AblyHttp();
      var testKeyOpts = { key: helper.getTestApp().keys[1].keyStr };

      var tokenDetails = await http.auth.requestToken(null, testKeyOpts);
      var tokenStr = tokenDetails.token,
        http = new helper.Ably.Http(tokenStr);

      helper.recordPrivateApi('read.http.options.token');
      expect(http.options.token).to.equal(tokenStr);
    });

    /**
     * @spec RSC18
     * @spec TO3d
     * @spec TO3k4
     * @spec TO3k5
     */
    it('Init with tls: false', function () {
      const helper = this.test.helper;
      var http = helper.AblyHttp({ tls: false, port: 123, tlsPort: 456 });
      helper.recordPrivateApi('call.http.baseUri');
      expect(http.baseUri('example.com')).to.equal('http://example.com:123');
    });

    /**
     * @spec RSC18
     * @spec TO3d
     * @spec TO3k5
     */
    it('Init with tls: true', function () {
      const helper = this.test.helper;
      var http = helper.AblyHttp({ tls: true, port: 123, tlsPort: 456 });
      helper.recordPrivateApi('call.http.baseUri');
      expect(http.baseUri('example.com')).to.equal('https://example.com:456');
    });

    /**
     * Init without any tls key should enable tls.
     *
     * @spec RSC18
     * @spec TO3d
     * @spec TO3k5
     */

    it('Init without any tls key should enable tls', function () {
      const helper = this.test.helper;
      var http = helper.AblyHttp({ port: 123, tlsPort: 456 });
      helper.recordPrivateApi('call.http.baseUri');
      expect(http.baseUri('example.com')).to.equal('https://example.com:456');
    });

    /**
     * @spec RSC17
     * @spec RSA15a
     * @spec RSA15c
     */
    it("Init with clientId set to '*' or anything other than a string or null should error", function () {
      const helper = this.test.helper;
      expect(function () {
        var http = helper.AblyHttp({ clientId: '*' });
      }, 'Check can’t init library with a wildcard clientId').to.throw;
      expect(function () {
        var http = helper.AblyHttp({ clientId: 123 });
      }, 'Check can’t init library with a numerical clientId').to.throw;
      expect(function () {
        var http = helper.AblyHttp({ clientId: false });
      }, 'Check can’t init library with a boolean clientId').to.throw;
    });
  });
});
