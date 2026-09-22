import type BaseClient from 'common/lib/client/baseclient';
import type { EventCallback, Subscription } from '../../../ably';
import type {
  AnyPathObject,
  BatchContext,
  BatchFunction,
  CompactedJsonValue,
  CompactedValue,
  Instance,
  LiveObject as LiveObjectType,
  PathObject,
  PathObjectSubscriptionEvent,
  PathObjectSubscriptionOptions,
  Primitive,
  Value,
} from '../../../liveobjects';
import { DefaultInstance } from './instance';
import { LiveCounter } from './livecounter';
import { LiveMap } from './livemap';
import { LiveObject } from './liveobject';
import { Path } from './path';
import { RealtimeObject } from './realtimeobject';
import { RootBatchContext } from './rootbatchcontext';

/**
 * Implementation of AnyPathObject interface.
 * Provides a generic implementation that can handle any type of PathObject operations.
 */
export class DefaultPathObject implements AnyPathObject {
  private _client: BaseClient;
  private _path: Path;

  constructor(
    private _realtimeObject: RealtimeObject,
    private _root: LiveMap,
    path: Path,
    parent?: DefaultPathObject,
  ) {
    this._client = this._realtimeObject.getClient();
    // copy parent path array
    this._path = [...(parent?._path ?? []), ...path];
  }

  /**
   * Returns the fully-qualified string path that this PathObject represents.
   * Path segments with dots in them are escaped with a backslash.
   * For example, a path with segments `['a', 'b.c', 'd']` will be represented as `a.b\.c.d`.
   */
  path(): string {
    // escape dots in path segments to avoid ambiguity in the joined path
    return this._escapePath(this._path).join('.');
  }

