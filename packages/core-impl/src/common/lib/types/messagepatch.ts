import Platform from 'common/platform';
import * as API from '@ably/pubsub-core/api';
import * as Utils from '../util/utils';
import ErrorInfo from './errorinfo';
import type Message from './message';
import type { Properties } from '../util/utils';

/**
 * Applies message patches, with the same result as the server.
 *
 * A message's data arrives either decoded into JSON values, if it was published
 * with `encoding: json`, or as JSON text in a string or binary. Operations with
 * a path follow the path through decoded values, and splice text into JSON
 * text, so every byte of the text that an operation does not change is kept.
 * An operation's JSON value stays as text until it is set into decoded values.
 */

const endOfArrayToken = '-';

function patchError(message: string): ErrorInfo {
  return new ErrorInfo(message, 40000, 400);
}

function errInvalidPointer(path: string) {
  return patchError(
    `invalid path ${JSON.stringify(path)}; a patch operation path must be a JSON Pointer, such as /content/0/text`,
  );
}

function errPathNotFound(path: string) {
  return patchError(`path ${JSON.stringify(path)} does not exist in the message data`);
}

function errNotContainer() {
  return patchError('a patch operation with a path requires the message data to be a JSON object or array');
}

function errInvalidData() {
  return patchError('the message data is not valid JSON');
}

function errUnknownOperation(op: string) {
  return patchError(`unknown message patch operation ${JSON.stringify(op)}`);
}

export function applyPatch<T extends Properties<Message>>(message: T, patch: Properties<Message>): T {
  if (patch.action !== 'message.patch') {
    throw patchError(`unable to apply a ${patch.action} as a patch; only a message.patch can be applied`);
  }
  if (message.serial !== patch.serial) {
    throw patchError(`unable to apply a patch to message ${message.serial}; the patch is for message ${patch.serial}`);
  }

  let data = message.data;
  let encoding = message.encoding;
  const ops = patch.patches?.data ?? [];
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    try {
      if (op.path) {
        data = applyAtPath(data, op);
      } else if (op.op === 'set') {
        // decoded, as a message.update's data would be
        data = op.encoding === 'json' ? JSON.parse(op.data) : op.data;
        encoding = op.encoding === 'json' ? undefined : op.encoding;
      } else {
        data = applyToWhole(data, encoding, op);
      }
    } catch (err) {
      const e = err as ErrorInfo;
      throw new ErrorInfo(
        `unable to apply data patch operation ${i} (${op.op} at ${JSON.stringify(op.path ?? '')}): ${e.message}`,
        e.code,
        e.statusCode,
      );
    }
  }
  const extras = applyPrivilegedOperation(
    applyUserClaimOperation(
      applyHeaderOperations(message.extras, patch.patches?.extras?.headers ?? []),
      patch.patches?.extras?.userClaim,
    ),
    patch.patches?.extras?.privileged,
  );

  // a patch changes only data, extras and version
  return Object.assign(Object.create(Object.getPrototypeOf(message)), message, {
    action: 'message.update',
    data,
    encoding,
    extras,
    version: patch.version,
  });
}

function applyToWhole(data: any, encoding: string | null | undefined, op: API.MessagePatchDataOperation): any {
  switch (op.op) {
    case 'append':
      if (data == null && (typeof op.data === 'string' || Platform.BufferUtils.isBuffer(op.data))) {
        // as with message.append, appending to no data gives the value
        return op.data;
      }
      if (typeof data === 'string' && typeof op.data === 'string' && !encoding) {
        return data + op.data;
      }
      if (Platform.BufferUtils.isBuffer(data) && Platform.BufferUtils.isBuffer(op.data) && !encoding) {
        return Platform.BufferUtils.concat([data, op.data]);
      }
      throw patchError(
        'an append patch operation without a path requires the message data and the operation data to both be strings or both be binary',
      );
    case 'remove':
      throw patchError('a remove patch operation requires a path');
    default:
      throw errUnknownOperation(op.op);
  }
}

