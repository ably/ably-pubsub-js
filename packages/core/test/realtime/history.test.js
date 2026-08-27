'use strict';

define(['shared_helper', 'async', 'chai'], function (Helper, async, chai) {
  var expect = chai.expect;
  var indexes = [1, 2, 3, 4, 5];
  var preAttachMessages = indexes.map(function (i) {
    return { name: 'pre-attach-' + i, data: 'some data' };
  });
  var postAttachMessages = indexes.map(function (i) {
    return { name: 'post-attach-' + i, data: 'some data' };
  });

  var parallelPublishMessages = function (done, channel, messages, callback) {
    var publishTasks = messages.map(function (event) {
      return function (publishCb) {
        Helper.whenPromiseSettles(channel.publish(event.name, event.data), publishCb);
      };
    });

    try {
      async.parallel(publishTasks, function (err) {
        if (err) {
          done(err);
          return;
        }
        callback();
      });
    } catch (err) {
      done(err);
    }
  };

  describe('realtime/history', function () {
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
     * @spec RTL10c
     * @spec RTL10d
     * @specpartial RTL10b - tests only messages prior to the moment that the channel was attached
     */
    it('history_until_attach', function (done) {
      const helper = this.test.helper;
      var rest = helper.AblyRest();
      var realtime = helper.AblyRealtime();
      var restChannel = rest.channels.get('persisted:history_until_attach');

      /* first, send a number of events to this channel before attaching */
      parallelPublishMessages(done, restChannel, preAttachMessages, function () {
        /* second, connect and attach to the channel */
        try {
          Helper.whenPromiseSettles(realtime.connection.whenState('connected'), function () {
            var rtChannel = realtime.channels.get('persisted:history_until_attach');
            Helper.whenPromiseSettles(rtChannel.attach(), function (err) {
              if (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }

              /* third, send some more events post-attach (over rest, not using the
               * new realtime connection) */

              parallelPublishMessages(done, restChannel, postAttachMessages, function () {
                /* fourth, query history using the realtime connection with
                 * untilAttach both true, false, and not present, checking that
                 * the right messages are returned in each case */

                var tests = [
                  function (callback) {
                    Helper.whenPromiseSettles(rtChannel.history(), function (err, resultPage) {
                      if (err) {
                        callback(err);
                      }
                      try {
                        var expectedLength = preAttachMessages.length + postAttachMessages.length;
                        expect(resultPage.items.length).to.equal(
                          expectedLength,
                          'Verify all messages returned when no params',
                        );
                        callback();
                      } catch (err) {
                        callback(err);
                      }
                    });
                  },
                  function (callback) {
                    Helper.whenPromiseSettles(rtChannel.history({ untilAttach: false }), function (err, resultPage) {
                      if (err) {
                        callback(err);
                      }
                      try {
                        var expectedLength = preAttachMessages.length + postAttachMessages.length;
                        expect(resultPage.items.length).to.equal(
                          expectedLength,
                          'Verify all messages returned when untilAttached is false',
                        );
                        callback();
                      } catch (err) {
                        callback(err);
                      }
                    });
                  },
                  function (callback) {
                    Helper.whenPromiseSettles(rtChannel.history({ untilAttach: true }), function (err, resultPage) {
                      if (err) {
                        callback(err);
                      }

                      try {
                        /* verify only the pre-attached messages are received */
                        var messages = resultPage.items;
                        expect(messages.length).to.equal(
                          preAttachMessages.length,
                          'Verify right number of messages returned when untilAttached is true',
                        );
                        expect(
                          messages.every(function (message) {
                            return message.name.substring(0, 10) == 'pre-attach';
                          }),
                          'Verify all returned messages were pre-attach ones',
                        ).to.be.ok;
                        callback();
                      } catch (err) {
                        callback(err);
                      }
                    });
                  },
                ];

                async.parallel(tests, function (err) {
                  helper.closeAndFinish(done, realtime, err);
                });
              });
            });
          });
          helper.monitorConnection(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });
    });
  });
});
