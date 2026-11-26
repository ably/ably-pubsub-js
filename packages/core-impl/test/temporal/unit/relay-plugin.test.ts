import { expect } from 'chai';
import type { RealtimeChannelPool } from '@ably/pubsub-server';
import type { WorkerOptions } from '@temporalio/worker';
import { RELAY_ACTIVITY_NAME } from '../../../src/platform/temporal/src/common/relay';
import { publishPerEvent, type RelayAdaptorFactory } from '../../../src/platform/temporal/src/worker/relay/adaptor';
import { AblyRelayPlugin } from '../../../src/platform/temporal/src/worker/relay/plugin';

const pool = { get: () => undefined } as unknown as RealtimeChannelPool;

describe('temporal/worker/relay/plugin', function () {
  it('registers the relay activity alongside the worker activities', function () {
    const plugin = new AblyRelayPlugin({ pool, adaptors: { events: publishPerEvent() } });
    const mine = async () => {};

    const options = plugin.configureWorker({ taskQueue: 'test', activities: { mine } } as WorkerOptions);

    expect(options.activities).to.have.all.keys('mine', RELAY_ACTIVITY_NAME);
  });

  it('accepts an adaptor factory typed for the event data it expects', function () {
    // A compile-time check: a factory with a narrower event type registers alongside untyped ones.
    const typed: RelayAdaptorFactory<{ text: string }> = (channel, handoff) => {
      const adaptor = publishPerEvent()(channel, handoff);
      return { ...adaptor, write: (event) => adaptor.write({ ...event, data: event.data.text }) };
    };

    expect(() => new AblyRelayPlugin({ pool, adaptors: { typed, events: publishPerEvent() } })).not.to.throw();
  });

  it('throws a TypeError naming `pool` when it is not a channel pool', function () {
    expect(() => new AblyRelayPlugin({ adaptors: {} } as never)).to.throw(TypeError, '`pool`');
  });

  it('throws a TypeError naming `adaptors` when it is not an object', function () {
    expect(() => new AblyRelayPlugin({ pool } as never)).to.throw(TypeError, '`adaptors`');
    expect(() => new AblyRelayPlugin({ pool, adaptors: [] } as never)).to.throw(TypeError, '`adaptors`');
  });

  it('throws a TypeError naming the adaptor whose factory is not a function', function () {
    expect(() => new AblyRelayPlugin({ pool, adaptors: { events: {} } } as never)).to.throw(TypeError, '"events"');
  });
});
