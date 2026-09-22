'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  var expect = chai.expect;

  describe('realtime/connectivity', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
        }
        done();
      });
    });

    /**
     * Connect with available http transports; internet connectivity check should work
     *
     * @nospec
     */
    it('http_connectivity_check', function (done) {
      const helper = this.test.helper;
      helper.recordPrivateApi('call.http.checkConnectivity');
      Helper.whenPromiseSettles(new Ably.Realtime._Http().checkConnectivity(), function (err, res) {
        try {
          expect(
            res && !err,
            'Connectivity check completed ' +
              (err && (helper.recordPrivateApi('call.Utils.inspectError'), helper.Utils.inspectError(err))),
          ).to.be.ok;
        } catch (err) {
          done(err);
          return;
        }
        done();
      });
    });

    function options(helper, connectivityCheckUrl, disableConnectivityCheck) {
      helper.recordPrivateApi('pass.clientOption.connectivityCheckUrl');
      helper.recordPrivateApi('pass.clientOption.disableConnectivityCheck');
      return {
        connectivityCheckUrl,
        disableConnectivityCheck,
        autoConnect: false,
      };
    }

    describe('configured_connectivity_check_url', function () {
      var urlScheme = 'https://';
      var echoServer = 'echo.ably.io';
      var successUrl = echoServer + '/respondwith?status=200';
      var failUrl = echoServer + '/respondwith?status=500';

      /** @nospec */
      it('succeeds with scheme', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('call.http.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, urlScheme + successUrl)).http.checkConnectivity(),
          function (err, res) {
            try {
              expect(
                res && !err,
                'Connectivity check completed ' +
                  (err && (helper.recordPrivateApi('call.Utils.inspectError'), helper.Utils.inspectError(err))),
              ).to.be.ok;
            } catch (err) {
              done(err);
              return;
            }
            done();
          },
        );
      });

      /** @nospec */
      it('fails with scheme', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('call.http.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, urlScheme + failUrl)).http.checkConnectivity(),
          function (err, res) {
            try {
              expect(!res, 'Connectivity check expected to return false').to.be.ok;
              done();
            } catch (err) {
              done(err);
            }
          },
        );
      });

      /** @nospec */
      it('succeeds with querystring', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('call.http.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, successUrl)).http.checkConnectivity(),
          function (err, res) {
            try {
              expect(
                res && !err,
                'Connectivity check completed ' +
                  (err && (helper.recordPrivateApi('call.Utils.inspectError'), helper.Utils.inspectError(err))),
              ).to.be.ok;
              done();
            } catch (err) {
              done(err);
            }
          },
        );
      });

      /** @nospec */
      it('fails with querystring', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('call.http.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, failUrl)).http.checkConnectivity(),
          function (err, res) {
            try {
              expect(!res, 'Connectivity check expected to return false').to.be.ok;
              done();
            } catch (err) {
              done(err);
            }
          },
        );
      });

      /** @nospec */
      it('succeeds with plain url', function (done) {
        const helper = this.test.helper;
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, 'sandbox.realtime.ably-nonprod.net/time')).http.checkConnectivity(),
          function (err, res) {
            try {
              expect(
                res && !err,
                'Connectivity check completed ' +
                  (err && (helper.recordPrivateApi('call.Utils.inspectError'), helper.Utils.inspectError(err))),
              ).to.be.ok;
              done();
            } catch (err) {
              done(err);
            }
          },
        );
      });

      /** @nospec */
      it('fails with plain url', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('call.http.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, 'echo.ably.io')).http.checkConnectivity(),
          function (err, res) {
            try {
              expect(!res, 'Connectivity check expected to return false').to.be.ok;
              done();
            } catch (err) {
              done(err);
            }
          },
        );
      });
    });

    /** @nospec */
    it('disable_connectivity_check', function (done) {
      const helper = this.test.helper;
      helper.recordPrivateApi('call.http.checkConnectivity');
      Helper.whenPromiseSettles(
        helper.AblyRealtime(options(helper, 'notarealhost', true)).http.checkConnectivity(),
        function (err, res) {
          try {
            expect(
              res && !err,
              'Connectivity check completed ' +
                (err && (helper.recordPrivateApi('call.Utils.inspectError'), helper.Utils.inspectError(err))),
            ).to.be.ok;
            done();
          } catch (err) {
            done(err);
          }
        },
      );
    });
  });
});
