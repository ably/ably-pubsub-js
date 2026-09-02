import Platform from 'common/platform';
import * as Utils from './utils';
import Logger from './logger';
import ErrorInfo from 'common/lib/types/errorinfo';
import { version } from '../../../../package.json';
import ClientOptions, { NormalisedClientOptions } from 'common/types/ClientOptions';
import IDefaults from '../../types/IDefaults';
import { MsgPack } from 'common/types/msgpack';
import { IUntypedCryptoStatic } from 'common/types/ICryptoStatic';
import { ChannelOptions } from 'common/types/channel';
import { ModularPlugins } from '../client/modularplugins';

let agent = 'ably-js/' + version;

type CompleteDefaults = IDefaults & {
  ENDPOINT: string;
  ENVIRONMENT: string;
  REST_HOST: string;
  REALTIME_HOST: string;
  FALLBACK_HOSTS: string[];
  PORT: number;
  TLS_PORT: number;
  TIMEOUTS: {
    disconnectedRetryTimeout: number;
    suspendedRetryTimeout: number;
    httpRequestTimeout: number;
    httpMaxRetryDuration: number;
    channelRetryTimeout: number;
    fallbackRetryTimeout: number;
    connectionStateTtl: number;
    realtimeRequestTimeout: number;
    recvTimeout: number;
    webSocketConnectTimeout: number;
    webSocketSlowTimeout: number;
  };
  httpMaxRetryCount: number;
  maxMessageSize: number;
  version: string;
  protocolVersion: number;
  agent: string;
  getPort(options: ClientOptions, tls?: boolean): number | undefined;
  getHttpScheme(options: ClientOptions): string;
  getPrimaryDomainFromEndpoint(endpoint: string): string;
  getEndpointFallbackHosts(endpoint: string): string[];
  getFallbackHosts(options: NormalisedClientOptions): string[];
  getHosts(options: NormalisedClientOptions, ws?: boolean): string[];
  checkHost(host: string): void;
  objectifyOptions(
    options: undefined | ClientOptions | string,
    allowKeyOrToken: boolean,
    sourceForErrorMessage: string,
    logger: Logger,
    modularPluginsToInclude?: ModularPlugins,
  ): ClientOptions;
  normaliseOptions(options: ClientOptions, MsgPack: MsgPack | null, logger: Logger | null): NormalisedClientOptions;
  defaultGetHeaders(options: NormalisedClientOptions, headersOptions?: HeadersOptions): Record<string, string>;
  defaultPostHeaders(options: NormalisedClientOptions, headersOptions?: HeadersOptions): Record<string, string>;
};

const Defaults = {
  ENDPOINT: 'main',
  ENVIRONMENT: '',
  REST_HOST: 'rest.ably.io',
  REALTIME_HOST: 'realtime.ably.io',
  FALLBACK_HOSTS: [
    'main.a.fallback.ably-realtime.com',
    'main.b.fallback.ably-realtime.com',
    'main.c.fallback.ably-realtime.com',
    'main.d.fallback.ably-realtime.com',
    'main.e.fallback.ably-realtime.com',
  ],
  PORT: 80,
  TLS_PORT: 443,
  TIMEOUTS: {
    /* Documented as options params: */
    disconnectedRetryTimeout: 15000,
    suspendedRetryTimeout: 30000,
    /* Undocumented, but part of the api and can be used by customers: */
    httpRequestTimeout: 10000,
    httpMaxRetryDuration: 15000,
    channelRetryTimeout: 15000,
    fallbackRetryTimeout: 600000,
    /* For internal / test use only: */
    connectionStateTtl: 120000,
    realtimeRequestTimeout: 10000,
    recvTimeout: 90000,
    webSocketConnectTimeout: 10000,
    webSocketSlowTimeout: 4000,
  },
  httpMaxRetryCount: 3,
  maxMessageSize: 65536,

  version,
  protocolVersion: 6,
  agent,
  getPort,
  getHttpScheme,
  getPrimaryDomainFromEndpoint,
  getEndpointFallbackHosts,
  getFallbackHosts,
  getHosts,
  checkHost,
  objectifyOptions,
  normaliseOptions,
  defaultGetHeaders,
  defaultPostHeaders,
};

export function getPort(options: ClientOptions, tls?: boolean): number | undefined {
  return tls || options.tls ? options.tlsPort : options.port;
}

