'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var expect = chai.expect;
  var createPM = Ably.makeProtocolMessageFromDeserialized();

  describe('realtime/connection', function () {
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

    /** @spec RTN13 */
    it('connectionPing', function (done) {
      const helper = this.test.helper;
      var realtime;
      try {
        realtime = helper.AblyRealtime();
        realtime.connection.on('connected', function () {
          try {
            realtime.connection.ping();
            helper.closeAndFinish(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /** @specpartial RTN13a - callback is called with response time */
    it('connectionPingWithCallback', function (done) {
      const helper = this.test.helper;
      var realtime;
      try {
        realtime = helper.AblyRealtime();
        realtime.connection.on('connected', function () {
          Helper.whenPromiseSettles(realtime.connection.ping(), function (err, responseTime) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            try {
              expect(typeof responseTime).to.equal('number', 'check that a responseTime returned');
              expect(responseTime > 0, 'check that responseTime was +ve').to.be.ok;
              helper.closeAndFinish(done, realtime);
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
     * @spec RTN16g2
     * @specpartial RTN16g - connectionKey, the current msgSerial
     */
    it('connectionAttributes', function (done) {
      const helper = this.test.helper;
      var realtime;
      try {
        realtime = helper.AblyRealtime();
        realtime.connection.on('connected', function () {
          try {
            helper.recordPrivateApi('deserialize.recoveryKey');
            const recoveryContext = JSON.parse(realtime.connection.recoveryKey);
            expect(recoveryContext.connectionKey).to.equal(realtime.connection.key);
            helper.recordPrivateApi('read.connectionManager.msgSerial');
            expect(recoveryContext.msgSerial).to.equal(realtime.connection.connectionManager.msgSerial);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          var channel = realtime.channels.get('connectionattributes');
          Helper.whenPromiseSettles(channel.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            async.parallel(
              [
                function (cb) {
                  channel.subscribe(function () {
                    setTimeout(function () {
                      helper.recordPrivateApi('deserialize.recoveryKey');
                      const recoveryContext = JSON.parse(realtime.connection.recoveryKey);
                      expect(recoveryContext.connectionKey).to.equal(realtime.connection.key);
                      helper.recordPrivateApi('read.connectionManager.msgSerial');
                      expect(recoveryContext.msgSerial).to.equal(realtime.connection.connectionManager.msgSerial);
                      cb();
                    }, 0);
                  });
                },
                function (cb) {
                  Helper.whenPromiseSettles(channel.publish('name', 'data'), cb);
                },
              ],
              function (err) {
                if (err) {
                  helper.closeAndFinish(done, realtime, err);
                  return;
                }
                realtime.connection.close();
                Helper.whenPromiseSettles(realtime.connection.whenState('closed'), function () {
                  try {
                    expect(realtime.connection.recoveryKey).to.equal(null, 'verify recovery key null after close');
                    helper.closeAndFinish(done, realtime);
                  } catch (err) {
                    helper.closeAndFinish(done, realtime, err);
                  }
                });
              },
            );
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /** @spec RTN15c7 */
    it('unrecoverableConnection', function (done) {
      const helper = this.test.helper;
      var realtime;
      helper.recordPrivateApi('serialize.recoveryKey');
      const fakeRecoveryKey = JSON.stringify({
        connectionKey: '_____!ablyjs_test_fake-key____',
        msgSerial: 3,
        channelSerials: {},
      });
      try {
        realtime = helper.AblyRealtime({ recover: fakeRecoveryKey });
        realtime.connection.on('connected', function (stateChange) {
          try {
            expect(stateChange.reason.code).to.equal(
              80018,
              'verify unrecoverable-connection error set in stateChange.reason',
            );
            expect(realtime.connection.errorReason.code).to.equal(
              80018,
              'verify unrecoverable-connection error set in connection.errorReason',
            );
            helper.recordPrivateApi('read.connectionManager.msgSerial');
            expect(realtime.connection.connectionManager.msgSerial).to.equal(
              0,
              'verify msgSerial is 0 (new connection), not 3',
            );
            expect(realtime.connection.key.indexOf('ablyjs_test_fake')).to.equal(
              -1,
              'verify connection using a new connectionkey',
            );
            helper.closeAndFinish(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        });
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Check that a message published on one transport that has not yet been
     * acked will be republished with the same msgSerial on a new transport (eg
     * after a resume), before any new messages are send (and
     * without being merged with new messages)
     *
     * @spec RTN7b
     * @spec RTN19a
     * @spec RTN19a2
     */
    it('connectionQueuing', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ transports: [helper.bestTransport] }),
        channel = realtime.channels.get('connectionQueuing'),
        connectionManager = realtime.connection.connectionManager;

      realtime.connection.once('connected', function () {
        helper.recordPrivateApi('read.connectionManager.activeProtocol.transport');
        var transport = connectionManager.activeProtocol.transport;
        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }

          let transportSendCallback;

          helper.recordPrivateApi('replace.transport.send');
          /* Sabotage sending the message */
          transport.send = function (msg) {
            if (msg.action == 15) {
              expect(msg.msgSerial).to.equal(0, 'Expect msgSerial to be 0');

              if (!transportSendCallback) {
                done(new Error('transport.send override called before transportSendCallback populated'));
              }

              transportSendCallback(null);
            }
          };

          let publishCallback;

          async.series(
            [
              function (cb) {
                transportSendCallback = cb;

                /* Sabotaged publish */
                Helper.whenPromiseSettles(channel.publish('first', null), function (err) {
                  if (!publishCallback) {
                    done(new Error('publish completed before publishCallback populated'));
                  }
                  publishCallback(err);
                });
              },

              // We wait for transport.send to recieve the message that we just
              // published before we proceed to disconnecting the transport, to
              // make sure that the message got marked as `sendAttempted`.

              function (cb) {
                async.parallel(
                  [
                    function (cb) {
                      publishCallback = function (err) {
                        try {
                          expect(!err, 'Check publish happened (eventually) without err').to.be.ok;
                        } catch (err) {
                          cb(err);
                          return;
                        }
                        cb();
                      };
                    },
                    function (cb) {
                      /* After the disconnect, on reconnect, spy on transport.send again */
                      helper.recordPrivateApi('listen.connectionManager.transport.pending');
                      connectionManager.once('transport.pending', function (transport) {
                        var oldSend = transport.send;

                        helper.recordPrivateApi('replace.transport.send');
                        transport.send = function (msg, msgCb) {
                          if (msg.action === 15) {
                            if (msg.messages[0].name === 'first') {
                              try {
                                expect(msg.msgSerial).to.equal(0, 'Expect msgSerial of original message to still be 0');
                                expect(msg.messages.length).to.equal(
                                  1,
                                  'Expect second message to not have been merged with the attempted message',
                                );
                              } catch (err) {
                                cb(err);
                                return;
                              }
                            } else if (msg.messages[0].name === 'second') {
                              try {
                                expect(msg.msgSerial).to.equal(1, 'Expect msgSerial of new message to be 1');
                              } catch (err) {
                                cb(err);
                                return;
                              }
                              cb();
                            }
                          }
                          helper.recordPrivateApi('call.transport.send');
                          oldSend.call(transport, msg, msgCb);
                        };
                        channel.publish('second', null);
                      });

                      /* Disconnect the transport (will automatically reconnect and resume) () */
                      helper.recordPrivateApi('call.connectionManager.disconnectAllTransports');
                      connectionManager.disconnectAllTransports();
                    },
                  ],
                  cb,
                );
              },
            ],
            function (err) {
              helper.closeAndFinish(done, realtime, err);
            },
          );
        });
      });
    });

    /**
     * Inject a new CONNECTED with different connectionDetails; check they're used
     *
     * @spec CD1
     * @spec RTN21
     * @specpartial DF1a - can be overridden by CONNECTED ProtocolMessage
     * @specpartial TO3l8 - default can be overridden by the maxMessageSize in the connectionDetails
     */
    it('connectionDetails', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime(),
        connectionManager = realtime.connection.connectionManager;
      realtime.connection.once('connected', function () {
        helper.recordPrivateApi('listen.connectionManager.connectiondetails');
        connectionManager.once('connectiondetails', function (details) {
          try {
            expect(details.connectionStateTtl).to.equal(12345, 'Check connectionStateTtl in event');
            helper.recordPrivateApi('read.connectionManager.connectionStateTtl');
            expect(connectionManager.connectionStateTtl).to.equal(
              12345,
              'Check connectionStateTtl set in connectionManager',
            );
            expect(details.clientId).to.equal('foo', 'Check clientId in event');
            expect(realtime.auth.clientId).to.equal('foo', 'Check clientId set in auth');
            helper.recordPrivateApi('read.realtime.options.maxMessageSize');
            expect(realtime.options.maxMessageSize).to.equal(98765, 'Check maxMessageSize set');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
        helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
        helper.recordPrivateApi('call.transport.onProtocolMessage');
        helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
        connectionManager.activeProtocol.getTransport().onProtocolMessage(
          createPM({
            action: 4,
            connectionId: 'a',
            connectionKey: 'ab',
            connectionSerial: -1,
            connectionDetails: {
              clientId: 'foo',
              maxMessageSize: 98765,
              connectionStateTtl: 12345,
            },
          }),
        );
      });
      helper.monitorConnection(done, realtime);
    });

    /**
     * @spec RTN26a
     * @spec RTN26b
     */
    it('whenState', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime({ autoConnect: false });

      await helper.monitorConnectionAsync(async () => {
        // RTN26a - when already in given state, returns null
        const initializedStateChange = await realtime.connection.whenState('initialized');
        expect(initializedStateChange).to.be.null;

        // RTN26b — when not in given state, calls #once
        const connectedStateChangePromise = realtime.connection.whenState('connected');
        realtime.connection.connect();
        const connectedStateChange = await connectedStateChangePromise;
        expect(connectedStateChange).not.to.be.null;
        expect(connectedStateChange.previous).to.equal('connecting');
        expect(connectedStateChange.current).to.equal('connected');
      }, realtime);

      await helper.closeAndFinishAsync(realtime);
    });

    /**
     * v1-style trailing-callback shape on Connection.ping throws synchronously
     * with a steering ErrorInfo.
     */
    it('v1_callback_ping_throws_synchronously', function (done) {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime({ autoConnect: false });
      try {
        realtime.connection.ping(function noopCallback(err) {
          void err;
        });
        helper.closeAndFinish(done, realtime, new Error('expected ping() to throw on v1 callback shape'));
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
});
