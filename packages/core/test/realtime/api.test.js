'use strict';

define(['ably', 'chai'], function (Ably, chai) {
  var expect = chai.expect;

  describe('realtime/api', function () {
    /**
     * Spec does not have an explicit item that states that Realtime should be a class, it is shown in types instead.
     *
     * @nospec
     */
    it('Client constructors', function () {
      expect(typeof Ably.Realtime).to.equal('function');
    });

    /**
     * It actually tests RSC1b, but in the context of Realtime class
     *
     * @specpartial RTC12
     */
    it('constructor without any arguments', function () {
      expect(() => new Ably.Realtime()).to.throw(
        'must be initialized with either a client options object, an Ably API key, or an Ably Token',
      );
    });

    /**
     * @spec REC1b1
     * @spec REC1c1
     */
    it('constructor with conflict client options', function () {
      expect(
        () =>
          new Ably.Realtime({
            endpoint: 'nonprod:sandbox',
            environment: 'sandbox',
          }),
      )
        .to.throw()
        .with.property('code', 40106);

      expect(
        () =>
          new Ably.Realtime({
            environment: 'nonprod:sandbox',
            restHost: 'localhost',
          }),
      )
        .to.throw()
        .with.property('code', 40106);

      expect(
        () =>
          new Ably.Realtime({
            endpoint: 'nonprod:sandbox',
            restHost: 'localhost',
          }),
      )
        .to.throw()
        .with.property('code', 40106);
    });

    /**
     * @spec RSE1
     * @spec RSE2
     */
    it('Crypto', function () {
      expect(typeof Ably.Realtime.Crypto).to.equal('function');
      expect(typeof Ably.Realtime.Crypto.getDefaultParams).to.equal('function');
      expect(typeof Ably.Realtime.Crypto.generateRandomKey).to.equal('function');
    });

    /** @specpartial TM3 - tests only functions exist */
    it('Message', function () {
      expect(typeof Ably.Realtime.Message).to.equal('function');
      expect(typeof Ably.Realtime.Message.fromEncoded).to.equal('function');
      expect(typeof Ably.Realtime.Message.fromEncodedArray).to.equal('function');
    });

    /** @specpartial TP4 - tests only functions exist */
    it('PresenceMessage', function () {
      expect(typeof Ably.Realtime.PresenceMessage).to.equal('function');
      expect(typeof Ably.Realtime.PresenceMessage.fromEncoded).to.equal('function');
      expect(typeof Ably.Realtime.PresenceMessage.fromEncodedArray).to.equal('function');
    });
  });
});