export function getHttpScheme(options: ClientOptions): string {
  return options.tls ? 'https://' : 'http://';
}

/**
 * REC1b2
 */
function isFqdnIpOrLocalhost(endpoint: string): boolean {
  return endpoint.includes('.') || endpoint.includes('::') || endpoint === 'localhost';
}

/**
 * REC1b
 */
export function getPrimaryDomainFromEndpoint(endpoint: string): string {
  // REC1b2 (endpoint is a valid hostname)
  if (isFqdnIpOrLocalhost(endpoint)) return endpoint;

  // REC1b3 (endpoint in form "nonprod:[id]")
  if (endpoint.startsWith('nonprod:')) {
    const routingPolicyId = endpoint.replace('nonprod:', '');
    return `${routingPolicyId}.realtime.ably-nonprod.net`;
  }

  // REC1b4 (endpoint in form "[id]")
  return `${endpoint}.realtime.ably.net`;
}

/**
 * REC2c
 *
 * @returns default callbacks based on endpoint client option
 */
export function getEndpointFallbackHosts(endpoint: string): string[] {
  // REC2c2
  if (isFqdnIpOrLocalhost(endpoint)) return [];

  // REC2c3
  if (endpoint.startsWith('nonprod:')) {
    const routingPolicyId = endpoint.replace('nonprod:', '');
    return endpointFallbacks(routingPolicyId, 'ably-realtime-nonprod.com');
  }

  // REC2c1
  return endpointFallbacks(endpoint, 'ably-realtime.com');
}

export function endpointFallbacks(routingPolicyId: string, domain: string): string[] {
  return ['a', 'b', 'c', 'd', 'e'].map((id) => `${routingPolicyId}.${id}.fallback.${domain}`);
}

export function getFallbackHosts(options: NormalisedClientOptions): string[] {
  const fallbackHosts = options.fallbackHosts,
    httpMaxRetryCount =
      typeof options.httpMaxRetryCount !== 'undefined' ? options.httpMaxRetryCount : Defaults.httpMaxRetryCount;

  return fallbackHosts ? Utils.arrChooseN(fallbackHosts, httpMaxRetryCount) : [];
}

export function getHosts(options: NormalisedClientOptions): string[] {
  return [options.primaryDomain].concat(getFallbackHosts(options));
}

function checkHost(host: string): void {
  if (typeof host !== 'string') {
    throw new ErrorInfo({
      message: 'host must be a string: was of type ' + typeof host,
      code: 40000,
      statusCode: 400,
      remediation:
        'Make every entry of `fallbackHosts` a string. If you set `restHost` or `realtimeHost`, pass each as a single string, not an array or object.',
    });
  }
  if (!host.length) {
    throw new ErrorInfo({
      message: 'host must not be zero-length: an entry of `fallbackHosts` is an empty string',
      code: 40000,
      statusCode: 400,
      remediation: 'Remove any empty-string entry from the `fallbackHosts` array.',
    });
  }
}

function getTimeouts(options: ClientOptions) {
  /* Allow values passed in options to override default timeouts */
  const timeouts: Record<string, number> = {};
  for (const prop in Defaults.TIMEOUTS) {
    timeouts[prop] = (options as Record<string, number>)[prop] || (Defaults.TIMEOUTS as Record<string, number>)[prop];
  }
  return timeouts;
}

export function getAgentString(options: ClientOptions): string {
  let agentStr = Defaults.agent;
  if (options.agents) {
    for (var agent in options.agents) {
      const version = options.agents[agent];
      // An entry with no version is emitted bare, like the platform's own `browser` entry:
      // versionless identifiers are flags (for example the per-side Pub/Sub packages' side
      // declarations), and `name/undefined` is not a valid Ably-Agent token.
      agentStr += ' ' + agent + (version ? '/' + version : '');
    }
  }
  return agentStr;
}

