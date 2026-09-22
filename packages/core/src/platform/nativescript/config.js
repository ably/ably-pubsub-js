/* eslint-disable no-undef */
require('nativescript-websockets');

var randomBytes;
if (global.android) {
  randomBytes = function (size) {
    var sr = new java.security.SecureRandom();
    var buffer = Array.create('byte', size);
    sr.nextBytes(buffer);
    return android.util.Base64.encodeToString(buffer, android.util.Base64.DEFAULT);
  };
} else {
  randomBytes = function (size) {
    var bytes = NSMutableData.dataWithLength(size);
    SecRandomCopyBytes(kSecRandomDefault, size, bytes.mutableBytes());
    return bytes.base64EncodedStringWithOptions(0);
  };
}

var Config = {
  agent: 'nativescript',
  logTimestamps: true,
  binaryType: 'arraybuffer',
  WebSocket: WebSocket,
  xhrSupported: XMLHttpRequest,
  allowComet: true,
  useProtocolHeartbeats: true,
  supportsBinary: typeof TextDecoder !== 'undefined' && TextDecoder,
  preferBinary: false, // Motivation as on web; see `preferBinary` comment there.
  ArrayBuffer: ArrayBuffer,
  atob: null,
  nextTick: function (f) {
    setTimeout(f, 0);
  },
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  now: Date.now,
  addEventListener: null,
  inspect: JSON.stringify,
  stringByteSize: function (str) {
    /* str.length will be an underestimate for non-ascii strings. But if we're
     * in a browser too old to support TextDecoder, not much we can do. Better
     * to underestimate, so if we do go over-size, the server will reject the
     * message */
    return (typeof TextDecoder !== 'undefined' && new TextEncoder().encode(str).length) || str.length;
  },
  TextEncoder: global.TextEncoder,
  TextDecoder: global.TextDecoder,
  getRandomArrayBuffer: async function (byteLength) {
    var bytes = randomBytes(byteLength);
    return bytes;
  },
};

export default Config;
