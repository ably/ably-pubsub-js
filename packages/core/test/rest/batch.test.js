'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  var expect = chai.expect;

  describe('rest/batchPublish', function () {
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

    describe('when invoked with an array of specs', function () {
      /**
       * @spec RSC22
       * @spec BAR2a
       * @spec BAR2b
       * @spec BAR2c
       * @spec BSP2a
       * @spec BSP2b
       * @spec BPR2a
       * @spec BPR2b
       * @spec BPF2a
       * @spec BPF2b
       * @specpartial RSC22c - test passing an array of BatchPublishSpec
       * @specpartial RSC22b - test returns an array of BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>
       */
      it('performs a batch publish and returns an array of results', async function () {
        const helper = this.test.helper;
        const testApp = helper.getTestApp();
        const rest = helper.AblyRest({
          promises: true,
          key: testApp.keys[2].keyStr /* we use this key so that some publishes fail due to capabilities */,
        });

        const specs = [
          {
            channels: [
              'channel0' /* key allows publishing to this channel */,
              'channel3' /* key does not allow publishing to this channel */,
            ],
            messages: [{ data: 'message1' }, { data: 'message2' }],
          },
          {
            channels: [
              'channel4' /* key allows publishing to this channel */,
              'channel5' /* key does not allow publishing to this channel */,
            ],
            messages: [{ data: 'message3' }, { data: 'message4' }],
          },
        ];

        // First, we perform the batch publish request...
        const batchResults = await rest.batchPublish(specs);

        expect(batchResults).to.have.lengthOf(specs.length);

        expect(batchResults[0].successCount).to.equal(1);
        expect(batchResults[0].failureCount).to.equal(1);

        // Check the results of first BatchPublishSpec

        expect(batchResults[0].results).to.have.lengthOf(2);

        expect(batchResults[0].results[0].channel).to.equal('channel0');
        expect(batchResults[0].results[0].messageId).to.not.be.empty;
        expect('error' in batchResults[0].results[0]).to.be.false;

        expect(batchResults[0].results[1].channel).to.equal('channel3');
        expect('messageId' in batchResults[0].results[1]).to.be.false;
        expect(batchResults[0].results[1].error.statusCode).to.equal(401);

        // Check the results of second BatchPublishSpec

        expect(batchResults[1].results).to.have.lengthOf(2);

        expect(batchResults[1].results[0].channel).to.equal('channel4');
        expect(batchResults[1].results[0].messageId).to.not.be.empty;
        expect('error' in batchResults[1].results[0]).to.be.false;

        expect(batchResults[1].results[1].channel).to.equal('channel5');
        expect('messageId' in batchResults[1].results[1]).to.be.false;
        expect(batchResults[1].results[1].error.statusCode).to.equal(401);

        // ...and now we use channel history to check that the expected messages have been published.
        const verificationRest = helper.AblyRest({ promises: true });

        const channel0 = verificationRest.channels.get('channel0');
        const channel0HistoryPromise = channel0.history({ limit: 2 });

        const channel4 = verificationRest.channels.get('channel4');
        const channel4HistoryPromise = channel4.history({ limit: 2 });

        const [channel0History, channel4History] = await Promise.all([channel0HistoryPromise, channel4HistoryPromise]);

        const channel0HistoryData = new Set([channel0History.items[0].data, channel0History.items[1].data]);
        expect(channel0HistoryData).to.deep.equal(new Set(['message1', 'message2']));

        const channel4HistoryData = new Set([channel4History.items[0].data, channel4History.items[1].data]);
        expect(channel4HistoryData).to.deep.equal(new Set(['message3', 'message4']));
      });
    });

    describe('when invoked with a single spec', function () {
      /**
       * @spec RSC22
       * @spec BAR2a
       * @spec BAR2b
       * @spec BAR2c
       * @spec BSP2a
       * @spec BSP2b
       * @spec BPR2a
       * @spec BPR2b
       * @spec BPF2a
       * @spec BPF2b
       * @specpartial RSC22c - test passing a single BatchPublishSpec
       * @specpartial RSC22b - test returns a single BatchResult<BatchPublishSuccessResult | BatchPublishFailureResult>
       */
      it('performs a batch publish and returns a single result', async function () {
        const helper = this.test.helper;
        const testApp = helper.getTestApp();
        const rest = helper.AblyRest({
          promises: true,
          key: testApp.keys[2].keyStr /* we use this key so that some publishes fail due to capabilities */,
        });

        const spec = {
          channels: [
            'channel0' /* key allows publishing to this channel */,
            'channel3' /* key does not allow publishing to this channel */,
          ],
          messages: [{ data: 'message1' }, { data: 'message2' }],
        };

        // First, we perform the batch publish request...
        const batchResult = await rest.batchPublish(spec);

        expect(batchResult.successCount).to.equal(1);
        expect(batchResult.failureCount).to.equal(1);

        expect(batchResult.results).to.have.lengthOf(2);

        expect(batchResult.results[0].channel).to.equal('channel0');
        expect(batchResult.results[0].messageId).to.not.be.empty;
        expect('error' in batchResult.results[0]).to.be.false;

        expect(batchResult.results[1].channel).to.equal('channel3');
        expect('messageId' in batchResult.results[1]).to.be.false;
        expect(batchResult.results[1].error.statusCode).to.equal(401);

        // ...and now we use channel history to check that the expected messages have been published.
        const verificationRest = helper.AblyRest({ promises: true });
        const channel0 = verificationRest.channels.get('channel0');
        const channel0History = await channel0.history({ limit: 2 });

        const channel0HistoryData = new Set([channel0History.items[0].data, channel0History.items[1].data]);
        expect(channel0HistoryData).to.deep.equal(new Set(['message1', 'message2']));
      });
    });
  });

  describe('rest/batchPresence', function () {
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
     * @spec RSC24
     * @spec BAR2a
     * @spec BAR2b
     * @spec BAR2c
     * @spec BGR2a
     * @spec BGR2b
     * @spec BGF2a
     * @spec BGF2b
     */
    it('performs a batch presence fetch and returns a result', async function () {
      const helper = this.test.helper;
      const testApp = helper.getTestApp();
      const rest = helper.AblyRest({
        promises: true,
        key: testApp.keys[2].keyStr /* we use this key so that some presence fetches fail due to capabilities */,
      });

      const presenceEnterRealtime = helper.AblyRealtime({
        promises: true,
        clientId:
          'batchPresenceTest' /* note that the key used here has no capability limitations, so that we can use this instance to enter presence below */,
      });

      const channelNames = [
        'channel0' /* key does not allow presence on this channel */,
        'channel4' /* key allows presence on this channel */,
      ];

      // First, we enter presence on two channels...
      await presenceEnterRealtime.channels.get('channel0').presence.enter();
      await presenceEnterRealtime.channels.get('channel4').presence.enter();

      // ...and now we perform the batch presence request.
      const batchResult = await rest.batchPresence(channelNames);

      expect(batchResult.successCount).to.equal(1);
      expect(batchResult.failureCount).to.equal(1);

      // Check that the channel0 presence fetch request fails (due to key’s capabilities, as mentioned above)

      expect(batchResult.results[0].channel).to.equal('channel0');
      expect('presence' in batchResult.results[0]).to.be.false;
      expect(batchResult.results[0].error.statusCode).to.equal(401);

      // Check that the channel4 presence fetch request reflects the presence enter performed above

      expect(batchResult.results[1].channel).to.equal('channel4');
      expect(batchResult.results[1].presence).to.have.lengthOf(1);
      expect(batchResult.results[1].presence[0].clientId).to.equal('batchPresenceTest');
      expect('error' in batchResult.results[1]).to.be.false;

      await new Promise((resolve, reject) => {
        helper.closeAndFinish((err) => {
          err ? reject(err) : resolve();
        }, presenceEnterRealtime);
      });
    });
  });

  describe('rest/revokeTokens', function () {
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
     * @spec RSA17
     * @spec RSA17c
     * @spec TRT2a
     * @spec TRT2b
     * @spec BAR2a
     * @spec BAR2b
     * @spec BAR2c
     * @spec TRS2a
     * @spec TRS2b
     * @spec TRS2c
     * @spec TRF2a
     * @spec TRF2b
     * @specpartial RSA17g - test passing an array of TokenRevocationTargetSpecifier
     */
    it('revokes tokens matching the given specifiers', async function () {
      const helper = this.test.helper;
      const testApp = helper.getTestApp();
      const rest = helper.AblyRest({
        promises: true,
        key: testApp.keys[4].keyStr /* this key has revocableTokens enabled */,
      });

      const clientId1 = `clientId1-${Helper.randomString()}`;
      const clientId2 = `clientId2-${Helper.randomString()}`;

      // First, we fetch tokens for a couple of different clientIds...
      const [clientId1TokenDetails, clientId2TokenDetails] = await Promise.all([
        rest.auth.requestToken({ clientId: clientId1 }),
        rest.auth.requestToken({ clientId: clientId2 }),
      ]);

      // ...then, we set up Realtime instances that use these tokens and wait for them to become CONNECTED...
      const clientId1Realtime = helper.AblyRealtime({
        promises: true,
        token: clientId1TokenDetails,
      });
      const clientId2Realtime = helper.AblyRealtime({
        promises: true,
        token: clientId2TokenDetails,
      });

      await Promise.all([
        clientId1Realtime.connection.once('connected'),
        clientId2Realtime.connection.once('connected'),
      ]);

      // ...then, we set up listeners that will record the state change when these Realtime instances become DISCONNECTED (we need to set up these listeners here, before performing the revocation request, else we might miss the DISCONNECTED state changes that the token revocation provokes, and end up only seeing the subsequent RSA4a2-induced FAILED state change, which due to https://github.com/ably/ably-js/issues/1409 does not expose the 40141 "token revoked" error code)...
      //
      // Note:
      //
      // We use Realtime instances for verifying the side effects of a token revocation, as opposed to, say, trying to perform a REST request, because the nature of the Ably service is that token revocation may take a small delay to become active, and so there's no guarantee that a REST request peformed immediately after a revocation request would fail. See discussion at https://ably-real-time.slack.com/archives/C030C5YLY/p1690322740850269?thread_ts=1690315022.372729&cid=C030C5YLY.
      const clientId1RealtimeDisconnectedStateChangePromise = clientId1Realtime.connection.once('disconnected');
      const clientId2RealtimeDisconnectedStateChangePromise = clientId2Realtime.connection.once('disconnected');

      // ...then, we revoke all tokens for these clientIds...

      const specifiers = [
        { type: 'clientId', value: clientId1 },
        { type: 'clientId', value: clientId2 },
        { type: 'invalidType', value: 'abc' }, // we include an invalid specifier type to provoke a non-zero failureCount
      ];

      const result = await rest.auth.revokeTokens(specifiers);

      // ...and check the response from the revocation request...
      expect(result.successCount).to.equal(2);
      expect(result.failureCount).to.equal(1);
      expect(result.results).to.have.lengthOf(3);

      expect(result.results[0].target).to.equal(`clientId:${clientId1}`);
      expect(typeof result.results[0].issuedBefore).to.equal('number');
      expect(typeof result.results[0].appliesAt).to.equal('number');
      expect('error' in result.results[0]).to.be.false;

      expect(result.results[1].target).to.equal(`clientId:${clientId2}`);
      expect(typeof result.results[1].issuedBefore).to.equal('number');
      expect(typeof result.results[1].appliesAt).to.equal('number');
      expect('error' in result.results[1]).to.be.false;

      expect(result.results[2].target).to.equal('invalidType:abc');
      expect(result.results[2].error.statusCode).to.equal(400);

      // ...and then, we check that the Realtime instances transition to the DISCONNECTED state due to a "token revoked" (40141) error.
      const [clientId1RealtimeDisconnectedStateChange, clientId2RealtimeDisconnectedStateChange] = await Promise.all([
        clientId1RealtimeDisconnectedStateChangePromise,
        clientId2RealtimeDisconnectedStateChangePromise,
      ]);

      expect(clientId1RealtimeDisconnectedStateChange.reason.code).to.equal(40141 /* token revoked */);
      expect(clientId2RealtimeDisconnectedStateChange.reason.code).to.equal(40141 /* token revoked */);

      await Promise.all(
        [clientId1Realtime, clientId2Realtime].map((realtime) => {
          new Promise((resolve, reject) => {
            helper.closeAndFinish((err) => {
              err ? reject(err) : resolve();
            }, realtime);
          });
        }),
      );
    });

    /**
     * Spec is missing for documenting that allowReauthMargin will delay token revocation by 30 seconds.
     *
     * @spec RSA17
     * @spec RSA17e
     * @spec RSA17f
     * @spec TRS2b
     * @spec TRS2c
     */
    it('accepts optional issuedBefore and allowReauthMargin parameters', async function () {
      const helper = this.test.helper;
      const testApp = helper.getTestApp();
      const rest = helper.AblyRest({
        promises: true,
        key: testApp.keys[4].keyStr /* this key has revocableTokens enabled */,
      });

      const clientId = `clientId-${Helper.randomString()}`;

      const serverTimeAtStartOfTest = await rest.time();
      const issuedBefore = serverTimeAtStartOfTest - 20 * 60 * 1000; // i.e. ~20 minutes ago (arbitrarily chosen)

      const result = await rest.auth.revokeTokens([{ type: 'clientId', value: clientId }], {
        issuedBefore,
        allowReauthMargin: true,
      });

      expect(result.results[0].issuedBefore).to.equal(issuedBefore);

      // Verify the expected side effect of allowReauthMargin, which is to delay the revocation by 30 seconds
      const serverTimeThirtySecondsAfterStartOfTest = serverTimeAtStartOfTest + 30 * 1000;
      expect(result.results[0].appliesAt).to.be.greaterThan(serverTimeThirtySecondsAfterStartOfTest);
    });

    /**
     * @spec RSA17
     * @spec RSA17d
     */
    it('throws an error when using token auth', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest({
        useTokenAuth: true,
      });

      let verifiedError = false;
      try {
        await rest.auth.revokeTokens([{ type: 'clientId', value: 'clientId1' }], function () {});
      } catch (err) {
        expect(err.statusCode).to.equal(401);
        expect(err.code).to.equal(40162);
        verifiedError = true;
      }

      expect(verifiedError).to.be.true;
    });
  });
});
