// Common
import { DefaultPubSubHttpClient } from '../../common/lib/client/defaultpubsubhttpclient';
import { DefaultPubSubRealtimeClient } from '../../common/lib/client/defaultpubsubrealtimeclient';
import Platform from '../../common/platform';
import ErrorInfo from '../../common/lib/types/errorinfo';
import { DefaultMessage as Message } from '../../common/lib/types/defaultmessage';
import { DefaultPresenceMessage as PresenceMessage } from '../../common/lib/types/defaultpresencemessage';
import { DefaultAnnotation as Annotation } from '../../common/lib/types/defaultannotation';
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

for (const clientClass of [DefaultPubSubHttpClient, DefaultPubSubRealtimeClient]) {
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
  Crypto,
  Message,
  PresenceMessage,
  Annotation,
  DefaultPubSubHttpClient,
  DefaultPubSubRealtimeClient,
  msgpack,
  makeProtocolMessageFromDeserialized,
  Logger,
};
