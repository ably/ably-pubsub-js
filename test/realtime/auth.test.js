'use strict';

define(['ably', 'shared_helper', 'async', 'chai'], function (Ably, Helper, async, chai) {
  var currentTime;
  var exampleTokenDetails;
  var exports = {};
  var expect = chai.expect;
  var _exports = {};
  var http = new Ably.Realtime._Http();
  var jwtTestChannelName = 'JWT_test' + String(Math.floor(Math.random() * 10000) + 1);
  var echoServer = 'https://echo.ably.io';

  /*
   * Helper function to fetch JWT tokens from the echo server
   */
  function getJWT(params, helper, callback) {
    helper = helper.addingHelperFunction('getJWT');
    var authUrl = echoServer + '/createJWT';
    helper.recordPrivateApi('call.http.doUri');
    Helper.whenPromiseSettles(http.doUri('get', authUrl, null, null, params), function (err, result) {
      if (result.error) {
        callback(result.error, null);
      }
      callback(null, result.body.toString());
    });
  }

  describe('realtime/auth', function () {
    this.timeout(60 * 1000);

    before(function (done) {
      const helper = Helper.forHook(this);
      helper.setupApp(function (err) {
        if (err) {
          done(err);
          return;
        }

        var rest = helper.AblyRest({ queryTime: true });
        Helper.whenPromiseSettles(rest.time(), function (err, time) {
          if (err) {
            done(err);
            return;
          } else {
            currentTime = time;
            Helper.whenPromiseSettles(rest.auth.requestToken({}), function (err, tokenDetails) {
              try {
                expect(!err, err && helper.displayError(err)).to.be.ok;
                done();
              } catch (err) {
                done(err);
              }
            });
          }
        });
      });
    });

    /**
     * Base token generation case
     *
     * @spec RSA8a
     */
    it('authbase0', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({ queryTime: true });
      Helper.whenPromiseSettles(realtime.auth.requestToken(), function (err, tokenDetails) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }
        try {
          expect(tokenDetails.token, 'Verify token value').to.be.ok;
          expect(tokenDetails.issued && tokenDetails.issued >= currentTime, 'Verify token issued').to.be.ok;
          expect(tokenDetails.expires && tokenDetails.expires > tokenDetails.issued, 'Verify token expires').to.be.ok;
          expect(tokenDetails.expires).to.equal(60 * 60 * 1000 + tokenDetails.issued, 'Verify default expiry period');
          expect(JSON.parse(tokenDetails.capability)).to.deep.equal({ '*': ['*'] }, 'Verify token capability');
          helper.closeAndFinish(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });
    });

    /**
     * Use authUrl for authentication with JSON TokenDetails response
     *
     * @spec TO3j6
     * @specpartial RSA8c - expect JSON TokenDetails
     */
    it('auth_useAuthUrl_json', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken(null, null), function (err, tokenDetails) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        var authPath = echoServer + '/?type=json&body=' + encodeURIComponent(JSON.stringify(tokenDetails));

        realtime = helper.AblyRealtime({ authUrl: authPath });

        realtime.connection.on('connected', function () {
          helper.closeAndFinish(done, realtime);
          return;
        });

        helper.monitorConnection(done, realtime);
      });
    });

    /**
     * Use authUrl for authentication with JSON TokenDetails response, with authMethod=POST
     *
     * @spec TO3j6
     * @spec TO3j7
     * @spec TO3j9
     * @specpartial RSA8c - expect JSON TokenDetails from a POST request
     */
    it('auth_useAuthUrl_post_json', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken(null, null), function (err, tokenDetails) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        var authUrl = echoServer + '/?type=json&';

        realtime = helper.AblyRealtime({ authUrl: authUrl, authMethod: 'POST', authParams: tokenDetails });

        realtime.connection.on('connected', function () {
          helper.closeAndFinish(done, realtime);
          return;
        });

        helper.monitorConnection(done, realtime);
      });
    });

    /**
     * Use authUrl for authentication with plain text token response
     *
     * @spec TO3j6
     * @specpartial RSA8c - expect a token string from plain text response
     * @specpartial RSA8g - test authURL returned ably token string
     */
    it('auth_useAuthUrl_plainText', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken(null, null), function (err, tokenDetails) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        var authPath = echoServer + '/?type=text&body=' + tokenDetails['token'];

        realtime = helper.AblyRealtime({ authUrl: authPath });

        realtime.connection.on('connected', function () {
          helper.closeAndFinish(done, realtime);
          return;
        });

        helper.monitorConnection(done, realtime);
      });
    });

    /**
     * Use authCallback for authentication with tokenRequest response
     *
     * @specpartial RSA4 - token auth is used due to authCallback
     * @specpartial RSA8d - TokenRequest is returned
     * @specpartial TO3j5 - can pass authCallback property
     */
    it('auth_useAuthCallback_tokenRequestResponse', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      var authCallback = function (tokenParams, callback) {
        Helper.whenPromiseSettles(rest.auth.createTokenRequest(tokenParams, null), function (err, tokenRequest) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          try {
            expect('nonce' in tokenRequest).to.be.ok;
          } catch (err) {
            done(err);
          }
          callback(null, tokenRequest);
        });
      };

      realtime = helper.AblyRealtime({ authCallback: authCallback });

      realtime.connection.on('connected', function () {
        try {
          helper.recordPrivateApi('read.auth.method');
          expect(realtime.auth.method).to.equal('token');
          helper.closeAndFinish(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });

      helper.monitorConnection(done, realtime);
    });

    /**
     * Use authCallback for authentication with tokenDetails response,
     * also check that clientId lib is initialized with is passed through
     * to the auth callback
     *
     * @specpartial RSA4 - token auth is used due to authCallback
     * @specpartial RSA8d - TokenDetails is returned
     * @specpartial TO3j5 - can pass authCallback property
     */
    it('auth_useAuthCallback_tokenDetailsResponse', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      var clientId = 'test clientid';
      var authCallback = function (tokenParams, callback) {
        Helper.whenPromiseSettles(rest.auth.requestToken(tokenParams, null), function (err, tokenDetails) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          try {
            expect('token' in tokenDetails).to.be.ok;
            expect(tokenDetails.clientId).to.equal(clientId);
          } catch (err) {
            done(err);
          }
          callback(null, tokenDetails);
        });
      };

      realtime = helper.AblyRealtime({ authCallback: authCallback, clientId: clientId });

      realtime.connection.on('connected', function () {
        try {
          helper.recordPrivateApi('read.auth.method');
          expect(realtime.auth.method).to.equal('token');
          helper.closeAndFinish(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });

      helper.monitorConnection(done, realtime);
    });

    /**
     * Use authCallback for authentication with token string response
     *
     * @specpartial RSA4 - token auth is used due to authCallback
     * @specpartial RSA8d - token string is returned
     * @specpartial TO3j5 - can pass authCallback property
     * @specpartial RSA8g - authCallback returned ably token string
     */
    it('auth_useAuthCallback_tokenStringResponse', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      var authCallback = function (tokenParams, callback) {
        Helper.whenPromiseSettles(rest.auth.requestToken(tokenParams, null), function (err, tokenDetails) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
            return;
          }
          try {
            expect('token' in tokenDetails).to.be.ok;
          } catch (err) {
            done(err);
          }
          callback(null, tokenDetails.token);
        });
      };

      realtime = helper.AblyRealtime({ authCallback: authCallback });

      realtime.connection.on('connected', function () {
        try {
          helper.recordPrivateApi('read.auth.method');
          expect(realtime.auth.method).to.equal('token');
          helper.closeAndFinish(done, realtime);
        } catch (err) {
          helper.closeAndFinish(done, realtime, err);
        }
      });

      helper.monitorConnection(done, realtime);
    });

    /**
     * If the given authUrl includes any querystring params, they
     * should be preserved, and in the GET case, authParams/tokenParams should be
     * merged with them. If a name conflict occurs, authParams/tokenParams should
     * take precedence
     *
     * @spec RSA8c1c
     */
    it('auth_useAuthUrl_mixed_authParams_qsParams', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.createTokenRequest(null, null), function (err, tokenRequest) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        /* Complete token request requires both parts to be combined, and
         * requires the keyName in the higherPrecence part to take precedence
         * over the wrong keyName */
        var lowerPrecedenceTokenRequestParts = {
          keyName: 'WRONG',
          timestamp: tokenRequest.timestamp,
          nonce: tokenRequest.nonce,
        };
        var higherPrecedenceTokenRequestParts = {
          keyName: tokenRequest.keyName,
          mac: tokenRequest.mac,
        };
        helper.recordPrivateApi('call.Utils.toQueryString');
        var authPath = echoServer + '/qs_to_body' + helper.Utils.toQueryString(lowerPrecedenceTokenRequestParts);

        realtime = helper.AblyRealtime({ authUrl: authPath, authParams: higherPrecedenceTokenRequestParts });

        realtime.connection.on('connected', function () {
          helper.closeAndFinish(done, realtime);
          return;
        });
      });
    });

    /**
     * Request a token using clientId, then initialize a connection without one,
     * and check that the connection inherits the clientId from the tokenDetails
     *
     * @spec RSA7b2
     */
    it('auth_clientid_inheritance', function (done) {
      var helper = this.test.helper,
        rest = helper.AblyRest(),
        testClientId = 'testClientId';
      var authCallback = function (tokenParams, callback) {
        Helper.whenPromiseSettles(rest.auth.requestToken({ clientId: testClientId }), function (err, tokenDetails) {
          if (err) {
            done(err);
            return;
          }
          callback(null, tokenDetails);
        });
      };

      var realtime = helper.AblyRealtime({ authCallback: authCallback });

      realtime.connection.on('connected', function () {
        try {
          expect(realtime.auth.clientId).to.equal(testClientId);
          realtime.connection.close();
          done();
        } catch (err) {
          done(err);
        }
        return;
      });

      realtime.connection.on('failed', function (err) {
        realtime.close();
        done(err);
        return;
      });
    });

    /**
     * Rest token generation with clientId, then connecting with a
     * different clientId, should fail with a library-generated message
     *
     * @spec RSA15a
     * @spec RSA15c
     */
    it('auth_clientid_inheritance2', function (done) {
      var helper = this.test.helper,
        clientRealtime,
        testClientId = 'test client id';
      var rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken({ clientId: testClientId }), function (err, tokenDetails) {
        if (err) {
          done(err);
          return;
        }
        clientRealtime = helper.AblyRealtime({ token: tokenDetails, clientId: 'WRONG' });
        clientRealtime.connection.once('failed', function (stateChange) {
          try {
            expect(stateChange.reason.code).to.equal(40102);
            clientRealtime.close();
            done();
          } catch (err) {
            done(err);
          }
        });
      });
    });

    /**
     * Rest token generation with clientId '*', then connecting with just the
     * token string and a different clientId, should succeed (RSA15b)
     *
     * @spec RSA15b
     */
    it('auth_clientid_inheritance3', function (done) {
      var helper = this.test.helper,
        realtime,
        testClientId = 'test client id';
      var rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken({ clientId: '*' }), function (err, tokenDetails) {
        if (err) {
          done(err);
          return;
        }
        realtime = helper.AblyRealtime({ token: tokenDetails.token, clientId: 'test client id' });
        realtime.connection.on('connected', function () {
          try {
            expect(realtime.auth.clientId).to.equal(testClientId);
            realtime.connection.close();
            done();
          } catch (err) {
            done(err);
          }
          return;
        });
        helper.monitorConnection(done, realtime);
      });
    });

    /**
     * Rest token generation with clientId '*', then connecting with
     * tokenDetails and a clientId, should succeed (RSA15b)
     *
     * @spec RSA15b
     */
    it('auth_clientid_inheritance4', function (done) {
      var helper = this.test.helper,
        realtime,
        testClientId = 'test client id';
      var rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken({ clientId: '*' }), function (err, tokenDetails) {
        if (err) {
          done(err);
          return;
        }
        realtime = helper.AblyRealtime({ token: tokenDetails, clientId: 'test client id' });
        realtime.connection.on('connected', function () {
          try {
            expect(realtime.auth.clientId).to.equal(testClientId);
            realtime.connection.close();
            done();
          } catch (err) {
            done(err);
          }
          return;
        });
        helper.monitorConnection(done, realtime);
      });
    });

    /**
     * Request a token using clientId, then initialize a connection using just the token string,
     * and check that the connection inherits the clientId from the connectionDetails
     *
     * @spec RSA7b3
     */
    it('auth_clientid_inheritance5', function (done) {
      var helper = this.test.helper,
        clientRealtime,
        testClientId = 'test client id';
      var rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken({ clientId: testClientId }), function (err, tokenDetails) {
        if (err) {
          done(err);
          return;
        }
        clientRealtime = helper.AblyRealtime({ token: tokenDetails.token });
        clientRealtime.connection.on('connected', function () {
          try {
            expect(clientRealtime.auth.clientId).to.equal(testClientId);
            helper.closeAndFinish(done, clientRealtime);
          } catch (err) {
            helper.closeAndFinish(done, clientRealtime, err);
          }
          return;
        });
        helper.monitorConnection(done, clientRealtime);
      });
    });

    /**
     * RSA4c, RSA4e
     * Try to connect with an authCallback that fails in various ways (calling back with an error, calling back with nothing, timing out, etc) should go to disconnected, not failed, and wrapped in a 80019 error code
     */
    function authCallback_failures(createRealtimeOptions, expectFailure) {
      return function (done) {
        const helper = this.test.helper;
        var realtime = helper.AblyRealtime(createRealtimeOptions(helper));
        realtime.connection.on(function (stateChange) {
          if (stateChange.previous !== 'initialized') {
            try {
              expect(stateChange.current).to.equal(
                expectFailure ? 'failed' : 'disconnected',
                'Check connection goes to the expected state',
              );
              expect(stateChange.reason.statusCode).to.equal(
                expectFailure ? 403 : 401,
                'Check correct cause error code',
              );
            } catch (err) {
              done(err);
            }
            try {
              expect(stateChange.reason.code).to.equal(80019, 'Check correct error code');
              realtime.connection.off();
              helper.closeAndFinish(done, realtime);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          }
        });
      };
    }

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authCallback results in an error
     */
    it(
      'authCallback_error',
      authCallback_failures(() => ({
        authCallback: function (tokenParams, callback) {
          callback(new Error('An error from client code that the authCallback might return'));
        },
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authCallback times out after realtimeRequestTimeout
     */
    it(
      'authCallback_timeout',
      authCallback_failures(() => ({
        authCallback: function () {
          /* (^._.^)ﾉ */
        },
        realtimeRequestTimeout: 100,
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authCallback times out
     */
    it(
      'authCallback_nothing',
      authCallback_failures(() => ({
        authCallback: function (tokenParams, callback) {
          callback();
        },
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authCallback provided token that is in an invalid format
     * @specpartial RSA4f - invalid object
     */
    it(
      'authCallback_malformed',
      authCallback_failures(() => ({
        authCallback: function (tokenParams, callback) {
          callback(null, { horse: 'ebooks' });
        },
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authCallback provided token that is in an invalid format
     * @specpartial RSA4f - token is greater than 128KiB
     */
    it(
      'authCallback_too_long_string',
      authCallback_failures(() => ({
        authCallback: function (tokenParams, callback) {
          var token = '';
          for (var i = 0; i < Math.pow(2, 17) + 1; i++) {
            token = token + 'a';
          }
          callback(null, token);
        },
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authCallback provided token that is in an invalid format
     */
    it(
      'authCallback_empty_string',
      authCallback_failures(() => ({
        authCallback: function (tokenParams, callback) {
          callback(null, '');
        },
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authUrl times out after realtimeRequestTimeout
     */
    it(
      'authUrl_timeout',
      authCallback_failures((helper) => ({
        authUrl: helper.unroutableAddress,
        realtimeRequestTimeout: 100,
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - request to authUrl fails
     */
    it(
      'authUrl_404',
      authCallback_failures(() => ({
        authUrl: 'http://example.com/404',
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authUrl provided token that is in an invalid format
     * @specpartial RSA4f - invalid authUrl response content type
     */
    it(
      'authUrl_wrong_content_type',
      authCallback_failures(() => ({
        authUrl: 'http://example.com/',
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - request to authUrl fails
     */
    it(
      'authUrl_401',
      authCallback_failures(() => ({
        authUrl: echoServer + '/respondwith?status=401',
      })),
    );

    /**
     * @spec RSA4c1
     * @spec RSA4c2
     * @specpartial RSA4c - authUrl provided token that is in an invalid format
     */
    it(
      'authUrl_double_encoded',
      authCallback_failures(() => ({
        authUrl:
          echoServer + '/?type=json&body=' + encodeURIComponent(JSON.stringify(JSON.stringify({ keyName: 'foo.bar' }))),
      })),
    );

    /**
     * 403 should cause the connection to go to failed, unlike the others
     *
     * @specpartial RSA4d - authUrl results in an HTTP 403 response
     */
    it(
      'authUrl_403',
      authCallback_failures(
        () => ({
          authUrl: echoServer + '/respondwith?status=403',
        }),
        true,
      ),
    ); /* expectFailed: */

    /**
     * 403 should cause connection to fail even with an external error response
     *
     * @specpartial RSA4d - authUrl results in an HTTP 403 response
     */
    it(
      'authUrl_403_custom_error',
      authCallback_failures(
        () => ({
          authUrl:
            echoServer +
            '/?status=403&type=json&body=' +
            encodeURIComponent(JSON.stringify({ error: { some_custom: 'error' } })),
        }),
        true,
      ),
    );

    /**
     * @specpartial RSA4d - authUrl results in an HTTP 403 response
     * @specpartial RSA4d1 - explicit authorize() call
     */
    it('authUrl_403_previously_active', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken(null, null), function (err, tokenDetails) {
        if (err) {
          helper.closeAndFinish(done, realtime, err);
          return;
        }

        var authPath = echoServer + '/?type=json&body=' + encodeURIComponent(JSON.stringify(tokenDetails));

        realtime = helper.AblyRealtime({ authUrl: authPath });

        realtime.connection.on('connected', function () {
          /* replace the authUrl and reauth */
          Helper.whenPromiseSettles(
            realtime.auth.authorize(null, { authUrl: echoServer + '/respondwith?status=403' }),
            function (err, tokenDetails) {
              try {
                expect(err && err.statusCode).to.equal(403, 'Check err statusCode');
                expect(err && err.code).to.equal(40300, 'Check err code');
                expect(realtime.connection.state).to.equal('failed', 'Check connection goes to the failed state');
                expect(realtime.connection.errorReason && realtime.connection.errorReason.statusCode).to.equal(
                  403,
                  'Check correct cause error code',
                );
                expect(realtime.connection.errorReason.code).to.equal(80019, 'Check correct connection error code');
                helper.closeAndFinish(done, realtime);
              } catch (err) {
                helper.closeAndFinish(done, realtime, err);
              }
            },
          );
        });
      });
    });

    /**
     * Check state change reason is propagated during a disconnect
     * (when connecting with a token that expires while connected)
     *
     * @spec RSA4b1
     * @specpartial RSA4b - token expired
     */
    Helper.testOnAllTransportsAndProtocols(this, 'auth_token_expires', function (realtimeOpts) {
      return function (done) {
        var helper = this.test.helper,
          clientRealtime,
          rest = helper.AblyRest();

        Helper.whenPromiseSettles(rest.auth.requestToken({ ttl: 5000 }, null), function (err, tokenDetails) {
          if (err) {
            done(err);
            return;
          }
          helper.recordPrivateApi('call.Utils.mixin');
          clientRealtime = helper.AblyRealtime(
            helper.Utils.mixin(realtimeOpts, { tokenDetails: tokenDetails, queryTime: true }),
          );

          clientRealtime.connection.on('failed', function () {
            helper.closeAndFinish(done, clientRealtime, new Error('Failed to connect before token expired'));
          });
          clientRealtime.connection.once('connected', function () {
            clientRealtime.connection.off('failed');
            clientRealtime.connection.once('disconnected', function (stateChange) {
              try {
                expect(stateChange.reason.statusCode).to.equal(401, 'Verify correct disconnect statusCode');
                expect(stateChange.reason.code).to.equal(40142, 'Verify correct disconnect code');
                helper.closeAndFinish(done, clientRealtime);
              } catch (err) {
                helper.closeAndFinish(done, clientRealtime, err);
              }
            });
          });
        });
      };
    });

    /**
     * Check that when the queryTime option is provided
     * that the time from the server is only requested once
     * and all subsequent requests use the time offset
     *
     * @spec RSA10k
     * @spec TO3j10
     */
    it('auth_query_time_once', function (done) {
      var helper = this.test.helper,
        rest = helper.AblyRest({ queryTime: true }),
        timeRequestCount = 0,
        originalTime = rest.time;

      /* stub time */
      helper.recordPrivateApi('replace.rest.time');
      rest.time = async function () {
        timeRequestCount += 1;
        return originalTime.call(rest);
      };

      try {
        helper.recordPrivateApi('read.rest.serverTimeOffset');
        expect(
          isNaN(parseInt(rest.serverTimeOffset)) && !rest.serverTimeOffset,
          'Server time offset is empty and falsey until a time request has been made',
        ).to.be.ok;
      } catch (err) {
        done(err);
        return;
      }

      var asyncFns = [];
      for (var i = 0; i < 10; i++) {
        asyncFns.push(function (callback) {
          Helper.whenPromiseSettles(rest.auth.createTokenRequest({}, null), function (err, tokenDetails) {
            if (err) {
              return callback(err);
            }
            helper.recordPrivateApi('read.rest.serverTimeOffset');
            expect(!isNaN(parseInt(rest.serverTimeOffset)), 'Server time offset is configured when time is requested')
              .to.be.ok;
            callback();
          });
        });
      }

      async.series(asyncFns, function (err) {
        if (err) {
          done(err);
          return;
        }

        try {
          expect(1).to.equal(timeRequestCount, 'Time function is only called once per instance');
          done();
        } catch (err) {
          done(err);
        }
      });
    });

    /**
     * If using authcallback when a token expires, should automatically request a
     * new token
     *
     * @spec RSA4b1
     * @specpartial RTN15a - attempt to reconnect and restore the connection state on token expire
     * @specpartial RSA10e - obtain new token from authcallback when previous expires
     */
    Helper.testOnAllTransportsAndProtocols(this, 'auth_tokenDetails_expiry_with_authcallback', function (realtimeOpts) {
      return function (done) {
        var helper = this.test.helper,
          realtime,
          rest = helper.AblyRest();
        var clientId = 'test clientid';
        var authCallback = function (tokenParams, callback) {
          tokenParams.ttl = 5000;
          Helper.whenPromiseSettles(rest.auth.requestToken(tokenParams, null), function (err, tokenDetails) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            callback(null, tokenDetails);
          });
        };

        helper.recordPrivateApi('call.Utils.mixin');
        realtime = helper.AblyRealtime(
          helper.Utils.mixin(realtimeOpts, { authCallback: authCallback, clientId: clientId }),
        );
        helper.monitorConnection(done, realtime);
        realtime.connection.once('connected', function () {
          realtime.connection.once('disconnected', function (stateChange) {
            try {
              expect(stateChange.reason.code).to.equal(40142, 'Verify correct disconnect code');
            } catch (err) {
              done(err);
              return;
            }
            realtime.connection.once('connected', function () {
              realtime.close();
              done();
            });
          });
        });

        helper.monitorConnection(done, realtime);
      };
    });

    /**
     * Same as previous but with just a token, so ably-js doesn't know that the
     * token's expired
     *
     * @spec RTC8a4
     * @specpartial RTN15a - attempt to reconnect and restore the connection state on token expire
     * @specpartial RSA10e - obtain new token from authcallback when previous expires
     */
    Helper.testOnAllTransportsAndProtocols(this, 'auth_token_string_expiry_with_authcallback', function (realtimeOpts) {
      return function (done) {
        var helper = this.test.helper,
          realtime,
          rest = helper.AblyRest();
        var clientId = 'test clientid';
        var authCallback = function (tokenParams, callback) {
          tokenParams.ttl = 5000;
          Helper.whenPromiseSettles(rest.auth.requestToken(tokenParams, null), function (err, tokenDetails) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            callback(null, tokenDetails.token);
          });
        };

        helper.recordPrivateApi('call.Utils.mixin');
        realtime = helper.AblyRealtime(
          helper.Utils.mixin(realtimeOpts, { authCallback: authCallback, clientId: clientId }),
        );
        helper.monitorConnection(done, realtime);
        realtime.connection.once('connected', function () {
          realtime.connection.once('disconnected', function (stateChange) {
            try {
              expect(stateChange.reason.code).to.equal(40142, 'Verify correct disconnect code');
            } catch (err) {
              done(err);
              return;
            }
            realtime.connection.once('connected', function () {
              realtime.close();
              done();
            });
          });
        });

        helper.monitorConnection(done, realtime);
      };
    });

    /**
     * Same as previous but with no way to generate a new token
     *
     * @spec RSA4a
     * @spec RSA4a2
     */
    Helper.testOnAllTransportsAndProtocols(this, 'auth_token_string_expiry_with_token', function (realtimeOpts) {
      return function (done) {
        var helper = this.test.helper,
          realtime,
          rest = helper.AblyRest();
        var clientId = 'test clientid';
        Helper.whenPromiseSettles(
          rest.auth.requestToken({ ttl: 5000, clientId: clientId }, null),
          function (err, tokenDetails) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            helper.recordPrivateApi('call.Utils.mixin');
            realtime = helper.AblyRealtime(
              helper.Utils.mixin(realtimeOpts, { token: tokenDetails.token, clientId: clientId }),
            );
            realtime.connection.once('connected', function () {
              realtime.connection.once('disconnected', function (stateChange) {
                try {
                  expect(stateChange.reason.code).to.equal(40142, 'Verify correct disconnect code');
                } catch (err) {
                  done(err);
                  return;
                }
                realtime.connection.once('failed', function (stateChange) {
                  /* Library has no way to generate a new token, so should fail */
                  try {
                    expect(stateChange.reason.code).to.equal(40171, 'Verify correct cause failure code');
                    realtime.close();
                    done();
                  } catch (err) {
                    done(err);
                  }
                });
              });
            });
          },
        );
      };
    });

    /**
     * Try to connect with an expired token string
     *
     * @spec RSA4a
     * @spec RSA4a2
     */
    Helper.testOnAllTransportsAndProtocols(this, 'auth_expired_token_string', function (realtimeOpts) {
      return function (done) {
        var helper = this.test.helper,
          realtime,
          rest = helper.AblyRest();
        var clientId = 'test clientid';
        Helper.whenPromiseSettles(
          rest.auth.requestToken({ ttl: 1, clientId: clientId }, null),
          function (err, tokenDetails) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            setTimeout(function () {
              helper.recordPrivateApi('call.Utils.mixin');
              realtime = helper.AblyRealtime(
                helper.Utils.mixin(realtimeOpts, { token: tokenDetails.token, clientId: clientId }),
              );
              realtime.connection.once('failed', function (stateChange) {
                try {
                  expect(stateChange.reason.code).to.equal(40171, 'Verify correct failure code');
                  realtime.close();
                  done();
                } catch (err) {
                  done(err);
                }
              });
              /* Note: ws transport indicates viability when websocket is
               * established, before realtime sends error response. So token error
               * goes through the same path as a connected transport, so goes to
               * disconnected first */
              ['connected', 'suspended'].forEach(function (state) {
                realtime.connection.on(state, function () {
                  done(new Error('State changed to ' + state + ', should have gone to failed'));
                  realtime.close();
                });
              });
            }, 100);
          },
        );
      };
    });

    /**
     * Use authorize() to force a reauth using an existing authCallback
     *
     * @spec RSA10a
     * @spec RTC8
     * @specskip
     */
    Helper.testOnAllTransportsAndProtocols.skip(this, 'reauth_authCallback', function (realtimeOpts) {
      return function (done) {
        var helper = this.test.helper,
          realtime,
          rest = helper.AblyRest();
        var firstTime = true;
        var authCallback = function (tokenParams, callback) {
          tokenParams.clientId = '*';
          tokenParams.capability = firstTime ? { wrong: ['*'] } : { right: ['*'] };
          firstTime = false;
          Helper.whenPromiseSettles(rest.auth.requestToken(tokenParams, null), function (err, tokenDetails) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            callback(null, tokenDetails);
          });
        };

        helper.recordPrivateApi('call.Utils.mixin');
        realtime = helper.AblyRealtime(helper.Utils.mixin(realtimeOpts, { authCallback: authCallback }));
        realtime.connection.once('connected', function () {
          var channel = realtime.channels.get('right');
          Helper.whenPromiseSettles(channel.attach(), function (err) {
            try {
              expect(err, 'Check using first token, without channel attach capability').to.be.ok;
              expect(err.code).to.equal(40160, 'Check expected error code');
            } catch (err) {
              done(err);
              return;
            }

            /* soon after connected, reauth */
            Helper.whenPromiseSettles(realtime.auth.authorize(null, null), function (err) {
              try {
                expect(!err, err && helper.displayError(err)).to.be.ok;
              } catch (err) {
                done(err);
                return;
              }
              Helper.whenPromiseSettles(channel.attach(), function (err) {
                try {
                  expect(!err, 'Check using second token, with channel attach capability').to.be.ok;
                  helper.closeAndFinish(done, realtime);
                } catch (err) {
                  helper.closeAndFinish(done, realtime, err);
                }
              });
            });
          });
        });
        helper.monitorConnection(done, realtime);
      };
    });

    /** @spec RSA10j */
    it('authorize_updates_stored_details', function (done) {
      var helper = this.test.helper,
        realtime = helper.AblyRealtime({
          autoConnect: false,
          defaultTokenParams: { version: 1 },
          token: '1',
          authUrl: '1',
        });

      try {
        helper.recordPrivateApi('read.auth.tokenParams.version');
        helper.recordPrivateApi('read.auth.authOptions.authUrl');

        expect(realtime.auth.tokenParams.version).to.equal(1, 'Check initial defaultTokenParams stored');
        expect(realtime.auth.tokenDetails.token).to.equal('1', 'Check initial token stored');
        expect(realtime.auth.authOptions.authUrl).to.equal('1', 'Check initial authUrl stored');
        realtime.auth.authorize({ version: 2 }, { authUrl: '2', token: '2' });
        expect(realtime.auth.tokenParams.version).to.equal(2, 'Check authorize updated the stored tokenParams');
        expect(realtime.auth.tokenDetails.token).to.equal('2', 'Check authorize updated the stored tokenDetails');
        expect(realtime.auth.authOptions.authUrl).to.equal('2', 'Check authorize updated the stored authOptions');
        realtime.auth.authorize(null, { token: '3' });
        expect(realtime.auth.authOptions.authUrl).to.equal(
          undefined,
          'Check authorize completely replaces stored authOptions with passed in ones',
        );

        helper.closeAndFinish(done, realtime);
      } catch (err) {
        helper.closeAndFinish(done, realtime, err);
      }
    });

    /**
     * Inject a fake AUTH message from realtime, check that we reauth and send our own in reply
     *
     * @spec RTN22
     */
    it('mocked_reauth', function (done) {
      var helper = this.test.helper,
        rest = helper.AblyRest(),
        authCallback = function (tokenParams, callback) {
          // Request a token (should happen twice)
          Helper.whenPromiseSettles(rest.auth.requestToken(tokenParams, null), function (err, tokenDetails) {
            if (err) {
              helper.closeAndFinish(done, realtime, err);
              return;
            }
            callback(null, tokenDetails);
          });
        },
        realtime = helper.AblyRealtime({ authCallback: authCallback, transports: [helper.bestTransport] });

      realtime.connection.once('connected', function () {
        helper.recordPrivateApi('read.connectionManager.activeProtocol.transport');
        var transport = realtime.connection.connectionManager.activeProtocol.transport,
          originalSend = transport.send;
        helper.recordPrivateApi('replace.transport.send');
        /* Spy on transport.send to detect the outgoing AUTH */
        transport.send = function (message) {
          if (message.action === 17) {
            try {
              expect(message.auth.accessToken, 'Check AUTH message structure is as expected').to.be.ok;
              helper.closeAndFinish(done, realtime);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          } else {
            helper.recordPrivateApi('call.transport.send');
            originalSend.call(this, message);
          }
        };
        /* Inject a fake AUTH from realtime */
        helper.recordPrivateApi('call.transport.onProtocolMessage');
        transport.onProtocolMessage({ action: 17 });
      });
    });

    /**
     * Request a token specifying a clientId and verify that the returned token
     * has the requested clientId.
     *
     * @spec RSA7b3
     * @specpartial RSA8g - authCallback returned JWT token string
     */
    it('auth_jwt_with_clientid', function (done) {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[0];
      var keys = { keyName: currentKey.keyName, keySecret: currentKey.keySecret };
      var clientId = 'testJWTClientId';
      helper.recordPrivateApi('call.Utils.mixin');
      var params = helper.Utils.mixin(keys, { clientId: clientId });
      var authCallback = function (tokenParams, callback) {
        getJWT(params, helper, callback);
      };

      var realtime = helper.AblyRealtime({ authCallback: authCallback });

      realtime.connection.on('connected', function () {
        try {
          expect(realtime.auth.clientId).to.equal(clientId);
          realtime.connection.close();
          done();
        } catch (err) {
          done(err);
        }
        return;
      });

      realtime.connection.on('failed', function (err) {
        realtime.close();
        done(err);
        return;
      });
    });

    /**
     * Request a token specifying a clientId and verify that the returned token
     * has the requested clientId. Token will be returned with content-type application/jwt.
     *
     * There is no spec item to test content-type application/jwt with authCallback.
     *
     * @spec RSA7b3
     * @specpartial RSA8g - authCallback returned JWT token string
     */
    it('auth_jwt_with_clientid_application_jwt', function (done) {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[0];
      var keys = { keyName: currentKey.keyName, keySecret: currentKey.keySecret, returnType: 'jwt' };
      var clientId = 'testJWTClientId';
      helper.recordPrivateApi('call.Utils.mixin');
      var params = helper.Utils.mixin(keys, { clientId: clientId });
      var authCallback = function (tokenParams, callback) {
        getJWT(params, helper, callback);
      };

      var realtime = helper.AblyRealtime({ authCallback: authCallback });

      realtime.connection.on('connected', function () {
        try {
          expect(realtime.auth.clientId).to.equal(clientId);
          realtime.connection.close();
          done();
        } catch (err) {
          done(err);
        }
        return;
      });

      realtime.connection.on('failed', function (err) {
        realtime.close();
        done(err);
        return;
      });
    });

    /**
     * Request a token specifying subscribe-only capabilities and verify that posting
     * to a channel fails.
     *
     * @nospec
     */
    it('auth_jwt_with_subscribe_only_capability', function (done) {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[3]; // get subscribe-only keys { "*":["subscribe"] }
      var params = { keyName: currentKey.keyName, keySecret: currentKey.keySecret };
      var authCallback = function (tokenParams, callback) {
        getJWT(params, helper, callback);
      };

      var realtime = helper.AblyRealtime({ authCallback: authCallback });
      realtime.connection.once('connected', function () {
        var channel = realtime.channels.get(jwtTestChannelName);
        Helper.whenPromiseSettles(channel.publish('greeting', 'Hello World!'), function (err) {
          try {
            expect(err.code).to.equal(40160, 'Verify publish denied code');
            expect(err.statusCode).to.equal(401, 'Verify publish denied status code');
            realtime.connection.close();
            done();
          } catch (err) {
            done(err);
          }
        });
      });
    });

    /**
     * @spec RTC17
     */
    it('realtime client mirrors the auth clientId', function (done) {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[0];
      var keys = { keyName: currentKey.keyName, keySecret: currentKey.keySecret };
      var clientId = 'rtc17-client-id';
      helper.recordPrivateApi('call.Utils.mixin');
      var params = helper.Utils.mixin(keys, { clientId: clientId });
      var authCallback = function (tokenParams, callback) {
        getJWT(params, helper, callback);
      };

      var realtime = helper.AblyRealtime({ authCallback: authCallback });

      realtime.connection.on('connected', function () {
        try {
          expect(realtime.clientId).to.equal(clientId);
          realtime.connection.close();
          done();
        } catch (err) {
          done(err);
        }
        return;
      });

      realtime.connection.on('failed', function (err) {
        realtime.close();
        done(err);
        return;
      });
    });

    /**
     * Request a token with publish capabilities and verify that posting
     * to a channel succeeds.
     *
     * @nospec
     */
    it('auth_jwt_with_publish_capability', function (done) {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[0];
      var params = { keyName: currentKey.keyName, keySecret: currentKey.keySecret };
      var authCallback = function (tokenParams, callback) {
        getJWT(params, helper, callback);
      };

      var publishEvent = 'publishEvent',
        messageData = 'Hello World!';
      var realtime = helper.AblyRealtime({ authCallback: authCallback });
      realtime.connection.once('connected', function () {
        var channel = realtime.channels.get(jwtTestChannelName);
        channel.subscribe(publishEvent, function (msg) {
          try {
            expect(msg.data).to.equal(messageData, 'Verify message data matches');
            realtime.connection.close();
            done();
          } catch (err) {
            done(err);
          }
        });
        channel.publish(publishEvent, messageData);
      });
    });

    /**
     * Request a JWT token that is about to expire, check that the client disconnects
     * and receives the expected reason in the state change.
     *
     * @spec RSA4b
     */
    it('auth_jwt_with_token_that_expires', function (done) {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[0];
      var params = { keyName: currentKey.keyName, keySecret: currentKey.keySecret, expiresIn: 5 };
      var authCallback = function (tokenParams, callback) {
        getJWT(params, helper, callback);
      };

      var realtime = helper.AblyRealtime({ authCallback: authCallback });
      realtime.connection.once('connected', function () {
        realtime.connection.once('disconnected', function (stateChange) {
          try {
            expect(stateChange.reason.code).to.equal(40142, 'Verify disconnected reason change code');
            realtime.connection.close();
            done();
          } catch (err) {
            done(err);
          }
        });
      });
    });

    /**
     * Request a JWT token that is about to be renewed, check that the client reauths
     * without going through a disconnected state.
     *
     * @spec RTC8a4
     * @specpartial RSA10e - obtain new token from authcallback when previous expires
     */
    it('auth_jwt_with_token_that_renews', function (done) {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[0];
      // Sandbox sends an auth protocol message 30 seconds before a token expires.
      // We create a token that lasts 35 so there's room to receive the update event message.
      var params = { keyName: currentKey.keyName, keySecret: currentKey.keySecret, expiresIn: 35 };
      var authCallback = function (tokenParams, callback) {
        getJWT(params, helper, callback);
      };

      var realtime = helper.AblyRealtime({ authCallback: authCallback });
      realtime.connection.once('connected', function () {
        var originalToken = realtime.auth.tokenDetails.token;
        realtime.connection.once('update', function () {
          try {
            expect(originalToken).to.not.equal(realtime.auth.tokenDetails.token, 'Verify a new token has been issued');
            realtime.connection.close();
            done();
          } catch (err) {
            done(err);
          }
        });
      });
    });

    /**
     * Request a JWT token, initialize a realtime client with it and
     * verify it can make authenticated calls.
     *
     * @spec TN3
     */
    it('init_client_with_simple_jwt_token', function (done) {
      const helper = this.test.helper;
      var currentKey = helper.getTestApp().keys[0];
      var params = { keyName: currentKey.keyName, keySecret: currentKey.keySecret };
      getJWT(params, helper, function (err, token) {
        if (err) {
          done(err);
          return;
        }
        var realtime = helper.AblyRealtime({ token: token });
        realtime.connection.once('connected', function () {
          try {
            expect(token).to.equal(realtime.auth.tokenDetails.token, 'Verify that token is the same');
            realtime.connection.close();
            done();
          } catch (err) {
            done(err);
          }
        });
      });
    });

    /** @spec RTN14b */
    it('reauth_consistently_expired_token', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken({ ttl: 1 }), function (err, token) {
        if (err) {
          done(err);
          return;
        }
        var authCallbackCallCount = 0;
        var authCallback = function (_, callback) {
          authCallbackCallCount++;
          callback(null, token.token);
        };
        /* Wait a few ms to ensure token is expired */
        setTimeout(function () {
          realtime = helper.AblyRealtime({ authCallback: authCallback, disconnectedRetryTimeout: 15000 });
          /* Wait 5s, expect to have seen two attempts to get a token -- so the
           * authCallback called twice -- and the connection to now be sitting in
           * the disconnected state */
          setTimeout(function () {
            try {
              expect(authCallbackCallCount).to.equal(2);
              expect(realtime.connection.state).to.equal('disconnected');
              helper.closeAndFinish(done, realtime);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          }, 3000);
        }, 100);
      });
    });

    /** @specpartial RSA4b1 - only autoremove expired tokens if have a server time offset set */
    it('expired_token_no_autoremove_when_dont_have_servertime', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken(), function (err, token) {
        if (err) {
          done(err);
          return;
        }
        /* Fake an expired token */
        token.expires = Date.now() - 5000;
        var authCallbackCallCount = 0;
        var authCallback = function (_, callback) {
          authCallbackCallCount++;
          callback(null, token);
        };
        realtime = helper.AblyRealtime({ authCallback: authCallback });
        realtime.connection.on('connected', function () {
          try {
            expect(authCallbackCallCount).to.equal(1, 'Check we did not autoremove an expired token ourselves');
            helper.closeAndFinish(done, realtime);
          } catch (err) {
            helper.closeAndFinish(done, realtime, err);
          }
        });
      });
    });

    /** @specpartial RSA4b1 - second case */
    it('expired_token_autoremove_when_have_servertime', function (done) {
      var helper = this.test.helper,
        realtime,
        rest = helper.AblyRest();
      Helper.whenPromiseSettles(rest.auth.requestToken(), function (err, token) {
        if (err) {
          done(err);
          return;
        }
        /* Fake an expired token */
        token.expires = Date.now() - 5000;
        var authCallbackCallCount = 0;
        var authCallback = function (_, callback) {
          authCallbackCallCount++;
          callback(null, token);
        };
        realtime = helper.AblyRealtime({ authCallback: authCallback, autoConnect: false });
        /* Set the server time offset */
        Helper.whenPromiseSettles(realtime.time(), function () {
          realtime.connect();
          realtime.connection.on('connected', function () {
            try {
              expect(authCallbackCallCount).to.equal(
                2,
                'Check we did autoremove the expired token ourselves, so authCallback is called a second time',
              );
              helper.closeAndFinish(done, realtime);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });
        });
      });
    });

    /**
     * Check that only the last authorize matters
     *
     * @nospec
     */
    it('multiple_concurrent_authorize', function (done) {
      const helper = this.test.helper;
      var realtime = helper.AblyRealtime({
        useTokenAuth: true,
        defaultTokenParams: { capability: { wrong: ['*'] } },
      });
      realtime.connection.once('connected', function () {
        Helper.whenPromiseSettles(realtime.auth.authorize({ capability: { stillWrong: ['*'] } }), function (err) {
          try {
            expect(!err, 'Check first authorize cb was called').to.be.ok;
          } catch (err) {
            done(err);
          }
        });
        Helper.whenPromiseSettles(realtime.auth.authorize({ capability: { alsoNope: ['*'] } }), function (err) {
          try {
            expect(!err, 'Check second authorize cb was called').to.be.ok;
          } catch (err) {
            done(err);
          }
        });
        Helper.whenPromiseSettles(
          realtime.auth.authorize({ capability: { wtfAreYouThinking: ['*'] } }),
          function (err) {
            try {
              expect(!err, 'Check third authorize one cb was called').to.be.ok;
            } catch (err) {
              done(err);
            }
          },
        );
        Helper.whenPromiseSettles(realtime.auth.authorize({ capability: { right: ['*'] } }), function (err) {
          if (err) {
            helper.closeAndFinish(done, realtime, err);
          }
          Helper.whenPromiseSettles(realtime.channels.get('right').attach(), function (err) {
            try {
              expect(!err, (err && helper.displayError(err)) || 'Successfully attached').to.be.ok;
              helper.closeAndFinish(done, realtime);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });
        });
      });
    });

    /** @nospec */
    Helper.testOnAllTransportsAndProtocols(this, 'authorize_immediately_after_init', function (realtimeOpts) {
      return function (done) {
        const helper = this.test.helper;
        var realtime = helper.AblyRealtime({
          useTokenAuth: true,
          defaultTokenParams: { capability: { wrong: ['*'] } },
        });
        realtime.auth.authorize({ capability: { right: ['*'] } });
        realtime.connection.once('disconnected', function () {
          helper.closeAndFinish(done, realtime, err);
        });
        realtime.connection.once('connected', function () {
          Helper.whenPromiseSettles(realtime.channels.get('right').attach(), function (err) {
            try {
              expect(!err, (err && helper.displayError(err)) || 'Successfully attached').to.be.ok;
              helper.closeAndFinish(done, realtime);
            } catch (err) {
              helper.closeAndFinish(done, realtime, err);
            }
          });
        });
      };
    });

    /**
     * v1-style trailing-callback shape on Auth.{authorize, requestToken,
     * createTokenRequest} throws synchronously with a steering ErrorInfo.
     */
    [
      { method: 'authorize', invoke: (auth) => auth.authorize(null, null, () => {}) },
      { method: 'requestToken', invoke: (auth) => auth.requestToken(null, null, () => {}) },
      { method: 'createTokenRequest', invoke: (auth) => auth.createTokenRequest(null, null, () => {}) },
    ].forEach(function (testCase) {
      it('v1_callback_auth_' + testCase.method + '_throws_synchronously', function (done) {
        var helper = this.test.helper,
          realtime = helper.AblyRealtime({ autoConnect: false });

        try {
          testCase.invoke(realtime.auth);
          helper.closeAndFinish(
            done,
            realtime,
            new Error('expected auth.' + testCase.method + '() to throw on v1 callback shape'),
          );
        } catch (err) {
          try {
            expect(err.code).to.equal(40025);
            expect(err.message).to.contain('v1 callback signature');
            expect(err.message).to.contain('no longer supported');
            expect(err.remediation).to.be.a('string');
            expect(err.remediation).to.contain('Drop the trailing callback');
            expect(err.remediation).to.contain(
              'https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md',
            );
            helper.closeAndFinish(done, realtime);
          } catch (assertionErr) {
            helper.closeAndFinish(done, realtime, assertionErr);
          }
        }
      });
    });
  });
});
