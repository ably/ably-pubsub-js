'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  var { expect, assert } = chai;
  var transportPreferenceName = 'ably-transport-preference';

  function supportedBrowser() {
    if (document.body.ononline === undefined) {
      console.log('Online events not supported; skipping connection.test.js');
      return false;
    }

    if (!window.WebSocket || !window.localStorage) {
      console.log('Websockets or local storage not supported; skipping connection.test.js');
      return false;
    }

    return true;
  }

  function eraseSession(name) {
    window.sessionStorage && window.sessionStorage.removeItem(name);
  }

  if (supportedBrowser()) {
    describe('browser/connection', function () {
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

        /* Ensure session is clean for persistance tests */
        eraseSession('ably-connection-recovery');
      });

      /** @spec RTN20a */
      it('device_going_offline_causes_disconnected_state', function (done) {
        const helper = this.test.helper;

        var realtime = helper.AblyRealtime(),
          connection = realtime.connection,
          offlineEvent = new Event('offline', { bubbles: true });

        helper.monitorConnection(done, realtime);

        connection.once('connected', function () {
          var connectedAt = new Date().getTime();
          connection.once('disconnected', function () {
            var disconnectedAt = new Date().getTime();
            try {
              expect(
                disconnectedAt - connectedAt < 1500,
                'Offline event caused connection to move to the disconnected state',
              ).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            connection.once('connecting', function () {
              var reconnectingAt = new Date().getTime();
              try {
                expect(
                  reconnectingAt - disconnectedAt < 1500,
                  'Client automatically reattempts connection without waiting for disconnect timeout, even if the state is still offline',
                ).to.be.ok;
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              connection.once('connected', function () {
                helper.closeAndFinish(done, realtime);
              });
            });
          });

          // simulate offline event, expect connection moves to disconnected state and waits to retry connection
          document.dispatchEvent(offlineEvent);
        });
      });

      /** @spec RTN20b */
      it('device_going_online_causes_disconnected_connection_to_reconnect_immediately', function (done) {
        const helper = this.test.helper;

        /* Give up trying to connect fairly quickly */
        var realtime = helper.AblyRealtime({ realtimeRequestTimeout: 1000 }),
          connection = realtime.connection,
          onlineEvent = new Event('online', { bubbles: true });

        helper.monitorConnection(done, realtime);

        // simulate the internet being failed by stubbing out tryATransport to foil
        // the initial connection. (No immediate reconnect attempt since it was never
        // connected in the first place)
        var oldTransport = connection.connectionManager.tryATransport;
        connection.connectionManager.tryATransport = function () {};

        connection.once('disconnected', function () {
          var disconnectedAt = new Date();
          try {
            expect(
              connection.state == 'disconnected',
              'Connection should still be disconnected before we trigger it to connect',
            ).to.be.ok;
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          connection.once('connecting', function () {
            try {
              expect(
                new Date() - disconnectedAt < 1500,
                'Online event should have caused the connection to enter the connecting state without waiting for disconnect timeout',
              ).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            connection.once('connected', function () {
              helper.closeAndFinish(done, realtime);
            });
          });
          // restore the 'internet' and simulate an online event
          connection.connectionManager.tryATransport = oldTransport;
          document.dispatchEvent(onlineEvent);
        });
      });

      /** @spec RTN20b */
      it('device_going_online_causes_suspended_connection_to_reconnect_immediately', function (done) {
        const helper = this.test.helper;

        /* move to suspended state after 2s of being disconnected */
        var realtime = helper.AblyRealtime({
            disconnectedRetryTimeout: 500,
            realtimeRequestTimeout: 500,
            connectionStateTtl: 2000,
          }),
          connection = realtime.connection,
          onlineEvent = new Event('online', { bubbles: true });

        // Easiest way to have all transports attempt fail it to stub out tryATransport
        connection.connectionManager.tryATransport = function () {};

        connection.on('failed', function () {
          helper.closeAndFinish(done, realtime, new Error('connection to server failed'));
        });

        connection.once('suspended', function () {
          var suspendedAt = new Date();
          try {
            expect(
              connection.state == 'suspended',
              'Connection should still be suspended before we trigger it to connect',
            ).to.be.ok;
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          connection.once('connecting', function () {
            try {
              expect(
                new Date() - suspendedAt < 1500,
                'Online event should have caused the connection to enter the connecting state without waiting for suspended timeout',
              ).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            helper.closeAndFinish(done, realtime);
          });
          // simulate online event
          document.dispatchEvent(onlineEvent);
        });
      });

      /** @spec RTN20c */
      it('device_going_online_causes_connecting_connection_to_retry_attempt', function (done) {
        const helper = this.test.helper;

        var realtime = helper.AblyRealtime({}),
          connection = realtime.connection,
          onlineEvent = new Event('online', { bubbles: true }),
          oldTransport,
          newTransport;

        helper.monitorConnection(done, realtime, ['failed', 'disconnected', 'suspended']);

        /* Sabotage the connection attempt by emitting onlineEvent when transport is pending */
        connection.connectionManager.once('transport.pending', function (transport) {
          oldTransport = transport;
          document.dispatchEvent(onlineEvent);

          connection.connectionManager.once('transport.pending', function (transport) {
            newTransport = transport;
          });
        });

        connection.on('connected', function () {
          /* Ensure that the original pending transport has been disposed of and superseded */
          expect(oldTransport.isDisposed).to.be.ok;
          expect(newTransport.isDisposed).to.not.be.ok;
          expect(oldTransport).to.not.equal(newTransport);
          expect(realtime.connection.connectionManager.activeProtocol.transport).to.equal(newTransport);
          helper.closeAndFinish(done, realtime);
        });
      });

      /**
       * @specpartial RTN16 test
       * @specpartial RTN16d
       */
      it('page_refresh_with_recovery', function (done) {
        const helper = this.test.helper;

        var realtimeOpts = {
            recover: function (lastConnectionDetails, cb) {
              cb(true);
            },
          },
          realtime = helper.AblyRealtime(realtimeOpts),
          refreshEvent = new Event('beforeunload', { bubbles: true });

        helper.monitorConnection(done, realtime);

        realtime.connection.once('connected', function () {
          var connectionId = realtime.connection.id;
          document.dispatchEvent(refreshEvent);
          try {
            expect(realtime.connection.state).to.equal(
              'connected',
              'check connection state initially unaffected by page refresh',
            );
            helper.simulateDroppedConnection(realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          var newRealtime = helper.AblyRealtime(realtimeOpts);
          newRealtime.connection.once('connected', function () {
            try {
              expect(newRealtime.connection.id).to.equal(
                connectionId,
                'Check new realtime recovered the connection from the cookie',
              );
            } catch (err) {
              helper.closeAndFinish(done, [realtime, newRealtime], err);
              return;
            }
            helper.closeAndFinish(done, [realtime, newRealtime]);
          });
        });
      });

      /** @nospec */
      it('page_refresh_persist_with_denied_recovery', function (done) {
        const helper = this.test.helper;

        var realtimeOpts = {
          recover: function (lastConnectionDetails, cb) {
            cb(false);
          },
        };
        var realtime = helper.AblyRealtime(realtimeOpts),
          refreshEvent = new Event('beforeunload', { bubbles: true });

        helper.monitorConnection(done, realtime);

        realtime.connection.once('connected', function () {
          var connectionId = realtime.connection.id;
          document.dispatchEvent(refreshEvent);
          try {
            expect(realtime.connection.state).to.equal(
              'connected',
              'check connection state initially unaffected by page refresh',
            );
            helper.simulateDroppedConnection(realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          var newRealtime = helper.AblyRealtime(realtimeOpts);
          newRealtime.connection.once('connected', function () {
            try {
              expect(newRealtime.connection.id).not.to.equal(
                connectionId,
                'Check new realtime created a new connection',
              );
            } catch (err) {
              helper.closeAndFinish(done, [realtime, newRealtime], err);
              return;
            }
            helper.closeAndFinish(done, [realtime, newRealtime]);
          });
          helper.monitorConnection(done, newRealtime);
        });
      });

      /** @nospec */
      it('page_refresh_with_close_on_unload', function (done) {
        var realtime = this.test.helper.AblyRealtime({ closeOnUnload: true }),
          refreshEvent = new Event('beforeunload', { bubbles: true });

        this.test.helper.monitorConnection(done, realtime);

        realtime.connection.once('connected', function () {
          try {
            var connectionKey = realtime.connection.key;
            document.dispatchEvent(refreshEvent);
            var state = realtime.connection.state;
            expect(state == 'closing' || state == 'closed', 'check page refresh triggered a close').to.be.ok;
          } catch (err) {
            done(err);
            return;
          }
          done();
        });
      });

      /**
       * @specpartial RTN16
       * @specpartial RTN16d
       */
      it('page_refresh_with_manual_recovery', function (done) {
        const helper = this.test.helper;

        var realtime = helper.AblyRealtime({ closeOnUnload: false }),
          refreshEvent = new Event('beforeunload', { bubbles: true });

        helper.monitorConnection(done, realtime);

        realtime.connection.once('connected', function () {
          var connectionId = realtime.connection.id,
            recoveryKey = realtime.connection.recoveryKey;

          document.dispatchEvent(refreshEvent);
          try {
            expect(realtime.connection.state).to.equal(
              'connected',
              'check connection state initially unaffected by page refresh',
            );
            helper.simulateDroppedConnection(realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          var newRealtime = helper.AblyRealtime({ recover: recoveryKey });
          newRealtime.connection.once('connected', function () {
            try {
              expect(newRealtime.connection.id).to.equal(connectionId, 'Check new realtime recovered the old');
            } catch (err) {
              helper.closeAndFinish(done, [realtime, newRealtime], err);
              return;
            }
            helper.closeAndFinish(done, [realtime, newRealtime]);
          });
        });
      });

      /** @nospec */
      it('page_refresh_with_multiple_recovery_scopes', async function () {
        const realtimeOpts = { recover: (_, cb) => cb(true) },
          opts1 = Object.assign({ recoveryKeyStorageName: 'recovery-1' }, realtimeOpts),
          opts2 = Object.assign({ recoveryKeyStorageName: 'recovery-2' }, realtimeOpts),
          realtime1 = this.test.helper.AblyRealtime(opts1),
          realtime2 = this.test.helper.AblyRealtime(opts2),
          refreshEvent = new Event('beforeunload', { bubbles: true });

        await Promise.all([realtime1.connection.once('connected'), realtime2.connection.once('connected')]);
        const connId1 = realtime1.connection.id;
        const connId2 = realtime2.connection.id;

        document.dispatchEvent(refreshEvent);

        this.test.helper.simulateDroppedConnection(realtime1);
        this.test.helper.simulateDroppedConnection(realtime2);

        await new Promise((res) => setTimeout(res, 1000));

        const newRealtime1 = this.test.helper.AblyRealtime(opts1);
        const newRealtime2 = this.test.helper.AblyRealtime(opts2);
        await Promise.all([newRealtime1.connection.once('connected'), newRealtime2.connection.once('connected')]);
        assert.equal(connId1, newRealtime1.connection.id);
        assert.equal(connId2, newRealtime2.connection.id);

        await Promise.all(
          [realtime1, realtime2, newRealtime1, newRealtime2].map((rt) => this.test.helper.closeAndFinishAsync(rt)),
        );
      });

      /** @nospec */
      it('persist_preferred_transport', function (done) {
        const helper = this.test.helper;

        var realtime = helper.AblyRealtime();

        realtime.connection.connectionManager.on(function (transport) {
          if (this.event === 'transport.active' && transport.shortName === 'web_socket') {
            try {
              expect(window.localStorage.getItem(transportPreferenceName)).to.equal(
                JSON.stringify({ value: 'web_socket' }),
              );
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            helper.closeAndFinish(done, realtime);
          }
        });
        helper.monitorConnection(done, realtime);
      });

      /** @nospec */
      it('browser_transports', function (done) {
        var realtime = this.test.helper.AblyRealtime();
        try {
          expect(realtime.connection.connectionManager.baseTransport).to.equal('xhr_polling');
          expect(realtime.connection.connectionManager.webSocketTransportAvailable).to.be.ok;
        } catch (err) {
          this.test.helper.closeAndFinish(done, realtime, err);
          return;
        }
        this.test.helper.closeAndFinish(done, realtime);
      });

      // this is identical to disable_connectivity_check test in connectivity, but here we specifically test browser supported request implementations
      for (const scenario of [
        {
          description: 'XHR request disable connectivity check',
          ctx: { initialFetchSupported: Ably.Rest.Platform.Config.fetchSupported },
          before: (ctx) => {
            Ably.Rest.Platform.Config.fetchSupported = false;
          },
          after: (ctx) => {
            Ably.Rest.Platform.Config.fetchSupported = ctx.initialFetchSupported;
          },
        },
        {
          description: 'Fetch request disable connectivity check',
          ctx: { initialXhrSupported: Ably.Rest.Platform.Config.xhrSupported },
          before: (ctx) => {
            Ably.Rest.Platform.Config.xhrSupported = false;
          },
          after: (ctx) => {
            Ably.Rest.Platform.Config.xhrSupported = ctx.initialXhrSupported;
          },
        },
      ]) {
        /** @nospec */
        it(scenario.description, async function () {
          const helper = this.test.helper;
          scenario.before(scenario.ctx);
          let thrownError = null;
          let res = null;

          try {
            helper.recordPrivateApi('pass.clientOption.connectivityCheckUrl');
            helper.recordPrivateApi('pass.clientOption.disableConnectivityCheck');
            const options = {
              connectivityCheckUrl: helper.unroutableHost,
              disableConnectivityCheck: true,
              autoConnect: false,
            };

            helper.recordPrivateApi('call.http.checkConnectivity');
            res = await helper.AblyRealtime(options).http.checkConnectivity();
          } catch (error) {
            thrownError = error;
          } finally {
            scenario.after(scenario.ctx);
          }

          expect(
            res && !thrownError,
            'Connectivity check completed ' +
              (thrownError &&
                (helper.recordPrivateApi('call.Utils.inspectError'), helper.Utils.inspectError(thrownError))),
          ).to.be.ok;
        });
      }
    });
  }
});
