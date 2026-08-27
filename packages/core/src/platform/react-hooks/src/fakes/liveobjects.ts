// A fake, in-memory implementation of the LiveObjects surface used by
// useObject: plain JSON data addressed by path segments, with mutation helpers
// that notify path subscriptions the way nested observation does.

interface PathListener {
  path: string[];
  callback: () => void;
}

export class FakeRealtimeObject {
  public data: Record<string, unknown>;
  public getCalls = 0;
  public listeners = new Set<PathListener>();
  /** Called at the start of every subscribe(), before the listener registers. */
  public onSubscribe?: () => void;

  private releaseGate?: () => void;
  private getGate?: Promise<void>;
  private getError?: unknown;

  constructor(data: Record<string, unknown> = {}) {
    this.data = data;
  }

  /** Make get() wait until releaseGet() is called. */
  public deferGet() {
    this.getGate = new Promise((resolve) => (this.releaseGate = resolve));
  }

  /** Resolve a get() previously deferred with deferGet(). */
  public releaseGet() {
    this.releaseGate?.();
  }

  /** Make get() reject with the given error. */
  public failGet(error: unknown) {
    this.getError = error;
  }

  public async get(): Promise<FakePathObject> {
    this.getCalls++;
    if (this.getError) {
      throw this.getError;
    }
    if (this.getGate) {
      await this.getGate;
    }
    return new FakePathObject(this, []);
  }

  /** Set the value at a path and notify overlapping subscriptions. */
  public set(path: string[], value: unknown) {
    if (path.length === 0) {
      throw new Error('cannot replace the root');
    }
    let target = this.data;
    for (const segment of path.slice(0, -1)) {
      if (typeof target[segment] !== 'object' || target[segment] === null) {
        target[segment] = {};
      }
      target = target[segment] as Record<string, unknown>;
    }
    target[path[path.length - 1]] = value;
    this.notify(path);
  }

  public valueAt(path: string[]): unknown {
    let current: unknown = this.data;
    for (const segment of path) {
      if (current === null || typeof current !== 'object') {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private notify(changedPath: string[]) {
    for (const listener of this.listeners) {
      // nested observation: a subscription at a path observes changes at or
      // below its path, and a change to an ancestor also affects the path
      const overlap = Math.min(listener.path.length, changedPath.length);
      let matches = true;
      for (let i = 0; i < overlap; i++) {
        if (listener.path[i] !== changedPath[i]) {
          matches = false;
          break;
        }
      }
      if (matches) {
        listener.callback();
      }
    }
  }
}

export class FakePathObject {
  private owner: FakeRealtimeObject;
  private segments: string[];

  constructor(owner: FakeRealtimeObject, segments: string[]) {
    this.owner = owner;
    this.segments = segments;
  }

  public get(key: string): FakePathObject {
    return new FakePathObject(this.owner, [...this.segments, key]);
  }

  public at(path: string): FakePathObject {
    return new FakePathObject(this.owner, [...this.segments, ...path.split('.')]);
  }

  public path(): string {
    return this.segments.join('.');
  }

  /** Like the real compact(), returns a fresh copy on every call. */
  public compact(): unknown {
    const value = this.owner.valueAt(this.segments);
    if (value === null || typeof value !== 'object') {
      return value;
    }
    return JSON.parse(JSON.stringify(value));
  }

  public subscribe(callback: () => void) {
    this.owner.onSubscribe?.();
    const listener: PathListener = { path: this.segments, callback };
    this.owner.listeners.add(listener);
    return {
      unsubscribe: () => {
        this.owner.listeners.delete(listener);
      },
    };
  }
}
