import type BaseClient from 'common/lib/client/baseclient';
import type {
  AnyBatchContext,
  BatchContext,
  CompactedJsonValue,
  CompactedValue,
  Instance,
  Primitive,
  Value,
} from '../../../liveobjects';
import { DefaultInstance } from './instance';
import { LiveCounter } from './livecounter';
import { LiveMap } from './livemap';
import { RealtimeObject } from './realtimeobject';
import { RootBatchContext } from './rootbatchcontext';

export class DefaultBatchContext implements AnyBatchContext {
  protected _client: BaseClient;

  constructor(
    protected _realtimeObject: RealtimeObject,
    protected _instance: Instance<Value>,
    protected _rootContext: RootBatchContext,
  ) {
    this._client = this._realtimeObject.getClient();
  }

  get id(): string | undefined {
    this._throwIfClosed();
    return this._instance.id;
  }

  get<T extends Value = Value>(key: string): BatchContext<T> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    this._throwIfClosed();
    const instance = this._instance.get(key);
    if (!instance) {
      return undefined;
    }
    return this._rootContext.wrapInstance(instance) as unknown as BatchContext<T>;
  }

  value<T extends Primitive = Primitive>(): T | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    this._throwIfClosed();
    return this._instance.value();
  }

  compact<T extends Value = Value>(): CompactedValue<T> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    this._throwIfClosed();
    return this._instance.compact();
  }

  compactJson<T extends Value = Value>(): CompactedJsonValue<T> | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    this._throwIfClosed();
    return this._instance.compactJson();
  }

  *entries<T extends Record<string, Value>>(): IterableIterator<[keyof T, BatchContext<T[keyof T]>]> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    this._throwIfClosed();
    for (const [key, value] of this._instance.entries()) {
      const ctx = this._rootContext.wrapInstance(value) as unknown as BatchContext<T[keyof T]>;
      yield [key, ctx];
    }
  }

  *keys<T extends Record<string, Value>>(): IterableIterator<keyof T> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    this._throwIfClosed();
    yield* this._instance.keys();
  }

  *values<T extends Record<string, Value>>(): IterableIterator<BatchContext<T[keyof T]>> {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    this._throwIfClosed();
    for (const [_, value] of this.entries<T>()) {
      yield value;
    }
  }

  size(): number | undefined {
    this._realtimeObject.throwIfInvalidAccessApiConfiguration();
    this._throwIfClosed();
    return this._instance.size();
  }

  set(key: string, value: Value): void {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();
    this._throwIfClosed();
    if (!(this._instance as DefaultInstance<Value>).isLiveMap()) {
      throw new this._client.ErrorInfo('Cannot set a key on a non-LiveMap instance', 92007, 400);
    }
    this._rootContext.queueMessages(async () =>
      LiveMap.createMapSetMessage(this._realtimeObject, this._instance.id!, key, value),
    );
  }

  remove(key: string): void {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();
    this._throwIfClosed();
    if (!(this._instance as DefaultInstance<Value>).isLiveMap()) {
      throw new this._client.ErrorInfo('Cannot remove a key from a non-LiveMap instance', 92007, 400);
    }
    this._rootContext.queueMessages(async () => [
      LiveMap.createMapRemoveMessage(this._realtimeObject, this._instance.id!, key),
    ]);
  }

  increment(amount?: number): void {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();
    this._throwIfClosed();
    if (!(this._instance as DefaultInstance<Value>).isLiveCounter()) {
      throw new this._client.ErrorInfo('Cannot increment a non-LiveCounter instance', 92007, 400);
    }
    this._rootContext.queueMessages(async () => [
      LiveCounter.createCounterIncMessage(this._realtimeObject, this._instance.id!, amount ?? 1),
    ]);
  }

  decrement(amount?: number): void {
    this._realtimeObject.throwIfInvalidWriteApiConfiguration();
    this._throwIfClosed();
    if (!(this._instance as DefaultInstance<Value>).isLiveCounter()) {
      throw new this._client.ErrorInfo('Cannot decrement a non-LiveCounter instance', 92007, 400);
    }
    this.increment(-(amount ?? 1));
  }

  private _throwIfClosed(): void {
    if (this._rootContext.isClosed()) {
      throw new this._client.ErrorInfo('Batch is closed', 40000, 400);
    }
  }
}
