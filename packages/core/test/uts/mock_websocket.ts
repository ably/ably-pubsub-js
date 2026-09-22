/**
 * Mock WebSocket infrastructure for UTS Realtime tests.
 *
 * Provides a MockWebSocket controller that intercepts WebSocket creation
 * via Platform.Config.WebSocket. Follows the same handler+await patterns
 * as mock_http.ts.
 *
 * See: uts/test/realtime/unit/helpers/mock_websocket.md
 */

/** Default CONNECTED protocol message */
const DEFAULT_CONNECTED = {
  action: 4, // CONNECTED
  connectionId: 'test-connection-id',
  connectionDetails: {
    connectionKey: 'test-connection-key',
    clientId: null as string | null,
    connectionStateTtl: 120000,
    maxIdleInterval: 15000,
    maxMessageSize: 65536,
    serverId: 'test-server',
    siteCode: 'test',
    objectsGCGracePeriod: 86400000,
  },
  error: null as any,
};

/** WebSocket connectivity check URL pattern */
const WS_CONNECTIVITY_CHECK = 'ws-up.ably-realtime.com';

/**
 * A single mock WebSocket instance — the object returned by `new Constructor(url)`.
 * Implements the W3C + Node.js `ws` WebSocket interface that ably-js expects.
 */
class MockWSInstance {
  url: string;
  private _owner: MockWebSocket;
  private _closed: boolean;
  private _pingListeners: Array<() => void>;

  // W3C WebSocket interface (set by ably-js after construction)
  binaryType: string;
  onopen: (() => void) | null;
  onclose: ((ev: { code: number; wasClean: boolean }) => void) | null;
  onmessage: ((ev: { data: string }) => void) | null;
  onerror: ((ev: { message: string }) => void) | null;

  constructor(url: string, owner: MockWebSocket) {
    this.url = url;
    this._owner = owner;
    this._closed = false;
    this._pingListeners = [];

    this.binaryType = '';
    this.onopen = null;
    this.onclose = null;
    this.onmessage = null;
    this.onerror = null;
  }

  /** Node.js `ws` library `on(event, handler)` — ably-js registers 'ping' listener */
  on(event: string, handler: () => void): void {
    if (event === 'ping') {
      this._pingListeners.push(handler);
    }
  }

  /** Client sends a message (ably-js calls this with a JSON string) */
  send(data: string): void {
    if (this._closed) return;
    const decoded = JSON.parse(data);
    this._owner._onClientMessage(decoded, data, this);
  }

  /** Client closes the connection */
  close(code?: number, reason?: string): void {
    if (this._closed) return;
    this._closed = true;
    this._owner._onClientClose(this, code, reason);
    // Deliver onclose asynchronously (matches real WebSocket behavior)
    process.nextTick(() => {
      if (this.onclose) {
        this.onclose({ code: code || 1000, wasClean: true });
      }
    });
  }

  // --- Test helpers (called by PendingWSConnection) ---

  _fireOpen(): void {
    process.nextTick(() => {
      if (this.onopen) this.onopen();
    });
  }

  _fireClose(code?: number, wasClean?: boolean): void {
    if (this._closed) return;
    this._closed = true;
    process.nextTick(() => {
      if (this.onclose) {
        this.onclose({ code: code || 1000, wasClean: wasClean !== false });
      }
    });
  }

  _fireError(message?: string): void {
    process.nextTick(() => {
      if (this.onerror) this.onerror({ message: message || 'Connection error' });
    });
  }

  _fireMessage(protocolMessage: any): void {
    process.nextTick(() => {
      if (this.onmessage) {
        this.onmessage({ data: JSON.stringify(protocolMessage) });
      }
    });
  }

  _firePing(): void {
    process.nextTick(() => {
      for (const handler of this._pingListeners) handler();
    });
  }
}

/**
 * Represents a pending WebSocket connection attempt.
 * Test code calls respond_with_* methods to control the outcome.
 */
class PendingWSConnection {
  ws: MockWSInstance;
  url: URL;
  private _opened: boolean;

  constructor(ws: MockWSInstance, parsedUrl: URL) {
    this.ws = ws;
    this.url = parsedUrl;
    this._opened = false;
  }

