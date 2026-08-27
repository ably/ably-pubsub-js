/**
 * UTS Integration: Delta Decoding Tests
 *
 * Spec points: PC3, PC3a, RTL18, RTL18b, RTL18c, RTL19b, RTL20
 * Source: uts/realtime/integration/delta_decoding_test.md
 */

import { expect } from 'chai';
import * as vcdiffDecoder from '@ably/vcdiff-decoder';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  trackClient,
  connectAndWait,
  closeAndWait,
  uniqueChannelName,
  pollUntil,
} from './sandbox';
import { describeEachProtocol } from '../../helpers/protocol_variants';

const testData = [
  { foo: 'bar', count: 1, status: 'active' },
  { foo: 'bar', count: 2, status: 'active' },
  { foo: 'bar', count: 2, status: 'inactive' },
  { foo: 'bar', count: 3, status: 'inactive' },
  { foo: 'bar', count: 3, status: 'active' },
];

function makeCountingDecoder() {
  const decoder = {
    numberOfCalls: 0,
    decode(delta: any, base: any) {
      decoder.numberOfCalls++;
      return vcdiffDecoder.decode(delta, base);
    },
  };
  return decoder;
}

describeEachProtocol('uts/realtime/integration/delta_decoding', function (protocol) {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * PC3 - Delta plugin decodes messages end-to-end
   *
   * With a real vcdiff decoder plugin and a channel configured for delta mode,
   * all published messages are received with correct data.
   */
  // UTS: realtime/integration/PC3/delta-decode-end-to-end-0
  it('PC3 - delta plugin decodes messages end-to-end', async function () {
    const channelName = uniqueChannelName('delta-PC3');
    const countingDecoder = makeCountingDecoder();

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
      plugins: { vcdiff: countingDecoder },
    } as any);
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      params: { delta: 'vcdiff' },
    });

    await channel.attach();

    const received: any[] = [];
    let reattachError: any = null;

    channel.on('attaching', (stateChange: any) => {
      reattachError = stateChange.reason;
    });

    await channel.subscribe((msg: any) => received.push(msg));

    for (let i = 0; i < testData.length; i++) {
      await channel.publish(String(i), testData[i]);
    }

    await pollUntil(() => (received.length >= testData.length ? true : null), {
      interval: 200,
      timeout: 15000,
    });

    expect(reattachError).to.be.null;

    for (let i = 0; i < testData.length; i++) {
      expect(received[i].name).to.equal(String(i));
      expect(received[i].data).to.deep.equal(testData[i]);
    }

    // First message is full payload, rest are deltas
    expect(countingDecoder.numberOfCalls).to.equal(testData.length - 1);

    await closeAndWait(client);
  });

  /**
   * RTL19b - Dissimilar payloads received without delta encoding
   *
   * When successive messages have completely dissimilar payloads (random binary),
   * the server sends full messages rather than deltas.
   */
  // UTS: realtime/integration/RTL19b/dissimilar-payloads-no-delta-0
  it('RTL19b - dissimilar payloads without delta encoding', async function () {
    const channelName = uniqueChannelName('delta-dissimilar');
    const messageCount = 5;
    const countingDecoder = makeCountingDecoder();

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
      plugins: { vcdiff: countingDecoder },
    } as any);
    trackClient(client);

    // Generate random binary payloads
    const payloads: Buffer[] = [];
    for (let i = 0; i < messageCount; i++) {
      const buf = Buffer.alloc(1024);
      for (let j = 0; j < 1024; j++) {
        buf[j] = Math.floor(Math.random() * 256);
      }
      payloads.push(buf);
    }

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      params: { delta: 'vcdiff' },
    });

    await channel.attach();

    const received: any[] = [];
    let reattachError: any = null;

    channel.on('attaching', (stateChange: any) => {
      reattachError = stateChange.reason;
    });

    await channel.subscribe((msg: any) => received.push(msg));

    for (let i = 0; i < messageCount; i++) {
      await channel.publish(String(i), payloads[i]);
    }

    await pollUntil(() => (received.length >= messageCount ? true : null), {
      interval: 200,
      timeout: 15000,
    });

    expect(reattachError).to.be.null;

    for (let i = 0; i < messageCount; i++) {
      expect(received[i].name).to.equal(String(i));
      expect(Buffer.from(received[i].data)).to.deep.equal(payloads[i]);
    }

    await closeAndWait(client);
  });

  /**
   * PC3 - No deltas without delta channel param
   *
   * Without params: { delta: 'vcdiff' }, the server sends full messages
   * and the decoder is never called.
   */
  // UTS: realtime/integration/PC3/no-deltas-without-param-1
  it('PC3 - no deltas without delta channel param', async function () {
    const channelName = uniqueChannelName('delta-no-param');
    const countingDecoder = makeCountingDecoder();

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
      plugins: { vcdiff: countingDecoder },
    } as any);
    trackClient(client);

    await connectAndWait(client);

    // No delta params
    const channel = client.channels.get(channelName);

    await channel.attach();

    const received: any[] = [];
    await channel.subscribe((msg: any) => received.push(msg));

    for (let i = 0; i < testData.length; i++) {
      await channel.publish(String(i), testData[i]);
    }

    await pollUntil(() => (received.length >= testData.length ? true : null), {
      interval: 200,
      timeout: 15000,
    });

    for (let i = 0; i < testData.length; i++) {
      expect(received[i].name).to.equal(String(i));
      expect(received[i].data).to.deep.equal(testData[i]);
    }

    expect(countingDecoder.numberOfCalls).to.equal(0);

    await closeAndWait(client);
  });

  /**
   * RTL18/RTL18b/RTL18c/RTL20 - Recovery after last message ID mismatch
   *
   * When the stored last message ID is cleared, the next delta fails the RTL20
   * check, triggering RTL18 recovery. After recovery the channel reattaches.
   */
  // UTS: realtime/integration/RTL18/recovery-message-id-mismatch-0
  it('RTL18/RTL20 - recovery after last message ID mismatch', async function () {
    const channelName = uniqueChannelName('delta-recovery-mismatch');
    const countingDecoder = makeCountingDecoder();

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
      plugins: { vcdiff: countingDecoder },
    } as any);
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      params: { delta: 'vcdiff' },
    });

    await channel.attach();

    const received: any[] = [];
    const attachingReasons: any[] = [];

    channel.on('attaching', (stateChange: any) => {
      attachingReasons.push(stateChange.reason);
    });

    await channel.subscribe((msg: any) => received.push(msg));

    // Publish first batch and wait for them
    for (let i = 0; i < 3; i++) {
      await channel.publish(String(i), testData[i]);
    }

    await pollUntil(() => (received.length >= 3 ? true : null), {
      interval: 200,
      timeout: 15000,
    });

    // Simulate a message gap by clearing the stored last message ID
    (channel as any)._lastPayload.messageId = null;

    // Publish remaining messages — the next delta will fail RTL20 check
    for (let i = 3; i < testData.length; i++) {
      await channel.publish(String(i), testData[i]);
    }

    // Wait for all messages to be received (may have duplicates after recovery)
    await pollUntil(
      () => {
        const names = new Set(received.map((m: any) => m.name));
        for (let i = 0; i < testData.length; i++) {
          if (!names.has(String(i))) return null;
        }
        return true;
      },
      { interval: 200, timeout: 30000 },
    );

    // All messages were eventually received with correct data
    for (let i = 0; i < testData.length; i++) {
      const msg = received.find((m: any) => m.name === String(i));
      expect(msg).to.not.be.undefined;
      expect(msg.data).to.deep.equal(testData[i]);
    }

    // RTL18c: Recovery was triggered with error code 40018
    expect(attachingReasons.length).to.be.at.least(1);
    expect(attachingReasons[0].code).to.equal(40018);

    await closeAndWait(client);
  });

  /**
   * RTL18/RTL18c - Recovery after decode failure
   *
   * When the vcdiff decoder throws, the channel transitions to ATTACHING
   * with error 40018 and recovers.
   */
  // UTS: realtime/integration/RTL18/recovery-decode-failure-1
  it('RTL18 - recovery after decode failure', async function () {
    const channelName = uniqueChannelName('delta-recovery-decode');

    const failingDecoder = {
      decode(_delta: any, _base: any) {
        throw new Error('Failed to decode delta.');
      },
    };

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
      plugins: { vcdiff: failingDecoder },
    } as any);
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName, {
      params: { delta: 'vcdiff' },
    });

    await channel.attach();

    const received: any[] = [];
    const attachingReasons: any[] = [];

    channel.on('attaching', (stateChange: any) => {
      attachingReasons.push(stateChange.reason);
    });

    await channel.subscribe((msg: any) => received.push(msg));

    for (let i = 0; i < testData.length; i++) {
      await channel.publish(String(i), testData[i]);
    }

    // Wait for all messages — first arrives as non-delta, second triggers
    // decode failure and recovery, then remaining arrive after reattach
    await pollUntil(
      () => {
        const names = new Set(received.map((m: any) => m.name));
        for (let i = 0; i < testData.length; i++) {
          if (!names.has(String(i))) return null;
        }
        return true;
      },
      { interval: 200, timeout: 30000 },
    );

    for (let i = 0; i < testData.length; i++) {
      const msg = received.find((m: any) => m.name === String(i));
      expect(msg).to.not.be.undefined;
      expect(msg.data).to.deep.equal(testData[i]);
    }

    // RTL18c: At least one recovery was triggered
    expect(attachingReasons.length).to.be.at.least(1);
    expect(attachingReasons[0].code).to.equal(40018);

    await closeAndWait(client);
  });

  /**
   * PC3 - No plugin causes FAILED state
   *
   * Without a vcdiff plugin, receiving a delta-encoded message causes
   * the channel to transition to FAILED with error code 40019.
   */
  // UTS: realtime/integration/PC3/no-plugin-causes-failed-2
  it('PC3 - no plugin causes FAILED state', async function () {
    const channelName = uniqueChannelName('delta-no-plugin');

    // Subscriber — no vcdiff plugin, but requests delta channel param
    const subscriber = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(subscriber);

    // Publisher — separate connection
    const publisher = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(publisher);

    await connectAndWait(subscriber);
    await connectAndWait(publisher);

    const subChannel = subscriber.channels.get(channelName, {
      params: { delta: 'vcdiff' },
    });
    await subChannel.attach();

    const pubChannel = publisher.channels.get(channelName);
    await pubChannel.attach();

    // Publish enough messages to trigger delta encoding on subscriber
    for (let i = 0; i < testData.length; i++) {
      await pubChannel.publish(String(i), testData[i]);
    }

    // Wait for channel to fail
    await pollUntil(() => (subChannel.state === 'failed' ? true : null), {
      interval: 200,
      timeout: 15000,
    });

    expect(subChannel.state).to.equal('failed');
    expect(subChannel.errorReason!.code).to.equal(40019);

    await closeAndWait(publisher);
    subscriber.close();
  });
});
