/**
 * UTS: RestObject Attribute and Get Tests
 *
 * Spec points: RSL16, RSL16b, RSO1, RSO1a, RSO2, RSO2a1, RSO2b, RSO2c, RSO2d, RSO2e, RSO2f, RSO2g,
 * RSO2g1, RSO2g2, RSO2g3, RSO2g4, RSO2h, RSO6, RSO8, RSO9, RSO9a, RSO9b, RSO9c, RSO9c1, RSO9c2,
 * RSO9d, RSO14, RSO15, RSO16
 * Source: uts/objects/unit/rest_object_get.md
 *
 * Tests the REST entry point to LiveObjects: the `RestChannel#object` attribute (`HttpChannel#object`
 * in ably-js), and `RestObject#get` (`HttpObject#get`) request formation and response decoding in
 * both compact and full modes.
 *
 * Wire shapes: the spec's response fixtures send `map.semantics` as the integer `0` and JSON leaves as
 * `{ string, encoding: "json" }`. The real REST endpoint returns `semantics: "LWW"` and JSON leaves as
 * `{ json: "<JSON-encoded string>" }` (verified against the sandbox), and ably-js decodes those shapes,
 * so these tests use the real wire shapes (see deviations.md, "objects: harness and wire-format
 * conventions").
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';

const msgpack = require('@ably/msgpack-js');

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** Query params of a captured request, URL-decoded. */
function queryParams(req: any): Record<string, string> {
  return Object.fromEntries(req.url.searchParams.entries());
}

/**
 * Port of the spec's `setup_rest_object(channel_name, response_body, use_binary_protocol)`.
 */
function setupRestObject(channelName: string, responseBody: any, useBinaryProtocol = false) {
  const capturedRequests: any[] = [];

  const mock = new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      capturedRequests.push(req);
      if (useBinaryProtocol) {
        req.respond_with(200, msgpack.encode(responseBody), { 'content-type': 'application/x-msgpack' });
      } else {
        // a bare string body would be passed through unencoded by the mock, so JSON-encode explicitly
        req.respond_with(200, JSON.stringify(responseBody), { 'content-type': 'application/json' });
      }
    },
  });
  installMockHttp(mock);

  const client = new Ably.Http({
    key: 'appId.keyId:keySecret',
    useBinaryProtocol,
    plugins: { LiveObjects: LiveObjectsPlugin },
  } as any);
  const channel = client.channels.get(channelName);

  return { client, channel, capturedRequests };
}

/** Like setupRestObject but uninstalls any previously installed mock first (for table-driven loops). */
function setupFresh(channelName: string, responseBody: any, useBinaryProtocol = false) {
  restoreAll();
  return setupRestObject(channelName, responseBody, useBinaryProtocol);
}

async function expectRejection(promise: Promise<any>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  expect.fail('Expected promise to reject');
}

