/**
 * UTS: REST Channel Idempotent Publishing Tests
 *
 * Spec points: RSL1k, RSL1k1, RSL1k2, RSL1k3
 * Source: uts/test/rest/unit/channel/idempotency.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

const Message = Ably.Rest.Message;

describe('uts/rest/unit/channel/idempotency', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL1k1 - idempotentRestPublishing defaults to true
   *
   * The idempotentRestPublishing option must default to true.
   */
  // UTS: rest/unit/RSL1k1/idempotent-default-true-0
  it('RSL1k1 - idempotentRestPublishing defaults to true', function () {
    const client = new Ably.Rest({ key: 'a.b:c' });
    expect(client.options.idempotentRestPublishing).to.equal(true);
  });

  /**
   * RSL1k2 - message ID format
   *
   * When idempotentRestPublishing is true, a published message without
   * a client-supplied ID must get a library-generated ID in the format
   * <base64>:<serial>, where <base64> is at least 12 characters of
   * URL-safe base64 and <serial> starts at 0.
   */
  // UTS: rest/unit/RSL1k2/message-id-format-0
  it('RSL1k2 - message ID format', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: ['s1'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: true,
    });
    const ch = client.channels.get('test');
    await ch.publish('event', 'data');

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);

    const id = body[0].id;
    expect(id).to.be.a('string');

    const parts = id.split(':');
    expect(parts).to.have.length(2);

    // Base part must be base64 and at least 12 chars
    expect(parts[0]).to.match(/^[A-Za-z0-9+/=_-]+$/);
    expect(parts[0].length).to.be.at.least(12);

    // Serial starts at 0
    expect(parts[1]).to.equal('0');
  });

  /**
   * RSL1k2 - batch serial increments
   *
   * When publishing an array of messages, each message must share the
   * same base ID but have incrementing serial numbers starting from 0.
   */
  // UTS: rest/unit/RSL1k2/serial-increments-batch-1
  it('RSL1k2 - batch serial increments', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: ['s1', 's2', 's3'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: true,
    });
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

    // All must have the same base ID
    const base0 = body[0].id.split(':')[0];
    const base1 = body[1].id.split(':')[0];
    const base2 = body[2].id.split(':')[0];
    expect(base0).to.equal(base1);
    expect(base1).to.equal(base2);

    // Serials must be 0, 1, 2
    expect(body[0].id.split(':')[1]).to.equal('0');
    expect(body[1].id.split(':')[1]).to.equal('1');
    expect(body[2].id.split(':')[1]).to.equal('2');
  });

  /**
   * RSL1k3 - separate publishes get unique base IDs
   *
   * Each separate publish call must generate a unique base ID so that
   * publishes are independently idempotent.
   */
  // UTS: rest/unit/RSL1k3/unique-base-ids-0
  it('RSL1k3 - separate publishes get unique base IDs', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: ['s1'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: true,
    });
    const ch = client.channels.get('test');
    await ch.publish('event1', 'data1');
    await ch.publish('event2', 'data2');

    expect(captured).to.have.length(2);
    const body1 = JSON.parse(captured[0].body);
    const body2 = JSON.parse(captured[1].body);

    const base1 = body1[0].id.split(':')[0];
    const base2 = body2[0].id.split(':')[0];
    expect(base1).to.not.equal(base2);
  });

  /**
   * RSL1k3 - no ID when disabled
   *
   * When idempotentRestPublishing is false, the library must NOT
   * generate message IDs.
   */
  // UTS: rest/unit/RSL1k3/no-id-when-disabled-1
  it('RSL1k3 - no ID when disabled', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: ['s1'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: false,
    });
    const ch = client.channels.get('test');
    await ch.publish('event', 'data');

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].id).to.be.undefined;
  });

  /**
   * RSL1k - client-supplied ID preserved
   *
   * When a message is published with a client-supplied ID, the library
   * must preserve it and not overwrite it with a generated ID.
   */
  // UTS: rest/unit/RSL1k/client-id-preserved-0
  it('RSL1k - client-supplied ID preserved', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: ['s1'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: true,
    });
    const ch = client.channels.get('test');

    const msg = Message.fromValues({ id: 'my-custom-id', name: 'e', data: 'd' });
    await ch.publish(msg);

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(1);
    expect(body[0].id).to.equal('my-custom-id');
  });

  /**
   * RSL1k2 - same ID on retry
   *
   * When a publish request fails with a 500 error and is retried, the
   * retry must use the same message ID to ensure idempotency.
   * If ably-js does not retry on 500, we verify the ID format on the
   * single request.
   */
  // UTS: rest/unit/RSL1k2/same-id-on-retry-2
  it('RSL1k2 - same ID on retry', async function () {
    const captured: any[] = [];
    let requestCount = 0;
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        requestCount++;
        captured.push(req);
        if (requestCount === 1) {
          req.respond_with(500, { error: { message: 'Internal Server Error', code: 50000, statusCode: 500 } });
        } else {
          req.respond_with(201, { serials: ['s1'] });
        }
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: true,
    });
    const ch = client.channels.get('test');

    // Spec (RSL1k2): publish MUST retry on 500 with the same idempotent ID.
    await ch.publish('event', 'data');

    expect(captured).to.have.length(2);

    const body1 = JSON.parse(captured[0].body);
    const body2 = JSON.parse(captured[1].body);
    expect(body1[0].id).to.be.a('string');
    expect(body1[0].id).to.match(/^[A-Za-z0-9+/_-]+:0$/);
    expect(body2[0].id).to.equal(body1[0].id);
  });

  /**
   * RSL1k - mixed client and library IDs skips generation
   *
   * When a batch of messages contains any message with a client-supplied
   * ID, ably-js skips ID generation for the entire batch (allEmptyIds
   * check). Client-supplied IDs are preserved; messages without IDs
   * remain without IDs.
   */
  // UTS: rest/unit/RSL1k/mixed-ids-in-batch-1
  it('RSL1k - mixed client and library IDs skips generation', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(201, { serials: ['s1', 's2', 's3'] });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      idempotentRestPublishing: true,
    });
    const ch = client.channels.get('test');

    const msg1 = Message.fromValues({ id: 'client-id-1', name: 'e1', data: 'd1' });
    const msg2 = Message.fromValues({ name: 'e2', data: 'd2' });
    const msg3 = Message.fromValues({ id: 'client-id-2', name: 'e3', data: 'd3' });

    await ch.publish([msg1, msg2, msg3]);

    expect(captured).to.have.length(1);
    const body = JSON.parse(captured[0].body);
    expect(body).to.be.an('array');
    expect(body).to.have.length(3);

    // First message: client-supplied ID preserved
    expect(body[0].id).to.equal('client-id-1');

    // Second message: no ID generated (allEmptyIds returned false)
    expect(body[1].id).to.be.undefined;

    // Third message: client-supplied ID preserved
    expect(body[2].id).to.equal('client-id-2');
  });
});
