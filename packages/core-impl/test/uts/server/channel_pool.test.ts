/**
 * Tests for the realtime channel pool of `@ably/pubsub-server`: how it opens and closes its
 * clients, which client a channel name resolves to, and the lifetime of the handles it returns.
 *
 * The pool is built from source with a client factory that tags each client's connection URL with
 * its index, so that the mock WebSocket can tell which client made each connection attempt and sent
 * each message.
 */

import { expect } from 'chai';
import { MockWebSocket, PendingWSConnection } from '../mock_websocket';
import { Ably, installMockWebSocket, restoreAll, trackClient, flushAsync, pollUntil } from '../helpers';
import { createRealtimeChannelPool, createRealtimeClient } from '../../../../server/src/index';
import { DefaultRealtimeChannelPool, poolClientLogContext } from '../../../../server/src/channel-pool';
import { createLogger, Logger } from '../../../side/logger';

const MESSAGE = 15;
const ACK = 1;
const ERROR = 9;
const ATTACH = 10;
const ANNOTATION = 21;

interface Sent {
  client: number;
  msg: any;
}

interface Log {
  msg: string;
  level: number;
}

interface Harness {
  pool: DefaultRealtimeChannelPool;
  clients: any[];
  /** The latest connection attempt of each client. */
  connections: Map<number, PendingWSConnection>;
  attempts: number[];
  sent: Sent[];
  /** Clients whose connection attempts are refused. */
  refuse: Set<number>;
  /** Clients whose connection attempts are answered with a fatal error. */
  reject: Set<number>;
  /** While true, publishes are not acknowledged until `releaseAcks()` is called. */
  holdAcks: boolean;
  releaseAcks(): void;
  /** The client that sent the published messages on a channel. */
  clientsFor(channel: string): number[];
  /** The lines logged by the pool and its clients, at the `logLevel` passed to `setup()`. */
  logs: Log[];
  /** The lines the pool logged itself. */
  poolLogs(): Log[];
}

const fatalError = { code: 40101, statusCode: 401, message: 'Invalid credentials' };

function clientIndex(conn: PendingWSConnection): number {
  return Number(conn.url.searchParams.get('poolClient'));
}

function setup(options: { size?: number; failedRetryTimeout?: number; logLevel?: number } = {}): Harness {
  const { logLevel = 0, ...poolOptions } = options;
  const pendingAcks: (() => void)[] = [];
  const harness: Harness = {
    pool: null as unknown as DefaultRealtimeChannelPool,
    clients: [],
    connections: new Map(),
    attempts: [],
    sent: [],
    refuse: new Set(),
    reject: new Set(),
    holdAcks: false,
    releaseAcks() {
      pendingAcks.splice(0).forEach((ack) => ack());
    },
    clientsFor(channel) {
      return harness.sent.filter((s) => s.msg.action === MESSAGE && s.msg.channel === channel).map((s) => s.client);
    },
    logs: [],
    poolLogs() {
      return harness.logs.filter((log) => log.msg.includes('RealtimeChannelPool'));
    },
  };
  const logHandler = (msg: string, level: number) => harness.logs.push({ msg, level });

  const mock = new MockWebSocket({
    onConnectionAttempt: (conn) => {
      const index = clientIndex(conn);
      harness.attempts.push(index);
      harness.connections.set(index, conn);
      if (harness.reject.has(index)) {
        conn.respond_with_error({ action: ERROR, error: fatalError });
      } else if (harness.refuse.has(index)) {
        conn.respond_with_refused();
      } else {
        conn.respond_with_connected({
          connectionId: `connection-${index}`,
          connectionDetails: { connectionKey: `key-${index}` },
        });
      }
    },
    onMessageFromClient: (msg, conn) => {
      const client = clientIndex(conn!);
      harness.sent.push({ client, msg });
      if (msg.action === MESSAGE || msg.action === ANNOTATION) {
        const ack = () =>
          conn!.send_to_client({
            action: ACK,
            msgSerial: msg.msgSerial,
            count: 1,
            res: [
              { serials: (msg.messages ?? msg.annotations).map((_: unknown, i: number) => `serial-${client}-${i}`) },
            ],
          });
        if (harness.holdAcks) {
          pendingAcks.push(ack);
        } else {
          ack();
        }
      }
    },
  });
  installMockWebSocket(mock.constructorFn);

  harness.pool = new DefaultRealtimeChannelPool(
    (index) => {
      const client = new Ably.Realtime({
        key: 'appId.keyId:keySecret',
        useBinaryProtocol: false,
        logLevel,
        logHandler,
        logContext: poolClientLogContext(index),
        transportParams: { poolClient: index },
      } as any);
      trackClient(client);
      harness.clients.push(client);
      return client as any;
    },
    poolOptions,
    { logLevel, logHandler },
  );
  return harness;
}

