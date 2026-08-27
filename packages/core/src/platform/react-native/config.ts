import { IPlatformConfig } from '../../common/types/IPlatformConfig';
import BufferUtils from '../web/lib/util/bufferutils';

type RNRandomBytes = {
  randomBytes: (byteLength: number, cb: (err: Error | null, base64String: string | null) => void) => void;
};

export default function (bufferUtils: typeof BufferUtils): IPlatformConfig {
  return {
    agent: 'reactnative',
    logTimestamps: true,
    binaryType: 'arraybuffer',
    WebSocket: WebSocket,
    xhrSupported: true,
    allowComet: true,
    useProtocolHeartbeats: true,
    supportsBinary: !!(typeof TextDecoder !== 'undefined' && TextDecoder),
    preferBinary: false, // Motivation as on web; see `preferBinary` comment there.
    ArrayBuffer: typeof ArrayBuffer !== 'undefined' && ArrayBuffer,
    atob: global.atob,
    nextTick:
      typeof global.queueMicrotask === 'function'
        ? (f: () => void) => global.queueMicrotask(f)
        : (f: () => void) => Promise.resolve().then(f),
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
    now: Date.now,
    addEventListener: null,
    inspect: JSON.stringify,
    stringByteSize: function (str: string) {
      /* str.length will be an underestimate for non-ascii strings. But if we're
       * in a browser too old to support TextDecoder, not much we can do. Better
       * to underestimate, so if we do go over-size, the server will reject the
       * message */
      return (typeof TextDecoder !== 'undefined' && new TextEncoder().encode(str).length) || str.length;
    },
    TextEncoder: global.TextEncoder,
    TextDecoder: global.TextDecoder,
    getRandomArrayBuffer: (function (RNRandomBytes: RNRandomBytes) {
      return async function (byteLength: number) {
        return new Promise((resolve, reject) => {
          RNRandomBytes.randomBytes(byteLength, (err, base64String) => {
            err ? reject(err) : resolve(bufferUtils.toArrayBuffer(bufferUtils.base64Decode(base64String!)));
          });
        });
      };
      // Installing @types/react-native would fix this but conflicts with @types/node
      // See https://github.com/DefinitelyTyped/DefinitelyTyped/issues/15960
      // eslint-disable-next-line @typescript-eslint/no-var-requires
    })(require('react-native').NativeModules.RNRandomBytes),
  };
}
