'use strict';
/* global define, isNativescript, fetch */

/* testapp module is responsible for setting up and tearing down apps in the test environment */
define(['globals', 'ably'], function (ablyGlobals, ably) {
  const Defaults = ably.Realtime.Platform.Defaults;
  var restHost = Defaults.getPrimaryDomainFromEndpoint(ablyGlobals.endpoint),
    port = ablyGlobals.tls ? ablyGlobals.tlsPort : ablyGlobals.port,
    scheme = ablyGlobals.tls ? 'https' : 'http';

  var isBrowser = typeof window === 'object',
    isNativescript = typeof global === 'object' && global.isNativescript,
    httpReq = httpReqFunction(),
    loadJsonData = loadJsonDataNode,
    testResourcesPath = 'test/common/ably-common/test-resources/';

  if (isNativescript) {
    loadJsonData = loadJsonNativescript;
    testResourcesPath = '~/tns_modules/ably/' + testResourcesPath;
  } else if (isBrowser) {
    loadJsonData = loadJsonDataBrowser;
    if (window.__karma__ && window.__karma__.start) {
      testResourcesPath = 'base/' + testResourcesPath;
    }
  }

  function getHostname(endpoint) {
    if (endpoint.startsWith('nonprod:')) {
      return `${endpoint.replace('nonprod:', '')}.realtime.ably-nonprod.net`;
    }

    return `${endpoint}.realtime.ably.net`;
  }

  /* When the compatibility harness is provisioning against the local sandbox
   * (ABLY_LOCAL_SANDBOX_URL) rather than the cloud sandbox, point a request's
   * connection details there — only the host/port/scheme differ. */
  function applyLocalSandboxOptions(options) {
    var localSandboxUrl = new URL(ablyGlobals.localSandboxURL);
    options.host = localSandboxUrl.hostname;
    options.port = Number(localSandboxUrl.port);
    options.scheme = localSandboxUrl.protocol.replace(':', '');
  }

  function toBase64(helper, str) {
    helper = helper.addingHelperFunction('toBase64');
    var bufferUtils = ably.Realtime.Platform.BufferUtils;
    helper.recordPrivateApi('call.BufferUtils.utf8Encode');
    var buffer = bufferUtils.utf8Encode(str);
    helper.recordPrivateApi('call.BufferUtils.base64Encode');
    return bufferUtils.base64Encode(buffer);
  }

  function httpReqFunction() {
    if (isNativescript) {
      return function (options, callback) {
        var http = require('http');
        var uri = options.scheme + '://' + options.host + ':' + options.port + options.path;

        http
          .request({
            url: uri,
            method: options.method || 'GET',
            timeout: 10000,
            headers: options.headers,
            content: options.body,
          })
          .then(function (results) {
            callback(null, results.content.toString());
          })
          ['catch'](function (err) {
            callback(err);
          });
      };
    } else if (isBrowser) {
      return function (options, callback) {
        var xhr = new XMLHttpRequest();
        var uri;

        uri = options.scheme + '://' + options.host + ':' + options.port + options.path;

        xhr.open(options.method, uri);
        if (options.headers && !xhr.isXDR) {
          for (var h in options.headers) if (h !== 'Content-Length') xhr.setRequestHeader(h, options.headers[h]);
        }
        xhr.onerror = function (err) {
          callback(err);
        };
        if ('onreadystatechange' in xhr) {
          /* XHR */
          xhr.onreadystatechange = function () {
            if (xhr.readyState == 4) {
              if (xhr.status >= 300) {
                callback('HTTP request failed ' + xhr.status);
                return;
              }
              callback(null, xhr.responseText);
            }
          };
        } else {
          /* XDR */
          xhr.onload = function () {
            if (xhr.status >= 300) {
              callback('HTTP request failed ' + xhr.status);
              return;
            }
            callback(null, xhr.responseText);
          };
        }
        xhr.send(options.body);
      };
    } else {
      var http = require('http'),
        https = require('https');

      return function (options, callback) {
        var body = options.body;
        delete options.body;
        var response = '';
        var request = (options.scheme == 'http' ? http : https).request(options, function (res) {
          res.setEncoding('utf8');
          res.on('data', function (chunk) {
            response += chunk;
          });
          res.on('end', function () {
            if (res.statusCode >= 300) {
              callback('Invalid HTTP request: ' + response + '; statusCode = ' + res.statusCode);
            } else {
              callback(null, response);
            }
          });
        });
        request.on('error', function (err) {
          callback(err);
        });
        request.end(body);
      };
    }
  }

  function createNewApp(callback) {
    loadJsonData(testResourcesPath + 'test-app-setup.json', function (err, testData) {
      if (err) {
        callback(err);
        return;
      }
      var postData = JSON.stringify(testData.post_apps);
      var postOptions = {
        host: restHost,
        port,
        path: '/apps',
        method: 'POST',
        scheme,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'Content-Length': postData.length },
        body: postData,
      };
      if (ablyGlobals.localSandboxURL) applyLocalSandboxOptions(postOptions);

      httpReq(postOptions, function (err, res) {
        if (err) {
          callback(err);
        } else {
          if (typeof res === 'string') res = JSON.parse(res);
          if (res.keys.length != testData.post_apps.keys.length) {
            callback('Failed to create correct number of keys for app');
          } else if (res.namespaces.length != testData.post_apps.namespaces.length) {
            callback('Failed to create correct number of namespaces for app');
          } else {
            var testApp = {
              accountId: res.accountId,
              appId: res.appId,
              keys: res.keys,
              cipherConfig: testData.cipher,
            };
            if (ablyGlobals.localSandboxURL) {
              /* The local sandbox boots an isolated server for this app and tells
               * us how to reach it. Record it so client_module routes every client
               * at that server, and so teardown targets the right provisioner. */
              testApp.local = true;
              testApp.endpoint = res.endpoint;
              testApp.port = res.port;
              testApp.tls = res.tls;
            }
            callback(null, testApp);
          }
        }
      });
    });
  }

  function createStatsFixtureData(helper, app, statsData, callback) {
    helper = helper.addingHelperFunction('createStatsFixtureData');
    var postData = JSON.stringify(statsData);

    var authKey = app.keys[0].keyStr;
    var authHeader = toBase64(helper, authKey);

    var postOptions = {
      host: restHost,
      port,
      path: '/stats',
      method: 'POST',
      scheme,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'Content-Length': postData.length,
        Authorization: 'Basic ' + authHeader,
      },
      body: postData,
      paramsIfNoHeaders: { key: authKey },
    };
    if (app.local) applyLocalSandboxOptions(postOptions);

    httpReq(postOptions, function (err) {
      if (err) {
        callback(err);
      } else {
        callback(null);
      }
    });
  }

  function deleteApp(helper, app, callback) {
    helper = helper.addingHelperFunction('deleteApp');
    var authKey = app.keys[0].keyStr,
      authHeader = toBase64(helper, authKey);

    var delOptions = {
      host: restHost,
      port,
      method: 'DELETE',
      path: '/apps/' + app.appId,
      scheme,
      headers: { Authorization: 'Basic ' + authHeader },
    };
    if (app.local) applyLocalSandboxOptions(delOptions);

    httpReq(delOptions, function (err) {
      callback(err);
    });
  }

  function loadJsonNativescript(datapath, callback) {
    var d = require(datapath);
    callback(null, d);
  }

  function loadJsonDataBrowser(dataPath, callback) {
    var getOptions = {
      host: window.location.hostname,
      port: window.location.port,
      path: '/' + dataPath,
      method: 'GET',
      scheme: window.location.protocol.slice(0, -1),
      headers: { 'Content-Type': 'application/json' },
    };

    httpReq(getOptions, function (err, data) {
      if (err) {
        callback(err);
        return;
      }
      try {
        data = JSON.parse(data);
      } catch (e) {
        callback(e);
        return;
      }
      callback(null, data);
    });
  }

  function loadJsonDataNode(dataPath, callback) {
    var fs = require('fs'),
      path = require('path'),
      resolvedPath = path.resolve(__dirname, '../../..', dataPath);

    fs.readFile(resolvedPath, function (err, data) {
      if (err) {
        callback(err);
        return;
      }
      try {
        data = JSON.parse(data);
      } catch (e) {
        callback(e);
        return;
      }
      callback(null, data);
    });
  }

  return (module.exports = {
    setup: createNewApp,
    tearDown: deleteApp,
    createStatsFixtureData: createStatsFixtureData,
    httpReq: httpReq,
    loadJsonData: loadJsonData,
    testResourcesPath: testResourcesPath,
  });
});
