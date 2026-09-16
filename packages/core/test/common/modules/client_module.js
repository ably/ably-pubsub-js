'use strict';

/* Shared test helper used for creating Http and Real-time clients */

define(['ably', 'globals', 'test/common/modules/testapp_module'], function (Ably, ablyGlobals, testAppHelper) {
  var utils = Ably.Realtime.Utils;

  /* Ably's public test-support echo server, unrelated to the app under test. */
  var echoServerHost = 'echo.ably.io';

  function ablyClientOptions(helper, options) {
    helper = helper.addingHelperFunction('ablyClientOptions');
    helper.recordPrivateApi('call.Utils.copy');
    var clientOptions = utils.copy(ablyGlobals);

    /* When the test app was provisioned against a local sandbox, that app runs on
     * its own isolated server; route every client at it (host/port/scheme the
     * sandbox reported), replacing the cloud defaults from globals. Applied before
     * the per-test options are mixed in, so a test that sets its own
     * endpoint/host/port still overrides this. */
    var testApp = testAppHelper.getTestApp();
    if (testApp && testApp.local) {
      clientOptions.endpoint = testApp.endpoint;
      clientOptions.port = testApp.port;
      clientOptions.tlsPort = testApp.port;
      clientOptions.tls = testApp.tls;
    }

    helper.recordPrivateApi('call.Utils.mixin');
    utils.mixin(clientOptions, options);
    var authMethods = ['authUrl', 'authCallback', 'token', 'tokenDetails', 'key'];

    /* Use a default api key if no auth methods provided */
    if (
      authMethods.every(function (method) {
        return !(method in clientOptions);
      })
    ) {
      clientOptions.key = testAppHelper.getTestApp().keys[0].keyStr;
    }

    return clientOptions;
  }

  function ablyHttp(helper, options) {
    helper = helper.addingHelperFunction('ablyHttp');
    return new Ably.Http(ablyClientOptions(helper, options));
  }

  /* A Http client pointed at the echo server rather than the app's endpoint. Drops the app's
   * routing (port/tlsPort) — against a local sandbox those point at an ephemeral port
   * echo.ably.io isn't listening on — while keeping the app key for auth. */
  function ablyHttpEcho(helper, options) {
    helper = helper.addingHelperFunction('ablyHttpEcho');
    var clientOptions = ablyClientOptions(helper, options);
    delete clientOptions.port;
    delete clientOptions.tlsPort;
    clientOptions.endpoint = echoServerHost;
    clientOptions.tls = true;
    return new Ably.Http(clientOptions);
  }

  function ablyRealtime(helper, options) {
    helper = helper.addingHelperFunction('ablyRealtime');
    return new Ably.Realtime(ablyClientOptions(helper, options));
  }

  return (module.exports = {
    Ably: Ably,
    AblyHttp: ablyHttp,
    AblyHttpEcho: ablyHttpEcho,
    AblyRealtime: ablyRealtime,
    ablyClientOptions,
  });
});
