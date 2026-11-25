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
      helper.recordPrivateApi('call.httpRequester.checkConnectivity');
      Helper.whenPromiseSettles(
        new Ably.DefaultPubSubRealtimeClient._HttpRequester().checkConnectivity(),
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
        helper.recordPrivateApi('call.httpRequester.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, urlScheme + successUrl)).httpRequester.checkConnectivity(),
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
        helper.recordPrivateApi('call.httpRequester.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, urlScheme + failUrl)).httpRequester.checkConnectivity(),
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
        helper.recordPrivateApi('call.httpRequester.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, successUrl)).httpRequester.checkConnectivity(),
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
        helper.recordPrivateApi('call.httpRequester.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, failUrl)).httpRequester.checkConnectivity(),
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
          helper
            .AblyRealtime(options(helper, 'sandbox.realtime.ably-nonprod.net/time'))
            .httpRequester.checkConnectivity(),
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
        helper.recordPrivateApi('call.httpRequester.checkConnectivity');
        Helper.whenPromiseSettles(
          helper.AblyRealtime(options(helper, 'echo.ably.io')).httpRequester.checkConnectivity(),
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

    describe('connectivitycheck_event', function () {
      const failUrl = 'https://echo.ably.io/respondwith?status=500';
      const successUrl = 'https://echo.ably.io/respondwith?status=200';

      function recordChecks(helper, realtime) {
        const checks = [];
        helper.recordPrivateApi('listen.connectionManager.connectivitycheck');
        realtime.connection.connectionManager.on('connectivitycheck', function (check) {
          checks.push(check);
        });
        return checks;
      }

      // Pinned to the fallback-host check: no base transport, so no ws check or comet retry, and no slow timer.
      function unreachableHostsClient(helper, connectivityCheckUrl) {
        helper.recordPrivateApi('pass.clientOption.connectivityCheckUrl');
        helper.recordPrivateApi('pass.clientOption.webSocketSlowTimeout');
        return helper.AblyRealtime({
          endpoint: 'invalid.invalid',
          fallbackHosts: ['invalid.invalid'],
          transports: ['web_socket'],
          connectivityCheckUrl,
          webSocketSlowTimeout: 60 * 1000,
          disconnectedRetryTimeout: 60 * 1000,
        });
      }

      // Calls back with the first check of each type once both the ws and http checks have reported.
      function waitForWsAndHttpChecks(helper, realtime, callback) {
        const first = {};
        helper.recordPrivateApi('listen.connectionManager.connectivitycheck');
        realtime.connection.connectionManager.on('connectivitycheck', function listener(check) {
          first[check.type] = first[check.type] || check;
          if (first.ws && first.http) {
            realtime.connection.connectionManager.off('connectivitycheck', listener);
            callback(first);
          }
        });
      }

      /** @nospec */
      it('failed_http_check_emits_event_before_disconnected', function (done) {
        const helper = this.test.helper;
        const realtime = unreachableHostsClient(helper, failUrl);
        const checks = recordChecks(helper, realtime);

        realtime.connection.once('disconnected', function (stateChange) {
          try {
            expect(checks.filter((check) => check.type === 'http')).to.deep.equal([{ type: 'http', available: false }]);
            expect(stateChange.reason.message).to.equal('Unable to connect (network unreachable)');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });

      /** @nospec */
      it('passed_http_check_emits_event', function (done) {
        const helper = this.test.helper;
        const realtime = unreachableHostsClient(helper, successUrl);
        const checks = recordChecks(helper, realtime);

        realtime.connection.once('disconnected', function (stateChange) {
          try {
            expect(checks.filter((check) => check.type === 'http')).to.deep.equal([{ type: 'http', available: true }]);
            expect(stateChange.reason.message).to.equal('Unable to connect (and no more fallback hosts to try)');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });

      /** @nospec */
      it('failed_ws_check_emits_event', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('pass.clientOption.wsConnectivityCheckUrl');
        helper.recordPrivateApi('pass.clientOption.webSocketSlowTimeout');
        const realtime = helper.AblyRealtime({
          wsConnectivityCheckUrl: 'wss://invalid.invalid',
          // fire the slow timer, and so the checks, before the connection completes
          webSocketSlowTimeout: 1,
        });

        // Waits on the ws check only, so the result doesn't depend on the external http check endpoint.
        helper.recordPrivateApi('listen.connectionManager.connectivitycheck');
        realtime.connection.connectionManager.on('connectivitycheck', function listener(check) {
          if (check.type !== 'ws') return;
          realtime.connection.connectionManager.off('connectivitycheck', listener);
          try {
            expect(check).to.deep.equal({ type: 'ws', available: false });
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });

      /** @nospec */
      it('rejected_http_check_emits_failed_event', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime({ autoConnect: false });
        const checks = recordChecks(helper, realtime);
        const checkError = new Error('check error');
        helper.recordPrivateApi('replace.httpRequester.checkConnectivity');
        realtime.httpRequester.checkConnectivity = async () => {
          throw checkError;
        };

        let caught;
        helper.recordPrivateApi('call.connectionManager.checkHttpConnectivity');
        try {
          await realtime.connection.connectionManager.checkHttpConnectivity();
        } catch (err) {
          caught = err;
        }

        try {
          expect(caught).to.equal(checkError);
          expect(checks).to.deep.equal([{ type: 'http', available: false }]);
        } finally {
          await helper.closeAndFinishAsync(realtime);
        }
      });

      /** @nospec */
      it('disabled_http_check_emits_no_event', async function () {
        const helper = this.test.helper;
        helper.recordPrivateApi('pass.clientOption.disableConnectivityCheck');
        const realtime = helper.AblyRealtime({ disableConnectivityCheck: true, autoConnect: false });
        const checks = recordChecks(helper, realtime);

        try {
          helper.recordPrivateApi('call.connectionManager.checkHttpConnectivity');
          expect(await realtime.connection.connectionManager.checkHttpConnectivity()).to.equal(true);
          expect(checks).to.deep.equal([]);
        } finally {
          await helper.closeAndFinishAsync(realtime);
        }
      });

      /** @nospec */
      it('disabled_check_still_emits_ws_event', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('pass.clientOption.disableConnectivityCheck');
        helper.recordPrivateApi('pass.clientOption.webSocketSlowTimeout');
        const realtime = helper.AblyRealtime({ disableConnectivityCheck: true, webSocketSlowTimeout: 1 });
        const checks = recordChecks(helper, realtime);

        // The option only skips the http check; the ws check still runs and reports.
        helper.recordPrivateApi('listen.connectionManager.connectivitycheck');
        realtime.connection.connectionManager.on('connectivitycheck', function listener(check) {
          if (check.type !== 'ws') return;
          realtime.connection.connectionManager.off('connectivitycheck', listener);
          try {
            expect(check).to.deep.equal({ type: 'ws', available: true });
            expect(checks.filter((c) => c.type === 'http')).to.deep.equal([]);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });

      /** @nospec */
      it('passed_ws_check_emits_event', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('pass.clientOption.webSocketSlowTimeout');
        const realtime = helper.AblyRealtime({ webSocketSlowTimeout: 1 });

        waitForWsAndHttpChecks(helper, realtime, function (checks) {
          try {
            expect(checks.ws).to.deep.equal({ type: 'ws', available: true });
            expect(checks.http).to.deep.equal({ type: 'http', available: true });
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });
    });

    /** @nospec */
    it('disable_connectivity_check', function (done) {
      const helper = this.test.helper;
      helper.recordPrivateApi('call.httpRequester.checkConnectivity');
      Helper.whenPromiseSettles(
        helper.AblyRealtime(options(helper, 'notarealhost', true)).httpRequester.checkConnectivity(),
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