function applyAtPath(data: any, op: API.MessagePatchDataOperation): any {
  if (typeof data === 'string') {
    return applyToText(data, op);
  }
  if (Platform.BufferUtils.isBuffer(data)) {
    return Platform.BufferUtils.utf8Encode(applyToText(Platform.BufferUtils.utf8Decode(data), op));
  }
  if (Utils.isObject(data) || Array.isArray(data)) {
    return applyToValue(data, op);
  }
  throw errNotContainer();
}

// A path's tokens, unescaped
function parsePath(path: string): string[] {
  if (path === '' || path[0] !== '/') {
    throw errInvalidPointer(path);
  }
  for (let i = 0; i < path.length; i++) {
    if (path[i] === '~' && path[i + 1] !== '0' && path[i + 1] !== '1') {
      throw errInvalidPointer(path);
    }
  }
  return path
    .slice(1)
    .split('/')
    .map((tok) => tok.replace(/~1/g, '/').replace(/~0/g, '~'));
}

// An array index token, which RFC 6901 restricts to decimal digits with no
// leading zeros, or -1 if it is not one
function parseIndex(tok: string): number {
  return /^(0|[1-9][0-9]*)$/.test(tok) ? Number(tok) : -1;
}

function hasOwn(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

// Sets a property as an own data property, so a key such as __proto__ cannot
// change the object's prototype
function defineOwn(obj: object, key: string, value: unknown) {
  Object.defineProperty(obj, key, { value, writable: true, enumerable: true, configurable: true });
}

function cloneObject(obj: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    defineOwn(copy, key, obj[key]);
  }
  return copy;
}

// The JSON value an operation sets, as a decoded value
function decodedValue(op: API.MessagePatchDataOperation): unknown {
  if (Platform.BufferUtils.isBuffer(op.data)) {
    // JSON holds binary as base64
    return Platform.BufferUtils.base64Encode(op.data);
  }
  if (op.encoding === 'json' && typeof op.data === 'string') {
    return JSON.parse(op.data);
  }
  return op.data;
}

// Applies an operation with a path to decoded JSON values, copying each object
// and array on the path, and returns the new root
function applyToValue(root: any, op: API.MessagePatchDataOperation): any {
  const path = op.path!;
  const tokens = parsePath(path);
  const last = tokens[tokens.length - 1];

  const newRoot = Array.isArray(root) ? root.slice() : cloneObject(root);
  let target: any = newRoot;
  for (const tok of tokens.slice(0, -1)) {
    let child: any;
    if (Array.isArray(target)) {
      const idx = parseIndex(tok);
      if (idx < 0 || idx >= target.length) {
        throw errPathNotFound(path);
      }
      child = target[idx];
    } else {
      if (!hasOwn(target, tok)) {
        throw errPathNotFound(path);
      }
      child = target[tok];
    }
    if (Array.isArray(child)) {
      child = child.slice();
    } else if (Utils.isObject(child)) {
      child = cloneObject(child as Record<string, unknown>);
    } else {
      throw patchError(
        `unable to apply a patch operation at path ${JSON.stringify(path)}; its parent is not an object or array`,
      );
    }
    if (Array.isArray(target)) {
      target[parseIndex(tok)] = child;
    } else {
      defineOwn(target, tok, child);
    }
    target = child;
  }

  if (Array.isArray(target)) {
    if (last === endOfArrayToken) {
      if (op.op !== 'set') {
        throw patchError(
          `unable to ${op.op} at path ${JSON.stringify(path)}; "-" can only be used to set a new array element`,
        );
      }
      target.push(decodedValue(op));
      return newRoot;
    }
    const idx = parseIndex(last);
    if (idx < 0 || idx >= target.length) {
      throw errPathNotFound(path);
    }
    switch (op.op) {
      case 'set':
        target[idx] = decodedValue(op);
        break;
      case 'append':
        target[idx] = appendString(target[idx], op, path);
        break;
      case 'remove':
        target.splice(idx, 1);
        break;
      default:
        throw errUnknownOperation(op.op);
    }
    return newRoot;
  }

  switch (op.op) {
    case 'set':
      defineOwn(target, last, decodedValue(op));
      break;
    case 'append':
      if (!hasOwn(target, last)) {
        throw errPathNotFound(path);
      }
      defineOwn(target, last, appendString(target[last], op, path));
      break;
    case 'remove':
      if (!hasOwn(target, last)) {
        throw errPathNotFound(path);
      }
      delete target[last];
      break;
    default:
      throw errUnknownOperation(op.op);
  }
  return newRoot;
}

