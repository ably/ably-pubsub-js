import { IPlatformConfig } from '../../common/types/IPlatformConfig';
import * as Utils from 'common/lib/util/utils';
import { DeviceFormFactor, DevicePlatform } from 'common/lib/types/devicedetails';
import webstorage from './lib/util/webstorage';

// Workaround for salesforce lightning locker compat
const globalObject = Utils.getGlobalObject();

// @ts-ignore
const isVercelEdgeRuntime = typeof EdgeRuntime === 'string';

// We get false positive result here in the Vercel Edge runtime because it lacks the usual global browser objects, such as Window.
// However, it is closer to the browser environment, so it intentionally uses browser bundles when importing packages.
// Therefore, we do an additional check to avoid logging this incorrect warning for Vercel Edge runtime.
if (typeof Window === 'undefined' && typeof WorkerGlobalScope === 'undefined' && !isVercelEdgeRuntime) {
  console.log(
    "Warning: this distribution of Ably is intended for browsers. On nodejs, please use the '@ably/pubsub-server' package on npm",
  );
}

function allowComet() {
  /* xhr requests from local files are unreliable in some browsers, such as Chrome 65 and higher -- see eg
   * https://stackoverflow.com/questions/49256429/chrome-65-unable-to-make-post-requests-from-local-files-to-flask
   * So if websockets are supported, then just forget about comet transports and use that */
  const loc = globalObject.location;
  return !globalObject.WebSocket || !loc || !loc.origin || loc.origin.indexOf('http') > -1;
}

// from: https://stackoverflow.com/a/18002694
export function isWebWorkerContext(): boolean {
  // run this in global scope of window or worker. since window.self = window, we're ok
  if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
    return true;
  } else {
    return false;
  }
}

const userAgent = globalObject.navigator && globalObject.navigator.userAgent.toString();
const currentUrl = globalObject.location && globalObject.location.href;

const Config: IPlatformConfig = {
  agent: 'browser',
  logTimestamps: true,
  userAgent: userAgent,
  currentUrl: currentUrl,
  binaryType: 'arraybuffer',
  WebSocket: globalObject.WebSocket,
  fetchSupported: !!globalObject.fetch,
  xhrSupported: globalObject.XMLHttpRequest && 'withCredentials' in new XMLHttpRequest(),
  allowComet: allowComet(),
  useProtocolHeartbeats: true,
  supportsBinary: !!globalObject.TextDecoder,
  /* Per Paddy (https://ably-real-time.slack.com/archives/CURL4U2FP/p1705674537763479) web intentionally prefers JSON to MessagePack:
   *
   * > browsers' support for binary types in general was historically poor, and JSON transport performance is significantly better in a browser than msgpack. In modern browsers then binary is supported consistently, but I'd still expect that JSON encode/decode performance is dramatically better than msgpack in a browser.
   */
  preferBinary: false,
  ArrayBuffer: globalObject.ArrayBuffer,
  atob: globalObject.atob,
  nextTick:
    typeof globalObject.queueMicrotask === 'function'
      ? (f: () => void) => globalObject.queueMicrotask(f)
      : (f: () => void) => Promise.resolve().then(f),
  setTimeout: globalObject.setTimeout.bind(globalObject),
  clearTimeout: globalObject.clearTimeout.bind(globalObject),
  now: Date.now,
  addEventListener: globalObject.addEventListener,
  inspect: JSON.stringify,
  stringByteSize: function (str: string) {
    /* str.length will be an underestimate for non-ascii strings. But if we're
     * in a browser too old to support TextDecoder, not much we can do. Better
     * to underestimate, so if we do go over-size, the server will reject the
     * message */
    return (globalObject.TextDecoder && new globalObject.TextEncoder().encode(str).length) || str.length;
  },
  TextEncoder: globalObject.TextEncoder,
  TextDecoder: globalObject.TextDecoder,
  getRandomArrayBuffer: async function (byteLength: number): Promise<ArrayBuffer> {
    const byteArray = new Uint8Array(byteLength);
    globalObject.crypto.getRandomValues(byteArray);
    return byteArray.buffer;
  },
  isWebworker: isWebWorkerContext(),
  push: {
    platform: DevicePlatform.Browser,
    formFactor: DeviceFormFactor.Desktop,
    storage: webstorage,
  },
};

export default Config;
