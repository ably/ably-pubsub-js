// Common
import { DefaultRest } from '../../common/lib/client/defaultrest';
import { DefaultRealtime } from '../../common/lib/client/defaultrealtime';
import Platform from '../../common/platform';
import ErrorInfo from '../../common/lib/types/errorinfo';
import { makeFromDeserializedWithDependencies as makeProtocolMessageFromDeserialized } from '../../common/lib/types/protocolmessage';

// Platform Specific
import BufferUtils from './lib/util/bufferutils';
// @ts-ignore
import { createCryptoClass } from './lib/util/crypto';
import Http from './lib/http/http';
import Config from './config';
// @ts-ignore
import Transports from './lib/transport';
import Logger from '../../common/lib/util/logger';
import { getDefaults } from '../../common/lib/util/defaults';
import WebStorage from './lib/util/webstorage';
import PlatformDefaults from './lib/util/defaults';
import msgpack from './lib/util/msgpack';
import { defaultBundledRequestImplementations } from './lib/http/request';

const Crypto = createCryptoClass(Config, BufferUtils);

Platform.Crypto = Crypto;
Platform.BufferUtils = BufferUtils;
Platform.Http = Http;
Platform.Config = Config;
Platform.Transports = Transports;
Platform.WebStorage = WebStorage;

for (const clientClass of [DefaultRest, DefaultRealtime]) {
  clientClass.Crypto = Crypto;
  clientClass._MsgPack = msgpack;
}

Http.bundledRequestImplementations = defaultBundledRequestImplementations;

Logger.initLogHandlers();

Platform.Defaults = getDefaults(PlatformDefaults);

if (Platform.Config.agent) {
  // @ts-ignore
  Platform.Defaults.agent += ' ' + Platform.Config.agent;
}

export { DefaultRest as Rest, DefaultRealtime as Realtime, msgpack, makeProtocolMessageFromDeserialized, ErrorInfo };

export default {
  ErrorInfo,
  Rest: DefaultRest,
  Realtime: DefaultRealtime,
  msgpack,
  makeProtocolMessageFromDeserialized,
};
