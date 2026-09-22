'use strict';

define(['ably', 'chai'], function (Ably, chai) {
  var expect = chai.expect;
  var Defaults = Ably.Realtime.Platform.Defaults;

  describe('rest/defaults', function () {
    /**
     * @spec TO3k2
     * @spec TO3k3
     * @spec TO3k4
     * @spec TO3k5
     * @spec TO3k6
     * @spec TO3d
     * @spec RSC15h
     * @specpartial RTN2 - test default value for realtime websocket connection
     * @specpartial RSC25 - primary domain for REST is `primaryDomain`
     * @specpartial RTN17i - primary domain for realtime is `primaryDomain`
     */
    it('Init with no endpoint-related options', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({}, null, null);

      expect(normalisedOptions.primaryDomain).to.equal('main.realtime.ably.net');
      expect(normalisedOptions.port).to.equal(80);
      expect(normalisedOptions.tlsPort).to.equal(443);
      expect(normalisedOptions.fallbackHosts.sort()).to.deep.equal(Defaults.FALLBACK_HOSTS.sort());
      expect(normalisedOptions.tls).to.equal(true);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions).length).to.equal(4);
      expect(Defaults.getHosts(normalisedOptions)[0]).to.deep.equal(normalisedOptions.primaryDomain);
      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k8
     * @spec TO3k4
     * @spec TO3k5
     * @spec TO3k6
     * @spec TO3d
     * @spec REC1a
     */
    it('Init with given endpoint', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({ endpoint: 'nonprod:sandbox' }, null, null);

      expect(normalisedOptions.port).to.equal(80);
      expect(normalisedOptions.tlsPort).to.equal(443);
      expect(normalisedOptions.fallbackHosts.sort()).to.deep.equal(
        Defaults.getEndpointFallbackHosts('nonprod:sandbox').sort(),
      );
      expect(normalisedOptions.tls).to.equal(true);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions).length).to.deep.equal(4);
      expect(Defaults.getHosts(normalisedOptions)[0]).to.deep.equal(normalisedOptions.primaryDomain);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k8
     * @spec REC1b2
     */
    it('Init with given endpoint as FQDN', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({ endpoint: 'example.com' }, null, null);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions).length).to.deep.equal(1);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k8
     * @spec REC1b2
     */
    it('Init with given endpoint as IPv4 address', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({ endpoint: '127.0.0.1' }, null, null);

      helper.recordPrivateApi('call.Defaults.getHosts');
      console.log(Defaults.getHosts(normalisedOptions));
      expect(Defaults.getHosts(normalisedOptions).length).to.deep.equal(1);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k8
     * @spec REC1b2
     */
    it('Init with given endpoint as IPv6 address', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({ endpoint: '::1' }, null, null);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions).length).to.deep.equal(1);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k8
     * @spec REC1b2
     */
    it('Init with given endpoint as localhost', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({ endpoint: 'localhost' }, null, null);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions).length).to.deep.equal(1);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k1
     * @spec TO3k2
     * @spec TO3k3
     * @spec TO3k4
     * @spec TO3k5
     * @spec TO3k6
     * @spec TO3d
     * @specpartial REC1d1 - test primary domain is overridden by environment
     * @specpartial REC1c - test with environment set other than 'production'
     */
    it('Init with given environment', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({ environment: 'main' }, null, null);

      expect(normalisedOptions.primaryDomain).to.equal('main.realtime.ably.net');
      expect(normalisedOptions.port).to.equal(80);
      expect(normalisedOptions.tlsPort).to.equal(443);
      expect(normalisedOptions.fallbackHosts.sort()).to.deep.equal(Defaults.getEndpointFallbackHosts('main').sort());
      expect(normalisedOptions.tls).to.equal(true);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions).length).to.deep.equal(4);
      expect(Defaults.getHosts(normalisedOptions)[0]).to.deep.equal(normalisedOptions.primaryDomain);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k1
     * @spec TO3k2
     * @spec TO3k3
     * @spec TO3k4
     * @spec TO3k5
     * @spec TO3k6
     * @spec TO3d
     * @specpartial REC1d1 - test restHost is overridden by environment
     * @specpartial REC1c - test with environment set other than 'production'
     */
    it('Init with local environment and non-default ports', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions(
        { environment: 'local', port: 8080, tlsPort: 8081 },
        null,
        null,
      );

      expect(normalisedOptions.primaryDomain).to.equal('local.realtime.ably.net');
      expect(normalisedOptions.port).to.equal(8080);
      expect(normalisedOptions.tlsPort).to.equal(8081);
      expect(normalisedOptions.fallbackHosts).to.equal(undefined);
      expect(normalisedOptions.tls).to.equal(true);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions)).to.deep.equal([normalisedOptions.primaryDomain]);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(8081);
    });

    /**
     * Missing spec point documenting that explicit restHost overrides realtimeHost too.
     *
     * @spec TO3k2
     * @spec TO3k3
     * @spec TO3k4
     * @spec TO3k5
     * @spec TO3k6
     * @spec TO3d
     * @spec REC1d1
     * @spec REC1d2
     * @specpartial RSC25 - test primary domain defined by restHost
     */
    it('Init with given host', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({ restHost: 'test.org' }, null, null);

      expect(normalisedOptions.primaryDomain).to.equal('test.org');
      expect(normalisedOptions.port).to.equal(80);
      expect(normalisedOptions.tlsPort).to.equal(443);
      expect(normalisedOptions.fallbackHosts).to.equal(undefined);
      expect(normalisedOptions.tls).to.equal(true);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions)).to.deep.equal([normalisedOptions.primaryDomain]);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k2
     * @spec TO3k3
     * @spec TO3k4
     * @spec TO3k5
     * @spec TO3k6
     * @spec TO3d
     * @spec REC1d1
     * @spec REC1d2
     * @specpartial RSC11 - test restHost is overridden by custom value
     * @specpartial RTN17a - primary host for realtime can be overridden by realtimeHost
     */
    it('Init with given restHost and realtimeHost', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions(
        { restHost: 'test.org', realtimeHost: 'ws.test.org' },
        null,
        null,
      );

      expect(normalisedOptions.primaryDomain).to.equal('test.org');
      expect(normalisedOptions.port).to.equal(80);
      expect(normalisedOptions.tlsPort).to.equal(443);
      expect(normalisedOptions.fallbackHosts).to.equal(undefined);
      expect(normalisedOptions.tls).to.equal(true);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions)).to.deep.equal([normalisedOptions.primaryDomain]);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
    });

    /**
     * @spec TO3k2
     * @spec TO3k3
     * @spec TO3k4
     * @spec TO3k5
     * @spec TO3k6
     * @spec TO3d
     * @specpartial REC1d1 - test restHost is overridden by environment
     * @specpartial REC1c - test with environment set other than 'production'
     */
    it('Init with no endpoint-related options and given default environment', function () {
      const helper = this.test.helper;

      helper.recordPrivateApi('write.Defaults.ENDPOINT');
      Defaults.ENDPOINT = 'nonprod:sandbox';
      helper.recordPrivateApi('call.Defaults.normaliseOptions');
      var normalisedOptions = Defaults.normaliseOptions({}, null, null);

      expect(normalisedOptions.primaryDomain).to.equal('sandbox.realtime.ably-nonprod.net');
      expect(normalisedOptions.port).to.equal(80);
      expect(normalisedOptions.tlsPort).to.equal(443);
      expect(normalisedOptions.fallbackHosts.sort()).to.deep.equal(
        Defaults.getEndpointFallbackHosts('nonprod:sandbox').sort(),
      );
      expect(normalisedOptions.tls).to.equal(true);

      helper.recordPrivateApi('call.Defaults.getHosts');
      expect(Defaults.getHosts(normalisedOptions).length).to.equal(4);
      expect(Defaults.getHosts(normalisedOptions)[0]).to.deep.equal(normalisedOptions.primaryDomain);

      helper.recordPrivateApi('call.Defaults.getPort');
      expect(Defaults.getPort(normalisedOptions)).to.equal(443);
      helper.recordPrivateApi('write.Defaults.ENDPOINT');
      Defaults.ENDPOINT = 'main';
    });

    // TODO once https://github.com/ably/ably-js/issues/1424 is fixed, this should also test the case where the useBinaryProtocol option is not specified
    describe('normaliseOptions with useBinaryProtocol == true', () => {
      if (Ably.Realtime.Platform.Config.supportsBinary) {
        describe('given MsgPack implementation', () => {
          /** @spec TO3f */
          it('maintains useBinaryProtocol as true', function () {
            const helper = this.test.helper;
            const StubMsgPack = {};
            helper.recordPrivateApi('call.Defaults.normaliseOptions');
            var normalisedOptions = Defaults.normaliseOptions({ useBinaryProtocol: true }, StubMsgPack, null);

            expect(normalisedOptions.useBinaryProtocol).to.be.true;
          });
        });
      }

      describe('given no MsgPack implementation', () => {
        /** @spec TO3f */
        it('changes useBinaryProtocol to false', function () {
          const helper = this.test.helper;
          helper.recordPrivateApi('call.Defaults.normaliseOptions');
          var normalisedOptions = Defaults.normaliseOptions({ useBinaryProtocol: true }, null, null);

          expect(normalisedOptions.useBinaryProtocol).to.be.false;
        });
      });
    });

    /**
     * Related to RTC1c
     * @nospec
     */
    it('closeOnUnload', function () {
      const helper = this.test.helper;
      var options;

      helper.recordPrivateApi('call.Defaults.normaliseOptions');

      /* Default to true */
      options = Defaults.normaliseOptions({}, null, null);
      expect(options.closeOnUnload).to.equal(true);

      /* Default to false if using manual recovery */
      options = Defaults.normaliseOptions({ recover: 'someRecoveryKey' }, null, null);
      expect(options.closeOnUnload).to.equal(false);

      /* Default to false if using autorecovery */
      options = Defaults.normaliseOptions({ recover: function () {} }, null, null);
      expect(options.closeOnUnload).to.equal(false);

      /* can override default with manual recovery */
      options = Defaults.normaliseOptions({ recover: 'someRecoveryKey', closeOnUnload: true }, null, null);
      expect(options.closeOnUnload).to.equal(true);

      /* can override default with autorecovery only at the cost of unsetting autorecovery */
      options = Defaults.normaliseOptions({ recover: function () {}, closeOnUnload: true }, null, null);
      expect(options.closeOnUnload).to.equal(true);
      expect(!options.recover).to.be.ok;
    });
  });
});
