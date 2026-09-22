import appSettings from '@nativescript/core/application-settings';

var WebStorage = (function () {
  function WebStorage() {}

  function set(name, value, ttl) {
    var wrappedValue = { value: value };
    if (ttl) {
      wrappedValue.expires = Date.now() + ttl;
    }
    return appSettings.setString(name, JSON.stringify(wrappedValue));
  }

  function get(name) {
    var rawItem = appSettings.getString(name);
    if (!rawItem) return null;
    var wrappedValue = JSON.parse(rawItem);
    if (wrappedValue.expires && wrappedValue.expires < Date.now()) {
      appSettings.remove(name);
      return null;
    }
    return wrappedValue.value;
  }

  WebStorage.set = function (name, value, ttl) {
    return set(name, value, ttl);
  };
  WebStorage.get = function (name) {
    return get(name);
  };
  WebStorage.remove = function (name) {
    return appSettings.remove(name);
  };

  return WebStorage;
})();

export default WebStorage;
