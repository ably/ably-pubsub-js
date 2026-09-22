'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  var expect = chai.expect;

  describe('browser/simple', function () {
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

    function isTransportAvailable(transport) {
      return transport in Ably.Realtime.ConnectionManager.supportedTransports(Ably.Realtime._transports);
    }

    function realtimeConnection(helper, transports) {
      var options = {};
      if (transports) options.transports = transports;
      return helper.AblyRealtime(options);
    }

    function failWithin(timeInSeconds, done, ably, description) {
      var timeout = setTimeout(function () {
        done(new Error('Timed out: Trying to ' + description + ' took longer than ' + timeInSeconds + ' second(s)'));
        ably.close();
      }, timeInSeconds * 1000);

      return {
        stop: function () {
          clearTimeout(timeout);
        },
      };
    }

    function connectionWithTransport(done, helper, transport) {
      try {
        var ably = realtimeConnection(helper, transport && [transport]),
          connectionTimeout = failWithin(10, done, ably, 'connect');
        ably.connection.on('connected', function () {
          connectionTimeout.stop();
          done();
          ably.close();
        });
        var exitOnState = function (state) {
          ably.connection.on(state, function () {
            connectionTimeout.stop();
            done(new Error(transport + ' connection to server failed'));
            ably.close();
          });
        };
        exitOnState('failed');
        exitOnState('suspended');
      } catch (err) {
        done(err);
        connectionTimeout.stop();
      }
    }

    function heartbeatWithTransport(done, helper, transport) {
      try {
        var ably = realtimeConnection(helper, transport && [transport]),
          connectionTimeout = failWithin(10, done, ably, 'connect'),
          heartbeatTimeout;

        ably.connection.on('connected', function () {
          connectionTimeout.stop();
          heartbeatTimeout = failWithin(25, done, ably, 'wait for heartbeat');
          Helper.whenPromiseSettles(ably.connection.ping(), function (err) {
            heartbeatTimeout.stop();
            done(err);
            ably.close();
          });
        });
        var exitOnState = function (state) {
          ably.connection.on(state, function () {
            connectionTimeout.stop();
            done(new Error(transport + ' connection to server failed'));
            ably.close();
          });
        };
        exitOnState('failed');
        exitOnState('suspended');
      } catch (err) {
        done(err);
        connectionTimeout.stop();
        if (heartbeatTimeout) heartbeatTimeout.stop();
      }
    }

    function publishWithTransport(done, helper, transport) {
      var count = 5;
      var sentCount = 0,
        receivedCount = 0,
        sentCbCount = 0;
      var timer;
      var checkFinish = function () {
        if (receivedCount === count && sentCbCount === count) {
          receiveMessagesTimeout.stop();
          done();
          ably.close();
        }
      };
      var ably = realtimeConnection(helper, transport && [transport]),
        connectionTimeout = failWithin(5, done, ably, 'connect'),
        receiveMessagesTimeout;

      ably.connection.on('connected', function () {
        connectionTimeout.stop();
        receiveMessagesTimeout = failWithin(15, done, ably, 'wait for published messages to be received');

        timer = setInterval(function () {
          Helper.whenPromiseSettles(channel.publish('event0', 'Hello world at: ' + new Date()), function (err) {
            sentCbCount++;
            checkFinish();
          });
          if (sentCount === count) clearInterval(timer);
        }, 500);
      });

      var channel = ably.channels.get(transport + 'publish0' + String(Math.random()).substr(1));
      /* subscribe to event */
      channel.subscribe('event0', function () {
        receivedCount++;
        checkFinish();
      });
    }

    /**
     * Related to RTN4, but this test just reconfirms this behaviour in a browser.
     *
     * @nospec
     */
    it('simpleInitBase0', function (done) {
      try {
        var helper = this.test.helper,
          timeout,
          ably = realtimeConnection(helper);

        ably.connection.on('connected', function () {
          clearTimeout(timeout);
          done();
          ably.close();
        });
        var exitOnState = function (state) {
          ably.connection.on(state, function () {
            done(new Error('Connection to server failed'));
            ably.close();
          });
        };
        exitOnState('failed');
        exitOnState('suspended');
        timeout = setTimeout(function () {
          done(new Error('Timed out: Trying to connect took longer than expected'));
          ably.close();
        }, 10 * 1000);
      } catch (err) {
        done(err);
      }
    });

    var wsTransport = 'web_socket';
    if (isTransportAvailable(wsTransport)) {
      /**
       * Related to RTN1 and RTN4. does basic connection test for websocket transport in a browser.
       *
       * @nospec
       */
      it('wsbase0', function (done) {
        connectionWithTransport(done, this.test.helper, wsTransport);
      });

      /**
       * Publish and subscribe, json transport
       * Tests RTL6i1 and RTL7b for websocket transport in a browser
       *
       * @nospec
       */
      it('wspublish0', function (done) {
        publishWithTransport(done, this.test.helper, wsTransport);
      });

      /**
       * Check heartbeat
       * Tests RTN13a, RTN13b and RTN13c for websocket transport in a browser
       *
       * @nospec
       */
      it('wsheartbeat0', function (done) {
        heartbeatWithTransport(done, this.test.helper, wsTransport);
      });
    }

    var xhrPollingTransport = 'xhr_polling';
    if (isTransportAvailable(xhrPollingTransport)) {
      /**
       * Related to RTN1 and RTN4. does basic connection test for xhr polling transport in a browser
       *
       * @nospec
       */
      it('xhrpollingbase0', function (done) {
        connectionWithTransport(done, this.test.helper, xhrPollingTransport);
      });

      /**
       * Publish and subscribe, json transport
       * Tests RTL6i1 and RTL7b for xhr polling transport in a browser
       *
       * @nospec
       */
      it('xhrpollingpublish0', function (done) {
        publishWithTransport(done, this.test.helper, xhrPollingTransport);
      });

      /**
       * Check heartbeat
       * Tests RTN13a, RTN13b and RTN13c for xhr polling transport in a browser
       *
       * @nospec
       */
      it('xhrpollingheartbeat0', function (done) {
        heartbeatWithTransport(done, this.test.helper, xhrPollingTransport);
      });
    }

    /**
     * Related to RTN1 and RTN4: does basic connection test in a browser with automatically choosing a transport
     *
     * @nospec
     */
    it('auto_transport_base0', function (done) {
      connectionWithTransport(done, this.test.helper);
    });

    /**
     * Publish and subscribe
     * Tests RTL6i1 and RTL7b in a browser with automatically choosing a transport
     *
     * @nospec
     */
    it('auto_transport_publish0', function (done) {
      publishWithTransport(done, this.test.helper);
    });

    /**
     * Check heartbeat
     * Tests RTN13a, RTN13b and RTN13c in a browser with automatically choosing a transport
     *
     * @nospec
     */
    it('auto_transport_heartbeat0', function (done) {
      heartbeatWithTransport(done, this.test.helper);
    });
  });
});
