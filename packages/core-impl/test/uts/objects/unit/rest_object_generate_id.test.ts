/**
 * UTS: RestObject generateObjectId Tests
 *
 * Spec points: RSO4, RSO4a1, RSO4b, RSO4c, RSO4d, RSO4e, RSO4e1, RSO4e1a, RSO4e1b, RSO4e1c,
 *   RSO4e2, RSO4f, RSO4g, RSO4h, RSO4j, RSO4k, RSO5d, RSO5h, RSO12
 * Source: uts/objects/unit/rest_object_generate_id.md
 *
 * Tests local object ID generation for REST callers: the initialValue encoding, nonce generation,
 * use of server time, and the derivation of objectId per RTO14. The mocked HTTP client answers
 * the server time request and any publish request.
 *
 * ably-js naming: RestObject is HttpObject; the "LWW" semantics enum value is 'lww'.
 */

import { expect } from 'chai';
import * as crypto from 'crypto';
import { MockHttpClient, PendingRequest } from '../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../helpers';
import * as LiveObjectsPlugin from '../../../../src/plugins/liveobjects';

const SERVER_TIME = 1700000000000;

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function setupRestObject(channelName: string, useBinaryProtocol = false) {
  const capturedRequests: PendingRequest[] = [];

  const mock = new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      capturedRequests.push(req);
      if (req.path === '/time') {
        req.respond_with(200, [SERVER_TIME]);
      } else {
        req.respond_with(201, { messageId: 'msg-id-1', channel: channelName, objectIds: [] });
      }
    },
  });
  installMockHttp(mock);

  const client: any = new Ably.Http({
    key: 'appId.keyId:keySecret',
    useBinaryProtocol,
    plugins: { LiveObjects: LiveObjectsPlugin },
  } as any);
  const channel = client.channels.get(channelName);

  return { client, channel, capturedRequests };
}

async function expectRejection(promise: Promise<unknown>): Promise<any> {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  expect.fail('Expected promise to reject');
}