describe('uts/objects/unit/rest_object_get', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSO1a - One RestObject instance per RestChannel
   */
  // UTS: objects/unit/RSO1a/one-instance-per-channel-0
  it('RSO1a - one HttpObject instance per channel', function () {
    const { client, channel } = setupRestObject('test-RSO1a-a-' + randomId(), {});
    const otherChannel = client.channels.get('test-RSO1a-b-' + randomId());

    expect(channel.object).to.equal(channel.object);
    expect(channel.object).to.not.equal(otherChannel.object);
  });

  /**
   * RSL16b - Accessing channel.object without the Objects plugin
   */
  // UTS: objects/unit/RSL16b/missing-plugin-error-0
  it('RSL16b - accessing channel.object without the plugin throws 40019', function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, {}),
    });
    installMockHttp(mock);

    const client = new Ably.Http({ key: 'appId.keyId:keySecret' });
    const channel = client.channels.get('test-RSL16b-' + randomId());

    let error: any;
    try {
      void channel.object;
    } catch (err) {
      error = err;
    }
    expect(error, 'expected channel.object to throw').to.exist;
    expect(error.code).to.equal(40019);
    expect(error.statusCode).to.equal(400);
  });

  /**
   * RSO2c - get with no params sends GET to channel object endpoint
   */
  // UTS: objects/unit/RSO2c/get-default-endpoint-0
  it('RSO2c - get() with no params sends GET to the channel object endpoint', async function () {
    const channelName = 'test-RSO2c-default-' + randomId();
    const { channel, capturedRequests } = setupRestObject(channelName, {});

    await channel.object.get();

    expect(capturedRequests).to.have.length(1);
    const request = capturedRequests[0];
    expect(request.method.toUpperCase()).to.equal('GET');
    expect(request.path).to.equal('/channels/' + encodeURIComponent(channelName) + '/object');
    const params = queryParams(request);
    expect(params).to.not.have.property('path');
    expect(params).to.not.have.property('compact');
  });

  /**
   * RSO2c - get with objectId appends percent-encoded path segment
   */
  // UTS: objects/unit/RSO2c/get-objectid-path-segment-0
  it('RSO2c - get() with objectId appends a percent-encoded path segment', async function () {
    const channelName = 'test-RSO2c-objectid-' + randomId();
    const testCases = [
      'root',
      'map:QWsI5HQnz7AbhLgn9U2xlA2wq0Ax7HHYbJtJDF9mVqg@1700000000000',
      'counter:a/b c?d#e@1700000000000',
    ];

    for (const objectId of testCases) {
      const { channel, capturedRequests } = setupFresh(channelName, {});

      await channel.object.get({ objectId });

      expect(capturedRequests, objectId).to.have.length(1);
      const request = capturedRequests[0];
      expect(request.method.toUpperCase()).to.equal('GET');
      // `url.pathname` keeps percent-encoding, so this compares the encoded form exactly
      expect(request.path, objectId).to.equal(
        '/channels/' + encodeURIComponent(channelName) + '/object/' + encodeURIComponent(objectId),
      );
    }
  });

  /**
   * RSO2d - path and compact sent as query parameters
   */
  // UTS: objects/unit/RSO2d/path-compact-query-params-0
  it('RSO2d - path and compact sent as query parameters', async function () {
    const channelName = 'test-RSO2d-' + randomId();
    // Case 4 (combined with objectId) is in its own test below, as it exposes a deviation
    const testCases = [
      { params: { path: 'a.b.c' }, suffix: '/object', query: { path: 'a.b.c' } },
      { params: { compact: false }, suffix: '/object', query: { compact: 'false' } },
      { params: { compact: true }, suffix: '/object', query: { compact: 'true' } },
    ];

    for (const testCase of testCases) {
      const { channel, capturedRequests } = setupFresh(channelName, {});

      await channel.object.get(testCase.params as any);

      const request = capturedRequests[0];
      expect(request.path).to.equal('/channels/' + encodeURIComponent(channelName) + testCase.suffix);
      expect(queryParams(request), JSON.stringify(testCase.params)).to.deep.equal(testCase.query);
    }
  });

  /**
   * RSO2d - path and compact sent as query parameters, combined with objectId (case 4)
   */
  // UTS: objects/unit/RSO2d/path-compact-query-params-0
  it('RSO2d - path and compact sent as query parameters alongside objectId', async function () {
    // DEVIATION: ably-js passes the whole params object as the query string, so `objectId` is also
    // sent as a query parameter in addition to the path segment. See deviations.md.
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const channelName = 'test-RSO2d-' + randomId();
    const { channel, capturedRequests } = setupRestObject(channelName, {});

    await channel.object.get({ objectId: 'map:abc@1', path: 'x.y', compact: false });

    const request = capturedRequests[0];
    expect(request.path).to.equal(
      '/channels/' + encodeURIComponent(channelName) + '/object/' + encodeURIComponent('map:abc@1'),
    );
    expect(queryParams(request)).to.deep.equal({ path: 'x.y', compact: 'false' });
  });

  /**
   * RSO6 - get passes path to the server verbatim
   */
  // UTS: objects/unit/RSO6/get-path-verbatim-0
  it('RSO6 - get() passes path to the server verbatim', async function () {
    const channelName = 'test-RSO6-get-' + randomId();
    const testCases = ['items.*.count', 'a\\.b.c', '.a..b.', '', 'with space/and?query&chars=1#frag', 'ünïcödé.键'];

    for (const path of testCases) {
      const { channel, capturedRequests } = setupFresh(channelName, {});

      await channel.object.get({ path });

      expect(capturedRequests, JSON.stringify(path)).to.have.length(1);
      // searchParams holds URL-decoded values: the decoded value must equal the input exactly
      expect(capturedRequests[0].url.searchParams.get('path'), JSON.stringify(path)).to.equal(path);
    }
  });

  /**
   * RSO2f, RSO8 - Compact response returned verbatim
   */
  // UTS: objects/unit/RSO2f/compact-returned-verbatim-0
  it('RSO2f/RSO8 - compact response returned verbatim', async function () {
    const compactBody = {
      name: 'Alice',
      age: 30,
      active: true,
      visits: 7,
      avatar: 'AQID',
      prefs: '{"theme":"dark"}',
      tags: '["a","b"]',
      nested: { inner: { deep: 1 } },
      empty: {},
      cycle: { objectId: 'map:cycleHash@1700000000000' },
    };

    const { channel } = setupRestObject('test-RSO2f-' + randomId(), compactBody);

    const resultDefault: any = await channel.object.get();
    const resultExplicit: any = await channel.object.get({ compact: true });

    expect(resultDefault).to.deep.equal(compactBody);
    expect(resultExplicit).to.deep.equal(compactBody);

    // String values are not Base64- or JSON-decoded
    expect(resultDefault.avatar).to.be.a('string');
    expect(resultDefault.avatar).to.equal('AQID');
    expect(resultDefault.prefs).to.be.a('string');
    expect(resultDefault.prefs).to.equal('{"theme":"dark"}');
  });

  /**
   * RSO2f - Compact scalar response returned verbatim
   */
  // UTS: objects/unit/RSO2f/compact-scalar-verbatim-1
  it('RSO2f - compact scalar response returned verbatim', async function () {
    const testCases = [42, -1.5, 'hello', false];

    for (const responseBody of testCases) {
      const { channel } = setupFresh('test-RSO2f-scalar-' + randomId(), responseBody);

      const result = await channel.object.get({ path: 'some.key' });

      expect(result, JSON.stringify(responseBody)).to.equal(responseBody);
    }
  });

  /**
   * RSO2e, RSO2f - Compact msgpack response decoded per RSC8 and returned verbatim
   */
  // UTS: objects/unit/RSO2e/compact-msgpack-decoded-0
  it('RSO2e/RSO2f - compact msgpack response decoded and returned verbatim', async function () {
    const compactBody = {
      name: 'Alice',
      count: 5,
      avatar: Buffer.from([0x01, 0x02, 0x03]),
    };

    const { channel, capturedRequests } = setupRestObject('test-RSO2e-msgpack-' + randomId(), compactBody, true);

    const result: any = await channel.object.get();

    expect(capturedRequests[0].headers['accept']).to.equal('application/x-msgpack');

    expect(result.name).to.equal('Alice');
    expect(result.count).to.equal(5);
    expect(Buffer.isBuffer(result.avatar)).to.be.true;
    expect(Buffer.compare(result.avatar, Buffer.from([0x01, 0x02, 0x03]))).to.equal(0);
  });

  /**
   * RSO2g1, RSO2g2, RSO2g3, RSO9a, RSO14, RSO16 - Full map response decoded recursively
   */
  // UTS: objects/unit/RSO2g1/full-map-recursive-decode-0
  it('RSO2g1/RSO2g2/RSO2g3 - full map response decoded recursively', async function () {
    const fullBody = {
      objectId: 'root',
      map: {
        semantics: 'LWW',
        entries: {
          str: { data: { string: 'hello' } },
          num: { data: { number: 42 } },
          bool: { data: { boolean: true } },
          bin: { data: { bytes: Buffer.from([0x01, 0x02, 0x03]).toString('base64') } },
          jobj: { data: { json: '{"a":1}' } },
          jarr: { data: { json: '[1,2,3]' } },
          visits: {
            data: {
              objectId: 'counter:visitsHash@1700000000000',
              counter: { data: { number: 7 } },
            },
          },
          profile: {
            data: {
              objectId: 'map:profileHash@1700000000000',
              map: {
                semantics: 'LWW',
                entries: {
                  nickname: { data: { string: 'ally' } },
                },
              },
            },
          },
        },
      },
    };

    const { channel } = setupRestObject('test-RSO2g1-' + randomId(), fullBody);

    const result: any = await channel.object.get({ compact: false });

    expect(result.objectId).to.equal('root');
    expect(result.map).to.exist;
    expect(result.map.semantics).to.equal('lww');
    expect(Object.keys(result.map.entries)).to.have.members([
      'str',
      'num',
      'bool',
      'bin',
      'jobj',
      'jarr',
      'visits',
      'profile',
    ]);

    // Leaves (RSO2g3, RSO9c)
    const entries = result.map.entries;
    expect(entries.str.data.string).to.equal('hello');
    expect(entries.num.data.number).to.equal(42);
    expect(entries.bool.data.boolean).to.equal(true);
    expect(Buffer.isBuffer(entries.bin.data.bytes)).to.be.true;
    expect(Buffer.compare(entries.bin.data.bytes, Buffer.from([0x01, 0x02, 0x03]))).to.equal(0);
    expect(entries.jobj.data.json).to.deep.equal({ a: 1 });
    expect(entries.jarr.data.json).to.deep.equal([1, 2, 3]);
    expect(entries.jobj.data.encoding).to.not.exist;

    // Nested counter (RSO2g2, RSO15)
    const visits = entries.visits.data;
    expect(visits.counter).to.exist;
    expect(visits.objectId).to.equal('counter:visitsHash@1700000000000');
    expect(visits.counter.data.number).to.equal(7);

    // Nested map, decoded recursively (RSO2g1, RSO16)
    const profile = entries.profile.data;
    expect(profile.map).to.exist;
    expect(profile.objectId).to.equal('map:profileHash@1700000000000');
    expect(profile.map.semantics).to.equal('lww');
    expect(profile.map.entries.nickname.data.string).to.equal('ally');
  });

  /**
   * RSO2g1, RSO2g3, RSO9c - Empty map and empty leaf values in a full response
   */
  // UTS: objects/unit/RSO2g1/full-empty-values-decode-1
  it('RSO2g1/RSO2g3 - empty map and empty leaf values in a full response', async function () {
    const fullBody = {
      objectId: 'root',
      map: {
        semantics: 'LWW',
        entries: {
          emptyMap: {
            data: {
              objectId: 'map:emptyHash@1700000000000',
              map: { semantics: 'LWW', entries: {} },
            },
          },
          emptyStr: { data: { string: '' } },
          emptyBin: { data: { bytes: '' } },
          zero: { data: { number: 0 } },
          no: { data: { boolean: false } },
        },
      },
    };

    const { channel } = setupRestObject('test-RSO2g1-empty-' + randomId(), fullBody);

    const result: any = await channel.object.get({ compact: false });
    const entries = result.map.entries;

    expect(Object.keys(entries)).to.have.members(['emptyMap', 'emptyStr', 'emptyBin', 'zero', 'no']);

    const emptyMap = entries.emptyMap.data;
    expect(emptyMap.map).to.exist;
    expect(emptyMap.objectId).to.equal('map:emptyHash@1700000000000');
    expect(emptyMap.map.semantics).to.equal('lww');
    expect(emptyMap.map.entries).to.deep.equal({});

    expect(entries.emptyStr.data.string).to.equal('');
    expect(Buffer.isBuffer(entries.emptyBin.data.bytes)).to.be.true;
    expect(entries.emptyBin.data.bytes.length).to.equal(0);
    expect(entries.zero.data.number).to.equal(0);
    expect(entries.no.data.boolean).to.equal(false);
  });

  /**
   * RSO2g2, RSO9b, RSO15 - Full counter response
   */
  // UTS: objects/unit/RSO2g2/full-counter-0
  it('RSO2g2/RSO15 - full counter response', async function () {
    const fullBody = {
      objectId: 'counter:abcHash@1700000000000',
      counter: { data: { number: -3.5 } },
    };

    const { channel } = setupRestObject('test-RSO2g2-' + randomId(), fullBody);

    const result: any = await channel.object.get({ objectId: 'counter:abcHash@1700000000000', compact: false });

    expect(result.counter).to.exist;
    expect(result.objectId).to.equal('counter:abcHash@1700000000000');
    expect(result.counter.data.number).to.equal(-3.5);
  });

  /**
   * RSO2g3, RSO9c - Full leaf response decoded per OD5 (JSON protocol)
   */
  // UTS: objects/unit/RSO2g3/full-leaf-decode-json-0
  it('RSO2g3/RSO9c - full leaf response decoded per OD5 (JSON protocol)', async function () {
    const testCases: { body: any; field: string; expected: any }[] = [
      { body: { string: 'hello' }, field: 'string', expected: 'hello' },
      { body: { number: 3.25 }, field: 'number', expected: 3.25 },
      { body: { boolean: false }, field: 'boolean', expected: false },
      { body: { bytes: 'AQID' }, field: 'bytes', expected: Buffer.from([0x01, 0x02, 0x03]) },
      { body: { json: '{"k":"v"}' }, field: 'json', expected: { k: 'v' } },
      { body: { json: '[1,"a",null]' }, field: 'json', expected: [1, 'a', null] },
    ];

    for (const testCase of testCases) {
      const label = JSON.stringify(testCase.body);
      const { channel } = setupFresh('test-RSO2g3-' + randomId(), testCase.body);

      const result: any = await channel.object.get({ path: 'leaf', compact: false });

      expect(result[testCase.field], label).to.deep.equal(testCase.expected);
      expect(result.objectId, label).to.not.exist;
      expect(result.encoding, label).to.not.exist;
      if (testCase.field === 'bytes') {
        expect(Buffer.isBuffer(result.bytes), label).to.be.true;
      }
    }
  });

  /**
   * RSO2g3, RSO9c2 - Full leaf response decoded per OD5 (MessagePack protocol)
   */
  // UTS: objects/unit/RSO2g3/full-leaf-decode-msgpack-1
  it('RSO2g3/RSO9c2 - full leaf response decoded per OD5 (MessagePack protocol)', async function () {
    const testCases: { body: any; field: string; expected: any }[] = [
      { body: { bytes: Buffer.from([0xff, 0x00]) }, field: 'bytes', expected: Buffer.from([0xff, 0x00]) },
      { body: { json: '{"k":[1,2]}' }, field: 'json', expected: { k: [1, 2] } },
      { body: { string: 'plain' }, field: 'string', expected: 'plain' },
    ];

    for (const testCase of testCases) {
      const label = testCase.field;
      const { channel } = setupFresh('test-RSO2g3-msgpack-' + randomId(), testCase.body, true);

      const result: any = await channel.object.get({ path: 'leaf', compact: false });

      expect(result[testCase.field], label).to.deep.equal(testCase.expected);
      expect(result.encoding, label).to.not.exist;
    }
  });

  /**
   * RSO2g4, RSO9d - Unrecognized object shape passed through
   *
   * RSO9d requires the result for an unrecognized object type to contain at minimum its `objectId`;
   * only that is asserted. ably-js decodes such a node as an object reference (`{ objectId }`).
   */
  // UTS: objects/unit/RSO2g4/unrecognized-object-passthrough-0
  it('RSO2g4/RSO9d - unrecognized object shape decoded with its objectId', async function () {
    const fullBody = {
      objectId: 'root',
      map: {
        semantics: 'LWW',
        entries: {
          known: { data: { string: 'ok' } },
          future: {
            data: {
              objectId: 'future:xyzHash@1700000000000',
              futureType: { someField: 1 },
            },
          },
        },
      },
    };
    const topLevelBody = {
      objectId: 'future:topHash@1700000000000',
      futureType: { someField: 2 },
    };

    const { channel } = setupRestObject('test-RSO2g4-entry-' + randomId(), fullBody);
    const mapResult: any = await channel.object.get({ compact: false });

    const { channel: channel2 } = setupFresh('test-RSO2g4-top-' + randomId(), topLevelBody);
    const topResult: any = await channel2.object.get({ compact: false });

    expect(mapResult.map).to.exist;
    expect(mapResult.map.entries.known.data.string).to.equal('ok');
    expect(mapResult.map.entries.future.data.objectId).to.equal('future:xyzHash@1700000000000');
    expect(topResult.objectId).to.equal('future:topHash@1700000000000');
  });

  /**
   * RSO2h - get performs no client-side validation and surfaces server errors
   */
  // UTS: objects/unit/RSO2h/no-validation-server-error-0
  it('RSO2h - get() performs no client-side validation and surfaces server errors', async function () {
    const channelName = 'test-RSO2h-' + randomId();
    const capturedRequests: any[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        capturedRequests.push(req);
        req.respond_with(404, {
          error: { code: 40400, statusCode: 404, message: 'Object not found' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Http({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    const channel = client.channels.get(channelName);

    const error = await expectRejection(
      channel.object.get({ objectId: 'not-a-valid-object-id', path: '..*..', compact: false }),
    );

    expect(capturedRequests).to.have.length(1);
    expect(capturedRequests[0].path).to.equal(
      '/channels/' + encodeURIComponent(channelName) + '/object/' + encodeURIComponent('not-a-valid-object-id'),
    );
    expect(capturedRequests[0].url.searchParams.get('path')).to.equal('..*..');

    expect(error.code).to.equal(40400);
    expect(error.statusCode).to.equal(404);
  });
});
