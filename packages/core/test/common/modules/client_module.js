'use strict';

/* Shared test helper used for creating Rest and Real-time clients */

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

  function ablyRest(helper, options) {
    helper = helper.addingHelperFunction('ablyRest');
    return new Ably.Rest(ablyClientOptions(helper, options));
  }

  /* A Rest client pointed at the echo server rather than the app's endpoint. Drops the app's
   * routing (port/tlsPort) — against a local sandbox those point at an ephemeral port
   * echo.ably.io isn't listening on — while keeping the app key for auth. */
  function ablyRestEcho(helper, options) {
    helper = helper.addingHelperFunction('ablyRestEcho');
    var clientOptions = ablyClientOptions(helper, options);
    delete clientOptions.port;
    delete clientOptions.tlsPort;
    clientOptions.endpoint = echoServerHost;
    clientOptions.tls = true;
    return new Ably.Rest(clientOptions);
  }

  function ablyRealtime(helper, options) {
    helper = helper.addingHelperFunction('ablyRealtime');
    return new Ably.Realtime(ablyClientOptions(helper, options));
  }

  function ablyRealtimeWithoutEndpoint(helper, options) {
    helper = helper.addingHelperFunction('ablyRealtime');
    const clientOptions = ablyClientOptions(helper, options);
    delete clientOptions.endpoint;
    return new Ably.Realtime(clientOptions);
  }

  return (module.exports = {
    Ably: Ably,
    AblyRest: ablyRest,
    AblyRestEcho: ablyRestEcho,
    AblyRealtime: ablyRealtime,
    AblyRealtimeWithoutEndpoint: ablyRealtimeWithoutEndpoint,
    ablyClientOptions,
  });
});
