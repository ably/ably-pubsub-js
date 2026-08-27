import { IPlatformConfig } from '../../common/types/IPlatformConfig';
import crypto from 'crypto';
import WebSocket from 'ws';
import util from 'util';

const Config: IPlatformConfig = {
  agent: 'nodejs/' + process.versions.node,
  logTimestamps: true,
  userAgent: null,
  binaryType: 'nodebuffer' as BinaryType,
  WebSocket,
  useProtocolHeartbeats: false,
  supportsBinary: true,
  preferBinary: true,
  nextTick: process.nextTick,
  setTimeout: globalThis.setTimeout,
  clearTimeout: globalThis.clearTimeout,
  now: Date.now,
  inspect: util.inspect,
  stringByteSize: Buffer.byteLength,
  inherits: util.inherits,
  addEventListener: null,
  getRandomArrayBuffer: async function (byteLength: number): Promise<Buffer> {
    return util.promisify(crypto.randomBytes)(byteLength);
  },
};

export default Config;
