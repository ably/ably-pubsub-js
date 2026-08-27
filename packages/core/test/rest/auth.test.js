'use strict';

define(['chai', 'shared_helper', 'async'], function (chai, Helper, async) {
  var currentTime;
  var rest;
  var expect = chai.expect;
  var echoServer = 'https://echo.ably.io';

  describe('rest/auth', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function () {
        rest = helper.AblyRest({ queryTime: true });
        rest
          .time()
          .then(function (time) {
            currentTime = time;
            expect(true, 'Obtained time').to.be.ok;
            done();
          })
          .catch(function (err) {
            done(err);
          });
      });
    });

    /**
     * @spec RSA8a
     * @spec RSA5
     * @specpartial TK2a - test default ttl 60 minutes
     */
    it('Base token generation case', async function () {
      var tokenDetails = await rest.auth.requestToken();
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(tokenDetails.expires).to.equal(60 * 60 * 1000 + tokenDetails.issued, 'Verify default expiry period');
      expect(JSON.parse(tokenDetails.capability)).to.deep.equal({ '*': ['*'] }, 'Verify token capability');
    });

    /** @specpartial RSA8e - pass null for TokenParams */
    it('Base token generation with options', async function () {
      var tokenDetails = await rest.auth.requestToken(null);
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(JSON.parse(tokenDetails.capability)).to.deep.equal({ '*': ['*'] }, 'Verify token capability');
    });

    /**
     * Related to RSC1.
     * @specpartial TO3j2 - test passing token in ClientOptions for Rest client
     */
    it('Generate token and init library with it', async function () {
      const helper = this.test.helper;
      var tokenDetails = await rest.auth.requestToken();
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      helper.AblyRest({ token: tokenDetails.token });
    });

    /**
     * @spec TK2d
     * @specpartial RSA8b - test accepts timestamp from TokenParams parameters
     */
    it('Token generation with explicit timestamp', async function () {
      var serverTime = await rest.time();
      var tokenDetails = await rest.auth.requestToken({ timestamp: serverTime });
      expect(tokenDetails.token).to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(JSON.parse(tokenDetails.capability)).to.deep.equal({ '*': ['*'] }, 'Verify token capability');
    });

    /**
     * Related to TK2d, RSA8b
     * @nospec
     */
    it('Token generation with invalid timestamp', async function () {
      var badTime = Date.now() - 30 * 60 * 1000;
      try {
        var tokenDetails = await rest.auth.requestToken({ timestamp: badTime });
      } catch (err) {
        expect(err.statusCode).to.equal(401, 'Verify token request rejected with bad timestamp');
        return;
      }
      throw new Error('Invalid timestamp, expected rejection');
    });

    /** @specpartial RSA9d - generate timestamp from current system time */
    it('Token generation with system timestamp', async function () {
      var tokenDetails = await rest.auth.requestToken();
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(JSON.parse(tokenDetails.capability)).to.deep.equal({ '*': ['*'] }, 'Verify token capability');
    });

    /**
     * Spec item is missing to describe what happens when requesting a token with the same nonce.
     * @spec TK2e
     */
    it('Token generation with duplicate nonce', async function () {
      var serverTime = await rest.time();
      await rest.auth.requestToken({ timestamp: serverTime, nonce: '1234567890123456' });
      try {
        await rest.auth.requestToken({ timestamp: serverTime, nonce: '1234567890123456' });
      } catch (err) {
        expect(err.statusCode).to.equal(401, 'Verify request rejected with duplicated nonce');
        return;
      }
      throw new Error('Invalid nonce, expected rejection');
    });

    /**
     * @specpartial TD6 - test regular client id string
     * @specpartial TK2c - test regular client id string
     */
    it('Token generation with clientId', async function () {
      var testClientId = 'test client id';
      var tokenDetails = await rest.auth.requestToken({ clientId: testClientId });
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(tokenDetails.clientId).to.equal(testClientId, 'Verify client id');
      expect(JSON.parse(tokenDetails.capability)).to.deep.equal({ '*': ['*'] }, 'Verify token capability');
    });

    /**
     * Related to TD6, TK2c
     * @nospec
     */
    it('Token generation with empty string clientId should error', async function () {
      try {
        var tokenDetails = await rest.auth.requestToken({ clientId: '' });
      } catch (err) {
        expect(err.code).to.equal(40012);
        return;
      }
      throw new Error('Expected token generation to error with empty string clientId');
    });

    /**
     * @spec TD5
     * @spec TK2b
     * @specpartial RSA6 - test providing capability
     */
    it('Token generation with capability that subsets key capability', async function () {
      var testCapability = { onlythischannel: ['subscribe'] };
      var tokenDetails = await rest.auth.requestToken({ capability: testCapability });
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(JSON.parse(tokenDetails.capability)).to.deep.equal(testCapability, 'Verify token capability');
    });

    /**
     * Related to TD5
     * @spec AO2a
     * @specpartial RSA8c3 - test passing AuthOptions
     * @specpartial RSA6 - infer capability from provided key
     */
    it('Token generation with specified key', async function () {
      const helper = this.test.helper;
      var testKeyOpts = { key: helper.getTestApp().keys[1].keyStr };
      var testCapability = JSON.parse(helper.getTestApp().keys[1].capability);
      var tokenDetails = await rest.auth.requestToken(null, testKeyOpts);
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(tokenDetails.keyName).to.equal(helper.getTestApp().keys[1].keyName, 'Verify token key');
      expect(JSON.parse(tokenDetails.capability)).to.deep.equal(testCapability, 'Verify token capability');
    });

    /** @nospec */
    it('Token generation with explicit auth', async function () {
      const helper = this.test.helper;
      helper.recordPrivateApi('call.auth.getAuthHeaders');
      const authHeaders = await rest.auth.getAuthHeaders();
      helper.recordPrivateApi('write.auth.authOptions.requestHeaders');
      rest.auth.authOptions.requestHeaders = authHeaders;
      var tokenDetails = await rest.auth.requestToken();
      helper.recordPrivateApi('delete.auth.authOptions.requestHeaders');
      delete rest.auth.authOptions.requestHeaders;
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(tokenDetails.keyName).to.equal(helper.getTestApp().keys[0].keyName, 'Verify token key');
    });

    /**
     * Related to TD5, AO2a, RSA8c3, RSA6
     * @nospec
     */
    it('Token generation with explicit auth, different key', async function () {
      const helper = this.test.helper;
      helper.recordPrivateApi('call.auth.getAuthHeaders');
      const authHeaders = await rest.auth.getAuthHeaders();
      var testKeyOpts = { key: helper.getTestApp().keys[1].keyStr };
      var testCapability = JSON.parse(helper.getTestApp().keys[1].capability);
      var tokenDetails = await rest.auth.requestToken(null, testKeyOpts);
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
      expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
      expect(tokenDetails.keyName).to.equal(helper.getTestApp().keys[1].keyName, 'Verify token key');
      expect(JSON.parse(tokenDetails.capability)).to.deep.equal(testCapability, 'Verify token capability');
    });

    /**
     * Related to TE2
     * @nospec
     */
    it('Token generation with invalid mac', async function () {
      try {
        var tokenDetails = await rest.auth.requestToken({ mac: '12345' });
      } catch (err) {
        expect(err.statusCode).to.equal(401, 'Verify request rejected with bad mac');
        return;
      }
      throw new Error('Invalid mac, expected rejection');
    });

    /** @spec TO3j11 */
    it('Token generation with defaultTokenParams set and no tokenParams passed in', async function () {
      const helper = this.test.helper;
      var rest1 = helper.AblyRest({ defaultTokenParams: { ttl: 123, clientId: 'foo' } });
      var tokenDetails = await rest1.auth.requestToken();
      expect(tokenDetails.token, 'Verify token value').to.be.ok;
      expect(tokenDetails.clientId).to.equal('foo', 'Verify client id from defaultTokenParams used');
      expect(tokenDetails.expires - tokenDetails.issued).to.equal(123, 'Verify ttl from defaultTokenParams used');
    });

    /**
     * Related to TO3j11
     * @specpartial RSA8e - test passing any options overrides library default
     */
    it('Token generation: if tokenParams passed in, defaultTokenParams should be ignored altogether, not merged', async function () {
      const helper = this.test.helper;
      var rest1 = helper.AblyRest({ defaultTokenParams: { ttl: 123, clientId: 'foo' } });
      var tokenDetails = await rest1.auth.requestToken({ clientId: 'bar' }, null);
      expect(tokenDetails.clientId).to.equal(
        'bar',
        'Verify clientId passed in is used, not the one from defaultTokenParams',
      );
      expect(tokenDetails.expires - tokenDetails.issued).to.equal(
        60 * 60 * 1000,
        'Verify ttl from defaultTokenParams ignored completely, even though not overridden',
      );
    });

    /**
     * @specpartial RSA10f - test returns token object
     * @specpartial RSA10j - test passing null for TokenParams and AuthOptions
     */
    it('Authorize with different args', async function () {
      var results = await Promise.all([
        rest.auth.authorize(),
        rest.auth.authorize(null),
        rest.auth.authorize(null, null),
      ]);

      results.forEach((tokenDetails) => {
        expect(tokenDetails.token, 'Check token obtained').to.be.ok;
      });
    });

    /**
     * @spec TD3
     * @specpartial TK2a - test passing in custom ttl
     */
    it('Specify non-default ttl', async function () {
      var tokenDetails = await rest.auth.requestToken({ ttl: 100 * 1000 });
      expect(tokenDetails.expires).to.equal(100 * 1000 + tokenDetails.issued, 'Verify non-default expiry period');
    });

    /**
     * Related to TK2a, RSA5
     * @nospec
     */
    it('Should error with excessive ttl', async function () {
      try {
        var tokenDetails = await rest.auth.requestToken({ ttl: 365 * 24 * 60 * 60 * 1000 });
      } catch (err) {
        expect(err.statusCode).to.equal(400, 'Verify request rejected with excessive expiry');
        return;
      }
      throw new Error('Excessive expiry, expected rejection');
    });

    /**
     * Related to TK2a, RSA5
     * @nospec
     */
    it('Should error with negative ttl', async function () {
      try {
        var tokenDetails = await rest.auth.requestToken({ ttl: -1 });
      } catch (err) {
        expect(err.statusCode).to.equal(400, 'Verify request rejected with negative expiry');
        return;
      }
      throw new Error('Negative expiry, expected rejection');
    });

    /**
     * @specpartial TK2a - test expected type for ttl
     */
    it('Should error with invalid ttl', async function () {
      try {
        var tokenDetails = await rest.auth.requestToken({ ttl: 'notanumber' });
      } catch (err) {
        expect(err.statusCode).to.equal(400, 'Verify request rejected with invalid expiry');
        return;
      }
      throw new Error('Invalid expiry, expected rejection');
    });

    /**
     * createTokenRequest uses the key it was initialized with if authOptions is null,
     * and the token request includes all the fields it should include, but
     * doesn't include ttl or capability by default.
     *
     * @spec RSA9c
     * @spec RSA9g
     * @specpartial TE2 - test keyName exists
     * @specpartial RSA9d - tests only that timestamp is returned
     * @specpartial RSA9e - test ttl is optional
     * @specpartial RSA9f - test capability is optional
     * @specpartial RSA9h - test passing null for TokenParams and AuthOptions
     */
    it('createTokenRequest without authOptions', async function () {
      const helper = this.test.helper;
      var tokenRequest = await rest.auth.createTokenRequest(null, null);
      expect('mac' in tokenRequest, 'check tokenRequest contains a mac').to.be.ok;
      expect('nonce' in tokenRequest, 'check tokenRequest contains a nonce').to.be.ok;
      expect('timestamp' in tokenRequest, 'check tokenRequest contains a timestamp').to.be.ok;
      expect(!('ttl' in tokenRequest), 'check tokenRequest does not contains a ttl by default').to.be.ok;
      expect(!('capability' in tokenRequest), 'check tokenRequest does not contains capabilities by default').to.be.ok;
      expect(tokenRequest.keyName).to.equal(helper.getTestApp().keys[0].keyName);
    });

    /**
     * Related to TE2, RSA11, RSA2
     * @nospec
     */
    it('createTokenRequest uses the key it was initialized with if authOptions does not have a "key" key', async function () {
      const helper = this.test.helper;
      var tokenRequest = await rest.auth.createTokenRequest();
      expect(tokenRequest.keyName).to.equal(helper.getTestApp().keys[0].keyName);
    });

    /**
     * @spec TE3
     * @specpartial RSA9f - can provide capability
     */
    it('createTokenRequest should serialise capability object as JSON', async function () {
      var capability = { '*': ['*'] };
      var tokenRequest = await rest.auth.createTokenRequest({ capability: capability }, null);
      expect(JSON.parse(tokenRequest.capability)).to.deep.equal(
        capability,
        'Verify createTokenRequest has JSON-stringified capability',
      );
    });

    /**
     * Creates a test fixture which checks that the rest client can succesfully make a stats request with the given authParams.
     * @param {string} description Mocha test description
     * @param {object} params The authParams to be tested
     * @param {object} [opts] Fixture options.
     * @param {boolean} [opts.embedInnerToken] Mint an Ably token here and pass it to the echo server via innerToken.
     */
    function testJWTAuthParams(description, params, opts) {
      /**
       * Related to RSC1
       *
       * @spec TN3
       * @specpartial RSC1a - tests passing a JWT
       * @specpartial RSC1c - tests passing a JWT
       * @specpartial RSA4f - test correct JWT format
       * @specpartial RSA8c - test returning JWT for authUrl
       * @specpartial RSA8g - test using authUrl with JWT
       * @specpartial RSA3d - test JWT is correctly passed in REST request
       */
      it(description, async function () {
        const helper = this.test.helper;
        var currentKey = helper.getTestApp().keys[0];
        var keys = { keyName: currentKey.keyName, keySecret: currentKey.keySecret };
        helper.recordPrivateApi('call.Utils.mixin');
        var authParams = helper.Utils.mixin(keys, params);

        /* Mint the embedded token with a client pointed at the platform under test, then hand it to the echo server. */
        if (opts && opts.embedInnerToken) {
          var innerTokenDetails = await helper.AblyRest().auth.requestToken();
          authParams.innerToken = innerTokenDetails.token;
        }

        helper.recordPrivateApi('call.Utils.toQueryString');
        var authUrl = echoServer + '/createJWT' + helper.Utils.toQueryString(authParams);
        var restJWTRequester = helper.AblyRest({ authUrl: authUrl });

        var tokenDetails = await restJWTRequester.auth.requestToken();
        var restClient = helper.AblyRest({ token: tokenDetails.token });
        await restClient.stats();
      });
    }

    // Tests below test the different combinations of authParams for JWT declared above, with valid keys

    testJWTAuthParams('Basic rest JWT', {});
    testJWTAuthParams('Rest JWT with return type ', { returnType: 'jwt' });
    /* Mint the embedded token here (via innerToken) so this works uniformly against cloud and local sandboxes. */
    testJWTAuthParams('Rest embedded JWT', {}, { embedInnerToken: true });
    testJWTAuthParams('Rest embedded JWT with encryption', { encrypted: 1 }, { embedInnerToken: true });

    /**
     * Related to RSA8g, RSA4f
     * @nospec
     */
    it('JWT request with invalid key', async function () {
      const helper = this.test.helper;
      var keys = { keyName: 'invalid.invalid', keySecret: 'invalidinvalid' };
      helper.recordPrivateApi('call.Utils.toQueryString');
      var authUrl = echoServer + '/createJWT' + helper.Utils.toQueryString(keys);
      var restJWTRequester = helper.AblyRest({ authUrl: authUrl });

      var tokenDetails = await restJWTRequester.auth.requestToken();
      var restClient = helper.AblyRest({ token: tokenDetails.token });
      try {
        var stats = await restClient.stats();
      } catch (err) {
        expect(err.code).to.equal(40400, 'Verify token is invalid because app id does not exist');
        expect(err.statusCode).to.equal(404, 'Verify token is invalid because app id does not exist');
        return;
      }
      throw new Error('Expected restClient.stats() to throw token error');
    });

    /** @specpartial RSA8g - test using authCallback with JWT */
    it('Rest JWT with authCallback', async function () {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[0];
      var keys = { keyName: currentKey.keyName, keySecret: currentKey.keySecret };
      helper.recordPrivateApi('call.Utils.toQueryString');
      var authUrl = echoServer + '/createJWT' + helper.Utils.toQueryString(keys);
      var restJWTRequester = helper.AblyRest({ authUrl: authUrl });

      var authCallback = function (tokenParams, callback) {
        restJWTRequester.auth.requestToken().then(function (tokenDetails) {
          callback(null, tokenDetails.token);
        });
      };

      var restClient = helper.AblyRest({ authCallback: authCallback });
      var stats = await restClient.stats();
    });

    /**
     * Related to RSA8g, RSA4f, RSA8c, RSA8d
     * @nospec
     */
    it('Rest JWT with authCallback and invalid keys', async function () {
      const helper = this.test.helper;
      var keys = { keyName: 'invalid.invalid', keySecret: 'invalidinvalid' };
      helper.recordPrivateApi('call.Utils.toQueryString');
      var authUrl = echoServer + '/createJWT' + helper.Utils.toQueryString(keys);
      var restJWTRequester = helper.AblyRest({ authUrl: authUrl });

      var authCallback = function (tokenParams, callback) {
        restJWTRequester.auth.requestToken().then(function (tokenDetails) {
          callback(null, tokenDetails.token);
        });
      };

      var restClient = helper.AblyRest({ authCallback: authCallback });
      try {
        await restClient.stats();
      } catch (err) {
        expect(err.code).to.equal(40400, 'Verify code is 40400');
        expect(err.statusCode).to.equal(404, 'Verify token is invalid because app id does not exist');
        return;
      }
      throw new Error('Expected restClient.stats() to throw token error');
    });

    /**
     * Related to RSA8d, TO3j5, RSC9
     * @nospec
     */
    it('authCallback is only invoked once on concurrent auth', async function () {
      const helper = this.test.helper;
      var authCallbackInvocations = 0;
      function authCallback(tokenParams, callback) {
        authCallbackInvocations++;
        rest.auth.createTokenRequest(tokenParams).then(function (tokenRequest) {
          callback(null, tokenRequest);
        });
      }

      /* Example client-side using the token */
      var restClient = helper.AblyRest({ authCallback: authCallback });
      var channel = restClient.channels.get('auth_concurrent');

      await Promise.all([channel.history(), channel.history()]);
      expect(authCallbackInvocations).to.equal(
        1,
        'Check authCallback only invoked once -- was: ' + authCallbackInvocations,
      );
    });
  });
});
