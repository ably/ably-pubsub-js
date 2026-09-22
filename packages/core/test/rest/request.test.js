'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var rest;
  var expect = chai.expect;
  var Defaults = Ably.Rest.Platform.Defaults;

  describe('rest/request', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }
        rest = helper.AblyRest({ useBinaryProtocol: false });
        done();
      });
    });

    /**
     * Related to G1
     *
     * @spec RSC19f1
     * @specpartial RSC7e - tests providing a version value in .request parameters
     * @specpartial CSV2c - tests version is provided in http requests
     */
    Helper.testOnJsonMsgpack('request_version', async function (options, _, helper) {
      const rest = helper.AblyRest(options);
      const version = 150; // arbitrarily chosen

      let savedResolve;
      let savedReject;
      let promise = new Promise((res, rej) => {
        savedResolve = res;
        savedReject = rej;
      });

      async function testRequestHandler(_, __, headers) {
        try {
          expect('X-Ably-Version' in headers, 'Verify version header exists').to.be.ok;
          expect(headers['X-Ably-Version']).to.equal(version.toString(), 'Verify version number sent in request');
          savedResolve();
        } catch (error) {
          savedReject(error);
        }
        return new Promise(() => {});
      }

      helper.recordPrivateApi('replace.rest.http.do');
      rest.http.do = testRequestHandler;

      rest.request('get', '/time' /* arbitrarily chosen */, version, null, null, null);
      await promise;
    });

    /**
     * Related to G1
     *
     * @spec HP3
     * @spec HP4
     * @spec HP5
     * @specpartial RSC19f - basic test for passing a http method, path and version parameters
     */
    Helper.testOnJsonMsgpack('request_time', async function (options, _, helper) {
      const rest = helper.AblyRest(options);
      const res = await rest.request('get', '/time', 3, null, null, null);
      expect(res.statusCode).to.equal(200, 'Check statusCode');
      expect(res.success).to.equal(true, 'Check success');
      expect(Array.isArray(res.items), true, 'Check array returned').to.be.ok;
      expect(res.items.length).to.equal(1, 'Check array was of length 1');
    });

    /**
     * Related to G1, RSC19
     *
     * @spec HP4
     * @spec HP5
     * @spec HP6
     * @spec HP7
     */
    Helper.testOnJsonMsgpack('request_404', async function (options, _, helper) {
      const rest = helper.AblyRest(options);
      /* NB: can't just use /invalid or something as the CORS preflight will
       * fail. Need something superficially a valid path but where the actual
       * request fails */
      const res = await rest.request('get', '/keys/ablyjs.test/requestToken', 3, null, null, null);
      expect(res.success).to.equal(false, 'Check res.success is false for a failure');
      expect(res.statusCode).to.equal(404, 'Check HPR.statusCode is 404');
      expect(res.errorCode).to.equal(40400, 'Check HPR.errorCode is 40400');
      expect(res.errorMessage, 'Check have an HPR.errorMessage').to.be.ok;
    });

    /**
     * With a network issue, should get an actual err, not an HttpPaginatedResponse with error members
     * @spec RSC19e
     */
    it('request_network_error', async function () {
      const helper = this.test.helper;
      rest = helper.AblyRest({ endpoint: helper.unroutableAddress });
      try {
        var res = await rest.request('get', '/time', 3, null, null, null);
      } catch (err) {
        expect(err, 'Check get an err').to.be.ok;
        expect(!res, 'Check do not get a res').to.be.ok;
        return;
      }
      expect.fail('Expected rest.request to throw');
    });

    /**
     * Use the request feature to publish, then retrieve (one at a time), some messages
     * Related to G1
     *
     * @spec HP3
     * @spec HP4
     * @spec HP5
     * @specpartial HP2 - tests overriden .next method only
     * @specpartial RSC19f - more tests with passing other methods, body and parameters
     */
    Helper.testOnJsonMsgpack('request_post_get_messages', async function (options, channelName, helper) {
      const rest = helper.AblyRest(options);
      var channelPath = '/channels/' + channelName + '/messages',
        msgone = { name: 'faye', data: 'whittaker' },
        msgtwo = { name: 'martin', data: 'reed' };

      var res = await rest.request('post', channelPath, 3, null, msgone, null);
      expect(res.statusCode).to.equal(201, 'Check statusCode is 201');
      expect(res.success).to.equal(true, 'Check post was a success');
      expect(res.items && res.items.length).to.equal(1, 'Check number of results is as expected');

      res = await rest.request('post', channelPath, 3, null, msgtwo, null);
      expect(res.statusCode).to.equal(201, 'Check statusCode is 201');
      expect(res.items && res.items.length).to.equal(1, 'Check number of results is as expected');

      res = await rest.request('get', channelPath, 3, { limit: 1, direction: 'forwards' }, null, null);
      expect(res.statusCode).to.equal(200, 'Check statusCode is 200');
      expect(res.items.length).to.equal(1, 'Check only one msg returned');
      expect(res.items[0].name).to.equal(msgone.name, 'Check name is as expected');
      expect(res.items[0].data).to.equal(msgone.data, 'Check data is as expected');
      expect(res.hasNext, 'Check hasNext is true').to.be.ok;

      res = await res.next();
      expect(res.statusCode).to.equal(200, 'Check statusCode is 200');
      expect(res.success).to.equal(true, 'Check success');
      expect(res.items.length).to.equal(1, 'Check only one msg returned');
      expect(res.items[0].name).to.equal(msgtwo.name, 'Check name is as expected');
      expect(res.items[0].data).to.equal(msgtwo.data, 'Check data is as expected');

      /* Finally check the messages the 'normal' way to make sure everything's as expected */
      res = await rest.channels.get(channelName).history();
      expect(res.items.length).to.equal(2, 'Check both msgs returned');
      expect(res.items[0].name).to.equal(msgtwo.name, 'Check name is as expected');
      expect(res.items[0].data).to.equal(msgtwo.data, 'Check data is as expected');
    });

    /**
     * Related to G1
     *
     * @spec HP3
     * @spec HP4
     * @spec HP5
     * @spec HP6
     * @spec HP7
     * @specpartial RSC19f - more tests with POST method and passing body
     */
    Helper.testOnJsonMsgpack('request_batch_api_success', async function (options, name, helper) {
      const rest = helper.AblyRest(options);
      var body = { channels: [name + '1', name + '2'], messages: { data: 'foo' } };

      const res = await rest.request('POST', '/messages', 2, {}, body, {});
      expect(res.success).to.equal(true, 'Check res.success is true for a success');
      expect(res.statusCode).to.equal(201, 'Check res.statusCode is 201 for a success');
      expect(res.errorCode).to.equal(null, 'Check res.errorCode is null for a success');
      expect(res.errorMessage).to.equal(null, 'Check res.errorMessage is null for a success');

      expect(
        !res.items[0].batchResponse,
        'Check no batchResponse, since items is now just a flat array of channel responses',
      ).to.be.ok;
      expect(res.items.length).to.equal(2, 'Verify batched response includes response for each channel');
      expect(!res.items[0].error, 'Verify channel1 response is not an error').to.be.ok;
      expect(res.items[0].channel).to.equal(name + '1', 'Verify channel1 response includes correct channel');
      expect(!res.items[1].error, 'Verify channel2 response is not an error').to.be.ok;
      expect(res.items[1].channel).to.equal(name + '2', 'Verify channel2 response includes correct channel');
    });

    /**
     * Related to G1
     *
     * @spec HP3
     * @spec HP4
     * @spec HP5
     * @spec HP6
     * @spec HP7
     * @specpartial RSC19f - more tests with POST method and passing body
     * @specskip
     */
    Helper.testOnJsonMsgpack.skip('request_batch_api_partial_success', async function (options, name, helper) {
      const rest = helper.AblyRest(options);
      var body = { channels: [name, '[invalid', ''], messages: { data: 'foo' } };

      var res = await rest.request('POST', '/messages', 2, {}, body, {});
      expect(res.success).to.equal(false, 'Check res.success is false for a partial failure');
      expect(res.statusCode).to.equal(400, 'Check HPR.statusCode is 400 for a partial failure');
      expect(res.errorCode).to.equal(40020, 'Check HPR.errorCode is 40020 for a partial failure');
      expect(res.errorMessage, 'Check have an HPR.errorMessage').to.be.ok;

      var response = res.items[0];
      expect(response.error.code).to.equal(40020, 'Verify response has an errorCode');
      expect(response.batchResponse.length).to.equal(3, 'Verify batched response includes response for each channel');
      expect(response.batchResponse[0].channel).to.equal(name, 'Verify channel1 response includes correct channel');
      expect(!response.batchResponse[0].error, 'Verify first channel response is not an error').to.be.ok;
      expect(response.batchResponse[1].error.code).to.equal(
        40010,
        'Verify [invalid response includes an error with the right code',
      );
      expect(response.batchResponse[2].error.code).to.equal(
        40010,
        'Verify empty channel response includes an error with the right code',
      );
    });

    ['put', 'patch', 'delete'].forEach(function (method) {
      /** @specpartial RSC19f - tests put, patch, delete methods are supported */
      it('check' + method, async function () {
        const helper = this.test.helper.withParameterisedTestTitle('check');
        var restEcho = helper.AblyRestEcho({ useBinaryProtocol: false });
        var res = await restEcho.request(method, '/methods', 3, {}, {}, {});
        expect(res.items[0] && res.items[0].method).to.equal(method);
      });
    });
  });
});
