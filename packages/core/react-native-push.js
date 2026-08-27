'use strict';

// Entry point for resolvers that do not support the package `exports` map, such as Metro before
// React Native 0.79. Resolvers with `exports` support use the "./react-native-push" entry in
// package.json instead.
module.exports = require('./build/react-native-push.js');
