'use strict';

/* Shared test helper for the Jasmine test suite that simplifies
	 the dependencies by providing common methods in a single dependency */

define([
  'test/common/modules/testapp_module',
  'test/common/modules/client_module',
  'test/common/modules/testapp_manager',
  'globals',
  'async',
  'chai',
  'private_api_recorder',
], function (testAppModule, clientModule, testAppManager, globals, async, chai, privateApiRecorder) {
  var utils = clientModule.Ably.Realtime.Utils;
  var platform = clientModule.Ably.Realtime.Platform;
  var BufferUtils = platform.BufferUtils;
  var expect = chai.expect;
  /* IANA reserved; requests to it will hang forever */
  var unroutableHost = '10.255.255.1';
  var unroutableAddress = 'http://' + unroutableHost + '/';
  var unroutableWssAddress = 'wss://' + unroutableHost + '/';

  class SharedHelper {
    getTestApp = testAppModule.getTestApp;

    Ably = clientModule.Ably;
    Utils = utils;

    loadTestData = testAppManager.loadJsonData;
    testResourcesPath = testAppManager.testResourcesPath;

    unroutableHost = unroutableHost;
    unroutableAddress = unroutableAddress;
    unroutableWssAddress = unroutableWssAddress;
    flushTestLogs = globals.flushLogs;

    constructor(context) {
      if (!context) {
        throw new Error('SharedHelper created without context');
      }
      this.context = context;
      this.privateApiContext = privateApiRecorder.createContext(context);
    }

    addingHelperFunction(helperFunctionName) {
      return new SharedHelper({ ...this.context, helperStack: [helperFunctionName, ...this.context.helperStack] });
    }

    withParameterisedTestTitle(title) {
      return new SharedHelper({ ...this.context, parameterisedTestTitle: title });
    }

    static createContext(data) {
      return {
        ...data,
        helperStack: [],
      };
    }

    static extractSuiteHierarchy(suite) {
      const hierarchy = [];
      while (suite.title) {
        hierarchy.unshift(suite.title);
        suite = suite.parent;
      }
      return hierarchy;
    }

    static forTest(thisInBeforeEach) {
      const context = {
        type: 'test',
        file: thisInBeforeEach.currentTest.file,
        suite: this.extractSuiteHierarchy(thisInBeforeEach.currentTest.parent),
        title: thisInBeforeEach.currentTest.title,
        parameterisedTestTitle: null,
      };

      return new this(this.createContext(context));
    }

    static forHook(thisInHook) {
      /**
       * Based on what I’ve observed (haven’t found good documentation about it), the value of `this` in a hook varies:
       *
       * - `before` hook in a test file: Context, with properties:
       *    - test: Hook
       *
       * - `beforeEach` hook in a test file: Suite, which has a `ctx`: Context property with properties:
       *   - test: Hook
       *
       * - global `after` hook: Context, with properties:
       *   - test: Hook
       *
       *  For the test file hooks, the Hook has a `file` property, but for some reason the root hook doesn’t (i.e. doesn’t indicate which file the hook lives in)
       */
      const mochaContext = 'ctx' in thisInHook ? thisInHook.ctx : thisInHook;
      const mochaHook = mochaContext.test;

      const context = {
        type: 'hook',
        title: mochaHook.originalTitle,
      };

      if (!mochaHook.parent.root) {
        // For some reason the root hook doesn’t contain file information
        context.file = mochaHook.file;
        context.suite = this.extractSuiteHierarchy(mochaHook.parent);
      } else {
        context.file = null;
        context.suite = null;
      }

      return new this(this.createContext(context));
    }

    static forTestDefinition(thisInDescribe, label) {
      if (!label) {
        throw new Error('SharedHelper.forTestDefinition called without label');
      }

      const context = {
        type: 'definition',
        file: thisInDescribe.file,
        suite: this.extractSuiteHierarchy(thisInDescribe),
        label,
      };

      return new this(this.createContext(context));
    }

    recordTestStart() {
      this.privateApiContext.recordTestStart();
    }

    recordPrivateApi(identifier) {
      this.privateApiContext.record(identifier);
    }

    get availableTransports() {
      const helper = this.addingHelperFunction('availableTransports');
      return helper._availableTransports;
    }

    get _availableTransports() {
      this.recordPrivateApi('call.Utils.keysArray');
      this.recordPrivateApi('call.ConnectionManager.supportedTransports');
      this.recordPrivateApi('read.Realtime._transports');
      const transports = utils.keysArray(
        clientModule.Ably.Realtime.ConnectionManager.supportedTransports(clientModule.Ably.Realtime._transports),
      );
      /* The compatibility harness can restrict the suite to a transport subset
       * (ABLY_TEST_TRANSPORTS) when the target server implements only some. */
      if (globals.testTransports) {
        return transports.filter((transport) => globals.testTransports.includes(transport));
      }
      return transports;
    }

    get bestTransport() {
      const helper = this.addingHelperFunction('bestTransport');
      return helper._bestTransport;
    }

    get _bestTransport() {
      return this.availableTransports[0];
    }

    displayError(err) {
      if (typeof err == 'string' || err == null) return err;

      var result = '';
      if (err.statusCode) result += err.statusCode + '; ';
      if (typeof err.message == 'string') result += err.message;
      if (typeof err.message == 'object') result += JSON.stringify(err.message);

      return result;
    }

    monitorConnection(done, realtime, states) {
      (states || ['failed', 'suspended']).forEach(function (state) {
        realtime.connection.on(state, function () {
          done(new Error('Connection monitoring: state changed to ' + state + ', aborting test'));
          realtime.close();
        });
      });
    }

    async monitorConnectionAsync(action, realtime, states) {
      const monitoringResultPromise = new Promise((resolve, reject) => {
        this.monitorConnection((err) => (err ? reject(err) : resolve()), realtime, states);
      });
      const actionResultPromise = Promise.resolve(action());

      return Promise.race([monitoringResultPromise, actionResultPromise]);
    }

    closeAndFinish(done, realtime, err) {
      const helper = this.addingHelperFunction('closeAndFinish');
      helper._closeAndFinish(done, realtime, err);
    }

    _closeAndFinish(done, realtime, err) {
      if (typeof realtime === 'undefined') {
        // Likely called in a catch block for an exception
        // that occured before realtime was initialized
        done(err);
        return;
      }
      if (Object.prototype.toString.call(realtime) == '[object Array]') {
        var realtimes = realtime.filter(function (rt) {
          return rt !== undefined;
        });
        this.closeAndFinishSeveral(done, realtimes, err);
        return;
      }
      this.callbackOnClose(realtime, function () {
        done(err);
      });
    }

    async closeAndFinishAsync(realtime, err) {
      const helper = this.addingHelperFunction('closeAndFinishAsync');
      return helper._closeAndFinishAsync(realtime, err);
    }

    async _closeAndFinishAsync(realtime, err) {
      return new Promise((resolve, reject) => {
        this.closeAndFinish((err) => (err ? reject(err) : resolve()), realtime, err);
      });
    }

    /**
     * Uses a callback to communicate the result of a `Promise`. The first argument passed to the callback will be either an error (when the promise is rejected) or `null` (when the promise is fulfilled). In the case where the promise is fulfilled, the resulting value will be passed to the callback as a second argument.
     */
    static whenPromiseSettles(promise, callback) {
      promise
        .then((result) => {
          callback(null, result);
        })
        .catch((err) => {
          callback(err);
        });
    }

    simulateDroppedConnection(realtime) {
      const helper = this.addingHelperFunction('simulateDroppedConnection');
      helper._simulateDroppedConnection(realtime);
    }

    _simulateDroppedConnection(realtime) {
      const self = this;
      // Go into the 'disconnected' state before actually disconnecting the transports
      // to avoid the instantaneous reconnect attempt that would be triggered in
      // notifyState by the active transport getting disconnected from a connected state
      realtime.connection.once('disconnected', function () {
        self.recordPrivateApi('call.connectionManager.disconnectAllTransports');
        realtime.connection.connectionManager.disconnectAllTransports();
      });
      this.recordPrivateApi('call.connectionManager.requestState');
      realtime.connection.connectionManager.requestState({ state: 'disconnected' });
    }

    /**
     * Force the connection into the suspended state. Since spec version 6.1.0
     * the client retains its connection state through suspended and will attempt
     * to resume on the next connect (RTN14h); pass clearConnectionState: true to
     * additionally discard the connection state, modelling the case where the
     * connection can no longer be resumed (e.g. the device was asleep for longer
     * than the server preserves state), so the next connect makes a fresh
     * connection with a new connectionId.
     */
    becomeSuspended(realtime, cb, clearConnectionState) {
      const helper = this.addingHelperFunction('becomeSuspended');
      return helper._becomeSuspended(realtime, cb, clearConnectionState);
    }

    _becomeSuspended(realtime, cb, clearConnectionState) {
      this.recordPrivateApi('call.connectionManager.disconnectAllTransports');
      realtime.connection.connectionManager.disconnectAllTransports();
      const self = this;
      realtime.connection.once('disconnected', function () {
        self.recordPrivateApi('call.connectionManager.notifyState');
        realtime.connection.connectionManager.notifyState({ state: 'suspended' });
        if (clearConnectionState) {
          self.recordPrivateApi('call.connectionManager.clearConnection');
          realtime.connection.connectionManager.clearConnection();
        }
      });
      if (cb) {
        realtime.connection.once('suspended', function () {
          cb();
        });
      } else {
        return realtime.connection.once('suspended');
      }
    }

    callbackOnClose(realtime, callback) {
      const helper = this.addingHelperFunction('callbackOnClose');
      helper._callbackOnClose(realtime, callback);
    }

    _callbackOnClose(realtime, callback) {
      this.recordPrivateApi('read.connectionManager.activeProtocol');
      if (!realtime.connection.connectionManager.activeProtocol) {
        this.recordPrivateApi('call.Platform.nextTick');
        platform.Config.nextTick(function () {
          realtime.close();
          callback();
        });
        return;
      }
      this.recordPrivateApi('read.connectionManager.activeProtocol.transport');
      this.recordPrivateApi('listen.transport.disposed');
      realtime.connection.connectionManager.activeProtocol.transport.on('disposed', function () {
        callback();
      });
      /* wait a tick before closing in order to avoid the final close
       * happening synchronously in a publish/attach callback, which
       * complicates channelattach_publish_invalid etc. */
      this.recordPrivateApi('call.Platform.nextTick');
      platform.Config.nextTick(function () {
        realtime.close();
      });
    }

    closeAndFinishSeveral(done, realtimeArray, e) {
      const helper = this.addingHelperFunction('closeAndFinishSeveral');
      helper._closeAndFinishSeveral(done, realtimeArray, e);
    }

    _closeAndFinishSeveral(done, realtimeArray, e) {
      async.map(
        realtimeArray,
        (realtime, mapCb) => {
          var parallelItem = (parallelCb) => {
            this.callbackOnClose(realtime, function () {
              parallelCb();
            });
          };
          mapCb(null, parallelItem);
        },
        function (err, parallelItems) {
          async.parallel(parallelItems, function () {
            if (err) {
              done(err);
              return;
            }
            done(e);
          });
        },
      );
    }

    /* testFn is assumed to be a function of realtimeOptions and channelName that returns a mocha test */
    static testOnAllTransportsAndProtocols(thisInDescribe, testName, testFn, skip, only) {
      const helper = SharedHelper.forTestDefinition(thisInDescribe, testName).addingHelperFunction(
        'testOnAllTransportsAndProtocols',
      );
      const itFn = skip ? it.skip : only ? it.only : it;

      function createTest(options, channelName) {
        return function (done) {
          this.test.helper = this.test.helper.withParameterisedTestTitle(testName);
          // we want to support both callback-based and async test functions here.
          // for this we check the return type of the test function to see if it is a Promise.
          // if it is, then the test function provided is an async one, and won't call done function on its own.
          // instead we attach own .then and .catch callbacks for the promise here and call done when needed
          const testFnReturn = testFn(options, channelName).apply(this, [done]);
          if (testFnReturn instanceof Promise) {
            testFnReturn.then(done).catch(done);
          } else {
            return testFnReturn;
          }
        };
      }

      const transports = helper.availableTransports;
      transports.forEach(function (transport) {
        itFn(
          testName + ' with ' + transport + ' binary protocol',
          createTest({ transports: [transport], useBinaryProtocol: true }, `${testName} ${transport} binary`),
        );
        itFn(
          testName + ' with ' + transport + ' text protocol',
          createTest({ transports: [transport], useBinaryProtocol: false }, `${testName} ${transport} text`),
        );
      });
      /* Plus one for no transport specified (ie use websocket/base mechanism if
       * present).  (we explicitly specify all transports since node only does
       * websocket+nodecomet if comet is explicitly requested)
       * */
      itFn(
        testName + ' with binary protocol',
        createTest({ transports, useBinaryProtocol: true }, `${testName} binary`),
      );
      itFn(testName + ' with text protocol', createTest({ transports, useBinaryProtocol: false }, `${testName} text`));
    }

    static testOnJsonMsgpack(testName, testFn, skip, only) {
      const itFn = skip ? it.skip : only ? it.only : it;

      function createTest(options, channelName) {
        return async function () {
          this.test.helper = this.test.helper.withParameterisedTestTitle(testName);
          return testFn.apply(this, [options, channelName, this.test.helper]);
        };
      }

      itFn(testName + ' with binary protocol', createTest({ useBinaryProtocol: true }, `${testName} binary`));
      itFn(testName + ' with text protocol', createTest({ useBinaryProtocol: false }, `${testName} text`));
    }

    /**
     * Asserts that an object is an instance of the given class name.
     * Accounts for esbuild renaming classes with static methods (e.g. LiveMap → _LiveMap).
     */
    static expectInstanceOf(object, className, msg) {
      expect(object.constructor.name).to.match(new RegExp(`_?${className}`), msg);
    }

    /**
     * Asserts that an async function throws an error with the given message substring and optional error code/statusCode.
     */
    static async expectToThrowAsync(fn, errorStr, conditions) {
      const { withCode, withStatusCode } = conditions ?? {};

      let savedError;
      try {
        await fn();
      } catch (error) {
        expect(error.message).to.have.string(errorStr);
        if (withCode != null) expect(error.code).to.equal(withCode);
        if (withStatusCode != null) expect(error.statusCode).to.equal(withStatusCode);
        savedError = error;
      }
      expect(savedError, 'Expected async function to throw an error').to.exist;

      return savedError;
    }

    clearTransportPreference() {
      if (isBrowser && window.localStorage) {
        window.localStorage.removeItem('ably-transport-preference');
      }
    }

    isComet(transport) {
      return transport.toString().indexOf('/comet/') > -1;
    }

    isWebsocket(transport) {
      return !!transport.toString().match(/wss?\:/);
    }

    static randomString() {
      return Math.random().toString().slice(2);
    }

    testMessageEquality(one, two) {
      const helper = this.addingHelperFunction('testMessageEquality');
      return helper._testMessageEquality(one, two);
    }

    _testMessageEquality(one, two) {
      // treat `null` same as `undefined` (using ==, rather than ===)
      expect(one.encoding == two.encoding, "Encoding mismatch ('" + one.encoding + "' != '" + two.encoding + "').").to
        .be.ok;

      if (typeof one.data === 'string' && typeof two.data === 'string') {
        expect(one.data === two.data, 'String data contents mismatch.').to.be.ok;
        return;
      }

      this.recordPrivateApi('call.BufferUtils.isBuffer');
      if (BufferUtils.isBuffer(one.data) && BufferUtils.isBuffer(two.data)) {
        this.recordPrivateApi('call.BufferUtils.areBuffersEqual');
        expect(BufferUtils.areBuffersEqual(one.data, two.data), 'Buffer data contents mismatch.').to.equal(true);
        return;
      }

      var json1 = JSON.stringify(one.data);
      var json2 = JSON.stringify(two.data);
      if (null === json1 || undefined === json1 || null === json2 || undefined === json2) {
        expect(false, 'JSON stringify failed.').to.be.ok;
        return;
      }
      expect(json1 === json2, 'JSON data contents mismatch.').to.be.ok;
    }

    ablyClientOptions(options) {
      return clientModule.ablyClientOptions(this, options);
    }

    AblyRest(options) {
      return clientModule.AblyRest(this, options);
    }

    AblyRestEcho(options) {
      return clientModule.AblyRestEcho(this, options);
    }

    static activeClients = [];

    AblyRealtime(options) {
      const client = clientModule.AblyRealtime(this, options);
      SharedHelper.activeClients.push(client);
      return client;
    }

    AblyRealtimeWithoutEndpoint(options) {
      const client = clientModule.AblyRealtimeWithoutEndpoint(this, options);
      SharedHelper.activeClients.push(client);
      return client;
    }

    /* Slightly crude catch-all hook to close any dangling realtime clients left open
     * after a test fails without calling closeAndFinish */
    closeActiveClients() {
      SharedHelper.activeClients.forEach((client) => {
        client.close();
      });
      SharedHelper.activeClients = [];
    }

    logTestResults(afterEachThis) {
      if (afterEachThis.currentTest.isFailed()) {
        const logs = globals.getLogs();
        if (logs.length > 0) {
          // empty console.logs are for vertical spacing
          console.log();
          console.log('Logs for failing test: \n');
          logs.forEach(([timestamp, log]) => {
            console.log(timestamp, log);
          });
          console.log();
        }
      }
    }

    createStats(app, statsData, callback) {
      testAppModule.createStatsFixtureData(this, app, statsData, callback);
    }

    setupApp(forceSetup, done) {
      return testAppModule.setup(this, forceSetup, done);
    }

    tearDownApp(app, callback) {
      testAppModule.tearDown(this, app, callback);
    }

    dumpPrivateApiUsage() {
      privateApiRecorder.dump();
    }

    async waitFor(condition, remaining) {
      const success = await condition();
      if (success || remaining <= 0) {
        return success;
      }
      await this.setTimeoutAsync(100);
      return this.waitFor(condition, remaining - 100);
    }

    async setTimeoutAsync(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    }

    async monitorConnectionThenCloseAndFinishAsync(action, realtime, states) {
      try {
        await this.monitorConnectionAsync(action, realtime, states);
      } finally {
        await this.closeAndFinishAsync(realtime);
      }
    }
  }

  SharedHelper.testOnAllTransportsAndProtocols.skip = function (thisInDescribe, testName, testFn) {
    SharedHelper.testOnAllTransportsAndProtocols(thisInDescribe, testName, testFn, true);
  };

  SharedHelper.testOnAllTransportsAndProtocols.only = function (thisInDescribe, testName, testFn) {
    SharedHelper.testOnAllTransportsAndProtocols(thisInDescribe, testName, testFn, false, true);
  };

  SharedHelper.testOnJsonMsgpack.skip = function (testName, testFn) {
    SharedHelper.testOnJsonMsgpack(testName, testFn, true);
  };

  SharedHelper.testOnJsonMsgpack.only = function (testName, testFn) {
    SharedHelper.testOnJsonMsgpack(testName, testFn, false, true);
  };

  return (module.exports = SharedHelper);
});