/** Fails the connection of a client whose attempts are rejected with the fatal error. */
async function failClient(harness: Harness, index: number): Promise<void> {
  harness.reject.add(index);
  harness.connections.get(index)!.send_to_client_and_close({ action: ERROR, error: fatalError });
  await pollUntil(() => harness.clients[index].connection.state === 'failed');
}

function attemptsOf(harness: Harness, index: number): number {
  return harness.attempts.filter((i) => i === index).length;
}

async function expectRejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  expect.fail('Expected the promise to reject');
}

describe('uts/server/channel_pool', function () {
  afterEach(function () {
    restoreAll();
  });

  describe('options', function () {
    it('defaults to 4 clients', async function () {
      const { pool, clients } = setup();
      await pool.open();
      expect(clients).to.have.length(4);
    });

    it('rejects an invalid size or failedRetryTimeout with 40003', function () {
      for (const options of [{ size: 0 }, { size: 1.5 }, { failedRetryTimeout: -1 }, { failedRetryTimeout: NaN }]) {
        let err: any;
        try {
          new DefaultRealtimeChannelPool(() => null as any, options);
        } catch (e) {
          err = e;
        }
        expect(err?.code, JSON.stringify(options)).to.equal(40003);
      }
    });
  });

  describe('open', function () {
    it('creates and connects every client, and resolves once they are connected', async function () {
      const { pool, clients } = setup({ size: 3 });
      await pool.open();
      expect(clients.map((c) => c.connection.state)).to.deep.equal(['connected', 'connected', 'connected']);
    });

    it('returns the same promise from a second call', async function () {
      const { pool, clients } = setup({ size: 2 });
      const first = pool.open();
      expect(pool.open()).to.equal(first);
      await first;
      expect(clients).to.have.length(2);
    });

    it('resolves when a client cannot connect yet, which keeps retrying', async function () {
      const harness = setup({ size: 2 });
      harness.refuse.add(1);
      await harness.pool.open();
      expect(harness.clients[0].connection.state).to.equal('connected');
      expect(harness.clients[1].connection.state).to.equal('disconnected');
    });

    it('rejects with the reason a client failed, and closes the pool', async function () {
      const harness = setup({ size: 2 });
      harness.reject.add(1);
      const err = await expectRejection(harness.pool.open());
      expect(err.code).to.equal(40101);
      expect(harness.clients[0].connection.state).to.equal('closed');
      expect((await expectRejection(harness.pool.get('chat').publish('e', 'd'))).code).to.equal(80017);
    });
  });

  describe('get', function () {
    it('is bound to the pool', async function () {
      const { pool, clientsFor } = setup({ size: 1 });
      await pool.open();
      const { get } = pool;
      await get('chat').publish('e', 'd');
      expect(clientsFor('chat')).to.deep.equal([0]);
    });

    it('publishes without attaching, and returns the publish result', async function () {
      const { pool, sent } = setup({ size: 1 });
      await pool.open();
      const channel = pool.get('chat');

      const result = await channel.publish('greeting', 'hello');

      expect(channel.name).to.equal('chat');
      expect(result.serials).to.deep.equal(['serial-0-0']);
      expect(sent.map((s) => s.msg.action)).to.deep.equal([MESSAGE]);
      expect(sent[0].msg.messages[0]).to.include({ name: 'greeting', data: 'hello' });
      expect(sent.some((s) => s.msg.action === ATTACH)).to.equal(false);
    });

    it('passes every operation to the channel', async function () {
      const { pool, sent } = setup({ size: 1 });
      await pool.open();
      const channel = pool.get('chat');

      await channel.publish([{ name: 'a' }, { name: 'b' }]);
      await channel.publish({ name: 'c' });
      await channel.updateMessage({ serial: 's1', data: 'edited' } as any);
      await channel.appendMessage({ serial: 's1', data: ' more' } as any);
      await channel.deleteMessage({ serial: 's1' } as any);
      await channel.annotations.publish('s1', { type: 'reaction:distinct.v1', name: 'like' });
      await channel.annotations.delete('s1', { type: 'reaction:distinct.v1', name: 'like' });

      expect(sent.map((s) => s.msg.action)).to.deep.equal([
        MESSAGE,
        MESSAGE,
        MESSAGE,
        MESSAGE,
        MESSAGE,
        ANNOTATION,
        ANNOTATION,
      ]);
      expect(sent[0].msg.messages.map((m: any) => m.name)).to.deep.equal(['a', 'b']);
      expect(sent.slice(2, 5).map((s) => s.msg.messages[0].action)).to.deep.equal([1, 5, 2]);
    });
  });

  describe('client selection', function () {
    it('sends every handle on a name through one client', async function () {
      const { pool, clientsFor } = setup({ size: 4 });
      await pool.open();

      const first = pool.get('chat');
      const second = pool.get('chat');
      await first.publish('e', '1');
      await second.publish('e', '2');
      await first.publish('e', '3');

      expect(new Set(clientsFor('chat')).size).to.equal(1);
    });

    it('binds each new name to the client with the fewest names', async function () {
      const { pool, clientsFor } = setup({ size: 3 });
      await pool.open();

      const names = ['a', 'b', 'c', 'd', 'e', 'f'];
      const handles = names.map((name) => pool.get(name));
      for (const handle of handles) {
        await handle.publish('e', 'd');
      }

      const counts = [0, 0, 0];
      for (const name of names) {
        counts[clientsFor(name)[0]]++;
      }
      expect(counts).to.deep.equal([2, 2, 2]);
    });

    it('frees a client for new names once its names are released', async function () {
      const { pool, clientsFor } = setup({ size: 2 });
      await pool.open();

      const a = pool.get('a');
      const b = pool.get('b');
      await a.publish('e', 'd');
      await b.publish('e', 'd');
      a.release();

      const c = pool.get('c');
      await c.publish('e', 'd');

      expect(clientsFor('c')).to.deep.equal(clientsFor('a'));
    });

    it('binds a name to a connected client while there is one', async function () {
      const harness = setup({ size: 2 });
      await harness.pool.open();
      const channel = harness.pool.get('chat');

      harness.refuse.add(0);
      harness.connections.get(0)!.simulate_disconnect();
      await pollUntil(() => harness.clients[0].connection.state === 'disconnected');
      await channel.publish('e', 'd');

      expect(harness.clientsFor('chat')).to.deep.equal([1]);
    });

    it('moves a name to a connected client when its client is not connected', async function () {
      const harness = setup({ size: 2 });
      await harness.pool.open();
      const channel = harness.pool.get('chat');
      await channel.publish('e', '1');
      const [bound] = harness.clientsFor('chat');
      const other = 1 - bound;

      harness.refuse.add(bound);
      harness.connections.get(bound)!.simulate_disconnect();
      await pollUntil(() => harness.clients[bound].connection.state === 'disconnected');
      await channel.publish('e', '2');

      expect(harness.clientsFor('chat')).to.deep.equal([bound, other]);
      // The name's channel object is released from the client it moved off.
      expect(harness.clients[bound].channels.all).to.not.have.property('chat');
    });

    it('keeps a name on its client, and queues the operation, when no client is connected', async function () {
      const harness = setup({ size: 2 });
      await harness.pool.open();
      const channel = harness.pool.get('chat');
      await channel.publish('e', '1');
      const [bound] = harness.clientsFor('chat');

      harness.refuse.add(0);
      harness.refuse.add(1);
      harness.connections.get(0)!.simulate_disconnect();
      harness.connections.get(1)!.simulate_disconnect();
      await pollUntil(() => harness.clients.every((c) => c.connection.state === 'disconnected'));

      const published = channel.publish('e', '2');
      await flushAsync();
      expect(harness.clientsFor('chat')).to.deep.equal([bound]);

      harness.refuse.clear();
      harness.clients[bound].connection.connect();
      await published;

      expect(harness.clientsFor('chat')).to.deep.equal([bound, bound]);
    });

    it("rejects an operation with the client's errorReason when its connection is failed", async function () {
      const harness = setup({ size: 1, failedRetryTimeout: 60000 });
      await harness.pool.open();
      harness.reject.add(0);
      harness.connections.get(0)!.send_to_client_and_close({ action: ERROR, error: fatalError });
      await pollUntil(() => harness.clients[0].connection.state === 'failed');

      const err = await expectRejection(harness.pool.get('chat').publish('e', 'd'));

      expect(err.code).to.equal(40101);
    });
  });

  describe('failed clients', function () {
    it('reconnects a failed client after failedRetryTimeout', async function () {
      const harness = setup({ size: 2, failedRetryTimeout: 50 });
      await harness.pool.open();
      harness.reject.add(1);
      harness.connections.get(1)!.send_to_client_and_close({ action: ERROR, error: fatalError });
      await pollUntil(() => harness.clients[1].connection.state === 'failed');
      const attemptsWhenFailed = harness.attempts.filter((i) => i === 1).length;

      // Fails again on the first retry, and is retried again.
      await pollUntil(() => harness.attempts.filter((i) => i === 1).length === attemptsWhenFailed + 1);
      await pollUntil(() => harness.clients[1].connection.state === 'failed');
      harness.reject.clear();
      await pollUntil(() => harness.clients[1].connection.state === 'connected');
    });

    it('stops reconnecting once the pool is closed', async function () {
      const harness = setup({ size: 1, failedRetryTimeout: 30 });
      await harness.pool.open();
      harness.reject.add(0);
      harness.connections.get(0)!.send_to_client_and_close({ action: ERROR, error: fatalError });
      await pollUntil(() => harness.clients[0].connection.state === 'failed');
      const attempts = harness.attempts.length;

      await harness.pool.close();
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(harness.attempts.length).to.equal(attempts);
    });
  });

  describe('handles', function () {
    it('rejects an operation on a released handle with 40000', async function () {
      const { pool } = setup({ size: 1 });
      await pool.open();
      const channel = pool.get('chat');
      channel.release();

      const err = await expectRejection(channel.publish('e', 'd'));

      expect(err.code).to.equal(40000);
      expect(err.message).to.contain('released');
    });

    it('counts a second release of a handle once', async function () {
      const { pool, clients, clientsFor } = setup({ size: 2 });
      await pool.open();
      const held = pool.get('chat');
      const released = pool.get('chat');
      await held.publish('e', '1');
      const [bound] = clientsFor('chat');

      released.release();
      released.release();

      expect(clients[bound].channels.all).to.have.property('chat');
      held.release();
      expect(clients[bound].channels.all).to.not.have.property('chat');
    });

    it('releases the handle on Symbol.dispose', async function () {
      const { pool } = setup({ size: 1 });
      await pool.open();
      const channel = pool.get('chat');
      channel[Symbol.dispose]();

      expect((await expectRejection(channel.publish('e', 'd'))).code).to.equal(40000);
    });

    it('releases the channel object from its client once every handle is released', async function () {
      const { pool, clients } = setup({ size: 1 });
      await pool.open();
      const first = pool.get('chat');
      const second = pool.get('chat');
      await first.publish('e', 'd');
      expect(clients[0].channels.all).to.have.property('chat');

      first.release();
      expect(clients[0].channels.all).to.have.property('chat');
      second.release();
      expect(clients[0].channels.all).to.not.have.property('chat');
    });

    it('keeps a name bound while an operation on it is in flight after its handles are released', async function () {
      const harness = setup({ size: 2 });
      await harness.pool.open();
      harness.holdAcks = true;
      const first = harness.pool.get('chat');
      const published = first.publish('e', '1');
      await flushAsync();
      const [bound] = harness.clientsFor('chat');
      first.release();

      expect(harness.clients[bound].channels.all).to.have.property('chat');
      const second = harness.pool.get('chat');
      const republished = second.publish('e', '2');
      await flushAsync();
      harness.releaseAcks();
      await Promise.all([published, republished]);
      expect(harness.clientsFor('chat')).to.deep.equal([bound, bound]);

      second.release();
      expect(harness.clients[bound].channels.all).to.not.have.property('chat');
    });
  });

  describe('close', function () {
    it('rejects operations before open with 40000', async function () {
      const { pool } = setup({ size: 1 });

      const err = await expectRejection(pool.get('chat').publish('e', 'd'));

      expect(err.code).to.equal(40000);
      expect(err.message).to.contain('not open');
    });

    it('waits for operations in flight, then closes every client', async function () {
      const harness = setup({ size: 2 });
      await harness.pool.open();
      harness.holdAcks = true;
      const published = harness.pool.get('chat').publish('e', 'd');
      await flushAsync();

      let closed = false;
      const closing = harness.pool.close().then(() => (closed = true));
      await flushAsync();
      expect(closed).to.equal(false);
      expect(harness.clients.map((c) => c.connection.state)).to.deep.equal(['connected', 'connected']);

      harness.releaseAcks();
      await published;
      await closing;
      expect(harness.clients.map((c) => c.connection.state)).to.deep.equal(['closed', 'closed']);
    });

    it('rejects operations once close has been called with 80017', async function () {
      const { pool } = setup({ size: 1 });
      await pool.open();
      const channel = pool.get('chat');
      const closing = pool.close();

      const err = await expectRejection(channel.publish('e', 'd'));
      await closing;

      expect(err.code).to.equal(80017);
    });

    it('returns the same promise from a second call', async function () {
      const { pool } = setup({ size: 1 });
      await pool.open();
      const first = pool.close();
      expect(pool.close()).to.equal(first);
      await first;
    });

    it('cannot be reopened', async function () {
      const { pool } = setup({ size: 1 });
      await pool.close();

      expect((await expectRejection(pool.open())).code).to.equal(80017);
    });
  });

  describe('logging', function () {
    it('formats a line with its context after the Ably: prefix, and without one when none is set', function () {
      const logs: Log[] = [];
      const logHandler = (msg: string, level: number) => logs.push({ msg, level });

      Logger.logAction(createLogger({ logLevel: 2, logHandler }), Logger.LOG_MAJOR, 'Action', 'message');
      Logger.logAction(
        createLogger({ logLevel: 2, logHandler }, 'pool client 3'),
        Logger.LOG_MAJOR,
        'Action',
        'message',
      );
      Logger.logAction(
        createLogger({ logLevel: 2, logHandler }, 'pool client 3'),
        Logger.LOG_MINOR,
        'Action',
        'message',
      );

      expect(logs).to.deep.equal([
        { msg: 'Ably: Action: message', level: 2 },
        { msg: 'Ably: [pool client 3] Action: message', level: 2 },
      ]);
    });

    it('logs the outcome of open once, with the state and reason code of each client not connected', async function () {
      const harness = setup({ size: 3, logLevel: 2 });
      harness.refuse.add(2);
      await harness.pool.open();

      expect(harness.poolLogs().filter((log) => log.msg.includes('RealtimeChannelPool.open()'))).to.deep.equal([
        {
          msg: 'Ably: RealtimeChannelPool.open(): opened; 2 of 3 clients connected; pool client 2 disconnected (80003)',
          level: 2,
        },
      ]);
    });

    it('logs that open failed because a client failed', async function () {
      const harness = setup({ size: 2, logLevel: 2 });
      harness.reject.add(1);
      await expectRejection(harness.pool.open());

      expect(harness.poolLogs().filter((log) => log.msg.includes('RealtimeChannelPool.open()'))).to.deep.equal([
        {
          msg: 'Ably: RealtimeChannelPool.open(): open failed, because a client failed, so the pool closes; 1 of 2 clients connected; pool client 1 failed (40101)',
          level: 2,
        },
      ]);
    });

    it('logs each reconnect it schedules for a failed client, each attempt, and the recovery', async function () {
      const harness = setup({ size: 2, failedRetryTimeout: 50, logLevel: 3 });
      await harness.pool.open();
      await failClient(harness, 1);
      const attemptsWhenFailed = attemptsOf(harness, 1);

      // Fails again on the first reconnect, and connects on the second.
      await pollUntil(() => attemptsOf(harness, 1) === attemptsWhenFailed + 1);
      await pollUntil(() => harness.clients[1].connection.state === 'failed');
      harness.reject.clear();
      await pollUntil(() => harness.clients[1].connection.state === 'connected');

      const lines = harness.poolLogs().filter((log) => log.msg.startsWith('Ably: [pool client 1] '));
      const scheduled = {
        msg: 'Ably: [pool client 1] RealtimeChannelPool: connection failed, so the pool reconnects it in 50 ms; last connectionId=connection-1; reason=40101: Invalid credentials',
        level: 2,
      };
      expect(lines.slice(0, 4)).to.deep.equal([
        scheduled,
        {
          msg: 'Ably: [pool client 1] RealtimeChannelPool: reconnecting; attempt 1 since the connection failed',
          level: 3,
        },
        scheduled,
        {
          msg: 'Ably: [pool client 1] RealtimeChannelPool: reconnecting; attempt 2 since the connection failed',
          level: 3,
        },
      ]);
      expect(lines[4].level).to.equal(2);
      expect(lines[4].msg).to.match(
        /^Ably: \[pool client 1\] RealtimeChannelPool: connection recovered; connectionId=connection-1; pool reconnects=2; failed for \d+ ms$/,
      );
      expect(lines).to.have.length(5);
    });

    it('logs a reconnect it skips because the client is no longer failed', async function () {
      const harness = setup({ size: 1, failedRetryTimeout: 50, logLevel: 4 });
      await harness.pool.open();
      await failClient(harness, 0);
      harness.reject.clear();
      harness.clients[0].connection.connect();
      await pollUntil(() => harness.clients[0].connection.state === 'connected');

      const skipped =
        'Ably: [pool client 0] RealtimeChannelPool: reconnect skipped; the pool is open and the connection is connected';
      await pollUntil(() => harness.poolLogs().some((log) => log.msg === skipped));
      expect(harness.poolLogs().find((log) => log.msg === skipped)!.level).to.equal(4);
      // The client connected without a pool reconnect, so no recovery is logged.
      expect(harness.poolLogs().some((log) => log.msg.includes('recovered'))).to.equal(false);
    });

    it('logs at error level when every client is suspended or failed, and when calls stop rejecting', async function () {
      const harness = setup({ size: 2, failedRetryTimeout: 60000, logLevel: 1 });
      await harness.pool.open();
      await failClient(harness, 0);
      expect(harness.poolLogs()).to.deep.equal([]);

      await failClient(harness, 1);
      const down = {
        msg: 'Ably: RealtimeChannelPool: every client is suspended or failed, so calls reject; pool client 0 failed (40101: Invalid credentials), pool client 1 failed (40101: Invalid credentials)',
        level: 1,
      };
      expect(harness.poolLogs()).to.deep.equal([down]);

      // An attempt that fails again does not end the condition, although it passes through connecting.
      const attempts = attemptsOf(harness, 0);
      harness.clients[0].connection.connect();
      await pollUntil(() => attemptsOf(harness, 0) === attempts + 1);
      await pollUntil(() => harness.clients[0].connection.state === 'failed');
      expect(harness.poolLogs()).to.deep.equal([down]);

      harness.reject.clear();
      harness.clients[1].connection.connect();
      await pollUntil(() => harness.clients[1].connection.state === 'connected');
      expect(harness.poolLogs()).to.deep.equal([
        down,
        { msg: 'Ably: RealtimeChannelPool: calls no longer reject, because pool client 1 is connected', level: 1 },
      ]);
    });

    it('logs when no client is connected, so calls queue, and when one connects, but not each call', async function () {
      const harness = setup({ size: 2, logLevel: 2 });
      await harness.pool.open();
      const before = harness.poolLogs().length;

      harness.refuse.add(0);
      harness.refuse.add(1);
      harness.connections.get(0)!.simulate_disconnect();
      harness.connections.get(1)!.simulate_disconnect();
      await pollUntil(() => harness.clients.every((c) => c.connection.state === 'disconnected'));
      const published = harness.pool.get('chat').publish('e', 'd');
      await flushAsync();

      expect(harness.poolLogs().slice(before)).to.deep.equal([
        {
          msg: 'Ably: RealtimeChannelPool: no client is connected, so calls queue until one connects, unless queueMessages is false; pool client 0 disconnected, pool client 1 disconnected',
          level: 2,
        },
      ]);

      harness.refuse.clear();
      harness.clients[0].connection.connect();
      await pollUntil(() => harness.clients[0].connection.state === 'connected');
      // The call is queued on whichever client the name was bound to.
      harness.clients[1].connection.connect();
      await published;

      expect(harness.poolLogs().slice(before + 1)).to.deep.equal([
        { msg: 'Ably: RealtimeChannelPool: calls no longer queue, because pool client 0 is connected', level: 2 },
      ]);
    });

    it('logs the first binding of a name at micro level, and a move to another client at minor level', async function () {
      const harness = setup({ size: 2, logLevel: 4 });
      await harness.pool.open();
      const channel = harness.pool.get('chat');
      await channel.publish('e', '1');
      const [bound] = harness.clientsFor('chat');
      const other = 1 - bound;

      harness.refuse.add(bound);
      harness.connections.get(bound)!.simulate_disconnect();
      await pollUntil(() => harness.clients[bound].connection.state === 'disconnected');
      await channel.publish('e', '2');
      await channel.publish('e', '3');

      const lines = harness.poolLogs().filter((log) => log.msg.includes('channel chat'));
      expect(lines.map((log) => log.level)).to.deep.equal([4, 3]);
      expect(lines[0].msg).to.equal(
        `Ably: [pool client ${bound}] RealtimeChannelPool: channel chat bound to this client`,
      );
      expect(lines[1].msg).to.match(
        new RegExp(
          `^Ably: \\[pool client ${bound}\\] RealtimeChannelPool: channel chat moved to pool client ${other}, because this client is (disconnected|connecting)$`,
        ),
      );
    });

    it('logs when close starts, with the operations in flight, and when it completes', async function () {
      const harness = setup({ size: 2, logLevel: 3 });
      await harness.pool.open();
      harness.holdAcks = true;
      const published = harness.pool.get('chat').publish('e', 'd');
      await flushAsync();
      const before = harness.poolLogs().length;

      const closing = harness.pool.close();
      harness.releaseAcks();
      await published;
      await closing;

      // The clients' closing is not taken for a loss of every connection.
      const lines = harness.poolLogs().slice(before);
      expect(lines).to.have.length(2);
      expect(lines[0]).to.deep.equal({
        msg: 'Ably: RealtimeChannelPool.close(): closing; operations in flight=1',
        level: 2,
      });
      expect(lines[1].level).to.equal(3);
      expect(lines[1].msg).to.match(/^Ably: RealtimeChannelPool\.close\(\): closed in \d+ ms$/);
    });

    it('logs a close while the pool is opening', async function () {
      const harness = setup({ size: 1, logLevel: 3 });
      const opening = harness.pool.open();
      await harness.pool.close();
      await expectRejection(opening);

      expect(harness.poolLogs().map((log) => log.msg)).to.include(
        'Ably: RealtimeChannelPool.open(): the pool was closed while it was opening, so open() rejects',
      );
    });

    it('logs no key, token or connection key in its own lines', async function () {
      const harness = setup({ size: 2, failedRetryTimeout: 20, logLevel: 4 });
      await harness.pool.open();
      const channel = harness.pool.get('chat');
      await channel.publish('e', '1');
      await failClient(harness, 0);
      await failClient(harness, 1);
      await pollUntil(() => harness.poolLogs().some((log) => log.msg.includes('attempt 1')));
      harness.reject.clear();
      await pollUntil(() => harness.clients.every((c) => c.connection.state === 'connected'));
      await channel.publish('e', '2');
      await harness.pool.close();

      const lines = harness.poolLogs();
      expect(lines.length).to.be.greaterThan(10);
      for (const { msg } of lines) {
        for (const secret of ['appId.keyId', 'keySecret', 'key-0', 'key-1']) {
          expect(msg).to.not.contain(secret);
        }
      }
    });
  });

  describe('createRealtimeChannelPool', function () {
    it('creates clients that declare the server side', async function () {
      const urls: URL[] = [];
      const mock = new MockWebSocket({
        onConnectionAttempt: (conn) => {
          urls.push(conn.url);
          conn.respond_with_connected();
        },
      });
      installMockWebSocket(mock.constructorFn);
      const pool = createRealtimeChannelPool({ key: 'appId.keyId:keySecret', useBinaryProtocol: false }, { size: 2 });

      await pool.open();
      await pool.close();

      expect(urls).to.have.length(2);
      for (const url of urls) {
        expect(url.searchParams.get('agent')).to.contain('ably-pubsub-server');
      }
    });

    it("tags each client's own lines with its index, and logs the pool's lines through the clients' logHandler", async function () {
      const mock = new MockWebSocket({ onConnectionAttempt: (conn) => conn.respond_with_connected() });
      installMockWebSocket(mock.constructorFn);
      const logs: Log[] = [];
      const options = {
        key: 'appId.keyId:keySecret',
        useBinaryProtocol: false,
        logLevel: 2,
        logHandler: (msg: string, level: number) => logs.push({ msg, level }),
      };
      const pool = createRealtimeChannelPool(options, { size: 2 });

      await pool.open();
      await pool.close();

      const lines = logs.map((log) => log.msg);
      expect(lines).to.include.members([
        'Ably: [pool client 0] Connection state: connected',
        'Ably: [pool client 1] Connection state: connected',
        'Ably: RealtimeChannelPool.open(): opened; 2 of 2 clients connected',
      ]);
      // The caller's options are not changed.
      expect(options).to.not.have.property('logContext');
    });

    it('leaves the lines of a client created outside a pool untagged', async function () {
      const mock = new MockWebSocket({ onConnectionAttempt: (conn) => conn.respond_with_connected() });
      installMockWebSocket(mock.constructorFn);
      const logs: string[] = [];
      const client = createRealtimeClient({
        key: 'appId.keyId:keySecret',
        useBinaryProtocol: false,
        logLevel: 4,
        logHandler: (msg: string) => logs.push(msg),
      });
      trackClient(client);

      await pollUntil(() => client.connection.state === 'connected');
      client.close();

      expect(logs).to.include('Ably: Connection state: connected');
      for (const msg of logs) {
        expect(msg.startsWith('Ably: ')).to.equal(true, msg);
        expect(msg.startsWith('Ably: [')).to.equal(false, msg);
      }
    });
  });
});
