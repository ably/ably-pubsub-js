'use strict';

define(['shared_helper', 'async', 'chai'], function (Helper, async, chai) {
  var expect = chai.expect;
  var goodHost;

  describe('rest/fallbacks', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }
        goodHost = helper.AblyRest().options.primaryDomain;
        done();
      });
    });

    /**
     * @spec RSC15f
     */
    it('Store working fallback', async function () {
      const helper = this.test.helper;
      var rest = helper.AblyRest({
        endpoint: helper.unroutableHost,
        fallbackHosts: [goodHost],
        httpRequestTimeout: 3000,
      });
      var validUntil;
      var serverTime = await rest.time();
      expect(serverTime, 'Check serverTime returned').to.be.ok;
      helper.recordPrivateApi('read.rest._currentFallback');
      var currentFallback = rest._currentFallback;
      expect(currentFallback, 'Check current fallback stored').to.be.ok;
      helper.recordPrivateApi('read.rest._currentFallback.host');
      expect(currentFallback && currentFallback.host).to.equal(goodHost, 'Check good host set');
      helper.recordPrivateApi('read.rest._currentFallback.validUntil');
      validUntil = currentFallback.validUntil;
      /* now try again, check that this time it uses the remembered good endpoint straight away */
      var serverTime = await rest.time();
      expect(serverTime, 'Check serverTime returned').to.be.ok;
      var currentFallback = rest._currentFallback;
      helper.recordPrivateApi('read.rest._currentFallback.validUntil');
      expect(currentFallback.validUntil).to.equal(
        validUntil,
        'Check validUntil is the same (implying currentFallback has not been re-set)',
      );
      /* set the validUntil to the past and check that the stored fallback is forgotten */
      var now = Date.now();
      helper.recordPrivateApi('write.rest._currentFallback.validUntil');
      rest._currentFallback.validUntil = now - 1000;
      var serverTime = await rest.time();
      expect(serverTime, 'Check serverTime returned').to.be.ok;
      helper.recordPrivateApi('read.rest._currentFallback');
      var currentFallback = rest._currentFallback;
      expect(currentFallback, 'Check current fallback re-stored').to.be.ok;
      helper.recordPrivateApi('read.rest._currentFallback.host');
      expect(currentFallback && currentFallback.host).to.equal(goodHost, 'Check good host set again');
      helper.recordPrivateApi('read.rest._currentFallback.validUntil');
      expect(currentFallback.validUntil > now, 'Check validUntil has been re-set').to.be.ok;
    });

    /**
     * @spec RSC25
     * @spec RTN17i
     */
    it('Should use the primary domain as the first attempted for every connection attempt', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({
        endpoint: helper.unroutableHost,
        fallbackHosts: [goodHost],
        httpRequestTimeout: 3000,
      });
      const originDoUri = rest.http.doUri.bind(rest.http);
      const recordedHttpRequests = [];

      rest.http.doUri = (method, uri, ...rest) => {
        recordedHttpRequests.push(uri);
        return originDoUri(method, uri, ...rest);
      };

      await rest.time();
      expect(recordedHttpRequests.length).to.be.eq(2);
      expect(recordedHttpRequests[0]).to.be.eq(`https://${helper.unroutableHost}:443/time`);
      expect(recordedHttpRequests[1]).to.be.eq('https://sandbox.realtime.ably-nonprod.net:443/time');

      recordedHttpRequests.length = 0;
      helper.recordPrivateApi('write.rest._currentFallback.validUntil');
      rest._currentFallback.validUntil = Date.now() - 1000;

      await rest.time();
      expect(recordedHttpRequests.length).to.be.eq(2);
      expect(recordedHttpRequests[0]).to.be.eq(`https://${helper.unroutableHost}:443/time`);
      expect(recordedHttpRequests[1]).to.be.eq('https://sandbox.realtime.ably-nonprod.net:443/time');
    });

    describe('Max elapsed time for host retries', function () {
      /** @spec TO3l6 */
      it('can timeout after default host', async function () {
        const helper = this.test.helper;
        const httpRequestTimeout = 1000;
        // set httpMaxRetryDuration lower than httpRequestTimeout so it would timeout after default host attempt
        const httpMaxRetryDuration = Math.floor(httpRequestTimeout / 2);
        const rest = helper.AblyRest({
          endpoint: helper.unroutableHost,
          fallbackHosts: [helper.unroutableHost],
          httpRequestTimeout,
          httpMaxRetryDuration,
        });

        let thrownError = null;
        try {
          // we expect it to fail due to max elapsed time reached for host retries
          await rest.time();
        } catch (error) {
          thrownError = error;
        }

        expect(thrownError).not.to.be.null;
        expect(thrownError.message).to.equal(
          `Timeout for trying fallback hosts retries. Total elapsed time exceeded the ${httpMaxRetryDuration}ms limit`,
        );
      });

      /** @spec TO3l6 */
      it('can timeout after fallback host retries', async function () {
        const helper = this.test.helper;
        const httpRequestTimeout = 1000;
        // set httpMaxRetryDuration higher than httpRequestTimeout and lower than 2*httpRequestTimeout so it would timeout after first fallback host retry attempt
        const httpMaxRetryDuration = Math.floor(httpRequestTimeout * 1.5);
        const rest = helper.AblyRest({
          endpoint: helper.unroutableHost,
          fallbackHosts: [helper.unroutableHost, helper.unroutableHost],
          httpRequestTimeout,
          httpMaxRetryDuration,
        });

        let thrownError = null;
        try {
          // we expect it to fail due to max elapsed time reached for host retries
          await rest.time();
        } catch (error) {
          thrownError = error;
        }

        expect(thrownError).not.to.be.null;
        expect(thrownError.message).to.equal(
          `Timeout for trying fallback hosts retries. Total elapsed time exceeded the ${httpMaxRetryDuration}ms limit`,
        );
      });
    });
  });
});
