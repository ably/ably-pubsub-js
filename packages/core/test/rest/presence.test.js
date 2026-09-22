'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var rest;
  var cipherConfig;
  var expect = chai.expect;
  var Crypto = Ably.Realtime.Platform.Crypto;
  var BufferUtils = Ably.Realtime.Platform.BufferUtils;

  function cipherParamsFromConfig(cipherConfig, helper) {
    helper.recordPrivateApi('new.Crypto.CipherParams');
    var cipherParams = new Crypto.CipherParams();
    for (var prop in cipherConfig) {
      cipherParams[prop] = cipherConfig[prop];
    }
    cipherParams.keyLength = cipherConfig.keylength;
    delete cipherParams.keylength; // grr case differences
    helper.recordPrivateApi('call.BufferUtils.base64Decode');
    cipherParams.key = BufferUtils.base64Decode(cipherParams.key);
    cipherParams.iv = BufferUtils.base64Decode(cipherParams.iv);
    return cipherParams;
  }

  describe('rest/presence', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function () {
        rest = helper.AblyRest();
        cipherConfig = helper.getTestApp().cipherConfig;
        done();
      });
    });

    function presence_simple(operation) {
      return async function () {
        const helper = this.test.helper.withParameterisedTestTitle('presence_simple');
        var cipherParams = cipherParamsFromConfig(cipherConfig, helper);
        var channel = rest.channels.get('persisted:presence_fixtures', { cipher: cipherParams });
        var resultPage = await channel.presence[operation]();
        var presenceMessages = resultPage.items;
        expect(presenceMessages.length).to.equal(6, 'Verify correct number of messages found');
        if (presenceMessages.length != 6) {
          console.log('presenceMessages: ', JSON.stringify(presenceMessages));
        }
        var encodedMessage = presenceMessages.find(function (msg) {
          return msg.clientId == 'client_encoded';
        });
        var decodedMessage = presenceMessages.find(function (msg) {
          return msg.clientId == 'client_decoded';
        });
        var boolMessage = presenceMessages.find(function (msg) {
          return msg.clientId == 'client_bool';
        });
        var intMessage = presenceMessages.find(function (msg) {
          return msg.clientId == 'client_int';
        });
        expect(encodedMessage.data).to.deep.equal(decodedMessage.data, 'Verify message decoding works correctly');
        expect(encodedMessage.encoding).to.equal(null, 'Decoding should remove encoding field');
        expect(decodedMessage.encoding).to.equal(null, 'Decoding should remove encoding field');
        expect(boolMessage.data).to.equal('true', 'should not attempt to parse string data when no encoding field');
        expect(intMessage.data).to.equal('24', 'should not attempt to parse string data when no encoding field');
        expect(boolMessage.action).to.equal(operation === 'get' ? 'present' : 'enter', 'appropriate action');
      };
    }

    /**
     * @spec RSP3
     * @spec RSP3a
     */
    it('Presence get simple', presence_simple('get'));
    /**
     * @spec RSP4
     * @spec RSP4a
     */
    it('Presence history simple', presence_simple('history'));

    /**
     * Ensure that calling JSON strinfigy on the Presence object
     * converts the action string value back to a numeric value which the API requires
     *
     * @nospec
     */
    it('Presence message JSON serialisation', async function () {
      var channel = rest.channels.get('persisted:presence_fixtures');
      var resultPage = await channel.presence.get();
      var presenceMessages = resultPage.items;
      var presenceBool = presenceMessages.find(function (msg) {
        return msg.clientId == 'client_bool';
      });
      expect(JSON.parse(JSON.stringify(await presenceBool.encode({}))).action).to.equal(1); // present
      presenceBool.action = 'leave';
      expect(JSON.parse(JSON.stringify(await presenceBool.encode({}))).action).to.equal(3); // leave
    });

    /**
     * @spec RSP3a2
     * @spec RSP3a3
     * @specpartial RSP3a1 - should also test maximum supported limit of 1000
     */
    it('Presence get limits and filtering', async function () {
      var channel = rest.channels.get('persisted:presence_fixtures');

      var tests = [
        // Result limit
        async function () {
          var resultPage = await channel.presence.get({ limit: 3 });
          var presenceMessages = resultPage.items;
          expect(presenceMessages.length).to.equal(3, 'Verify correct number of messages found');
        },
        // Filter by clientId
        async function (cb) {
          var resultPage = await channel.presence.get({ clientId: 'client_json' });
          var presenceMessages = resultPage.items;
          expect(presenceMessages.length).to.equal(1, 'Verify correct number of messages found');
        },
        // Filter by connectionId
        async function () {
          var resultPage = await channel.presence.get();
          var resultPage2 = await channel.presence.get({ connectionId: resultPage.items[0].connectionId });
          var presenceMessages = resultPage2.items;
          expect(presenceMessages.length).to.equal(6, 'Verify correct number of messages found');
        },
      ];

      await Promise.all(tests);
    });
  });
});
