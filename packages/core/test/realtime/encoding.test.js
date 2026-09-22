'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var expect = chai.expect;
  var BufferUtils = Ably.Realtime.Platform.BufferUtils;
  var Defaults = Ably.Rest.Platform.Defaults;

  function encodingFixturesPath(helper) {
    return helper.testResourcesPath + 'messages-encoding.json';
  }

  describe('realtime/encoding', function () {
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
     * Publish each fixture manually; subscribe with both a json and msgpack
     * realtime, and check everything decodes correctly
     *
     * @specpartial RSL6a1 - publish through REST API, receive via realtime for all transports
     */
    it('message_decoding', function (done) {
      const helper = this.test.helper;
      helper.loadTestData(encodingFixturesPath(helper), function (err, testData) {
        if (err) {
          done(err);
          return;
        }
        var realtime = helper.AblyRealtime({ useBinaryProtocol: false }),
          binaryrealtime = helper.AblyRealtime({ useBinaryProtocol: true }),
          channelName = 'message_decoding',
          channelPath = '/channels/' + channelName + '/messages',
          channel = realtime.channels.get(channelName),
          binarychannel = binaryrealtime.channels.get(channelName);

        async.parallel(
          [
            function (attachCb) {
              Helper.whenPromiseSettles(channel.attach(), attachCb);
            },
            function (attachCb) {
              Helper.whenPromiseSettles(binarychannel.attach(), attachCb);
            },
          ],
          function (err) {
            if (err) {
              helper.closeAndFinish(done, [realtime, binaryrealtime], err);
              return;
            }
            async.eachOf(
              testData.messages,
              function (encodingSpec, index, eachOfCb) {
                /* Restricting to event name allows us to run in parallel */
                var name = index.toString();
                async.parallel(
                  [
                    function (parallelCb) {
                      channel.subscribe(name, function (msg) {
                        try {
                          if (encodingSpec.expectedHexValue) {
                            helper.recordPrivateApi('call.BufferUtils.hexEncode');
                            expect(BufferUtils.hexEncode(msg.data)).to.equal(
                              encodingSpec.expectedHexValue,
                              'Check data matches',
                            );
                          } else {
                            expect(msg.data).to.deep.equal(encodingSpec.expectedValue, 'Check data matches');
                          }
                          channel.unsubscribe(name);
                          parallelCb();
                        } catch (err) {
                          parallelCb(err);
                        }
                      });
                    },
                    function (parallelCb) {
                      binarychannel.subscribe(name, function (msg) {
                        try {
                          if (encodingSpec.expectedHexValue) {
                            helper.recordPrivateApi('call.BufferUtils.hexEncode');
                            expect(BufferUtils.hexEncode(msg.data)).to.equal(
                              encodingSpec.expectedHexValue,
                              'Check data matches',
                            );
                          } else {
                            expect(msg.data).to.deep.equal(encodingSpec.expectedValue, 'Check data matches');
                          }
                          binarychannel.unsubscribe(name);
                          parallelCb();
                        } catch (err) {
                          parallelCb(err);
                        }
                      });
                    },
                    function (parallelCb) {
                      Helper.whenPromiseSettles(
                        realtime.request(
                          'post',
                          channelPath,
                          3,
                          null,
                          { name: name, data: encodingSpec.data, encoding: encodingSpec.encoding },
                          null,
                        ),
                        function (err) {
                          parallelCb(err);
                        },
                      );
                    },
                  ],
                  eachOfCb,
                );
              },
              function (err) {
                helper.closeAndFinish(done, [realtime, binaryrealtime], err);
              },
            );
          },
        );
      });
    });

    /**
     * Publish each fixture with both a json and msgpack realtime, get history
     * manually, and check everything was encoded correctly
     *
     * @specpartial RSL6a1 - publish through realtime, receive via rest (history) for all transports
     */
    it('message_encoding', function (done) {
      const helper = this.test.helper;
      helper.loadTestData(encodingFixturesPath(helper), function (err, testData) {
        if (err) {
          done(new Error('Unable to get test assets; err = ' + helper.displayError(err)));
          return;
        }
        var realtime = helper.AblyRealtime({ useBinaryProtocol: false }),
          binaryrealtime = helper.AblyRealtime({ useBinaryProtocol: true }),
          channelName = 'message_encoding',
          channelPath = '/channels/' + channelName + '/messages',
          channel = realtime.channels.get(channelName),
          binarychannel = binaryrealtime.channels.get(channelName);

        async.parallel(
          [
            function (attachCb) {
              Helper.whenPromiseSettles(channel.attach(), attachCb);
            },
            function (attachCb) {
              Helper.whenPromiseSettles(binarychannel.attach(), attachCb);
            },
          ],
          function (err) {
            if (err) {
              helper.closeAndFinish(done, [realtime, binaryrealtime], err);
              return;
            }
            async.eachOf(
              testData.messages,
              function (encodingSpec, index, eachOfCb) {
                /* Restricting to event name allows us to run in parallel */
                var data,
                  name = index.toString();
                if (encodingSpec.expectedHexValue) {
                  helper.recordPrivateApi('call.BufferUtils.base64Decode');
                  data = BufferUtils.base64Decode(encodingSpec.data);
                } else {
                  data = encodingSpec.expectedValue;
                }
                async.parallel(
                  [
                    function (parallelCb) {
                      Helper.whenPromiseSettles(channel.publish(name, data), parallelCb);
                    },
                    function (parallelCb) {
                      Helper.whenPromiseSettles(binarychannel.publish(name, data), parallelCb);
                    },
                  ],
                  function (err) {
                    if (err) {
                      eachOfCb(err);
                      return;
                    }
                    Helper.whenPromiseSettles(
                      realtime.request('get', channelPath, 3, null, null, null),
                      function (err, resultPage) {
                        if (err) {
                          eachOfCb(err);
                          return;
                        }
                        try {
                          var msgs = resultPage.items.filter(function (m) {
                            return m.name === name;
                          });
                          expect(msgs.length).to.equal(
                            2,
                            'Check expected number of results (one from json rt, one from binary rt)',
                          );
                          expect(msgs[0].encoding == encodingSpec.encoding, 'Check encodings match').to.be.ok;
                          expect(msgs[1].encoding == encodingSpec.encoding, 'Check encodings match').to.be.ok;
                          if (msgs[0].encoding === 'json') {
                            expect(JSON.parse(encodingSpec.data)).to.deep.equal(
                              JSON.parse(msgs[0].data),
                              'Check data matches',
                            );
                            expect(JSON.parse(encodingSpec.data)).to.deep.equal(
                              JSON.parse(msgs[1].data),
                              'Check data matches',
                            );
                          } else {
                            expect(encodingSpec.data).to.equal(msgs[0].data, 'Check data matches');
                            expect(encodingSpec.data).to.equal(msgs[1].data, 'Check data matches');
                          }
                          eachOfCb();
                        } catch (err) {
                          eachOfCb(err);
                        }
                      },
                    );
                  },
                );
              },
              function (err) {
                helper.closeAndFinish(done, [realtime, binaryrealtime], err);
              },
            );
          },
        );
      });
    });
  });
});
