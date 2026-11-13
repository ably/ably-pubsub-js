// The implementation's logger, for the per-side packages to log through in the format the clients
// use, and the hidden client option that tags a client's own lines.
//
// The implementation's platform entry points export the `Logger` class, but no public declaration
// describes it, so the cast that gives the packages typed access is confined to this module, as
// ./core-clients.ts confines the one for the client classes. The class is the one the platform
// entry point initializes, so a logger created here writes to the same default handlers as the
// clients do.

import platform from '@ably/pubsub-core-impl/platform';
import type { ClientOptions } from '@ably/pubsub-core/api';

/** A logger instance, configured with a level, a handler and an optional context. */
export interface LoggerInstance {
  setLog(level: number | undefined, handler?: ClientOptions['logHandler']): void;
  setContext(context: string | undefined): void;
}

interface LoggerClass {
  new (): LoggerInstance;
  readonly LOG_ERROR: number;
  readonly LOG_MAJOR: number;
  readonly LOG_MINOR: number;
  readonly LOG_MICRO: number;
  /** Writes `Ably: [context] action: message` to the logger's handler, if `level` is enabled. */
  logAction(logger: LoggerInstance, level: number, action: string, message?: string): void;
}

export const Logger = (platform as { Logger: LoggerClass }).Logger;

/** The client options that configure logging, which a package's own logger follows. */
export type LogOptions = Pick<ClientOptions, 'logLevel' | 'logHandler'>;

/**
 * Creates a logger with the level and handler of `options`, which default as a client's do, and
 * tags each line with `context` if one is given.
 */
export function createLogger(options: LogOptions, context?: string): LoggerInstance {
  const logger = new Logger();
  logger.setLog(options.logLevel, options.logHandler);
  logger.setContext(context);
  return logger;
}

/**
 * The logging options of a client options object, an API key or a token, as a factory accepts
 * them. A key or token configures none, so a logger created from it has the defaults.
 */
export function logOptionsOf(optionsOrKeyOrToken: ClientOptions | string): LogOptions {
  if (typeof optionsOrKeyOrToken !== 'object' || optionsOrKeyOrToken === null) {
    return {};
  }
  return { logLevel: optionsOrKeyOrToken.logLevel, logHandler: optionsOrKeyOrToken.logHandler };
}

/**
 * `ClientOptions.logContext` is honoured at runtime — the client passes it to
 * `Logger.setContext`, which tags each line it logs — but it is deliberately absent from the public
 * `ably.d.ts`, like `agents`, so it cannot be set through the types this package consumes. The
 * cast is confined to this module.
 */
type ClientOptionsWithLogContext = ClientOptions & {
  logContext?: string;
};

/**
 * Returns a shallow copy of `options` whose client tags each line it logs with `context`, leaving
 * the caller's options untouched. `undefined` and `null` pass through unchanged, as they do in
 * `optionsWithSideAgent` (./side.ts), so the client constructor reports them.
 *
 * @param options - Client options already in object form, as `optionsWithSideAgent` returns them.
 * @param context - The tag, such as `pool client 2`.
 */
export function optionsWithLogContext(options: ClientOptions, context: string): ClientOptions {
  if (options === undefined || options === null) {
    return options;
  }
  const tagged: ClientOptionsWithLogContext = { ...options, logContext: context };
  return tagged;
}
