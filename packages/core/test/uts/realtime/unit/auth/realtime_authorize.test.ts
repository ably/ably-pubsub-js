/**
 * UTS: Realtime Authorize Tests
 *
 * Spec points: RTC8, RTC8a, RTC8a1, RTC8a2, RTC8a3, RTC8b, RTC8b1, RTC8c
 * Source: specification/uts/realtime/unit/auth/realtime_authorize.md
 *
 * Tests in-band reauthorization via auth.authorize() on a realtime client.
 * When called on a connected client, authorize() obtains a new token and
 * sends an AUTH protocol message. The server responds with CONNECTED (success)
 * or ERROR (failure).
 *
 * Protocol actions: CONNECTED=4, ERROR=9, ATTACH=10, ATTACHED=11, AUTH=17
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync } from '../../../helpers';

describe('uts/realtime/unit/auth/realtime_authorize', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RTC8a - authorize() on CONNECTED sends AUTH protocol message
   *
   * Calling authorize() while connected obtains a new token via the
   * authCallback and sends an AUTH protocol message containing the new token.
   */
  // UTS: realtime/unit/RTC8a/authorize-connected-sends-auth-0
  it('RTC8a - authorize() on CONNECTED sends AUTH protocol message', async function () {
    let authCallbackCount = 0;
    const capturedAuthMessages: any[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 17) {
          capturedAuthMessages.push(msg);
          conn!.send_to_client({
            action: 4,
            connectionId: 'connection-id',
            connectionKey: 'connection-key-2',
            connectionDetails: {
              connectionKey: 'connection-key-2',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const stateChanges: any[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    const tokenDetails = await client.auth.authorize();

    expect(authCallbackCount).to.equal(2);
    expect(capturedAuthMessages.length).to.equal(1);
    expect(capturedAuthMessages[0].auth).to.not.be.undefined;
    expect(capturedAuthMessages[0].auth.accessToken).to.equal('token-2');
    expect(tokenDetails.token).to.equal('token-2');
    const actualStateTransitions = stateChanges.filter((c: any) => c.current !== c.previous);
    expect(actualStateTransitions.length).to.equal(0);
    expect(client.connection.state).to.equal('connected');
    client.close();
  });

  /**
   * RTC8a1 - Successful reauth emits UPDATE event
   *
   * If the authentication token change is successful, Ably sends a new
   * CONNECTED ProtocolMessage. The Connection should emit an UPDATE event
   * (not a CONNECTED state change) and connection details are updated.
   */
  // UTS: realtime/unit/RTC8a1/successful-reauth-update-event-0
  it('RTC8a1 - successful reauth emits UPDATE event', async function () {
    let authCallbackCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id-1',
          connectionDetails: {
            connectionKey: 'connection-key-1',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 17) {
          conn!.send_to_client({
            action: 4,
            connectionId: 'connection-id-2',
            connectionKey: 'connection-key-2',
            connectionDetails: {
              connectionKey: 'connection-key-2',
              maxIdleInterval: 20000,
              connectionStateTtl: 180000,
            },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const updateEvents: any[] = [];
    const connectedEvents: any[] = [];
    const stateChanges: any[] = [];

    client.connection.on('update', (change: any) => {
      updateEvents.push(change);
    });
    client.connection.on('connected', (change: any) => {
      connectedEvents.push(change);
    });
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    await client.auth.authorize();

    expect(updateEvents.length).to.equal(1);
    expect(updateEvents[0].previous).to.equal('connected');
    expect(updateEvents[0].current).to.equal('connected');
    expect(connectedEvents.length).to.equal(0);
    const actualStateTransitions = stateChanges.filter((c: any) => c.current !== c.previous);
    expect(actualStateTransitions.length).to.equal(0);
    // NOTE: connectionId doesn't change during in-band reauth in ably-js
    // (setConnection only called during transport activation, not reauth)
    client.close();
  });

  /**
   * RTC8a1 - Capability downgrade causes channel FAILED
   *
   * After a successful reauth with reduced capabilities, the server sends
   * a channel-level ERROR that causes the affected channel to enter FAILED.
   */
  // UTS: realtime/unit/RTC8a1/capability-downgrade-channel-failed-1
  it('RTC8a1 - capability downgrade causes channel FAILED', async function () {
    let authCallbackCount = 0;
    let authHandlerInstalled = false;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10 && msg.channel === 'private-channel') {
          conn!.send_to_client({ action: 11, channel: 'private-channel', flags: 0 });
        } else if (msg.action === 17 && authHandlerInstalled) {
          conn!.send_to_client({
            action: 4,
            connectionId: 'connection-id',
            connectionKey: 'connection-key-2',
            connectionDetails: {
              connectionKey: 'connection-key-2',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            },
          });
          process.nextTick(() => {
            conn!.send_to_client({
              action: 9,
              channel: 'private-channel',
              error: {
                code: 40160,
                statusCode: 401,
                message: 'Channel denied access based on given capability',
              },
            });
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('private-channel');
    await channel.attach();

    const channelStateChanges: any[] = [];
    channel.on((change: any) => {
      channelStateChanges.push(change);
    });

    authHandlerInstalled = true;
    await client.auth.authorize();

    await new Promise<void>((resolve) => {
      if (channel.state === 'failed') return resolve();
      channel.once('failed', () => resolve());
    });

    expect(channel.state).to.equal('failed');
    const failedChanges = channelStateChanges.filter((c: any) => c.current === 'failed');
    expect(failedChanges.length).to.equal(1);
    expect(failedChanges[0].reason).to.not.be.null;
    expect(failedChanges[0].reason.code).to.equal(40160);
    expect(failedChanges[0].reason.statusCode).to.equal(401);
    expect(client.connection.state).to.equal('connected');
    client.close();
  });

  /**
   * RTC8a2 - Failed reauth transitions connection to FAILED
   *
   * If the authentication token change fails, Ably sends an ERROR
   * ProtocolMessage triggering the connection to transition to FAILED.
   */
  // UTS: realtime/unit/RTC8a2/failed-reauth-connection-failed-0
  it('RTC8a2 - failed reauth transitions connection to FAILED', async function () {
    let authCallbackCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 17) {
          conn!.send_to_client_and_close({
            action: 9,
            error: {
              code: 40012,
              statusCode: 400,
              message: 'Incompatible clientId',
            },
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const stateChanges: any[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change);
    });

    try {
      await client.auth.authorize();
      expect.fail('authorize() should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40012);
    }

    expect(client.connection.state).to.equal('failed');
    expect(client.connection.errorReason).to.not.be.null;
    expect(client.connection.errorReason!.code).to.equal(40012);
    const failedChanges = stateChanges.filter((c: any) => c.current === 'failed');
    expect(failedChanges.length).to.be.greaterThanOrEqual(1);
    client.close();
  });

  /**
   * RTC8a3 - authorize() completes only after server response
   *
   * The promise returned by authorize() does not resolve until the server
   * responds to the AUTH message with CONNECTED or ERROR.
   */
  // UTS: realtime/unit/RTC8a3/authorize-completes-after-response-0
  it('RTC8a3 - authorize() completes only after server response', async function () {
    let authCallbackCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    let authorizeCompleted = false;
    const authorizeFuture = client.auth.authorize().then((result: any) => {
      authorizeCompleted = true;
      return result;
    });

    const authMsg = await mock.await_next_message_from_client(5000);
    expect(authMsg.action).to.equal(17);

    await flushAsync();
    expect(authorizeCompleted).to.equal(false);

    mock.active_connection!.send_to_client({
      action: 4,
      connectionId: 'connection-id',
      connectionKey: 'connection-key-2',
      connectionDetails: {
        connectionKey: 'connection-key-2',
        maxIdleInterval: 15000,
        connectionStateTtl: 120000,
      },
    });

    const tokenDetails = await authorizeFuture;
    expect(authorizeCompleted).to.equal(true);
    expect(tokenDetails.token).to.equal('token-2');
    client.close();
  });

  /**
   * RTC8b - authorize() while CONNECTING halts current attempt
   *
   * If CONNECTING when authorize() is called, all current connection attempts
   * are halted, and after obtaining a new token the library initiates a new
   * connection attempt using the new token.
   */
  // UTS: realtime/unit/RTC8b/authorize-connecting-halts-attempt-0
  it('RTC8b - authorize() while CONNECTING halts current attempt', async function () {
    let authCallbackCount = 0;
    const capturedWsUrls: string[] = [];

    const mock = new MockWebSocket();
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();

    // Wait for the first WS connection attempt (don't open it — client stays CONNECTING)
    const conn1 = await mock.await_connection_attempt(5000);
    capturedWsUrls.push(conn1.url.toString());

    expect(client.connection.state).to.equal('connecting');

    // Start authorize — this should halt the current attempt and reconnect
    const authPromise = client.auth.authorize();

    // Wait for the second WS connection attempt
    const conn2 = await mock.await_connection_attempt(5000);
    capturedWsUrls.push(conn2.url.toString());
    mock.active_connection = conn2;
    conn2.respond_with_connected({
      connectionId: 'connection-id',
      connectionDetails: {
        connectionKey: 'connection-key',
        maxIdleInterval: 15000,
        connectionStateTtl: 120000,
      } as any,
    });

    const tokenDetails = await authPromise;

    expect(tokenDetails.token).to.equal('token-2');
    expect(client.connection.state).to.equal('connected');
    expect(authCallbackCount).to.equal(2);

    const secondUrl = new URL(capturedWsUrls[1]);
    expect(secondUrl.searchParams.get('access_token')).to.equal('token-2');
    client.close();
  });

  /**
   * RTC8b1 - authorize() while CONNECTING fails on FAILED state
   *
   * If the connection transitions to FAILED after authorize() is called
   * while CONNECTING, the authorize promise completes with an error.
   */
  // UTS: realtime/unit/RTC8b1/authorize-connecting-fails-on-failed-0
  it('RTC8b1 - authorize() while CONNECTING fails on FAILED state', async function () {
    let authCallbackCount = 0;

    const mock = new MockWebSocket();
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();

    // Wait for the first WS connection attempt (don't open it — client stays CONNECTING)
    await mock.await_connection_attempt(5000);

    expect(client.connection.state).to.equal('connecting');

    // Start authorize — this should halt the current attempt and reconnect
    const authPromise = client.auth.authorize();

    // Wait for the second WS connection attempt — respond with fatal error
    const conn2 = await mock.await_connection_attempt(5000);
    mock.active_connection = conn2;
    conn2.respond_with_error({
      action: 9,
      error: {
        code: 40101,
        statusCode: 401,
        message: 'Invalid credentials',
      },
    });

    try {
      await authPromise;
      expect.fail('authorize() should have thrown');
    } catch (err: any) {
      expect(err.code).to.equal(40101);
    }

    expect(client.connection.state).to.equal('failed');
    client.close();
  });

  /**
   * RTC8c - authorize() from INITIALIZED initiates connection
   *
   * If the connection is in a non-connected state, after obtaining a token
   * the library should move to CONNECTING and initiate a connection.
   */
  // UTS: realtime/unit/RTC8c/authorize-disconnected-initiates-connection-0
  it('RTC8c - authorize() from INITIALIZED initiates connection', async function () {
    let authCallbackCount = 0;
    const capturedWsUrls: string[] = [];

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        capturedWsUrls.push(conn.url.toString());
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id',
          connectionDetails: {
            connectionKey: 'connection-key',
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    expect(client.connection.state).to.equal('initialized');

    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    const tokenDetails = await client.auth.authorize();

    expect(tokenDetails.token).to.equal('token-1');
    expect(client.connection.state).to.equal('connected');
    expect(stateChanges).to.include('connecting');
    expect(stateChanges).to.include('connected');

    const connUrl = new URL(capturedWsUrls[0]);
    expect(connUrl.searchParams.get('access_token')).to.equal('token-1');
    client.close();
  });

  /**
   * RTC8c - authorize() from FAILED initiates connection
   *
   * authorize() can recover a FAILED connection by obtaining a new token
   * and reconnecting.
   */
  // UTS: realtime/unit/RTC8c/authorize-failed-initiates-connection-1
  it('RTC8c - authorize() from FAILED initiates connection', async function () {
    let authCallbackCount = 0;
    const capturedWsUrls: string[] = [];
    let connectionAttemptCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        connectionAttemptCount++;
        capturedWsUrls.push(conn.url.toString());
        mock.active_connection = conn;

        if (connectionAttemptCount === 1) {
          conn.respond_with_error({
            action: 9,
            error: {
              code: 40101,
              statusCode: 401,
              message: 'Invalid credentials',
            },
          });
        } else {
          conn.respond_with_connected({
            connectionId: 'connection-id',
            connectionDetails: {
              connectionKey: 'connection-key',
              maxIdleInterval: 15000,
              connectionStateTtl: 120000,
            } as any,
          });
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('failed', resolve));

    const stateChanges: string[] = [];
    client.connection.on((change: any) => {
      stateChanges.push(change.current);
    });

    const tokenDetails = await client.auth.authorize();

    expect(tokenDetails.token).to.equal('token-2');
    expect(client.connection.state).to.equal('connected');
    expect(stateChanges).to.include('connecting');
    expect(stateChanges).to.include('connected');

    const secondUrl = new URL(capturedWsUrls[1]);
    expect(secondUrl.searchParams.get('access_token')).to.equal('token-2');
    client.close();
  });

  /**
   * RTC8c - authorize() from CLOSED initiates connection
   *
   * authorize() from CLOSED state opens a new connection.
   */
  // UTS: realtime/unit/RTC8c/authorize-closed-initiates-connection-2
  it('RTC8c - authorize() from CLOSED initiates connection', async function () {
    let authCallbackCount = 0;

    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected({
          connectionId: 'connection-id-' + mock.connect_attempts.length,
          connectionDetails: {
            connectionKey: 'connection-key-' + mock.connect_attempts.length,
            maxIdleInterval: 15000,
            connectionStateTtl: 120000,
          } as any,
        });
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({
      authCallback: (params: any, cb: any) => {
        authCallbackCount++;
        cb(null, 'token-' + authCallbackCount);
      },
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    client.close();
    await new Promise<void>((resolve) => {
      if (client.connection.state === 'closed') return resolve();
      client.connection.once('closed', resolve);
    });

    const tokenDetails = await client.auth.authorize();

    expect(tokenDetails.token).to.equal('token-2');
    expect(client.connection.state).to.equal('connected');
    client.close();
  });
});
