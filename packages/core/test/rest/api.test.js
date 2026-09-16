'use strict';

define(['ably', 'chai'], function (Ably, chai) {
  var expect = chai.expect;

  describe('http/api', function () {
    /**
     * Spec does not have an explicit item that states that Http should be a class, it is shown in types instead.
     * @nospec
     */
    it('Client constructors', function () {
      expect(typeof Ably.Http).to.equal('function');
    });

    /** @spec RSC1b */
    it('constructor without any arguments', function () {
      expect(() => new Ably.Http()).to.throw(
        'must be initialized with either a client options object, an Ably API key, or an Ably Token',
      );
    });

    /**
     * @spec RSE1
     * @spec RSE2
     */
    it('Crypto', function () {
      expect(typeof Ably.Http.Crypto).to.equal('function');
      expect(typeof Ably.Http.Crypto.getDefaultParams).to.equal('function');
      expect(typeof Ably.Http.Crypto.generateRandomKey).to.equal('function');
    });

    /** @specpartial TM3 - tests only functions exist */
    it('Message', function () {
      expect(typeof Ably.Http.Message).to.equal('function');
      expect(typeof Ably.Http.Message.fromEncoded).to.equal('function');
      expect(typeof Ably.Http.Message.fromEncodedArray).to.equal('function');
    });

    /** @specpartial TP4 - tests only functions exist */
    it('PresenceMessage', function () {
      expect(typeof Ably.Http.PresenceMessage).to.equal('function');
      expect(typeof Ably.Http.PresenceMessage.fromEncoded).to.equal('function');
      expect(typeof Ably.Http.PresenceMessage.fromEncodedArray).to.equal('function');
    });
  });
});
