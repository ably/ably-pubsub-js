// Values that cross the activity boundary are serialised by Temporal's payload converter, which is JSON-based
// by default. JSON cannot represent binary data, so binary data crosses the boundary as Ably's JSON protocol carries
// it:
//
// - The `data` of a message, presence message or annotation is a base64 string, with `base64` appended to its
//   `encoding` (RSL4d1). The worker passes it to Ably as it is, and the workflow decodes it back to a `Uint8Array`.
// - The `bytes` of a LiveObjects value is a base64 string.
//
// Workflow code rejects binary data anywhere else in an activity's arguments, and the worker returns binary data
// anywhere else in a result as a base64 string.
//
// This module is imported by both the workflow and the worker entry points, so it must stay
// workflow-safe: no runtime imports, no Node built-ins, and no I/O.

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

/** Encodes bytes as a base64 string. */
export type Base64Encoder = (bytes: Uint8Array) => string;

/**
 * Handles a binary value found by {@link toWireValue}, and returns the value to replace it with.
 *
 * @param bytes - The bytes of the binary value.
 * @param path - Where the value is, such as `messages[0].data.image`.
 */
export type BinaryHandler = (bytes: Uint8Array, path: string) => unknown;

export function isBinary(value: unknown): value is ArrayBuffer | ArrayBufferView {
  return value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

/** Returns a copy of `value`, a plain object, with each of its own enumerable properties replaced by `map`. */
function mapProperties(value: Record<string, unknown>, map: (property: unknown) => unknown): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    setOwnProperty(result, key, map(value[key]));
  }
  return result;
}

/**
 * Returns a copy of `value` that can be safely JSON-serialised: every binary value (an `ArrayBuffer`, or an
 * `ArrayBufferView` such as a `Uint8Array` or Node `Buffer`) is replaced with the result of `onBinary`, and every
 * other non-null object is copied to a plain object of its own enumerable properties.
 *
 * As with `JSON.stringify()`, an object with a `toJSON()` method is replaced by the result of calling it. A `Date`
 * is left for the payload converter to serialise as an ISO string, and an `Error` also keeps its non-enumerable
 * `message` and `cause`.
 */
export function toWireValue(value: unknown, onBinary: BinaryHandler): unknown {
  return copyValue(value, onBinary, '', true);
}

function copyValue(value: unknown, onBinary: BinaryHandler, path: string, callToJSON: boolean): unknown {
  if (isBinary(value)) {
    return onBinary(toBytes(value), path);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => copyValue(item, onBinary, `${path}[${index}]`, true));
  }
  if (value instanceof Date) {
    return value;
  }
  if (value !== null && typeof value === 'object') {
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (callToJSON && typeof toJSON === 'function') {
      // The result of toJSON() is not converted again, as in JSON.stringify().
      return copyValue(toJSON.call(value), onBinary, path, false);
    }
    const result: Record<string, unknown> = {};
    if (value instanceof Error) {
      result.message = value.message;
      const cause = (value as { cause?: unknown }).cause;
      if (cause !== undefined) {
        result.cause = copyValue(cause, onBinary, propertyPath(path, 'cause'), true);
      }
    }
    for (const key of Object.keys(value)) {
      const property = (value as Record<string, unknown>)[key];
      if (property !== undefined && typeof property !== 'function') {
        setOwnProperty(result, key, copyValue(property, onBinary, propertyPath(path, key), true));
      }
    }
    return result;
  }
  return value;
}

function propertyPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

/**
 * Returns `message` with binary `data` encoded as base64, and `base64` appended to its `encoding`, as Ably's JSON
 * protocol sends binary data (RSL4d1). Anything else is returned as it is. The message passed in is not modified.
 *
 * @param message - A message, presence message or annotation.
 * @param base64 - Encodes the data as base64.
 */
export function encodeBinaryData<T>(message: T, base64: Base64Encoder = bytesToBase64): T {
  if (!isObject(message) || !isBinary(message.data)) {
    return message;
  }
  const encoding = message.encoding;
  return {
    ...message,
    data: base64(toBytes(message.data)),
    encoding: typeof encoding === 'string' && encoding ? `${encoding}/base64` : 'base64',
  } as T;
}

/**
 * Reverses {@link encodeBinaryData}: returns `message` with string `data` whose last `encoding` is `base64` decoded
 * to a `Uint8Array`, and that encoding removed. When no encoding remains, `encoding` is `null`, as for a message the
 * Ably SDK has decoded. Anything else is returned as it is. The message passed in is not modified.
 *
 * @param message - A message, presence message or annotation.
 */
export function decodeBinaryData<T>(message: T): T {
  if (!isObject(message) || typeof message.data !== 'string' || typeof message.encoding !== 'string') {
    return message;
  }
  const encodings = message.encoding.split('/');
  if (encodings[encodings.length - 1] !== 'base64') {
    return message;
  }
  encodings.pop();
  return { ...message, data: base64ToBytes(message.data), encoding: encodings.join('/') || null } as T;
}

/** Applies {@link decodeBinaryData} to each item of a page of messages. The page passed in is not modified. */
export function decodePageData<P extends WirePage<unknown>>(page: P): P {
  return isObject(page) && Array.isArray(page.items)
    ? ({ ...page, items: page.items.map((item) => decodeBinaryData(item)) } as P)
    : page;
}

/**
 * Returns a LiveObjects operation with `map` applied to the `bytes` of each value it publishes: the `value` of a
 * `mapSet`, and the `data` of each entry of a `mapCreate`. The operation passed in is not modified.
 */
export function mapOperationBytes<T>(operation: T, map: (bytes: unknown) => unknown): T {
  if (!isObject(operation)) {
    return operation;
  }
  const { mapSet, mapCreate } = operation;
  let result: Record<string, unknown> = operation;
  if (isObject(mapSet) && isObject(mapSet.value) && mapSet.value.bytes != null) {
    result = { ...result, mapSet: { ...mapSet, value: { ...mapSet.value, bytes: map(mapSet.value.bytes) } } };
  }
  if (isObject(mapCreate) && isObject(mapCreate.entries)) {
    const entries = mapProperties(mapCreate.entries, (entry) =>
      isObject(entry) && isObject(entry.data) && entry.data.bytes != null
        ? { ...entry, data: { ...entry.data, bytes: map(entry.data.bytes) } }
        : entry,
    );
    result = { ...result, mapCreate: { ...mapCreate, entries } };
  }
  return result as T;
}

/**
 * Returns a full-format LiveObjects `get()` result with `map` applied to the `bytes` of each value in it: those of a
 * leaf value, and those of each map entry, at any depth. The result passed in is not modified.
 */
export function mapFullObjectBytes<T>(node: T, map: (bytes: unknown) => unknown): T {
  if (!isObject(node)) {
    return node;
  }
  if (isObject(node.map)) {
    const { entries } = node.map;
    if (!isObject(entries)) {
      return node;
    }
    const mapped = mapProperties(entries, (entry) =>
      isObject(entry) ? { ...entry, data: mapFullObjectBytes(entry.data, map) } : entry,
    );
    return { ...node, map: { ...node.map, entries: mapped } } as T;
  }
  if ('counter' in node || node.bytes == null) {
    return node;
  }
  return { ...node, bytes: map(node.bytes) } as T;
}

export function toBytes(value: ArrayBuffer | ArrayBufferView): Uint8Array {
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
