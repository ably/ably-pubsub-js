'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var expect = chai.expect;
  var createPM = Ably.makeProtocolMessageFromDeserialized();

  describe('realtime/sync', function () {
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

    function extractClientIds(presenceSet) {
      return presenceSet
        .map(function (presmsg) {
          return presmsg.clientId;
        })
        .sort();
    }

    function extractMember(presenceSet, clientId) {
      return presenceSet.find(function (member) {
        return member.clientId === clientId;
      });
    }

    /**
     * Sync with an existing presence set - should discard any member who wasn't
     * included in the sync.
     * Note: doesn't use a real connection as everything's being done with
     * simulated protocol messages. Start with a fake-attached channel with no
     * sync in progress, then do one sync, then a second with a slightly
     * different presence set.
     *
     * @spec RTP13
     * @spec RTP18
     * @spec RTP18c
     * @specpartial RTP19
     */
    it('sync_existing_set', async function () {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ autoConnect: false }),
        channelName = 'syncexistingset',
        channel = realtime.channels.get(channelName);

      helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 11,
          channel: channelName,
          flags: 1,
        }),
      );

      await new Promise(function (resolve, reject) {
        var done = function (err) {
          err ? reject(err) : resolve();
        };

        async.series(
          [
            function (cb) {
              helper.recordPrivateApi('call.channel.processMessage');
              channel
                .processMessage(
                  createPM({
                    action: 16,
                    channel: channelName,
                    presence: [
                      {
                        action: 1,
                        clientId: 'one',
                        connectionId: 'one_connid',
                        id: 'one_connid:0:0',
                        timestamp: 1e12,
                      },
                      {
                        action: 1,
                        clientId: 'two',
                        connectionId: 'two_connid',
                        id: 'two_connid:0:0',
                        timestamp: 1e12,
                      },
                    ],
                  }),
                )
                .then(function () {
                  cb();
                })
                .catch(function (err) {
                  cb(err);
                });
            },
            function (cb) {
              Helper.whenPromiseSettles(channel.presence.get(), function (err, results) {
                try {
                  expect(results.length).to.equal(2, 'Check correct number of results');
                  expect(channel.presence.syncComplete, 'Check in sync').to.be.ok;
                  expect(extractClientIds(results)).to.deep.equal(['one', 'two'], 'check correct members');
                } catch (err) {
                  cb(err);
                  return;
                }
                cb(err);
              });
            },
            function (cb) {
              /* Trigger another sync. Two has gone without so much as a `leave` message! */
              helper.recordPrivateApi('call.channel.processMessage');
              channel
                .processMessage(
                  createPM({
                    action: 16,
                    channel: channelName,
                    presence: [
                      {
                        action: 1,
                        clientId: 'one',
                        connectionId: 'one_connid',
                        id: 'one_connid:0:0',
                        timestamp: 1e12,
                      },
                      {
                        action: 1,
                        clientId: 'three',
                        connectionId: 'three_connid',
                        id: 'three_connid:0:0',
                        timestamp: 1e12,
                      },
                    ],
                  }),
                )
                .then(function () {
                  cb();
                })
                .catch(function (err) {
                  cb(err);
                });
            },
            function (cb) {
              Helper.whenPromiseSettles(channel.presence.get(), function (err, results) {
                try {
                  expect(results.length).to.equal(2, 'Check correct number of results');
                  expect(channel.presence.syncComplete, 'Check in sync').to.be.ok;
                  expect(extractClientIds(results)).to.deep.equal(
                    ['one', 'three'],
                    'check two has gone and three is there',
                  );
                } catch (err) {
                  cb(err);
                  return;
                }
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

    /**
     * Sync with an existing presence set and a presence member added in the
     * middle of the sync should should discard the former, but not the latter
     *
     * Related to RTP2f, RTP18a, RTP18b, RTP2d.
     *
     * @nospec
     */
    it('sync_member_arrives_in_middle', async function () {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ autoConnect: false }),
        channelName = 'sync_member_arrives_in_middle',
        channel = realtime.channels.get(channelName);

      helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 11,
          channel: channelName,
          flags: 1,
        }),
      );

      /* First sync */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 16,
          channel: channelName,
          presence: [
            {
              action: 1,
              clientId: 'one',
              connectionId: 'one_connid',
              id: 'one_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      /* A second sync, this time in multiple parts, with a presence message in the middle */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 16,
          channel: channelName,
          channelSerial: 'serial:cursor',
          presence: [
            {
              action: 1,
              clientId: 'two',
              connectionId: 'two_connid',
              id: 'two_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          presence: [
            {
              action: 2,
              clientId: 'three',
              connectionId: 'three_connid',
              id: 'three_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 16,
          channel: channelName,
          channelSerial: 'serial:',
          presence: [
            {
              action: 1,
              clientId: 'four',
              connectionId: 'four_connid',
              id: 'four_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      await new Promise(function (resolve, reject) {
        var done = function (err) {
          err ? reject(err) : resolve();
        };

        Helper.whenPromiseSettles(channel.presence.get(), function (err, results) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          try {
            expect(results.length).to.equal(3, 'Check correct number of results');
            expect(channel.presence.syncComplete, 'Check in sync').to.be.ok;
            expect(extractClientIds(results)).to.deep.equal(
              ['four', 'three', 'two'],
              'check expected presence members',
            );
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });
    });

    /**
     * Presence message that was in the sync arrives again as a normal message, after it's come in the sync.
     * Related to RTP2f, RTP18a, RTP18b, RTP2d.
     *
     * @nospec
     */
    it('sync_member_arrives_normally_after_came_in_sync', async function () {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ autoConnect: false }),
        channelName = 'sync_member_arrives_normally_after_came_in_sync',
        channel = realtime.channels.get(channelName);

      helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 11,
          channel: channelName,
          flags: 1,
        }),
      );

      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 16,
          channel: channelName,
          channelSerial: 'serial:cursor',
          presence: [
            {
              action: 1,
              clientId: 'one',
              connectionId: 'one_connid',
              id: 'one_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          presence: [
            {
              action: 2,
              clientId: 'one',
              connectionId: 'one_connid',
              id: 'one_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 16,
          channel: channelName,
          channelSerial: 'serial:',
          presence: [
            {
              action: 1,
              clientId: 'two',
              connectionId: 'two_connid',
              id: 'two_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      await new Promise(function (resolve, reject) {
        var done = function (err) {
          err ? reject(err) : resolve();
        };

        Helper.whenPromiseSettles(channel.presence.get(), function (err, results) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          try {
            expect(results.length).to.equal(2, 'Check correct number of results');
            expect(channel.presence.syncComplete, 'Check in sync').to.be.ok;
            expect(extractClientIds(results)).to.deep.equal(['one', 'two'], 'check expected presence members');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });
    });

    /**
     * Presence message that will be in the sync arrives as a normal message, before it comes in the sync.
     * Related to RTP2f, RTP18a, RTP18b, RTP2d.
     *
     * @nospec
     */
    it('sync_member_arrives_normally_before_comes_in_sync', async function () {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ autoConnect: false }),
        channelName = 'sync_member_arrives_normally_before_comes_in_sync',
        channel = realtime.channels.get(channelName);

      helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 11,
          channel: channelName,
          flags: 1,
        }),
      );

      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 16,
          channel: channelName,
          channelSerial: 'serial:cursor',
          presence: [
            {
              action: 1,
              clientId: 'one',
              connectionId: 'one_connid',
              id: 'one_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          presence: [
            {
              action: 2,
              clientId: 'two',
              connectionId: 'two_connid',
              id: 'two_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 16,
          channel: channelName,
          channelSerial: 'serial:',
          presence: [
            {
              action: 1,
              clientId: 'two',
              connectionId: 'two_connid',
              id: 'two_connid:0:0',
              timestamp: 1e12,
            },
          ],
        }),
      );

      await new Promise(function (resolve, reject) {
        var done = function (err) {
          err ? reject(err) : resolve();
        };

        Helper.whenPromiseSettles(channel.presence.get(), function (err, results) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          try {
            expect(results.length).to.equal(2, 'Check correct number of results');
            expect(channel.presence.syncComplete, 'Check in sync').to.be.ok;
            expect(extractClientIds(results)).to.deep.equal(['one', 'two'], 'check expected presence members');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });
    });

    /**
     * Get several presence messages with various combinations of msgserial,
     * index, and synthesized leaves, check that the end result is correct.
     *
     * @spec RTP2a
     * @spec RTP2b1
     * @spec RTP2b1a
     * @spec RTP2b2
     * @spec RTP2c
     */
    it('presence_ordering', async function () {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ autoConnect: false }),
        channelName = 'sync_ordering',
        channel = realtime.channels.get(channelName);

      helper.recordPrivateApi('call.makeProtocolMessageFromDeserialized');
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 11,
          channel: channelName,
        }),
      );

      /* One enters */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          id: 'one_connid:1',
          connectionId: 'one_connid',
          timestamp: 1e12,
          presence: [
            {
              action: 2,
              clientId: 'one',
            },
          ],
        }),
      );

      /* An earlier leave from one (should be ignored) */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          connectionId: 'one_connid',
          id: 'one_connid:0',
          timestamp: 1e12,
          presence: [
            {
              action: 3,
              clientId: 'one',
            },
          ],
        }),
      );

      /* One adds some data in a newer msgSerial */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          connectionId: 'one_connid',
          id: 'one_connid:2',
          timestamp: 1e12,
          presence: [
            {
              action: 4,
              clientId: 'one',
              data: 'onedata',
            },
          ],
        }),
      );

      /* Two enters */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          connectionId: 'two_connid',
          id: 'two_connid:0',
          timestamp: 1e12,
          presence: [
            {
              action: 2,
              clientId: 'two',
            },
          ],
        }),
      );

      /* Two updates twice in the same message */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          connectionId: 'two_connid',
          id: 'two_connid:0',
          timestamp: 1e12,
          presence: [
            {
              action: 4,
              clientId: 'two',
              data: 'twowrongdata',
            },
            {
              action: 4,
              clientId: 'two',
              data: 'twodata',
            },
          ],
        }),
      );

      /* Three enters */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          connectionId: 'three_connid',
          id: 'three_connid:99',
          timestamp: 1e12,
          presence: [
            {
              action: 2,
              clientId: 'three',
            },
          ],
        }),
      );

      /* Synthesized leave for three (with earlier msgSerial, incompatible id,
       * and later timestamp) */
      helper.recordPrivateApi('call.channel.processMessage');
      await channel.processMessage(
        createPM({
          action: 14,
          channel: channelName,
          connectionId: 'synthesized',
          id: 'synthesized:0',
          timestamp: 1e12 + 1,
          presence: [
            {
              action: 3,
              clientId: 'three',
              connectionId: 'three_connid',
            },
          ],
        }),
      );

      await new Promise(function (resolve, reject) {
        var done = function (err) {
          err ? reject(err) : resolve();
        };
        Helper.whenPromiseSettles(channel.presence.get(), function (err, results) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          try {
            expect(results.length).to.equal(2, 'Check correct number of results');
            expect(channel.presence.syncComplete, 'Check in sync').to.be.ok;
            expect(extractClientIds(results)).to.deep.equal(['one', 'two'], 'check expected presence members');
            expect(extractMember(results, 'one').data).to.equal('onedata', 'check correct data on one');
            expect(extractMember(results, 'two').data).to.equal('twodata', 'check correct data on two');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      });
    });

    /**
     * Do a 110-member sync, so split into two sync messages. Inject a normal
     * presence enter between the syncs. Check everything was entered correctly.
     *
     * @specpartial RTP4 - not enough members tested, should be 250
     */
    it('presence_sync_interruptus', function (done) {
      const helper = this.test.helper;
      var channelName = 'presence_sync_interruptus';
      var interrupterClientId = 'dark_horse';
      var enterer = helper.AblyRealtime();
      var syncer = helper.AblyRealtime();
      var entererChannel = enterer.channels.get(channelName);
      var syncerChannel = syncer.channels.get(channelName);

      /* Resolved once the injected presence enter is processed, so presence.get() below waits for
       * it rather than racing it (a single-frame sync completes before the injection, so the map
       * could otherwise be read before dark_horse is added). */
      var injectionDone;
      var injectionComplete = new Promise(function (resolve) {
        injectionDone = resolve;
      });

      function waitForBothConnect(cb) {
        async.parallel(
          [
            function (connectCb) {
              enterer.connection.on('connected', connectCb);
            },
            function (connectCb) {
              syncer.connection.on('connected', connectCb);
            },
          ],
          function () {
            cb();
          },
        );
      }

      async.series(
        [
          waitForBothConnect,
          function (cb) {
            Helper.whenPromiseSettles(entererChannel.attach(), cb);
          },
          function (cb) {
            async.times(
              110,
              function (i, presCb) {
                Helper.whenPromiseSettles(entererChannel.presence.enterClient(i.toString(), null), presCb);
              },
              cb,
            );
          },
          function (cb) {
            var originalProcessMessage = syncerChannel.processMessage;
            helper.recordPrivateApi('replace.channel.processMessage');
            syncerChannel.processMessage = async function (message) {
              helper.recordPrivateApi('call.channel.processMessage');
              await originalProcessMessage.apply(this, arguments);
              /* Inject an additional presence message after the first sync */
              if (message.action === 16) {
                helper.recordPrivateApi('replace.channel.processMessage');
                syncerChannel.processMessage = originalProcessMessage;
                helper.recordPrivateApi('call.channel.processMessage');
                await syncerChannel.processMessage(
                  createPM({
                    action: 14,
                    id: 'messageid:0',
                    connectionId: 'connid',
                    timestamp: 2000000000000,
                    presence: [
                      {
                        clientId: interrupterClientId,
                        action: 2,
                      },
                    ],
                  }),
                );
                injectionDone();
              }
            };
            Helper.whenPromiseSettles(syncerChannel.attach(), cb);
          },
          function (cb) {
            var getAfterInjection = injectionComplete.then(function () {
              return syncerChannel.presence.get();
            });
            Helper.whenPromiseSettles(getAfterInjection, function (err, presenceSet) {
              try {
                expect(presenceSet && presenceSet.length).to.equal(111, 'Check everyone’s in presence set');
              } catch (err) {
                cb(err);
                return;
              }
              cb(err);
            });
          },
        ],
        function (err) {
          helper.closeAndFinish(done, [enterer, syncer], err);
        },
      );
    });
  });
});
