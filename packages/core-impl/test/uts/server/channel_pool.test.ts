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
import { createRealtimeChannelPool } from '../../../../server/src/index';
import { RealtimeChannelPool } from '../../../../server/src/channel-pool';

const MESSAGE = 15;
const ACK = 1;
const ERROR = 9;
const ATTACH = 10;
const ANNOTATION = 21;

interface Sent {
  client: number;
  msg: any;
}

interface Harness {
  pool: RealtimeChannelPool;
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
}

const fatalError = { code: 40101, statusCode: 401, message: 'Invalid credentials' };

function clientIndex(conn: PendingWSConnection): number {
  return Number(conn.url.searchParams.get('poolClient'));
}

function setup(options: { size?: number; failedRetryTimeout?: number } = {}): Harness {
  const pendingAcks: (() => void)[] = [];
  const harness: Harness = {
    pool: null as unknown as RealtimeChannelPool,
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
  };

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

  harness.pool = new RealtimeChannelPool(() => {
    const client = new Ably.Realtime({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      logLevel: 0,
      transportParams: { poolClient: harness.clients.length },
    });
    trackClient(client);
    harness.clients.push(client);
    return client as any;
  }, options);
  return harness;
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
          new RealtimeChannelPool(() => null as any, options);
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
  });
});
