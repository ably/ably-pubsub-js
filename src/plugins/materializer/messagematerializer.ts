import type * as API from '../../../ably';
import { parsePartialJSON, Allow } from './partial-json';

/**
 * A materialized message extends the standard InboundMessage with a convenience
 * method for parsing incomplete JSON data (useful for AI/LLM token streaming).
 */
export interface MaterializedMessage extends API.InboundMessage {
  /**
   * Attempt to parse the message's accumulated `data` as JSON.
   * If the JSON is incomplete (e.g., mid-stream), uses a partial JSON parser
   * to return the best-effort result.
   *
   * @returns The parsed value, or `undefined` if parsing fails entirely
   */
  toPartialJSON<T = unknown>(): T | undefined;
}

interface PendingFetch {
  /** Queued appends waiting for the fetch to complete */
  queued: API.InboundMessage[];
  /** Promise for the in-flight getMessage() call */
  promise: Promise<void>;
}

type MessageListener = (message: MaterializedMessage) => void;
type FilteredListener = {
  event: string | null;
  userListener: MessageListener;
};

/**
 * MessageMaterializer provides a convenience layer over Ably's `message.append`
 * functionality. It automatically accumulates appended data, handles late-join
 * via `channel.getMessage()`, and offers `toPartialJSON()` for rendering
 * incomplete JSON objects as they stream in.
 *
 * Usage:
 * ```typescript
 * const materializer = new MessageMaterializer(channel);
 * materializer.subscribe((msg) => {
 *   console.log('Accumulated data:', msg.data);
 *   console.log('Partial JSON:', msg.toPartialJSON());
 * });
 * ```
 */
export class MessageMaterializer {
  private cache: Map<string, MaterializedMessage> = new Map();
  private pendingFetches: Map<string, PendingFetch> = new Map();
  private listeners: FilteredListener[] = [];
  private channelListener: ((message: API.InboundMessage) => void) | null = null;
  private maxMessages: number;
  private channel: API.RealtimeChannel;

  constructor(channel: API.RealtimeChannel, options?: { maxMessages?: number }) {
    this.channel = channel;
    this.maxMessages = options?.maxMessages ?? 100;
  }

  /**
   * Subscribe to materialized messages. Each emission contains the full
   * accumulated state of the message (original + all appends applied).
   *
   * @param listenerOrEvent - Either a listener callback, or an event name to filter on
   * @param listener - The listener callback (when filtering by event name)
   */
  async subscribe(listenerOrEvent: string | MessageListener, listener?: MessageListener): Promise<void> {
    let event: string | null = null;
    let userListener: MessageListener;

    if (typeof listenerOrEvent === 'function') {
      userListener = listenerOrEvent;
    } else {
      event = listenerOrEvent;
      if (!listener) throw new Error('MessageMaterializer.subscribe(): listener is required when filtering by event');
      userListener = listener;
    }

    this.listeners.push({ event, userListener });

    // Set up underlying channel subscription if this is the first listener
    if (!this.channelListener) {
      this.channelListener = (message: API.InboundMessage) => {
        this.handleMessage(message);
      };
      await this.channel.subscribe(this.channelListener);
    }
  }

  /**
   * Unsubscribe a listener. If all listeners are removed, the underlying
   * channel subscription is also cleaned up.
   *
   * @param listenerOrEvent - Either a listener callback, or an event name
   * @param listener - The listener callback (when filtering by event name)
   */
  unsubscribe(listenerOrEvent?: string | MessageListener, listener?: MessageListener): void {
    if (!listenerOrEvent && !listener) {
      // Remove all listeners
      this.listeners = [];
    } else if (typeof listenerOrEvent === 'function') {
      this.listeners = this.listeners.filter((l) => l.userListener !== listenerOrEvent);
    } else if (typeof listenerOrEvent === 'string') {
      if (listener) {
        this.listeners = this.listeners.filter(
          (l) => !(l.event === listenerOrEvent && l.userListener === listener),
        );
      } else {
        this.listeners = this.listeners.filter((l) => l.event !== listenerOrEvent);
      }
    }

    // Clean up channel subscription if no listeners remain
    if (this.listeners.length === 0 && this.channelListener) {
      this.channel.unsubscribe(this.channelListener);
      this.channelListener = null;
    }
  }

  /**
   * Get a snapshot of all currently cached materialized messages.
   */
  getMessages(): MaterializedMessage[] {
    return Array.from(this.cache.values());
  }

  /**
   * Get a specific cached message by serial.
   */
  getMessage(serial: string): MaterializedMessage | undefined {
    return this.cache.get(serial);
  }

  private handleMessage(message: API.InboundMessage): void {
    switch (message.action) {
      case 'message.create':
        this.handleCreate(message);
        break;
      case 'message.update':
        this.handleUpdate(message);
        break;
      case 'message.append':
        this.handleAppend(message);
        break;
      case 'message.delete':
        this.handleDelete(message);
        break;
      case 'message.summary':
        this.handleSummary(message);
        break;
      default:
        // Pass through unknown actions (e.g., 'meta')
        break;
    }
  }

  private handleCreate(message: API.InboundMessage): void {
    const materialized = this.wrapMessage(message);
    this.storeAndEvict(message.serial, materialized);
    this.emit(materialized);
  }

  private handleUpdate(message: API.InboundMessage): void {
    const existing = this.cache.get(message.serial);
    if (existing) {
      // Only apply if version is newer
      if (this.isNewerVersion(message.version, existing.version)) {
        const materialized = this.wrapMessage(message);
        this.storeAndEvict(message.serial, materialized);
        this.emit(materialized);
      }
    } else {
      // No cached version — store as-is (server has already materialized it for rewind)
      const materialized = this.wrapMessage(message);
      this.storeAndEvict(message.serial, materialized);
      this.emit(materialized);
    }
  }

