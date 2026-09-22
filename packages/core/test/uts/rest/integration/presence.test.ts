/**
 * UTS Integration: REST Presence Tests
 *
 * Spec points: RSP1, RSP3, RSP3a, RSP4, RSP4b, RSP5
 * Source: uts/rest/integration/presence.md
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
  pollUntil,
} from './sandbox';
import { describeEachProtocol } from '../../helpers/protocol_variants';

describeEachProtocol('uts/rest/integration/presence', function (protocol) {
  this.timeout(120000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  // ---------------------------------------------------------------------------
  // RSP1 - RestPresence accessible via channel
  // ---------------------------------------------------------------------------

  /**
   * RSP1_Integration - Access presence from channel
   *
   * channel.presence must exist and not be null.
   */
  // UTS: rest/integration/RSP1/access-presence-from-channel-0
  it('RSP1_Integration - presence accessible on channel', function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channel = client.channels.get('persisted:presence_fixtures');
    const presence = channel.presence;

    expect(presence).to.not.be.null;
    expect(presence).to.not.be.undefined;
    expect(presence).to.be.an('object');
  });

  // ---------------------------------------------------------------------------
  // RSP3 - RestPresence#get
  // ---------------------------------------------------------------------------

  /**
   * RSP3_Integration_1 - Get presence members from fixture channel
   *
   * get() returns a PaginatedResult containing current presence members.
   * The fixture channel has at least 5 pre-populated members.
   */
  // UTS: rest/integration/RSP3/get-presence-members-0
  it('RSP3_Integration_1 - get returns presence members from fixture channel', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channel = client.channels.get('persisted:presence_fixtures');
    const result = await channel.presence.get({});

    expect(result.items).to.be.an('array');
    expect(result.items.length).to.be.at.least(5);

    // Verify expected clients are present
    const clientIds = result.items.map((msg: any) => msg.clientId);
    expect(clientIds).to.include('client_bool');
    expect(clientIds).to.include('client_string');
    expect(clientIds).to.include('client_json');
  });

  /**
   * RSP3_Integration_2 - Get returns PresenceMessage with correct fields
   *
   * Each item has action, clientId, data, and connectionId.
   */
  // UTS: rest/integration/RSP3/presence-message-fields-1
  it('RSP3_Integration_2 - get returns PresenceMessage with correct fields', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channel = client.channels.get('persisted:presence_fixtures');
    const result = await channel.presence.get({});

    // Find client_string member
    const member = result.items.find((msg: any) => msg.clientId === 'client_string');

    expect(member).to.not.be.undefined;
    expect(member!.action).to.equal('present');
    expect(member!.clientId).to.equal('client_string');
    expect(member!.data).to.equal('This is a string clientData payload');
    expect(member!.connectionId).to.not.be.null;
    expect(member!.connectionId).to.not.be.undefined;
  });

  /**
   * RSP3a1_Integration - Get with limit parameter
   *
   * limit param restricts the number of presence members returned.
   */
  // UTS: rest/integration/RSP3a1/get-with-limit-0
  it('RSP3a1_Integration - get with limit parameter', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channel = client.channels.get('persisted:presence_fixtures');
    const result = await channel.presence.get({ limit: 2 });

    expect(result.items.length).to.be.at.most(2);

    // If more members exist, pagination should be available
    if (result.hasNext()) {
      expect(result.items.length).to.equal(2);
    }
  });

  /**
   * RSP3a2_Integration - Get with clientId filter
   *
   * clientId param filters results to the specified client.
   */
  // UTS: rest/integration/RSP3a2/get-with-clientid-filter-0
  it('RSP3a2_Integration - get with clientId filter', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channel = client.channels.get('persisted:presence_fixtures');
    const result = await channel.presence.get({ clientId: 'client_json' });

    expect(result.items.length).to.equal(1);
    expect(result.items[0].clientId).to.equal('client_json');
    expect(result.items[0].data).to.be.a('string');
    expect(result.items[0].data).to.equal('{ "test": "This is a JSONObject clientData payload"}');
  });

  /**
   * RSP3_Integration_Empty - Get on channel with no presence
   *
   * get() returns empty PaginatedResult when no members are present.
   */
  // UTS: rest/integration/RSP3/get-empty-channel-2
  it('RSP3_Integration_Empty - get on empty channel returns empty result', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channelName = uniqueChannelName('presence-empty');
    const channel = client.channels.get(channelName);

    const result = await channel.presence.get({});

    expect(result.items).to.be.an('array');
    expect(result.items.length).to.equal(0);
    expect(result.hasNext()).to.be.false;
  });

  // ---------------------------------------------------------------------------
  // RSP4 - RestPresence#history
  // ---------------------------------------------------------------------------

  /**
   * RSP4_Integration_1 - History returns presence events
   *
   * Creates presence history by entering, updating, and leaving a channel
   * via a Realtime client, then retrieves history via REST.
   */
  // UTS: rest/integration/RSP4/history-returns-events-0
  it('RSP4_Integration_1 - history returns presence events', async function () {
    const channelName = uniqueChannelName('presence-history');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    // Use realtime client to generate presence history
    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      clientId: 'test-client',
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(realtime);

    await connectAndWait(realtime);

    const realtimeChannel = realtime.channels.get(channelName);
    await realtimeChannel.presence.enter('entered');
    await realtimeChannel.presence.update('updated');
    await realtimeChannel.presence.leave('left');

    await closeAndWait(realtime);

    // Poll REST history until events appear
    const restChannel = client.channels.get(channelName);

    const history = await pollUntil(
      async () => {
        const result = await restChannel.presence.history({});
        return result.items.length >= 3 ? result : null;
      },
      {
        interval: 500,
        timeout: 10000,
      },
    );

    expect(history!.items.length).to.be.at.least(3);

    // Check for expected actions (order depends on direction)
    const actions = history!.items.map((msg: any) => msg.action);
    expect(actions).to.include('enter');
    expect(actions).to.include('update');
    expect(actions).to.include('leave');
  });

  /**
   * RSP4b1_Integration - History with start/end time range
   *
   * start and end params filter history by timestamp range.
   */
  // UTS: rest/integration/RSP4b1/history-time-range-0
  it('RSP4b1_Integration - history with start/end time range', async function () {
    const channelName = uniqueChannelName('presence-history-time');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    // Record time before any presence events
    const timeBefore = Date.now();

    // Generate presence events via realtime
    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      clientId: 'time-test-client',
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(realtime);

    await connectAndWait(realtime);

    const realtimeChannel = realtime.channels.get(channelName);
    await realtimeChannel.presence.enter('test');
    await realtimeChannel.presence.leave();

    await closeAndWait(realtime);

    const timeAfter = Date.now();

    // Poll until events appear
    const restChannel = client.channels.get(channelName);
    await pollUntil(
      async () => {
        const result = await restChannel.presence.history({});
        return result.items.length >= 2 ? true : null;
      },
      {
        interval: 500,
        timeout: 10000,
      },
    );

    // Query with time range
    const history = await restChannel.presence.history({
      start: timeBefore,
      end: timeAfter,
    });

    expect(history.items.length).to.be.at.least(2);
  });

  /**
   * RSP4b2_Integration - History direction forwards
   *
   * direction param controls event ordering (forwards = oldest first).
   */
  // UTS: rest/integration/RSP4b2/history-direction-forwards-0
  it('RSP4b2_Integration - history direction forwards', async function () {
    const channelName = uniqueChannelName('presence-direction');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    // Generate ordered presence events
    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      clientId: 'direction-client',
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(realtime);

    await connectAndWait(realtime);

    const realtimeChannel = realtime.channels.get(channelName);
    await realtimeChannel.presence.enter('first');
    await realtimeChannel.presence.update('second');
    await realtimeChannel.presence.update('third');

    await closeAndWait(realtime);

    // Poll until events appear
    const restChannel = client.channels.get(channelName);
    await pollUntil(
      async () => {
        const result = await restChannel.presence.history({});
        return result.items.length >= 3 ? true : null;
      },
      {
        interval: 500,
        timeout: 10000,
      },
    );

    // Get history forwards (oldest first)
    const historyForwards = await restChannel.presence.history({ direction: 'forwards' });

    expect(historyForwards.items.length).to.be.at.least(3);
    expect(historyForwards.items[0].data).to.equal('first');

    // Get history backwards (newest first) - default
    const historyBackwards = await restChannel.presence.history({ direction: 'backwards' });

    expect(historyBackwards.items[0].data).to.equal('third');
  });

  /**
   * RSP4b3_Integration - History with limit and pagination
   *
   * limit param restricts history results and enables pagination.
   */
  // UTS: rest/integration/RSP4b3/history-limit-pagination-0
  it('RSP4b3_Integration - history with limit and pagination', async function () {
    const channelName = uniqueChannelName('presence-limit');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    // Generate multiple presence events
    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      clientId: 'limit-client',
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(realtime);

    await connectAndWait(realtime);

    const realtimeChannel = realtime.channels.get(channelName);
    for (let i = 1; i <= 5; i++) {
      await realtimeChannel.presence.update('update-' + i);
    }

    await closeAndWait(realtime);

    // Poll until all events appear
    const restChannel = client.channels.get(channelName);
    await pollUntil(
      async () => {
        const result = await restChannel.presence.history({});
        return result.items.length >= 5 ? true : null;
      },
      {
        interval: 500,
        timeout: 10000,
      },
    );

    // Request with small limit
    const page1 = await restChannel.presence.history({ limit: 2 });

    expect(page1.items.length).to.equal(2);
    expect(page1.hasNext()).to.be.true;

    // Get next page
    const page2 = await page1.next();

    expect(page2).to.not.be.null;
    expect(page2!.items.length).to.be.at.least(1);
  });

  // ---------------------------------------------------------------------------
  // RSP5 - Presence message decoding
  // ---------------------------------------------------------------------------

  /**
   * RSP5_Integration_1 - String data decoded correctly
   *
   * Presence message data is decoded according to its encoding.
   */
  // UTS: rest/integration/RSP5/decode-string-data-0
  it('RSP5_Integration_1 - string data decoded from fixtures', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channel = client.channels.get('persisted:presence_fixtures');
    const result = await channel.presence.get({ clientId: 'client_string' });

    expect(result.items.length).to.equal(1);
    expect(result.items[0].data).to.be.a('string');
    expect(result.items[0].data).to.equal('This is a string clientData payload');
  });

  /**
   * RSP5_Integration_2 - JSON data decoded to object
   *
   * JSON-encoded presence data is decoded to native objects.
   */
  // UTS: rest/integration/RSP5/decode-json-data-1
  it('RSP5_Integration_2 - JSON data decoded from fixtures', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channel = client.channels.get('persisted:presence_fixtures');
    const result = await channel.presence.get({ clientId: 'client_decoded' });

    expect(result.items.length).to.equal(1);
    expect(result.items[0].data).to.be.an('object');
    expect(result.items[0].data.example.json).to.equal('Object');
  });

  /**
   * RSP5_Integration_3 - Encrypted data decoded with cipher
   *
   * Encrypted presence data is automatically decrypted when cipher is configured.
   */
  // UTS: rest/integration/RSP5/decode-encrypted-data-2
  it('RSP5_Integration_3 - encrypted data decoded with cipher', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    const channel = client.channels.get('persisted:presence_fixtures', {
      cipher: { key: Buffer.from('WUP6u0K7MXI5Zeo0VppPwg==', 'base64') },
    });

    const result = await channel.presence.get({ clientId: 'client_encoded' });

    // The encrypted fixture should be decrypted
    expect(result.items.length).to.equal(1);
    expect(result.items[0].data).to.not.be.null;
    expect(result.items[0].data).to.not.be.undefined;
  });

  /**
   * RSP5_Integration_4 - History messages also decoded
   *
   * Presence history messages are decoded the same way as current presence.
   */
  // UTS: rest/integration/RSP5/decode-history-messages-3
  it('RSP5_Integration_4 - presence history with JSON data decoded', async function () {
    const channelName = uniqueChannelName('presence-decode-history');

    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    // Generate presence event with JSON data
    const realtime = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      clientId: 'decode-client',
      autoConnect: false,
      useBinaryProtocol: protocol === 'msgpack',
    });
    trackClient(realtime);

    await connectAndWait(realtime);

    const jsonData = { key: 'value', number: 123 };
    const realtimeChannel = realtime.channels.get(channelName);
    await realtimeChannel.presence.enter(jsonData);

    await closeAndWait(realtime);

    // Poll and retrieve history
    const restChannel = client.channels.get(channelName);
    const history = await pollUntil(
      async () => {
        const result = await restChannel.presence.history({});
        return result.items.length >= 1 ? result : null;
      },
      {
        interval: 500,
        timeout: 10000,
      },
    );

    expect(history!.items[0].data).to.be.an('object');
    expect(history!.items[0].data.key).to.equal('value');
    expect(history!.items[0].data.number).to.equal(123);
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  /**
   * RSP_Pagination_Integration - Full pagination through presence members
   *
   * Paginate through all fixture members with limit 2.
   */
  // UTS: rest/integration/RSP3/full-pagination-3
  it('RSP_Pagination_Integration - paginate through all fixture members', async function () {
    const client = new Ably.Rest({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    // The fixture channel has multiple members
    const channel = client.channels.get('persisted:presence_fixtures');

    // Request with small limit to force pagination
    const page1 = await channel.presence.get({ limit: 2 });

    const allMembers: any[] = [];
    allMembers.push(...page1.items);

    let currentPage: any = page1;
    while (currentPage.hasNext()) {
      currentPage = await currentPage.next();
      allMembers.push(...currentPage.items);
    }

    // Should have retrieved all fixture members
    expect(allMembers.length).to.be.at.least(5);

    // Verify no duplicates
    const clientIds = allMembers.map((m: any) => m.clientId);
    const uniqueClientIds = new Set(clientIds);
    expect(uniqueClientIds.size).to.equal(clientIds.length);
  });

  // ---------------------------------------------------------------------------
  // Error Handling
  // ---------------------------------------------------------------------------

  /**
   * RSP_Error_Integration_1 - Invalid credentials rejected
   *
   * Presence operations with invalid credentials return authentication errors.
   */
  // UTS: rest/integration/RSP3/invalid-credentials-rejected-4
  it('RSP_Error_Integration_1 - invalid credentials rejected', async function () {
    const client = new Ably.Rest({
      key: 'invalid.key:secret',
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    try {
      await client.channels.get('test').presence.get({});
      expect.fail('Expected presence.get() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(401);
      expect(error.code).to.be.at.least(40100);
      expect(error.code).to.be.below(40200);
    }
  });

  /**
   * RSP_Error_Integration_2 - Subscribe-only key can still do presence.get()
   *
   * Subscribe capability is sufficient for presence.get().
   */
  // UTS: rest/integration/RSP3/subscribe-capability-sufficient-5
  it('RSP_Error_Integration_2 - subscribe-only key can do presence.get()', async function () {
    const client = new Ably.Rest({
      key: getApiKey(3),
      endpoint: SANDBOX_ENDPOINT,
      useBinaryProtocol: protocol === 'msgpack',
    });

    // This should work - subscribe capability is sufficient for presence.get
    const result = await client.channels.get('persisted:presence_fixtures').presence.get({});
    expect(result).to.not.be.null;
    expect(result).to.not.be.undefined;
  });
});
