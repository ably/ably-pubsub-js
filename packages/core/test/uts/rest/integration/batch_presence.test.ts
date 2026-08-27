/**
 * UTS Integration: Batch Presence Tests
 *
 * Spec points: RSC24, BGR2, BGF2
 * Source: specification/uts/rest/integration/batch_presence.md
 *
 * End-to-end verification of RestClient#batchPresence against the Ably sandbox.
 * Client A enters presence members via Realtime, then the REST client calls
 * batchPresence and verifies the response structure and content.
 */

import { expect } from 'chai';
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
} from './sandbox';
import { describeEachProtocol } from '../../helpers/protocol_variants';

describeEachProtocol('uts/rest/integration/batch_presence', function (protocol) {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RSC24, BGR2 - batchPresence returns members across multiple channels
   *
   * Enter members on two channels via Realtime, then query both channels
   * in a single batchPresence call via REST and verify the returned members.
   */
  // UTS: rest/integration/RSC24/batch-presence-multiple-channels-0
  it('RSC24, BGR2 - batchPresence returns members across multiple channels', async function () {
    const channelAName = uniqueChannelName('batch-presence-a');
    const channelBName = uniqueChannelName('batch-presence-b');

    // Connect realtime and enter members on two channels
    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(realtime);
    await connectAndWait(realtime);

    const chA = realtime.channels.get(channelAName);
    await chA.attach();
    await chA.presence.enterClient('user-1', 'data-a1');
    await chA.presence.enterClient('user-2', 'data-a2');

    const chB = realtime.channels.get(channelBName);
    await chB.attach();
    await chB.presence.enterClient('user-3', 'data-b1');

    // Query via REST batchPresence (keep realtime open so presence persists)
    const rest = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const result = await rest.batchPresence([channelAName, channelBName]);

    expect(result.successCount).to.equal(2);
    expect(result.failureCount).to.equal(0);
    expect(result.results).to.have.length(2);

    // Find results by channel name
    const resultA = result.results.find((r: any) => r.channel === channelAName) as any;
    const resultB = result.results.find((r: any) => r.channel === channelBName) as any;

    expect(resultA).to.exist;
    expect(resultA.presence).to.be.an('array').with.length(2);
    const clientIdsA = resultA.presence.map((m: any) => m.clientId);
    expect(clientIdsA).to.include('user-1');
    expect(clientIdsA).to.include('user-2');

    // Verify data round-trips correctly
    const member1 = resultA.presence.find((m: any) => m.clientId === 'user-1');
    expect(member1.data).to.equal('data-a1');

    expect(resultB).to.exist;
    expect(resultB.presence).to.be.an('array').with.length(1);
    expect(resultB.presence[0].clientId).to.equal('user-3');
    expect(resultB.presence[0].data).to.equal('data-b1');

    await closeAndWait(realtime);
  });

  /**
   * RSC24, BGF2 - Restricted key returns per-channel failure for unauthorized channels
   *
   * When a key lacks capability for a channel, the per-channel result is a
   * BatchPresenceFailureResult containing an ErrorInfo. Channels the key does
   * have access to return success results in the same batch response.
   *
   * The UTS spec closes the realtime connection before the REST query. After
   * closing, the presence members will have left, so the allowed channel returns
   * an empty presence set. The test still validates the per-channel success vs
   * failure distinction.
   */
  // UTS: rest/integration/RSC24/restricted-key-channel-failure-1
  it('RSC24, BGF2 - restricted key returns per-channel failure for unauthorized channels', async function () {
    // Use the fixed channel name matching keys[2] capability from ably-common
    const allowedChannel = 'channel6';
    const deniedChannel = uniqueChannelName('denied-batch');

    // Enter members on both channels using the full-access key
    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(realtime);
    await connectAndWait(realtime);

    const chAllowed = realtime.channels.get(allowedChannel);
    await chAllowed.attach();
    await chAllowed.presence.enterClient('member-1', 'hello');

    const chDenied = realtime.channels.get(deniedChannel);
    await chDenied.attach();
    await chDenied.presence.enterClient('member-2', 'world');

    // Close realtime before the REST query (per UTS spec).
    // Presence members will have left after disconnection.
    await closeAndWait(realtime);

    // Query with restricted key (keys[2], has "channel6":["*"])
    const restrictedRest = new Ably.Rest({
      key: getApiKey(2),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const result = await restrictedRest.batchPresence([allowedChannel, deniedChannel]);

    expect(result.successCount).to.equal(1);
    expect(result.failureCount).to.equal(1);
    expect(result.results).to.have.length(2);

    // Find results by channel name
    const success = result.results.find((r: any) => r.channel === allowedChannel) as any;
    const failure = result.results.find((r: any) => r.channel === deniedChannel) as any;

    // Allowed channel succeeds (presence is empty since realtime was closed;
    // server may omit the presence field entirely for empty channels)
    expect(success).to.exist;
    expect('error' in success).to.be.false;

    // Denied channel fails with capability error
    expect(failure).to.exist;
    expect(failure.error).to.exist;
    expect(failure.error.code).to.equal(40160);
    expect(failure.error.statusCode).to.equal(401);
  });

  /**
   * RSC24 - batchPresence with empty channel returns empty presence array
   *
   * A channel with no presence members returns a success result with an empty
   * presence array (or no presence field, depending on server behaviour).
   */
  // UTS: rest/integration/RSC24/empty-channel-presence-2
  it('RSC24 - batchPresence with empty channel returns empty presence array', async function () {
    const emptyChannel = uniqueChannelName('batch-empty');
    const populatedChannel = uniqueChannelName('batch-populated');

    // Enter a member on only the populated channel
    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(realtime);
    await connectAndWait(realtime);

    const ch = realtime.channels.get(populatedChannel);
    await ch.attach();
    await ch.presence.enterClient('someone', 'here');

    // Keep realtime open during the REST query so the presence member persists
    const rest = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const result = await rest.batchPresence([emptyChannel, populatedChannel]);

    expect(result.successCount).to.equal(2);
    expect(result.failureCount).to.equal(0);
    expect(result.results).to.have.length(2);

    const emptyResult = result.results.find((r: any) => r.channel === emptyChannel) as any;
    const populatedResult = result.results.find((r: any) => r.channel === populatedChannel) as any;

    // Empty channel succeeds with no members.
    // The server omits the presence field for empty channels, so we check
    // that the result has no error, and that presence is either missing or empty.
    expect(emptyResult).to.exist;
    expect('error' in emptyResult).to.be.false;
    const emptyPresence = emptyResult.presence || [];
    expect(emptyPresence).to.have.length(0);

    // Populated channel succeeds with the member
    expect(populatedResult).to.exist;
    expect(populatedResult.presence).to.be.an('array').with.length(1);
    expect(populatedResult.presence[0].clientId).to.equal('someone');

    await closeAndWait(realtime);
  });
});