  private handleAppend(message: API.InboundMessage): void {
    const serial = message.serial;
    const existing = this.cache.get(serial);

    if (existing) {
      // Append data to cached message
      this.applyAppend(existing, message);
      this.emit(existing);
    } else if (this.pendingFetches.has(serial)) {
      // Already fetching — queue this append
      this.pendingFetches.get(serial)!.queued.push(message);
    } else {
      // Unknown serial — fetch from server and queue
      this.fetchAndMaterialize(serial, message);
    }
  }

  private handleDelete(message: API.InboundMessage): void {
    const existing = this.cache.get(message.serial);
    if (existing) {
      if (this.isNewerVersion(message.version, existing.version)) {
        // Update with delete action
        existing.action = message.action;
        existing.version = message.version;
        existing.timestamp = message.timestamp;
        this.emit(existing);
      }
    } else {
      const materialized = this.wrapMessage(message);
      this.storeAndEvict(message.serial, materialized);
      this.emit(materialized);
    }
  }

  private handleSummary(message: API.InboundMessage): void {
    const existing = this.cache.get(message.serial);
    if (existing) {
      existing.annotations = message.annotations;
      existing.action = message.action;
      this.emit(existing);
    } else {
      // Store the summary even without a cached message
      const materialized = this.wrapMessage(message);
      this.storeAndEvict(message.serial, materialized);
      this.emit(materialized);
    }
  }

  private fetchAndMaterialize(serial: string, firstAppend: API.InboundMessage): void {
    const pending: PendingFetch = {
      queued: [firstAppend],
      promise: Promise.resolve(),
    };

    pending.promise = (async () => {
      try {
        const fetched = await this.channel.getMessage(serial);
        const materialized = this.wrapMessage(fetched as API.InboundMessage);

        // Apply queued appends that are newer than the fetched version
        const watermark = fetched.version?.serial;
        for (const queuedAppend of pending.queued) {
          if (watermark && queuedAppend.version?.serial && queuedAppend.version.serial <= watermark) {
            // This append is already included in the fetched state — skip
            continue;
          }
          this.applyAppend(materialized, queuedAppend);
        }

        this.storeAndEvict(serial, materialized);
        this.emit(materialized);
      } catch (err) {
        // If fetch fails, create a best-effort message from the queued appends
        console.warn(`MessageMaterializer: Failed to fetch message ${serial}:`, err);
        const bestEffort = this.wrapMessage(firstAppend);
        // Apply remaining queued appends
        for (let i = 1; i < pending.queued.length; i++) {
          this.applyAppend(bestEffort, pending.queued[i]);
        }
        this.storeAndEvict(serial, bestEffort);
        this.emit(bestEffort);
      } finally {
        this.pendingFetches.delete(serial);
      }
    })();

    this.pendingFetches.set(serial, pending);
  }

  private applyAppend(target: MaterializedMessage, append: API.InboundMessage): void {
    // Concatenate string data
    if (typeof target.data === 'string' && typeof append.data === 'string') {
      target.data = target.data + append.data;
    } else if (target.data instanceof ArrayBuffer && append.data instanceof ArrayBuffer) {
      // Concatenate binary data
      const combined = new Uint8Array(target.data.byteLength + append.data.byteLength);
      combined.set(new Uint8Array(target.data), 0);
      combined.set(new Uint8Array(append.data), target.data.byteLength);
      target.data = combined.buffer;
    } else {
      // Fallback: coerce to string
      target.data = String(target.data ?? '') + String(append.data ?? '');
    }

    // Update version and action metadata
    target.version = append.version;
    target.action = append.action;
  }

  private wrapMessage(message: API.InboundMessage): MaterializedMessage {
    // Create a shallow copy with toPartialJSON added
    const materialized: MaterializedMessage = {
      ...message,
      toPartialJSON<T = unknown>(): T | undefined {
        const data = this.data;
        if (data == null) return undefined;

        const str = typeof data === 'string' ? data : String(data);
        if (!str.trim()) return undefined;

        // Try complete JSON first
        try {
          return JSON.parse(str) as T;
        } catch {
          // Fall through to partial parsing
        }

        // Try partial JSON parsing
        try {
          return parsePartialJSON(str, Allow.ALL) as T;
        } catch {
          return undefined;
        }
      },
    };

    return materialized;
  }

  private storeAndEvict(serial: string, message: MaterializedMessage): void {
    this.cache.set(serial, message);

    // Evict oldest entries if over capacity
    if (this.cache.size > this.maxMessages) {
      const keysToDelete: string[] = [];
      let count = 0;
      const excess = this.cache.size - this.maxMessages;
      this.cache.forEach((_value, key) => {
        if (count >= excess) return;
        keysToDelete.push(key);
        count++;
      });
      keysToDelete.forEach((key) => this.cache.delete(key));
    }
  }

  private emit(message: MaterializedMessage): void {
    for (const { event, userListener } of this.listeners) {
      if (event === null || event === message.name) {
        try {
          userListener(message);
        } catch (err) {
          console.error('MessageMaterializer: Listener threw an exception:', err);
        }
      }
    }
  }

  private isNewerVersion(
    incoming: API.MessageVersion,
    existing: API.MessageVersion,
  ): boolean {
    // Compare by version serial (lexicographic), then by timestamp
    if (incoming.serial && existing.serial) {
      return incoming.serial > existing.serial;
    }
    if (incoming.timestamp && existing.timestamp) {
      return incoming.timestamp > existing.timestamp;
    }
    // If we can't compare, assume incoming is newer
    return true;
  }
}
