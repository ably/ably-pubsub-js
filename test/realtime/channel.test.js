'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var exports = {};
  var _exports = {};
  var expect = chai.expect;
  var createPM = Ably.makeProtocolMessageFromDeserialized();

  function checkCanSubscribe(channel, testChannel) {
    return function (callback) {
      var timeout,
        received = false,
        eventName = Helper.randomString();

      channel.subscribe(eventName, function (msg) {
        channel.unsubscribe(eventName);
        received = true;
        clearTimeout(timeout);
        callback();
      });

      Helper.whenPromiseSettles(testChannel.publish(eventName, null), function (err) {
        if (received) return;
        if (err) callback(err);
        timeout = setTimeout(function () {
          channel.unsubscribe(eventName);
          callback('checkCanSubscribe: message not received within 5s');
        }, 5000);
      });
    };
  }

  function checkCantSubscribe(channel, testChannel) {
    return function (callback) {
      var timeout,
        received = false,
        eventName = Helper.randomString();

      channel.subscribe(eventName, function (message) {
        channel.presence.unsubscribe(eventName);
        received = true;
        clearTimeout(timeout);
        callback('checkCantSubscribe: unexpectedly received message');
      });

      Helper.whenPromiseSettles(testChannel.publish(eventName, null), function (err) {
        if (received) return;
        if (err) callback(err);
        timeout = setTimeout(function () {
          channel.unsubscribe(eventName);
          callback();
        }, 500);
      });
    };
  }

  function checkCanPublish(channel) {
    return function (callback) {
      Helper.whenPromiseSettles(channel.publish(null, null), callback);
    };
  }

  function checkCantPublish(channel) {
    return function (callback) {
      Helper.whenPromiseSettles(channel.publish(null, null), function (err) {
        // 40160: operation not permitted by capabilities; 40165: PUBLISH mode not requested when attaching
        if (err && (err.code === 40160 || err.code === 40165)) {
          callback();
        } else {
          callback(err || 'checkCantPublish: unexpectedly allowed to publish');
        }
      });
    };
  }

  function checkCanEnterPresence(channel) {
    return function (callback) {
      var clientId = Helper.randomString();
      Helper.whenPromiseSettles(channel.presence.enterClient(clientId, null), function (err) {
        channel.presence.leaveClient(clientId);
        callback(err);
      });
    };
  }

  function checkCantEnterPresence(channel) {
    return function (callback) {
      Helper.whenPromiseSettles(channel.presence.enterClient(Helper.randomString(), null), function (err) {
        // 40160: operation not permitted by capabilities; 40165: PRESENCE mode not requested when attaching
        if (err && (err.code === 40160 || err.code === 40165)) {
          callback();
        } else {
          callback(err || 'checkCantEnterPresence: unexpectedly allowed to enter presence');
        }
      });
    };
  }

  function checkCanPresenceSubscribe(channel, testChannel) {
    return function (callback) {
      var timeout,
        received = false,
        clientId = Helper.randomString();

      channel.presence.subscribe('enter', function (message) {
        channel.presence.unsubscribe('enter');
        testChannel.presence.leaveClient(clientId);
        received = true;
        clearTimeout(timeout);
        callback();
      });

      Helper.whenPromiseSettles(testChannel.presence.enterClient(clientId, null), function (err) {
        if (received) return;
        if (err) callback(err);
        timeout = setTimeout(function () {
          channel.presence.unsubscribe('enter');
          testChannel.presence.leaveClient(clientId);
          callback('checkCanPresenceSubscribe: message not received within 5s');
        }, 5000);
      });
    };
  }

  function checkCantPresenceSubscribe(channel, testChannel) {
    return function (callback) {
      var timeout,
        received = false,
        clientId = Helper.randomString();

      channel.presence.subscribe('enter', function (message) {
        channel.presence.unsubscribe('enter');
        testChannel.presence.leaveClient(clientId);
        received = true;
        clearTimeout(timeout);
        callback('checkCantPresenceSubscribe: unexpectedly received message');
      });

      Helper.whenPromiseSettles(testChannel.presence.enterClient(clientId, null), function (err) {
        if (received) return;
        if (err) callback(err);
        timeout = setTimeout(function () {
          channel.presence.unsubscribe('enter');
          testChannel.presence.leaveClient(clientId);
          callback();
        }, 500);
      });
    };
  }

  /* Tests */

  describe('realtime/channel', function () {
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
     * Channel init with options
     *
     * @spec RTS3a
     * @spec RTS3b
     * @spec RTS3c
     * @spec RTL16
     */
    Helper.testOnAllTransportsAndProtocols(this, 'channelinit0', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.on('connected', function () {
            try {
              helper.recordPrivateApi('read.channel.channelOptions');
              /* set options on init */
              var channel0 = realtime.channels.get('channelinit0', { fakeOption: true });
              expect(channel0.channelOptions.fakeOption).to.equal(true);

              /* set options on fetch */
              var channel1 = realtime.channels.get('channelinit0', { fakeOption: false });
              expect(channel0.channelOptions.fakeOption).to.equal(false);
              expect(channel1.channelOptions.fakeOption).to.equal(false);

              /* set options with setOptions */
              channel1.setOptions({ fakeOption: true });
              expect(channel1.channelOptions.fakeOption).to.equal(true);
              helper.closeAndFinish(done, realtime);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Base attach case.
     * Doesn't test anything specific, just that the channel eventually attaches
     *
     * @spec RTL4
     */
    Helper.testOnAllTransportsAndProtocols(this, 'channelattach0', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.on('connected', function () {
            var channel0 = realtime.channels.get('channelattach0');
            Helper.whenPromiseSettles(channel0.attach(), function (err) {
              if (err) {
                helper.closeAndFinish(done, realtime, err);
              }
              helper.closeAndFinish(done, realtime);
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Attach before connect.
     * Doesn't test anything specific, just that we can call attach before connecting and it eventually attaches
     *
     * @spec RTL4
     */
    Helper.testOnAllTransportsAndProtocols(this, 'channelattach2', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          var channel2 = realtime.channels.get('channelattach2');
          Helper.whenPromiseSettles(channel2.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            helper.closeAndFinish(done, realtime);
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Attach then detach.
     * Doesn't test anything specific
     *
     * @spec RTL4
     * @spec RTL5
     */
    Helper.testOnAllTransportsAndProtocols(
      this,
      'channelattach3',
      function (realtimeOpts) {
        return function (done) {
          const helper = this.test.helper;
          try {
            var realtime = helper.AblyRealtime(realtimeOpts);
            realtime.connection.on('connected', function () {
              var channel0 = realtime.channels.get('channelattach3');
              Helper.whenPromiseSettles(channel0.attach(), function (err) {
                if (err) {
                  helper.closeAndFinish(done, realtime, err);
                }
                Helper.whenPromiseSettles(channel0.detach(), function (err) {
                  if (err) {
                    helper.closeAndFinish(done, realtime, err);
                  }
                  if (channel0.state == 'detached') {
                    helper.closeAndFinish(done, realtime);
                  } else {
                    helper.closeAndFinish(done, realtime, new Error('Detach failed: State is ' + channel0.state));
                  }
                });
              });
            });
            helper.monitorConnection(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        };
      },
      true,
    );

    /**
     * Attach with an empty channel and expect a channel error
     * and the connection to remain open
     *
     * @spec RTL4d
     */
    Helper.testOnAllTransportsAndProtocols(this, 'channelattachempty', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.once('connected', function () {
            var channel0 = realtime.channels.get('');
            Helper.whenPromiseSettles(channel0.attach(), function (err) {
              if (err) {
                setTimeout(function () {
                  try {
                    expect(realtime.connection.state === 'connected', 'Client should still be connected').to.be.ok;
                    helper.closeAndFinish(done, realtime);
                  } catch (err) {
                    helper.closeAndFinish(done, realtime, err);
                  }
                }, 1000);
                return;
              }
              helper.closeAndFinish(done, realtime, new Error('Unexpected attach success'));
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Attach with an invalid channel name and expect a channel error
     * and the connection to remain open
     *
     * @spec RTL4d
     */
    Helper.testOnAllTransportsAndProtocols(this, 'channelattachinvalid', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.once('connected', function () {
            var channel = realtime.channels.get(':hell');
            Helper.whenPromiseSettles(channel.attach(), function (err) {
              if (err) {
                try {
                  expect(channel.errorReason.code).to.equal(40010, 'Attach error was set as the channel errorReason');
                  expect(err.code).to.equal(40010, 'Attach error was passed to the attach callback');
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                  return;
                }
                setTimeout(function () {
                  try {
                    expect(realtime.connection.state === 'connected', 'Client should still be connected').to.be.ok;
                    helper.closeAndFinish(done, realtime);
                  } catch (err) {
                    helper.closeAndFinish(done, realtime, err);
                  }
                }, 1000);
                return;
              }
              helper.closeAndFinish(done, realtime, 'Unexpected attach success');
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Publishing on a nonattached channel
     *
     * @spec RTL6
     */
    Helper.testOnAllTransportsAndProtocols(this, 'publish_no_attach', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.once('connected', function () {
            Helper.whenPromiseSettles(realtime.channels.get('publish_no_attach').publish(), function (err) {
              if (err) {
                helper.closeAndFinish(
                  done,
                  realtime,
                  new Error('Unexpected attach failure: ' + helper.displayError(err)),
                );
                return;
              }
              helper.closeAndFinish(done, realtime);
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Publishing on a nonattached channel with an invalid channel name.
     *
     * @specpartial RTL6b - callback which is called with an error
     */
    Helper.testOnAllTransportsAndProtocols(this, 'channelattach_publish_invalid', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.once('connected', function () {
            Helper.whenPromiseSettles(realtime.channels.get(':hell').publish(), function (err) {
              if (err) {
                try {
                  expect(err.code).to.equal(40010, 'correct error code');
                  helper.closeAndFinish(done, realtime);
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                }
                return;
              }
              helper.closeAndFinish(done, realtime, new Error('Unexpected attach success'));
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Attach with an invalid channel name and expect a channel error
     * and the connection to remain open.
     * Related to RTL4d.
     *
     *
     * @nospec
     */
    Helper.testOnAllTransportsAndProtocols(this, 'channelattach_invalid_twice', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.once('connected', function () {
            Helper.whenPromiseSettles(realtime.channels.get(':hell').attach(), function (err) {
              if (err) {
                /* attempt second attach */
                Helper.whenPromiseSettles(realtime.channels.get(':hell').attach(), function (err) {
                  if (err) {
                    setTimeout(function () {
                      try {
                        expect(realtime.connection.state === 'connected', 'Client should still be connected').to.be.ok;
                        helper.closeAndFinish(done, realtime);
                      } catch (err) {
                        helper.closeAndFinish(done, realtime, err);
                      }
                    }, 1000);
                    return;
                  }
                  helper.closeAndFinish(done, realtime, new Error('Unexpected attach (second attempt) success'));
                });
                return;
              }
              helper.closeAndFinish(done, realtime, new Error('Unexpected attach success'));
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Attach then later call whenState which fires immediately
     * Closely related to RTL25a, but this just tests that listener is called at all, without checking parameters
     *
     * @nospec
     */
    it('channelattachWhenState', function (done) {
      const helper = this.test.helper;
      try {
        var realtime = helper.AblyRealtime(),
          channel = realtime.channels.get('channelattachWhenState');

        Helper.whenPromiseSettles(channel.attach(), function (err) {
          Helper.whenPromiseSettles(channel.whenState('attached'), function () {
            helper.closeAndFinish(done, realtime, err);
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Attach and call whenState before attach which fires later
     *
     * @spec RTL25b
     */
    it('channelattachOnceOrIfBefore', function (done) {
      const helper = this.test.helper;
      try {
        var realtime = helper.AblyRealtime(),
          channel = realtime.channels.get('channelattachOnceOrIf'),
          firedImmediately = false;

        channel.attach();
        Helper.whenPromiseSettles(channel.whenState('attached'), function () {
          firedImmediately = true;
          try {
            expect(channel.state).to.equal('attached', 'whenState fired when attached');
            helper.closeAndFinish(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        });
        expect(!firedImmediately, 'whenState should not fire immediately as not attached').to.be.ok;
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * No spec items found for 'modes' property behavior (like preventing publish, entering presence, presence subscription)
     *
     * @spec RTS3b
     * @spec RTL4k
     * @spec RTL4k1
     * @spec RTL4m
     */
    Helper.testOnAllTransportsAndProtocols(this, 'attachWithChannelParamsBasicChannelsGet', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        var testName = 'attachWithChannelParamsBasicChannelsGet';
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.on('connected', function () {
            var params = {
              modes: 'subscribe',
              delta: 'vcdiff',
            };
            var channelOptions = {
              params: params,
            };
            var channel = realtime.channels.get(testName, channelOptions);
            Helper.whenPromiseSettles(channel.attach(), function (err) {
              if (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              try {
                helper.recordPrivateApi('read.channel.channelOptions');
                expect(channel.channelOptions).to.deep.equal(channelOptions, 'Check requested channel options');
                expect(channel.params).to.deep.equal(params, 'Check result params');
                expect(channel.modes).to.deep.equal(['subscribe'], 'Check result modes');
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }

              var testRealtime = helper.AblyRealtime();
              testRealtime.connection.on('connected', function () {
                var testChannel = testRealtime.channels.get(testName);
                async.series(
                  [
                    checkCanSubscribe(channel, testChannel),
                    checkCantPublish(channel),
                    checkCantEnterPresence(channel),
                    checkCantPresenceSubscribe(channel, testChannel),
                  ],
                  function (err) {
                    testRealtime.close();
                    helper.closeAndFinish(done, realtime, err);
                  },
                );
              });
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * No spec items found for 'modes' property behavior (like preventing publish, entering presence, presence subscription)
     *
     * @spec RTL4k
     * @spec RTL4k1
     * @spec RTL4m
     * @spec RTL16
     */
    Helper.testOnAllTransportsAndProtocols(this, 'attachWithChannelParamsBasicSetOptions', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        var testName = 'attachWithChannelParamsBasicSetOptions';
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.on('connected', function () {
            var params = {
              modes: 'subscribe',
              delta: 'vcdiff',
            };
            var channelOptions = {
              params: params,
            };
            var channel = realtime.channels.get(testName);
            channel.setOptions(channelOptions);
            Helper.whenPromiseSettles(channel.attach(), function (err) {
              if (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              helper.recordPrivateApi('read.channel.channelOptions');
              expect(channel.channelOptions).to.deep.equal(channelOptions, 'Check requested channel options');
              expect(channel.params).to.deep.equal(params, 'Check result params');
              expect(channel.modes).to.deep.equal(['subscribe'], 'Check result modes');

              var testRealtime = helper.AblyRealtime();
              testRealtime.connection.on('connected', function () {
                var testChannel = testRealtime.channels.get(testName);
                async.series(
                  [
                    checkCanSubscribe(channel, testChannel),
                    checkCantPublish(channel),
                    checkCantEnterPresence(channel),
                    checkCantPresenceSubscribe(channel, testChannel),
                  ],
                  function (err) {
                    testRealtime.close();
                    helper.closeAndFinish(done, realtime, err);
                  },
                );
              });
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * @spec RTL16
     * @spec RTL7c
     */
    Helper.testOnAllTransportsAndProtocols(this, 'subscribeAfterSetOptions', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        var testName = 'subscribeAfterSetOptions';
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.on('connected', function () {
            var channel = realtime.channels.get(testName);
            channel.setOptions({
              params: {
                modes: 'publish,subscribe',
              },
            });
            var testData = 'Test data';
            channel.subscribe(function (message) {
              try {
                expect(message.data).to.equal(testData, 'Check data');
                helper.closeAndFinish(done, realtime);
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
              }
            });
            channel.publish(undefined, testData);
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /** @spec RTS3c1 */
    it('channelGetShouldThrowWhenWouldCauseReattach', function (done) {
      const helper = this.test.helper;
      var testName = 'channelGetShouldThrowWhenWouldCauseReattach';
      try {
        var realtime = helper.AblyRealtime();
        realtime.connection.on('connected', function () {
          var params = {
            modes: 'subscribe',
            delta: 'vcdiff',
          };
          var channel = realtime.channels.get(testName, {
            params: params,
          });
          Helper.whenPromiseSettles(channel.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }

            try {
              realtime.channels.get(testName, {
                params: {
                  modes: 'subscribe',
                },
              });
            } catch (err) {
              try {
                expect(err.code).to.equal(40000, 'Check error code');
                expect(err.statusCode).to.equal(400, 'Check error status code');
                expect(err.remediation.includes('setOptions'), 'Check error remediation points at setOptions').to.be.ok;
                helper.closeAndFinish(done, realtime);
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
              }
            }
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /** @spec RTL16a */
    Helper.testOnAllTransportsAndProtocols(this, 'setOptionsCallbackBehaviour', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        var testName = 'setOptionsCallbackBehaviour';
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.on('connected', function () {
            var params = {
              modes: 'subscribe',
              delta: 'vcdiff',
            };
            var modes = ['publish'];
            var channel = realtime.channels.get(testName);

            async.series(
              [
                function (cb) {
                  Helper.whenPromiseSettles(channel.attach(), cb);
                },
                function (cb) {
                  var channelUpdated = false;
                  helper.recordPrivateApi('listen.channel._attachedReceived.attached');
                  channel._attachedReceived.on('attached', function () {
                    channelUpdated = true;
                  });

                  Helper.whenPromiseSettles(
                    channel.setOptions({
                      params: {
                        modes: 'publish',
                      },
                    }),
                    function () {
                      /* Wait a tick so we don' depend on whether the update event runs the
                       * channelUpdated listener or the setOptions listener first */
                      helper.recordPrivateApi('call.Platform.nextTick');
                      Ably.Realtime.Platform.Config.nextTick(function () {
                        expect(channelUpdated, 'Check channel went to the server to update the channel params').to.be
                          .ok;
                        cb();
                      });
                    },
                  );
                },
                function (cb) {
                  var channelUpdated = false;
                  helper.recordPrivateApi('listen.channel._attachedReceived.attached');
                  channel._attachedReceived.on('attached', function () {
                    channelUpdated = true;
                  });

                  Helper.whenPromiseSettles(
                    channel.setOptions({
                      modes: ['subscribe'],
                    }),
                    function () {
                      helper.recordPrivateApi('call.Platform.nextTick');
                      Ably.Realtime.Platform.Config.nextTick(function () {
                        expect(channelUpdated, 'Check channel went to the server to update the channel mode').to.be.ok;
                        cb();
                      });
                    },
                  );
                },
              ],
              function (err) {
                helper.closeAndFinish(done, realtime, err);
              },
            );
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Verify modes is ignored when params.modes is present
     * @nospec
     */
    Helper.testOnAllTransportsAndProtocols(
      this,
      'attachWithChannelParamsModesAndChannelModes',
      function (realtimeOpts) {
        return function (done) {
          const helper = this.test.helper;
          var testName = 'attachWithChannelParamsModesAndChannelModes';
          try {
            var realtime = helper.AblyRealtime(realtimeOpts);
            realtime.connection.on('connected', function () {
              var paramsModes = ['presence', 'subscribe'];
              var params = {
                modes: paramsModes.join(','),
              };
              var channelOptions = {
                params: params,
                modes: ['publish', 'presence_subscribe'],
              };
              var channel = realtime.channels.get(testName, channelOptions);
              Helper.whenPromiseSettles(channel.attach(), function (err) {
                if (err) {
                  helper.closeAndFinish(done, realtime, err);
                  return;
                }
                try {
                  helper.recordPrivateApi('read.channel.channelOptions');
                  expect(channel.channelOptions).to.deep.equal(channelOptions, 'Check requested channel options');
                  expect(channel.params).to.deep.equal(params, 'Check result params');
                  expect(channel.modes).to.deep.equal(paramsModes, 'Check result modes');
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                  return;
                }

                var testRealtime = helper.AblyRealtime();
                testRealtime.connection.on('connected', function () {
                  var testChannel = testRealtime.channels.get(testName);
                  async.series(
                    [
                      checkCanSubscribe(channel, testChannel),
                      checkCanEnterPresence(channel),
                      checkCantPublish(channel),
                      checkCantPresenceSubscribe(channel, testChannel),
                    ],
                    function (err) {
                      testRealtime.close();
                      helper.closeAndFinish(done, realtime, err);
                    },
                  );
                });
              });
            });
            helper.monitorConnection(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        };
      },
    );

    /**
     * No spec items found for 'modes' property behavior (like preventing publish, entering presence, presence subscription)
     *
     * @spec RTS3b
     * @spec RTL4l
     * @spec RTL4m
     */
    Helper.testOnAllTransportsAndProtocols(this, 'attachWithChannelModes', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        var testName = 'attachWithChannelModes';
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.on('connected', function () {
            var modes = ['publish', 'presence_subscribe'];
            var channelOptions = {
              modes: modes,
            };
            var channel = realtime.channels.get(testName, channelOptions);
            Helper.whenPromiseSettles(channel.attach(), function (err) {
              if (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              try {
                helper.recordPrivateApi('read.channel.channelOptions');
                expect(channel.channelOptions).to.deep.equal(channelOptions, 'Check requested channel options');
                expect(channel.modes).to.deep.equal(modes, 'Check result modes');
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }

              var testRealtime = helper.AblyRealtime();
              testRealtime.connection.on('connected', function () {
                var testChannel = testRealtime.channels.get(testName);
                async.series(
                  [
                    checkCanPublish(channel),
                    checkCanPresenceSubscribe(channel, testChannel),
                    checkCantSubscribe(channel, testChannel),
                    checkCantEnterPresence(channel),
                  ],
                  function (err) {
                    testRealtime.close();
                    helper.closeAndFinish(done, realtime, err);
                  },
                );
              });
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * No spec items found for 'modes' property behavior (like preventing publish, entering presence, presence subscription)
     *
     * @spec RTS3b
     * @spec RTL4k
     * @spec RTL4k1
     * @spec RTL4l
     * @spec RTL4m
     */
    Helper.testOnAllTransportsAndProtocols(this, 'attachWithChannelParamsDeltaAndModes', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        var testName = 'attachWithChannelParamsDeltaAndModes';
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.on('connected', function () {
            var modes = ['publish', 'subscribe', 'presence_subscribe'];
            var channelOptions = {
              modes: modes,
              params: { delta: 'vcdiff' },
            };
            var channel = realtime.channels.get(testName, channelOptions);
            Helper.whenPromiseSettles(channel.attach(), function (err) {
              if (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              try {
                helper.recordPrivateApi('read.channel.channelOptions');
                expect(channel.channelOptions).to.deep.equal(channelOptions, 'Check requested channel options');
                expect(channel.params).to.deep.equal({ delta: 'vcdiff' }, 'Check result params');
                expect(channel.modes).to.deep.equal(modes, 'Check result modes');
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }

              var testRealtime = helper.AblyRealtime();
              testRealtime.connection.on('connected', function () {
                var testChannel = testRealtime.channels.get(testName);
                async.series(
                  [
                    checkCanPublish(channel),
                    checkCanSubscribe(channel, testChannel),
                    checkCanPresenceSubscribe(channel, testChannel),
                    checkCantEnterPresence(channel),
                  ],
                  function (err) {
                    testRealtime.close();
                    helper.closeAndFinish(done, realtime, err);
                  },
                );
              });
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * @spec TB2d
     * @spec TB2c
     * @spec RTL4k1
     */
    it('attachWithInvalidChannelParams', function (done) {
      const helper = this.test.helper;
      var testName = 'attachWithInvalidChannelParams';
      var defaultChannelModes = 'presence,publish,subscribe,presence_subscribe,annotation_publish';
      try {
        var realtime = helper.AblyRealtime();
        realtime.connection.on('connected', function () {
          var channel = realtime.channels.get(testName);
          async.series(
            [
              function (cb) {
                Helper.whenPromiseSettles(channel.attach(), function (err) {
                  cb(err);
                });
              },
              function (cb) {
                var channelOptions = {
                  modes: 'subscribe',
                };
                Helper.whenPromiseSettles(channel.setOptions(channelOptions), function (err) {
                  expect(err.code).to.equal(40000, 'Check channelOptions validation error code');
                  expect(err.statusCode).to.equal(400, 'Check channelOptions validation error statusCode');
                  expect(channel.modes).to.deep.equal(
                    defaultChannelModes.split(','),
                    'Check channel options modes result',
                  );
                  cb();
                });
              },
              function (cb) {
                var channelOptions = {
                  modes: [1, 'subscribe'],
                };
                Helper.whenPromiseSettles(channel.setOptions(channelOptions), function (err) {
                  expect(err.code).to.equal(40000, 'Check channelOptions validation error code');
                  expect(err.statusCode).to.equal(400, 'Check channelOptions validation error statusCode');
                  expect(channel.modes).to.deep.equal(
                    defaultChannelModes.split(','),
                    'Check channel options modes result',
                  );
                  cb();
                });
              },
              function (cb) {
                var channelOptions = {
                  params: 'test',
                };
                Helper.whenPromiseSettles(channel.setOptions(channelOptions), function (err) {
                  expect(err.code).to.equal(40000, 'Check channelOptions validation error code');
                  expect(err.statusCode).to.equal(400, 'Check channelOptions validation error statusCode');
                  expect(channel.params).to.deep.equal({}, 'Check channel options params');
                  cb();
                });
              },
              function (cb) {
                /* not malformed, but not recognised so we should end up with an empty params object*/
                var channelOptions = {
                  params: { nonexistent: 'foo' },
                };
                Helper.whenPromiseSettles(channel.setOptions(channelOptions), function () {
                  expect(channel.params).to.deep.equal({}, 'Check channel params');
                  cb();
                });
              },
              function (cb) {
                var channelOptions = {
                  modes: undefined,
                };
                Helper.whenPromiseSettles(channel.setOptions(channelOptions), function (err) {
                  expect(err.code).to.equal(40000, 'Check channelOptions validation error code');
                  expect(err.statusCode).to.equal(400, 'Check channelOptions validation error statusCode');
                  expect(channel.params).to.deep.equal({}, 'Check channel options params result');
                  expect(channel.modes).to.deep.equal(
                    defaultChannelModes.split(','),
                    'Check channel options modes result',
                  );
                  cb();
                });
              },
              function (cb) {
                var channelOptions = {
                  modes: ['susribe'],
                };
                Helper.whenPromiseSettles(channel.setOptions(channelOptions), function (err) {
                  expect(err.code).to.equal(40000, 'Check channelOptions validation error code');
                  expect(err.statusCode).to.equal(400, 'Check channelOptions validation error statusCode');
                  expect(channel.params).to.deep.equal({}, 'Check channel options params result');
                  expect(channel.modes).to.deep.equal(
                    defaultChannelModes.split(','),
                    'Check channel options modes result',
                  );
                  cb();
                });
              },
            ],
            function (err) {
              helper.closeAndFinish(done, realtime, err);
            },
          );
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Subscribe, then unsubscribe, binary transport.
     * Only tests that those functions can be called, not their behavior.
     *
     * @spec RTL7
     * @spec RTL8
     */
    it('channelsubscribe0', function (done) {
      try {
        const helper = this.test.helper;
        var realtime = helper.AblyRealtime({ useBinaryProtocol: true });
        realtime.connection.on('connected', function () {
          var channel6 = realtime.channels.get('channelsubscribe0');
          Helper.whenPromiseSettles(channel6.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            try {
              channel6.subscribe('event0', function () {});
              setTimeout(function () {
                try {
                  channel6.unsubscribe('event0', function () {});
                  helper.closeAndFinish(done, realtime);
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                }
              }, 1000);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Subscribe, then unsubscribe listeners by event, by listener, and then all events & listener
     *
     * @spec RTL7a
     * @spec RTL7b
     * @spec RTL8c
     * @spec RTL8a
     * @spec RTL8b
     */
    it('channelsubscribe1', function (done) {
      const helper = this.test.helper;
      var messagesReceived = 0;

      try {
        var realtime = helper.AblyRealtime();
        var channelByEvent, channelByListener, channelAll;

        var unsubscribeTest = function () {
          channelByEvent.unsubscribe('event', listenerByEvent);
          channelByListener.unsubscribe(listenerNoEvent);
          channelAll.unsubscribe();
          Helper.whenPromiseSettles(channelByEvent.publish('event', 'data'), function (err) {
            try {
              expect(!err, 'Error publishing single event: ' + err).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            Helper.whenPromiseSettles(channelByListener.publish(null, 'data'), function (err) {
              try {
                expect(!err, 'Error publishing any event: ' + err).to.be.ok;
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              Helper.whenPromiseSettles(channelAll.publish(null, 'data'), function (err) {
                try {
                  expect(!err, 'Error publishing any event: ' + err).to.be.ok;
                  expect(messagesReceived).to.equal(3, 'Only three messages should be received by the listeners');
                  helper.closeAndFinish(done, realtime);
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                }
              });
            });
          });
        };

        var listenerByEvent = function () {
          messagesReceived += 1;
          if (messagesReceived == 3) {
            unsubscribeTest();
          }
        };
        var listenerNoEvent = function () {
          messagesReceived += 1;
          if (messagesReceived == 3) {
            unsubscribeTest();
          }
        };
        var listenerAllEvents = function () {
          return listenerNoEvent();
        };

        realtime.connection.on('connected', function () {
          channelByEvent = realtime.channels.get('channelsubscribe1-event');
          Helper.whenPromiseSettles(channelByEvent.subscribe('event', listenerByEvent), function () {
            channelByEvent.publish('event', 'data');
            channelByListener = realtime.channels.get('channelsubscribe1-listener');
            Helper.whenPromiseSettles(channelByListener.subscribe(null, listenerNoEvent), function () {
              channelByListener.publish(null, 'data');
              channelAll = realtime.channels.get('channelsubscribe1-all');
              Helper.whenPromiseSettles(channelAll.subscribe(listenerAllEvents), function () {
                channelAll.publish(null, 'data');
              });
            });
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * A server-sent DETACHED, with err, should cause the channel to attempt an
     * immediate reattach. If that fails, it should go into suspended
     *
     * @spec RTL13
     */
    it('server_sent_detached', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ transports: [helper.bestTransport] }),
        channelName = 'server_sent_detached',
        channel = realtime.channels.get(channelName);

      async.series(
        [
          function (cb) {
            realtime.connection.once('connected', function () {
              cb();
            });
          },
          function (cb) {
            Helper.whenPromiseSettles(channel.attach(), cb);
          },
          function (cb) {
            /* Sabotage the reattach attempt, then simulate a server-sent detach */
            helper.recordPrivateApi('replace.channel.send');
            channel.send = function () {};
            helper.recordPrivateApi('write.realtime.options.timeouts.realtimeRequestTimeout');
            realtime.options.timeouts.realtimeRequestTimeout = 100;
            channel.once(function (stateChange) {
              expect(stateChange.current).to.equal('attaching', 'Channel reattach attempt happens immediately');
              expect(stateChange.reason.code).to.equal(50000, 'check error is propagated in the reason');
              cb();
            });
            helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
            var transport = realtime.connection.connectionManager.activeProtocol.getTransport();
            helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
            helper.recordPrivateApi('call.transport.onProtocolMessage');
            transport.onProtocolMessage(
              createPM({
                action: 13,
                channel: channelName,
                error: { statusCode: 500, code: 50000, message: 'generic serverside failure' },
              }),
            );
          },
          function (cb) {
            channel.once(function (stateChange) {
              expect(stateChange.current).to.equal('suspended', 'Channel we go into suspended');
              expect(stateChange.reason && stateChange.reason.code).to.equal(90007, 'check error is now the timeout');
              cb();
            });
          },
        ],
        function (err) {
          helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /**
     * A server-sent DETACHED, with err, while in the attaching state, should
     * result in the channel becoming suspended
     *
     * @specpartial RTL13b - tests transition to the SUSPENDED state with emitted error
     */
    it('server_sent_detached_while_attaching', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ transports: [helper.bestTransport] }),
        channelName = 'server_sent_detached_while_attaching',
        channel = realtime.channels.get(channelName);

      realtime.connection.once('connected', function () {
        helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
        var transport = realtime.connection.connectionManager.activeProtocol.getTransport();
        /* Mock send to respond to attaches with a DETACHED */
        helper.recordPrivateApi('replace.channel.send');
        channel.send = function (msg) {
          try {
            expect(msg.action).to.equal(10, 'check attach action');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.recordPrivateApi('call.Platform.nextTick');
          Ably.Realtime.Platform.Config.nextTick(function () {
            helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
            helper.recordPrivateApi('call.transport.onProtocolMessage');
            transport.onProtocolMessage(
              createPM({
                action: 13,
                channel: channelName,
                error: { statusCode: 500, code: 50000, message: 'generic serverside failure' },
              }),
            );
          });
        };
        Helper.whenPromiseSettles(channel.attach(), function (err) {
          try {
            expect(err.code).to.equal(50000, 'check error is propagated to the attach callback');
            expect(channel.state).to.equal('suspended', 'check channel goes into suspended');
            helper.closeAndFinish(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        });
      });
    });

    /**
     * A server-sent ERROR, with channel field, should fail the channel
     *
     * @specpartial RTL14 - tests transition to the FAILED state
     */
    it('server_sent_error', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ transports: [helper.bestTransport] }),
        channelName = 'server_sent_error',
        channel = realtime.channels.get(channelName);

      realtime.connection.once('connected', function () {
        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          channel.on('failed', function (stateChange) {
            try {
              expect(stateChange.reason.code).to.equal(50000, 'check error is propagated');
              helper.closeAndFinish(done, realtime);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });
          helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
          var transport = realtime.connection.connectionManager.activeProtocol.getTransport();
          helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
          helper.recordPrivateApi('call.transport.onProtocolMessage');
          transport.onProtocolMessage(
            createPM({
              action: 9,
              channel: channelName,
              error: { statusCode: 500, code: 50000, message: 'generic serverside failure' },
            }),
          );
        });
      });
    });

    /**
     * A server-sent ATTACHED indicating a loss of connection continuity (i.e.
     * with no resumed flag, possibly with an error) on an attached channel
     * should emit an UPDATE event on the channel
     *
     * @spec RTL12
     */
    it('server_sent_attached_err', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime(),
        channelName = 'server_sent_attached_err',
        channel = realtime.channels.get(channelName);

      async.series(
        [
          function (cb) {
            realtime.connection.once('connected', function () {
              cb();
            });
          },
          function (cb) {
            Helper.whenPromiseSettles(channel.attach(), cb);
          },
          function (cb) {
            channel.once(function (stateChange) {
              expect(this.event).to.equal('update', 'check is error event');
              expect(stateChange.current).to.equal('attached', 'check current');
              expect(stateChange.previous).to.equal('attached', 'check previous');
              expect(stateChange.resumed).to.equal(false, 'check resumed');
              expect(stateChange.reason.code).to.equal(50000, 'check error propagated');
              expect(channel.state).to.equal('attached', 'check channel still attached');
              cb();
            });
            helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
            var transport = realtime.connection.connectionManager.activeProtocol.getTransport();
            helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
            helper.recordPrivateApi('call.transport.onProtocolMessage');
            transport.onProtocolMessage(
              createPM({
                action: 11,
                channel: channelName,
                error: { statusCode: 500, code: 50000, message: 'generic serverside failure' },
              }),
            );
          },
        ],
        function (err) {
          helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /**
     * Check that queueMessages: false disables queuing for connection queue state
     *
     * @spec TO3g
     */
    it('publish_no_queueing', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ queueMessages: false }),
        channel = realtime.channels.get('publish_no_queueing');

      /* try a publish while not yet connected */
      Helper.whenPromiseSettles(channel.publish('foo', 'bar'), function (err) {
        try {
          expect(err, 'Check publish while disconnected/connecting is rejected').to.be.ok;
          helper.closeAndFinish(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });
    });

    /**
     * v1-style trailing-callback shape on RealtimeChannel.{publish, subscribe,
     * history} throws synchronously with a steering ErrorInfo whose message
     * diagnoses *what* went wrong and whose remediation prescribes the v2 replacement
     * call.
     */
    [
      { method: 'publish', invoke: (ch) => ch.publish('event', { hello: 'world' }, () => {}) },
      {
        method: 'subscribe',
        invoke: (ch) =>
          ch.subscribe(
            'event',
            () => {},
            () => {},
          ),
      },
      {
        method: 'subscribe_listener_callback',
        invoke: (ch) =>
          ch.subscribe(
            () => {},
            () => {},
          ),
      },
      { method: 'history', invoke: (ch) => ch.history(null, () => {}) },
    ].forEach(function (testCase) {
      it('v1_callback_' + testCase.method + '_throws_synchronously', function (done) {
        var helper = this.test.helper,
          realtime = helper.AblyRealtime({ autoConnect: false }),
          channel = realtime.channels.get('v1cb_channel_' + testCase.method);

        try {
          testCase.invoke(channel);
          helper.closeAndFinish(
            done,
            realtime,
            new Error('expected ' + testCase.method + '() to throw on v1 callback shape'),
          );
        } catch (err) {
          try {
            expect(err.code).to.equal(40025);
            expect(err.message).to.contain('v1 callback signature');
            expect(err.message).to.contain('no longer supported');
            expect(err.remediation).to.be.a('string');
            expect(err.remediation).to.contain('Drop the trailing callback');
            expect(err.remediation).to.contain(
              'https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md',
            );
            helper.closeAndFinish(done, realtime);
          } catch (assertionErr) {
            helper.closeAndFinish(done, realtime, assertionErr);
          }
        }
      });
    });

    /**
     * A channel attach that times out should be retried
     *
     * @spec RTL4f
     * @spec RTL13a
     */
    it('channel_attach_timeout', function (done) {
      /* Use a fixed transport as attaches are resent when the transport changes */
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({
          transports: [helper.bestTransport],
          realtimeRequestTimeout: 2000,
          channelRetryTimeout: 100,
        }),
        channelName = 'channel_attach_timeout',
        channel = realtime.channels.get(channelName);

      /* Stub out the channel's ability to communicate */
      helper.recordPrivateApi('replace.channel.send');
      channel.send = function () {};

      async.series(
        [
          function (cb) {
            realtime.connection.once('connected', function () {
              cb();
            });
          },
          function (cb) {
            Helper.whenPromiseSettles(channel.attach(), function (err) {
              expect(err, 'Channel attach timed out as expected').to.be.ok;
              expect(err && err.code).to.equal(90007, 'Attach timeout err passed to attach callback');
              expect(channel.state).to.equal('suspended', 'Check channel state goes to suspended');
              cb();
            });
          },
          function (cb) {
            /* nexttick so that it doesn't pick up the suspended event */
            helper.recordPrivateApi('call.Platform.nextTick');
            Ably.Realtime.Platform.Config.nextTick(function () {
              channel.once(function (stateChange) {
                expect(stateChange.current).to.equal('attaching', 'Check channel tries again after a bit');
                cb();
              });
            });
          },
        ],
        function (err) {
          helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /**
     * Check channel state implications of connection going into suspended
     *
     * @spec RTL3c
     * @spec RTL3d
     */
    it('suspended_connection', function (done) {
      /* Use a fixed transport as attaches are resent when the transport changes */
      /* Browsers throttle setTimeouts to min 1s in in active tabs; having timeouts less than that screws with the relative timings */
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({
          transports: [helper.bestTransport],
          channelRetryTimeout: 1010,
          suspendedRetryTimeout: 1100,
        }),
        channelName = 'suspended_connection',
        channel = realtime.channels.get(channelName);

      async.series(
        [
          function (cb) {
            realtime.connection.once('connected', function () {
              cb();
            });
          },
          function (cb) {
            Helper.whenPromiseSettles(channel.attach(), cb);
          },
          function (cb) {
            /* Have the connection go into the suspended state, and check that the
             * channel goes into the suspended state and doesn't try to reattach
             * until the connection reconnects */
            helper.recordPrivateApi('replace.channel.send');
            channel.send = function (msg) {
              expect(false, 'Channel tried to send a message ' + JSON.stringify(msg)).to.be.ok;
            };
            helper.recordPrivateApi('write.realtime.options.timeouts.realtimeRequestTimeout');
            realtime.options.timeouts.realtimeRequestTimeout = 2000;

            helper.becomeSuspended(realtime, function () {
              /* nextTick as connection event is emitted before channel state is changed */
              helper.recordPrivateApi('call.Platform.nextTick');
              Ably.Realtime.Platform.Config.nextTick(function () {
                expect(channel.state).to.equal('suspended', 'check channel state is suspended');
                cb();
              });
            });
          },
          function (cb) {
            realtime.connection.once(function (stateChange) {
              expect(stateChange.current).to.equal('connecting', 'Check we try to connect again');
              /* We no longer want to fail the test for an attach, but still want to sabotage it */
              helper.recordPrivateApi('replace.channel.send');
              channel.send = function () {};
              cb();
            });
          },
          function (cb) {
            channel.once(function (stateChange) {
              expect(stateChange.current).to.equal('attaching', 'Check that once connected we try to attach again');
              cb();
            });
          },
          function (cb) {
            channel.once(function (stateChange) {
              expect(stateChange.current).to.equal(
                'suspended',
                'Check that the channel goes back into suspended after attach fails',
              );
              expect(stateChange.reason && stateChange.reason.code).to.equal(90007, 'Check correct error code');
              cb();
            });
          },
        ],
        function (err) {
          helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /** @spec RTL3g **/
    it('detaching_channel_when_connection_enters_failed', async function () {
      // Given: A channel in the DETACHING state
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime({ transports: [helper.bestTransport] });
      const channel = realtime.channels.get('detached_channel_when_connection_enters_failed');

      await channel.attach();

      helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
      const transport = realtime.connection.connectionManager.activeProtocol.getTransport();
      const onProtocolMessageOriginal = transport.onProtocolMessage;

      helper.recordPrivateApi('replace.transport.onProtocolMessage');
      transport.onProtocolMessage = function (msg) {
        if (msg.action === 13) {
          // Drop the incoming DETACHED so that the channel stays in DETACHING
          return;
        }

        helper.recordPrivateApi('call.transport.onProtocolMessage');
        onProtocolMessageOriginal.call(this, msg);
      };

      const channelDetachPromise = channel.detach();

      expect(channel.state).to.equal('detaching');

      // When: The connection enters FAILED
      const channelFailedPromise = channel.whenState('failed');

      // Inject a connection-level ERROR to make connection enter FAILED per RTN15i
      helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
      helper.recordPrivateApi('call.transport.onProtocolMessage');
      transport.onProtocolMessage(
        createPM({ action: 9, error: { code: 40000, statusCode: 400, message: 'Some error' } }),
      );

      // Then: The channel transitions to FAILED and the call to `detach()` fails
      await channelFailedPromise;

      try {
        await channelDetachPromise;
        expect.fail('Expected channel.detach() to throw');
      } catch {
        expect(channel.errorReason.code).to.equal(40000);
        expect(channel.errorReason.statusCode).to.equal(400);
        expect(channel.errorReason.message).to.equal('Some error');
      }

      // Teardown
      await helper.closeAndFinishAsync(realtime);
    });

    /** @specpartial RTL3h - Tests the CLOSED case **/
    it('detaching_channel_when_connection_enters_closed', async function () {
      // Given: A channel in the DETACHING state
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime({ transports: [helper.bestTransport] });
      const channel = realtime.channels.get('detached_channel_when_connection_enters_failed');

      await channel.attach();

      helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
      const transport = realtime.connection.connectionManager.activeProtocol.getTransport();
      const onProtocolMessageOriginal = transport.onProtocolMessage;

      helper.recordPrivateApi('replace.transport.onProtocolMessage');
      transport.onProtocolMessage = function (msg) {
        if (msg.action === 13) {
          // Drop the incoming DETACHED so that the channel stays in DETACHING
          return;
        }

        helper.recordPrivateApi('call.transport.onProtocolMessage');
        onProtocolMessageOriginal.call(this, msg);
      };

      const channelDetachPromise = channel.detach();

      expect(channel.state).to.equal('detaching');

      // When: The connection enters CLOSED
      const channelDetachedPromise = channel.whenState('detached');

      realtime.close();

      // Then: The channel transitions to DETACHED and the call to `detach()` succeeds
      await channelDetachedPromise;
      await channelDetachPromise;

      // Teardown
      await helper.closeAndFinishAsync(realtime);
    });

    /** @specpartial RTL3h - Tests the SUSPENDED case **/
    it('detaching_channel_when_connection_enters_suspended', async function () {
      // Given: A channel in the DETACHING state
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime({ transports: [helper.bestTransport] });
      const channel = realtime.channels.get('detached_channel_when_connection_enters_failed');

      await channel.attach();

      helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
      const transport = realtime.connection.connectionManager.activeProtocol.getTransport();
      const onProtocolMessageOriginal = transport.onProtocolMessage;

      helper.recordPrivateApi('replace.transport.onProtocolMessage');
      transport.onProtocolMessage = function (msg) {
        if (msg.action === 13) {
          // Drop the incoming DETACHED so that the channel stays in DETACHING
          return;
        }

        helper.recordPrivateApi('call.transport.onProtocolMessage');
        onProtocolMessageOriginal.call(this, msg);
      };

      const channelDetachPromise = channel.detach();

      expect(channel.state).to.equal('detaching');

      // When: The connection enters SUSPENDED
      const channelDetachedPromise = channel.whenState('detached');

      await new Promise((resolve) => {
        helper.becomeSuspended(realtime, resolve);
      });

      // Then: The channel transitions to DETACHED and the call to `detach()` succeeds
      await channelDetachedPromise;
      expect(channel.errorReason).to.be.null;
      await channelDetachPromise;

      // Teardown
      await helper.closeAndFinishAsync(realtime);
    });

    /** @spec RTL5i */
    it('attached_while_detaching', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ transports: [helper.bestTransport] }),
        channelName = 'server_sent_detached',
        channel = realtime.channels.get(channelName);

      async.series(
        [
          function (cb) {
            realtime.connection.once('connected', function () {
              cb();
            });
          },
          function (cb) {
            Helper.whenPromiseSettles(channel.attach(), cb);
          },
          function (cb) {
            /* Sabotage the detach attempt, detach, then simulate a server-sent attached while
             * the detach is ongoing. Expect to see the library reassert the detach */
            let detachCount = 0;
            helper.recordPrivateApi('replace.channel.send');
            channel.send = function (msg) {
              expect(msg.action).to.equal(12, 'Check we only see a detach. No attaches!');
              expect(channel.state).to.equal('detaching', 'Check still in detaching state after both detaches');
              detachCount++;
              if (detachCount === 2) {
                /* we got our second detach! */
                cb();
              }
            };
            channel.detach();
            setTimeout(function () {
              helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
              var transport = realtime.connection.connectionManager.activeProtocol.getTransport();
              helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
              helper.recordPrivateApi('call.transport.onProtocolMessage');
              transport.onProtocolMessage(createPM({ action: 11, channel: channelName }));
            }, 0);
          },
        ],
        function (err) {
          helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /** @spec RTL5j */
    it('detaching from suspended channel transitions channel to detached state', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime({ transports: [helper.bestTransport] });
      var channelName = 'detach_from_suspended';
      var channel = realtime.channels.get(channelName);

      channel.state = 'suspended';
      Helper.whenPromiseSettles(channel.detach(), function () {
        try {
          expect(channel.state).to.equal(
            'detached',
            'Check that detach on suspended channel results in detached channel',
          );

          helper.closeAndFinish(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });
    });

    /** @spec RTL5l */
    it('detaching when connection is not connected immediately transitions channel to detached', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime({ transports: [helper.bestTransport] });
      const channelName = 'detach_when_disconnected';
      const channel = realtime.channels.get(channelName);

      try {
        await realtime.connection.once('connected');
        await channel.attach();
        expect(channel.state).to.equal('attached', 'channel should be attached');

        // Simulate connection becoming disconnected
        realtime.connection.connectionManager.requestState({ state: 'disconnected' });
        await realtime.connection.once('disconnected');
        expect(realtime.connection.state).to.equal('disconnected', 'connection should be disconnected');

        // Detach should succeed immediately without waiting for reconnection
        await channel.detach();
        expect(channel.state).to.equal('detached', 'channel should immediately transition to detached');
      } finally {
        helper.closeAndFinish(helper.noop, realtime);
      }
    });

    /** @spec RTL5b */
    it('detaching from failed channel results in error', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime({ transports: [helper.bestTransport] });
      var channelName = 'detach_from_failed';
      var channel = realtime.channels.get(channelName);

      channel.state = 'failed';

      Helper.whenPromiseSettles(channel.detach(), function (err) {
        if (!err) {
          helper.closeAndFinish(done, realtime, new Error('expected detach to return error response'));
          return;
        }
        helper.closeAndFinish(done, realtime);
      });
    });

    /** @nospec */
    it('rewind works on channel after reattaching', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime({ transports: [helper.bestTransport] });
      var channelName = 'rewind_after_detach';
      var channel = realtime.channels.get(channelName);
      var channelOpts = { params: { rewind: '1' } };
      channel.setOptions(channelOpts);

      var subscriber = function (message) {
        expect(message.data).to.equal('message');
        channel.unsubscribe(subscriber);
        Helper.whenPromiseSettles(channel.detach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          channel.subscribe(function (message) {
            expect(message.data).to.equal('message');
            helper.closeAndFinish(done, realtime);
          });
        });
      };

      channel.publish('event', 'message');

      channel.subscribe(subscriber);
    });

    /** @spec RTL4d1 */
    it('attach_returns_state_change', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime();
      var channelName = 'attach_returns_state_chnage';
      var channel = realtime.channels.get(channelName);
      Helper.whenPromiseSettles(channel.attach(), function (err, stateChange) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        try {
          expect(stateChange.current).to.equal('attached');
          expect(stateChange.previous).to.equal('attaching');
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        // for an already-attached channel, null is returned
        Helper.whenPromiseSettles(channel.attach(), function (err, stateChange) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          try {
            expect(stateChange).to.equal(null);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });
    });

    /** @spec RTL7c */
    it('subscribe_returns_state_change', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime();
      var channelName = 'subscribe_returns_state_chnage';
      var channel = realtime.channels.get(channelName);
      Helper.whenPromiseSettles(
        channel.subscribe(
          function () {}, // message listener
        ),
        function (err, stateChange) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          try {
            expect(stateChange.current).to.equal('attached');
            expect(stateChange.previous).to.equal('attaching');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        },
      );
    });

    /** @specpartial RTL2i - hasBacklog is false with no backlog */
    it('rewind_has_backlog_0', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime();
      var channelName = 'rewind_has_backlog_0';
      var channelOpts = { params: { rewind: '1' } };
      var channel = realtime.channels.get(channelName, channelOpts);

      // attach with rewind but no channel history - hasBacklog should be false
      Helper.whenPromiseSettles(channel.attach(), function (err, stateChange) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        try {
          expect(!stateChange.hasBacklog).to.be.ok;
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        helper.closeAndFinish(done, realtime);
      });
    });

    /** @specpartial RTL2i - hasBacklog is true with backlog */
    it('rewind_has_backlog_1', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime();
      var rest = helper.AblyRest();
      var channelName = 'rewind_has_backlog_1';
      var channelOpts = { params: { rewind: '1' } };
      var rtChannel = realtime.channels.get(channelName, channelOpts);
      var restChannel = rest.channels.get(channelName);

      // attach with rewind after publishing - hasBacklog should be true
      Helper.whenPromiseSettles(restChannel.publish('foo', 'bar'), function (err) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        Helper.whenPromiseSettles(rtChannel.attach(), function (err, stateChange) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          try {
            expect(stateChange.hasBacklog).to.be.ok;
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });
    });

    /** @spec RTS3c1 - test .get() with same options should not trigger reattachment and exception */
    it('should not throw exception then run RealtimeChannels.get() with same options', function (done) {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();
      const channel = realtime.channels.get('channel-with-options', { modes: ['PRESENCE'] });
      channel.attach();
      Helper.whenPromiseSettles(channel.whenState('attaching'), function () {
        try {
          realtime.channels.get('channel-with-options', { modes: ['PRESENCE'] });
          helper.closeAndFinish(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });
    });

    /**
     * @spec RTL25a
     * @spec RTL25b
     */
    it('whenState', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      await helper.monitorConnectionAsync(async () => {
        const channel = realtime.channels.get('channel');

        // RTL25a - when already in given state, returns null
        const initializedStateChange = await channel.whenState('initialized');
        expect(initializedStateChange).to.be.null;

        // RTL25b — when not in given state, calls #once
        const attachedStateChangePromise = channel.whenState('attached');
        channel.attach();
        const attachedStateChange = await attachedStateChangePromise;
        expect(attachedStateChange).not.to.be.null;
        expect(attachedStateChange.previous).to.equal('attaching');
        expect(attachedStateChange.current).to.equal('attached');
      }, realtime);

      await helper.closeAndFinishAsync(realtime);
    });

    /** @spec RTL4c1 */
    it('set channelSerial field for ATTACH ProtocolMessage if available', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      await helper.monitorConnectionAsync(async () => {
        const channel = realtime.channels.get('set_channelSerial_on_attach');
        await realtime.connection.once('connected');
        await channel.attach();

        // Publish a message to get the channelSerial from it
        const messageReceivedPromise = new Promise((resolve, reject) => {
          helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
          const transport = realtime.connection.connectionManager.activeProtocol.getTransport();
          const onProtocolMessageOriginal = transport.onProtocolMessage;

          helper.recordPrivateApi('replace.transport.onProtocolMessage');
          transport.onProtocolMessage = function (msg) {
            if (msg.action === 15) {
              // MESSAGE
              resolve(msg);
            }

            helper.recordPrivateApi('call.transport.onProtocolMessage');
            onProtocolMessageOriginal.call(this, msg);
          };
        });
        await channel.publish('event', 'test');

        const receivedMessage = await messageReceivedPromise;
        helper.recordPrivateApi('read.ProtocolMessage.channelSerial');
        const receivedChannelSerial = receivedMessage.channelSerial;

        // After the disconnect, on reconnect, spy on transport.send to check sent channelSerial
        const promiseCheck = new Promise((resolve, reject) => {
          helper.recordPrivateApi('listen.connectionManager.transport.pending');
          realtime.connection.connectionManager.once('transport.pending', function (transport) {
            helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
            const sendOriginal = transport.send;

            helper.recordPrivateApi('replace.transport.send');
            transport.send = function (msg) {
              if (msg.action === 10) {
                // ATTACH
                try {
                  helper.recordPrivateApi('read.ProtocolMessage.channelSerial');
                  expect(msg.channelSerial).to.equal(receivedChannelSerial);
                  resolve();
                } catch (error) {
                  reject(error);
                }
              }

              helper.recordPrivateApi('call.transport.send');
              sendOriginal.call(this, msg);
            };
          });
        });

        // Disconnect the transport (will automatically reconnect and resume)
        helper.recordPrivateApi('call.connectionManager.disconnectAllTransports');
        realtime.connection.connectionManager.disconnectAllTransports();

        await promiseCheck;
      }, realtime);

      await helper.closeAndFinishAsync(realtime);
    });

    /** @spec RTL15b */
    it('channel.properties.channelSerial is updated with channelSerial from latest message', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime({ clientId: 'me' });

      await helper.monitorConnectionAsync(async () => {
        const channel = realtime.channels.get('update_channelSerial_on_message');
        await realtime.connection.once('connected');

        helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
        const messagesToUpdateChannelSerial = [
          createPM({
            action: 11, // ATTACHED
            channel: channel.name,
            channelSerial: 'ATTACHED',
          }),
          createPM({
            action: 15, // MESSAGE
            channel: channel.name,
            channelSerial: 'MESSAGE',
            messages: [{ name: 'foo', data: 'bar' }],
          }),
          createPM({
            action: 14, // PRESENCE
            channel: channel.name,
            channelSerial: 'PRESENCE',
          }),
          createPM({
            action: 19, // OBJECT
            channel: channel.name,
            channelSerial: 'OBJECT',
          }),
          createPM({
            action: 21, // ANNOTATION
            channel: channel.name,
            channelSerial: 'ANNOTATION',
          }),
        ];

        helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
        const transport = realtime.connection.connectionManager.activeProtocol.getTransport();

        for (const msg of messagesToUpdateChannelSerial) {
          helper.recordPrivateApi('call.transport.onProtocolMessage');
          transport.onProtocolMessage(msg);

          // wait until next event loop so any async ops get resolved and channel serial gets updated on a channel
          await new Promise((res) => setTimeout(res, 0));
          helper.recordPrivateApi('read.channel.properties.channelSerial');
          helper.recordPrivateApi('read.ProtocolMessage.channelSerial');
          expect(channel.properties.channelSerial).to.equal(msg.channelSerial);
        }
      }, realtime);

      await helper.closeAndFinishAsync(realtime);
    });

    /**
     * Regression test: calling channel.off() while attaching should not
     * prevent the attach() promise from resolving.
     *
     * @specpartial RTC10
     */
    it('attach resolves even if channel.off() is called while attaching', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
        const channel = realtime.channels.get('attach_off_regression');

        const attachPromise = channel.attach();
        expect(channel.state).to.equal('attaching');
        channel.off();

        await attachPromise;
      }, realtime);
    });

    /**
     * Regression test: calling channel.off() while detaching should not
     * prevent the detach() promise from resolving.
     *
     * @specpartial RTC10
     */
    it('detach resolves even if channel.off() is called while detaching', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
        const channel = realtime.channels.get('detach_off_regression');

        await channel.attach();

        const detachPromise = channel.detach();
        expect(channel.state).to.equal('detaching');
        channel.off();

        await detachPromise;
      }, realtime);
    });

    describe('subscribe() without subscribe mode', function () {
      /**
       * Subscribe on a channel attached without the subscribe mode, with strictMode enabled.
       * The listener must remain registered despite the failure, so once the mode is granted
       * via setOptions it receives messages without a further subscribe call.
       *
       * @spec RTL7i1
       */
      it('with strictMode:true, attach resolves but subscribe rejects with 90009 and a subscribe-mode remediation', async function () {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime({ strictMode: true });
        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = realtime.channels.get('subscribe-without-mode-strict-' + String(Math.random()).slice(2), {
            modes: ['publish'],
          });
          let resolveReceived;
          const received = new Promise(function (resolve) {
            resolveReceived = resolve;
          });
          let caught;
          try {
            await channel.subscribe(function (msg) {
              resolveReceived(msg);
            });
          } catch (err) {
            caught = err;
          }
          expect(caught, 'expected channel.subscribe() to reject').to.exist;
          expect(caught.code).to.equal(90009);
          expect(caught.statusCode).to.equal(400);
          expect(caught.message).to.contain('subscribe mode');
          expect(caught.remediation).to.be.a('string');
          expect(caught.remediation).to.contain('subscribe');
          expect(caught.remediation).to.contain('ably auth keys list');
          // the listener registered by the failed subscribe must survive: grant the mode and
          // the message should arrive without a further subscribe call
          await channel.setOptions({ modes: ['subscribe', 'publish'] });
          await channel.publish('event', 'data');
          const msg = await received;
          expect(msg.data).to.equal('data');
        }, realtime);
      });

      /**
       * Subscribe on a channel attached without the subscribe mode, with strictMode off (default).
       * The call succeeds, a warning naming strictMode is logged, and the warning is not
       * repeated on a subsequent subscribe on the same attachment.
       *
       * @spec RTL7i2
       */
      it('with strictMode disabled (default), subscribe resolves and logs a warning once per attachment', async function () {
        const helper = this.test.helper;
        const warnings = [];
        const realtime = helper.AblyRealtime({
          logLevel: 1,
          logHandler: function (msg) {
            if (msg.indexOf('RealtimeChannel.subscribe()') !== -1) {
              warnings.push(msg);
            }
          },
        });
        await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
          const channel = realtime.channels.get('subscribe-without-mode-silent-' + String(Math.random()).slice(2), {
            modes: ['publish'],
          });
          const result = await channel.subscribe(function () {});
          // attach resolves (ChannelStateChange or null) without throwing; the listener is harmless because the server will never deliver
          expect(result === null || (result && typeof result === 'object')).to.equal(true);
          expect(channel.state).to.equal('attached');
          expect(warnings.length).to.equal(1);
          expect(warnings[0]).to.contain('subscribe mode');
          expect(warnings[0]).to.contain('strictMode');
          // a second subscribe on the same attachment must not log again
          await channel.subscribe(function () {});
          expect(warnings.length).to.equal(1);
        }, realtime);
      });
    });
  });
});
