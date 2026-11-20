/**
 * Tests for RealtimeChannel.newStream(), RealtimeChannel.adoptStream() and
 * MessageStream: sequence numbers on each write, pipelined writes, repairs
 * after a failed write, and how the stream ends.
 *
 * Source: AITDR-043 (Ably-js client api streaming primitive for sequence
 * numbers), against the server behaviour in AITDR-040.
 */

import { expect } from 'chai';
import { MockWebSocket } from '../../../mock_websocket';
import { MockHttpClient } from '../../../mock_http';
import {
  Ably,
  installMockWebSocket,
  installMockHttp,
  restoreAll,
  trackClient,
  flushAsync,
  pollUntil,
} from '../../../helpers';

const MESSAGE_SERIAL = 'msg-serial-1';

// wire action numbers
const CREATE = 0;
const UPDATE = 1;
const DELETE = 2;
const APPEND = 5;

function sequenceError(stored: number) {
  return {
    message: `message sequence does not follow the current sequence ${stored}`,
    code: 40901,
    statusCode: 409,
    detail: { sequence: String(stored) },
  };
}

describe('uts/realtime/unit/channels/message_stream', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * Connects a client to a mock server that ACKs each create with
   * MESSAGE_SERIAL, and leaves each mutation for the test to ACK or NACK.
   */
  async function setup(opts?: { createSerial?: string | null }) {
    const sent: any[] = [];
    const mock = new MockWebSocket({
      onConnectionAttempt: (conn) => {
        mock.active_connection = conn;
        conn.respond_with_connected();
      },
      onMessageFromClient: (msg, conn) => {
        if (msg.action === 10) {
          conn!.send_to_client({ action: 11, channel: msg.channel, flags: 0 });
        }
        if (msg.action === 15) {
          sent.push(msg);
          if (msg.messages[0].action === CREATE) {
            const serial = opts?.createSerial === undefined ? MESSAGE_SERIAL : opts.createSerial;
            conn!.send_to_client({ action: 1, msgSerial: msg.msgSerial, count: 1, res: [{ serials: [serial] }] });
          }
        }
      },
    });
    installMockWebSocket(mock.constructorFn);

    const client = new Ably.Realtime({ key: 'appId.keyId:keySecret', autoConnect: false, useBinaryProtocol: false });
    trackClient(client);
    client.connect();
    await new Promise<void>((resolve) => client.connection.once('connected', resolve));

    const channel = client.channels.get('test-message-stream', { attachOnSubscribe: false });
    await channel.attach();

    const mutations = () => sent.filter((m) => m.messages[0].action !== CREATE);
    const ack = (pm: any) =>
      mock.active_connection!.send_to_client({
        action: 1,
        msgSerial: pm.msgSerial,
        count: 1,
        res: [{ serials: ['version-' + pm.msgSerial] }],
      });
    const nack = (pm: any, error: any) =>
      mock.active_connection!.send_to_client({ action: 2, msgSerial: pm.msgSerial, count: 1, error });
    const waitForMutations = (count: number) => pollUntil(() => mutations().length >= count);

    return { client, channel, sent, mutations, ack, nack, waitForMutations };
  }

  it('newStream publishes the message and opens a stream on its serial', async function () {
    const { client, channel, sent } = await setup();

    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    expect(stream.serial).to.equal(MESSAGE_SERIAL);
    expect(sent.length).to.equal(1);
    expect(sent[0].messages[0].name).to.equal('ai');
    expect(sent[0].messages[0].data).to.equal('The');
    expect(sent[0].messages[0].version?.sequence).to.be.undefined;
    client.close();
  });

  it('newStream rejects when the publish returns no serial', async function () {
    const { client, channel } = await setup({ createSerial: null });

    try {
      await channel.newStream({ name: 'ai', data: 'The' });
      expect.fail('newStream should have rejected');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
    client.close();
  });

  it('sends appends without waiting for ACKs, numbered from 1', async function () {
    const { client, channel, mutations, ack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    expect(stream.append({ data: ' cat' })).to.be.undefined;
    stream.append({ data: ' sat' });
    stream.append({ data: ' down', extras: { headers: { status: 'done' } } });
    await waitForMutations(3);

    const wire = mutations().map((pm) => pm.messages[0]);
    expect(wire.map((m) => m.action)).to.deep.equal([APPEND, APPEND, APPEND]);
    expect(wire.map((m) => m.serial)).to.deep.equal([MESSAGE_SERIAL, MESSAGE_SERIAL, MESSAGE_SERIAL]);
    expect(wire.map((m) => m.data)).to.deep.equal([' cat', ' sat', ' down']);
    expect(wire.map((m) => m.version.sequence)).to.deep.equal([1, 2, 3]);

    let closed = false;
    const closing = stream.close().then((result: any) => {
      closed = true;
      return result;
    });
    ack(mutations()[0]);
    ack(mutations()[1]);
    await flushAsync();
    expect(closed).to.equal(false);

    ack(mutations()[2]);
    expect(await closing).to.deep.equal({ serial: MESSAGE_SERIAL });
    client.close();
  });

  it('passes the operation through with the sequence added', async function () {
    const { client, channel, mutations, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' }, { description: 'token', metadata: { k: 'v' } });
    await waitForMutations(1);

    expect(mutations()[0].messages[0].version).to.deep.equal({
      description: 'token',
      metadata: { k: 'v' },
      sequence: 1,
    });
    client.close();
  });

  it('repairs a failed append with one update holding the full content', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat', extras: { headers: { step: '1' } } });
    stream.append({ data: ' sat' });
    stream.append({ data: ' down' });
    await waitForMutations(3);
    const [first, second, third] = mutations();

    ack(first);
    nack(second, { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    await flushAsync();
    // made while a write is still in flight, so it waits for the repair
    stream.append({ data: ' quietly' });
    await flushAsync();
    expect(mutations().length).to.equal(3);

    nack(third, sequenceError(1));
    await waitForMutations(4);

    const repair = mutations()[3].messages[0];
    expect(repair.action).to.equal(UPDATE);
    expect(repair.serial).to.equal(MESSAGE_SERIAL);
    expect(repair.version.sequence).to.equal(2);
    expect(repair.name).to.equal('ai');
    expect(repair.data).to.equal('The cat sat down quietly');
    expect(repair.extras).to.deep.equal({ headers: { step: '1' } });

    ack(mutations()[3]);
    await flushAsync();
    // the repair carried ' quietly', so it isn't sent again
    expect(mutations().length).to.equal(4);

    stream.append({ data: '.' });
    await waitForMutations(5);
    expect(mutations()[4].messages[0].action).to.equal(APPEND);
    expect(mutations()[4].messages[0].version.sequence).to.equal(3);

    const closing = stream.close();
    ack(mutations()[4]);
    expect(await closing).to.deep.equal({ serial: MESSAGE_SERIAL });
    client.close();
  });

  it('sends writes made during a repair after it, numbered on from it', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    await waitForMutations(1);
    nack(mutations()[0], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    await waitForMutations(2);
    expect(mutations()[1].messages[0].version.sequence).to.equal(1);

    stream.append({ data: ' sat' });
    stream.update({ name: 'ai-final' });
    await flushAsync();
    expect(mutations().length).to.equal(2);

    ack(mutations()[1]);
    await waitForMutations(4);
    const held = mutations()
      .slice(2)
      .map((pm) => pm.messages[0]);
    expect(held.map((m) => m.action)).to.deep.equal([APPEND, UPDATE]);
    expect(held.map((m) => m.version.sequence)).to.deep.equal([2, 3]);

    const closing = stream.close();
    ack(mutations()[2]);
    ack(mutations()[3]);
    await closing;
    client.close();
  });

  it('sends the repair again from the stored sequence a 40901 reports', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    await waitForMutations(1);
    // the append applied, but its outcome was lost
    nack(mutations()[0], { message: 'connection lost', code: 80003, statusCode: 500 });
    await waitForMutations(2);
    expect(mutations()[1].messages[0].version.sequence).to.equal(1);

    nack(mutations()[1], sequenceError(1));
    await waitForMutations(3);
    const repair = mutations()[2].messages[0];
    expect(repair.action).to.equal(UPDATE);
    expect(repair.version.sequence).to.equal(2);
    expect(repair.data).to.equal('The cat');

    const closing = stream.close();
    ack(mutations()[2]);
    expect(await closing).to.deep.equal({ serial: MESSAGE_SERIAL });
    client.close();
  });

  it('repairs from the last ACKed sequence when the failed write reports no stored sequence', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    stream.append({ data: ' sat' });
    stream.append({ data: ' down' });
    await waitForMutations(3);
    ack(mutations()[0]);
    ack(mutations()[1]);
    nack(mutations()[2], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    await waitForMutations(4);

    const repair = mutations()[3].messages[0];
    expect(repair.version.sequence).to.equal(3);
    expect(repair.data).to.equal('The cat sat down');

    ack(mutations()[3]);
    await flushAsync();
    stream.append({ data: '.' });
    await waitForMutations(5);
    expect(mutations()[4].messages[0].version.sequence).to.equal(4);
    client.close();
  });

  it('repairs from detail.sequence when it is ahead of the last ACK', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    stream.append({ data: ' sat' });
    stream.append({ data: ' down' });
    await waitForMutations(3);
    ack(mutations()[0]);
    // the second append applied, but its outcome was lost
    nack(mutations()[1], { message: 'connection lost', code: 80003, statusCode: 500 });
    nack(mutations()[2], sequenceError(2));
    await waitForMutations(4);

    expect(mutations()[3].messages[0].version.sequence).to.equal(3);

    ack(mutations()[3]);
    await flushAsync();
    stream.append({ data: '.' });
    await waitForMutations(5);
    expect(mutations()[4].messages[0].version.sequence).to.equal(4);
    client.close();
  });

  it('repairs from a write ACKed after a 40901 in the same batch', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    stream.append({ data: ' sat' });
    await waitForMutations(2);
    // a resent copy of the first append, which had already applied
    nack(mutations()[0], sequenceError(1));
    ack(mutations()[1]);
    await waitForMutations(3);

    const repair = mutations()[2].messages[0];
    expect(repair.version.sequence).to.equal(3);
    expect(repair.data).to.equal('The cat sat');
    client.close();
  });

  it('goes back to an earlier stored sequence that a 40901 reports', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    stream.append({ data: ' sat' });
    stream.append({ data: ' down' });
    await waitForMutations(3);
    ack(mutations()[0]);
    ack(mutations()[1]);
    // realtime reports a stored sequence behind the last ACK
    nack(mutations()[2], sequenceError(1));
    await waitForMutations(4);

    const repair = mutations()[3].messages[0];
    expect(repair.version.sequence).to.equal(2);
    expect(repair.data).to.equal('The cat sat down');

    ack(mutations()[3]);
    await flushAsync();
    stream.append({ data: '.' });
    await waitForMutations(5);
    expect(mutations()[4].messages[0].version.sequence).to.equal(3);
    client.close();
  });

  it('goes back to an earlier stored sequence that a 40901 on a repair reports', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    stream.append({ data: ' sat' });
    stream.append({ data: ' down' });
    await waitForMutations(3);
    ack(mutations()[0]);
    ack(mutations()[1]);
    nack(mutations()[2], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    await waitForMutations(4);
    expect(mutations()[3].messages[0].version.sequence).to.equal(3);

    nack(mutations()[3], sequenceError(1));
    await waitForMutations(5);
    const retry = mutations()[4].messages[0];
    expect(retry.version.sequence).to.equal(2);
    expect(retry.data).to.equal('The cat sat down');

    const closing = stream.close();
    ack(mutations()[4]);
    expect(await closing).to.deep.equal({ serial: MESSAGE_SERIAL });
    client.close();
  });

  it('ignores a 40901 whose detail.sequence is not a number', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    stream.append({ data: ' sat' });
    await waitForMutations(2);
    ack(mutations()[0]);
    nack(mutations()[1], { ...sequenceError(0), detail: { sequence: 'not-a-number' } });
    await waitForMutations(3);

    // the repair follows on from the last ACK
    expect(mutations()[2].messages[0].version.sequence).to.equal(2);
    client.close();
  });

  it('stops when a repair fails, and the next write throws the error', async function () {
    const { client, channel, mutations, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });
    const denied = { message: 'permission denied', code: 40160, statusCode: 401 };

    stream.append({ data: ' cat' });
    const closing = stream.close();
    await waitForMutations(1);
    nack(mutations()[0], denied);
    await waitForMutations(2);
    nack(mutations()[1], denied);

    try {
      await closing;
      expect.fail('close should have rejected');
    } catch (err: any) {
      expect(err.code).to.equal(40160);
    }
    expect(() => stream.append({ data: ' sat' }))
      .to.throw()
      .with.property('code', 40160);
    try {
      await stream.flush();
      expect.fail('flush should have rejected');
    } catch (err: any) {
      expect(err.code).to.equal(40160);
    }
    client.close();
  });

  it('sends an ephemeral append without a sequence and leaves it out of a repair', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' (thinking)', extras: { ephemeral: true } });
    stream.append({ data: ' cat' });
    await waitForMutations(2);
    expect(mutations()[0].messages[0].version?.sequence).to.be.undefined;
    expect(mutations()[1].messages[0].version.sequence).to.equal(1);

    ack(mutations()[0]);
    nack(mutations()[1], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    await waitForMutations(3);
    const repair = mutations()[2].messages[0];
    expect(repair.version.sequence).to.equal(1);
    expect(repair.data).to.equal('The cat');
    expect(repair.extras).to.be.undefined;

    const closing = stream.close();
    ack(mutations()[2]);
    await closing;
    client.close();
  });

  it('flush waits for the writes so far and keeps the stream open', async function () {
    const { client, channel, mutations, ack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    const flushing = stream.flush();
    stream.append({ data: ' sat' });
    await waitForMutations(2);

    ack(mutations()[0]);
    // resolves once the writes made before the flush have applied
    expect(await flushing).to.deep.equal({ serial: MESSAGE_SERIAL });

    stream.append({ data: ' down' });
    await waitForMutations(3);
    expect(mutations()[2].messages[0].version.sequence).to.equal(3);
    const closing = stream.close();
    ack(mutations()[1]);
    ack(mutations()[2]);
    await closing;
    client.close();
  });

  it('close appends its message last, and returns the same promise when called again', async function () {
    const { client, channel, mutations, ack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    const closing = stream.close({ extras: { headers: { status: 'done' } } });
    await waitForMutations(2);
    const last = mutations()[1].messages[0];
    expect(last.action).to.equal(APPEND);
    expect(last.extras).to.deep.equal({ headers: { status: 'done' } });
    expect(last.version.sequence).to.equal(2);

    expect(stream.close()).to.equal(closing);
    ack(mutations()[0]);
    ack(mutations()[1]);
    await closing;

    expect(() => stream.append({ data: ' sat' }))
      .to.throw()
      .with.property('code', 40000);
    client.close();
  });

  it('abort rejects a pending close, ignores outcomes and refuses writes', async function () {
    const { client, channel, mutations, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    const closing = stream.close();
    await waitForMutations(1);
    stream.abort();

    try {
      await closing;
      expect.fail('close should have rejected');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }
    nack(mutations()[0], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    await flushAsync();
    // no repair after an abort
    expect(mutations().length).to.equal(1);
    expect(() => stream.append({ data: ' sat' }))
      .to.throw()
      .with.property('code', 40000);
    client.close();
  });

  it('abort sends its message as an update without a sequence, and does not wait for it', async function () {
    const { client, channel, mutations, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    const closing = stream.close();
    await waitForMutations(1);
    stream.abort({ extras: { headers: { status: 'abort' } } }, { description: 'aborted' });
    await waitForMutations(2);

    const marker = mutations()[1].messages[0];
    expect(marker.action).to.equal(UPDATE);
    expect(marker.serial).to.equal(MESSAGE_SERIAL);
    expect(marker.extras).to.deep.equal({ headers: { status: 'abort' } });
    expect(marker.version).to.deep.equal({ description: 'aborted' });

    // close rejects without either write being ACKed
    try {
      await closing;
      expect.fail('close should have rejected');
    } catch (err: any) {
      expect(err.code).to.equal(40000);
    }

    nack(mutations()[0], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    nack(mutations()[1], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    await flushAsync();
    // no repair, and the failed marker isn't sent again
    expect(mutations().length).to.equal(2);

    stream.abort({ extras: { headers: { status: 'abort' } } });
    await flushAsync();
    // a second abort does nothing
    expect(mutations().length).to.equal(2);
    client.close();
  });

  it('abort sends its message after the stream stopped on an error', async function () {
    const { client, channel, mutations, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });
    const denied = { message: 'permission denied', code: 40160, statusCode: 401 };

    stream.append({ data: ' cat' });
    const closing = stream.close();
    await waitForMutations(1);
    nack(mutations()[0], denied);
    await waitForMutations(2);
    nack(mutations()[1], denied);
    try {
      await closing;
      expect.fail('close should have rejected');
    } catch (err: any) {
      expect(err.code).to.equal(40160);
    }

    stream.abort({ extras: { headers: { status: 'abort' } } });
    await waitForMutations(3);
    const marker = mutations()[2].messages[0];
    expect(marker.action).to.equal(UPDATE);
    expect(marker.version?.sequence).to.be.undefined;
    expect(marker.extras).to.deep.equal({ headers: { status: 'abort' } });

    // the stream still reports the error that stopped it
    expect(() => stream.append({ data: ' sat' }))
      .to.throw()
      .with.property('code', 40160);
    client.close();
  });

  it('delete ends the stream, and a repair sends the delete again', async function () {
    const { client, channel, mutations, ack, nack, waitForMutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    stream.append({ data: ' cat' });
    stream.delete();
    expect(() => stream.append({ data: ' sat' }))
      .to.throw()
      .with.property('code', 40000);
    await waitForMutations(2);
    expect(mutations()[1].messages[0].action).to.equal(DELETE);
    expect(mutations()[1].messages[0].version.sequence).to.equal(2);

    nack(mutations()[0], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
    nack(mutations()[1], sequenceError(0));
    await waitForMutations(3);
    const repair = mutations()[2].messages[0];
    expect(repair.action).to.equal(DELETE);
    expect(repair.version.sequence).to.equal(1);

    const closing = stream.close();
    ack(mutations()[2]);
    expect(await closing).to.deep.equal({ serial: MESSAGE_SERIAL });
    client.close();
  });

  it('refuses an append whose data type does not match the message data', async function () {
    const { client, channel, mutations } = await setup();
    const stream = await channel.newStream({ name: 'ai', data: 'The' });

    expect(() => stream.append({ data: new Uint8Array([1, 2]) }))
      .to.throw()
      .with.property('code', 40003);
    await flushAsync();
    expect(mutations().length).to.equal(0);
    client.close();
  });

  describe('adoptStream', function () {
    it('carries on from a message, and makes no request', async function () {
      const httpMock = new MockHttpClient({
        onConnectionAttempt: (conn) => conn.respond_with_success(),
        onRequest: (req) => req.respond_with(500, {}),
      });
      installMockHttp(httpMock);
      const { client, channel, mutations, nack, waitForMutations } = await setup();

      const stream = channel.adoptStream({
        serial: MESSAGE_SERIAL,
        name: 'ai',
        data: 'The cat',
        extras: { headers: { step: '1' } },
        version: { serial: 'version-9', sequence: 4 },
      });

      expect(stream.serial).to.equal(MESSAGE_SERIAL);
      expect(httpMock.captured_requests.length).to.equal(0);
      stream.append({ data: ' sat' });
      await waitForMutations(1);
      expect(mutations()[0].messages[0].version.sequence).to.equal(5);

      nack(mutations()[0], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
      await waitForMutations(2);
      const repair = mutations()[1].messages[0];
      expect(repair.version.sequence).to.equal(5);
      expect(repair.name).to.equal('ai');
      expect(repair.data).to.equal('The cat sat');
      expect(repair.extras).to.deep.equal({ headers: { step: '1' } });
      client.close();
    });

    it('treats a message with no version.sequence as sequence 0', async function () {
      const { client, channel, mutations, waitForMutations } = await setup();

      const stream = channel.adoptStream({ serial: MESSAGE_SERIAL, data: 'The cat' });
      stream.append({ data: ' sat' });
      await waitForMutations(1);
      expect(mutations()[0].messages[0].version.sequence).to.equal(1);
      client.close();
    });

    it('carries on from a serial, sequence and content', async function () {
      const { client, channel, mutations, nack, waitForMutations } = await setup();

      const stream = channel.adoptStream(MESSAGE_SERIAL, 4, { name: 'ai', data: 'The cat' });

      expect(stream.serial).to.equal(MESSAGE_SERIAL);
      stream.append({ data: ' sat' });
      await waitForMutations(1);
      expect(mutations()[0].messages[0].version.sequence).to.equal(5);

      nack(mutations()[0], { message: 'rate limit exceeded', code: 42910, statusCode: 429 });
      await waitForMutations(2);
      const repair = mutations()[1].messages[0];
      expect(repair.version.sequence).to.equal(5);
      expect(repair.name).to.equal('ai');
      expect(repair.data).to.equal('The cat sat');
      client.close();
    });

    it('throws 40003 on a message without a serial or with an invalid sequence', async function () {
      const { client, channel } = await setup();

      expect(() => channel.adoptStream({ data: 'The cat', version: { sequence: 4 } }))
        .to.throw()
        .with.property('code', 40003);
      expect(() => channel.adoptStream({ serial: MESSAGE_SERIAL, version: { sequence: -1 } }))
        .to.throw()
        .with.property('code', 40003);
      client.close();
    });

    it('throws 40003 on an invalid serial, sequence or content', async function () {
      const { client, channel } = await setup();
      const adopt = channel.adoptStream as (...args: any[]) => any;

      expect(() => adopt.call(channel, '', 4, { data: 'The cat' }))
        .to.throw()
        .with.property('code', 40003);
      expect(() => adopt.call(channel, MESSAGE_SERIAL, undefined, { data: 'The cat' }))
        .to.throw()
        .with.property('code', 40003);
      expect(() => adopt.call(channel, MESSAGE_SERIAL, 1.5, { data: 'The cat' }))
        .to.throw()
        .with.property('code', 40003);
      expect(() => adopt.call(channel, MESSAGE_SERIAL, 4))
        .to.throw()
        .with.property('code', 40003);
      client.close();
    });
  });
});
