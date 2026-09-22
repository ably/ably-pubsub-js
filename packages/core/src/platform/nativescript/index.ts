// Common
import { DefaultRest } from '../../common/lib/client/defaultrest';
import { DefaultRealtime } from '../../common/lib/client/defaultrealtime';
import Platform from '../../common/platform';
import ErrorInfo from '../../common/lib/types/errorinfo';
import { makeFromDeserializedWithDependencies as makeProtocolMessageFromDeserialized } from '../../common/lib/types/protocolmessage';

// Platform Specific
import BufferUtils from '../web/lib/util/bufferutils';
// @ts-ignore
import { createCryptoClass } from '../web/lib/util/crypto';
import Http from '../web/lib/http/http';
// @ts-ignore
import Config from './config';
// @ts-ignore
import Transports from '../web/lib/transport';
import Logger from '../../common/lib/util/logger';
import { getDefaults } from '../../common/lib/util/defaults';
// @ts-ignore
import WebStorage from './lib/util/webstorage';
import PlatformDefaults from '../web/lib/util/defaults';
import msgpack from '../web/lib/util/msgpack';
import { defaultBundledRequestImplementations } from '../web/lib/http/request';

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

export default {
  ErrorInfo,
  Rest: DefaultRest,
  Realtime: DefaultRealtime,
  msgpack,
  makeProtocolMessageFromDeserialized,
};
