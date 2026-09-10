'use strict';

define(['shared_helper', 'async', 'chai', 'ably'], function (Helper, async, chai, Ably) {
  const expect = chai.expect;
  const Defaults = Ably.Rest.Platform.Defaults;
  const originialWsCheckUrl = Defaults.wsConnectivityCheckUrl;
  const transportPreferenceName = 'ably-transport-preference';
  const localStorageSupported = globalThis.localStorage;
  const urlScheme = 'https://';
  const echoServer = 'echo.ably.io';
  const failUrl = urlScheme + echoServer + '/respondwith?status=500';
  const defaultTransports = new Ably.Realtime({ key: 'xxx:yyy', autoConnect: false }).connection.connectionManager
    .transports;

  function baseTransport(helper) {
    return new Ably.Realtime({
      key: 'xxx:yyy',
      autoConnect: false,
      transports: helper.availableTransports,
    }).connection.connectionManager.baseTransport;
  }

  function restoreWsConnectivityCheckUrl() {
    Helper.forHook(this).recordPrivateApi('write.Defaults.wsConnectivityCheckUrl');
    Defaults.wsConnectivityCheckUrl = originialWsCheckUrl;
  }

  const Config = Ably.Rest.Platform.Config;
  const oldWs = Config.WebSocket;

  function restoreWebSocketConstructor() {
    Config.WebSocket = oldWs;
  }

  // drop in replacement for WebSocket which doesn't emit any events (same behaviour as when WebSockets upgrade headers are removed by a proxy)
  class FakeWebSocket {
    close() {}
  }

  /* Drop in replacement for WebSocket which rejects the handshake immediately,
   * as a proxy that answers the upgrade request with (say) a 403 does: the
   * browser surfaces that to us only as an error event followed by an unclean
   * close. Unlike FakeWebSocket this fails fast, so the connection sequence
   * finishes before the websocket slow/give-up timers can fire.
   *
   * If allowConnectivityCheck is set, the websocket connectivity check is let
   * through, simulating a network on which websockets work but every Ably host
   * is rejecting them. */
  function rejectingWebSocket({ allowConnectivityCheck } = {}) {
    return class FakeRejectingWebSocket {
      constructor(url) {
        this.url = url;
        const succeed = allowConnectivityCheck && url.indexOf(originialWsCheckUrl) === 0;
        setTimeout(() => {
          if (succeed) {
            if (this.onopen) this.onopen();
            return;
          }
          if (this.onerror) this.onerror({ message: undefined });
          if (this.onclose) this.onclose({ code: 1006, wasClean: false });
        }, 0);
      }
      close() {}
    };
  }

  /* Records the transports the connection manager actually attempts */
  function recordTransportAttempts(helper, realtime) {
    const attempts = [];
    const connectionManager = realtime.connection.connectionManager;
    helper.recordPrivateApi('replace.connectionManager.tryATransport');
    const original = connectionManager.tryATransport.bind(connectionManager);
    connectionManager.tryATransport = function (transportParams, candidate, callback) {
      attempts.push(candidate);
      return original(transportParams, candidate, callback);
    };
    return attempts;
  }

  describe('realtime/transports', function () {
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

    afterEach(restoreWsConnectivityCheckUrl);
    afterEach(restoreWebSocketConstructor);

    if (
      Helper.forTestDefinition(this, 'tests that are run if there are multiple transports').availableTransports.length >
      1
    ) {
      // ensure comet transport is used for nodejs tests
      function options(helper, opts) {
        return helper.Utils.mixin(
          {
            transports: helper.availableTransports,
          },
          opts || {},
        );
      }

      /** @nospec */
      it('websocket_is_default', function (done) {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime(options(helper));

        realtime.connection.on('connected', function () {
          try {
            expect(realtime.connection.connectionManager.activeProtocol.transport.shortName).to.equal('web_socket');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          helper.closeAndFinish(done, realtime);
        });

        helper.monitorConnection(done, realtime);
      });

      /** @nospec */
      it('no_ws_connectivity', function (done) {
        const helper = this.test.helper;
        Config.WebSocket = FakeWebSocket;
        const realtime = helper.AblyRealtime(
          options(helper, { webSocketSlowTimeout: 1000, webSocketConnectTimeout: 3000 }),
        );

        realtime.connection.on('connected', function () {
          try {
            expect(realtime.connection.connectionManager.activeProtocol.transport.shortName).to.equal(
              baseTransport(helper),
            );
            // check that transport preference is set
            if (localStorageSupported) {
              expect(window.localStorage.getItem(transportPreferenceName)).to.equal(
                JSON.stringify({ value: baseTransport(helper) }),
              );
            }
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          helper.closeAndFinish(done, realtime);
        });

        helper.monitorConnection(done, realtime);
      });

      /**
       * A proxy that rejects the websocket upgrade fails every candidate host
       * within milliseconds, so neither the websocket slow timer nor the
       * give-up timer gets a chance to fire. The client must still work out
       * that websockets are unusable and fall back to the base transport,
       * rather than exhausting its fallback hosts on websocket and giving up.
       *
       * @nospec
       */
      it('ws_rejected_immediately', function (done) {
        const helper = this.test.helper;
        Config.WebSocket = rejectingWebSocket();
        const realtime = helper.AblyRealtime(options(helper));
        const attempts = recordTransportAttempts(helper, realtime);

        realtime.connection.on('connected', function () {
          try {
            expect(realtime.connection.connectionManager.activeProtocol.transport.shortName).to.equal(
              baseTransport(helper),
            );
            expect(attempts).to.include('web_socket');
            expect(attempts[attempts.length - 1]).to.equal(baseTransport(helper));
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });

        helper.monitorConnection(done, realtime);
      });

      /**
       * The converse: if websockets are demonstrably available on this network
       * then failures on every host are the hosts' problem, not the transport's,
       * and the base transport (which talks to those same hosts) would be no
       * better off. The client should go to disconnected and retry.
       *
       * @nospec
       */
      it('ws_rejected_immediately_but_ws_connectivity_available', function (done) {
        const helper = this.test.helper;
        Config.WebSocket = rejectingWebSocket({ allowConnectivityCheck: true });
        const realtime = helper.AblyRealtime(options(helper));
        const attempts = recordTransportAttempts(helper, realtime);

        realtime.connection.once('disconnected', function (stateChange) {
          try {
            expect(attempts).to.not.include(baseTransport(helper));
            expect(stateChange.reason.code).to.equal(80003, 'check code');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });

        realtime.connection.once('connected', function () {
          helper.closeAndFinish(done, realtime, new Error('Connection should not have succeeded'));
        });
      });

      /** @nospec */
      it('ws_primary_host_fails', function (done) {
        const helper = this.test.helper;
        const goodHost = helper.AblyRest().options.primaryDomain;
        const realtime = helper.AblyRealtime(
          options(helper, { endpoint: helper.unroutableAddress, fallbackHosts: [goodHost] }),
        );

        realtime.connection.on('connected', function () {
          expect(realtime.connection.connectionManager.activeProtocol.transport.shortName).to.equal('web_socket');
          helper.closeAndFinish(done, realtime);
        });

        helper.monitorConnection(done, realtime);
      });

      /**
       * @spec REC3b
       * @specpartial RTN14d
       */
      it('no_internet_connectivity', function (done) {
        const helper = this.test.helper;
        Config.WebSocket = FakeWebSocket;
        const realtime = helper.AblyRealtime(
          options(helper, { connectivityCheckUrl: failUrl, webSocketSlowTimeout: 1000 }),
        );

        // expect client to transition to disconnected rather than attempting base transport (which would succeed in this instance)
        realtime.connection.on('disconnected', function () {
          helper.closeAndFinish(done, realtime);
        });
      });

      /**
       * With no base transport to fall back to there is nothing a websocket
       * connectivity check could usefully tell us, so an immediately-rejected
       * handshake must go straight to disconnected rather than waiting on one.
       *
       * @specpartial RTN14d
       */
      it('ws_rejected_immediately_with_no_base_transport', function (done) {
        const helper = this.test.helper;
        Config.WebSocket = rejectingWebSocket();
        const realtime = helper.AblyRealtime({ transports: ['web_socket'] });

        realtime.connection.once('disconnected', function () {
          helper.closeAndFinish(done, realtime);
        });
      });

      /** @specpartial RTN14d */
      it('no_websocket_or_base_transport', function (done) {
        const helper = this.test.helper;
        Config.WebSocket = FakeWebSocket;
        const realtime = helper.AblyRealtime({
          transports: ['web_socket'],
          realtimeRequestTimeout: 3000,
          webSocketConnectTimeout: 3000,
        });

        realtime.connection.on('disconnected', function () {
          helper.closeAndFinish(done, realtime);
        });
      });

      /** @nospec */
      it('ws_can_reconnect_after_ws_connectivity_fail', function (done) {
        const helper = this.test.helper;
        helper.recordPrivateApi('read.realtime.options.primaryDomain');
        const goodHost = helper.AblyRest().options.primaryDomain;

        helper.recordPrivateApi('pass.clientOption.webSocketSlowTimeout');
        helper.recordPrivateApi('pass.clientOption.wsConnectivityCheckUrl');
        const realtime = helper.AblyRealtime(
          options(helper, {
            endpoint: helper.unroutableAddress,
            // use unroutable host ws connectivity check to simulate no internet
            wsConnectivityCheckUrl: helper.unroutableWssAddress,
            // ensure ws slow timeout procs and performs ws connectivity check, which would fail due to unroutable host
            webSocketSlowTimeout: 1,
            // give up trying to connect fairly quickly
            realtimeRequestTimeout: 2000,
            // try to reconnect quickly
            disconnectedRetryTimeout: 2000,
          }),
        );
        const connection = realtime.connection;

        // simulate the internet being failed by stubbing out tryATransport to foil
        // the initial connection
        helper.recordPrivateApi('replace.connectionManager.tryATransport');
        const tryATransportOriginal = connection.connectionManager.tryATransport;
        connection.connectionManager.tryATransport = function () {};

        async.series(
          [
            function (cb) {
              realtime.connection.once('disconnected', function () {
                cb();
              });
            },
            function (cb) {
              // restore original settings
              helper.recordPrivateApi('replace.connectionManager.tryATransport');
              connection.connectionManager.tryATransport = tryATransportOriginal;
              helper.recordPrivateApi('write.realtime.options.wsConnectivityCheckUrl');
              realtime.options.wsConnectivityCheckUrl = originialWsCheckUrl;
              helper.recordPrivateApi('write.realtime.options.primaryDomain');
              realtime.options.primaryDomain = goodHost;
              helper.recordPrivateApi('write.connectionManager.domains');
              realtime.connection.connectionManager.domains = [goodHost];

              cb();
            },
            function (cb) {
              // should reconnect successfully
              realtime.connection.once('connected', function () {
                cb();
              });

              realtime.connection.once('disconnected', function () {
                try {
                  // fast fail if we end up in the disconnected state again
                  expect(
                    connection.state !== 'disconnected',
                    'Connection should not remain disconnected after websocket reconnection attempt even after failed ws connectivity check from previous connection attempt',
                  ).to.be.ok;
                } catch (err) {
                  cb(err);
                }
              });
            },
          ],
          function (err) {
            helper.closeAndFinish(done, realtime, err);
          },
        );
      });

      if (localStorageSupported) {
        /** @nospec */
        it('base_transport_preference', function (done) {
          const helper = this.test.helper;
          window.localStorage.setItem(transportPreferenceName, JSON.stringify({ value: baseTransport(helper) }));
          const realtime = helper.AblyRealtime(options(helper));

          // make ws connectivity check only resolve after connected with base transport.
          // prevents a race condition where the wsConnectivity check succeeds before base transport is activated;
          // in this case the base transport would be abandoned in favour of websocket
          realtime.connection.connectionManager.checkWsConnectivity = function () {
            return new Promise((resolve) => {
              realtime.connection.once('connected', () => {
                resolve();
              });
            });
          };

          realtime.connection.on('connected', function () {
            try {
              expect(realtime.connection.connectionManager.activeProtocol.transport.shortName).to.equal(
                baseTransport(helper),
              );
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
            helper.closeAndFinish(done, realtime);
          });
          helper.monitorConnection(done, realtime);
        });

        /** @nospec */
        it('transport_preference_reset_while_connecting', function (done) {
          const helper = this.test.helper;
          window.localStorage.setItem(transportPreferenceName, JSON.stringify({ value: baseTransport(helper) }));
          const realtime = helper.AblyRealtime(options(helper));

          // make ws connectivity check fast so that it succeeds while base transport is still connecting
          realtime.connection.connectionManager.checkWsConnectivity = function () {
            return new Promise((resolve) => {
              setTimeout(() => resolve(), 1);
            });
          };

          realtime.connection.once('connected', function () {
            try {
              expect(realtime.connection.connectionManager.activeProtocol.transport.shortName).to.equal('web_socket');
              expect(realtime.connection.connectionManager.getTransportPreference()).to.equal('web_socket');
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            helper.closeAndFinish(done, realtime);
          });
          helper.monitorConnection(done, realtime);
        });

        /** @nospec */
        it('transport_preference_reset_after_connected', function (done) {
          const helper = this.test.helper;
          window.localStorage.setItem(transportPreferenceName, JSON.stringify({ value: baseTransport(helper) }));
          const realtime = helper.AblyRealtime(options(helper));

          // make ws connectivity check only resolve after connected with base transport
          realtime.connection.connectionManager.checkWsConnectivity = function () {
            return new Promise((resolve) => {
              realtime.connection.once('connected', () => {
                try {
                  expect(realtime.connection.connectionManager.activeProtocol.transport.shortName).to.equal(
                    baseTransport(helper),
                  );
                  resolve();
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                  return;
                }
              });
            });
          };

          realtime.connection.once('connected', function () {
            // the checkWsConnectivity promise won't execute .then callbacks synchronously upon resolution
            // so we need to wait one tick before the transport preference is unpersisted
            setTimeout(() => {
              try {
                // ensure base transport preference is erased
                expect(realtime.connection.connectionManager.getTransportPreference()).to.equal(null);
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              helper.closeAndFinish(done, realtime);
            }, 0);
          });
          helper.monitorConnection(done, realtime);
        });
      }
    }
  });
});
