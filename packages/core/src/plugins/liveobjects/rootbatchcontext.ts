import type { Instance, Value } from '../../../liveobjects';
import { DefaultBatchContext } from './batchcontext';
import { ObjectMessage } from './objectmessage';
import { RealtimeObject } from './realtimeobject';

export class RootBatchContext extends DefaultBatchContext {
  /** Maps object ids to the corresponding batch context wrappers  */
  private _wrappedInstances: Map<string, DefaultBatchContext> = new Map();
  /**
   * Some object messages require asynchronous I/O during construction
   * (for example, generating an objectId for nested value types).
   * Therefore, messages cannot be constructed immediately during
   * synchronous method calls from batch context methods.
   * Instead, message constructors are queued and executed on flush.
   */
  private _queuedMessageConstructors: (() => Promise<ObjectMessage[]>)[] = [];
  private _isClosed = false;

  constructor(realtimeObject: RealtimeObject, instance: Instance<Value>) {
    // Pass a placeholder null that will be replaced immediately
    super(realtimeObject, instance, null as any);
    // Set the root context to itself
    this._rootContext = this;
  }

  /** @internal */
  async flush(): Promise<void> {
    try {
      this.close();

      const msgs = (await Promise.all(this._queuedMessageConstructors.map((x) => x()))).flat();

      if (msgs.length > 0) {
        await this._realtimeObject.publishAndApply(msgs);
      }
    } finally {
      this._wrappedInstances.clear();
      this._queuedMessageConstructors = [];
    }
  }

  /** @internal */
  close(): void {
    this._isClosed = true;
  }

  /** @internal */
  isClosed(): boolean {
    return this._isClosed;
  }

  /** @internal */
  wrapInstance(instance: Instance<Value>): DefaultBatchContext {
    const objectId = instance.id;
    if (objectId) {
      // memoize liveobject instances by their object ids
      if (this._wrappedInstances.has(objectId)) {
        return this._wrappedInstances.get(objectId)!;
      }

      let wrappedInstance = new DefaultBatchContext(this._realtimeObject, instance, this);
      this._wrappedInstances.set(objectId, wrappedInstance);
      return wrappedInstance;
    }

    return new DefaultBatchContext(this._realtimeObject, instance, this);
  }

  /** @internal */
  queueMessages(msgCtors: () => Promise<ObjectMessage[]>): void {
    this._queuedMessageConstructors.push(msgCtors);
  }
}
