/**
 * UTS: RestObject Publish Tests
 *
 * Spec points: RSO3, RSO3a1, RSO3b, RSO3c, RSO3d, RSO3d1, RSO3d2, RSO3d3, RSO3d4, RSO3e, RSO3f,
 * RSO3g, RSO3h, RSO5, RSO5a, RSO5b, RSO5b1, RSO5c, RSO5d, RSO5e, RSO5f, RSO5g, RSO5h, RSO5i, RSO6,
 * RSO7, RSO10, RSO13
 * Source: uts/objects/unit/rest_object_publish.md
 *
 * Tests HttpObject#publish (RestObject#publish in the spec) request formation: endpoint, batching,
 * the wire shape of each operation variant, ObjectData encoding of leaf values, the absence of
 * client-side validation that is delegated to the server, and decoding of the publish result.
 */

import { expect } from 'chai';
import { MockHttpClient, PendingRequest } from '../../mock_http';
import { Ably, installMockHttp, restoreAll, trackClient } from '../../helpers';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';

const msgpack = require('@ably/msgpack-js');

const DEFAULT_PUBLISH_RESPONSE = {
  messageId: 'msg-id-1',
  channel: 'ignored-by-tests',
  objectIds: [],
};

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function setupRestObject(
  channelName: string,
  opts: { useBinaryProtocol?: boolean; clientOptions?: Record<string, any> } = {},
): { client: any; channel: any; capturedRequests: PendingRequest[] } {
  const useBinaryProtocol = opts.useBinaryProtocol ?? false;
  const capturedRequests: PendingRequest[] = [];

  const mock = new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      capturedRequests.push(req);
      if (useBinaryProtocol) {
        req.respond_with(201, msgpack.encode(DEFAULT_PUBLISH_RESPONSE), {
          'Content-Type': 'application/x-msgpack',
        });
      } else {
        req.respond_with(201, DEFAULT_PUBLISH_RESPONSE, { 'Content-Type': 'application/json' });
      }
    },
  });
  installMockHttp(mock);

  const client = new Ably.Http({
    key: 'appId.keyId:keySecret',
    useBinaryProtocol,
    plugins: { LiveObjects: LiveObjectsPlugin },
    ...opts.clientOptions,
  } as any);
  trackClient(client);
  const channel = client.channels.get(channelName);

  return { client, channel, capturedRequests };
}

function parseJsonBody(req: PendingRequest): any {
  return JSON.parse(typeof req.body === 'string' ? req.body : Buffer.from(req.body).toString('utf8'));
}

async function expectRejection(promise: Promise<any>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  expect.fail('Expected promise to reject');
}