  /**
   * Connection succeeds and delivers a CONNECTED protocol message.
   */
  respond_with_connected(
    connectedMsg?: Partial<Omit<typeof DEFAULT_CONNECTED, 'connectionDetails'>> & {
      connectionDetails?: Partial<typeof DEFAULT_CONNECTED.connectionDetails>;
    },
  ): void {
    const msg = connectedMsg
      ? Object.assign({}, DEFAULT_CONNECTED, connectedMsg, {
          connectionDetails: Object.assign(
            {},
            DEFAULT_CONNECTED.connectionDetails,
            connectedMsg.connectionDetails || {},
          ),
        })
      : DEFAULT_CONNECTED;

    this._opened = true;
    this.ws._fireOpen();
    // Deliver CONNECTED after onopen fires
    process.nextTick(() => {
      this.ws._fireMessage(msg);
    });
  }

  /** Connection succeeds (fires onopen) but no protocol message delivered */
  respond_with_success(): void {
    this._opened = true;
    this.ws._fireOpen();
  }

  /** Connection refused at network level */
  respond_with_refused(): void {
    this.ws._fireError('Connection refused');
    this.ws._fireClose(1006, false);
  }

  /** Connection times out — never responds */
  respond_with_timeout(): void {
    // Intentionally do nothing. The connection hangs.
  }

  /** DNS resolution fails */
  respond_with_dns_error(): void {
    this.ws._fireError('getaddrinfo ENOTFOUND');
    this.ws._fireClose(1006, false);
  }

  /**
   * WebSocket connects but server sends an ERROR protocol message then closes.
   */
  respond_with_error(errorMsg: any): void {
    this._opened = true;
    this.ws._fireOpen();
    process.nextTick(() => {
      this.ws._fireMessage(errorMsg);
      process.nextTick(() => {
        this.ws._fireClose(1000, true);
      });
    });
  }

  /** Send a protocol message to the client on this connection */
  send_to_client(msg: any): void {
    this.ws._fireMessage(msg);
  }

  /** Send a protocol message then close the connection */
  send_to_client_and_close(msg: any): void {
    this.ws._fireMessage(msg);
    process.nextTick(() => {
      this.ws._fireClose(1000, true);
    });
  }

  /** Close the connection without sending a message (transport failure) */
  simulate_disconnect(error?: { message?: string }): void {
    if (error) {
      this.ws._fireError(error.message || 'Transport error');
    }
    this.ws._fireClose(1006, false);
  }

  /** Close the connection cleanly (server-initiated) */
  close(): void {
    this.ws._fireClose(1000, true);
  }

  /** Simulate a WebSocket ping frame (for RTN23b) */
  send_ping_frame(): void {
    this.ws._firePing();
  }
}

interface MockWebSocketOptions {
  onConnectionAttempt?: (conn: PendingWSConnection) => void;
  onMessageFromClient?: (msg: any, conn: PendingWSConnection | undefined) => void;
  onTextDataFrame?: (raw: string) => void;
}

type ConnectionWaiter = (conn: PendingWSConnection) => void;
type MessageWaiter = (msg: any) => void;
type CloseWaiter = (ev: { code?: number; reason?: string }) => void;

/**
 * MockWebSocket — the main mock class.
 *
 * Usage (handler pattern):
 *   const mock = new MockWebSocket({
 *     onConnectionAttempt: (conn) => conn.respond_with_connected(),
 *     onMessageFromClient: (msg, conn) => { ... },
 *   });
 *   installMockWebSocket(mock.constructorFn);
 *
 * Usage (await pattern):
 *   const mock = new MockWebSocket();
 *   installMockWebSocket(mock.constructorFn);
 *   const conn = await mock.await_connection_attempt();
 *   conn.respond_with_connected();
 */
class MockWebSocket {
  onConnectionAttempt: MockWebSocketOptions['onConnectionAttempt'] | null;
  onMessageFromClient: MockWebSocketOptions['onMessageFromClient'] | null;
  onTextDataFrame: MockWebSocketOptions['onTextDataFrame'] | null;

  connect_attempts: PendingWSConnection[];
  active_connection: PendingWSConnection | null;
  private _connectionWaiters: ConnectionWaiter[];
  private _messageWaiters: MessageWaiter[];
  private _closeWaiters: CloseWaiter[];

