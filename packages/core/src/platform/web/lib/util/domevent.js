var DomEvent = (function () {
  function DomEvent() {}

  DomEvent.addListener = function (target, event, listener) {
    if (target.addEventListener) {
      target.addEventListener(event, listener, false);
    } else {
      target.attachEvent('on' + event, function () {
        listener.apply(target, arguments);
      });
    }
  };

  DomEvent.removeListener = function (target, event, listener) {
    if (target.removeEventListener) {
      target.removeEventListener(event, listener, false);
    } else {
      target.detachEvent('on' + event, function () {
        listener.apply(target, arguments);
      });
    }
  };

  DomEvent.addMessageListener = function (target, listener) {
    DomEvent.addListener(target, 'message', listener);
  };

  DomEvent.removeMessageListener = function (target, listener) {
    DomEvent.removeListener(target, 'message', listener);
  };

  DomEvent.addUnloadListener = function (listener) {
    DomEvent.addListener(global, 'unload', listener);
  };

  return DomEvent;
})();

export default DomEvent;
