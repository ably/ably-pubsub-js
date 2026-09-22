'use strict';

/*
	Modules helper
	--------------

	RequireJS is used within browser tests to manage dependency loading.
	Node.js CommonJS is used within Node.js Jasmine tests, however the RequireJS syntax is not
		supported so this library provides compatibility with RequiredJS

	Exports
	-------

	For browsers, RequireJS convention is used returning the exported methods.
	For Node.js,  public methods are exported using module.exports

	To export for both Node.js & Browser use the follwing at the end of your modules:
		return modules.exports = yourObject;
*/

var isBrowser = typeof window == 'object';
if (isBrowser) {
  window.module = {};
  window.isBrowser = true;
} else {
  global.isBrowser = false;

  // Simulate the dependency injection from RequireJS in Node.js
  global.define = function (requireModules, callback) {
    if (typeof requireModules === 'function') {
      // no dependencies were provided, just call the provided callback
      requireModules.apply(this, require);
    } else {
      var namedDependencies = require('../common/globals/named_dependencies');

      var required = requireModules.map(function (module) {
        var modulePath = (namedDependencies[module] || {}).node;
        if (modulePath === 'skip') {
          return;
        }

        if (modulePath) {
          // Paths are written relative to this package. Dev dependencies are the exception:
          // they are installed once for the whole monorepo, so a `node_modules/…` path is
          // resolved from the repo root instead.
          var base = modulePath.indexOf('node_modules/') === 0 ? '../../../../' : '../../';
          return require(base + modulePath);
        } else {
          /* define has used a relative path to the base such as spec/file */
          if (module.indexOf('/') >= 0) {
            return require('../../' + module);
          } else {
            /* requiring a named Node.js module such as async */
            return require(module);
          }
        }
      });

      callback.apply(this, required);
    }
  };
}