export function objectifyOptions(
  options: undefined | ClientOptions | string,
  allowKeyOrToken: boolean,
  sourceForErrorMessage: string,
  logger: Logger,
  modularPluginsToInclude?: ModularPlugins,
): ClientOptions {
  if (options === undefined) {
    const msg = allowKeyOrToken
      ? `${sourceForErrorMessage} must be initialized with either a client options object, an Ably API key, or an Ably Token`
      : `${sourceForErrorMessage} must be initialized with a client options object`;
    Logger.logAction(logger, Logger.LOG_ERROR, `${sourceForErrorMessage}()`, msg);
    throw new Error(msg);
  }

  let optionsObj: ClientOptions;

  if (typeof options === 'string') {
    if (options.indexOf(':') == -1) {
      if (!allowKeyOrToken) {
        const msg = `${sourceForErrorMessage} cannot be initialized with just an Ably Token; you must provide a client options object with a \`plugins\` property. (Set this Ably Token as the object’s \`token\` property.)`;
        Logger.logAction(logger, Logger.LOG_ERROR, `${sourceForErrorMessage}()`, msg);
        throw new Error(msg);
      }

      optionsObj = { token: options };
    } else {
      if (!allowKeyOrToken) {
        const msg = `${sourceForErrorMessage} cannot be initialized with just an Ably API key; you must provide a client options object with a \`plugins\` property. (Set this Ably API key as the object’s \`key\` property.)`;
        Logger.logAction(logger, Logger.LOG_ERROR, `${sourceForErrorMessage}()`, msg);
        throw new Error(msg);
      }

      optionsObj = { key: options };
    }
  } else {
    optionsObj = options;
  }

  if (modularPluginsToInclude) {
    optionsObj = { ...optionsObj, plugins: { ...modularPluginsToInclude, ...optionsObj.plugins } };
  }

  return optionsObj;
}

function checkIfClientOptionsAreValid(options: ClientOptions) {
  // REC1b
  if (options.endpoint && (options.environment || options.restHost || options.realtimeHost)) {
    // RSC1b
    throw new ErrorInfo({
      message:
        'The `endpoint` option cannot be used in conjunction with the `environment`, `restHost`, or `realtimeHost` options.',
      code: 40106,
      statusCode: 400,
      remediation:
        'Remove `environment`, `restHost`, and `realtimeHost` from `ClientOptions` and use only `endpoint`, which replaces them.',
    });
  }

  // REC1c
  if (options.environment && (options.restHost || options.realtimeHost)) {
    // RSC1b
    throw new ErrorInfo({
      message: 'The `environment` option cannot be used in conjunction with the `restHost`, or `realtimeHost` options.',
      code: 40106,
      statusCode: 400,
      remediation:
        'Remove `environment`, `restHost`, and `realtimeHost` from `ClientOptions` and use only `endpoint`, which replaces them.',
    });
  }
}

