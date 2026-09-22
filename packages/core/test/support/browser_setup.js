'use strict';

var allTestFiles = [],
  TEST_HOOKS_REGEXP = /root_hooks\.js$/i,
  TEST_REGEXP = /\.test\.js$/i,
  //	TEST_REGEXP = /simple\.test\.js$/i,
  TEAR_DOWN_REGEXP = /tear_down\.js$/i;

var pathToModule = function (path) {
  return path.replace(/^\/base\//, '').replace(/\.js$/, '');
};

var forEachKey = function (object, fn) {
  for (var prop in object) {
    if (object.hasOwnProperty(prop)) {
      fn(prop);
    }
  }
};

// Add the root mocha hooks
forEachKey(window.__testFiles__.files, function (file) {
  if (TEST_HOOKS_REGEXP.test(file)) {
    // Normalize paths to RequireJS module names.
    allTestFiles.push(pathToModule(file));
  }
});

// Match all test files
forEachKey(window.__testFiles__.files, function (file) {
  if (TEST_REGEXP.test(file)) {
    // Normalize paths to RequireJS module names.
    allTestFiles.push(pathToModule(file));
  }
});

// Add the final tear down
forEachKey(window.__testFiles__.files, function (file) {
  if (TEAR_DOWN_REGEXP.test(file)) {
    // Normalize paths to RequireJS module names.
    allTestFiles.push(pathToModule(file));
  }
});
var baseUrl = '';

require([(baseUrl + '/test/common/globals/named_dependencies.js').replace('//', '/')], function (modules) {
  var requireJsPaths = {};
  for (var key in modules) {
    if (modules.hasOwnProperty(key) && modules[key].browser) {
      requireJsPaths[key] = modules[key].browser;
    }
  }

  require.config({
    // Karma serves files under /base, which is the basePath from your config file
    baseUrl: baseUrl,

    // Ensure changes to these modules are reflected in node_helper.js
    paths: requireJsPaths,

    // The following requireJS depdendencies are not requireJS compatible but instead pollute the global namespace
    // It is better therefore to grab the global object and provide that to requireJS dependency management
    shim: {
      ably: {
        exports: 'Ably',
      },
      'browser-base64': {
        exports: 'Base64',
      },
      'vcdiff-decoder': {
        exports: 'vcdiffDecoder',
      },
    },

    // dynamically load all test files
    deps: allTestFiles,

    callback: () => {
      // (For some reason things don’t work if you return a Promise from this callback, hence the nested async function)
      (async () => {
        // Let modular.test.js register its tests before we run the test suite
        await registerAblyModularTests();

        // we have to kickoff mocha
        mocha.run();
      })();
    },
  });
});