  /** The constructor function to pass to installMockWebSocket() */
  constructorFn: (url: string) => MockWSInstance;

  constructor(options?: MockWebSocketOptions) {
    options = options || {};
    this.onConnectionAttempt = options.onConnectionAttempt || null;
    this.onMessageFromClient = options.onMessageFromClient || null;
    this.onTextDataFrame = options.onTextDataFrame || null;

    this.connect_attempts = [];
    this.active_connection = null;
    this._connectionWaiters = [];
    this._messageWaiters = [];
    this._closeWaiters = [];

    // Build the constructor function that will replace Platform.Config.WebSocket
    const mock = this;
    this.constructorFn = function MockWSConstructor(url: string) {
      return mock._onNewWebSocket(url);
    };
  }

  /** @internal Called when ably-js does `new Platform.Config.WebSocket(url)` */
  _onNewWebSocket(url: string): MockWSInstance {
    // Handle connectivity checker — auto-respond without involving test handlers
    if (url.includes(WS_CONNECTIVITY_CHECK)) {
      const ws = new MockWSInstance(url, this);
      process.nextTick(() => {
        if (ws.onopen) ws.onopen();
        process.nextTick(() => {
          if (ws.onclose) ws.onclose({ code: 1000, wasClean: true });
        });
      });
      return ws;
    }

    const ws = new MockWSInstance(url, this);
    const parsedUrl = new URL(url);
    const conn = new PendingWSConnection(ws, parsedUrl);
    this.connect_attempts.push(conn);

    // Notify handler or waiter
    if (this.onConnectionAttempt) {
      this.onConnectionAttempt(conn);
    } else if (this._connectionWaiters.length > 0) {
      this._connectionWaiters.shift()!(conn);
    }
    // If neither handler nor waiter, the connection hangs until test responds

    return ws;
  }

  /** @internal Called when the client sends a message via ws.send() */
  _onClientMessage(decoded: any, raw: string, ws: MockWSInstance): void {
    // Find the connection for this ws instance
    const conn = this.connect_attempts.find((c) => c.ws === ws);

    if (this.onTextDataFrame) {
      this.onTextDataFrame(raw);
    }

    if (this.onMessageFromClient) {
      this.onMessageFromClient(decoded, conn);
    } else if (this._messageWaiters.length > 0) {
      this._messageWaiters.shift()!(decoded);
    }
  }

  /** @internal Called when the client closes the WebSocket */
  _onClientClose(_ws: MockWSInstance, code?: number, reason?: string): void {
    if (this._closeWaiters.length > 0) {
      this._closeWaiters.shift()!({ code, reason });
    }
  }

  /** Wait for the next WebSocket connection attempt */
  await_connection_attempt(timeout?: number): Promise<PendingWSConnection> {
    return new Promise((resolve, reject) => {
      const timer = timeout
        ? setTimeout(() => reject(new Error('Timeout waiting for WS connection attempt')), timeout)
        : null;
      this._connectionWaiters.push((conn) => {
        if (timer) clearTimeout(timer);
        resolve(conn);
      });
    });
  }

  /** Wait for the next protocol message from the client */
  await_next_message_from_client(timeout?: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => reject(new Error('Timeout waiting for client message')), timeout) : null;
      this._messageWaiters.push((msg) => {
        if (timer) clearTimeout(timer);
        resolve(msg);
      });
    });
  }

  /** Wait for the client to close the WebSocket */
  await_client_close(timeout?: number): Promise<{ code?: number; reason?: string }> {
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => reject(new Error('Timeout waiting for client close')), timeout) : null;
      this._closeWaiters.push((ev) => {
        if (timer) clearTimeout(timer);
        resolve(ev);
      });
    });
  }

  /** Send a protocol message on the active connection */
  send_to_client(msg: any): void {
    if (!this.active_connection) {
      throw new Error('No active connection');
    }
    this.active_connection.send_to_client(msg);
  }

  /** Clear all state */
  reset(): void {
    this.connect_attempts = [];
    this.active_connection = null;
    this._connectionWaiters = [];
    this._messageWaiters = [];
    this._closeWaiters = [];
  }
}

export { MockWebSocket, PendingWSConnection, MockWSInstance, DEFAULT_CONNECTED };
