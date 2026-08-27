'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var expect = chai.expect;
  var noop = function () {};

  describe('rest/message', function () {
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
     * Authenticate with a clientId and ensure that the clientId is not sent in the Message
     * and is implicitly added when published.
     *
     * @spec RSL1m1
     */
    it('Should implicitly send clientId when authenticated with clientId', async function () {
      var helper = this.test.helper,
        clientId = 'implicit_client_id_0',
        rest = helper.AblyRest({ clientId: clientId, useBinaryProtocol: false }),
        channel = rest.channels.get('rest_implicit_client_id_0');

      var originalPublish = channel._publish;
      helper.recordPrivateApi('replace.restChannel._publish');
      channel._publish = async function (requestBody) {
        var message = JSON.parse(requestBody)[0];
        expect(message.name === 'event0', 'Outgoing message interecepted').to.be.ok;
        expect(!message.clientId, 'client ID is not added by the client library as it is implicit').to.be.ok;
        helper.recordPrivateApi('call.restChannel._publish');
        return originalPublish.apply(channel, arguments);
      };

      await channel.publish('event0', null);
      var page = await channel.history();

      var message = page.items[0];
      expect(message.clientId == clientId, 'Client ID was added implicitly').to.be.ok;
    });

    /**
     * Authenticate with a clientId and explicitly provide the same clientId in the Message
     * and ensure it is published.
     *
     * @spec RSL1m2
     */
    it('Should publish clientId when provided explicitly in message', async function () {
      var helper = this.test.helper,
        clientId = 'explicit_client_id_0',
        rest = helper.AblyRest({ clientId: clientId, useBinaryProtocol: false }),
        channel = rest.channels.get('rest_explicit_client_id_0');

      var originalPublish = channel._publish;
      helper.recordPrivateApi('replace.restChannel._publish');
      channel._publish = async function (requestBody) {
        var message = JSON.parse(requestBody)[0];
        expect(message.name === 'event0', 'Outgoing message interecepted').to.be.ok;
        expect(
          message.clientId == clientId,
          'client ID is added by the client library as it is explicit in the publish',
        ).to.be.ok;
        helper.recordPrivateApi('call.restChannel._publish');
        return originalPublish.apply(channel, arguments);
      };

      await channel.publish({ name: 'event0', clientId: clientId });
      var page = await channel.history();
      var message = page.items[0];
      expect(message.clientId == clientId, 'Client ID was retained').to.be.ok;
    });

    /**
     * Authenticate with a clientId and explicitly provide a different invalid clientId in the Message
     * and expect it to not be published and be rejected.
     *
     * @spec RSL1m4
     */
    it('Should error when clientId sent in message is different than authenticated clientId', async function () {
      var helper = this.test.helper,
        clientId = 'explicit_client_id_0',
        invalidClientId = 'invalid';

      var token = await helper.AblyRest().auth.requestToken({ clientId: clientId });
      expect(token.clientId === clientId, 'client ID is present in the Token').to.be.ok;

      // REST client uses a token string so is unaware of the clientId so cannot reject before communicating with Ably
      var rest = helper.AblyRest({ token: token.token, useBinaryProtocol: false }),
        channel = rest.channels.get('rest_explicit_client_id_1');

      var originalPublish = channel._publish;
      helper.recordPrivateApi('replace.restChannel._publish');
      channel._publish = async function (requestBody) {
        var message = JSON.parse(requestBody)[0];
        expect(message.name === 'event0', 'Outgoing message interecepted').to.be.ok;
        expect(
          message.clientId == invalidClientId,
          'invalid client ID is added by the client library as it is explicit in the publish',
        ).to.be.ok;
        helper.recordPrivateApi('call.restChannel._publish');
        return originalPublish.apply(channel, arguments);
      };

      try {
        await channel.publish({ name: 'event0', clientId: invalidClientId });
      } catch (err) {
        var page = await channel.history();
        expect(page.items.length).to.equal(0, 'Message should not have been published');
        return;
      }
      expect.fail('Publish should have failed with invalid clientId');
    });

    /**
     * Related to CD2c
     *
     * @spec TO3l8
     * @spec RSL1i
     */
    it('Should error when publishing message larger than maxMessageSize', async function () {
      /* No connectionDetails mechanism for REST, so just pass the override into the constructor */
      var helper = this.test.helper,
        realtime = helper.AblyRest({ maxMessageSize: 64 }),
        channel = realtime.channels.get('maxMessageSize');

      try {
        await channel.publish('foo', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      } catch (err) {
        expect(err, 'Check publish refused').to.be.ok;
        expect(err.code).to.equal(40009);
        return;
      }
      expect.fail('Expected channel.publish() to throw error');
    });

    /**
     * Check ids are correctly sent.
     * Related to RSL1k1.
     *
     * @spec TO3n
     * @spec RSL1k2
     * @spec RSL1k5
     */
    it('Should send correct IDs when idempotentRestPublishing set to false', async function () {
      var helper = this.test.helper,
        rest = helper.AblyRest({ idempotentRestPublishing: false, useBinaryProtocol: false }),
        channel = rest.channels.get('idempotent_rest_publishing'),
        message = { name: 'test', id: 'idempotent-msg-id:0' };

      await Promise.all([channel.publish(message), channel.publish(message), channel.publish(message)]);

      var page = await channel.history();
      expect(page.items.length).to.equal(1, 'Check only one message published');
      expect(page.items[0].id).to.equal(message.id, 'Check message id preserved in history');
    });

    /**
     * Check ids are added when automatic idempotent rest publishing option enabled
     *
     * @spec TO3n
     * @spec RSL1k1
     * @spec RSL1k4
     */
    it('Should add IDs when automatic idempotent rest publishing option enabled', async function () {
      /* easiest way to get the host we're using for tests */
      var helper = this.test.helper,
        dummyRest = helper.AblyRest(),
        host = dummyRest.options.primaryDomain,
        /* Add the same host as a bunch of fallback hosts, so after the first
         * request 'fails' we retry on the same host using the fallback mechanism */
        rest = helper.AblyRest({
          idempotentRestPublishing: true,
          useBinaryProtocol: false,
          fallbackHosts: [host, host, host],
        }),
        channel = rest.channels.get('automatic_idempotent_rest_publishing'),
        idOne,
        idTwo,
        originalPublish = channel._publish,
        originalDoUri = Ably.Realtime._Http.doUri;

      helper.recordPrivateApi('replace.restChannel._publish');
      channel._publish = async function (requestBody) {
        var messageOne = JSON.parse(requestBody)[0];
        var messageTwo = JSON.parse(requestBody)[1];
        expect(messageOne.name).to.equal('one', 'Outgoing message 1 interecepted');
        expect(messageTwo.name).to.equal('two', 'Outgoing message 2 interecepted');
        idOne = messageOne.id;
        idTwo = messageTwo.id;
        expect(idOne, 'id set on message 1').to.be.ok;
        expect(idTwo, 'id set on message 2').to.be.ok;
        expect(idOne && idOne.split(':')[1]).to.equal('0', 'check zero-based index');
        expect(idTwo && idTwo.split(':')[1]).to.equal('1', 'check zero-based index');
        helper.recordPrivateApi('call.restChannel._publish');
        return originalPublish.apply(channel, arguments);
      };

      helper.recordPrivateApi('replace.http.doUri');
      Ably.Rest._Http.doUri = async function (method, uri, headers, body, params) {
        helper.recordPrivateApi('call.http.doUri');
        const resultPromise = originalDoUri(method, uri, headers, body, params);
        helper.recordPrivateApi('replace.http.doUri');
        Ably.Rest._Http.doUri = originalDoUri;
        const result = await resultPromise;
        if (result.error) {
          return { error: result.error };
        }
        /* Fake a publish error from realtime */
        return { error: { message: 'moo', code: 50300, statusCode: 503 } };
      };

      await channel.publish([{ name: 'one' }, { name: 'two' }]);
      var page = await channel.history({ direction: 'forwards' });
      /* TODO uncomment when idempotent publishing works on sandbox
       * until then, test with ABLY_ENDPOINT=idempotent-dev
       * test.equal(page.items.length, 2, 'Only one message (with two items) should have been published');
       */
      expect(page.items[0].id).to.equal(idOne, 'Check message id 1 preserved in history');
      expect(page.items[1].id).to.equal(idTwo, 'Check message id 1 preserved in history');
    });

    /**
     * Signature publish(name: string, data: any, options?: PublishOptions) is not documented in the spec (see RSL1l).
     *
     * @spec RSL1
     * @spec RSL1a
     * @spec RSL1h
     * @spec RSL1l
     * @specpartial RSL1e - test only passing null to the function
     */
    it('Rest publish params', async function () {
      var helper = this.test.helper,
        rest = helper.AblyRest(),
        channel = rest.channels.get('publish_params');

      var originalPublish = channel._publish;

      /* Stub out _publish to check params */
      helper.recordPrivateApi('replace.restChannel._publish');
      channel._publish = async function (requestBody, headers, params) {
        expect(params && params.testParam).to.equal('testParamValue');
        helper.recordPrivateApi('call.restChannel._publish');
        return originalPublish.apply(channel, arguments);
      };

      await channel.publish('foo', 'bar', { testParam: 'testParamValue' });
      await channel.publish('foo', { data: 'data' }, { testParam: 'testParamValue' });
      await channel.publish('foo', { data: 'data' }, { testParam: 'testParamValue' }, noop);
      await channel.publish('foo', null, { testParam: 'testParamValue' });
      await channel.publish(null, 'foo', { testParam: 'testParamValue' });
      await channel.publish({ name: 'foo', data: 'bar' }, { testParam: 'testParamValue' });
      await channel.publish([{ name: 'foo', data: 'bar' }], { testParam: 'testParamValue' });
      await channel.publish([{ name: 'foo', data: 'bar' }], { testParam: 'testParamValue' }, noop);
    });

    /**
     * Tests that when the user sends the connectionKey in a REST publish, the REST client sends it correctly, enabling the "publish on behalf of a Realtime client" functionality.
     *
     * @spec TM2h
     */
    it('allows you to publish a message on behalf of a Realtime connection by setting connectionKey on the message', async function () {
      const helper = this.test.helper;
      const rest = helper.AblyRest();
      const realtime = helper.AblyRealtime();

      await helper.monitorConnectionThenCloseAndFinishAsync(async () => {
        await realtime.connection.whenState('connected');
        const connectionKey = realtime.connection.key;
        expect(connectionKey).to.be.ok;

        const channelName = 'publishOnBehalf';
        const realtimeChannel = realtime.channels.get(channelName);
        await realtimeChannel.attach();

        const receivedMessagePromise = new Promise((resolve) => {
          realtimeChannel.subscribe((message) => {
            resolve(message);
          });
        });

        const sentMessage = { name: 'foo', data: 'bar', connectionKey };
        const restChannel = rest.channels.get(channelName);
        // Publish a message on behalf of `realtime`
        await restChannel.publish(sentMessage);

        const receivedMessage = await receivedMessagePromise;
        // Check that the message we published got attributed to `realtime`'s connection
        expect(receivedMessage.connectionId).to.equal(realtime.connection.id);
      }, realtime);
    });
  });
});
