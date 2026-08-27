// Common
import { BaseRest } from '../../common/lib/client/baserest';
import BaseRealtime from '../../common/lib/client/baserealtime';
import Platform from '../../common/platform';
import ErrorInfo from '../../common/lib/types/errorinfo';

// Platform Specific
import BufferUtils from './lib/util/bufferutils';
// @ts-ignore
import Http from './lib/http/http';
import Config from './config';
// @ts-ignore
import { ModularTransports } from './lib/transport';
import Logger from '../../common/lib/util/logger';
import { getDefaults } from '../../common/lib/util/defaults';
import WebStorage from './lib/util/webstorage';
import PlatformDefaults from './lib/util/defaults';
import { modularBundledRequestImplementations } from './lib/http/request';

Platform.BufferUtils = BufferUtils;
Platform.Http = Http;
Platform.Config = Config;
Platform.Transports = ModularTransports;
Platform.WebStorage = WebStorage;

Http.bundledRequestImplementations = modularBundledRequestImplementations;

Logger.initLogHandlers();

Platform.Defaults = getDefaults(PlatformDefaults);

if (Platform.Config.agent) {
  // @ts-ignore
  Platform.Defaults.agent += ' ' + Platform.Config.agent;
}

export * from './modular/crypto';
export * from './modular/message';
export * from './modular/presencemessage';
export * from './modular/msgpack';
export * from './modular/realtimepresence';
export * from './modular/annotations';
export * from './modular/transports';
export * from './modular/http';
export { Rest } from '../../common/lib/client/rest';
export { FilteredSubscriptions as MessageInteractions } from '../../common/lib/client/filteredsubscriptions';
export { BaseRest, BaseRealtime, ErrorInfo };
