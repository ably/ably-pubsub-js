'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var expect = chai.expect;
  let config = Ably.Realtime.Platform.Config;
  var createPM = Ably.makeProtocolMessageFromDeserialized();
  var Message = Ably.Realtime.Message;

  var publishIntervalHelper = function (currentMessageNum, channel, dataFn, onPublish) {
    return function () {
      Helper.whenPromiseSettles(channel.publish('event0', dataFn()), function () {
        onPublish();
      });
    };
  };

  var publishAtIntervals = function (numMessages, channel, dataFn, onPublish) {
    for (var i = numMessages; i > 0; i--) {
      setTimeout(publishIntervalHelper(i, channel, dataFn, onPublish), 20 * i);
    }
  };

  describe('realtime/message', function () {
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
     * @spec RSL1b
     * @spec RTL7b
     */
    it('publishonce', function (done) {
      const helper = this.test.helper;
      try {
        /* set up realtime */
        var realtime = helper.AblyRealtime();
        var rest = helper.AblyRest();

        /* connect and attach */
        realtime.connection.on('connected', function () {
          var testMsg = 'Hello world';
          var rtChannel = realtime.channels.get('publishonce');
          Helper.whenPromiseSettles(rtChannel.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }

            /* subscribe to event */
            rtChannel.subscribe('event0', function (msg) {
              try {
                expect(msg.data).to.equal(testMsg, 'Unexpected msg text received');
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              helper.closeAndFinish(done, realtime);
            });

            /* publish event */
            var restChannel = rest.channels.get('publishonce');
            restChannel.publish('event0', testMsg);
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Test publishes in quick succession (on successive ticks of the event loop)
     * @spec RTL6b
     */
    Helper.testOnAllTransportsAndProtocols(this, 'publishfast', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        try {
          var realtime = helper.AblyRealtime(realtimeOpts);
          realtime.connection.once('connected', function () {
            var channel = realtime.channels.get('publishfast_' + String(Math.random()).substr(2));
            Helper.whenPromiseSettles(channel.attach(), function (err) {
              if (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }

              async.parallel(
                [
                  function (cb) {
                    channel.subscribe('event', function (msg) {
                      if (msg.data === '49') {
                        cb();
                      }
                    });
                  },
                  function (cb) {
                    var ackd = 0;
                    var publish = function (i) {
                      Helper.whenPromiseSettles(channel.publish('event', i.toString()), function (err) {
                        try {
                          expect(
                            !err,
                            'successfully published ' + i + (err ? ' err was ' + helper.displayError(err) : ''),
                          ).to.be.ok;
                        } catch (err) {
                          cb(err);
                          return;
                        }
                        ackd++;
                        if (ackd === 50) cb();
                      });
                      if (i < 49) {
                        setTimeout(function () {
                          publish(i + 1);
                        }, 0);
                      }
                    };
                    publish(0);
                  },
                ],
                function (err) {
                  helper.closeAndFinish(done, realtime, err);
                },
              );
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      };
    });

    /**
     * Test queuing: publishing a series of messages that start before the lib is connected
     * Also checks they arrive in the right order
     *
     * @spec RTL6c2
     * @specpartial RTL3d - test processing queued messages
     */
    Helper.testOnAllTransportsAndProtocols(this, 'publishQueued', function (realtimeOpts) {
      return function (done) {
        var helper = this.test.helper,
          txRealtime,
          rxRealtime;
        try {
          helper.recordPrivateApi('call.Utils.mixin');
          txRealtime = helper.AblyRealtime(helper.Utils.mixin(realtimeOpts, { autoConnect: false }));
          rxRealtime = helper.AblyRealtime();
          var txChannel = txRealtime.channels.get('publishQueued_' + String(Math.random()).substr(2));
          var rxChannel = rxRealtime.channels.get(txChannel.name);

          async.series(
            [
              function (cb) {
                rxRealtime.connection.once('connected', function () {
                  cb();
                });
              },
              function (cb) {
                Helper.whenPromiseSettles(rxChannel.attach(), function (err) {
                  cb(err);
                });
              },
              function (cb) {
                async.parallel(
                  [
                    function (parCb) {
                      var expectedMsgNum = 0;
                      rxChannel.subscribe('event', function (msg) {
                        var num = msg.data.num;
                        try {
                          expect(expectedMsgNum).to.equal(num, 'Event ' + num + ' was in the right order');
                        } catch (err) {
                          parCb(err);
                          return;
                        }
                        expectedMsgNum++;
                        if (num === 49) parCb();
                      });
                    },
                    function (parCb) {
                      var ackd = 0;
                      var publish = function (i) {
                        Helper.whenPromiseSettles(txChannel.publish('event', { num: i }), function (err) {
                          try {
                            expect(
                              !err,
                              'successfully published ' + i + (err ? ' err was ' + helper.displayError(err) : ''),
                            ).to.be.ok;
                          } catch (err) {
                            parCb(err);
                            return;
                          }
                          ackd++;
                          if (ackd === 50) parCb();
                        });
                        if (i < 49) {
                          setTimeout(function () {
                            publish(i + 1);
                          }, 20);
                        }
                      };
                      publish(0);
                    },
                    function (parCb) {
                      txRealtime.connection.once('connected', function () {
                        parCb();
                      });
                      txRealtime.connection.connect();
                    },
                  ],
                  cb,
                );
              },
            ],
            function (err) {
              helper.closeAndFinish(done, [rxRealtime, txRealtime], err);
            },
          );
        } catch (err) {
          helper.closeAndFinish(done, [rxRealtime, txRealtime], err);
        }
      };
    });

    /**
     * Test that a message is not sent back to the same realtime client
     * when echoMessages is false (RTC1a and RTL7f)
     *
     * Test that a message is sent back to the same realtime client
     * when echoMessages is true (RTC1a and RTL7f)
     *
     * @spec RTC1a
     * @spec RTL7f
     */
    it('publishEcho', function (done) {
      // set up two realtimes
      var helper = this.test.helper,
        rtNoEcho = helper.AblyRealtime({ echoMessages: false }),
        rtEcho = helper.AblyRealtime({ echoMessages: true }),
        rtNoEchoChannel = rtNoEcho.channels.get('publishecho'),
        rtEchoChannel = rtEcho.channels.get('publishecho'),
        testMsg1 = 'Hello',
        testMsg2 = 'World!';

      // We expect to see testMsg2 on rtNoEcho and testMsg1 on both rtNoEcho and rtEcho
      var receivedMessagesNoEcho = [],
        receivedMessagesEcho = [];

      var finishTest = function () {
        if (receivedMessagesNoEcho.length + receivedMessagesEcho.length == 3) {
          try {
            expect(receivedMessagesNoEcho.length).to.equal(1, 'Received exactly one message on rtNoEcho');
            expect(receivedMessagesEcho.length).to.equal(2, 'Received exactly two messages on rtEcho');
            expect(receivedMessagesNoEcho[0]).to.equal(testMsg2, 'Received testMsg2 on rtNoEcho');
            expect(receivedMessagesEcho[0]).to.equal(testMsg1, 'Received testMsg1 on rtEcho first');
            expect(receivedMessagesEcho[1]).to.equal(testMsg2, 'Received testMsg2 on rtEcho second');
          } catch (err) {
            helper.closeAndFinish(done, [rtNoEcho, rtEcho], err);
            return;
          }
          helper.closeAndFinish(done, [rtNoEcho, rtEcho]);
        }
      };

      // attach rtNoEchoChannel
      Helper.whenPromiseSettles(rtNoEchoChannel.attach(), function (err) {
        try {
          expect(!err, 'Attached to rtNoEchoChannel with no error').to.be.ok;
        } catch (err) {
          helper.closeAndFinish(done, [rtNoEcho, rtEcho], err);
          return;
        }
        helper.monitorConnection(done, rtNoEcho);

        // once rtNoEchoChannel attached, subscribe to event0
        rtNoEchoChannel.subscribe('event0', function (msg) {
          receivedMessagesNoEcho.push(msg.data);
          finishTest();
        });

        // attach rtEchoChannel
        Helper.whenPromiseSettles(rtEchoChannel.attach(), function (err) {
          try {
            expect(!err, 'Attached to rtEchoChannel with no error').to.be.ok;
          } catch (err) {
            helper.closeAndFinish(done, [rtNoEcho, rtEcho], err);
            return;
          }
          helper.monitorConnection(done, rtEcho);

          // once rtEchoChannel attached, subscribe to event0
          rtEchoChannel.subscribe('event0', function (msg) {
            receivedMessagesEcho.push(msg.data);
            finishTest();
          });

          // publish testMsg1 via rtNoEcho
          Helper.whenPromiseSettles(rtNoEchoChannel.publish('event0', testMsg1), function () {
            // publish testMsg2 via rtEcho
            rtEchoChannel.publish('event0', testMsg2);
          });
        });
      });
    });

    /**
     * @spec RSL1b
     * @spec RSL1e
     * @spec TM2g
     * @spec TM2d
     * @specpartial RSL1a - doesn't test array of Message objects
     */
    it('publishVariations', function (done) {
      const helper = this.test.helper;
      var testData = 'Some data';
      var testArguments = [
        [{ name: 'objectWithName' }],
        [{ name: 'objectWithNameAndNullData', data: null }],
        [{ name: 'objectWithNameAndUndefinedData', data: undefined }],
        [{ name: 'objectWithNameAndEmptyStringData', data: '' }],
        ['nameAndNullData', null],
        ['nameAndUndefinedData', undefined],
        ['nameAndEmptyStringData', ''],
        ['nameAndData', testData],
        [{ name: 'objectWithNameAndData', data: testData }],
        // 5 messages with null name,
        [null, testData],
        [{ name: null, data: testData }],
        [null, null],
        [{ name: null }],
        [{ name: null, data: null }],
      ];
      var realtime;

      try {
        /* set up realtime */
        realtime = helper.AblyRealtime();
        var rest = helper.AblyRest();

        /* connect and attach */
        realtime.connection.on('connected', function () {
          var rtChannel = realtime.channels.get('publishVariations');
          Helper.whenPromiseSettles(rtChannel.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }

            /* subscribe to different message types */
            var messagesReceived = 0;
            rtChannel.subscribe(function (msg) {
              ++messagesReceived;
              try {
                switch (msg.name) {
                  case 'objectWithName':
                  case 'objectWithNameAndCallback':
                  case 'objectWithNameAndNullData':
                  case 'objectWithNameAndUndefinedData':
                  case 'nameAndNullData':
                  case 'nameAndUndefinedData':
                    expect(typeof msg.data).to.equal('undefined', 'Msg data was received where none expected');
                    break;
                  case 'nameAndEmptyStringData':
                  case 'objectWithNameAndEmptyStringData':
                    expect(msg.data).to.equal(
                      '',
                      'Msg data received was a ' + typeof msg.data + ' when should have been an empty string',
                    );
                    break;
                  case 'objectWithNameAndFalseData':
                  case 'nameAndFalseData':
                    expect(msg.data).to.equal(
                      false,
                      'Msg data received was a ' + typeof msg.data + ' when should have been a bool false',
                    );
                    break;
                  case 'nameAndData':
                  case 'nameAndDataAndCallback':
                  case 'objectWithNameAndData':
                  case 'objectWithNameAndDataAndCallback':
                    expect(msg.data).to.equal(testData, 'Msg data ' + msg.data + 'Unexpected message data received');
                    break;
                  case undefined:
                    if (msg.data) {
                      // 3 messages: null name and data, null name and data and callback, object with null name and data
                      expect(msg.data).to.equal(testData, 'Msg data ' + msg.data + 'Unexpected message data received');
                    } else {
                      // 3 messages: null name and null data, object with null name and no data, object with null name and null data
                      expect(typeof msg.data).to.equal('undefined', 'Msg data was received where none expected');
                    }
                    break;
                  default:
                    helper.closeAndFinish(done, realtime, new Error('Unexpected message ' + msg.name + 'received'));
                    return;
                }
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }

              if (messagesReceived == testArguments.length) {
                setTimeout(function () {
                  helper.closeAndFinish(done, realtime);
                }, 2000);
              }
            });

            /* publish events */
            var restChannel = rest.channels.get('publishVariations');
            async.eachSeries(
              testArguments,
              function iterator(args, callback) {
                Helper.whenPromiseSettles(restChannel.publish.apply(restChannel, args), callback);
              },
              function (err) {
                if (err) {
                  helper.closeAndFinish(done, realtime, err);
                  return;
                }
              },
            );
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /** @spec RSL4a */
    it('publishDisallowed', function (done) {
      const helper = this.test.helper;
      var testArguments = [
        [{ name: 'objectAndBoolData', data: false }],
        ['nameAndBoolData', false],
        [{ name: 'objectAndNumericData', data: 0 }],
        ['nameAndNumericData', 0],
        [{ name: 'objectAndOtherObjectData', data: new Date() }],
        ['nameAndOtherObjectData', new Date()],
      ];

      try {
        /* set up realtime */
        var realtime = helper.AblyRealtime();
        var rest = helper.AblyRest();

        /* connect and attach */
        realtime.connection.on('connected', function () {
          var rtChannel = realtime.channels.get('publishDisallowed');
          Helper.whenPromiseSettles(rtChannel.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }

            (async function () {
              /* publish events */
              var restChannel = rest.channels.get('publishDisallowed');
              for (var i = 0; i < testArguments.length; i++) {
                try {
                  await restChannel.publish.apply(restChannel, testArguments[i]);
                  helper.closeAndFinish(done, realtime, new Error('Exception was not raised'));
                } catch (err) {
                  try {
                    expect(err.code).to.equal(40013, 'Invalid data type exception raised');
                  } catch (err) {
                    helper.closeAndFinish(done, realtime, err);
                    return;
                  }
                }
              }
            })().then(() => {
              helper.closeAndFinish(done, realtime);
            });
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * @spec RSL4b
     * @spec RTL7e
     * @spec TM2e
     * @specpartial RSL6b
     */
    it('publishEncodings', function (done) {
      const helper = this.test.helper;
      var testData = 'testData';
      var testArguments = [
        // valid
        [{ name: 'justJson', encoding: 'json', data: '{"foo":"bar"}' }],
        // invalid -- encoding ending in utf-8 implies data is binary
        [{ name: 'jsonUtf8string', encoding: 'json/utf-8', data: '{"foo":"bar"}' }],
        // valid
        [{ name: 'utf8base64', encoding: 'utf-8/base64', data: 'dGVzdERhdGE=' }],
        // invalid -- nonsense/corrupt encoding
        [{ name: 'nonsense', encoding: 'choahofhpxf', data: testData }],
      ];

      try {
        /* set up realtime */
        var realtime = helper.AblyRealtime();
        var rest = helper.AblyRest();

        /* connect and attach */
        realtime.connection.on('connected', function () {
          var rtChannel = realtime.channels.get('publishEncodings');
          Helper.whenPromiseSettles(rtChannel.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }

            var subscribefn = function (cb) {
              var messagesReceived = 0;
              rtChannel.subscribe(function (msg) {
                ++messagesReceived;
                try {
                  switch (msg.name) {
                    case 'justJson':
                      expect(msg.data).to.deep.equal({ foo: 'bar' }, 'justJson: correct decoded data');
                      expect(msg.encoding).to.deep.equal(null, 'justJson: encoding stripped on decoding');
                      break;
                    case 'jsonUtf8string':
                      expect(msg.data).to.equal('{"foo":"bar"}', 'justJsonUTF8string: data should be untouched');
                      expect(msg.encoding).to.equal('json/utf-8', 'justJsonUTF8string: encoding should be untouched');
                      break;
                    case 'utf8base64':
                      expect(msg.data).to.equal('testData', 'utf8base64: correct decoded data');
                      expect(msg.encoding).to.equal(null, 'utf8base64: encoding stripped on decoding');
                      break;
                    case 'nonsense':
                      expect(msg.data).to.deep.equal(testData, 'nonsense: data untouched');
                      expect(msg.encoding).to.equal('choahofhpxf', 'nonsense: encoding untouched');
                      break;
                    default:
                      cb(new Error('Unexpected message ' + msg.name + ' received'));
                  }
                  if (messagesReceived == testArguments.length) {
                    cb();
                  }
                } catch (err) {
                  cb(err);
                }
              });
            };

            /* publish events */
            var publishfn = function (cb) {
              var restChannel = rest.channels.get('publishEncodings');
              async.eachSeries(
                testArguments,
                function iterator(item, callback) {
                  try {
                    Helper.whenPromiseSettles(restChannel.publish(item), function (err) {
                      try {
                        expect(!err, 'Successfully published').to.be.ok;
                      } catch (err) {
                        callback(err);
                      }
                      callback();
                    });
                  } catch (err) {
                    callback(err);
                  }
                },
                cb,
              );
            };

            async.parallel([subscribefn, publishfn], function (err) {
              helper.closeAndFinish(done, realtime, err);
            });
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * @spec RSL1b
     * @spec RTL7b
     */
    it('restpublish', function (done) {
      const helper = this.test.helper;
      var count = 10;
      var rest = helper.AblyRest();
      var realtime = helper.AblyRealtime();
      var messagesSent = [];
      var sendchannel = rest.channels.get('restpublish');
      var recvchannel = realtime.channels.get('restpublish');
      /* subscribe to event */
      recvchannel.subscribe('event0', function (msg) {
        try {
          expect(-1).to.not.equal(messagesSent.indexOf(msg.data), 'Received unexpected message text');
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        if (!--count) {
          clearInterval(timer);
          helper.closeAndFinish(done, realtime);
        }
      });
      var timer = setInterval(function () {
        // console.log('sending: ' + count);
        var msgText = 'Hello world at: ' + new Date();
        messagesSent.push(msgText);
        sendchannel.publish('event0', msgText);
      }, 500);
    });

    /**
     * @spec RTL6
     * @spec RTL6b
     */
    Helper.testOnAllTransportsAndProtocols(this, 'publish', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        var count = 10;
        var cbCount = 10;
        var checkFinish = function () {
          if (count <= 0 && cbCount <= 0) {
            helper.closeAndFinish(done, realtime);
          }
        };
        var onPublish = function () {
          --cbCount;
          checkFinish();
        };
        var realtime = helper.AblyRealtime(realtimeOpts);
        var channel = realtime.channels.get('publish ' + JSON.stringify(realtimeOpts));
        /* subscribe to event */
        Helper.whenPromiseSettles(
          channel.subscribe('event0', function () {
            --count;
            checkFinish();
          }),
          function () {
            var dataFn = function () {
              return 'Hello world at: ' + new Date();
            };
            publishAtIntervals(count, channel, dataFn, onPublish);
          },
        );
      };
    });

    /**
     * check that string containing emoji correctly publishes on all transport and protocols
     */
    Helper.testOnAllTransportsAndProtocols(this, 'publish emoji string', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        const realtime = helper.AblyRealtime(realtimeOpts);
        const channel = realtime.channels.get('publish_emoji' + JSON.stringify(realtimeOpts));

        channel
          .subscribe((msg) => {
            if (msg.data === '😅🎉🚀') {
              helper.closeAndFinish(done, realtime);
            }
          })
          .then(() => {
            channel.publish('test', '😅🎉🚀');
          });
      };
    });

    /**
     * Authenticate with a clientId and ensure that the clientId is not sent in the Message
     * and is implicitly added when published.
     *
     * @specpartial RSL1m1 - in the context of RealtimeChannel
     */
    it('implicit_client_id_0', function (done) {
      var helper = this.test.helper,
        clientId = 'implicit_client_id_0',
        realtime = helper.AblyRealtime({ clientId: clientId });

      realtime.connection.once('connected', function () {
        helper.recordPrivateApi('read.connectionManager.activeProtocol.transport');
        var transport = realtime.connection.connectionManager.activeProtocol.transport,
          originalSend = transport.send;

        helper.recordPrivateApi('replace.transport.send');
        transport.send = function (message) {
          try {
            if (message.action === 15) {
              expect(message.messages[0].name === 'event0', 'Outgoing message interecepted').to.be.ok;
              expect(!message.messages[0].clientId, 'client ID is not added by the client library as it is implicit').to
                .be.ok;
            }
            helper.recordPrivateApi('call.transport.send');
            originalSend.apply(transport, arguments);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        };

        var channel = realtime.channels.get('implicit_client_id_0');
        /* subscribe to event */
        channel.subscribe('event0', function (message) {
          try {
            expect(message.clientId == clientId, 'Client ID was added implicitly').to.be.ok;
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
        channel.publish('event0', null);
      });
    });

    /**
     * Authenticate with a clientId and explicitly provide the same clientId in the Message
     * and ensure it is published.
     *
     * @specpartial RSL1m2 - in the context of RealtimeChannel
     */
    it('explicit_client_id_0', function (done) {
      var helper = this.test.helper,
        clientId = 'explicit_client_id_0',
        /* Use a fixed transport as intercepting transport.send */
        realtime = helper.AblyRealtime({ clientId: clientId, transports: [helper.bestTransport] });

      realtime.connection.once('connected', function () {
        helper.recordPrivateApi('read.connectionManager.activeProtocol.transport');
        var transport = realtime.connection.connectionManager.activeProtocol.transport,
          originalSend = transport.send;

        helper.recordPrivateApi('replace.transport.send');
        transport.send = function (message) {
          try {
            if (message.action === 15) {
              expect(message.messages[0].name === 'event0', 'Outgoing message interecepted').to.be.ok;
              expect(message.messages[0].clientId === clientId, 'client ID is present when published to Ably').to.be.ok;
            }
            helper.recordPrivateApi('call.transport.send');
            originalSend.apply(transport, arguments);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        };

        var channel = realtime.channels.get('explicit_client_id_0');
        /* subscribe to event */
        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            try {
              expect(!err, err && helper.displayError(err)).to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            helper.closeAndFinish(done, realtime);
          }
          async.parallel(
            [
              function (cb) {
                channel.subscribe('event0', function (message) {
                  try {
                    expect(message.clientId == clientId, 'Client ID was added implicitly').to.be.ok;
                  } catch (err) {
                    cb(err);
                    return;
                  }
                  cb();
                });
              },
              function (cb) {
                Helper.whenPromiseSettles(channel.publish({ name: 'event0', clientId: clientId }), function (err) {
                  cb(err);
                });
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
     * Authenticate with a clientId and explicitly provide a different invalid clientId in the Message
     * and expect it to not be published and be rejected.
     *
     * @specpartial RSL1m4 - in the context of RealtimeChannel
     */
    it('explicit_client_id_1', function (done) {
      var helper = this.test.helper,
        clientId = 'explicit_client_id_1',
        invalidClientId = 'invalid',
        rest = helper.AblyRest();

      Helper.whenPromiseSettles(rest.auth.requestToken({ clientId: clientId }), function (err, token) {
        if (err) {
          done(err);
          return;
        }
        try {
          expect(token.clientId === clientId, 'client ID is present in the Token').to.be.ok;
        } catch (err) {
          done(err);
          return;
        }

        /* Use a fixed transport as intercepting transport.send */
        var realtime = helper.AblyRealtime({ token: token.token, transports: [helper.bestTransport] }),
          channel = realtime.channels.get('explicit_client_id_1');

        // Publish before authentication to ensure the client library does not reject the message as the clientId is not known
        Helper.whenPromiseSettles(channel.publish({ name: 'event0', clientId: invalidClientId }), function (err) {
          try {
            expect(err, 'Message was not published').to.be.ok;
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          setTimeout(function () {
            helper.closeAndFinish(done, realtime);
          }, 500); // ensure that the message is not published
        });

        helper.recordPrivateApi('listen.connectionManager.transport.pending');
        realtime.connection.connectionManager.on('transport.pending', function (transport) {
          var originalSend = transport.send;

          helper.recordPrivateApi('replace.transport.send');
          transport.send = function (message) {
            try {
              if (message.action === 15) {
                expect(message.messages[0].name === 'event0', 'Outgoing message interecepted').to.be.ok;
                expect(message.messages[0].clientId === invalidClientId, 'client ID is present when published to Ably')
                  .to.be.ok;
              }
              helper.recordPrivateApi('call.transport.send');
              originalSend.apply(transport, arguments);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          };

          /* subscribe to event */
          channel.subscribe('event0', function (message) {
            helper.closeAndFinish(done, realtime, new Error('Message should never have been received'));
          });
        });
      });
    });

    /**
     * Related to RTL7. Passing an array of events to .subscribe is not documented in the spec.
     * @nospec
     */
    it('subscribe_with_event_array', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime(),
        channel = realtime.channels.get('subscribe_with_event_array');

      async.series(
        [
          function (cb) {
            realtime.connection.once('connected', function () {
              cb();
            });
          },
          function (cb) {
            Helper.whenPromiseSettles(channel.attach(), function (err) {
              cb(err);
            });
          },
          function (outercb) {
            async.parallel(
              [
                function (innercb) {
                  var received = 0;
                  channel.subscribe(['a', 'b'], function (message) {
                    try {
                      expect(message.name === 'a' || message.name === 'b', 'Correct messages received').to.be.ok;
                    } catch (err) {
                      innercb(err);
                      return;
                    }
                    ++received;
                    if (received === 2) {
                      /* wait a tick to make sure no more messages come in */
                      helper.recordPrivateApi('call.Platform.nextTick');
                      config.nextTick(function () {
                        innercb();
                      });
                    }
                  });
                },
                function (innercb) {
                  Helper.whenPromiseSettles(
                    channel.publish([{ name: 'a' }, { name: 'b' }, { name: 'c' }, { name: 'd' }]),
                    function (err) {
                      innercb(err);
                    },
                  );
                },
              ],
              outercb,
            );
          },
        ],
        function (err) {
          helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /**
     * Related to RTL7.
     *
     * @spec RTL22c
     * @spec RTL22d
     * @spec MFI2b
     * @spec MFI2c
     * @specpartial RTL22 - tests only subscribe
     * @specpartial RTL22a - doesn't test for name
     */
    it('subscribe_with_filter_object', function (done) {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();
      const channel = realtime.channels.get('subscribe_with_filter_object');

      function send(cb) {
        Helper.whenPromiseSettles(
          channel.publish([
            {
              name: 'correct',
              extras: {
                ref: {
                  type: 'com.ably.test',
                  timeserial: '0123456789',
                },
              },
            },
            {
              name: 'incorrect-noref',
            },
            {
              name: 'incorrect-badtype',
              extras: {
                ref: {
                  type: 'com.ably.incorrect',
                  timeserial: '0123456789',
                },
              },
            },
            {
              name: 'incorrect-badid',
              extras: {
                ref: {
                  type: 'com.ably.test',
                  timeserial: '000000000000',
                },
              },
            },
          ]),
          cb,
        );
      }

      function subscribe(cb) {
        channel.subscribe(
          {
            refType: 'com.ably.test',
            refTimeserial: '0123456789',
          },
          function (m) {
            try {
              expect(m.name).to.be.equal('correct', 'Correct message received');
            } catch (e) {
              return cb(e);
            }
            // Wait for any errant messages to arrive before continuing
            helper.recordPrivateApi('call.Platform.nextTick');
            config.nextTick(cb);
          },
        );
      }

      async.series(
        [
          function (cb) {
            return realtime.connection.once('connected', function () {
              return cb();
            });
          },
          function (cb) {
            return Helper.whenPromiseSettles(channel.attach(), cb);
          },
          function (cb) {
            return async.parallel([subscribe, send], cb);
          },
        ],
        function (err) {
          return helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /**
     * Related to RTL8.
     *
     * @spec RTL22c
     * @spec RTL22d
     * @spec MFI2b
     * @spec MFI2c
     * @specpartial RTL22 - tests only unsubscribe
     * @specpartial RTL22a - doesn't test for name
     */
    it('unsubscribe_with_filter_object', function (done) {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();
      const channel = realtime.channels.get('unsubscribe_with_filter_object');

      function send(cb) {
        Helper.whenPromiseSettles(
          channel.publish([
            {
              name: 'incorrect',
              extras: {
                ref: {
                  type: 'com.ably.test',
                  timeserial: '0123456789',
                },
              },
            },
          ]),
          cb,
        );
      }

      function unsubscribe(cb) {
        try {
          const listener = function () {
            return expect.fail('Listener should not fire');
          };
          channel.subscribe({ refType: 'com.ably.test', refTimeserial: '0123456789' }, listener);
          helper.recordPrivateApi('call.filteredSubscriptions.has');
          expect(channel.filteredSubscriptions.has(listener), 'Listener should initially be present').to.be.true;
          channel.unsubscribe(listener);
          expect(
            channel.filteredSubscriptions.has(listener),
            'Listener should no longer be present after unsubscribing',
          ).to.be.false;
          helper.recordPrivateApi('call.Platform.nextTick');
          config.nextTick(cb);
        } catch (e) {
          cb(e);
        }
      }

      async.series(
        [
          function (cb) {
            realtime.connection.once('connected', function () {
              return cb();
            });
          },
          function (cb) {
            return Helper.whenPromiseSettles(channel.attach(), cb);
          },
          unsubscribe,
          send,
        ],
        function (err) {
          return helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /** @spec RSL6a2 */
    it('extras_field', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime(),
        channel = realtime.channels.get('extras_field'),
        extras = { headers: { some: 'metadata' } };

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
          function (outercb) {
            async.parallel(
              [
                function (innercb) {
                  var received = 0;
                  channel.subscribe(function (message) {
                    try {
                      expect(message.extras).to.deep.equal(extras, 'Check extras is present');
                    } catch (err) {
                      innercb(err);
                      return;
                    }
                    innercb();
                  });
                },
                function (innercb) {
                  Helper.whenPromiseSettles(channel.publish([{ name: 'a', extras: extras }]), innercb);
                },
              ],
              outercb,
            );
          },
        ],
        function (err) {
          helper.closeAndFinish(done, realtime, err);
        },
      );
    });

    /**
     * @spec TO3l8
     * @spec CD2c
     * @spec RSL1i
     */
    it('maxMessageSize', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime(),
        connectionManager = realtime.connection.connectionManager,
        channel = realtime.channels.get('maxMessageSize');

      realtime.connection.once('connected', function () {
        helper.recordPrivateApi('listen.connectionManager.connectiondetails');
        connectionManager.once('connectiondetails', function (details) {
          Helper.whenPromiseSettles(
            channel.publish('foo', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'),
            function (err) {
              try {
                expect(err, 'Check publish refused').to.be.ok;
                expect(err.code).to.equal(40009);
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              helper.closeAndFinish(done, realtime);
            },
          );
        });
        var connectionDetails = connectionManager.connectionDetails;
        helper.recordPrivateApi('write.connectionManager.connectionDetails.maxMessageSize');
        connectionDetails.maxMessageSize = 64;
        helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
        helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
        helper.recordPrivateApi('call.transport.onProtocolMessage');
        connectionManager.activeProtocol.getTransport().onProtocolMessage(
          createPM({
            action: 4,
            connectionDetails: connectionDetails,
          }),
        );
      });
    });

    /**
     * @spec RSL1k2
     * @spec RSL1k5
     */
    it('idempotentRealtimePublishing', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime(),
        channel = realtime.channels.get('idempotentRealtimePublishing');

      Helper.whenPromiseSettles(channel.attach(), function (err) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        /* subscribe to event */
        var event0Msgs = [];
        channel.subscribe('event0', function (msg) {
          event0Msgs.push(msg);
        });

        channel.subscribe('end', function (msg) {
          try {
            expect(event0Msgs.length).to.equal(1, 'Expect only one event0 message to be received');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });

        /* publish event */
        channel.publish({ name: 'event0', id: 'some_msg_id' });
        channel.publish({ name: 'event0', id: 'some_msg_id' });
        channel.publish({ name: 'event0', id: 'some_msg_id' });
        channel.publish('end', null);
      });
    });
    /**
     * @spec TM2j
     */
    describe('DefaultMessage.fromEncoded', function () {
      const testCases = [
        {
          description: 'should stringify the numeric action',
          action: 0,
          expectedString: '[Message; action=message.create; version={}; annotations={"summary":{}}]',
          expectedJSON: { action: 0 },
        },
        {
          description: 'should stringify the numeric action',
          action: 1,
          expectedString: '[Message; action=message.update; version={}; annotations={"summary":{}}]',
          expectedJSON: { action: 1 },
        },
        {
          description: 'should handle no action provided',
          action: undefined,
          expectedString: '[Message; action=message.create; version={}; annotations={"summary":{}}]',
          expectedJSON: { action: 0 },
        },
        {
          description: 'should handle unknown action provided',
          action: 10,
          expectedString: '[Message; action=unknown; version={}; annotations={"summary":{}}]',
        },
        {
          description: 'should set version from version',
          action: 0,
          version: {
            serial: 'serial-abc',
            timestamp: 123,
          },
          timestamp: 456,
          serial: 'version-a',
          expectedString:
            '[Message; action=message.create; serial=version-a; timestamp=456; version={"serial":"serial-abc","timestamp":123}; annotations={"summary":{}}]',
          expectedJSON: { action: 0, version: { serial: 'serial-abc', timestamp: 123 } },
        },
        {
          description: 'should set version from serial',
          action: 0,
          serial: 'serial-abc',
          timestamp: 123,
          expectedString:
            '[Message; action=message.create; serial=serial-abc; timestamp=123; version={"serial":"serial-abc","timestamp":123}; annotations={"summary":{}}]',
          expectedJSON: { action: 0, version: { serial: 'serial-abc', timestamp: 123 } },
        },
      ];
      testCases.forEach(
        ({ description, action, serial, timestamp, version, options, expectedString, expectedJSON }) => {
          it(description, async function () {
            const values = { action, serial, timestamp, version };
            const message = await Message.fromEncoded(values, {});
            expect(message.toString()).to.equal(expectedString);
            if (expectedJSON) {
              expect((await message.encode({})).toJSON()).to.deep.contains(expectedJSON);
            }
          });
        },
      );

      /**
       * @spec TM2s
       * @spec TM2s1
       * @spec TM2s2
       */
      it('should populate version from serial/timestamp when decoding message', async function () {
        // Test with serial and timestamp at root level
        const values = { action: 0, timestamp: 12345, serial: 'test-serial' };
        const message = await Message.fromEncoded(values);
        expect(message.timestamp).to.equal(12345);
        expect(message.serial).to.equal('test-serial');
        expect(message.version).to.deep.equal({
          serial: 'test-serial',
          timestamp: 12345,
        });

        // Test with partial version object - should fill from root
        const partialVersion = {
          action: 0,
          timestamp: 54321,
          serial: 'another-serial',
          version: { clientId: 'test-client' },
        };
        const message2 = await Message.fromEncoded(partialVersion);
        expect(message2.version).to.deep.equal({
          serial: 'another-serial',
          timestamp: 54321,
          clientId: 'test-client',
        });

        // Applying on non-creates
        const update = { action: 1, timestamp: 12345, serial: 'update-serial' };
        const updateMessage = await Message.fromEncoded(update);
        expect(updateMessage.version).to.deep.equal({ serial: 'update-serial', timestamp: 12345 });

        // Non-set
        const empty = { action: 1 };
        const emptyMessage = await Message.fromEncoded(empty);
        expect(emptyMessage.version).to.deep.equal({});
      });

      /**
       * @spec TM2u
       * @spec TM8a
       */
      it('should populate annotations and summary when decoding message', async function () {
        // Test with preset annotations and summary
        const values = { action: 0, timestamp: 12345, serial: 'test-serial', annotations: { summary: { foo: 'bar' } } };
        const message = await Message.fromEncoded(values);
        expect(message.timestamp).to.equal(12345);
        expect(message.serial).to.equal('test-serial');
        expect(message.annotations).to.deep.equal({
          summary: {
            foo: 'bar',
          },
        });

        // Test with annotations set and no summary, should create summary
        const withoutSummary = { action: 0, timestamp: 12345, serial: 'test-serial', annotations: {} };
        const messageWithoutSummary = await Message.fromEncoded(withoutSummary);
        expect(messageWithoutSummary.timestamp).to.equal(12345);
        expect(messageWithoutSummary.serial).to.equal('test-serial');
        expect(messageWithoutSummary.annotations).to.deep.equal({
          summary: {},
        });

        // Test with neither set, should create both
        const withoutSummaryAndAnnotations = { action: 0, timestamp: 12345, serial: 'test-serial' };
        const messageWithoutSummaryAndAnnotations = await Message.fromEncoded(withoutSummaryAndAnnotations);
        expect(messageWithoutSummaryAndAnnotations.timestamp).to.equal(12345);
        expect(messageWithoutSummaryAndAnnotations.serial).to.equal('test-serial');
        expect(messageWithoutSummaryAndAnnotations.annotations).to.deep.equal({
          summary: {},
        });
      });

      /**
       * @spec TM7c1c
       * @spec TM7d1c
       */
      it('should ensure clipped field is set to false where not explicitly provided', async function () {
        const values = {
          annotations: {
            summary: {
              // all unset, expecting false
              'reactions:distinct.v1': {
                foo: { total: 1, clientIds: ['client1'] },
                bar: { total: 1, clientIds: ['client2'] },
              },
              'reactions:unique.v1': {
                foo: { total: 1, clientIds: ['client2'] },
                bar: { total: 1, clientIds: ['client3'] },
              },
              'reactions:multiple.v1': {
                foo: { total: 1, clientIds: ['client3'] },
                bar: { total: 1, clientIds: ['client3'] },
              },
              'reactions:flag.v1': { total: 1, clientIds: ['client4'] },

              // some set to true
              'votes:distinct.v1': {
                foo: { total: 1, clientIds: ['client1'], clipped: true },
                bar: { total: 1, clientIds: ['client2'] },
              },
              'votes:unique.v1': {
                foo: { total: 1, clientIds: ['client2'] },
                bar: { total: 1, clientIds: ['client3'], clipped: true },
              },
              'votes:multiple.v1': {
                foo: { total: 1, clientIds: ['client3'], clipped: true },
                bar: { total: 1, clientIds: ['client3'] },
              },
              'votes:flag.v1': { total: 1, clientIds: ['client4'], clipped: true },
            },
          },
        };

        const message = await Message.fromEncoded(values);

        // Check reactions types (all should have clipped=false when not provided)
        expect(message.annotations.summary['reactions:distinct.v1']['foo'].clipped).to.equal(
          false,
          'reactions:distinct.v1 foo should have clipped=false',
        );
        expect(message.annotations.summary['reactions:distinct.v1']['bar'].clipped).to.equal(
          false,
          'reactions:distinct.v1 bar should have clipped=false',
        );
        expect(message.annotations.summary['reactions:unique.v1']['foo'].clipped).to.equal(
          false,
          'reactions:unique.v1 foo should have clipped=false',
        );
        expect(message.annotations.summary['reactions:unique.v1']['bar'].clipped).to.equal(
          false,
          'reactions:unique.v1 bar should have clipped=false',
        );
        expect(message.annotations.summary['reactions:multiple.v1']['foo'].clipped).to.equal(
          false,
          'reactions:multiple.v1 foo should have clipped=false',
        );
        expect(message.annotations.summary['reactions:multiple.v1']['bar'].clipped).to.equal(
          false,
          'reactions:multiple.v1 bar should have clipped=false',
        );
        expect(message.annotations.summary['reactions:flag.v1'].clipped).to.equal(
          false,
          'reactions:flag.v1 should have clipped=false',
        );

        // Check votes types (should preserve true values and set false for unset ones)
        expect(message.annotations.summary['votes:distinct.v1']['foo'].clipped).to.equal(
          true,
          'votes:distinct.v1 foo should remain clipped=true',
        );
        expect(message.annotations.summary['votes:distinct.v1']['bar'].clipped).to.equal(
          false,
          'votes:distinct.v1 bar should have clipped=false',
        );
        expect(message.annotations.summary['votes:unique.v1']['foo'].clipped).to.equal(
          false,
          'votes:unique.v1 foo should have clipped=false',
        );
        expect(message.annotations.summary['votes:unique.v1']['bar'].clipped).to.equal(
          true,
          'votes:unique.v1 bar should remain clipped=true',
        );
        expect(message.annotations.summary['votes:multiple.v1']['foo'].clipped).to.equal(
          true,
          'votes:multiple.v1 foo should remain clipped=true',
        );
        expect(message.annotations.summary['votes:multiple.v1']['bar'].clipped).to.equal(
          false,
          'votes:multiple.v1 bar should have clipped=false',
        );
        expect(message.annotations.summary['votes:flag.v1'].clipped).to.equal(
          true,
          'votes:flag.v1 should remain clipped=true',
        );
      });
    });

    /**
     * @spec RTS5
     * @spec RTS5a
     * @spec DO1
     * @spec DO2
     * @spec DO2a
     */
    it('subscribes to filtered channel', function (done) {
      const helper = this.test.helper;

      var testData = [
        {
          name: 'filtered',
          data: 'These headers match the JMESPath expression so this message should not be filtered',
          extras: {
            headers: {
              name: 'Lorem Choo',
              number: 26095,
              bool: true,
            },
          },
        },
        {
          name: 'filtered',
          data: 'Random data with no extras for filter',
        },
        {
          name: 'filtered',
          data: 'This message should also not be filtered',
          extras: {
            headers: {
              name: 'John Bull',
              number: 26095,
              bool: false,
            },
          },
        },
        {
          name: 'filtered',
          data: 'No header on message',
        },
        {
          name: 'filtered',
          data: 'Can be filtered because it does not meet filter condition on headers.number',
          extras: {
            headers: {
              name: 'John Bull',
              number: 12345,
              bool: false,
            },
          },
        },
        {
          name: 'end',
          data: 'last message check',
        },
      ];

      var filterOption = {
        filter: 'name == `"filtered"` && headers.number == `26095`',
      };

      try {
        /* set up realtime */
        var realtime = helper.AblyRealtime({ key: helper.getTestApp().keys[5].keyStr });
        var rest = helper.AblyRest();

        realtime.connection.on('connected', function () {
          var rtFilteredChannel = realtime.channels.getDerived('chan', filterOption);
          var rtUnfilteredChannel = realtime.channels.get('chan');

          var filteredMessages = [];
          var unFilteredMessages = [];
          /* subscribe to event */
          Helper.whenPromiseSettles(rtFilteredChannel.attach(), function (err) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            rtFilteredChannel.subscribe(function (msg) {
              try {
                // Push received filtered messages into an array
                filteredMessages.push(msg);
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
            });

            Helper.whenPromiseSettles(rtUnfilteredChannel.attach(), function (err) {
              if (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }

              rtUnfilteredChannel.subscribe(function (msg) {
                try {
                  // Push received unfiltered messages into an array
                  unFilteredMessages.push(msg);
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                  return;
                }
              });

              // Subscription to check all messages were received as expected
              rtUnfilteredChannel.subscribe('end', function (msg) {
                // The 'end' sentinel only orders deliveries on the raw channel; the derived
                // (filtered) channel is a separate attachment whose deliveries can lag it,
                // so wait for the filtered deliveries instead of assuming one macrotask
                // is enough.
                helper
                  .waitFor(() => filteredMessages.length === 2, 10000)
                  .then(() => {
                    try {
                      expect(msg.data).to.equal(testData[testData.length - 1].data, 'Unexpected msg data received');

                      // Check that we receive expected messages on filtered channel
                      expect(filteredMessages.length).to.equal(2, 'Expect only two filtered message to be received');
                      expect(filteredMessages[0].data).to.equal(testData[0].data, 'Unexpected data received');
                      expect(filteredMessages[1].data).to.equal(testData[2].data, 'Unexpected data received');
                      expect(filteredMessages[0].extras.headers.name).to.equal(
                        testData[0].extras.headers.name,
                        'Unexpected header value received',
                      );
                      expect(filteredMessages[1].extras.headers.name).to.equal(
                        testData[2].extras.headers.name,
                        'Unexpected header value received',
                      );
                      // Check that message with header that doesn't meet filtering condition is not received.
                      for (const m of filteredMessages) {
                        expect(m.extras.headers.number).to.equal(26095, 'Unexpected header filtering value received');
                      }

                      // Check that we receive expected messages on unfiltered channel, including the `end` event message
                      expect(unFilteredMessages.length).to.equal(6, 'Expect only 6 unfiltered message to be received');
                      for (var i = 0; i < unFilteredMessages.length; i++) {
                        expect(unFilteredMessages[i].data).to.equal(testData[i].data, 'Unexpected data received');
                      }
                    } catch (err) {
                      helper.closeAndFinish(done, realtime, err);
                      return;
                    }
                    helper.closeAndFinish(done, realtime);
                  });
              });
              var restChannel = rest.channels.get('chan');
              restChannel.publish(testData);
            });
          });
        });
        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /** @spec RSF1 */
    it('unrecognized message action', async function () {
      const helper = this.test.helper;
      const realtime = helper.AblyRealtime();

      let caughtError;
      try {
        await helper.monitorConnectionAsync(async () => {
          const channel = realtime.channels.get('unknown_action');
          await channel.attach();

          helper.recordPrivateApi('call.connectionManager.activeProtocol.getTransport');
          helper.recordPrivateApi('call.transport.onProtocolMessage');
          realtime.connection.connectionManager.activeProtocol
            .getTransport()
            .onProtocolMessage({ action: Number.MAX_SAFE_INTEGER, channel: channel.name });

          // wait for the next event loop so connection can process any pending callbacks and go to a failed state
          await new Promise((res, rej) =>
            setTimeout(() => {
              try {
                expect(realtime.connection.state).to.equal(
                  'connected',
                  'Check still connected after unrecognized action field',
                );
                res();
              } catch (error) {
                rej(error);
              }
            }, 0),
          );
        }, realtime);
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError, 'Check connection was not closed after receiving unrecognized message action').to.not.exist;
      await helper.closeAndFinishAsync(realtime);
    });
  });
});
