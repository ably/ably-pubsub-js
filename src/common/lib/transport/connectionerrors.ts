import ErrorInfo from '../types/errorinfo';
import type { ErrorCode } from '../types/errorcodes';

// `satisfies` checks every code against the registry while keeping the literal types, so
// that the members stay usable as ErrorCode at the call sites below.
const ConnectionErrorCodes = {
  DISCONNECTED: 80003,
  SUSPENDED: 80002,
  FAILED: 80000,
  CLOSING: 80017,
  CLOSED: 80017,
  UNKNOWN_CONNECTION_ERR: 50002,
  UNKNOWN_CHANNEL_ERR: 50001,
} as const satisfies Record<string, ErrorCode>;

const ConnectionErrors = {
  disconnected: () =>
    ErrorInfo.fromValues({
      statusCode: 400,
      code: ConnectionErrorCodes.DISCONNECTED,
      message: 'Connection to server temporarily unavailable',
    }),
  suspended: () =>
    ErrorInfo.fromValues({
      statusCode: 400,
      code: ConnectionErrorCodes.SUSPENDED,
      message: 'Connection to server unavailable',
    }),
  failed: () =>
    ErrorInfo.fromValues({
      statusCode: 400,
      code: ConnectionErrorCodes.FAILED,
      message: 'Connection failed or disconnected by server',
    }),
  closing: () =>
    ErrorInfo.fromValues({
      statusCode: 400,
      code: ConnectionErrorCodes.CLOSING,
      message: 'Connection closing',
    }),
  closed: () =>
    ErrorInfo.fromValues({
      statusCode: 400,
      code: ConnectionErrorCodes.CLOSED,
      message: 'Connection closed',
    }),
  unknownConnectionErr: () =>
    ErrorInfo.fromValues({
      statusCode: 500,
      code: ConnectionErrorCodes.UNKNOWN_CONNECTION_ERR,
      message: 'Internal connection error',
    }),
  unknownChannelErr: () =>
    ErrorInfo.fromValues({
      statusCode: 500,
      code: ConnectionErrorCodes.UNKNOWN_CHANNEL_ERR,
      message: 'Internal channel error',
    }),
};

export function isRetriable(err: ErrorInfo) {
  if (!err.statusCode || !err.code || err.statusCode >= 500) {
    return true;
  }
  // Widened because `as const` gives the values their own narrow literal union, which
  // `includes` will not accept an arbitrary ErrorCode against.
  return (Object.values(ConnectionErrorCodes) as ErrorCode[]).includes(err.code);
}

export default ConnectionErrors;
