'use strict';

/* Provide a global inspect() method, useful for debugging object properties */
var isBrowser = typeof window == 'object';
if (isBrowser) {
  window.inspect = function (object) {
    return JSON.stringify(object);
  };
} else {
  var util = require('util');
  global.inspect = util.inspect;
}
