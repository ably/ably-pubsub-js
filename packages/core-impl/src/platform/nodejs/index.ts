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
import BufferUtils from './lib/util/bufferutils';
// @ts-ignore
import { createCryptoClass } from './lib/util/crypto';
import Http from './lib/util/http';
import Config from './config';
// @ts-ignore
import Transports from './lib/transport';
import Logger from '../../common/lib/util/logger';
import { getDefaults } from '../../common/lib/util/defaults';
import PlatformDefaults from './lib/util/defaults';
// Every Node.js build bundles MessagePack, the platform's default protocol, including those of
// `@ably/pubsub-device`, whose web and React Native builds leave it to a plugin.
import msgpack = require('@ably/msgpack-js');

const Crypto = createCryptoClass(BufferUtils);

Platform.Crypto = Crypto;
Platform.BufferUtils = BufferUtils as typeof Platform.BufferUtils;
Platform.Http = Http;
Platform.Config = Config;
Platform.Transports = Transports;
Platform.WebStorage = null;

for (const clientClass of [DefaultPubSubHttpClient, DefaultPubSubRealtimeClient]) {
  clientClass.Crypto = Crypto;
  clientClass._MsgPack = msgpack;
}

Logger.initLogHandlers();

Platform.Defaults = getDefaults(PlatformDefaults);

if (Platform.Config.agent) {
  // @ts-ignore
  Platform.Defaults.agent += ' ' + Platform.Config.agent;
}

// Unlike the web entry point, this one has never exposed its msgpack implementation, which the
// clients carry as `_MsgPack` instead.
const exportedMsgpack = null;

export {
  ErrorInfo,
  Crypto,
  Message,
  PresenceMessage,
  Annotation,
  DefaultPubSubHttpClient,
  DefaultPubSubRealtimeClient,
  exportedMsgpack as msgpack,
  makeProtocolMessageFromDeserialized,
};

export default {
  ErrorInfo,
  Crypto,
  Message,
  PresenceMessage,
  Annotation,
  DefaultPubSubHttpClient,
  DefaultPubSubRealtimeClient,
  msgpack: exportedMsgpack,
  makeProtocolMessageFromDeserialized,
  Logger,
};
