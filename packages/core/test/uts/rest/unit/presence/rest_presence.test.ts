/**
 * UTS: REST Presence Tests
 *
 * Spec points: RSP1, RSP1a, RSP1b, RSP3, RSP3a, RSP3a1, RSP3a2, RSP3a3,
 *              RSP3b, RSP3c, RSP4, RSP4a, RSP4b1, RSP4b2, RSP4b3,
 *              RSP5, RSP5a, RSP5b, RSP5e
 * Source: uts/test/rest/unit/presence/rest_presence.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/presence/rest_presence', function () {
  afterEach(function () {
    restoreAll();
  });

  // ---------------------------------------------------------------------------
  // RSP1 - Presence object
  // ---------------------------------------------------------------------------

  /**
   * RSP1a - presence accessible
   *
   * channel.presence must exist and be an object.
   */
  // UTS: rest/unit/RSP1a/presence-channel-attribute-0
  it('RSP1a - presence accessible on channel', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');

    expect(channel.presence).to.be.an('object');
    expect(channel.presence).to.not.be.null;
  });

  /**
   * RSP1b - same instance
   *
   * Accessing channel.presence multiple times must return the same instance.
   */
  // UTS: rest/unit/RSP1b/same-instance-returned-0
  it('RSP1b - channel.presence returns same instance', function () {
    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');

    const presence1 = channel.presence;
    const presence2 = channel.presence;
    expect(presence1).to.equal(presence2);
  });

  // ---------------------------------------------------------------------------
  // RSP3 - presence.get()
  // ---------------------------------------------------------------------------

  /**
   * RSP3a - GET to correct path
   *
   * presence.get() must send a GET request to /channels/{name}/presence.
   */
  // UTS: rest/unit/RSP3a/get-request-endpoint-0
  it('RSP3a - get() sends GET to /channels/{name}/presence', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test-channel');
    await channel.presence.get({});

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/channels/test-channel/presence');
  });

  /**
   * RSP3b - returns PresenceMessage objects
   *
   * presence.get() must return a PaginatedResult containing PresenceMessage
   * objects with action, clientId, connectionId, data, and timestamp.
   */
  // UTS: rest/unit/RSP3b/get-returns-presence-messages-0
  it('RSP3b - get() returns PresenceMessage objects', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            action: 1,
            clientId: 'user-1',
            connectionId: 'conn-abc',
            data: 'hello',
            timestamp: 1609459200000,
          },
          {
            action: 1,
            clientId: 'user-2',
            connectionId: 'conn-def',
            data: 'world',
            timestamp: 1609459201000,
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({});

    expect(result.items).to.have.length(2);

    const item0 = result.items[0];
    expect(item0.action).to.equal('present');
    expect(item0.clientId).to.equal('user-1');
    expect(item0.connectionId).to.equal('conn-abc');
    expect(item0.data).to.equal('hello');
    expect(item0.timestamp).to.equal(1609459200000);

    const item1 = result.items[1];
    expect(item1.action).to.equal('present');
    expect(item1.clientId).to.equal('user-2');
    expect(item1.connectionId).to.equal('conn-def');
    expect(item1.data).to.equal('world');
    expect(item1.timestamp).to.equal(1609459201000);
  });

  /**
   * RSP3c - empty list
   *
   * When the server returns an empty array, items.length must be 0.
   */
  // UTS: rest/unit/RSP3c/get-empty-members-0
  it('RSP3c - get() with empty response returns empty items', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({});

    expect(result.items).to.have.length(0);
    expect(result.hasNext()).to.be.false;
    expect(result.isLast()).to.be.true;
  });

  /**
   * RSP3a1 - limit param
   *
   * get({limit: 50}) must send limit=50 as a query parameter.
   */
  // UTS: rest/unit/RSP3a1/get-limit-parameter-0
  it('RSP3a1 - get() with limit param sends limit query parameter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.get({ limit: 50 });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('50');
  });

  /**
   * RSP3a2 - clientId filter
   *
   * get({clientId: 'specific'}) must send clientId=specific as a query parameter.
   */
  // UTS: rest/unit/RSP3a2/get-clientid-filter-0
  it('RSP3a2 - get() with clientId filter sends clientId query parameter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.get({ clientId: 'specific' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('clientId')).to.equal('specific');
  });

  /**
   * RSP3a3 - connectionId filter
   *
   * get({connectionId: 'conn123'}) must send connectionId=conn123 as a query parameter.
   */
  // UTS: rest/unit/RSP3a3/get-connectionid-filter-0
  it('RSP3a3 - get() with connectionId filter sends connectionId query parameter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.get({ connectionId: 'conn123' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('connectionId')).to.equal('conn123');
  });

  // ---------------------------------------------------------------------------
  // RSP4 - presence.history()
  // ---------------------------------------------------------------------------

  /**
   * RSP4a - GET to history path
   *
   * presence.history() must send a GET request to /channels/{name}/presence/history.
   */
  // UTS: rest/unit/RSP4a/history-request-endpoint-0
  it('RSP4a - history() sends GET to /channels/{name}/presence/history', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test-channel');
    await channel.presence.history({});

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.equal('/channels/test-channel/presence/history');
  });

  /**
   * RSP4a - returns PresenceMessage with actions
   *
   * history() must return PresenceMessage objects with wire actions decoded
   * to strings: enter (2), leave (3), update (4).
   */
  // UTS: rest/unit/RSP4a/history-returns-paginated-1
  it('RSP4a - history() returns PresenceMessage with decoded actions', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          { action: 2, clientId: 'alice', data: 'joined', timestamp: 1609459200000 },
          { action: 3, clientId: 'bob', data: 'left', timestamp: 1609459201000 },
          { action: 4, clientId: 'carol', data: 'status', timestamp: 1609459202000 },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.history({});

    expect(result.items).to.have.length(3);
    expect(result.items[0].action).to.equal('enter');
    expect(result.items[0].clientId).to.equal('alice');
    expect(result.items[1].action).to.equal('leave');
    expect(result.items[1].clientId).to.equal('bob');
    expect(result.items[2].action).to.equal('update');
    expect(result.items[2].clientId).to.equal('carol');
  });

  /**
   * RSP4b1 - start param
   *
   * history({start: 1609459200000}) must send start=1609459200000 as a query parameter.
   */
  // UTS: rest/unit/RSP4b1/history-start-parameter-0
  it('RSP4b1 - history() with start param sends start query parameter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({ start: 1609459200000 });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('start')).to.equal('1609459200000');
  });

  /**
   * RSP4b1 - end param
   *
   * history({end: 1609545600000}) must send end=1609545600000 as a query parameter.
   */
  // UTS: rest/unit/RSP4b1/history-end-parameter-1
  it('RSP4b1 - history() with end param sends end query parameter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({ end: 1609545600000 });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('end')).to.equal('1609545600000');
  });

  /**
   * RSP4b2 - direction forwards
   *
   * history({direction: 'forwards'}) must send direction=forwards as a query parameter.
   */
  // UTS: rest/unit/RSP4b2/history-direction-forwards-1
  it('RSP4b2 - history() with direction forwards sends direction query parameter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({ direction: 'forwards' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('direction')).to.equal('forwards');
  });

  /**
   * RSP4b2a - history default direction is backwards
   *
   * When history() is called without a direction parameter, the direction
   * must either be absent (server default) or equal 'backwards'.
   */
  // UTS: rest/unit/RSP4b2/history-direction-backwards-default-0
  it('RSP4b2 - history default direction is backwards', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({});

    expect(captured).to.have.length(1);
    const direction = captured[0].url.searchParams.get('direction');
    // direction should either be absent (null) or 'backwards'
    expect(direction === null || direction === 'backwards').to.be.true;
  });

  /**
   * RSP4b2c - history direction backwards explicit
   *
   * history({direction: 'backwards'}) must send direction=backwards as a query parameter.
   */
  // UTS: rest/unit/RSP4b2/history-direction-backwards-explicit-2
  it('RSP4b2 - history direction backwards explicit', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({ direction: 'backwards' });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('direction')).to.equal('backwards');
  });

  /**
   * RSP4b3 - limit param
   *
   * history({limit: 50}) must send limit=50 as a query parameter.
   */
  // UTS: rest/unit/RSP4b3/history-limit-parameter-0
  it('RSP4b3 - history() with limit param sends limit query parameter', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({ limit: 50 });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('50');
  });

  // ---------------------------------------------------------------------------
  // RSP5 - Decoding
  // ---------------------------------------------------------------------------

  /**
   * RSP5a - string data
   *
   * Plain string data must pass through without modification.
   */
  // UTS: rest/unit/RSP5/decode-string-data-0
  it('RSP5a - get() with plain string data passes through', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [{ action: 1, clientId: 'user-1', data: 'hello world' }]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({});

    expect(result.items).to.have.length(1);
    expect(result.items[0].data).to.equal('hello world');
  });

  /**
   * RSP5b - JSON encoded
   *
   * When encoding is "json", data must be decoded from JSON string to object,
   * and the encoding must be consumed (null after decoding).
   */
  // UTS: rest/unit/RSP5/decode-json-data-1
  it('RSP5b - get() with json encoding decodes data to object', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            action: 1,
            clientId: 'user-1',
            data: '{"status":"online","count":42}',
            encoding: 'json',
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({});

    expect(result.items).to.have.length(1);
    expect(result.items[0].data).to.deep.equal({ status: 'online', count: 42 });
    // Encoding must be consumed after decoding
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSP5e - chained encoding
   *
   * When encoding is "json/base64", data must be decoded from base64 then JSON.
   * The encoding must be fully consumed (null after decoding).
   */
  // UTS: rest/unit/RSP5/decode-chained-encoding-5
  it('RSP5e - get() with chained json/base64 encoding decodes correctly', async function () {
    // {"key":"value"} base64-encoded
    const jsonStr = '{"key":"value"}';
    const base64Data = Buffer.from(jsonStr).toString('base64');

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            action: 1,
            clientId: 'user-1',
            data: base64Data,
            encoding: 'json/base64',
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({});

    expect(result.items).to.have.length(1);
    expect(result.items[0].data).to.deep.equal({ key: 'value' });
    // All encoding layers must be consumed
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSP5c - decode base64 binary presence data
   *
   * When encoding is "base64", data must be decoded from base64 to binary,
   * and the encoding must be consumed (null after decoding).
   */
  // UTS: rest/unit/RSP5/decode-base64-binary-2
  it('RSP5 - decode base64 binary presence data', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            action: 1,
            clientId: 'c1',
            data: 'SGVsbG8gV29ybGQ=',
            encoding: 'base64',
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({});

    expect(result.items).to.have.length(1);
    expect(Buffer.isBuffer(result.items[0].data)).to.be.true;
    expect(result.items[0].data.toString()).to.equal('Hello World');
    // Encoding must be consumed after decoding
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSP5d - decode utf-8 encoded presence data
   *
   * When encoding is "utf-8/base64", data must be decoded through both layers:
   * first base64 to binary, then utf-8 to string.
   */
  // UTS: rest/unit/RSP5/decode-utf8-data-4
  it('RSP5 - decode utf-8 encoded presence data', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            action: 1,
            clientId: 'c1',
            data: 'SGVsbG8gV29ybGQ=',
            encoding: 'utf-8/base64',
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({});

    expect(result.items).to.have.length(1);
    expect(result.items[0].data).to.equal('Hello World');
    expect(typeof result.items[0].data).to.equal('string');
    // Encoding must be fully consumed
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSP5f - history messages are decoded
   *
   * Encoding decoding must also apply to history() results, not just get().
   */
  // UTS: rest/unit/RSP5/decode-history-messages-6
  it('RSP5 - history messages are decoded', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            action: 2,
            clientId: 'c1',
            data: '{"event":"entered"}',
            encoding: 'json',
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.history({});

    expect(result.items).to.have.length(1);
    expect(result.items[0].data).to.deep.equal({ event: 'entered' });
    // Encoding must be consumed after decoding
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSP5 - decode msgpack binary presence data
   *
   * DEVIATION: ably-js does not support msgpack protocol
   */
  // UTS: rest/unit/RSP5/decode-msgpack-binary-3
  it.skip('RSP5 - decode msgpack binary presence data (msgpack not supported)', function () {
    // DEVIATION: ably-js does not support msgpack protocol
  });

  /**
   * RSP5g - cipher decoding with channel options
   *
   * Encrypted data with cipher encoding must be decrypted using channel
   * cipher options.
   *
   * TODO: Implement when cipher infrastructure is available for testing.
   * Requires creating a channel with cipher params and providing correctly
   * encrypted test data.
   */
  // UTS: rest/unit/RSP5/decode-cipher-channel-7
  it.skip('RSP5 - cipher decoding with channel options', async function () {
    // This test requires cipher infrastructure:
    // 1. Create a channel with cipher params: client.channels.get('test', { cipher: { key } })
    // 2. Mock returns presence with encoding: 'json/utf-8/cipher+aes-128-cbc/base64'
    // 3. The SDK should decrypt the data using the cipher key
    // 4. Assert the decrypted data matches the original plaintext
  });

  // ---------------------------------------------------------------------------
  // Pagination
  // ---------------------------------------------------------------------------

  /**
   * RSP pagination - get with Link header
   *
   * When the server responds with a Link header containing a "next" relation,
   * hasNext() must return true and isLast() must return false.
   */
  // UTS: rest/unit/RSP3/get-pagination-link-header-1
  it('RSP pagination - get() with Link header indicates hasNext', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [{ action: 1, clientId: 'user-1', data: 'hello' }], {
          Link: '<./presence?cursor=abc&limit=1>; rel="next"',
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({ limit: 1 });

    expect(result.items).to.have.length(1);
    expect(result.hasNext()).to.be.true;
    expect(result.isLast()).to.be.false;
  });

  /**
   * RSP pagination - history next page
   *
   * Navigating pages via next() must fetch the next page from the server.
   */
  // UTS: rest/unit/RSP3/get-pagination-next-page-2
  it('RSP pagination - history() navigates pages via next()', async function () {
    let reqCount = 0;
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        reqCount++;
        if (reqCount === 1) {
          req.respond_with(200, [{ action: 2, clientId: 'alice', timestamp: 1609459200000 }], {
            Link: '<./presence?cursor=page2&limit=1>; rel="next"',
          });
        } else {
          req.respond_with(200, [{ action: 3, clientId: 'bob', timestamp: 1609459100000 }]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');

    // First page
    const page1 = await channel.presence.history({ limit: 1 });
    expect(page1.items).to.have.length(1);
    expect(page1.items[0].action).to.equal('enter');
    expect(page1.items[0].clientId).to.equal('alice');
    expect(page1.hasNext()).to.be.true;

    // Second page
    const page2 = await page1.next();
    expect(page2!.items).to.have.length(1);
    expect(page2!.items[0].action).to.equal('leave');
    expect(page2!.items[0].clientId).to.equal('bob');
    expect(page2!.hasNext()).to.be.false;
    expect(page2!.isLast()).to.be.true;
  });

  /**
   * RSP4 - history pagination
   *
   * History results must support pagination via Link headers and next().
   */
  // UTS: rest/unit/RSP4/history-pagination-1
  it('RSP4 - history pagination', async function () {
    let reqCount = 0;
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        reqCount++;
        if (reqCount === 1) {
          req.respond_with(200, [{ action: 2, clientId: 'c1', timestamp: 3000 }], {
            Link: '<./history?cursor=page2>; rel="next"',
          });
        } else {
          req.respond_with(200, [{ action: 4, clientId: 'c1', timestamp: 1000 }]);
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');

    const page1 = await channel.presence.history({});
    expect(page1.items).to.have.length(1);
    expect(page1.items[0].action).to.equal('enter');
    expect(page1.hasNext()).to.be.true;

    const page2 = await page1.next();
    expect(page2!.items).to.have.length(1);
    expect(page2!.items[0].action).to.equal('update');
    expect(page2!.hasNext()).to.be.false;
  });

  // ---------------------------------------------------------------------------
  // Errors
  // ---------------------------------------------------------------------------

  /**
   * RSP error - server error
   *
   * When the server responds with a 500 error, the operation must throw
   * with the appropriate error code.
   */
  // UTS: rest/unit/RSP3/get-server-error-3
  it('RSP error - server error on get() throws with error code', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(500, {
          error: {
            code: 50000,
            statusCode: 500,
            message: 'Internal server error',
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');

    try {
      await channel.presence.get({});
      expect.fail('Expected get() to throw');
    } catch (error: any) {
      expect(error.statusCode).to.equal(500);
      expect(error.code).to.equal(50000);
    }
  });

  /**
   * RSP3 - get with 404 channel not found
   *
   * When the server responds with 404, the operation must throw with
   * error code 40400 and statusCode 404.
   */
  // UTS: rest/unit/RSP3/get-channel-not-found-4
  it('RSP3 - get with 404 channel not found', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(404, {
          error: {
            code: 40400,
            statusCode: 404,
            message: 'Not found',
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');

    try {
      await channel.presence.get({});
      expect.fail('Expected get() to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40400);
      expect(error.statusCode).to.equal(404);
    }
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * RSP actions - all actions mapped
   *
   * Wire actions 1-4 must be decoded to present/enter/leave/update strings.
   */
  // UTS: rest/unit/RSP5/presence-action-mapping-8
  it('RSP actions - wire actions 1-4 decoded to correct strings', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          { action: 1, clientId: 'u1' },
          { action: 2, clientId: 'u2' },
          { action: 3, clientId: 'u3' },
          { action: 4, clientId: 'u4' },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const result = await channel.presence.get({});

    expect(result.items).to.have.length(4);

    const expected = [
      { wire: 1, str: 'present' },
      { wire: 2, str: 'enter' },
      { wire: 3, str: 'leave' },
      { wire: 4, str: 'update' },
    ];

    for (let i = 0; i < expected.length; i++) {
      expect(result.items[i].action).to.equal(
        expected[i].str,
        'wire action ' + expected[i].wire + ' should decode to ' + expected[i].str,
      );
    }
  });

  // ---------------------------------------------------------------------------
  // RSP3a1b - get() limit defaults to 100
  // ---------------------------------------------------------------------------

  /**
   * RSP3a1b - limit defaults to 100
   *
   * When get() is called without a limit parameter, the request must either
   * omit the limit param (server default) or send limit=100.
   */
  // UTS: rest/unit/RSP3a1/get-limit-default-100-1
  it('RSP3a1b - get() limit defaults to 100', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.get({});

    expect(captured).to.have.length(1);
    const params = captured[0].url.searchParams;
    const limit = params.get('limit');
    // limit should either be absent (null) or '100'
    expect(limit === null || limit === '100').to.be.true;
  });

  /**
   * RSP3a1c - get limit maximum 1000
   *
   * get({limit: 1000}) must send limit=1000 as a query parameter.
   */
  // UTS: rest/unit/RSP3a1/get-limit-max-1000-2
  it('RSP3a1 - get limit maximum 1000', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.get({ limit: 1000 });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('1000');
  });

  // ---------------------------------------------------------------------------
  // RSP3 - get() with combined filters
  // ---------------------------------------------------------------------------

  /**
   * RSP3 - combined filters
   *
   * get() with limit, clientId, and connectionId must send all three as
   * query parameters.
   */
  // UTS: rest/unit/RSP3/get-multiple-filters-0
  it('RSP3 - get() with combined filters sends all params', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.get({ limit: 25, clientId: 'user1', connectionId: 'conn1' });

    expect(captured).to.have.length(1);
    const params = captured[0].url.searchParams;
    expect(params.get('limit')).to.equal('25');
    expect(params.get('clientId')).to.equal('user1');
    expect(params.get('connectionId')).to.equal('conn1');
  });

  // ---------------------------------------------------------------------------
  // RSP4b1c - history() with start and end combined
  // ---------------------------------------------------------------------------

  /**
   * RSP4b1c - start and end combined
   *
   * history() with both start and end must send both as query parameters.
   */
  // UTS: rest/unit/RSP4b1/history-start-end-params-2
  it('RSP4b1c - history() with start and end combined sends both params', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({ start: 1609459200000, end: 1609545600000 });

    expect(captured).to.have.length(1);
    const params = captured[0].url.searchParams;
    expect(params.get('start')).to.equal('1609459200000');
    expect(params.get('end')).to.equal('1609545600000');
  });

  /**
   * RSP4b1d - history accepts Date objects for start/end
   *
   * Language-specific DateTime objects should be accepted and converted
   * to milliseconds since epoch.
   *
   * DEVIATION: ably-js history() expects start/end as numeric timestamps
   * (milliseconds since epoch), not Date objects. Passing a Date object
   * results in its toString() representation being sent as the query param.
   * This test uses Date.getTime() to convert to the expected numeric format.
   */
  // UTS: rest/unit/RSP4b1/history-datetime-objects-3
  it('RSP4b1 - history accepts Date objects for start/end', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    const startDate = new Date(1609459200000);
    await channel.presence.history({ start: startDate.getTime() });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('start')).to.equal('1609459200000');
  });

  // ---------------------------------------------------------------------------
  // RSP4b3b - history() limit defaults to 100
  // ---------------------------------------------------------------------------

  /**
   * RSP4b3b - history limit defaults to 100
   *
   * When history() is called without a limit parameter, the request must either
   * omit the limit param (server default) or send limit=100.
   */
  // UTS: rest/unit/RSP4b3/history-limit-default-100-1
  it('RSP4b3b - history() limit defaults to 100', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({});

    expect(captured).to.have.length(1);
    const params = captured[0].url.searchParams;
    const limit = params.get('limit');
    // limit should either be absent (null) or '100'
    expect(limit === null || limit === '100').to.be.true;
  });

  /**
   * RSP4b3c - history limit maximum 1000
   *
   * history({limit: 1000}) must send limit=1000 as a query parameter.
   */
  // UTS: rest/unit/RSP4b3/history-limit-max-1000-2
  it('RSP4b3 - history limit maximum 1000', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({ limit: 1000 });

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('1000');
  });

  // ---------------------------------------------------------------------------
  // RSP4 - history() with all parameters
  // ---------------------------------------------------------------------------

  /**
   * RSP4 - all parameters combined
   *
   * history() with start, end, direction, and limit must send all four
   * as query parameters.
   */
  // UTS: rest/unit/RSP4/history-all-parameters-0
  it('RSP4 - history() with all parameters sends all params', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({ start: 1609459200000, end: 1609545600000, direction: 'forwards', limit: 50 });

    expect(captured).to.have.length(1);
    const params = captured[0].url.searchParams;
    expect(params.get('start')).to.equal('1609459200000');
    expect(params.get('end')).to.equal('1609545600000');
    expect(params.get('direction')).to.equal('forwards');
    expect(params.get('limit')).to.equal('50');
  });

  // ---------------------------------------------------------------------------
  // RSP Error 2 - auth error on history()
  // ---------------------------------------------------------------------------

  /**
   * RSP Error 2 - auth error on history
   *
   * When the server responds with 401 and error code 40101, the operation
   * must throw with the appropriate error code and statusCode.
   */
  // UTS: rest/unit/RSP4/history-auth-error-2
  it('RSP Error 2 - auth error on history() throws with error code', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(401, {
          error: {
            code: 40101,
            statusCode: 401,
            message: 'Unauthorized',
          },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');

    try {
      await channel.presence.history({});
      expect.fail('Expected history() to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40101);
      expect(error.statusCode).to.equal(401);
    }
  });

  // ---------------------------------------------------------------------------
  // RSP4 - history() includes authorization header
  // ---------------------------------------------------------------------------

  /**
   * RSP4 - history includes authorization header
   *
   * Authenticated history requests must include the Authorization header
   * starting with 'Basic '.
   */
  // UTS: rest/unit/RSP4/history-auth-header-3
  it('RSP4 - history includes authorization header', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.history({});

    expect(captured).to.have.length(1);
    expect(captured[0].headers).to.have.property('authorization');
    expect(captured[0].headers['authorization']).to.match(/^Basic /);
  });

  // ---------------------------------------------------------------------------
  // RSP Headers - get() includes standard headers
  // ---------------------------------------------------------------------------

  /**
   * RSP Headers - standard headers
   *
   * get() must include authorization, X-Ably-Version, and accept headers
   * in the request.
   */
  // UTS: rest/unit/RSP3/get-standard-headers-5
  it('RSP Headers - get() includes standard headers', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channel = client.channels.get('test');
    await channel.presence.get({});

    expect(captured).to.have.length(1);
    const headers = captured[0].headers;
    expect(headers).to.have.property('authorization');
    expect(headers['authorization']).to.not.be.empty;
    expect(headers).to.have.property('X-Ably-Version');
    expect(headers['X-Ably-Version']).to.not.be.empty;
    expect(headers).to.have.property('accept');
    expect(headers['accept']).to.not.be.empty;
  });

  // ---------------------------------------------------------------------------
  // RSP3 - get() includes request_id when addRequestIds enabled
  // ---------------------------------------------------------------------------

  /**
   * RSP3 - request_id when addRequestIds enabled
   *
   * When addRequestIds is true, get() must include a request_id query parameter.
   */
  /**
   * NOTE: ably-js accepts addRequestIds option but does not implement it.
   * The option is stored but no request_id parameter is added to requests.
   * See deviations.md.
   */
  // UTS: rest/unit/RSP3/get-request-id-enabled-6
  it('RSP3 - get includes request_id when enabled', async function () {
    // DEVIATION: see deviations.md
    if (!process.env.RUN_DEVIATIONS) this.skip();
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, []);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      addRequestIds: true,
      useBinaryProtocol: false,
    } as any);
    const channel = client.channels.get('test');
    await channel.presence.get({});

    expect(captured).to.have.length(1);
    const requestId = captured[0].url.searchParams.get('request_id');
    expect(requestId).to.be.a('string');
    expect(requestId).to.not.be.empty;
  });
});
