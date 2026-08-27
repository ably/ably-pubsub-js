'use strict';

define(['shared_helper', 'vcdiff-decoder', 'async', 'chai'], function (Helper, vcdiffDecoder, async, chai) {
  var expect = chai.expect;
  var testData = [
    { foo: 'bar', count: 1, status: 'active' },
    { foo: 'bar', count: 2, status: 'active' },
    { foo: 'bar', count: 2, status: 'inactive' },
    { foo: 'bar', count: 3, status: 'inactive' },
    { foo: 'bar', count: 3, status: 'active' },
  ];

  function equals(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function getTestVcdiffDecoder() {
    return {
      numberOfCalls: 0,
      decode: function (delta, base) {
        this.numberOfCalls++;
        return vcdiffDecoder.decode(delta, base);
      },
    };
  }

  describe('realtime/delta', function () {
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

    /** @spec PC3 */
    it('deltaPlugin', function (done) {
      const helper = this.test.helper;
      var testName = 'deltaPlugin';
      try {
        var testVcdiffDecoder = getTestVcdiffDecoder();
        var realtime = helper.AblyRealtime({
          plugins: {
            vcdiff: testVcdiffDecoder,
          },
        });
        var channel = realtime.channels.get(testName, { params: { delta: 'vcdiff' } });

        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
          }

          channel.on('attaching', function (stateChange) {
            done(
              new Error(
                'Channel reattaching, presumably due to decode failure; reason =' +
                  helper.displayError(stateChange.reason),
              ),
            );
          });

          channel.subscribe(function (message) {
            try {
              var index = Number(message.name);
              expect(equals(testData[index], message.data), 'Check message.data').to.be.ok;

              if (index === testData.length - 1) {
                expect(testVcdiffDecoder.numberOfCalls).to.equal(testData.length - 1, 'Check number of delta messages');
                helper.closeAndFinish(done, realtime);
              }
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });

          async.timesSeries(testData.length, function (i, cb) {
            Helper.whenPromiseSettles(channel.publish(i.toString(), testData[i]), cb);
          });
        });

        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Related to PC3
     *
     * @nospec
     */
    it('unusedPlugin', function (done) {
      const helper = this.test.helper;
      var testName = 'unusedPlugin';
      try {
        var testVcdiffDecoder = getTestVcdiffDecoder();
        var realtime = helper.AblyRealtime({
          plugins: {
            vcdiff: testVcdiffDecoder,
          },
        });
        var channel = realtime.channels.get(testName);

        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          channel.subscribe(function (message) {
            try {
              var index = Number(message.name);
              expect(equals(testData[index], message.data), 'Check message.data').to.be.ok;

              if (index === testData.length - 1) {
                expect(testVcdiffDecoder.numberOfCalls).to.equal(0, 'Check number of delta messages');
                helper.closeAndFinish(done, realtime);
              }
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });

          async.timesSeries(testData.length, function (i, cb) {
            Helper.whenPromiseSettles(channel.publish(i.toString(), testData[i]), cb);
          });
        });

        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * @spec RTL18
     * @spec RTL18b
     * @spec RTL18c
     */
    it('lastMessageNotFoundRecovery', function (done) {
      const helper = this.test.helper;
      var testName = 'lastMessageNotFoundRecovery';
      try {
        var testVcdiffDecoder = getTestVcdiffDecoder();
        var realtime = helper.AblyRealtime({
          plugins: {
            vcdiff: testVcdiffDecoder,
          },
        });
        var channel = realtime.channels.get(testName, { params: { delta: 'vcdiff' } });

        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          channel.subscribe(function (message) {
            var index = Number(message.name);
            try {
              expect(equals(testData[index], message.data), 'Check message.data').to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }

            if (index === 1) {
              /* Simulate issue */
              helper.recordPrivateApi('write.channel._lastPayload');
              channel._lastPayload.messageId = null;
              channel.once('attaching', function (stateChange) {
                try {
                  expect(stateChange.reason.code).to.equal(40018, 'Check error code passed through per RTL18c');
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                  return;
                }
                channel.on('attaching', function (stateChange) {
                  helper.closeAndFinish(
                    done,
                    realtime,
                    new Error('Check no further decode failures; reason =' + helper.displayError(stateChange.reason)),
                  );
                });
              });
            } else if (index === testData.length - 1) {
              try {
                // RTL18b - one message was discarded due to failed decoding
                expect(testVcdiffDecoder.numberOfCalls).to.equal(testData.length - 2, 'Check number of delta messages');
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              helper.closeAndFinish(done, realtime);
            }
          });

          async.timesSeries(testData.length, function (i, cb) {
            Helper.whenPromiseSettles(channel.publish(i.toString(), testData[i]), cb);
          });
        });

        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * @spec RTL18
     * @spec RTL18c
     */
    it('deltaDecodeFailureRecovery', function (done) {
      const helper = this.test.helper;
      var testName = 'deltaDecodeFailureRecovery';
      try {
        var failingTestVcdiffDecoder = {
          decode: function (delta, base) {
            throw new Error('Failed to decode delta.');
          },
        };

        var realtime = helper.AblyRealtime({
          plugins: {
            vcdiff: failingTestVcdiffDecoder,
          },
        });
        var channel = realtime.channels.get(testName, { params: { delta: 'vcdiff' } });

        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          channel.on('attaching', function (stateChange) {
            try {
              expect(stateChange.reason.code).to.equal(40018, 'Check error code passed through per RTL18c');
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });
          channel.subscribe(function (message) {
            var index = Number(message.name);
            try {
              expect(equals(testData[index], message.data), 'Check message.data').to.be.ok;
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }

            if (index === testData.length - 1) {
              helper.closeAndFinish(done, realtime);
            }
          });

          async.timesSeries(testData.length, function (i, cb) {
            Helper.whenPromiseSettles(channel.publish(i.toString(), testData[i]), cb);
          });
        });

        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Check that channel becomes failed if we get deltas when we don't have a vcdiff plugin.
     * Related to PC3.
     *
     * @nospec
     */
    it('noPlugin', function (done) {
      const helper = this.test.helper;
      try {
        var realtime = helper.AblyRealtime();
        var channel = realtime.channels.get('noPlugin', { params: { delta: 'vcdiff' } });

        Helper.whenPromiseSettles(channel.attach(), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          channel.once('failed', function (stateChange) {
            try {
              expect(stateChange.reason.code).to.equal(40019, 'Check error code');
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            helper.closeAndFinish(done, realtime);
          });
          async.timesSeries(testData.length, function (i, cb) {
            Helper.whenPromiseSettles(channel.publish(i.toString(), testData[i]), cb);
          });
        });

        helper.monitorConnection(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });
  });
});
