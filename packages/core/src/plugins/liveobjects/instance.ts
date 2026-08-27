import type BaseClient from 'common/lib/client/baseclient';
import type { EventCallback, Subscription } from '../../../ably';
import type {
  AnyInstance,
  BatchContext,
  BatchFunction,
  CompactedJsonValue,
  CompactedValue,
  Instance,
  InstanceSubscriptionEvent,
  LiveObject as LiveObjectType,
  Primitive,
  Value,
} from '../../../liveobjects';
import { LiveCounter } from './livecounter';
import { LiveMap } from './livemap';
import { LiveObject } from './liveobject';
import { ObjectMessage } from './objectmessage';
import { RealtimeObject } from './realtimeobject';
import { RootBatchContext } from './rootbatchcontext';

export interface InstanceEvent {
  /** Object message that caused this event */
  message?: ObjectMessage;
}

export class DefaultInstance<T extends Value> implements AnyInstance<T> {
  protected _client: BaseClient;

  constructor(
    private _realtimeObject: RealtimeObject,
    private _value: T,
  ) {
    this._client = this._realtimeObject.getClient();
  }

  get id(): string | undefined {
    if (!(this._value instanceof LiveObject)) {
      // no id exists for non-LiveObject types
      return undefined;
    }
    return this._value.getObjectId();
  }

  /**
   * Returns an in-memory JavaScript object representation of this instance.
   * Buffers are returned as-is.
   * For primitive types, this is an alias for calling value().
   *
   * Use compactJson() for a JSON-serializable representation.
   */
  compact<U extends Value = Value>(): CompactedValue<U> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (this._value instanceof LiveMap) {
      return this._value.compact() as CompactedValue<U>;
    }

    return this.value() as CompactedValue<U>;
  }

  /**
   * Returns a JSON-serializable representation of this instance.
   * Buffers are converted to base64 strings.
   *
   * Use compact() for an in-memory representation.
   */
  compactJson<U extends Value = Value>(): CompactedJsonValue<U> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (this._value instanceof LiveMap) {
      return this._value.compactJson() as CompactedJsonValue<U>;
    }

    const value = this.value();

    if (this._client.Platform.BufferUtils.isBuffer(value)) {
      return this._client.Platform.BufferUtils.base64Encode(value) as CompactedJsonValue<U>;
    }

    return value as CompactedJsonValue<U>;
  }

  get<U extends Value = Value>(key: string): Instance<U> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (!(this._value instanceof LiveMap)) {
      // can't get a key from a non-LiveMap type
      return undefined;
    }

    if (typeof key !== 'string') {
      throw new this._client.ErrorInfo(`Key must be a string: ${key}`, 40003, 400);
    }

    const value = this._value.get(key);
    if (value === undefined) {
      return undefined;
    }
    return new DefaultInstance<U>(this._realtimeObject, value) as unknown as Instance<U>;
  }

  value<U extends number | Primitive = number | Primitive>(): U | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (this._value instanceof LiveObject) {
      if (this._value instanceof LiveCounter) {
        return this._value.value() as U;
      }

      // for other LiveObject types, return undefined
      return undefined;
    } else if (
      this._client.Platform.BufferUtils.isBuffer(this._value) ||
      typeof this._value === 'string' ||
      typeof this._value === 'number' ||
      typeof this._value === 'boolean' ||
      typeof this._value === 'object' ||
      this._value === null
    ) {
      // primitive type - return it
      return this._value as unknown as U;
    } else {
      this._client.Logger.logAction(
        this._client.logger,
        this._client.Logger.LOG_MAJOR,
        'DefaultInstance.value()',
        `unexpected value type for instance, resolving to undefined; value=${this._value}; type=${typeof this._value}`,
      );
      // unknown type - return undefined
      return undefined;
    }
  }

  *entries<U extends Record<string, Value>>(): IterableIterator<[keyof U, Instance<U[keyof U]>]> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (!(this._value instanceof LiveMap)) {
      // return empty iterator for non-LiveMap objects
      return;
    }

    for (const [key, value] of this._value.entries()) {
      const instance = new DefaultInstance<U[keyof U]>(this._realtimeObject, value) as unknown as Instance<U[keyof U]>;
      yield [key, instance];
    }
  }

  *keys<U extends Record<string, Value>>(): IterableIterator<keyof U> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (!(this._value instanceof LiveMap)) {
      // return empty iterator for non-LiveMap objects
      return;
    }

    yield* this._value.keys();
  }

  *values<U extends Record<string, Value>>(): IterableIterator<Instance<U[keyof U]>> {
    for (const [_, value] of this.entries<U>()) {
      yield value;
    }
  }

  size(): number | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (!(this._value instanceof LiveMap)) {
      // can't return size for non-LiveMap objects
      return undefined;
    }
    return this._value.size();
  }

  set<U extends Record<string, Value> = Record<string, Value>>(
    key: keyof U & string,
    value: U[keyof U],
  ): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();
    if (!(this._value instanceof LiveMap)) {
      throw new this._client.ErrorInfo('Cannot set a key on a non-LiveMap instance', 92007, 400);
    }
    return this._value.set(key, value);
  }

  remove<U extends Record<string, Value> = Record<string, Value>>(key: keyof U & string): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();
    if (!(this._value instanceof LiveMap)) {
      throw new this._client.ErrorInfo('Cannot remove a key from a non-LiveMap instance', 92007, 400);
    }
    return this._value.remove(key);
  }

  increment(amount?: number | undefined): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();
    if (!(this._value instanceof LiveCounter)) {
      throw new this._client.ErrorInfo('Cannot increment a non-LiveCounter instance', 92007, 400);
    }
    return this._value.increment(amount ?? 1);
  }

  decrement(amount?: number | undefined): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();
    if (!(this._value instanceof LiveCounter)) {
      throw new this._client.ErrorInfo('Cannot decrement a non-LiveCounter instance', 92007, 400);
    }
    return this._value.decrement(amount ?? 1);
  }

  subscribe(listener: EventCallback<InstanceSubscriptionEvent<T>>): Subscription {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (!(this._value instanceof LiveObject)) {
      throw new this._client.ErrorInfo('Cannot subscribe to a non-LiveObject instance', 92007, 400);
    }

    return this._value.subscribe((event: InstanceEvent) => {
      listener({
        object: this as unknown as Instance<T>,
        message: event.message?.toUserFacingMessage(this._realtimeObject.getChannel()),
      });
    });
  }

  subscribeIterator(): AsyncIterableIterator<InstanceSubscriptionEvent<T>> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();

    if (!(this._value instanceof LiveObject)) {
      throw new this._client.ErrorInfo('Cannot subscribe to a non-LiveObject instance', 92007, 400);
    }

    return this._client.Utils.listenerToAsyncIterator((listener) => {
      const { unsubscribe } = this.subscribe(listener);
      return unsubscribe;
    });
  }

  async batch<T extends LiveObjectType = LiveObjectType>(fn: BatchFunction<T>): Promise<void> {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();

    if (!(this._value instanceof LiveObject)) {
      throw new this._client.ErrorInfo('Cannot batch operations on a non-LiveObject instance', 92007, 400);
    }

    const ctx = new RootBatchContext(this._realtimeObject, this);
    try {
      fn(ctx as unknown as BatchContext<T>);
      await ctx.flush();
    } finally {
      ctx.close();
    }
  }

  /** @internal */
  public isLiveMap(): boolean {
    return this._value instanceof LiveMap;
  }

  /** @internal */
  public isLiveCounter(): boolean {
    return this._value instanceof LiveCounter;
  }
}
