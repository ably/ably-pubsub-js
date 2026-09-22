'use strict';

define(['shared_helper', 'chai'], function (Helper, chai) {
  var rest;
  var expect = chai.expect;

  var lastYear = new Date().getUTCFullYear() - 1;

  // Set last interval to 3rd Feb 20xx 16:03:00, JavaScript uses zero based months
  var firstIntervalEpoch = Date.UTC(lastYear, 1, 3, 15, 3, 0);

  var statsFixtures = [
    {
      intervalId: lastYear + '-02-03:15:03',
      inbound: { realtime: { messages: { count: 50, data: 5000 } } },
      outbound: { realtime: { messages: { count: 20, data: 2000 } } },
    },
    {
      intervalId: lastYear + '-02-03:15:04',
      inbound: { realtime: { messages: { count: 60, data: 6000 } } },
      outbound: { realtime: { messages: { count: 10, data: 1000 } } },
    },
    {
      intervalId: lastYear + '-02-03:15:05',
      inbound: { realtime: { messages: { count: 70, data: 7000 } } },
      outbound: { realtime: { messages: { count: 40, data: 4000 } } },
      persisted: { presence: { count: 20, data: 2000 } },
      connections: { tls: { peak: 20, opened: 10 } },
      channels: { peak: 50, opened: 30 },
      apiRequests: { succeeded: 50, failed: 10 },
      tokenRequests: { succeeded: 60, failed: 20 },
    },
  ];

  //Skip a month for the generated tests
  var secondIntervalDate = new Date(lastYear, 2, 3, 15, 6, 0);
  var secondIntervalEpoch = Date.UTC(lastYear, 2, 3, 15, 6, 0);

  var dateId;

  for (var i = 0; i < 2; i++) {
    secondIntervalDate.setMinutes(secondIntervalDate.getMinutes() + 1);
    dateId =
      secondIntervalDate.getFullYear() +
      '-' +
      ('0' + (secondIntervalDate.getMonth() + 1)).slice(-2) +
      '-' +
      ('0' + secondIntervalDate.getDate()).slice(-2) +
      ':' +
      ('0' + secondIntervalDate.getHours()).slice(-2) +
      ':' +
      ('0' + secondIntervalDate.getMinutes()).slice(-2);

    statsFixtures.push({
      intervalId: dateId,
      inbound: { realtime: { messages: { count: 15, data: 4000 } } },
      outbound: { realtime: { messages: { count: 33, data: 3000 } } },
    });
  }

  describe('rest/stats', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      // force a new app to be created with first argument true so that stats are not effected by other tests
      const helper = Helper.forHook(this);
      helper.setupApp(true, function () {
        rest = helper.AblyRest();
        helper.createStats(helper.getTestApp(), statsFixtures, function (err) {
          if (err) {
            done(err);
            return;
          }
          done();
        });
      });
    });

    /**
     * @spec TS12
     * @spec TS12r
     * @spec TS12s
     * @spec TS12t
     * @spec TS12q
     * @spec TS12c
     * @spec TS12a
     */
    it('contains expected fields', async () => {
      // To provoke a non-undefined `inProgress` in the response, we publish a message and fetch stats for the current hour. (I wasn’t able to provoke a non-undefined `inProgress` using stats API fixtures.)
      const now = new Date(await rest.time());
      // If the hour is about to turn, wait for it to turn (with a 5-second extra wait to hopefully account for clock differences between Ably servers).
      if (now.getUTCMinutes() === 59 && now.getUTCSeconds() > 45) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * (5 + (60 - now.getUTCSeconds()))));
      }
      await rest.channels.get('channel').publish('message', 'data');
      // ably.com documentation says "The most recent statistics are delayed by up to six seconds."
      await new Promise((resolve) => setTimeout(resolve, 6000 + 4000 /* a bit of extra tolerance */));

      const stats = (await rest.stats({ end: Date.now(), unit: 'hour' })).items[0];

      expect(stats.entries).to.be.a('object');
      expect(stats.schema).to.be.a('string');
      expect(stats.appId).to.be.a('string');
      expect(stats.inProgress).to.be.a('string');
      expect(stats.unit).to.be.a('string');
      expect(stats.intervalId).to.be.a('string');
    });

    /**
     * Using an interval ID string format, check minute-level inbound and outbound stats match fixture data (forwards)
     * @spec RSC6b4
     */
    it('appstats_minute0', async function () {
      var page = await rest.stats({
        start: lastYear + '-02-03:15:03',
        end: lastYear + '-02-03:15:05',
        direction: 'forwards',
      });
      var stats = page.items;
      expect(stats.length).to.equal(3, 'Verify 3 stat records found');

      var totalInbound = 0,
        totalOutbound = 0;
      for (var i = 0; i < stats.length; i++) {
        totalInbound += stats[i].entries['messages.inbound.all.messages.count'];
        totalOutbound += stats[i].entries['messages.outbound.all.messages.count'];
      }

      expect(totalInbound).to.equal(50 + 60 + 70, 'Verify all inbound messages found');
      expect(totalOutbound).to.equal(20 + 10 + 40, 'Verify all outbound messages found');
    });

    /**
     * Using milliseconds since epoch, check minute-level inbound and outbound stats match fixture data (forwards)
     * @spec RSC6b4
     */
    it('appstats_minute1', async function () {
      var page = await rest.stats({
        start: firstIntervalEpoch,
        end: secondIntervalEpoch,
        direction: 'forwards',
      });
      var stats = page.items;
      expect(stats.length).to.equal(3, 'Verify 3 stat records found');

      var totalInbound = 0,
        totalOutbound = 0;
      for (var i = 0; i < stats.length; i++) {
        totalInbound += stats[i].entries['messages.inbound.all.messages.count'];
        totalOutbound += stats[i].entries['messages.outbound.all.messages.count'];
      }

      expect(totalInbound).to.equal(50 + 60 + 70, 'Verify all inbound messages found');
      expect(totalOutbound).to.equal(20 + 10 + 40, 'Verify all outbound messages found');
    });

    /**
     * Check hour-level inbound and outbound stats match fixture data (forwards)
     * @spec RSC6b4
     */
    it('appstats_hour0', async function () {
      var page = await rest.stats({
        start: lastYear + '-02-03:15',
        end: lastYear + '-02-03:18',
        direction: 'forwards',
        by: 'hour',
      });
      var stats = page.items;
      expect(stats.length).to.equal(1, 'Verify 1 stat record found');

      var totalInbound = 0,
        totalOutbound = 0;
      for (var i = 0; i < stats.length; i++) {
        totalInbound += stats[i].entries['messages.inbound.all.messages.count'];
        totalOutbound += stats[i].entries['messages.outbound.all.messages.count'];
      }

      expect(totalInbound).to.equal(50 + 60 + 70, 'Verify all inbound messages found');
      expect(totalOutbound).to.equal(20 + 10 + 40, 'Verify all outbound messages found');
    });

    /**
     * Check day-level stats exist (forwards)
     * @spec RSC6b4
     * @specskip
     */
    it.skip('appstats_day0', async function () {
      var page = await rest.stats({
        end: lastYear + '-02-03',
        direction: 'forwards',
        by: 'day',
      });
      var stats = page.items;
      expect(stats.length == 1, 'Verify 1 stat records found').to.be.ok;

      var totalInbound = 0,
        totalOutbound = 0;
      for (var i = 0; i < stats.length; i++) {
        totalInbound += stats[i].entries['messages.inbound.all.messages.count'];
        totalOutbound += stats[i].entries['messages.outbound.all.messages.count'];
      }

      expect(totalInbound).to.equal(50 + 60 + 70, 'Verify all inbound messages found');
      expect(totalOutbound).to.equal(20 + 10 + 40, 'Verify all outbound messages found');
    });

    /**
     * Check month-level stats exist (forwards)
     * @spec RSC6b4
     * @specskip
     */
    it.skip('appstats_month0', async function () {
      var page = await rest.stats({
        end: lastYear + '-02',
        direction: 'forwards',
        by: 'month',
      });
      var stats = page.items;
      expect(stats.length == 1, 'Verify 1 stat records found').to.be.ok;

      var totalInbound = 0,
        totalOutbound = 0;
      for (var i = 0; i < stats.length; i++) {
        totalInbound += stats[i].entries['messages.inbound.all.messages.count'];
        totalOutbound += stats[i].entries['messages.outbound.all.messages.count'];
      }

      expect(totalInbound).to.equal(50 + 60 + 70, 'Verify all inbound messages found');
      expect(totalOutbound).to.equal(20 + 10 + 40, 'Verify all outbound messages found');
    });

    /**
     * Check limit query param (backwards)
     * @spec RSC6b3
     */
    it('appstats_limit_backwards', async function () {
      var page = await rest.stats({
        end: lastYear + '-02-03:15:04',
        direction: 'backwards',
        limit: 1,
      });
      var stats = page.items;
      expect(stats.length == 1, 'Verify 1 stat records found').to.be.ok;

      var totalInbound = 0,
        totalOutbound = 0;
      for (var i = 0; i < stats.length; i++) {
        totalInbound += stats[i].entries['messages.inbound.all.messages.count'];
        totalOutbound += stats[i].entries['messages.outbound.all.messages.count'];
      }

      expect(totalInbound).to.equal(60, 'Verify all inbound messages found');
      expect(totalOutbound).to.equal(10, 'Verify all outbound messages found');
    });

    /**
     * Check limit query param (forwards)
     * @spec RSC6b3
     */
    it('appstats_limit_forwards', async function () {
      var page = await rest.stats({
        end: lastYear + '-02-03:15:04',
        direction: 'forwards',
        limit: 1,
      });
      var stats = page.items;
      expect(stats.length == 1, 'Verify 1 stat records found').to.be.ok;

      var totalInbound = 0,
        totalOutbound = 0;
      for (var i = 0; i < stats.length; i++) {
        totalInbound += stats[i].entries['messages.inbound.all.messages.count'];
        totalOutbound += stats[i].entries['messages.outbound.all.messages.count'];
      }

      expect(totalInbound).to.equal(50, 'Verify all inbound messages found');
      expect(totalOutbound).to.equal(20, 'Verify all outbound messages found');
    });

    /**
     * Check query pagination (backwards)
     * @spec RSC6b2
     */
    it('appstats_pagination_backwards', async function () {
      var page = await rest.stats({
        end: lastYear + '-02-03:15:05',
        direction: 'backwards',
        limit: 1,
      });
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(7000, 'Verify all published message data found');

      /* get next page */
      expect(page.hasNext(), 'Verify next page rel link present').to.be.ok;
      var page = await page.next();
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(6000, 'Verify all published message data found');

      /* get next page */
      expect(page.hasNext(), 'Verify next page rel link present').to.be.ok;
      var page = await page.next();
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(5000, 'Verify all published message data found');

      /* verify no further pages */
      expect(page.isLast(), 'Verify last page').to.be.ok;

      var page = await page.first();
      var totalData = 0;
      var stats = page.items;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(7000, 'Verify all published message data found');
    });

    /**
     * Check query pagination (forwards)
     * @spec RSC6b2
     */
    it('appstats_pagination_forwards', async function () {
      var page = await rest.stats({
        end: lastYear + '-02-03:15:05',
        direction: 'forwards',
        limit: 1,
      });
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(5000, 'Verify all published message data found');

      /* get next page */
      expect(page.hasNext(), 'Verify next page rel link present').to.be.ok;
      var page = await page.next();
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(6000, 'Verify all published message data found');

      /* get next page */
      expect(page.hasNext(), 'Verify next page rel link present').to.be.ok;
      var page = await page.next();
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(7000, 'Verify all published message data found');

      /* verify no further pages */
      expect(page.isLast(), 'Verify last page').to.be.ok;

      var page = await page.first();
      var totalData = 0;
      var stats = page.items;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(5000, 'Verify all published message data found');
    });

    /**
     * Check query pagination omitted (defaults to backwards)
     * @spec RSC6b2
     */
    it('appstats_pagination_omitted', async function () {
      var page = await rest.stats({
        end: lastYear + '-02-03:15:05',
        limit: 1,
      });
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(7000, 'Verify all published message data found');

      /* get next page */
      expect(page.hasNext(), 'Verify next page rel link present').to.be.ok;
      var page = await page.next();
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(6000, 'Verify all published message data found');

      /* get next page */
      expect(page.hasNext(), 'Verify next page rel link present').to.be.ok;
      var page = await page.next();
      var stats = page.items;
      expect(stats.length == 1, 'Verify exactly one stats record found').to.be.ok;
      var totalData = 0;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(5000, 'Verify all published message data found');

      /* verify no further pages */
      expect(page.isLast(), 'Verify last page').to.be.ok;

      var page = await page.first();
      var totalData = 0;
      var stats = page.items;
      for (var i = 0; i < stats.length; i++) totalData += stats[i].entries['messages.inbound.all.messages.data'];
      expect(totalData).to.equal(7000, 'Verify all published message data found');
    });
  });
});
