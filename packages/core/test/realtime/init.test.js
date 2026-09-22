'use strict';

define(['ably', 'shared_helper', 'chai'], function (Ably, Helper, chai) {
  var expect = chai.expect;

  describe('realtime/init', function () {
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

    /* Restrict to websocket or xhr polling for the v= test as if stream=false the
     * recvRequest may not be the connectRequest by the time we check it. */
    ((testDefinitionHelper) => {
      if (testDefinitionHelper.bestTransport === 'web_socket' || testDefinitionHelper.bestTransport === 'xhr_polling') {
        /*
         * Base init case.
         * @spec RTN2f
         */
        it('initbase0', function (done) {
          const helper = this.test.helper;
          var realtime;
          try {
            realtime = helper.AblyRealtime({ transports: ['web_socket', 'xhr_polling'] });
            realtime.connection.on('connected', function () {
              /* check api version */
              helper.recordPrivateApi('read.connectionManager.activeProtocol.transport');
              var transport = realtime.connection.connectionManager.activeProtocol.transport;
              var connectUri = helper.isWebsocket(transport)
                ? (() => {
                    helper.recordPrivateApi('read.transport.uri');
                    return transport.uri;
                  })()
                : (() => {
                    helper.recordPrivateApi('read.transport.recvRequest.recvUri');
                    return transport.recvRequest.recvUri;
                  })();
              try {
                expect(connectUri.indexOf('v=6') > -1, 'Check uri includes v=6').to.be.ok;
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
                return;
              }
              helper.closeAndFinish(done, realtime);
            });
            helper.monitorConnection(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        });
      }
    })(Helper.forTestDefinition(this, 'initbase0'));

    /**
     * Init with key string.
     *
     * @specpartial RSC1a
     * @specpartial RSC1c - test Realtime constructor with an API key
     */
    it('init_key_string', function (done) {
      const helper = this.test.helper;
      var realtime;
      try {
        var keyStr = helper.getTestApp().keys[0].keyStr;
        realtime = new helper.Ably.Realtime(keyStr);

        try {
          helper.recordPrivateApi('read.realtime.options.key');
          expect(realtime.options.key).to.equal(keyStr);
          helper.recordPrivateApi('read.realtime.options');
          helper.recordPrivateApi('read.connectionManager.options');
          expect(realtime.options).to.deep.equal(realtime.connection.connectionManager.options);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        helper.closeAndFinish(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Init with token string.
     *
     * @specpartial RSC1a
     * @specpartial RSC1c - test Realtime constructor with a token string
     */
    it('init_token_string', function (done) {
      const helper = this.test.helper;
      try {
        /* first generate a token ... */
        var rest = helper.AblyRest();
        var testKeyOpts = { key: helper.getTestApp().keys[1].keyStr };

        Helper.whenPromiseSettles(rest.auth.requestToken(null, testKeyOpts), function (err, tokenDetails) {
          if (err) {
            done(err);
            return;
          }

          var tokenStr = tokenDetails.token,
            realtime = new helper.Ably.Realtime(tokenStr);

          try {
            helper.recordPrivateApi('read.realtime.options.token');
            expect(realtime.options.token).to.equal(tokenStr);
            helper.recordPrivateApi('read.realtime.options');
            helper.recordPrivateApi('read.connectionManager.options');
            expect(realtime.options).to.deep.equal(realtime.connection.connectionManager.options);
            helper.closeAndFinish(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        });
      } catch (err) {
        done(err);
      }
    });

    /**
     * Init with key string and useTokenAuth: true.
     * @spec TO3j4
     */
    it('init_key_with_usetokenauth', function (done) {
      const helper = this.test.helper;
      var realtime;
      try {
        var keyStr = helper.getTestApp().keys[0].keyStr;
        realtime = helper.AblyRealtime({ key: keyStr, useTokenAuth: true });
        helper.recordPrivateApi('read.realtime.options.key');
        expect(realtime.options.key).to.equal(keyStr);
        helper.recordPrivateApi('read.auth.method');
        expect(realtime.auth.method).to.equal('token');
        expect(realtime.auth.clientId).to.equal(undefined);
        /* Check that useTokenAuth by default results in an anonymous (and not wildcard) token */
        realtime.connection.on('connected', function () {
          try {
            expect(realtime.auth.tokenDetails.clientId).to.equal(undefined);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Init with key string, useTokenAuth: true, and some defaultTokenParams to request a wildcard clientId
     * @spec RSA7b4
     */
    it('init_usetokenauth_defaulttokenparams_wildcard', function (done) {
      const helper = this.test.helper;
      var realtime;
      try {
        var keyStr = helper.getTestApp().keys[0].keyStr;
        realtime = helper.AblyRealtime({
          key: keyStr,
          useTokenAuth: true,
          defaultTokenParams: { clientId: '*', ttl: 123456 },
        });
        expect(realtime.auth.clientId).to.equal(undefined);
        realtime.connection.on('connected', function () {
          try {
            expect(realtime.auth.tokenDetails.clientId).to.equal('*');
            /* auth.clientId now does inherit the value '*' -- RSA7b4 */
            expect(realtime.auth.clientId).to.equal('*');
            expect(realtime.auth.tokenDetails.expires - realtime.auth.tokenDetails.issued).to.equal(123456);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Init with using defaultTokenParams to set a non-wildcard clientId should set auth.clientId
     * @spec RSA7b3
     */
    it('init_defaulttokenparams_nonwildcard', function (done) {
      const helper = this.test.helper;
      var realtime;
      try {
        var keyStr = helper.getTestApp().keys[0].keyStr;
        realtime = helper.AblyRealtime({
          key: keyStr,
          useTokenAuth: true,
          defaultTokenParams: { clientId: 'test' },
        });
        expect(realtime.auth.clientId).to.equal(undefined);
        realtime.connection.on('connected', function () {
          try {
            expect(realtime.auth.tokenDetails.clientId).to.equal('test');
            expect(realtime.auth.clientId).to.equal('test');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Init when specifying clientId both in defaultTokenParams and in clientOptions: the latter takes precedence.
     * @spec RSA7a4
     */
    it('init_conflicting_clientids', function (done) {
      const helper = this.test.helper;
      var realtime;
      try {
        var keyStr = helper.getTestApp().keys[0].keyStr;
        realtime = helper.AblyRealtime({
          key: keyStr,
          useTokenAuth: true,
          clientId: 'yes',
          defaultTokenParams: { clientId: 'no' },
        });
        realtime.connection.on('connected', function () {
          try {
            expect(realtime.auth.tokenDetails.clientId).to.equal('yes');
            expect(realtime.auth.clientId).to.equal('yes');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Init with useTokenAuth: false with a clientId (should fail).
     * Related to RSA7.
     *
     * @nospec
     */
    it('init_with_usetokenauth_false_and_a_clientid', function (done) {
      const helper = this.test.helper;
      try {
        var keyStr = helper.getTestApp().keys[0].keyStr;
        expect(function () {
          realtime = new helper.Ably.Realtime({ key: keyStr, useTokenAuth: false, clientId: 'foo' });
        }).to.throw;
        done();
      } catch (err) {
        done(err);
      }
    });

    /**
     * Check primary domain selection.
     * @specpartial RSC11 - tests only default value
     */
    it('init_primary_domain', function (done) {
      const helper = this.test.helper;
      try {
        /* want to check the default host when no custom environment or custom
         * host set, so not using helpers.realtime this time, which will use a
         * test env */
        const realtime = new Ably.Realtime({ key: 'not_a.real:key', autoConnect: false });
        helper.recordPrivateApi('read.connectionManager.domains');
        helper.recordPrivateApi('read.realtime.options.primaryDomain');
        expect(realtime.options.primaryDomain).to.equal(
          'main.realtime.ably.net',
          'Verify correct primary domain chosen',
        );
        const primaryDomainOnDomainsList = realtime.connection.connectionManager.domains[0];
        expect(primaryDomainOnDomainsList).to.equal(
          'main.realtime.ably.net',
          'Verify correct primary domain on the domains list',
        );
        realtime.close();
        done();
      } catch (err) {
        done(err);
      }
    });

    /**
     * Check changing the default timeouts.
     *
     * @specpartial TO3l1 - test property can be set
     * @specpartial TO3l2 - test property can be set
     * @specpartial TO3l4 - test property can be set
     * @specpartial TO3l6 - test property can be set
     */
    it('init_timeouts', function (done) {
      const helper = this.test.helper;
      try {
        var realtime = helper.AblyRealtime({
          key: 'not_a.real:key',
          disconnectedRetryTimeout: 123,
          suspendedRetryTimeout: 456,
          httpRequestTimeout: 789,
          httpMaxRetryDuration: 321,
        });
        /* Note: uses internal knowledge of connectionManager */
        try {
          helper.recordPrivateApi('read.connectionManager.states.disconnected.retryDelay');
          expect(realtime.connection.connectionManager.states.disconnected.retryDelay).to.equal(
            123,
            'Verify disconnected retry frequency is settable',
          );
          helper.recordPrivateApi('read.connectionManager.states.suspended.retryDelay');
          expect(realtime.connection.connectionManager.states.suspended.retryDelay).to.equal(
            456,
            'Verify suspended retry frequency is settable',
          );
          helper.recordPrivateApi('read.connectionManager.options.timeouts.httpRequestTimeout');
          expect(realtime.connection.connectionManager.options.timeouts.httpRequestTimeout).to.equal(
            789,
            'Verify http request timeout is settable',
          );
          helper.recordPrivateApi('read.connectionManager.options.timeouts.httpMaxRetryDuration');
          expect(realtime.connection.connectionManager.options.timeouts.httpMaxRetryDuration).to.equal(
            321,
            'Verify http max retry duration is settable',
          );
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        helper.closeAndFinish(done, realtime);
      } catch (err) {
        done(err);
      }
    });

    /**
     * Check changing the default fallback hosts and changing httpMaxRetryCount.
     *
     * @spec REC2a2
     * @spec TO3k2
     * @spec TO3l5
     * @specpartial RSC11 - test override endpoint using restHost
     * @specpartial RSC15a - httpMaxRetryCount has been reached
     */
    it('init_fallbacks', function (done) {
      const helper = this.test.helper;
      try {
        var realtime = helper.AblyRealtimeWithoutEndpoint({
          key: 'not_a.real:key',
          restHost: 'a',
          httpMaxRetryCount: 2,
          autoConnect: false,
          fallbackHosts: ['b', 'c', 'd', 'e'],
        });
        /* Note: uses internal knowledge of connectionManager */
        helper.recordPrivateApi('read.connectionManager.domains');
        expect(realtime.connection.connectionManager.domains.length).to.equal(
          3,
          'Verify hosts list is the expected length',
        );
        expect(realtime.connection.connectionManager.domains[0]).to.equal('a', 'Verify given restHost is first');
        /* Replace chooseTransportForHost with a spy, then try calling
         * chooseHttpTransport to see what host is picked */
        helper.recordPrivateApi('replace.connectionManager.tryATransport');
        realtime.connection.connectionManager.tryATransport = function (transportParams, transport, cb) {
          switch (transportParams.host) {
            case 'a':
              cb(false);
              break;
            case 'b':
            case 'c':
            case 'd':
            case 'e':
              /* should be called twice */
              cb(false);
          }
        };
        realtime.connection.on('disconnected', function (stateChange) {
          try {
            expect(stateChange.reason.code).to.equal(80003, 'Expected error code after no fallback host works');
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
        realtime.connection.connect();
      } catch (err) {
        done(err);
      }
    });

    /* Check base and websocket transports (nodejs only; browser tests in their own section) */
    if (!isBrowser) {
      /**
       * Related to RTN1.
       * @nospec
       */
      it('node_transports', function (done) {
        const helper = this.test.helper;
        var realtime;
        try {
          realtime = helper.AblyRealtime({ transports: helper.availableTransports });
          helper.recordPrivateApi('read.connectionManager.baseTransport');
          expect(realtime.connection.connectionManager.baseTransport).to.equal('comet');
          helper.recordPrivateApi('read.connectionManager.webSocketTransportAvailable');
          expect(realtime.connection.connectionManager.webSocketTransportAvailable).to.be.ok;
          helper.closeAndFinish(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });
    }

    /**
     * Check that the connectionKey in ConnectionDetails updates the client connectionKey,
     * and clientId in ConnectionDetails updates the client clientId.
     *
     * Related to RTN9, RTN15e, RTN16d.
     * No spec item explicitly states that connection.key should be set
     * from ConnectionDetails.connectionKey on the first connection.
     *
     * @spec RSA7b3
     */
    it('init_and_connection_details', function (done) {
      const helper = this.test.helper;
      try {
        var keyStr = helper.getTestApp().keys[0].keyStr;
        var realtime = helper.AblyRealtime({ key: keyStr, useTokenAuth: true });
        helper.recordPrivateApi('listen.connectionManager.transport.pending');
        realtime.connection.connectionManager.once('transport.pending', function (state) {
          helper.recordPrivateApi('read.connectionManager.pendingTransport');
          var transport = realtime.connection.connectionManager.pendingTransport,
            originalOnProtocolMessage = transport.onProtocolMessage;
          helper.recordPrivateApi('replace.transport.onProtocolMessage');
          realtime.connection.connectionManager.pendingTransport.onProtocolMessage = function (message) {
            try {
              if (message.action === 4) {
                expect(message.connectionDetails.connectionKey).to.be.ok;
                message.connectionDetails.connectionKey = 'importantConnectionKey';
                message.connectionDetails.clientId = 'customClientId';
              }
              helper.recordPrivateApi('call.transport.onProtocolMessage');
              originalOnProtocolMessage.call(transport, message);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          };
        });
        realtime.connection.once('connected', function () {
          try {
            expect(realtime.auth.clientId).to.equal(
              'customClientId',
              'clientId should be set on the Auth object from connectionDetails',
            );
            expect(realtime.connection.key).to.equal(
              'importantConnectionKey',
              'connection key from connectionDetails should be used',
            );
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          helper.closeAndFinish(done, realtime);
        });
      } catch (err) {
        done(err);
      }
    });

    /** @spec REC2c */
    it('init_fallbacks_once_connected', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime({
        httpMaxRetryCount: 3,
        fallbackHosts: ['a', 'b', 'c'],
        transport: ['web_socket'],
      });
      realtime.connection.once('connected', function () {
        try {
          helper.recordPrivateApi('call.http._getHosts');
          var hosts = new Ably.Rest._Http()._getHosts(realtime);
          /* restHost rather than realtimeHost as that's what connectionManager
           * knows about; converted to realtimeHost by the websocketTransport */
          helper.recordPrivateApi('read.realtime.options.primaryDomain');
          expect(hosts[0]).to.equal(
            realtime.options.primaryDomain,
            'Check connected realtime host is the first option',
          );
          expect(hosts.length).to.equal(4, 'Check also have three fallbacks');
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        helper.closeAndFinish(done, realtime);
      });
    });

    /** @specpartial RTN17e */
    it('init_fallbacks_once_connected_2', function (done) {
      const helper = this.test.helper;
      var goodHost = helper.AblyRest().options.primaryDomain;
      var realtime = helper.AblyRealtimeWithoutEndpoint({
        httpMaxRetryCount: 3,
        restHost: 'a',
        fallbackHosts: [goodHost, 'b', 'c'],
      });
      realtime.connection.once('connected', function () {
        helper.recordPrivateApi('call.http._getHosts');
        var hosts = new Ably.Realtime._Http()._getHosts(realtime);
        /* restHost rather than realtimeHost as that's what connectionManager
         * knows about; converted to realtimeHost by the websocketTransport */
        try {
          expect(hosts[0]).to.equal(goodHost, 'Check connected realtime host is the first option');
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        helper.closeAndFinish(done, realtime);
      });
    });
  });
});
