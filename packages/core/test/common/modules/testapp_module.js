'use strict';

/*
	Test App creation helper used within Mocha tests.
*/

define(['test/common/modules/testapp_manager', 'globals'], function (testAppManager, ablyGlobals) {
  var globalObject = isBrowser ? window : global;

  function updateTestApp(newTestApp) {
    globalObject.AblyTestApp = newTestApp;
  }

  function configuredTestApp() {
    return globalObject.AblyTestApp;
  }

  /* setup is typically called at the start of a test suite.
		 If setup is called more than once i.e. across multiple suites,
		 then no need to recreate a test app, unless forceSetup is true.
		 If forceSetup is true and existing app exists, then the app will be torn down (deleted)
		 first */
  function setup(helper, forceSetup, done) {
    if (typeof forceSetup === 'function') {
      done = forceSetup;
      forceSetup = false;
    }
    if (configuredTestApp() && !forceSetup) {
      return done();
    }

    var setupFn = function () {
      testAppManager.setup(function (err, newTestApp) {
        if (err) {
          done(new Error('Could not set up Test App: ' + JSON.stringify(err)));
        } else {
          updateTestApp(newTestApp);
          console.info(
            'Test App ' +
              configuredTestApp().appId +
              ' at endpoint ' +
              (ablyGlobals.endpoint || 'production:main') +
              ' has been set up',
          );
          done();
        }
      });
    };

    if (configuredTestApp() && forceSetup) {
      tearDown(helper, function (err) {
        if (err) {
          done(err);
        } else {
          setupFn();
        }
      });
    } else {
      setupFn();
    }
  }

  /* tearDown is typically called by an afterAll test suite block.
		 If tearDown is called more than once i.e. across multiple suites,
		 and other test suites are still to run, then we must not yet delete the test app */
  function tearDown(helper, done) {
    if (!configuredTestApp()) {
      done();
      return;
    }

    testAppManager.tearDown(helper, configuredTestApp(), function (err) {
      if (err) {
        done(new Error('Could not tear down Test App: ' + JSON.stringify(err)));
      } else {
        console.info('Test App ' + configuredTestApp().appId + ' has been torn down');
        updateTestApp(null);
        done();
      }
    });
  }

  return (module.exports = {
    setup: setup,
    tearDown: tearDown,
    createStatsFixtureData: testAppManager.createStatsFixtureData,
    getTestApp: function () {
      return globalObject.AblyTestApp;
    },
  });
});
