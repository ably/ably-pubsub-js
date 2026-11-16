import Platform from 'common/platform';

export type LoggerOptions = {
  handler: LoggerFunction;
  level: LogLevels;
};
type LoggerFunction = (...args: string[]) => void;

// Workaround for salesforce lightning locker compatibility
// This is a shorthand version of Utils.getGlobalObject (which we can't use here without creating a circular import)
let globalObject = typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : self;

enum LogLevels {
  None = 0,
  Error = 1,
  Major = 2,
  Minor = 3,
  Micro = 4,
}

function pad(timeSegment: number, three?: number) {
  return `${timeSegment}`.padStart(three ? 3 : 2, '0');
}

function getHandler(logger: Function): Function {
  return Platform.Config.logTimestamps
    ? function (msg: unknown) {
        const time = new Date(Platform.Config.now());
        logger(
          pad(time.getHours()) +
            ':' +
            pad(time.getMinutes()) +
            ':' +
            pad(time.getSeconds()) +
            '.' +
            pad(time.getMilliseconds(), 1) +
            ' ' +
            msg,
        );
      }
    : function (msg: string) {
        logger(msg);
      };
}

const getDefaultLoggers = (): [Function, Function] => {
  let consoleLogger;
  let errorLogger;

  // we expect ably-js to be run in environments which have `console` object available with its `log` function
  if (typeof globalObject?.console?.log === 'function') {
    consoleLogger = function (...args: unknown[]) {
      console.log.apply(console, args);
    };

    errorLogger = console.warn
      ? function (...args: unknown[]) {
          console.warn.apply(console, args);
        }
      : consoleLogger;
  } else {
    // otherwise we should fallback to noop for log functions
    consoleLogger = errorLogger = function () {};
  }

  return [consoleLogger, errorLogger].map(getHandler) as [Function, Function];
};

class Logger {
  private static defaultLogLevel: LogLevels = LogLevels.Error;
  private static defaultLogHandler: Function;
  private static defaultLogErrorHandler: Function;

  private logLevel: LogLevels;
  private logHandler: Function;
  private logErrorHandler: Function;
  /** Inserted after the `Ably: ` prefix of every line, so that the lines of one client in a group of them can be told apart. Empty when there is no context. */
  private contextPrefix = '';

  // public constants
  static readonly LOG_NONE: LogLevels = LogLevels.None;
  static readonly LOG_ERROR: LogLevels = LogLevels.Error;
  static readonly LOG_MAJOR: LogLevels = LogLevels.Major;
  static readonly LOG_MINOR: LogLevels = LogLevels.Minor;
  static readonly LOG_MICRO: LogLevels = LogLevels.Micro;

  /**
   * Whether this build has had its `Logger.logAction(...)` calls below error level stripped. The `stripLogs` build transform sets it to `true`, so do not compute it or rename it.
   */
  static readonly logsStripped: boolean = false;

  /**
   * This logger instance should only be used when there is no more appropriate logger to use, for example when implementing a public static method or function whose API doesn’t accept any logging configuration.
   */
  static defaultLogger: Logger;

  static initLogHandlers() {
    const [logHandler, logErrorHandler] = getDefaultLoggers();
    this.defaultLogHandler = logHandler;
    this.defaultLogErrorHandler = logErrorHandler;
    this.defaultLogger = new Logger();
  }

  constructor() {
    this.logLevel = Logger.defaultLogLevel;
    this.logHandler = Logger.defaultLogHandler;
    this.logErrorHandler = Logger.defaultLogErrorHandler;
  }

  /* public static functions */
  /**
   * In the modular variant of the SDK, the `stripLogs` esbuild plugin strips out all calls to this method (when invoked as `Logger.logAction(...)`) except when called with level `Logger.LOG_ERROR`. If you wish for a log statement to never be stripped, use the {@link logActionNoStrip} method instead.
   *
   * The aforementioned plugin expects `level` to be an expression of the form `Logger.LOG_*`; that is, you can’t dynamically specify the log level.
   */
  static logAction = (logger: Logger, level: LogLevels, action: string, message?: string) => {
    this.logActionNoStrip(logger, level, action, message);
  };

  /**
   * Calls to this method are never stripped by the `stripLogs` esbuild plugin. Use it for log statements that you wish to always be included in the modular variant of the SDK.
   */
  static logActionNoStrip(logger: Logger, level: LogLevels, action: string, message?: string) {
    logger.logAction(level, action, message);
  }

  private logAction(level: LogLevels, action: string, message?: string) {
    if (this.shouldLog(level)) {
      (level === LogLevels.Error ? this.logErrorHandler : this.logHandler)(
        'Ably: ' + this.contextPrefix + action + ': ' + message,
        level,
      );
    }
  }

  deprecationWarning(message: string) {
    if (this.shouldLog(LogLevels.Error)) {
      this.logErrorHandler(`Ably: ${this.contextPrefix}Deprecation warning - ${message}`, LogLevels.Error);
    }
  }

  /* Where a logging operation is expensive, such as serialisation of data, use shouldLog will prevent
	   the object being serialised if the log level will not output the message */
  shouldLog = (level: LogLevels) => {
    return level <= this.logLevel;
  };

  setLog = (level: LogLevels | undefined, handler?: Function | undefined) => {
    if (level !== undefined) this.logLevel = level;
    if (handler !== undefined) this.logHandler = this.logErrorHandler = handler;
  };

  /**
   * Sets the context that tags each line, rendered in brackets after the `Ably: ` prefix, as in `Ably: [pool client 2] Connection state: failed`. With no context, or an empty one, lines are not tagged.
   */
  setContext = (context: string | undefined) => {
    this.contextPrefix = context ? '[' + context + '] ' : '';
  };
}

export default Logger;