describe('uts/objects/unit/rest_object_generate_id', function () {
  afterEach(function () {
    restoreAll();
  });

  // UTS: objects/unit/RSO4d/map-type-objectid-0
  it('RSO4d - map create body yields a map objectId', async function () {
    const { channel } = setupRestObject('test-RSO4d-map-' + randomId());

    const result = await channel.object.generateObjectId({ mapCreate: { semantics: 'lww', entries: {} } });

    expect(result.objectId.startsWith('map:')).to.be.true;
  });

  // UTS: objects/unit/RSO4d/counter-type-objectid-1
  it('RSO4d - counter create body yields a counter objectId', async function () {
    const { channel } = setupRestObject('test-RSO4d-counter-' + randomId());

    const result = await channel.object.generateObjectId({ counterCreate: { count: 5 } });

    expect(result.objectId.startsWith('counter:')).to.be.true;
  });

  // UTS: objects/unit/RSO4h/objectid-derivation-0
  it('RSO4g, RSO4h - objectId derived per RTO14 from initialValue, nonce and server time', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO4h-' + randomId());

    const result = await channel.object.generateObjectId({ counterCreate: { count: 42 } });

    const timeRequests = capturedRequests.filter((r) => r.path === '/time');
    expect(timeRequests).to.have.length(1);
    expect(timeRequests[0].method.toUpperCase()).to.equal('GET');

    const expectedHash = crypto
      .createHash('sha256')
      .update(Buffer.from(result.initialValue + ':' + result.nonce, 'utf8'))
      .digest('base64url');
    expect(result.objectId).to.equal('counter:' + expectedHash + '@' + String(SERVER_TIME));
  });

  // UTS: objects/unit/RSO4e2/counter-initial-value-0
  it('RSO4e2 - counter initialValue is the JSON representation of the counter create body', async function () {
    const { channel } = setupRestObject('test-RSO4e2-' + randomId());

    const result = await channel.object.generateObjectId({ counterCreate: { count: 42 } });

    expect(JSON.parse(result.initialValue)).to.deep.equal({ count: 42 });
  });

  // UTS: objects/unit/RSO4e1/map-initial-value-0
  it('RSO4e1 - map initialValue encodes semantics and entry data with JSON protocol rules', async function () {
    const { channel } = setupRestObject('test-RSO4e1-' + randomId());

    const result = await channel.object.generateObjectId({
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

    const initialValue = JSON.parse(result.initialValue);
    expect(initialValue.semantics).to.equal(0);

    const entries = initialValue.entries;
    expect(Object.keys(entries)).to.have.members(['name', 'age', 'active', 'avatar', 'prefs', 'visits']);
    expect(entries.name).to.deep.equal({ data: { string: 'Alice' } });
    expect(entries.age).to.deep.equal({ data: { number: 30 } });
    expect(entries.active).to.deep.equal({ data: { boolean: true } });
    expect(entries.avatar).to.deep.equal({ data: { bytes: 'AQID' } });
    expect(entries.visits).to.deep.equal({ data: { objectId: 'counter:h@1' } });
  });

  // UTS: objects/unit/RSO4e1/map-initial-value-0 (json entry assertions)
  it('RSO4e1 - map initialValue encodes a json entry as a JSON-encoded string', async function () {
    // Wire shape: the spec's OD4d5 describes `string` + `encoding: "json"`, but the service expects
    // (and ably-js sends) the OD2g `json` field holding the JSON-encoded string. See deviations.md,
    // "objects: harness and wire-format conventions".

    const { channel } = setupRestObject('test-RSO4e1-json-' + randomId());

    const result = await channel.object.generateObjectId({
      mapCreate: {
        semantics: 'lww',
        entries: {
          prefs: { data: { json: { theme: 'dark' } } },
        },
      },
    });

    const entries = JSON.parse(result.initialValue).entries;
    expect(Object.keys(entries.prefs.data)).to.deep.equal(['json']);
    expect(JSON.parse(entries.prefs.data.json)).to.deep.equal({ theme: 'dark' });
  });

  // UTS: objects/unit/RSO4e/json-regardless-of-protocol-0
  it('RSO4e - initialValue uses JSON encoding regardless of the client protocol', async function () {
    const createBody = {
      mapCreate: {
        semantics: 'lww',
        entries: {
          avatar: { data: { bytes: Buffer.from([0x01, 0x02, 0x03]) } },
        },
      },
    };

    // Both clients share one mock; it answers /time and publish identically for either channel.
    const { channel: jsonChannel } = setupRestObject('test-RSO4e-json-' + randomId());
    const binaryClient: any = new Ably.Http({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: true,
      plugins: { LiveObjects: LiveObjectsPlugin },
    } as any);
    const binaryChannel = binaryClient.channels.get('test-RSO4e-binary-' + randomId());

    const jsonResult = await jsonChannel.object.generateObjectId(createBody);
    const binaryResult = await binaryChannel.object.generateObjectId(createBody);

    expect(binaryResult.initialValue).to.be.a('string');
    expect(binaryResult.initialValue).to.equal(jsonResult.initialValue);
    expect(JSON.parse(binaryResult.initialValue).entries.avatar.data.bytes).to.equal('AQID');
  });

  // UTS: objects/unit/RSO4e1a/unrecognized-semantics-error-0
  it('RSO4e1a - unrecognized mapCreate semantics rejected', async function () {
    const { channel } = setupRestObject('test-RSO4e1a-' + randomId());

    const error = await expectRejection(
      channel.object.generateObjectId({ mapCreate: { semantics: 'not-a-semantics', entries: {} } }),
    );

    expect(error.code).to.equal(40003);
    expect(error.statusCode).to.equal(400);
  });

  // UTS: objects/unit/RSO4c/missing-create-body-error-0
  it('RSO4c - missing create body rejected', async function () {
    const { channel, capturedRequests } = setupRestObject('test-RSO4c-' + randomId());

    const error = await expectRejection(channel.object.generateObjectId({}));

    expect(error.code).to.equal(40003);
    expect(error.statusCode).to.equal(400);
    expect(capturedRequests).to.have.length(0);
  });

  // UTS: objects/unit/RSO4f/nonce-generated-0
  it('RSO4f - nonce is a string of at least 16 characters', async function () {
    const { channel } = setupRestObject('test-RSO4f-' + randomId());

    const result = await channel.object.generateObjectId({ counterCreate: { count: 0 } });

    expect(result.nonce).to.be.a('string');
    expect(result.nonce.length).to.be.at.least(16);
  });

  // UTS: objects/unit/RSO4j/unique-per-call-0
  it('RSO4j - repeated calls produce different objectId and nonce', async function () {
    const { channel } = setupRestObject('test-RSO4j-' + randomId());
    const createBody = { counterCreate: { count: 1 } };

    const first = await channel.object.generateObjectId(createBody);
    const second = await channel.object.generateObjectId(createBody);

    expect(first.nonce).to.not.equal(second.nonce);
    expect(first.objectId).to.not.equal(second.objectId);
  });

  // UTS: objects/unit/RSO4k/initial-value-deterministic-0
  it('RSO4k - initialValue is deterministic for a given create body', async function () {
    const { channel } = setupRestObject('test-RSO4k-' + randomId());
    const createBody = {
      mapCreate: {
        semantics: 'lww',
        entries: {
          a: { data: { string: 'x' } },
          b: { data: { json: { k: [1, 2] } } },
        },
      },
    };

    const first = await channel.object.generateObjectId(createBody);
    const second = await channel.object.generateObjectId(createBody);

    expect(first.initialValue).to.equal(second.initialValue);
  });

  // UTS: objects/unit/RSO4b/generated-id-publish-roundtrip-0
  it('RSO4b, RSO5d, RSO5h - generated values publish verbatim in *WithObjectId operations', async function () {
    const channelName = 'test-RSO4b-' + randomId();
    const { channel, capturedRequests } = setupRestObject(channelName);

    const counter = await channel.object.generateObjectId({ counterCreate: { count: 3 } });
    const map = await channel.object.generateObjectId({
      mapCreate: {
        semantics: 'lww',
        entries: {
          visits: { data: { objectId: counter.objectId } },
        },
      },
    });

    await channel.object.publish([
      {
        objectId: counter.objectId,
        counterCreateWithObjectId: { initialValue: counter.initialValue, nonce: counter.nonce },
      },
      {
        objectId: map.objectId,
        mapCreateWithObjectId: { initialValue: map.initialValue, nonce: map.nonce },
      },
      {
        objectId: 'root',
        mapSet: { key: 'stats', value: { objectId: map.objectId } },
      },
    ]);

    const publishRequests = capturedRequests.filter((r) => r.method.toUpperCase() === 'POST');
    expect(publishRequests).to.have.length(1);
    expect(publishRequests[0].path).to.equal('/channels/' + encodeURIComponent(channelName) + '/object');

    const body = JSON.parse(publishRequests[0].body);
    expect(body[0]).to.deep.equal({
      objectId: counter.objectId,
      counterCreateWithObjectId: { initialValue: counter.initialValue, nonce: counter.nonce },
    });
    expect(body[1]).to.deep.equal({
      objectId: map.objectId,
      mapCreateWithObjectId: { initialValue: map.initialValue, nonce: map.nonce },
    });
    expect(body[2].mapSet.value).to.deep.equal({ objectId: map.objectId });
  });
});