describe('uts/objects/unit/rest_object_publish', function () {
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RSO3e/single-op-post-0
  it('RSO3e - single operation sent as POST with a one-element JSON array body', async function () {
    const channelName = 'test-RSO3e-single-' + randomId();
    const { channel, capturedRequests } = setupRestObject(channelName);

    await channel.object.publish({
      objectId: 'root',
      mapSet: { key: 'greeting', value: { string: 'hello' } },
    });

    expect(capturedRequests).to.have.length(1);
    const request = capturedRequests[0];
    expect(request.method.toUpperCase()).to.equal('POST');
    expect(request.url.pathname).to.equal('/channels/' + encodeURIComponent(channelName) + '/object');
    expect(request.headers['content-type']).to.equal('application/json');

    const body = parseJsonBody(request);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].objectId).to.equal('root');
    expect(body[0].mapSet).to.deep.equal({ key: 'greeting', value: { string: 'hello' } });
  });

  // UTS: objects/unit/RSO3e/msgpack-body-1
  it('RSO3e - request body encoded as MessagePack with the binary protocol', async function () {
    const channelName = 'test-RSO3e-msgpack-' + randomId();
    const { channel, capturedRequests } = setupRestObject(channelName, { useBinaryProtocol: true });

    await channel.object.publish({ path: 'visits', counterInc: { number: 1 } });

    const request = capturedRequests[0];
    expect(request.method.toUpperCase()).to.equal('POST');
    expect(request.headers['content-type']).to.equal('application/x-msgpack');

    const body = msgpack.decode(request.body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].path).to.equal('visits');
    expect(body[0].counterInc).to.deep.equal({ number: 1 });
  });

  // UTS: objects/unit/RSO3c/batch-single-request-0
  it('RSO3c - array of operations sent in a single request, in order', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO3c-' + randomId());

    await channel.object.publish([
      { path: 'a', mapSet: { key: 'x', value: { number: 1 } } },
      { objectId: 'root', mapRemove: { key: 'old' } },
      { path: 'score', counterInc: { number: -2 } },
    ]);

    expect(capturedRequests).to.have.length(1);
    const body = parseJsonBody(capturedRequests[0]);
    expect(body).to.have.length(3);
    expect(body[0].mapSet.key).to.equal('x');
    expect(body[1].mapRemove).to.deep.equal({ key: 'old' });
    expect(body[2].counterInc).to.deep.equal({ number: -2 });
  });

  // UTS: objects/unit/RSO3h/no-batch-size-limit-0
  it('RSO3h - no client-side limit on batch size', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO3h-' + randomId());

    const ops = [];
    for (let i = 0; i < 1000; i++) {
      ops.push({ objectId: 'root', mapSet: { key: 'k' + i, value: { number: i } } });
    }

    await channel.object.publish(ops);

    expect(capturedRequests).to.have.length(1);
    const body = parseJsonBody(capturedRequests[0]);
    expect(body).to.have.length(1000);
    expect(body[999].mapSet.key).to.equal('k999');
  });

  // UTS: objects/unit/RSO10/publish-result-0
  it('RSO3b, RSO10 - publish result decoded from the response', async function () {
    const channelName = 'test-RSO10-' + randomId();

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) =>
        req.respond_with(201, {
          messageId: 'abc123:0',
          channel: channelName,
          objectIds: ['map:newHash@1700000000000', 'root'],
        }),
    });
    installMockHttp(mock);

    const client = new Ably.Http({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);
    const channel = client.channels.get(channelName) as any;

    const result = await channel.object.publish({
      path: 'profile',
      mapCreate: { semantics: 'lww', entries: {} },
    });

    expect(result.messageId).to.equal('abc123:0');
    expect(result.channel).to.equal(channelName);
    expect(result.objectIds).to.deep.equal(['map:newHash@1700000000000', 'root']);
  });

  // UTS: objects/unit/RSO3d4/op-wire-shape-no-action-0
  it('RSO3d4, RSO5c-RSO5i - wire shape of each operation type, without an action field', async function () {
    const channelName = 'test-RSO3d4-' + randomId();

    const testCases = [
      {
        id: 1,
        operation: { path: 'm', mapCreate: { semantics: 'lww', entries: {} } },
        expected: { path: 'm', mapCreate: { semantics: 0, entries: {} } },
      },
      {
        id: 2,
        operation: {
          objectId: 'map:h@1',
          mapCreateWithObjectId: { initialValue: '{"semantics":0,"entries":{}}', nonce: 'nonce-0123456789ab' },
        },
        expected: {
          objectId: 'map:h@1',
          mapCreateWithObjectId: { initialValue: '{"semantics":0,"entries":{}}', nonce: 'nonce-0123456789ab' },
        },
      },
      {
        id: 3,
        operation: { objectId: 'root', mapSet: { key: 'k', value: { boolean: true } } },
        expected: { objectId: 'root', mapSet: { key: 'k', value: { boolean: true } } },
      },
      {
        id: 4,
        operation: { path: 'a.b', mapRemove: { key: 'k' } },
        expected: { path: 'a.b', mapRemove: { key: 'k' } },
      },
      {
        id: 5,
        operation: { counterCreate: { count: 10 } },
        expected: { counterCreate: { count: 10 } },
      },
      {
        id: 6,
        operation: {
          objectId: 'counter:h@1',
          counterCreateWithObjectId: { initialValue: '{"count":10}', nonce: 'nonce-0123456789ab' },
        },
        expected: {
          objectId: 'counter:h@1',
          counterCreateWithObjectId: { initialValue: '{"count":10}', nonce: 'nonce-0123456789ab' },
        },
      },
      {
        id: 7,
        operation: { objectId: 'counter:h@1', counterInc: { number: -5 } },
        expected: { objectId: 'counter:h@1', counterInc: { number: -5 } },
      },
    ];

    for (const testCase of testCases) {
      restoreAll();
      const { channel, capturedRequests } = setupRestObject(channelName);

      await channel.object.publish(testCase.operation);

      const wireOp = parseJsonBody(capturedRequests[0])[0];
      expect(wireOp, `case ${testCase.id}`).to.deep.equal(testCase.expected);
      expect(wireOp, `case ${testCase.id}`).to.not.have.property('action');
    }
  });

  // UTS: objects/unit/RSO3d3/targeting-fields-verbatim-0
  it('RSO3d3 - id, objectId and path preserved verbatim', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO3d3-' + randomId());

    await channel.object.publish([
      { id: 'my-op-id:0', objectId: 'map:Ab-_9@1700000000000', mapRemove: { key: 'k' } },
      { id: '  spaced id ', path: 'a\\.b.*.c', counterInc: { number: 1 } },
    ]);

    const body = parseJsonBody(capturedRequests[0]);

    expect(body[0].id).to.equal('my-op-id:0');
    expect(body[0].objectId).to.equal('map:Ab-_9@1700000000000');
    expect(body[0]).to.not.have.property('path');

    expect(body[1].id).to.equal('  spaced id ');
    expect(body[1].path).to.equal('a\\.b.*.c');
    expect(body[1]).to.not.have.property('objectId');
  });

  // UTS: objects/unit/RSO6/publish-path-verbatim-0
  it('RSO6 - publish passes path to the server verbatim', async function () {
    const channelName = 'test-RSO6-publish-' + randomId();
    const paths = ['items.*', 'a\\.b.c', '.a..b.', '', 'ünïcödé.键'];

    for (const path of paths) {
      restoreAll();
      const { channel, capturedRequests } = setupRestObject(channelName);

      await channel.object.publish({ path, mapSet: { key: 'k', value: { string: 'v' } } });

      expect(capturedRequests, `path ${JSON.stringify(path)}`).to.have.length(1);
      expect(parseJsonBody(capturedRequests[0])[0].path, `path ${JSON.stringify(path)}`).to.equal(path);
    }
  });

  // UTS: objects/unit/RSO3d1/mapcreate-semantics-encoded-0
  it('RSO3d1 - mapCreate semantics encoded per OMP2', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO3d1-' + randomId());

    await channel.object.publish({ mapCreate: { semantics: 'lww', entries: {} } });

    expect(parseJsonBody(capturedRequests[0])[0].mapCreate.semantics).to.equal(0);
  });

  // UTS: objects/unit/RSO3d1/unrecognized-semantics-error-1
  it('RSO3d1 - unrecognized mapCreate semantics rejected', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO3d1-invalid-' + randomId());

    const error = await expectRejection(
      channel.object.publish({ mapCreate: { semantics: 'not-a-semantics', entries: {} } }),
    );

    expect(error.code).to.equal(40003);
    expect(error.statusCode).to.equal(400);
    expect(capturedRequests).to.have.length(0);
  });

  // UTS: objects/unit/RSO3d2/mapset-value-encoded-json-0
  it('RSO3d2, RSO7 - mapSet value encoded per OD4 (JSON protocol)', async function () {
    const channelName = 'test-RSO3d2-json-' + randomId();

    // Cases 5-6 (JSON object/array payloads) are in the separate test below.
    const testCases: { id: number; value: any; expected: any }[] = [
      { id: 1, value: { string: 'hello' }, expected: { string: 'hello' } },
      { id: 2, value: { number: 1.5 }, expected: { number: 1.5 } },
      { id: 3, value: { boolean: false }, expected: { boolean: false } },
      { id: 4, value: { bytes: Buffer.from([0x01, 0x02, 0x03]) }, expected: { bytes: 'AQID' } },
      { id: 7, value: { objectId: 'counter:h@1' }, expected: { objectId: 'counter:h@1' } },
    ];

    for (const testCase of testCases) {
      restoreAll();
      const { channel, capturedRequests } = setupRestObject(channelName);

      await channel.object.publish({ objectId: 'root', mapSet: { key: 'k', value: testCase.value } });

      const wireValue = parseJsonBody(capturedRequests[0])[0].mapSet.value;
      expect(wireValue, `case ${testCase.id}`).to.deep.equal(testCase.expected);
    }
  });

  // UTS: objects/unit/RSO3d2/mapset-value-encoded-json-0 (cases 5-6)
  it('RSO3d2, RSO7 - mapSet JSON object/array value encoded as a JSON-encoded string (JSON protocol)', async function () {
    // Wire shape: the spec's OD4c5/OD4d5 describe `string` + `encoding: "json"`, but the service expects
    // (and ably-js sends) the OD2g `json` field holding the JSON-encoded string; the server does not
    // honour `encoding: "json"` on `string`. See deviations.md, "objects: harness and wire-format
    // conventions".

    const channelName = 'test-RSO3d2-json-' + randomId();
    const testCases = [
      { id: 5, json: { a: [1, 2] } },
      { id: 6, json: [1, 'x'] },
    ];

    for (const testCase of testCases) {
      restoreAll();
      const { channel, capturedRequests } = setupRestObject(channelName);

      await channel.object.publish({ objectId: 'root', mapSet: { key: 'k', value: { json: testCase.json } } });

      const wireValue = parseJsonBody(capturedRequests[0])[0].mapSet.value;
      const label = `case ${testCase.id}`;
      expect(wireValue.json, label).to.be.a('string');
      expect(JSON.parse(wireValue.json), label).to.deep.equal(testCase.json);
      expect(Object.keys(wireValue), label).to.deep.equal(['json']);
    }
  });

  // UTS: objects/unit/RSO3d2/mapset-value-encoded-msgpack-1
  it('RSO3d2 - mapSet value encoded per OD4 (MessagePack protocol)', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO3d2-msgpack-' + randomId(), {
      useBinaryProtocol: true,
    });

    await channel.object.publish([
      { objectId: 'root', mapSet: { key: 'bin', value: { bytes: Buffer.from([0x01, 0x02, 0x03]) } } },
      { objectId: 'root', mapSet: { key: 'obj', value: { json: { a: 1 } } } },
    ]);

    const body = msgpack.decode(capturedRequests[0].body);

    const bytes = body[0].mapSet.value.bytes;
    expect(Buffer.isBuffer(bytes)).to.be.true;
    expect(Buffer.compare(bytes, Buffer.from([0x01, 0x02, 0x03]))).to.equal(0);
  });

  // UTS: objects/unit/RSO3d2/mapset-value-encoded-msgpack-1 (JSON payload)
  it('RSO3d2 - mapSet JSON value encoded as a JSON-encoded string (MessagePack protocol)', async function () {
    // Wire shape: the spec's OD4c5/OD4d5 describe `string` + `encoding: "json"`, but the service expects
    // (and ably-js sends) the OD2g `json` field holding the JSON-encoded string; the server does not
    // honour `encoding: "json"` on `string`. See deviations.md, "objects: harness and wire-format
    // conventions".

    const { channel, capturedRequests } = setupRestObject('test-RSO3d2-msgpack-' + randomId(), {
      useBinaryProtocol: true,
    });

    await channel.object.publish([
      { objectId: 'root', mapSet: { key: 'bin', value: { bytes: Buffer.from([0x01, 0x02, 0x03]) } } },
      { objectId: 'root', mapSet: { key: 'obj', value: { json: { a: 1 } } } },
    ]);

    const body = msgpack.decode(capturedRequests[0].body);
    expect(body[1].mapSet.value.json).to.be.a('string');
    expect(JSON.parse(body[1].mapSet.value.json)).to.deep.equal({ a: 1 });
    expect(body[1].mapSet.value).to.not.have.property('encoding');
  });

  // UTS: objects/unit/RSO3d2/mapcreate-entries-encoded-2
  it('RSO3d2, RSO13 - mapCreate entries encoded per OD4', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO3d2-entries-' + randomId());

    await channel.object.publish({
      path: 'profile',
      mapCreate: {
        semantics: 'lww',
        entries: {
          name: { data: { string: 'Alice' } },
          age: { data: { number: 30 } },
          active: { data: { boolean: true } },
          avatar: { data: { bytes: Buffer.from([0x01, 0x02, 0x03]) } },
          prefs: { data: { json: { theme: 'dark' } } },
          visits: { data: { objectId: 'counter:h@1' } },
        },
      },
    });

    const entries = parseJsonBody(capturedRequests[0])[0].mapCreate.entries;

    expect(entries.name).to.deep.equal({ data: { string: 'Alice' } });
    expect(entries.age).to.deep.equal({ data: { number: 30 } });
    expect(entries.active).to.deep.equal({ data: { boolean: true } });
    expect(entries.avatar).to.deep.equal({ data: { bytes: 'AQID' } });
    // entries.prefs (JSON payload) is asserted in the separate test below
    expect(entries.visits).to.deep.equal({ data: { objectId: 'counter:h@1' } });
  });

  // UTS: objects/unit/RSO3d2/mapcreate-entries-encoded-2 (JSON payload entry)
  it('RSO3d2, RSO13 - mapCreate JSON entry encoded as a JSON-encoded string', async function () {
    // Wire shape: the spec's OD4c5/OD4d5 describe `string` + `encoding: "json"`, but the service expects
    // (and ably-js sends) the OD2g `json` field holding the JSON-encoded string; the server does not
    // honour `encoding: "json"` on `string`. See deviations.md, "objects: harness and wire-format
    // conventions".

    const { channel, capturedRequests } = setupRestObject('test-RSO3d2-entries-' + randomId());

    await channel.object.publish({
      path: 'profile',
      mapCreate: { semantics: 'lww', entries: { prefs: { data: { json: { theme: 'dark' } } } } },
    });

    const entries = parseJsonBody(capturedRequests[0])[0].mapCreate.entries;
    expect(Object.keys(entries.prefs.data)).to.deep.equal(['json']);
    expect(JSON.parse(entries.prefs.data.json)).to.deep.equal({ theme: 'dark' });
  });

  // UTS: objects/unit/RSO3f/no-auto-generated-id-0
  it('RSO3f - no auto-generated operation id, even with idempotentRestPublishing', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO3f-' + randomId(), {
      clientOptions: { idempotentRestPublishing: true },
    });

    await channel.object.publish([
      { path: 'a', counterInc: { number: 1 } },
      { id: 'caller-id', path: 'b', counterInc: { number: 1 } },
    ]);

    const body = parseJsonBody(capturedRequests[0]);
    expect(body[0]).to.not.have.property('id');
    expect(body[1].id).to.equal('caller-id');
  });

  // UTS: objects/unit/RSO5b1/no-body-field-error-0
  it('RSO5b1 - operation with no body field rejected before any request', async function () {
    // DEVIATION: ably-js does not validate the number of operation body fields; an operation with
    // no body field is sent to the server instead of being rejected with 40003.
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const { channel, capturedRequests } = setupRestObject('test-RSO5b1-none-' + randomId());

    const error = await expectRejection(channel.object.publish({ objectId: 'root' }));

    expect(error.code).to.equal(40003);
    expect(error.statusCode).to.equal(400);
    expect(capturedRequests).to.have.length(0);
  });

  // UTS: objects/unit/RSO5b1/multiple-body-fields-error-1
  it('RSO5b1 - operation with multiple body fields rejected; no partial batch sent', async function () {
    // DEVIATION: ably-js does not validate the number of operation body fields; an operation with
    // several body fields is encoded with all of them and the batch is sent to the server.
    if (!process.env.RUN_DEVIATIONS) this.skip();

    const { channel, capturedRequests } = setupRestObject('test-RSO5b1-multi-' + randomId());

    const error = await expectRejection(
      channel.object.publish([
        { path: 'ok', counterInc: { number: 1 } },
        { objectId: 'root', mapSet: { key: 'k', value: { string: 'v' } }, mapRemove: { key: 'k' } },
      ]),
    );

    expect(error.code).to.equal(40003);
    expect(error.statusCode).to.equal(400);
    expect(capturedRequests).to.have.length(0);
  });

  // UTS: objects/unit/RSO3g/no-targeting-validation-0
  it('RSO3g - no client-side validation of targeting; server error surfaced', async function () {
    const capturedRequests: PendingRequest[] = [];

    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        capturedRequests.push(req);
        req.respond_with(400, {
          error: { code: 40000, statusCode: 400, message: 'Invalid operation targeting' },
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Http({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    trackClient(client);
    const channel = client.channels.get('test-RSO3g-' + randomId()) as any;

    const operations = [
      { objectId: 'root', path: 'a', mapSet: { key: 'k', value: { string: 'v' } } },
      { mapRemove: { key: 'k' } },
      { objectId: 'counter:h@1', counterCreate: { count: 1 } },
    ];

    for (const [i, operation] of operations.entries()) {
      capturedRequests.length = 0;

      const error = await expectRejection(channel.object.publish(operation));

      expect(capturedRequests, `case ${i + 1}`).to.have.length(1);
      expect(error.code, `case ${i + 1}`).to.equal(40000);
      expect(error.statusCode, `case ${i + 1}`).to.equal(400);
    }
  });
});
