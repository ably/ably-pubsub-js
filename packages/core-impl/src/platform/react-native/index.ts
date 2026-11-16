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
import configFactory from './config';
// @ts-ignore
import Transports from '../web/lib/transport';
import Logger from '../../common/lib/util/logger';
import { getDefaults } from '../../common/lib/util/defaults';
import WebStorage from '../web/lib/util/webstorage';
import PlatformDefaults from '../web/lib/util/defaults';
// The platform's MessagePack codec, or `null` in the web and React Native bundles of
// `@ably/pubsub-device`, which are built with the `ably-exclude-msgpack` export condition and leave
// MessagePack to a plugin.
import msgpack from '@ably/pubsub-core-impl/bundled-msgpack';
import { defaultBundledRequestImplementations } from '../web/lib/http/request';

// lightweight polyfill for TextEncoder/TextDecoder
import 'fastestsmallesttextencoderdecoder';

const Config = configFactory(BufferUtils);

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