function appendString(value: unknown, op: API.MessagePatchDataOperation, path: string): string {
  if (typeof value !== 'string') {
    throw patchError(`unable to append at path ${JSON.stringify(path)}; the value there is not a string`);
  }
  if (typeof op.data !== 'string') {
    throw patchError('an append patch operation with a path requires data that is a string');
  }
  return value + op.data;
}

function applyHeaderOperations(extras: any, ops: API.MessagePatchHeaderOperation[]): any {
  if (ops.length === 0) {
    return extras;
  }
  const headers = Utils.isObject(extras?.headers) ? cloneObject(extras.headers) : {};
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    switch (op.op) {
      case 'set':
        defineOwn(headers, op.key, op.value);
        break;
      case 'remove':
        if (!hasOwn(headers, op.key)) {
          throw patchError(
            `unable to apply header patch operation ${i} (remove of ${JSON.stringify(op.key)}): the header does not exist`,
          );
        }
        delete headers[op.key];
        break;
      default:
        throw errUnknownOperation(op.op);
    }
  }
  return { ...extras, headers };
}

function applyPrivilegedOperation(extras: any, op: API.MessagePatchPrivilegedOperation | undefined): any {
  if (!op) {
    return extras;
  }
  if (op.op !== 'remove') {
    throw errUnknownOperation(op.op);
  }
  // removing missing privileged extras succeeds
  const { privileged: _, ...rest } = extras ?? {};
  return Object.keys(rest).length > 0 ? rest : undefined;
}

function applyUserClaimOperation(extras: any, op: API.MessagePatchUserClaimOperation | undefined): any {
  if (!op) {
    return extras;
  }
  const { userClaim: _, ...rest } = extras ?? {};
  switch (op.op) {
    case 'set':
      return { ...rest, userClaim: op.value };
    case 'remove':
      // unlike a header, removing a missing claim succeeds
      return Object.keys(rest).length > 0 ? rest : undefined;
    default:
      throw errUnknownOperation(op.op);
  }
}

// JSON text
//
// The functions below follow the server's, operating on JavaScript strings.
// Every character that delimits JSON is ASCII, so string indices locate values
// as byte offsets do.

function applyToText(doc: string, op: API.MessagePatchDataOperation): string {
  const path = op.path!;
  switch (op.op) {
    case 'set': {
      if (op.encoding === 'json') {
        return setText(doc, path, op.data);
      }
      if (typeof op.data === 'string') {
        return setText(doc, path, quote(op.data));
      }
      if (Platform.BufferUtils.isBuffer(op.data)) {
        return setText(doc, path, quote(Platform.BufferUtils.base64Encode(op.data)));
      }
      // a JSON value the developer has not yet encoded
      return setText(doc, path, JSON.stringify(op.data));
    }
    case 'append': {
      if (typeof op.data !== 'string') {
        throw patchError('an append patch operation with a path requires data that is a string');
      }
      const [, loc] = locate(doc, path, 'append');
      if (!loc.found) {
        throw errPathNotFound(path);
      }
      if (doc[loc.valStart] !== '"') {
        throw patchError(`unable to append at path ${JSON.stringify(path)}; the value there is not a string`);
      }
      // insert just before the closing quote
      const at = loc.valEnd - 1;
      const escaped = quote(op.data);
      return doc.slice(0, at) + escaped.slice(1, -1) + doc.slice(at);
    }
    case 'remove': {
      const [, loc] = locate(doc, path, 'remove');
      if (!loc.found) {
        throw errPathNotFound(path);
      }
      if (loc.nextStart >= 0) {
        return doc.slice(0, loc.start) + doc.slice(loc.nextStart);
      }
      if (loc.prevEnd >= 0) {
        // the last of several: remove the comma before it
        return doc.slice(0, loc.prevEnd) + doc.slice(loc.valEnd);
      }
      return doc.slice(0, loc.start) + doc.slice(loc.valEnd);
    }
    default:
      throw errUnknownOperation(op.op);
  }
}

