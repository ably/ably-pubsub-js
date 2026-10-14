// Values that cross the activity boundary are serialised by Temporal's payload converter, which is JSON-based
// by default. JSON cannot represent binary data, so binary values are replaced with a tagged base64 string
// before they leave one side of the boundary, and restored on the other.
//
// This module is imported by both the workflow and the worker entry points, so it must stay
// workflow-safe: no runtime imports, no Node built-ins, and no I/O.

const BINARY_TAG = '__ablyTemporalBinary';

// An object whose only key is one of these tags is wrapped in an escape object when it is encoded, so that it is
// not mistaken for an encoded value when it is decoded.
const ESCAPE_TAG = '__ablyTemporalEscaped';

/** A binary value encoded for transport across the activity boundary. */
export interface EncodedBinary {
  [BINARY_TAG]: string;
}

/**
 * The query parameters for a page of a paginated result, taken from the `Link` header of the response.
 * Fetching a page again with these parameters is equivalent to calling `first()`, `current()` or `next()` on an
 * Ably `PaginatedResult`.
 */
export type PageParams = Record<string, string>;

/** The links from a page of a paginated result to its related pages. */
export interface PageLinks {
  first?: PageParams;
  current?: PageParams;
  next?: PageParams;
}

/** A page of a paginated result, as returned from an activity. */
export interface WirePage<T> {
  items: T[];
  links: PageLinks;
}

/** A page of the result of `rest.request()`, as returned from an activity. */
export interface WireHttpPaginatedResponse<T> extends WirePage<T> {
  statusCode: number;
  success: boolean;
  errorCode?: number | null;
  errorMessage?: string | null;
  errorDetail?: Record<string, string>;
  headers: Record<string, string | string[]>;
}

function isBinary(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function isEncodedBinary(value: unknown): value is EncodedBinary {
  return (
    isObject(value) &&
    onlyKey(value) === BINARY_TAG &&
    typeof (value as Record<string, unknown>)[BINARY_TAG] === 'string'
  );
}

function isEscaped(value: unknown): value is Record<typeof ESCAPE_TAG, Record<string, unknown>> {
  return isObject(value) && onlyKey(value) === ESCAPE_TAG && isObject((value as Record<string, unknown>)[ESCAPE_TAG]);
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyKey(value: object): string | undefined {
  const keys = Object.keys(value);
  return keys.length === 1 ? keys[0] : undefined;
}

/**
 * Sets an own enumerable property on `target`. A key of `__proto__` is defined as an own property, because
 * assigning it would set the prototype of `target` instead.
 */
export function setOwnProperty(target: Record<string, unknown>, key: string, value: unknown): void {
  if (key === '__proto__') {
    Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
  } else {
    target[key] = value;
  }
}

/**
 * Returns a copy of `value` that can be safely JSON-serialised: every binary value (an `ArrayBuffer`, or an
 * `ArrayBufferView` such as a `Uint8Array` or Node `Buffer`) is replaced with an {@link EncodedBinary}, and every
 * other non-null object is copied to a plain object of its own enumerable properties.
 *
 * As with `JSON.stringify()`, an object with a `toJSON()` method is replaced by the result of calling it. A `Date`
 * is left for the payload converter to serialise as an ISO string, and an `Error` also keeps its non-enumerable
 * `message` and `cause`.
 */
export function encodeForWire(value: unknown): unknown {
  return encodeValue(value, true);
}

function encodeValue(value: unknown, callToJSON: boolean): unknown {
  if (isBinary(value)) {
    return { [BINARY_TAG]: bytesToBase64(toBytes(value)) };
  }
  if (Array.isArray(value)) {
    return value.map(encodeForWire);
  }
  if (value instanceof Date) {
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (callToJSON && typeof toJSON === 'function') {
      // The result of toJSON() is not converted again, as in JSON.stringify().
      return encodeValue(toJSON.call(value), false);
    }
    const result: Record<string, unknown> = {};
    if (value instanceof Error) {
      result.message = value.message;
      const cause = (value as { cause?: unknown }).cause;
      if (cause !== undefined) {
        result.cause = encodeForWire(cause);
      }
    }
    for (const key of Object.keys(value)) {
      const property = (value as Record<string, unknown>)[key];
      if (property !== undefined && typeof property !== 'function') {
        setOwnProperty(result, key, encodeForWire(property));
      }
    }
    const key = onlyKey(result);
    return key === BINARY_TAG || key === ESCAPE_TAG ? { [ESCAPE_TAG]: result } : result;
  }
  return value;
}

/**
 * Reverses {@link encodeForWire}, restoring every {@link EncodedBinary} to a `Uint8Array`. Binary values and
 * `Date`s are returned as they are, in case a custom payload converter delivers them without JSON encoding.
 */
export function decodeFromWire(value: unknown): unknown {
  if (isEncodedBinary(value)) {
    return base64ToBytes(value[BINARY_TAG]);
  }
  if (isBinary(value) || value instanceof Date) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(decodeFromWire);
  }
  if (value !== null && typeof value === 'object') {
    const source = (isEscaped(value) ? value[ESCAPE_TAG] : value) as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      setOwnProperty(result, key, decodeFromWire(source[key]));
    }
    return result;
  }
  return value;
}

function toBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}

// Neither `Buffer` nor `btoa`/`atob` is guaranteed to exist in the workflow sandbox, so base64 is implemented here.
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP: Record<string, number> = {};
for (let i = 0; i < BASE64_ALPHABET.length; i++) {
  BASE64_LOOKUP[BASE64_ALPHABET[i]] = i;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let result = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    const triple = (b0 << 16) | (b1 << 8) | b2;
    result += BASE64_ALPHABET[(triple >> 18) & 0x3f];
    result += BASE64_ALPHABET[(triple >> 12) & 0x3f];
    result += i + 1 < bytes.length ? BASE64_ALPHABET[(triple >> 6) & 0x3f] : '=';
    result += i + 2 < bytes.length ? BASE64_ALPHABET[triple & 0x3f] : '=';
  }
  return result;
}

export function base64ToBytes(base64: string): Uint8Array {
  const stripped = base64.replace(/=+$/, '');
  const bytes = new Uint8Array(Math.floor((stripped.length * 3) / 4));
  let byteIndex = 0;
  for (let i = 0; i < stripped.length; i += 4) {
    const c0 = BASE64_LOOKUP[stripped[i]] ?? 0;
    const c1 = BASE64_LOOKUP[stripped[i + 1]] ?? 0;
    const c2 = BASE64_LOOKUP[stripped[i + 2]] ?? 0;
    const c3 = BASE64_LOOKUP[stripped[i + 3]] ?? 0;
    const triple = (c0 << 18) | (c1 << 12) | (c2 << 6) | c3;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 16) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = (triple >> 8) & 0xff;
    if (byteIndex < bytes.length) bytes[byteIndex++] = triple & 0xff;
  }
  return bytes;
}
