'use strict';

define(['shared_helper', 'async', 'chai'], function (Helper, async, chai) {
  var expect = chai.expect;

  describe('realtime/resume', function () {
    this.timeout(120 * 1000);

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

    function mixin(target, src) {
      for (var prop in src) target[prop] = src[prop];
      return target;
    }

    function sendAndAwait(message, sendingChannel, receivingChannel, callback) {
      var event = String(Math.random());
      receivingChannel.subscribe(event, function (msg) {
        receivingChannel.unsubscribe(event);
        callback();
      });
      Helper.whenPromiseSettles(sendingChannel.publish(event, message), function (err) {
        if (err) callback(err);
      });
    }

    /**
     * Empty resume case
     * Send 5 messages; disconnect; reconnect; send 5 messages
     */
    function resume_inactive(done, helper, channelName, txOpts, rxOpts) {
      var count = 5;

      var txRest = helper.AblyRest(mixin(txOpts));
      var rxRealtime = helper.AblyRealtime(mixin(rxOpts));

      var rxChannel = rxRealtime.channels.get(channelName);
      var txChannel = txRest.channels.get(channelName);
      var rxCount = 0;

      function phase0(callback) {
        Helper.whenPromiseSettles(rxChannel.attach(), callback);
      }

      function phase1(callback) {
        function ph1TxOnce() {
          sendAndAwait('phase 1, message ' + rxCount, txChannel, rxChannel, function (err) {
            if (err) callback(err);
            if (++rxCount == count) {
              callback(null);
              return;
            }
            setTimeout(ph1TxOnce, 800);
          });
        }
        ph1TxOnce();
      }

      function phase2(callback) {
        helper.simulateDroppedConnection(rxRealtime);
        /* continue in 5 seconds */
        setTimeout(callback, 5000);
      }

      function phase3(callback) {
        /* re-open the connection, verify resume mode */
        rxRealtime.connection.connect();
        var connectionManager = rxRealtime.connection.connectionManager;
        helper.recordPrivateApi('listen.connectionManager.transport.active');
        connectionManager.once('transport.active', function (transport) {
          try {
            helper.recordPrivateApi('read.transport.params.mode');
            expect(transport.params.mode).to.equal('resume', 'Verify reconnect is resume mode');
          } catch (err) {
            callback(err);
            return;
          }
          callback(null);
        });
      }

      function phase4(callback) {
        rxCount = 0;
        function ph4TxOnce() {
          sendAndAwait('phase 4, message ' + rxCount, txChannel, rxChannel, function (err) {
            if (err) callback(err);
            if (++rxCount == count) {
              callback(null);
              return;
            }
            setTimeout(ph4TxOnce, 800);
          });
        }
        ph4TxOnce();
      }

      phase0(function (err) {
        if (err) {
          helper.closeAndFinish(done, rxRealtime, err);
          return;
        }
        phase1(function (err) {
          if (err) {
            helper.closeAndFinish(done, rxRealtime, err);
            return;
          }
          phase2(function (err) {
            if (err) {
              helper.closeAndFinish(done, rxRealtime, err);
              return;
            }
            phase3(function (err) {
              if (err) {
                helper.closeAndFinish(done, rxRealtime, err);
                return;
              }
              phase4(function (err) {
                if (err) {
                  helper.closeAndFinish(done, rxRealtime, err);
                  return;
                }
                helper.closeAndFinish(done, rxRealtime);
              });
            });
          });
        });
      });
    }

    /**
     * Related to RTN15b, RTN15c.
     * @nospec
     */
    Helper.testOnAllTransportsAndProtocols(this, 'resume_inactive', function (realtimeOpts) {
      return function (done) {
        resume_inactive(done, this.test.helper, 'resume_inactive' + String(Math.random()), {}, realtimeOpts);
      };
    });

    /**
     * Simple resume case
     * Send 5 messages; disconnect; send 5 messages; reconnect
     */
    function resume_active(done, helper, channelName, txOpts, rxOpts) {
      var count = 5;

      var txRest = helper.AblyRest(mixin(txOpts));
      var rxRealtime = helper.AblyRealtime(mixin(rxOpts));

      var rxChannel = rxRealtime.channels.get(channelName);
      var txChannel = txRest.channels.get(channelName);
      var rxCount = 0;

      function phase0(callback) {
        Helper.whenPromiseSettles(rxChannel.attach(), callback);
      }

      function phase1(callback) {
        function ph1TxOnce() {
          sendAndAwait('phase 1, message ' + rxCount, txChannel, rxChannel, function (err) {
            if (err) callback(err);
            if (++rxCount == count) {
              callback(null);
              return;
            }
            setTimeout(ph1TxOnce, 800);
          });
        }
        ph1TxOnce();
      }

      function phase2(callback) {
        /* disconnect the transport and send 5 more messages
         * NOTE: this uses knowledge of the internal operation
         * of the client library to simulate a dropped connection
         * without explicitly closing the connection */
        helper.simulateDroppedConnection(rxRealtime);
        var txCount = 0;

        function ph2TxOnce() {
          Helper.whenPromiseSettles(
            txChannel.publish('sentWhileDisconnected', 'phase 2, message ' + txCount),
            function (err) {
              if (err) callback(err);
            },
          );
          if (++txCount == count) {
            /* sent all messages */
            setTimeout(function () {
              callback(null);
            }, 1000);
            return;
          }
          setTimeout(ph2TxOnce, 1000);
        }

        setTimeout(ph2TxOnce, 800);
      }

      function phase3(callback) {
        /* subscribe, re-open the connection, verify resume mode */
        rxChannel.subscribe('sentWhileDisconnected', function (msg) {
          ++rxCount;
        });
        rxCount = 0;
        rxRealtime.connection.connect();
        var connectionManager = rxRealtime.connection.connectionManager;
        helper.recordPrivateApi('listen.connectionManager.transport.active');
        connectionManager.on('transport.active', function (transport) {
          try {
            helper.recordPrivateApi('read.transport.params.mode');
            expect(transport.params.mode).to.equal('resume', 'Verify reconnect is resume mode');
          } catch (err) {
            callback(err);
            return;
          }
          setTimeout(function () {
            try {
              expect(rxCount).to.equal(count, 'Verify Phase 3 messages all received');
            } catch (err) {
              callback(err);
              return;
            }
            callback(null);
          }, 2000);
        });
      }

      phase0(function (err) {
        if (err) {
          helper.closeAndFinish(done, rxRealtime, err);
          return;
        }
        phase1(function (err) {
          if (err) {
            helper.closeAndFinish(done, rxRealtime, err);
            return;
          }
          phase2(function (err) {
            if (err) {
              helper.closeAndFinish(done, rxRealtime, err);
              return;
            }
            phase3(function (err) {
              if (err) {
                helper.closeAndFinish(done, rxRealtime, err);
                return;
              }
              helper.closeAndFinish(done, rxRealtime);
            });
          });
        });
      });
    }

    /**
     * Related to RTN15b, RTN15c.
     * @nospec
     */
    Helper.testOnAllTransportsAndProtocols(this, 'resume_active', function (realtimeOpts) {
      return function (done) {
        resume_active(done, this.test.helper, 'resume_active' + String(Math.random()), {}, realtimeOpts);
      };
    });

    /**
     * Resume with loss of continuity
     * @spec RTN15c7
     */
    Helper.testOnAllTransportsAndProtocols(
      this,
      'resume_lost_continuity',
      function (realtimeOpts) {
        return function (done) {
          var helper = this.test.helper,
            realtime = helper.AblyRealtime(realtimeOpts),
            connection = realtime.connection,
            attachedChannelName = 'resume_lost_continuity_attached',
            suspendedChannelName = 'resume_lost_continuity_suspended',
            attachedChannel = realtime.channels.get(attachedChannelName),
            suspendedChannel = realtime.channels.get(suspendedChannelName);

          async.series(
            [
              function (cb) {
                connection.once('connected', function () {
                  cb();
                });
              },
              function (cb) {
                helper.recordPrivateApi('write.channel.state');
                suspendedChannel.state = 'suspended';
                Helper.whenPromiseSettles(attachedChannel.attach(), cb);
              },
              function (cb) {
                /* Sabotage the resume */
                helper.recordPrivateApi('write.connectionManager.connectionKey');
                helper.recordPrivateApi('write.connectionManager.connectionId');
                helper.recordPrivateApi('write.connectionManager.msgSerial')(
                  (connection.connectionManager.connectionKey = '_____!ablyjs_test_fake-key____'),
                ),
                  (connection.connectionManager.connectionId = 'ablyjs_tes');
                connection.connectionManager.msgSerial = 15;
                connection.once('disconnected', function () {
                  cb();
                });
                helper.recordPrivateApi('call.connectionManager.disconnectAllTransports');
                connection.connectionManager.disconnectAllTransports();
              },
              function (cb) {
                connection.once('connected', function (stateChange) {
                  try {
                    expect(stateChange.reason && stateChange.reason.code).to.equal(
                      80018,
                      'Unable to recover connection correctly set in the stateChange',
                    );
                    expect(attachedChannel.state).to.equal('attaching', 'Attached channel went into attaching');
                    expect(suspendedChannel.state).to.equal('attaching', 'Suspended channel went into attaching');
                    helper.recordPrivateApi('read.connectionManager.msgSerial');
                    expect(connection.connectionManager.msgSerial).to.equal(0, 'Check msgSerial is reset to 0');
                    helper.recordPrivateApi('read.connectionManager.connectionId');
                    expect(
                      connection.connectionManager.connectionId !== 'ablyjs_tes',
                      'Check connectionId is set by the new CONNECTED',
                    ).to.be.ok;
                  } catch (err) {
                    cb(err);
                    return;
                  }
                  cb();
                });
              },
            ],
            function (err) {
              helper.closeAndFinish(done, realtime, err);
            },
          );
        };
      },
      true /* Use a fixed transport as attaches are resent when the transport changes */,
    );

    /**
     * Resume with token error
     * @spec RTN15c5
     */
    Helper.testOnAllTransportsAndProtocols(
      this,
      'resume_token_error',
      function (realtimeOpts) {
        return function (done) {
          var helper = this.test.helper,
            realtime = helper.AblyRealtime(mixin(realtimeOpts, { useTokenAuth: true })),
            badtoken,
            connection = realtime.connection;

          async.series(
            [
              function (cb) {
                connection.once('connected', function () {
                  cb();
                });
              },
              function (cb) {
                Helper.whenPromiseSettles(realtime.auth.requestToken({ ttl: 1 }, null), function (err, token) {
                  badtoken = token;
                  cb(err);
                });
              },
              function (cb) {
                /* Sabotage the resume - use a valid but now-expired token */
                helper.recordPrivateApi('write.auth.tokenDetails.token');
                realtime.auth.tokenDetails.token = badtoken.token;
                connection.once(function (stateChange) {
                  try {
                    expect(stateChange.current, 'disconnected', 'check connection disconnects first').to.be.ok;
                  } catch (err) {
                    cb(err);
                    return;
                  }
                  cb();
                });
                helper.recordPrivateApi('call.connectionManager.disconnectAllTransports');
                connection.connectionManager.disconnectAllTransports();
              },
              function (cb) {
                connection.once('connected', function (stateChange) {
                  cb();
                });
              },
            ],
            function (err) {
              helper.closeAndFinish(done, realtime, err);
            },
          );
        };
      },
      true,
    );

    /**
     * Resume with fatal error
     * @spec RTN15c4
     */
    Helper.testOnAllTransportsAndProtocols(
      this,
      'resume_fatal_error',
      function (realtimeOpts) {
        return function (done) {
          var helper = this.test.helper,
            realtime = helper.AblyRealtime(realtimeOpts),
            connection = realtime.connection;

          async.series(
            [
              function (cb) {
                connection.once('connected', function () {
                  cb();
                });
              },
              function (cb) {
                helper.recordPrivateApi('read.auth.key');
                var keyName = realtime.auth.key.split(':')[0];
                helper.recordPrivateApi('write.auth.key');
                realtime.auth.key = keyName + ':wrong';
                connection.once(function (stateChange) {
                  try {
                    expect(stateChange.current, 'disconnected', 'check connection disconnects first').to.be.ok;
                  } catch (err) {
                    cb(err);
                    return;
                  }
                  cb();
                });
                helper.recordPrivateApi('call.connectionManager.disconnectAllTransports');

                connection.connectionManager.disconnectAllTransports();
              },
              function (cb) {
                connection.once('failed', function (stateChange) {
                  try {
                    expect(stateChange.reason.code).to.equal(40101, 'check correct code propogated');
                  } catch (err) {
                    cb(err);
                    return;
                  }
                  cb();
                });
              },
            ],
            function (err) {
              helper.closeAndFinish(done, realtime, err);
            },
          );
        };
      },
      true,
    );

    /**
     * Check channel resumed flag
     * TODO: enable once realtime supports this
     *
     * @spec RTL2f
     */
    it('channel_resumed_flag', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ transports: [helper.bestTransport] }),
        realtimeTwo,
        recoveryKey,
        connection = realtime.connection,
        channelName = 'channel_resumed_flag',
        channel = realtime.channels.get(channelName);

      async.series(
        [
          function (cb) {
            connection.once('connected', function () {
              cb();
            });
          },
          function (cb) {
            channel.attach();
            channel.once('attached', function (stateChange) {
              try {
                expect(stateChange.resumed).to.equal(false, 'Check channel not resumed when first attached');
              } catch (err) {
                cb(err);
                return;
              }
              recoveryKey = connection.recoveryKey;
              cb();
            });
          },
          function (cb) {
            helper.becomeSuspended(realtime, cb);
          },
          function (cb) {
            realtimeTwo = helper.AblyRealtime({ recover: recoveryKey });
            realtimeTwo.connection.once('connected', function (stateChange) {
              if (stateChange.reason) {
                cb(stateChange.reason);
                return;
              }
              cb();
            });
          },
          function (cb) {
            var channelTwo = realtimeTwo.channels.get(channelName);
            channelTwo.attach();
            channelTwo.once('attached', function (stateChange) {
              try {
                expect(stateChange.resumed).to.equal(true, 'Check resumed flag is true');
              } catch (err) {
                cb(err);
                return;
              }
              cb();
            });
          },
        ],
        function (err) {
          helper.closeAndFinish(done, [realtime, realtimeTwo], err);
        },
      );
    });

    /**
     * As of spec version 6.1.0 (RTN14h, replacing RTN15g) the library always
     * attempts to resume on reconnection, regardless of how long it has been
     * disconnected, and lets the server decide whether continuity is possible.
     * Check that a reconnection out of the SUSPENDED state still attempts a
     * resume rather than starting a fresh (clean) connection.
     *
     * @spec RTN14h
     */
    it('resume_after_suspended', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime(),
        connection = realtime.connection;

      async.series(
        [
          function (cb) {
            connection.once('connected', function () {
              cb();
            });
          },
          function (cb) {
            helper.becomeSuspended(realtime, cb);
          },
          function (cb) {
            helper.recordPrivateApi('replace.connectionManager.tryATransport');
            realtime.connection.connectionManager.tryATransport = function (transportParams) {
              try {
                expect(transportParams.mode).to.equal(
                  'resume',
                  'Check library still attempts to resume after being suspended',
                );
              } catch (err) {
                cb(err);
                return;
              }
              cb();
            };
            connection.connect();
          },
        ],
        function (err) {
          helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /** @spec RTL4j2 */
    it('resume_rewind_1', function (done) {
      const helper = this.test.helper;
      var testName = 'resume_rewind_1';
      var testMessage = { foo: 'bar', count: 1, status: 'active' };
      try {
        var sender_realtime = helper.AblyRealtime();
        var sender_channel = sender_realtime.channels.get(testName);

        sender_channel.subscribe(function (message) {
          var receiver_realtime = helper.AblyRealtime();
          var receiver_channel = receiver_realtime.channels.get(testName, { params: { rewind: 1 } });

          receiver_channel.subscribe(function (message) {
            try {
              expect(JSON.stringify(testMessage) === JSON.stringify(message.data), 'Check rewind message.data').to.be
                .ok;
            } catch (err) {
              helper.closeAndFinish(done, [sender_realtime, receiver_realtime], err);
              return;
            }

            var resumed_receiver_realtime = helper.AblyRealtime();
            var connectionManager = resumed_receiver_realtime.connection.connectionManager;

            helper.recordPrivateApi('replace.connectionManager.send');
            var sendOrig = connectionManager.send;
            connectionManager.send = function (msg, queueEvent, callback) {
              helper.recordPrivateApi('call.ProtocolMessage.setFlag');
              msg.setFlag('ATTACH_RESUME');
              helper.recordPrivateApi('call.connectionManager.send');
              sendOrig.call(connectionManager, msg, queueEvent, callback);
            };

            var resumed_receiver_channel = resumed_receiver_realtime.channels.get(testName, { params: { rewind: 1 } });

            resumed_receiver_channel.subscribe(function (message) {
              clearTimeout(success);
              helper.closeAndFinish(
                done,
                [sender_realtime, receiver_realtime, resumed_receiver_realtime],
                new Error('rewind message arrived on attach resume'),
              );
            });

            var success = setTimeout(function () {
              helper.closeAndFinish(done, [sender_realtime, receiver_realtime, resumed_receiver_realtime]);
            }, 7000);
          });
        });

        sender_realtime.connection.on('connected', function () {
          sender_channel.publish('0', testMessage);
        });
      } catch (err) {
        helper.closeAndFinish(done, [sender_realtime, receiver_realtime, resumed_receiver_realtime], err);
      }
    });

    /**
     * Tests recovering multiple channels only receives the expected messages.
     *
     * @spec RTN16d
     * @spec RTC1c
     * @spec RTN15a
     */
    it('recover multiple channels', function (done) {
      const helper = this.test.helper;
      const NUM_MSGS = 5;

      const txRest = helper.AblyRest();
      const rxRealtime = helper.AblyRealtime(
        {
          transports: [helper.bestTransport],
        },
        true,
      );

      const channelNames = Array(5)
        .fill()
        .map(() => String(Math.random()));
      const rxChannels = channelNames.map((name) => rxRealtime.channels.get(name));

      function attachChannels(callback) {
        async.each(rxChannels, (channel, cb) => Helper.whenPromiseSettles(channel.attach(), cb), callback);
      }

      function publishSubscribeWhileConnectedOnce(callback) {
        async.each(
          channelNames,
          (name, cb) => {
            const tx = txRest.channels.get(name);
            const rx = rxRealtime.channels.get(name);
            sendAndAwait(null, tx, rx, cb);
          },
          callback,
        );
      }

      function publishSubscribeWhileConnected(callback) {
        async.each(
          Array(NUM_MSGS).fill(0),
          (_, cb) => {
            publishSubscribeWhileConnectedOnce(cb);
          },
          callback,
        );
      }

      function publishSubscribeWhileDisconnectedOnce(callback) {
        async.each(
          channelNames,
          (name, cb) => {
            const tx = txRest.channels.get(name);
            Helper.whenPromiseSettles(tx.publish('sentWhileDisconnected', null), cb);
          },
          callback,
        );
      }

      function publishSubscribeWhileDisconnected(callback) {
        async.each(
          Array(NUM_MSGS).fill(0),
          (_, cb) => {
            publishSubscribeWhileDisconnectedOnce(cb);
          },
          callback,
        );
      }

      let rxRealtimeRecover;
      let rxRecoverChannels;

      function subscribeRecoveredMessages(callback) {
        async.each(
          rxRecoverChannels,
          (channel, cb) => {
            let recoveredCount = 0;
            channel.subscribe((msg) => {
              expect(msg.name).to.equal('sentWhileDisconnected');

              recoveredCount++;

              if (recoveredCount === NUM_MSGS) {
                cb();
              }
            });
          },
          callback,
        );
      }

      // Connection information from the original connection.
      let connectionId;
      let connectionKey;
      let recoveryKey;

      attachChannels(function (err) {
        if (err) {
          helper.closeAndFinish(done, rxRealtime, err);
          return;
        }

        publishSubscribeWhileConnected(function (err) {
          if (err) {
            helper.closeAndFinish(done, rxRealtime, err);
            return;
          }

          connectionId = rxRealtime.connection.id;
          connectionKey = rxRealtime.connection.key;
          recoveryKey = rxRealtime.connection.recoveryKey;

          publishSubscribeWhileDisconnected(function (err) {
            if (err) {
              helper.closeAndFinish(done, rxRealtime, err);
              return;
            }

            rxRealtimeRecover = helper.AblyRealtime({ recover: recoveryKey });
            rxRecoverChannels = channelNames.map((name) => rxRealtimeRecover.channels.get(name));

            subscribeRecoveredMessages(function (err) {
              if (err) {
                helper.closeAndFinish(done, [rxRealtime, rxRealtimeRecover], err);
                return;
              }

              // RTN16d: After recovery expect the connection ID to be the same but the
              // key should have updated.
              expect(rxRealtimeRecover.connection.id).to.equal(connectionId);
              expect(rxRealtimeRecover.connection.key).to.not.equal(connectionKey);

              helper.closeAndFinish(done, [rxRealtime, rxRealtimeRecover]);
            });
          });
        });
      });
    });
  });
});