// A string as JSON, escaped as the server escapes it. The server replaces
// invalid UTF-8 with U+FFFD, as the UTF-8 encoding of a lone surrogate does.
function quote(s: string): string {
  let wellFormed = '';
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0xd800 || c > 0xdfff) continue;
    if (c <= 0xdbff && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    }
    wellFormed += s.slice(last, i) + '�';
    last = i + 1;
  }
  return JSON.stringify(last === 0 ? s : wellFormed + s.slice(last));
}

function setText(doc: string, path: string, value: string): string {
  const [target, loc] = locate(doc, path, 'set');
  if (loc.found) {
    return doc.slice(0, loc.valStart) + value + doc.slice(loc.valEnd);
  }
  // add a new member or element after the last one
  let insertion = loc.lastEnd >= 0 ? ',' : '';
  if (doc[target] === '{') {
    const tokens = parsePath(path);
    insertion += quote(tokens[tokens.length - 1]) + ':';
  }
  insertion += value;
  const at = loc.lastEnd >= 0 ? loc.lastEnd : loc.open;
  return doc.slice(0, at) + insertion + doc.slice(at);
}

type MemberLoc = {
  found: boolean;
  // the start of the member's key, or of the element
  start: number;
  valStart: number;
  valEnd: number;
  // the end of the previous value, or -1 if this is the first
  prevEnd: number;
  // the start of the next member or element, or -1 if this is the last
  nextStart: number;
  // the index just past the opening bracket
  open: number;
  // when not found, the end of the last value, or -1 if the container is empty
  lastEnd: number;
};

// Returns the start of the object or array holding the value at path, and the
// location within it of the value
function locate(doc: string, path: string, op: string): [number, MemberLoc] {
  const start = skipWS(doc, 0);
  if (start >= doc.length || (doc[start] !== '{' && doc[start] !== '[')) {
    throw errNotContainer();
  }
  const tokens = parsePath(path);
  const last = tokens[tokens.length - 1];

  // every token but the last locates the target
  let target = start;
  for (const tok of tokens.slice(0, -1)) {
    let loc: MemberLoc;
    if (doc[target] === '{') {
      loc = findMember(doc, target, tok, false);
    } else if (doc[target] === '[') {
      const idx = parseIndex(tok);
      if (idx < 0) {
        throw errPathNotFound(path);
      }
      loc = findElement(doc, target, idx, false);
    } else {
      throw errPathNotFound(path);
    }
    if (!loc.found) {
      throw errPathNotFound(path);
    }
    target = loc.valStart;
  }
  if (doc[target] !== '{' && doc[target] !== '[') {
    throw patchError(
      `unable to apply a patch operation at path ${JSON.stringify(path)}; its parent is not an object or array`,
    );
  }

  if (doc[target] === '{') {
    return [target, findMember(doc, target, last, true)];
  }
  if (last === endOfArrayToken) {
    if (op !== 'set') {
      throw patchError(
        `unable to ${op} at path ${JSON.stringify(path)}; "-" can only be used to set a new array element`,
      );
    }
    return [target, findElement(doc, target, -1, true)];
  }
  const idx = parseIndex(last);
  if (idx < 0) {
    throw errPathNotFound(path);
  }
  const loc = findElement(doc, target, idx, true);
  if (!loc.found) {
    throw errPathNotFound(path);
  }
  return [target, loc];
}

function newLoc(open: number): MemberLoc {
  return { found: false, start: 0, valStart: 0, valEnd: 0, prevEnd: -1, nextStart: -1, open, lastEnd: -1 };
}

