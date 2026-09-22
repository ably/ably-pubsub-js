/**
 * UTS Integration: REST Channel Publish Tests
 *
 * Spec points: RSL1d, RSL1n, RSL1k5, RSL1l1, RSL1m4
 * Source: uts/rest/integration/publish.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  uniqueChannelName,
  pollUntil,
} from './sandbox';
import { describeEachProtocol } from '../../helpers/protocol_variants';

describeEachProtocol('uts/rest/integration/publish', function (protocol) {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSL1d - Error indication on publish failure
   *
   * Failed publish operations must indicate the error to the caller.
   * Publishing to a channel not in the restricted key's capability should fail.
   */
  // UTS: rest/integration/RSL1d/publish-failure-error-0
  it('RSL1d - publish failure with restricted key returns error', async function () {
    const channelName = uniqueChannelName('forbidden-channel');

    const restrictedClient = new Ably.Rest({
      key: getApiKey(2), // per-channel capabilities
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const restrictedChannel = restrictedClient.channels.get(channelName);

    try {
      await restrictedChannel.publish('event', 'data');
      expect.fail('Publish should have failed with restricted key');
    } catch (error: any) {
      expect(error.code).to.equal(40160);
      expect(error.statusCode).to.equal(401);
    }
  });

  /**
   * RSL1n - PublishResult contains serials
   *
   * Successful publish returns a PublishResult containing message serials.
   */
  // UTS: rest/integration/RSL1n/publish-result-serials-0.1
  it('RSL1n - single message publish returns result with serial', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('test-serials');
    const channel = client.channels.get(channelName);

    const result = await channel.publish('event1', 'data1');

    expect(result.serials).to.be.an('array');
    expect(result.serials).to.have.length(1);
    expect(result.serials[0]).to.be.a('string');
    expect((result.serials[0] as string).length).to.be.greaterThan(0);
  });

  // UTS: rest/integration/RSL1n/publish-result-serials-0
  it('RSL1n - multiple message publish returns result with unique serials', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('test-serials-multi');
    const channel = client.channels.get(channelName);

    const result = await channel.publish([
      { name: 'event2', data: 'data2' },
      { name: 'event3', data: 'data3' },
      { name: 'event4', data: 'data4' },
    ]);

    expect(result.serials).to.be.an('array');
    expect(result.serials).to.have.length(3);

    for (const serial of result.serials) {
      expect(serial).to.be.a('string');
      expect((serial as string).length).to.be.greaterThan(0);
    }

    // All serials should be unique
    const uniqueSerials = new Set(result.serials);
    expect(uniqueSerials.size).to.equal(result.serials.length);
  });

  /**
   * RSL1k5 - Idempotent publish with client-supplied IDs
   *
   * Messages with client-supplied IDs are idempotent; duplicate IDs
   * don't create duplicate messages.
   */
  // UTS: rest/integration/RSL1k5/idempotent-client-ids-0
  it('RSL1k5 - idempotent publish with client-supplied ID', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('idempotent-explicit');
    const channel = client.channels.get(channelName);

    const fixedId = 'client-supplied-id-' + Math.random().toString(36).substring(2, 10);

    // Publish same message ID multiple times
    for (let i = 1; i <= 3; i++) {
      await channel.publish({ id: fixedId, name: 'event', data: 'data-' + i });
    }

    // Poll history until message appears
    const history = await pollUntil(
      async () => {
        const result = await channel.history(null);
        if (result.items.length > 0) return result;
        return null;
      },
      { interval: 500, timeout: 10000 },
    );

    // Verify only one message in history (duplicates were deduplicated)
    expect(history.items).to.have.length(1);
    expect(history.items[0].id).to.equal(fixedId);
    // The data should be from the first publish (subsequent ones are no-ops)
    expect(history.items[0].data).to.equal('data-1');
  });

  /**
   * RSL1l1 - Publish params with _forceNack
   *
   * Additional publish params can be supplied and are transmitted to the server.
   * The _forceNack test param causes the server to reject the publish.
   */
  // UTS: rest/integration/RSL1l1/publish-params-force-nack-0
  it('RSL1l1 - publish with _forceNack param is rejected', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('force-nack-test');
    const channel = client.channels.get(channelName);

    try {
      await channel.publish({ name: 'event', data: 'data' }, { _forceNack: 'true' });
      expect.fail('Publish with _forceNack should have failed');
    } catch (error: any) {
      expect(error.code).to.equal(40099);
    }
  });

  /**
   * RSL1m4 - ClientId mismatch rejection
   *
   * Server rejects messages where clientId doesn't match the authenticated client.
   */
  // UTS: rest/integration/RSL1m4/clientid-mismatch-rejected-0
  it('RSL1m4 - clientId mismatch in message is rejected', async function () {
    // Create a token with a specific clientId
    const keyClient = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const tokenDetails = await keyClient.auth.requestToken({ clientId: 'authenticated-client-id' });

    // Client using token with clientId
    const tokenClient = new Ably.Rest({
      token: tokenDetails.token,
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('clientid-mismatch');
    const channel = tokenClient.channels.get(channelName);

    try {
      await channel.publish({ name: 'event', data: 'data', clientId: 'different-client-id' });
      expect.fail('Publish with mismatched clientId should have failed');
    } catch (error: any) {
      expect(error.code).to.equal(40012);
      expect(error.statusCode).to.equal(400);
    }
  });
});