  /**
   * Returns an in-memory JavaScript object representation of the object at this path.
   * If the path does not resolve to any specific entry, returns `undefined`.
   * Buffers are returned as-is.
   * For primitive types, this is an alias for calling value().
   *
   * Use compactJson() for a JSON-serializable representation.
   */
  compact<U extends Value = Value>(): CompactedValue<U> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    try {
      const resolved = this._resolvePath(this._path);

      if (resolved instanceof LiveMap) {
        return resolved.compact() as CompactedValue<U>;
      }

      return this.value() as CompactedValue<U>;
    } catch (error) {
      if (this._client.Utils.isErrorInfoOrPartialErrorInfo(error) && error.code === 92005) {
        // ignore path resolution errors and return undefined
        return undefined;
      }
      // rethrow everything else
      throw error;
    }
  }

  /**
   * Returns a JSON-serializable representation of the object at this path.
   * If the path does not resolve to any specific entry, returns `undefined`.
   * Buffers are converted to base64 strings.
   *
   * Use compact() for an in-memory representation.
   */
  compactJson<U extends Value = Value>(): CompactedJsonValue<U> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    try {
      const resolved = this._resolvePath(this._path);

      if (resolved instanceof LiveMap) {
        return resolved.compactJson() as CompactedJsonValue<U>;
      }

      const value = this.value();

      if (this._client.Platform.BufferUtils.isBuffer(value)) {
        return this._client.Platform.BufferUtils.base64Encode(value) as CompactedJsonValue<U>;
      }

      return value as CompactedJsonValue<U>;
    } catch (error) {
      if (this._client.Utils.isErrorInfoOrPartialErrorInfo(error) && error.code === 92005) {
        // ignore path resolution errors and return undefined
        return undefined;
      }
      // rethrow everything else
      throw error;
    }
  }

  /**
   * Navigate to a child path within the collection by obtaining a PathObject for that path.
   * The next path segment in a collection is identified with a string key.
   */
  get<U extends Value = Value>(key: string): PathObject<U> {
    if (typeof key !== 'string') {
      throw new this._client.ErrorInfo(`Path key must be a string: ${key}`, 40003, 400);
    }
    return new DefaultPathObject(this._realtimeObject, this._root, [key], this) as unknown as PathObject<U>;
  }

  /**
   * Get a PathObject at the specified path relative to this object
   */
  at<U extends Value = Value>(path: string): PathObject<U> {
    if (typeof path !== 'string') {
      throw new this._client.ErrorInfo(`Path must be a string: ${path}`, 40003, 400);
    }

    // We need to split the path on unescaped dots, i.e. dots not preceded by a backslash.
    // The easy way to do this would be to use "path.split(/(?<!\\)\./)" to split on unescaped dots
    // and then call ".replace(/\\\./g, '.')" on each segment.
    // However, that uses negative lookbehind which is not supported in some browsers we aim to support
    // (based on https://github.com/ably/ably-js/pull/2037/files), like Safari before 16.4.
    // See full list https://caniuse.com/?search=negative%20lookbehind.
    // So instead we do splitting manually.
    const pathAsArray: Path = [];
    let currentSegment = '';
    let escaping = false;
    for (const char of path) {
      if (escaping) {
        // keep the escape character if not escaping a dot
        // this is to replicate the ".replace(/\\\./g, '.')" behavior where only escaped dots are unescaped
        if (char !== '.') currentSegment += '\\';
        currentSegment += char;
        escaping = false;
        continue;
      }
      if (char === '\\') {
        escaping = true;
        continue;
      }
      if (char === '.') {
        pathAsArray.push(currentSegment);
        currentSegment = '';
        continue;
      }
      currentSegment += char;
    }
    if (escaping) {
      currentSegment += '\\';
    }
    pathAsArray.push(currentSegment);

    return new DefaultPathObject(this._realtimeObject, this._root, pathAsArray, this) as unknown as PathObject<U>;
  }

  /**
   * Get the current value at this path.
   * If the path does not resolve to any specific entry, returns `undefined`.
   */
  value<U extends number | Primitive = number | Primitive>(): U | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    try {
      const resolved = this._resolvePath(this._path);

      if (resolved instanceof LiveObject) {
        if (resolved instanceof LiveCounter) {
          return resolved.value() as U;
        }

        // can't resolve value for other live object types
        return undefined;
      } else if (
        this._client.Platform.BufferUtils.isBuffer(resolved) ||
        typeof resolved === 'string' ||
        typeof resolved === 'number' ||
        typeof resolved === 'boolean' ||
        typeof resolved === 'object' ||
        resolved === null
      ) {
        // primitive type - return it
        return resolved as U;
      } else {
        this._client.Logger.logAction(
          this._client.logger,
          this._client.Logger.LOG_MAJOR,
          'PathObject.value()',
          `unexpected value type at path, resolving to undefined; path=${this._escapePath(this._path).join('.')}`,
        );
        // unknown type - return undefined
        return undefined;
      }
    } catch (error) {
      if (this._client.Utils.isErrorInfoOrPartialErrorInfo(error) && error.code === 92005) {
        // ignore path resolution errors and return undefined
        return undefined;
      }
      // rethrow everything else
      throw error;
    }
  }

  /**
   * Get an Instance wrapping the value currently at this path, whether it is a LiveObject or a primitive.
   * If the path does not resolve, returns `undefined`.
   */
  instance<T extends Value = Value>(): Instance<T> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    try {
      return this._resolveInstance<T>();
    } catch (error) {
      if (this._client.Utils.isErrorInfoOrPartialErrorInfo(error) && error.code === 92005) {
        // ignore path resolution errors and return undefined
        return undefined;
      }
      // rethrow everything else
      throw error;
    }
  }

  /**
   * Returns an iterator of [key, value] pairs for LiveMap entries
   */
  *entries<U extends Record<string, Value>>(): IterableIterator<[keyof U, PathObject<U[keyof U]>]> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    try {
      const resolved = this._resolvePath(this._path);
      if (!(resolved instanceof LiveMap)) {
        // return empty iterator for non-LiveMap objects
        return;
      }

      for (const [key, _] of resolved.entries()) {
        const value = new DefaultPathObject(this._realtimeObject, this._root, [key], this) as unknown as PathObject<
          U[keyof U]
        >;
        yield [key, value];
      }
    } catch (error) {
      if (this._client.Utils.isErrorInfoOrPartialErrorInfo(error) && error.code === 92005) {
        // ignore path resolution errors and return empty iterator
        return;
      }
      // rethrow everything else
      throw error;
    }
  }

  /**
   * Returns an iterator of keys for LiveMap entries
   */
  *keys<U extends Record<string, Value>>(): IterableIterator<keyof U> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    try {
      const resolved = this._resolvePath(this._path);
      if (!(resolved instanceof LiveMap)) {
        // return empty iterator for non-LiveMap objects
        return;
      }

      yield* resolved.keys();
    } catch (error) {
      if (this._client.Utils.isErrorInfoOrPartialErrorInfo(error) && error.code === 92005) {
        // ignore path resolution errors and return empty iterator
        return;
      }
      // rethrow everything else
      throw error;
    }
  }

  /**
   * Returns an iterator of PathObject values for LiveMap entries
   */
  *values<U extends Record<string, Value>>(): IterableIterator<PathObject<U[keyof U]>> {
    for (const [_, value] of this.entries<U>()) {
      yield value;
    }
  }

  /**
   * Returns the size of the collection at this path
   */
  size(): number | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    try {
      const resolved = this._resolvePath(this._path);
      if (!(resolved instanceof LiveMap)) {
        // can't return size for non-LiveMap objects
        return undefined;
      }

      return resolved.size();
    } catch (error) {
      if (this._client.Utils.isErrorInfoOrPartialErrorInfo(error) && error.code === 92005) {
        // ignore path resolution errors and return undefined
        return undefined;
      }
      // rethrow everything else
      throw error;
    }
  }

  set<T extends Record<string, Value> = Record<string, Value>>(
    key: keyof T & string,
    value: T[keyof T],
  ): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();

    const resolved = this._resolvePath(this._path);
    if (!(resolved instanceof LiveMap)) {
      throw new this._client.ErrorInfo(
        `Cannot set a key on a non-LiveMap object at path: ${this._escapePath(this._path).join('.')}`,
        92007,
        400,
      );
    }

    return resolved.set(key, value);
  }

  remove<T extends Record<string, Value> = Record<string, Value>>(key: keyof T & string): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();

    const resolved = this._resolvePath(this._path);
    if (!(resolved instanceof LiveMap)) {
      throw new this._client.ErrorInfo(
        `Cannot remove a key from a non-LiveMap object at path: ${this._escapePath(this._path).join('.')}`,
        92007,
        400,
      );
    }

    return resolved.remove(key);
  }

  increment(amount?: number): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();

    const resolved = this._resolvePath(this._path);
    if (!(resolved instanceof LiveCounter)) {
      throw new this._client.ErrorInfo(
        `Cannot increment a non-LiveCounter object at path: ${this._escapePath(this._path).join('.')}`,
        92007,
        400,
      );
    }

    return resolved.increment(amount ?? 1);
  }

  decrement(amount?: number): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();

    const resolved = this._resolvePath(this._path);
    if (!(resolved instanceof LiveCounter)) {
      throw new this._client.ErrorInfo(
        `Cannot decrement a non-LiveCounter object at path: ${this._escapePath(this._path).join('.')}`,
        92007,
        400,
      );
    }

    return resolved.decrement(amount ?? 1);
  }

  /**
   * Subscribes to changes to the object (and, by default, its children) or to a primitive value at this path.
   *
   * PathObject subscriptions rely on LiveObject instances to broadcast updates through a subscription
   * registry for the paths they occupy in the object graph. These updates are then routed to the appropriate
   * PathObject subscriptions based on their paths.
   *
   * When the underlying object or primitive value at this path is changed via an update to its parent
   * collection (for example, if a new LiveCounter instance is set at this path, or a key's value is
   * changed in a parent LiveMap), a subscription to this path will receive a separate **non-bubbling**
   * event indicating the change. This event is not propagated to parent path subscriptions, as they will
   * receive their own event for changes made directly to the object at their respective paths.
   *
   * PathObject subscriptions observe nested changes by default. Optional `depth` parameter can be provided
   * to control this behavior. A subscription depth of `1` means that only direct updates to the underlying
   * object - and changes that overwrite the value at this path (via parent object updates) - will trigger events.
   */

  subscribe(
    listener: EventCallback<PathObjectSubscriptionEvent>,
    options?: PathObjectSubscriptionOptions,
  ): Subscription {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    return this._realtimeObject.getPathObjectSubscriptionRegister().subscribe(this._path, listener, options ?? {});
  }

  subscribeIterator(options?: PathObjectSubscriptionOptions): AsyncIterableIterator<PathObjectSubscriptionEvent> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    return this._client.Utils.listenerToAsyncIterator((listener) => {
      const { unsubscribe } = this.subscribe(listener, options);
      return unsubscribe;
    });
  }

  async batch<T extends LiveObjectType = LiveObjectType>(fn: BatchFunction<T>): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();

    // a path may resolve to a primitive (RTPO8f), but only LiveObjects can host batch operations
    const resolved = this._resolvePath(this._path);
    if (!(resolved instanceof LiveObject)) {
      throw new this._client.ErrorInfo(
        `Cannot batch operations on a non-LiveObject at path: ${this._escapePath(this._path).join('.')}`,
        92007,
        400,
      );
    }

    const instance = new DefaultInstance(this._realtimeObject, resolved) as unknown as Instance<Value>;
    const ctx = new RootBatchContext(this._realtimeObject, instance);
    try {
      fn(ctx as unknown as BatchContext<T>);
      await ctx.flush();
    } finally {
      ctx.close();
    }
  }

  private _resolvePath(path: Path): Value {
    let current: Value = this._root;

    for (let i = 0; i < path.length; i++) {
      const segment = path[i];

      if (!(current instanceof LiveMap)) {
        throw new this._client.ErrorInfo(
          `Cannot resolve path segment '${segment}' on non-collection type at path: ${this._escapePath(path.slice(0, i)).join('.')}`,
          92005,
          400,
        );
      }

      const next: Value | undefined = current.get(segment);

      if (next === undefined) {
        throw new this._client.ErrorInfo(
          `Could not resolve value at path: ${this._escapePath(path.slice(0, i + 1)).join('.')}`,
          92005,
          400,
        );
      }

      current = next;
    }

    return current;
  }

  private _resolveInstance<T extends Value = Value>(): Instance<T> {
    const value = this._resolvePath(this._path);

    // wrap the resolved value in an Instance, whether a LiveObject or a primitive (RTPO8c, RTPO8f)
    return new DefaultInstance(this._realtimeObject, value) as unknown as Instance<T>;
  }

  private _escapePath(path: Path): Path {
    return path.map((x) => x.replace(/\./g, '\\.'));
  }
}