// Locates the member key within the object starting at doc[i], scanning past
// its value only if full is set
function findMember(doc: string, i: number, key: string, full: boolean): MemberLoc {
  const loc = newLoc(i + 1);
  i++;
  for (;;) {
    i = skipWS(doc, i);
    if (i >= doc.length) throw errInvalidData();
    if (doc[i] === '}' && loc.lastEnd < 0) return loc;
    if (doc[i] !== '"') throw errInvalidData();
    const keyStart = i;
    const keyEnd = skipString(doc, i);
    const match = keyEquals(doc.slice(i + 1, keyEnd - 1), key);
    i = skipWS(doc, keyEnd);
    if (i >= doc.length || doc[i] !== ':') throw errInvalidData();
    const valStart = skipWS(doc, i + 1);
    if (valStart >= doc.length) throw errInvalidData();
    if (match && !full) {
      loc.found = true;
      loc.valStart = valStart;
      return loc;
    }
    const valEnd = skipValue(doc, valStart);
    i = skipWS(doc, valEnd);
    if (i >= doc.length) throw errInvalidData();
    if (match) {
      Object.assign(loc, { found: true, start: keyStart, valStart, valEnd, prevEnd: loc.lastEnd });
      if (doc[i] === ',') loc.nextStart = skipWS(doc, i + 1);
      return loc;
    }
    loc.lastEnd = valEnd;
    if (doc[i] === ',') {
      i++;
    } else if (doc[i] === '}') {
      return loc;
    } else {
      throw errInvalidData();
    }
  }
}

// Locates element idx within the array starting at doc[i], scanning past its
// value only if full is set. An idx of -1 finds no element, so locates the end
// of the array.
function findElement(doc: string, i: number, idx: number, full: boolean): MemberLoc {
  const loc = newLoc(i + 1);
  i = skipWS(doc, i + 1);
  if (i >= doc.length) throw errInvalidData();
  if (doc[i] === ']') return loc;
  for (let n = 0; ; n++) {
    const valStart = i;
    if (valStart >= doc.length) throw errInvalidData();
    if (n === idx && !full) {
      loc.found = true;
      loc.valStart = valStart;
      return loc;
    }
    const valEnd = skipValue(doc, i);
    i = skipWS(doc, valEnd);
    if (i >= doc.length) throw errInvalidData();
    if (n === idx) {
      Object.assign(loc, { found: true, start: valStart, valStart, valEnd, prevEnd: loc.lastEnd });
      if (doc[i] === ',') loc.nextStart = skipWS(doc, i + 1);
      return loc;
    }
    loc.lastEnd = valEnd;
    if (doc[i] === ',') {
      i = skipWS(doc, i + 1);
    } else if (doc[i] === ']') {
      return loc;
    } else {
      throw errInvalidData();
    }
  }
}

// Compares a raw (still escaped) JSON object key with a decoded key
function keyEquals(raw: string, key: string): boolean {
  if (raw.indexOf('\\') < 0) {
    return raw === key;
  }
  try {
    return JSON.parse('"' + raw + '"') === key;
  } catch (e) {
    return false;
  }
}

function skipWS(doc: string, i: number): number {
  while (i < doc.length) {
    const c = doc[i];
    if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') return i;
    i++;
  }
  return i;
}

// Returns the index just past the value starting at doc[i]
function skipValue(doc: string, i: number): number {
  if (i >= doc.length) throw errInvalidData();
  if (doc[i] === '"') return skipString(doc, i);
  if (doc[i] === '{' || doc[i] === '[') return skipContainer(doc, i);
  // number, true, false or null
  let j = i;
  while (j < doc.length && ',}] \t\n\r'.indexOf(doc[j]) < 0) j++;
  if (j === i) throw errInvalidData();
  return j;
}

// Returns the index just past the string starting at doc[i]
function skipString(doc: string, i: number): number {
  let j = i + 1;
  for (;;) {
    const q = doc.indexOf('"', j);
    if (q < 0) throw errInvalidData();
    // the quote is escaped if preceded by an odd number of backslashes
    let backslashes = 0;
    for (let p = q - 1; p > i && doc[p] === '\\'; p--) backslashes++;
    if (backslashes % 2 === 0) return q + 1;
    j = q + 1;
  }
}

