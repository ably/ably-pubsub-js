/**
 * UTS: REST Channel Publish Tests
 *
 * Spec points: RSL1a, RSL1b, RSL1c, RSL1e, RSL1h, RSL1i, RSL1j, RSL1m1, RSL1m2, RSL1m3
 * Source: uts/test/rest/unit/channel/publish.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

const Message = Ably.Rest.Message;

describe('uts/rest/unit/channel/publish', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL1a - publish sends POST to correct path
   *
   * Publishing a message on a channel must send a POST request
   * to /channels/<channelName>/messages.
   */
  // UTS: rest/unit/RSL1a/publish-name-and-data-0
  it('RSL1a - publish sends POST to correct path', async function () {
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
    await ch.publish('event', 'data');

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('post');
    expect(captured[0].path).to.equal('/channels/test/messages');
  });

  /**
   * RSL1b - publish body contains message
   *
   * The POST body must contain the published message serialized as JSON.
   */
  // UTS: rest/unit/RSL1a/publish-name-and-data-0.1
  it('RSL1b - publish body contains message', async function () {
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
    await ch.publish('event', 'data');

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    // ably-js sends an array of messages
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].name).to.equal('event');
    expect(body[0].data).to.equal('data');
  });

  /**
   * RSL1c - publish array sends single request
   *
   * Publishing an array of messages must send them all in a single
   * POST request, with the body containing all messages.
   */
  // UTS: rest/unit/RSL1a/publish-message-array-1
  it('RSL1c - publish array sends single request', async function () {
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
    await ch.publish([
      { name: 'a', data: 'one' },
      { name: 'b', data: 'two' },
      { name: 'c', data: 'three' },
    ]);

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(3);
    expect(body[0].name).to.equal('a');
    expect(body[1].name).to.equal('b');
    expect(body[2].name).to.equal('c');
  });

  /**
   * RSL1e - null name omitted from body
   *
   * Per spec: "If any of the values are null, then key is not sent to Ably"
   */
  // UTS: rest/unit/RSL1e/null-name-and-data-0.1
  it('RSL1e - null name omitted from body', async function () {
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

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.publish(null, 'data');

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect('name' in body[0]).to.be.false;
    expect(body[0].data).to.equal('data');
  });

  /**
   * RSL1e - null data omitted from body
   *
   * Per spec: "If any of the values are null, then key is not sent to Ably"
   */
  // UTS: rest/unit/RSL1e/null-name-and-data-0.2
  it('RSL1e - null data omitted from body', async function () {
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

    const client = new Ably.Rest({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test');
    await ch.publish('event', null);

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].name).to.equal('event');
    expect('data' in body[0]).to.be.false;
  });

  /**
   * RSL1h - publish(name, data) two-arg form
   *
   * The two-argument publish(name, data) form must produce a message
   * with both name and data fields in the request body.
   */
  // UTS: rest/unit/RSL1h/publish-signature-0
  it('RSL1h - publish(name, data) two-arg form', async function () {
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
    await ch.publish('my-event', 'my-data');

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].name).to.equal('my-event');
    expect(body[0].data).to.equal('my-data');
  });

  /**
   * RSL1i - message size limit exceeded
   *
   * When the total message size exceeds maxMessageSize, the publish must
   * fail with error code 40009 without sending a request. Uses explicit
   * maxMessageSize for deterministic testing.
   */
  // UTS: rest/unit/RSL1i/message-size-limit-0
  it('RSL1i - message size limit exceeded', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, {});
      },
    });
    installMockHttp(mock);

    // Use explicit maxMessageSize for deterministic testing
    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      maxMessageSize: 1024,
    });
    const ch = client.channels.get('test');

    // Data that exceeds the 1024 limit
    const largeData = 'x'.repeat(2000);

    try {
      await ch.publish('event', largeData);
      expect.fail('Expected publish to throw due to message size limit');
    } catch (error: any) {
      expect(error.code).to.equal(40009);
    }

    // No HTTP request should have been made
    expect(captured).to.have.length(0);
  });

  /**
   * RSL1i - message at size limit succeeds
   *
   * A message at or under the size limit should succeed.
   */
  // UTS: rest/unit/RSL1i/message-size-limit-0.1
  it('RSL1i - message at size limit succeeds', async function () {
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
      maxMessageSize: 65536,
    });
    const ch = client.channels.get('test');

    // Small data well within the limit
    await ch.publish('event', 'small data');

    expect(captured).to.have.length(1);
  });

  /**
   * RSL1j - all message attributes transmitted
   *
   * When a message is constructed with all optional attributes
   * (id, clientId, extras), they must all appear in the request body.
   */
  // UTS: rest/unit/RSL1j/all-attributes-transmitted-0
  it('RSL1j - all message attributes transmitted', async function () {
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

    const msg = Message.fromValues({
      name: 'e',
      data: 'd',
      id: 'msg-1',
      clientId: 'c1',
      extras: { push: { notification: { title: 'Hi' } } },
    });

    await ch.publish(msg);

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].name).to.equal('e');
    expect(body[0].data).to.equal('d');
    expect(body[0].id).to.equal('msg-1');
    expect(body[0].clientId).to.equal('c1');
    expect(body[0].extras).to.deep.equal({ push: { notification: { title: 'Hi' } } });
  });

  /**
   * RSL1m1 - library clientId not auto-injected
   *
   * When a client has a clientId set in options but the published message
   * does not specify a clientId, the library must NOT auto-inject the
   * clientId into the message body (ably-js behaviour for REST).
   */
  // UTS: rest/unit/RSL1m/clientid-not-injected-0
  it('RSL1m1 - library clientId not auto-injected', async function () {
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
      clientId: 'lib-client',
    });
    const ch = client.channels.get('test');
    await ch.publish('event', 'data');

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0]).to.not.have.property('clientId');
  });

  /**
   * RSL1m2 - explicit matching clientId preserved
   *
   * When a client has a clientId and the message explicitly sets the
   * same clientId, it must be preserved in the request body.
   */
  // UTS: rest/unit/RSL1m/clientid-not-injected-0.1
  it('RSL1m2 - explicit matching clientId preserved', async function () {
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
      clientId: 'lib-client',
    });
    const ch = client.channels.get('test');

    const msg = Message.fromValues({ name: 'event', data: 'data', clientId: 'lib-client' });
    await ch.publish(msg);

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].clientId).to.equal('lib-client');
  });

  /**
   * RSL1m3 - unidentified client with message clientId
   *
   * When a client has no clientId set but the message explicitly sets
   * a clientId, it must be preserved in the request body.
   */
  // UTS: rest/unit/RSL1m/clientid-not-injected-0.2
  it('RSL1m3 - unidentified client with message clientId', async function () {
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

    const msg = Message.fromValues({ name: 'event', data: 'data', clientId: 'msg-client' });
    await ch.publish(msg);

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].clientId).to.equal('msg-client');
  });

  /**
   * RSL1e - Both name and data null
   *
   * Publishing with both name and data null should succeed.
   * The wire body should contain an empty message object (or one with
   * null fields).
   */
  // UTS: rest/unit/RSL1e/null-name-and-data-0
  it('RSL1e - both name and data null', async function () {
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
    await client.channels.get('test').publish(null, null);

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    // The message should be essentially empty (name and data are null/missing)
  });

  /**
   * RSL1l - Publish params passed as querystring
   *
   * Additional params passed to publish should appear as query parameters.
   */
  // UTS: rest/unit/RSL1l/params-as-querystring-0
  it('RSL1l - publish params as querystring', async function () {
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

    const msg = Message.fromValues({ name: 'event', data: 'data' });
    await ch.publish(msg, { customParam: 'customValue', anotherParam: '123' } as any);

    expect(captured).to.have.length(1);
    // Spec (RSL1l): additional params MUST appear as query parameters.
    // DEVIATION: ably-js RestChannel.publish() may not support additional params. See deviations.md.
    expect(captured[0].url.searchParams.get('customParam')).to.equal('customValue');
    expect(captured[0].url.searchParams.get('anotherParam')).to.equal('123');
  });
});