export function normaliseOptions(
  options: ClientOptions,
  MsgPack: MsgPack | null,
  logger: Logger | null, // should only be omitted by tests
): NormalisedClientOptions {
  const loggerToUse = logger ?? Logger.defaultLogger;

  // Deprecated options
  if (options.environment) {
    loggerToUse.deprecated('The `environment` client option', 'Use the `endpoint` client option instead.');
  }
  if (options.restHost) {
    loggerToUse.deprecated('The `restHost` client option', 'Use the `endpoint` client option instead.');
  }
  if (options.realtimeHost) {
    loggerToUse.deprecated('The `realtimeHost` client option', 'Use the `endpoint` client option instead.');
  }

  checkIfClientOptionsAreValid(options);

  if (typeof options.recover === 'function' && options.closeOnUnload === true) {
    Logger.logAction(
      loggerToUse,
      Logger.LOG_ERROR,
      'Defaults.normaliseOptions',
      'closeOnUnload was true and a session recovery function was set - these are mutually exclusive, so unsetting the latter',
    );
    options.recover = undefined;
  }

  if (!('closeOnUnload' in options)) {
    /* Have closeOnUnload default to true unless we have any indication that
     * the user may want to recover the connection */
    options.closeOnUnload = !options.recover;
  }

  if (!('queueMessages' in options)) options.queueMessages = true;

  /* infer hosts and fallbacks based on the specified endpoint */
  const endpoint = options.endpoint || Defaults.ENDPOINT;

  if (!options.fallbackHosts && !options.restHost && !options.realtimeHost && !options.port && !options.tlsPort) {
    options.fallbackHosts = getEndpointFallbackHosts(options.environment || endpoint);
  }

  const primaryDomainFromEnvironment = options.environment && `${options.environment}.realtime.ably.net`;
  const primaryDomainFromLegacyOptions = options.restHost || options.realtimeHost || primaryDomainFromEnvironment;

  const primaryDomain = primaryDomainFromLegacyOptions || getPrimaryDomainFromEndpoint(endpoint);

  (options.fallbackHosts || []).concat(primaryDomain).forEach(checkHost);

  options.port = options.port || Defaults.PORT;
  options.tlsPort = options.tlsPort || Defaults.TLS_PORT;
  if (!('tls' in options)) options.tls = true;

  const timeouts = getTimeouts(options);

  if (MsgPack) {
    if ('useBinaryProtocol' in options) {
      options.useBinaryProtocol = Platform.Config.supportsBinary && options.useBinaryProtocol;
    } else {
      options.useBinaryProtocol = Platform.Config.preferBinary;
    }
  } else {
    options.useBinaryProtocol = false;
  }

  const headers: Record<string, string> = {};
  if (options.clientId) {
    headers['X-Ably-ClientId'] = Platform.BufferUtils.base64Encode(Platform.BufferUtils.utf8Encode(options.clientId));
  }

  if (!('idempotentRestPublishing' in options)) {
    options.idempotentRestPublishing = true;
  }

  let connectivityCheckParams = null;
  let connectivityCheckUrl = options.connectivityCheckUrl;
  if (options.connectivityCheckUrl) {
    let [uri, qs] = options.connectivityCheckUrl.split('?');
    connectivityCheckParams = qs ? Utils.parseQueryString(qs) : {};
    if (uri.indexOf('://') === -1) {
      uri = 'https://' + uri;
    }
    connectivityCheckUrl = uri;
  }

  let wsConnectivityCheckUrl = options.wsConnectivityCheckUrl;
  if (wsConnectivityCheckUrl && wsConnectivityCheckUrl.indexOf('://') === -1) {
    wsConnectivityCheckUrl = 'wss://' + wsConnectivityCheckUrl;
  }

  return {
    ...options,
    primaryDomain: primaryDomain,
    maxMessageSize: options.maxMessageSize || Defaults.maxMessageSize,
    timeouts,
    connectivityCheckParams,
    connectivityCheckUrl,
    wsConnectivityCheckUrl,
    headers,
  };
}

export function normaliseChannelOptions(Crypto: IUntypedCryptoStatic | null, logger: Logger, options?: ChannelOptions) {
  const channelOptions = options || {};
  if (channelOptions.cipher) {
    if (!Crypto) Utils.throwMissingPluginError('Crypto');
    const cipher = Crypto.getCipher(channelOptions.cipher, logger);
    channelOptions.cipher = cipher.cipherParams;
    channelOptions.channelCipher = cipher.cipher;
  } else if ('cipher' in channelOptions) {
    /* Don't deactivate an existing cipher unless options
     * has a 'cipher' key that's falsey */
    channelOptions.cipher = undefined;
    channelOptions.channelCipher = null;
  }
  return channelOptions;
}

const contentTypes = {
  json: 'application/json',
  xml: 'application/xml',
  html: 'text/html',
  msgpack: 'application/x-msgpack',
  text: 'text/plain',
};

export interface HeadersOptions {
  format?: Utils.Format | 'xml' | 'html' | 'text';
  protocolVersion?: number;
}

const defaultHeadersOptions: Required<HeadersOptions> = {
  format: Utils.Format.json,
  protocolVersion: Defaults.protocolVersion,
};

export function defaultGetHeaders(
  options: NormalisedClientOptions,
  { format, protocolVersion = defaultHeadersOptions.protocolVersion }: HeadersOptions = {},
): Record<string, string> {
  const accept = contentTypes[format ?? (options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json)];
  return {
    accept: accept,
    'X-Ably-Version': protocolVersion.toString(),
    'Ably-Agent': getAgentString(options),
  };
}

export function defaultPostHeaders(
  options: NormalisedClientOptions,
  { format, protocolVersion = defaultHeadersOptions.protocolVersion }: HeadersOptions = {},
): Record<string, string> {
  const accept = contentTypes[format ?? (options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json)];
  const contentType = accept;
  return {
    accept: accept,
    'content-type': contentType,
    'X-Ably-Version': protocolVersion.toString(),
    'Ably-Agent': getAgentString(options),
  };
}

export default Defaults as CompleteDefaults;

export function getDefaults(platformDefaults: IDefaults) {
  return Object.assign(Defaults, platformDefaults);
}