// Returns the index just past the object or array starting at doc[i]
function skipContainer(doc: string, i: number): number {
  let depth = 0;
  for (let j = i; j < doc.length; j++) {
    switch (doc[j]) {
      case '"':
        j = skipString(doc, j) - 1;
        break;
      case '{':
      case '[':
        depth++;
        break;
      case '}':
      case ']':
        depth--;
        if (depth === 0) return j + 1;
        break;
    }
  }
  throw errInvalidData();
}

/**
 * Builds a patch's operations with typed paths (Message.buildPatch). The types
 * are compile-time only: one untyped path class backs every view, as one
 * PathObject class backs LiveObjects' typed views, and each call adds the
 * operation a hand-written patch would, at its JSON Pointer.
 */
export function buildPatch(
  build: (data: API.AnyPatchPath, headers: API.MessagePatchHeaders) => void,
): API.MessagePatches {
  const data: API.MessagePatchDataOperation[] = [];
  const headerOps: API.MessagePatchHeaderOperation[] = [];
  build(new PatchPathBuilder(data, ''), {
    set(key, value) {
      headerOps.push({ op: 'set', key, value });
    },
    remove(key) {
      headerOps.push({ op: 'remove', key });
    },
  });
  const patches: API.MessagePatches = {};
  if (data.length > 0) {
    patches.data = data;
  }
  if (headerOps.length > 0) {
    patches.extras = { headers: headerOps };
  }
  return patches;
}

class PatchPathBuilder implements API.AnyPatchPath {
  constructor(
    private readonly ops: API.MessagePatchDataOperation[],
    readonly path: string,
  ) {}

  set(value: any): void {
    this.add('set', this.path, requireValue(value, 'set'));
  }

  append(value: string): void {
    this.add('append', this.path, value);
  }

  get(keyOrIndex: string | number): PatchPathBuilder {
    return new PatchPathBuilder(this.ops, this.child(keyOrIndex));
  }

  push(value: any): void {
    this.add('set', this.path + '/' + endOfArrayToken, requireValue(value, 'push'));
  }

  removeAt(index: number): void {
    this.add('remove', this.child(requireIndex(index)));
  }

  remove(key: string): void {
    this.add('remove', this.child(key));
  }

  at(pointer: string): PatchPathBuilder {
    if (pointer !== '' && pointer[0] !== '/') {
      throw new ErrorInfo({
        message: `invalid path ${JSON.stringify(pointer)}; at() takes a JSON Pointer relative to the path, such as /content/0/text`,
        code: 40000,
        statusCode: 400,
        remediation: 'Start the pointer with "/", and escape "~" as "~0" and "/" within a key as "~1".',
      });
    }
    return new PatchPathBuilder(this.ops, this.path + pointer);
  }

  // A JSON Pointer token, escaped as RFC 6901 says
  private child(keyOrIndex: string | number): string {
    return this.path + '/' + String(keyOrIndex).replace(/~/g, '~0').replace(/\//g, '~1');
  }

  private add(op: API.MessagePatchDataOperation['op'], path: string, value?: unknown) {
    // An empty path is the whole of the data, an operation without a path
    const operation: API.MessagePatchDataOperation = path ? { op, path } : { op };
    if (value !== undefined) {
      operation.data = value;
    }
    this.ops.push(operation);
  }
}

// JSON has no undefined, so a set or push of it has no value to send
function requireValue(value: unknown, method: string): unknown {
  if (value === undefined) {
    throw new ErrorInfo({
      message: `unable to ${method} undefined in a message patch; JSON has no undefined value`,
      code: 40000,
      statusCode: 400,
      remediation: 'Pass null to set a JSON null, or remove the key with remove() on its object.',
    });
  }
  return value;
}

function requireIndex(index: number): number {
  if (!Number.isInteger(index) || index < 0) {
    throw new ErrorInfo({
      message: `invalid array index ${index} in a message patch; an index must be a non-negative integer`,
      code: 40000,
      statusCode: 400,
      remediation: 'Pass the position of an existing element, counting from 0.',
    });
  }
  return index;
}
