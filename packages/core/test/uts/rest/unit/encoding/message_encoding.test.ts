/**
 * UTS: Message Encoding Tests
 *
 * Spec points: RSL4, RSL4a, RSL4b, RSL4c, RSL4d, RSL6, RSL6a, RSL6b
 * Source: uts/test/rest/unit/encoding/message_encoding.md
 *
 * Skipped:
 * - Msgpack-specific tests (RSL4c msgpack, RSL6 msgpack bin/str) — mock doesn't support msgpack responses
 * - Encoding fixtures from ably-common — separate fixture-based tests
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

function publishMock() {
  const captured: any[] = [];
  const mock = new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      captured.push(req);
      req.respond_with(201, { serials: ['s1'] });
    },
  });
  return { mock, captured };
}

function historyMock(messages: any) {
  const mock = new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      req.respond_with(200, messages);
    },
  });
  return mock;
}

describe('uts/rest/unit/encoding/message_encoding', function () {
  afterEach(function () {
    restoreAll();
  });

  // ── Encoding (RSL4) ──────────────────────────────────────────────

  /**
   * RSL4a - String data transmitted without encoding
   */
  // UTS: rest/unit/RSL4a/string-data-no-encoding-0
  it('RSL4a - string data has no encoding', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.channels.get('test').publish('event', 'plain string data');

    const body = JSON.parse(captured[0].body);
    expect(body[0].data).to.equal('plain string data');
    expect(body[0].encoding).to.satisfy((v: any) => v === undefined || v === null);
  });

  /**
   * RSL4b - JSON object serialized with encoding: "json"
   */
  // UTS: rest/unit/RSL4b/json-object-encoding-0
  it('RSL4b - object data JSON-encoded', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.channels.get('test').publish('event', { key: 'value', nested: { a: 1 } });

    const body = JSON.parse(captured[0].body);
    expect(body[0].encoding).to.equal('json');
    expect(typeof body[0].data).to.equal('string');
    expect(JSON.parse(body[0].data)).to.deep.equal({ key: 'value', nested: { a: 1 } });
  });

  /**
   * RSL4c - Binary data base64-encoded with JSON protocol
   */
  // UTS: rest/unit/RSL4c/binary-base64-json-protocol-0
  it('RSL4c - binary data base64-encoded for JSON protocol', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const binaryData = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]);
    await client.channels.get('test').publish('event', binaryData);

    const body = JSON.parse(captured[0].body);
    expect(body[0].encoding).to.equal('base64');
    const decoded = Buffer.from(body[0].data, 'base64');
    expect(Buffer.compare(decoded, binaryData)).to.equal(0);
  });

  /**
   * RSL4d - Array data JSON-encoded
   */
  // UTS: rest/unit/RSL4d/array-json-encoding-0
  it('RSL4d - array data JSON-encoded', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.channels.get('test').publish('event', [1, 2, 'three', { four: 4 }]);

    const body = JSON.parse(captured[0].body);
    expect(body[0].encoding).to.equal('json');
    expect(JSON.parse(body[0].data)).to.deep.equal([1, 2, 'three', { four: 4 }]);
  });

  /**
   * RSL4 - Null data transmitted without encoding
   */
  // UTS: rest/unit/RSL4/null-data-no-encoding-1
  it('RSL4 - null data has no encoding', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.channels.get('test').publish('event', null);

    const body = JSON.parse(captured[0].body);
    expect(body[0].data).to.satisfy((v: any) => v === undefined || v === null);
    expect(body[0].encoding).to.satisfy((v: any) => v === undefined || v === null);
  });

  /**
   * RSL4 - Empty string transmitted without encoding
   */
  // UTS: rest/unit/RSL4/empty-string-no-encoding-4
  it('RSL4 - empty string has no encoding', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.channels.get('test').publish('event', '');

    const body = JSON.parse(captured[0].body);
    expect(body[0].data).to.equal('');
    expect(body[0].encoding).to.satisfy((v: any) => v === undefined || v === null);
  });

  /**
   * RSL4 - Empty array JSON-encoded
   */
  // UTS: rest/unit/RSL4/empty-array-json-encoding-5
  it('RSL4 - empty array JSON-encoded', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.channels.get('test').publish('event', []);

    const body = JSON.parse(captured[0].body);
    expect(body[0].encoding).to.equal('json');
    expect(JSON.parse(body[0].data)).to.deep.equal([]);
  });

  /**
   * RSL4 - Empty object JSON-encoded
   */
  // UTS: rest/unit/RSL4/encoding-fixtures-ably-common-0
  it('RSL4 - empty object JSON-encoded', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.channels.get('test').publish('event', {});

    const body = JSON.parse(captured[0].body);
    expect(body[0].encoding).to.equal('json');
    expect(JSON.parse(body[0].data)).to.deep.equal({});
  });

  /**
   * RSL4 - JSON protocol uses application/json content-type
   */
  // UTS: rest/unit/RSL4/json-protocol-content-type-2
  it('RSL4 - JSON protocol content-type', async function () {
    const { mock, captured } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    await client.channels.get('test').publish('event', 'test');

    expect(captured[0].headers['content-type']).to.include('application/json');
    expect(captured[0].headers['accept']).to.include('application/json');
  });

  // ── Decoding (RSL6) ──────────────────────────────────────────────

  /**
   * RSL6a - Decode base64 data to binary
   */
  // UTS: rest/unit/RSL6a/decode-base64-to-binary-0
  it('RSL6a - base64 decoded to Buffer', async function () {
    installMockHttp(
      historyMock([{ id: 'msg1', name: 'event', data: 'AAECAwQ=', encoding: 'base64', timestamp: 1234567890000 }]),
    );

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.channels.get('test').history(null);

    expect(Buffer.isBuffer(result.items[0].data)).to.be.true;
    expect(Buffer.compare(result.items[0].data, Buffer.from([0, 1, 2, 3, 4]))).to.equal(0);
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSL6a - Decode JSON string to native object
   */
  // UTS: rest/unit/RSL6a/decode-json-to-object-1
  it('RSL6a - json decoded to object', async function () {
    installMockHttp(
      historyMock([
        { id: 'msg1', name: 'event', data: '{"key":"value","number":42}', encoding: 'json', timestamp: 1234567890000 },
      ]),
    );

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.channels.get('test').history(null);

    expect(result.items[0].data).to.deep.equal({ key: 'value', number: 42 });
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSL6a - Chained encoding json/base64 decoded in reverse order
   */
  // UTS: rest/unit/RSL6a/decode-chained-encodings-2
  it('RSL6a - chained json/base64 decoded', async function () {
    // {"key":"value"} → base64 = eyJrZXkiOiJ2YWx1ZSJ9
    const base64OfJson = Buffer.from('{"key":"value"}').toString('base64');

    installMockHttp(
      historyMock([
        { id: 'msg1', name: 'event', data: base64OfJson, encoding: 'json/base64', timestamp: 1234567890000 },
      ]),
    );

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.channels.get('test').history(null);

    expect(result.items[0].data).to.deep.equal({ key: 'value' });
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSL6 - utf-8/base64 decoded to string
   */
  // UTS: rest/unit/RSL6/decode-utf8-base64-data-2
  it('RSL6 - utf-8/base64 decoded to string', async function () {
    // "Hello World" → base64 = SGVsbG8gV29ybGQ=
    installMockHttp(
      historyMock([
        { id: 'msg1', name: 'event', data: 'SGVsbG8gV29ybGQ=', encoding: 'utf-8/base64', timestamp: 1234567890000 },
      ]),
    );

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.channels.get('test').history(null);

    expect(result.items[0].data).to.equal('Hello World');
    expect(typeof result.items[0].data).to.equal('string');
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSL6 - Complex chained encoding json/utf-8/base64
   */
  // UTS: rest/unit/RSL6/complex-chained-encoding-3
  it('RSL6 - json/utf-8/base64 fully decoded', async function () {
    const obj = { status: 'active', count: 5 };
    const base64Data = Buffer.from(JSON.stringify(obj)).toString('base64');

    installMockHttp(
      historyMock([
        { id: 'msg1', name: 'event', data: base64Data, encoding: 'json/utf-8/base64', timestamp: 1234567890000 },
      ]),
    );

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.channels.get('test').history(null);

    expect(result.items[0].data).to.deep.equal({ status: 'active', count: 5 });
    expect(result.items[0].encoding).to.be.null;
  });

  /**
   * RSL6b - Unrecognized encoding preserved
   */
  // UTS: rest/unit/RSL6b/unrecognized-encoding-preserved-0
  it('RSL6b - unrecognized encoding preserved', async function () {
    // base64 of "encrypted-data"
    const base64Data = Buffer.from('encrypted-data').toString('base64');

    installMockHttp(
      historyMock([
        { id: 'msg1', name: 'event', data: base64Data, encoding: 'custom-encryption/base64', timestamp: 1234567890000 },
      ]),
    );

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.channels.get('test').history(null);

    // base64 should be decoded, but custom-encryption is unrecognized and preserved
    expect(result.items[0].encoding).to.equal('custom-encryption');
    // Data is the base64-decoded bytes (not further processed)
    expect(Buffer.isBuffer(result.items[0].data)).to.be.true;
  });

  /**
   * RSL6a - String data without encoding passes through
   */
  // UTS: rest/unit/RSL4a/string-data-no-encoding-0.1
  it('RSL6a - string data without encoding passes through', async function () {
    installMockHttp(historyMock([{ id: 'msg1', name: 'event', data: 'plain text', timestamp: 1234567890000 }]));

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const result = await client.channels.get('test').history(null);

    expect(result.items[0].data).to.equal('plain text');
    expect(typeof result.items[0].data).to.equal('string');
  });

  /**
   * RSL4a - Number data type rejected
   *
   * Per RSL4a: payloads must be binary, strings, or objects capable of
   * JSON representation. Any other data type should result in an error.
   */
  // UTS: rest/unit/RSL4a/number-type-rejected-1
  it('RSL4a - number data type rejected', async function () {
    const { mock } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    try {
      await client.channels.get('test').publish('event', 42);
      expect.fail('Expected publish to throw');
    } catch (e: any) {
      expect(e.code).to.equal(40013);
    }
  });

  /**
   * RSL4a - Boolean data type rejected
   *
   * Per RSL4a: payloads must be binary, strings, or objects capable of
   * JSON representation. Any other data type should result in an error.
   */
  // UTS: rest/unit/RSL4a/boolean-type-rejected-2
  it('RSL4a - boolean data type rejected', async function () {
    const { mock } = publishMock();
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    try {
      await client.channels.get('test').publish('event', true);
      expect.fail('Expected publish to throw');
    } catch (e: any) {
      expect(e.code).to.equal(40013);
    }
  });

  // ---------------------------------------------------------------------------
  // MsgPack tests — PENDING (mock HTTP does not support msgpack encoding)
  // ---------------------------------------------------------------------------

  // UTS: rest/unit/RSL4c/binary-direct-msgpack-protocol-1
  it('RSL4c - binary data with msgpack protocol', function () {
    // PENDING: Requires mock msgpack encoding support. See deviations.md.
    this.skip();
  });

  // UTS: rest/unit/RSL6/msgpack-binary-stays-binary-0
  it('RSL6 - msgpack bin type decoded to Buffer', function () {
    // PENDING: Requires mock msgpack encoding support. See deviations.md.
    this.skip();
  });

  // UTS: rest/unit/RSL6/msgpack-string-stays-string-1
  it('RSL6 - msgpack str type decoded to string', function () {
    // PENDING: Requires mock msgpack encoding support. See deviations.md.
    this.skip();
  });

  // UTS: rest/unit/RSL4/msgpack-protocol-content-type-3
  it.skip('RSL4 - msgpack protocol content type (msgpack not supported)', function () {
    // DEVIATION: ably-js does not support msgpack protocol
  });
});
