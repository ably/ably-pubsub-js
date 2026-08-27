'use strict';

define(['shared_helper', 'async', 'chai'], function (Helper, async, chai) {
  var expect = chai.expect;
  var clientId = 'testClientId';
  var rest;

  describe('realtime/reauth', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }
        rest = helper.AblyRest();
        done();
      });
    });

    /* Waterfall helpers */

    function getToken(helper, tokenParams) {
      return function (state, callback) {
        Helper.whenPromiseSettles(rest.auth.requestToken(tokenParams, null), function (err, token) {
          callback(err, helper.Utils.mixin(state, { token: token }));
        });
      };
    }

    function close() {
      return function (state, callback) {
        state.connectionMonitor && state.realtime.connection.off(state.connectionMonitor);
        state.realtime.close();
        state.realtime.connection.once('closed', function () {
          callback(null, state);
        });
      };
    }

    function connectWithToken(helper) {
      return function (state, callback) {
        var realtime = helper.AblyRealtime(helper.Utils.mixin({ token: state.token }, state.realtimeOpts));
        realtime.connection.once('connected', function () {
          callback(null, helper.Utils.mixin(state, { realtime: realtime }));
        });
      };
    }

    /* For when connection should stay connected right through till it's closed */
    function monitorConnectionContinuity(helper) {
      return function (state, callback) {
        var listener = function () {
          if (this.event !== 'update') {
            callback('Connection monitor: connection state changed to ' + this.event);
          }
        };
        state.realtime.connection.on(listener);
        callback(null, helper.Utils.mixin(state, { connectionMonitor: listener }));
      };
    }

    function reauthWithToken() {
      return function (state, callback) {
        /* Callback once both authorize callback has callback and got 'update'
         * event. (Latter will only happen one event loop cycle after the former;
         * using async.parallel lets us test the update event without race
         * conditions) */
        async.parallel(
          [
            function (cb) {
              Helper.whenPromiseSettles(state.realtime.auth.authorize(null, { token: state.token }), cb);
            },
            function (cb) {
              state.realtime.connection.on('update', function (stateChange) {
                cb(stateChange.reason);
              });
            },
          ],
          function (err) {
            callback(err, state);
          },
        );
      };
    }

    function attach(channelName) {
      return function (state, callback) {
        var channel = state.realtime.channels.get(channelName);
        Helper.whenPromiseSettles(channel.attach(), function (err) {
          callback(err, state);
        });
      };
    }

    function checkChannelState(channelName, expected) {
      return function (state, callback) {
        var channel = state.realtime.channels.get(channelName);
        var err =
          channel.state === expected
            ? null
            : 'checkChannelState: channel state was ' + channel.state + ', expected ' + expected;
        callback(err, state);
      };
    }
    function checkAttached(channelName) {
      return checkChannelState(channelName, 'attached');
    }

    function waitChannelState(channelName, expected) {
      return function (state, callback) {
        var channel = state.realtime.channels.get(channelName);
        if (channel.state === expected) {
          callback(null, state);
          return;
        }
        var timeout = setTimeout(function () {
          channel.off();
          callback(
            'waitChannelState: expected state not reached within 5s. Expected ' +
              expected +
              ', currently ' +
              channel.state,
          );
        }, 5000);
        channel.once(function () {
          clearTimeout(timeout);
          waitChannelState(channelName, expected)(state, callback);
        });
      };
    }

    function checkChannelErrorCode(channelName, expected) {
      return function (state, callback) {
        var channel = state.realtime.channels.get(channelName),
          code = channel.errorReason && channel.errorReason.code;
        var err =
          code === expected ? null : 'checkChannelErrorCode: channel error code was ' + code + ', expected ' + expected;
        callback(err, state);
      };
    }

    function checkCantAttach(channelName) {
      return function (state, callback) {
        var channel = state.realtime.channels.get(channelName);
        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err && err.code === 40160) {
            callback(null, state);
          } else {
            callback(err || 'checkCantAttach: unexpectedly allowed to attach');
          }
        });
      };
    }

    function checkCanPublish(channelName) {
      return function (state, callback) {
        var channel = state.realtime.channels.get(channelName);
        Helper.whenPromiseSettles(channel.publish(null, null), function (err) {
          callback(err, state);
        });
      };
    }

    function checkCantPublish(channelName) {
      return function (state, callback) {
        var channel = state.realtime.channels.get(channelName);
        Helper.whenPromiseSettles(channel.publish(null, null), function (err) {
          if (err && err.code === 40160) {
            callback(null, state);
          } else {
            callback(err || 'checkCantPublish: unexpectedly allowed to publish');
          }
        });
      };
    }

    function testCase(thisInDescribe, name, createSteps) {
      Helper.testOnAllTransportsAndProtocols(thisInDescribe, name, function (realtimeOpts) {
        return function (done) {
          const helper = this.test.helper;
          var _steps = createSteps(helper).slice();
          _steps.unshift(function (cb) {
            cb(null, { realtimeOpts: realtimeOpts });
          });
          async.waterfall(_steps, function (err) {
            try {
              expect(!err, err && name + ': ' + helper.displayError(err)).to.be.ok;
            } catch (err) {
              done(err);
              return;
            }
            done();
          });
        };
      });
    }

    /****************
     ***** Tests *****
     ****************/

    /** @specpartial RTC8a1 - change capability without loss of continuity */
    testCase(this, 'reauthCapabilityUpgradeNewChannel', (helper) => [
      getToken(helper, { clientId: clientId, capability: { wrongchannel: ['*'] } }),
      connectWithToken(helper),
      monitorConnectionContinuity(helper),
      checkCantAttach('rightchannel'),
      getToken(helper, { clientId: clientId, capability: { wrongchannel: ['*'], rightchannel: ['*'] } }),
      reauthWithToken(),
      attach('rightchannel'),
      close(),
    ]);

    /** @specpartial RTC8a1 - capability downgrade leads to an error an failed channel state */
    testCase(this, 'reauthCapabilityDowngradeFullChannel', (helper) => [
      getToken(helper, { clientId: clientId, capability: { channel: ['*'], another: ['*'] } }),
      connectWithToken(helper),
      monitorConnectionContinuity(helper),
      attach('channel'),
      getToken(helper, { clientId: clientId, capability: { another: ['*'] } }),
      reauthWithToken(),
      waitChannelState('channel', 'failed'),
      checkChannelErrorCode('channel', 40160),
      checkCantAttach('channel'),
      close(),
    ]);

    /**
     * Related to RTC8a1.
     * @nospec
     */
    testCase(this, 'reauthCapabilityUpgradeAddPublish', (helper) => [
      getToken(helper, { clientId: clientId, capability: { channel: ['subscribe'] } }),
      connectWithToken(helper),
      monitorConnectionContinuity(helper),
      attach('channel'),
      checkCantPublish('channel'),
      getToken(helper, { clientId: clientId, capability: { channel: ['subscribe', 'publish'] } }),
      reauthWithToken(),
      checkAttached('channel'),
      checkCanPublish('channel'),
      close(),
    ]);

    /**
     * Related to RTC8a1.
     * @nospec
     */
    testCase(this, 'reauthCapabilityDowngradePublish', (helper) => [
      getToken(helper, { clientId: clientId, capability: { channel: ['subscribe', 'publish'] } }),
      connectWithToken(helper),
      monitorConnectionContinuity(helper),
      attach('channel'),
      checkCanPublish('channel'),
      getToken(helper, { clientId: clientId, capability: { channel: ['subscribe'] } }),
      reauthWithToken(),
      attach('channel'),
      checkAttached('channel'),
      checkCantPublish('channel'),
      close(),
    ]);
  });
});
