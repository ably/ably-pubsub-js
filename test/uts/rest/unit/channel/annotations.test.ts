/**
 * UTS: REST Channel Annotations Tests
 *
 * Spec points: RSL10, RSAN1, RSAN1a3, RSAN1c3, RSAN1c4, RSAN2a, RSAN3b, RSAN3c
 * Source: uts/test/rest/unit/channel/annotations.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

describe('uts/rest/unit/channel/annotations', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL10 - channel.annotations is accessible
   *
   * The channel must expose an annotations attribute that is an object
   * (specifically a RestAnnotations instance).
   */
  // UTS: rest/unit/RSL10/annotations-attribute-type-0
  it('RSL10 - channel.annotations is accessible', function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(200, {}),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-RSL10');

    expect(ch.annotations).to.be.an('object');
    expect(ch.annotations).to.not.be.null;
    expect(ch.annotations).to.not.be.undefined;
  });

  /**
   * RSAN1 - publish sends POST with ANNOTATION_CREATE
   *
   * annotations.publish() must send a POST request to the correct endpoint
   * with the annotation body containing action=0 (ANNOTATION_CREATE),
   * the messageSerial, type, and name fields.
   */
  // UTS: rest/unit/RSAN1c6/publish-post-annotation-create-0
  it('RSAN1 - publish sends POST with ANNOTATION_CREATE', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.annotations.publish('msg-serial-1', { type: 'com.example.reaction', name: 'like' });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/channels/test/messages/msg-serial-1/annotations');

    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].action).to.equal(0); // ANNOTATION_CREATE
    expect(body[0].messageSerial).to.equal('msg-serial-1');
    expect(body[0].type).to.equal('com.example.reaction');
    expect(body[0].name).to.equal('like');
  });

  /**
   * RSAN1a3 - type required
   *
   * Publishing an annotation without a type field should throw an error
   * with code 40003.
   */
  // UTS: rest/unit/RSAN1a3/publish-type-required-0
  it('RSAN1a3 - type required', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => req.respond_with(201, {}),
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');

    try {
      await ch.annotations.publish('msg-serial-1', { name: 'like' });
      expect.fail('Expected publish without type to throw with code 40003');
    } catch (error: any) {
      expect(error.code).to.equal(40003);
    }
  });

  /**
   * RSAN1c3 - data encoded per RSL4
   *
   * When annotation data is a JSON object, it must be encoded as a
   * JSON string with the encoding field set to 'json', following RSL4
   * message encoding rules.
   */
  // UTS: rest/unit/RSAN1c3/annotation-data-encoded-0
  it('RSAN1c3 - data encoded per RSL4', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.annotations.publish('msg-serial-1', { type: 'com.example.data', data: { key: 'value' } });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.have.length(1);

    // JSON data should be encoded as a string with encoding 'json'
    expect(body[0].data).to.be.a('string');
    expect(body[0].encoding).to.equal('json');
    expect(JSON.parse(body[0].data)).to.deep.equal({ key: 'value' });
  });

  /**
   * RSAN1c4 - idempotent ID generated
   *
   * When idempotentRestPublishing is true, the annotation's id should
   * be auto-generated in the format <base64>:0.
   *
   * NOTE: ably-js does not currently generate idempotent IDs for
   * annotations (only for messages via RestChannel.publish). This test
   * documents the spec requirement as a known deviation.
   */
  // UTS: rest/unit/RSAN1c4/idempotent-id-not-generated-1
  it('RSAN1c4 - idempotent ID generated', async function () {
    // DEVIATION: see deviations.md
    if (!process.env.RUN_DEVIATIONS) this.skip();
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: true,
    });
    const ch = client.channels.get('test');
    await ch.annotations.publish('msg-serial-1', { type: 'com.example.reaction' });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.have.length(1);

    // Spec (RSAN1c4): annotation id MUST be auto-generated in <base64>:0 format.
    // DEVIATION: ably-js does not generate idempotent IDs for annotations. See deviations.md.
    const id = body[0].id;
    expect(id).to.be.a('string');
    const parts = id.split(':');
    expect(parts).to.have.length(2);
    expect(parts[0]).to.match(/^[A-Za-z0-9_-]+$/);
    expect(parts[0].length).to.be.at.least(12);
    expect(parts[1]).to.equal('0');
  });

  /**
   * RSAN1c4 - no ID when disabled
   *
   * When idempotentRestPublishing is false, no idempotent ID should
   * be generated on the annotation.
   */
  // UTS: rest/unit/RSAN1c4/idempotent-id-generated-0
  it('RSAN1c4 - no ID when disabled', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: false,
    });
    const ch = client.channels.get('test');
    await ch.annotations.publish('msg-serial-1', { type: 'com.example.reaction' });

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.have.length(1);
    expect(body[0].id).to.be.undefined;
  });

  /**
   * RSAN2a - delete sends POST with ANNOTATION_DELETE
   *
   * annotations.delete() must send a POST request with
   * action=1 (ANNOTATION_DELETE) to the correct endpoint.
   */
  // UTS: rest/unit/RSAN1c6/publish-post-annotation-create-0.1
  it('RSAN2a - delete sends POST with ANNOTATION_DELETE', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.annotations.delete('msg-serial-1', { type: 'com.example.reaction', name: 'like' });

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.include('/messages/msg-serial-1/annotations');

    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].action).to.equal(1); // ANNOTATION_DELETE
    expect(body[0].messageSerial).to.equal('msg-serial-1');
    expect(body[0].type).to.equal('com.example.reaction');
    expect(body[0].name).to.equal('like');
  });

  /**
   * RSAN3b - get sends GET to correct path
   *
   * annotations.get() must send a GET request to
   * /channels/{channelName}/messages/{messageSerial}/annotations.
   */
  // UTS: rest/unit/RSL10/annotations-attribute-type-0.1
  it('RSAN3b - get sends GET to correct path', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          {
            id: 'ann-1',
            action: 0,
            type: 'com.example.reaction',
            name: 'like',
            clientId: 'user-1',
            serial: 'ann-serial-1',
            messageSerial: 'msg-serial-1',
            timestamp: 1700000000000,
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    const result = await ch.annotations.get('msg-serial-1', {});

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('get');
    expect(captured[0].path).to.include('/messages/msg-serial-1/annotations');
  });

  /**
   * RSAN3c - get returns PaginatedResult with annotation fields
   *
   * The response must be parsed into a PaginatedResult containing
   * Annotation objects with all expected fields decoded.
   */
  // UTS: rest/unit/RSL10/annotations-attribute-type-0.2
  it('RSAN3c - get returns PaginatedResult with annotation fields', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, [
          {
            id: 'ann-1',
            action: 0,
            type: 'com.example.reaction',
            name: 'like',
            clientId: 'user-1',
            count: 1,
            data: 'thumbs-up',
            serial: 'ann-serial-1',
            messageSerial: 'msg-serial-1',
            timestamp: 1700000000000,
            extras: { headers: { source: 'web' } },
          },
          {
            id: 'ann-2',
            action: 0,
            type: 'com.example.reaction',
            name: 'heart',
            clientId: 'user-2',
            count: 3,
            data: null,
            serial: 'ann-serial-2',
            messageSerial: 'msg-serial-1',
            timestamp: 1700000001000,
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    const result = await ch.annotations.get('msg-serial-1', {});

    expect(result.items).to.be.an('array');
    expect(result.items).to.have.length(2);

    // First annotation — full field coverage including extras
    const ann = result.items[0];
    expect(ann.id).to.equal('ann-1');
    expect(ann.action).to.equal('annotation.create'); // decoded from wire value 0
    expect(ann.type).to.equal('com.example.reaction');
    expect(ann.name).to.equal('like');
    expect(ann.clientId).to.equal('user-1');
    expect(ann.count).to.equal(1);
    expect(ann.data).to.equal('thumbs-up');
    expect(ann.serial).to.equal('ann-serial-1');
    expect(ann.messageSerial).to.equal('msg-serial-1');
    expect(ann.timestamp).to.equal(1700000000000);
    expect(ann.extras).to.deep.equal({ headers: { source: 'web' } });

    // Second annotation — verify multiple items decoded
    const ann2 = result.items[1];
    expect(ann2.id).to.equal('ann-2');
    expect(ann2.name).to.equal('heart');
    expect(ann2.clientId).to.equal('user-2');
    expect(ann2.count).to.equal(3);
  });

  /**
   * RSAN3b - get passes params as querystring
   *
   * Optional params passed to annotations.get() must be sent as
   * query string parameters on the GET request.
   */
  // UTS: rest/unit/RSL10/annotations-attribute-type-0.3
  it('RSAN3b - get passes params as querystring', async function () {
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
    const ch = client.channels.get('test');
    await ch.annotations.get('msg-serial-1', { limit: '50' } as any);

    expect(captured).to.have.length(1);
    expect(captured[0].url.searchParams.get('limit')).to.equal('50');
  });
});
