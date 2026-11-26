import { expect } from 'chai';
import type { RealtimePublisherChannel } from '@ably/pubsub-server';
import { publishPerEvent } from '../../../src/platform/temporal/src/worker/relay/adaptor';
import { rejection } from './worker-helpers';

/** A publish call recorded by a {@link FakeChannel}, which the test settles. */
interface PublishCall {
  name: string;
  data: unknown;
  resolve: () => void;
  reject: (err: unknown) => void;
}

/** A channel whose publishes stay pending until the test settles them. */
class FakeChannel {
  readonly calls: PublishCall[] = [];

  readonly channel = {
    name: 'chat',
    publish: (name: string, data: unknown) =>
      new Promise<void>((resolve, reject) => this.calls.push({ name, data, resolve, reject })),
  } as unknown as RealtimePublisherChannel;
}

/** Whether `promise` has settled once pending callbacks have run. */
async function isSettled(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  promise.then(
    () => (settled = true),
    () => (settled = true),
  );
  await new Promise((resolve) => setImmediate(resolve));
  return settled;
}

describe('temporal/worker/relay/publishPerEvent', function () {
  it('publishes each event as a message named after its topic, in order', async function () {
    const fake = new FakeChannel();
    const adaptor = publishPerEvent()(fake.channel, null);

    adaptor.write({ topic: 'agent', offset: 0, data: { text: 'a' } });
    adaptor.write({ topic: 'status', offset: 1, data: 'b' });

    expect(fake.calls.map(({ name, data }) => ({ name, data }))).to.deep.equal([
      { name: 'agent', data: { text: 'a' } },
      { name: 'status', data: 'b' },
    ]);
  });

  it('resolves flush with a null handoff once every publish has settled', async function () {
    const fake = new FakeChannel();
    const adaptor = publishPerEvent()(fake.channel, null);
    adaptor.write({ topic: 'agent', offset: 0, data: 'a' });
    adaptor.write({ topic: 'agent', offset: 1, data: 'b' });

    const flushed = adaptor.flush();
    fake.calls[0].resolve();
    expect(await isSettled(flushed)).to.equal(false);
    fake.calls[1].resolve();

    expect(await flushed).to.deep.equal({ handoff: null });
  });

  it('stops once a publish fails, and throws its error from every later call', async function () {
    const fake = new FakeChannel();
    const adaptor = publishPerEvent()(fake.channel, null);
    const refused = new Error('refused');
    adaptor.write({ topic: 'agent', offset: 0, data: 'a' });
    fake.calls[0].reject(refused);
    await new Promise((resolve) => setImmediate(resolve));

    expect(() => adaptor.write({ topic: 'agent', offset: 1, data: 'b' })).to.throw(refused);
    expect(fake.calls).to.have.length(1);
    expect(await rejection(adaptor.flush())).to.equal(refused);
    expect(await rejection(adaptor.close())).to.equal(refused);
  });

  it('rejects flush with the error of a publish that fails while it waits', async function () {
    const fake = new FakeChannel();
    const adaptor = publishPerEvent()(fake.channel, null);
    const refused = new Error('refused');
    adaptor.write({ topic: 'agent', offset: 0, data: 'a' });

    const flushed = adaptor.flush();
    fake.calls[0].reject(refused);

    expect(await rejection(flushed)).to.equal(refused);
  });

  it('accepts no calls once closed', async function () {
    const fake = new FakeChannel();
    const adaptor = publishPerEvent()(fake.channel, null);
    adaptor.write({ topic: 'agent', offset: 0, data: 'a' });
    const closed = adaptor.close();
    fake.calls[0].resolve();

    expect(await closed).to.deep.equal({ handoff: null });
    expect(() => adaptor.write({ topic: 'agent', offset: 1, data: 'b' })).to.throw('closed');
    expect(await rejection(adaptor.flush()))
      .to.have.property('message')
      .that.contains('closed');
  });
});
