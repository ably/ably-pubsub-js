/**
 * UTS: Message Type Tests
 *
 * Spec points: TM1, TM2, TM3, TM4, TM2a, TM2b, TM2c, TM2d, TM2e, TM2f, TM2g, TM2h, TM2i
 * Source: uts/test/rest/unit/types/message_types.md
 */

import { expect } from 'chai';
import { Ably } from '../../../helpers';

const Message = Ably.Rest.Message;

describe('uts/rest/unit/types/message_types', function () {
  /**
   * TM2a - id attribute
   */
  // UTS: rest/unit/TM2a/message-attributes-0
  it('TM2a - id attribute', function () {
    const msg = Message.fromValues({ id: 'msg-1' });
    expect(msg.id).to.equal('msg-1');
  });

  /**
   * TM2b - name attribute
   */
  // UTS: rest/unit/TM2a/message-attributes-0.1
  it('TM2b - name attribute', function () {
    const msg = Message.fromValues({ name: 'test' });
    expect(msg.name).to.equal('test');
  });

  /**
   * TM2c - data attribute (string)
   */
  // UTS: rest/unit/TM2a/message-attributes-0.2
  it('TM2c - data attribute (string)', function () {
    const msg = Message.fromValues({ data: 'hello' });
    expect(msg.data).to.equal('hello');
  });

  /**
   * TM2c - data attribute (object)
   */
  // UTS: rest/unit/TM2a/message-attributes-0.3
  it('TM2c - data attribute (object)', function () {
    const msg = Message.fromValues({ data: { key: 'value' } });
    expect(msg.data).to.deep.equal({ key: 'value' });
  });

  /**
   * TM2d - clientId attribute
   */
  // UTS: rest/unit/TM2a/message-attributes-0.4
  it('TM2d - clientId attribute', function () {
    const msg = Message.fromValues({ clientId: 'user-1' });
    expect(msg.clientId).to.equal('user-1');
  });

  /**
   * TM2e - connectionId attribute
   */
  // UTS: rest/unit/TM2a/message-attributes-0.5
  it('TM2e - connectionId attribute', function () {
    const msg = Message.fromValues({ connectionId: 'conn-1' });
    expect(msg.connectionId).to.equal('conn-1');
  });

  /**
   * TM2f - timestamp attribute
   */
  // UTS: rest/unit/TM2a/message-attributes-0.6
  it('TM2f - timestamp attribute', function () {
    const msg = Message.fromValues({ timestamp: 1234567890000 });
    expect(msg.timestamp).to.equal(1234567890000);
  });

  /**
   * TM2g - encoding attribute
   */
  // UTS: rest/unit/TM2a/message-attributes-0.7
  it('TM2g - encoding attribute', function () {
    const msg = Message.fromValues({ encoding: 'json' });
    expect(msg.encoding).to.equal('json');
  });

  /**
   * TM2h - extras attribute
   */
  // UTS: rest/unit/TM2a/message-attributes-0.8
  it('TM2h - extras attribute', function () {
    const msg = Message.fromValues({
      extras: { push: { notification: { title: 'Hi' } } },
    });
    expect(msg.extras).to.deep.equal({ push: { notification: { title: 'Hi' } } });
    expect(msg.extras.push.notification.title).to.equal('Hi');
  });

  /**
   * TM2i - serial attribute
   */
  // UTS: rest/unit/TM2a/message-attributes-0.9
  it('TM2i - serial attribute', function () {
    const msg = Message.fromValues({ serial: '01234567890:0' });
    expect(msg.serial).to.equal('01234567890:0');
  });

  /**
   * TM3 - fromEncoded deserializes wire message
   */
  // UTS: rest/unit/TM3/from-encoded-deserialization-0
  it('TM3 - fromEncoded deserializes wire message', async function () {
    const msg = await Message.fromEncoded({
      name: 'test',
      data: 'hello',
      id: 'msg-1',
      clientId: 'sender-client',
      connectionId: 'conn-456',
      timestamp: 1234567890000,
      extras: { headers: { 'x-custom': 'value' } },
    });

    expect(msg.id).to.equal('msg-1');
    expect(msg.name).to.equal('test');
    expect(msg.data).to.equal('hello');
    expect(msg.clientId).to.equal('sender-client');
    expect(msg.connectionId).to.equal('conn-456');
    expect(msg.timestamp).to.equal(1234567890000);
    expect(msg.extras).to.deep.equal({ headers: { 'x-custom': 'value' } });
  });

  /**
   * TM3 - fromEncoded with all fields
   */
  // UTS: rest/unit/TM/message-with-extras-1
  it('TM3 - fromEncoded with all fields', async function () {
    const msg = await Message.fromEncoded({
      id: 'id1',
      name: 'test',
      data: 'hello',
      clientId: 'c1',
      connectionId: 'conn1',
      timestamp: 1700000000000,
      encoding: null,
      extras: { key: 'val' },
    });

    expect(msg.id).to.equal('id1');
    expect(msg.name).to.equal('test');
    expect(msg.data).to.equal('hello');
    expect(msg.clientId).to.equal('c1');
    expect(msg.connectionId).to.equal('conn1');
    expect(msg.timestamp).to.equal(1700000000000);
    expect(msg.extras).to.deep.equal({ key: 'val' });
  });

  /**
   * TM3 - fromEncoded decodes base64 encoding
   */
  // UTS: rest/unit/TM3/from-encoded-decodes-encoding-1
  it('TM3 - fromEncoded decodes base64 encoding', async function () {
    const msg = await Message.fromEncoded({
      data: 'SGVsbG8=',
      encoding: 'base64',
    });

    const isBinary = Buffer.isBuffer(msg.data) || msg.data instanceof Uint8Array;
    expect(isBinary).to.be.true;
    expect(msg.encoding).to.be.null;
    const text = Buffer.from(msg.data).toString('utf8');
    expect(text).to.equal('Hello');
  });

  /**
   * TM2 - null/missing attributes are undefined
   */
  // UTS: rest/unit/TM/null-missing-attributes-0
  it('TM2 - null/missing attributes are undefined', function () {
    const msg = Message.fromValues({ name: 'test' });

    expect(msg.name).to.equal('test');
    expect(msg.data).to.be.undefined;
    expect(msg.clientId).to.be.undefined;
    expect(msg.connectionId).to.be.undefined;
    expect(msg.id).to.be.undefined;
    expect(msg.timestamp).to.be.undefined;
  });

  /**
   * TM4 - constructor(name, data)
   *
   * TM4: Message has constructors constructor(name, data) and
   * constructor(name, data, clientId). In ably-js this is Message.fromValues().
   */
  // UTS: rest/unit/TM4/message-constructors-0
  it('TM4 - constructor(name, data)', function () {
    const msg = Message.fromValues({ name: 'event-name', data: 'payload' });
    expect(msg.name).to.equal('event-name');
    expect(msg.data).to.equal('payload');
    expect(msg.clientId).to.be.undefined;
  });

  /**
   * TM4 - constructor(name, data, clientId)
   */
  // UTS: rest/unit/TM4/message-constructors-0.1
  it('TM4 - constructor(name, data, clientId)', function () {
    const msg = Message.fromValues({ name: 'event-name', data: 'payload', clientId: 'client-1' });
    expect(msg.name).to.equal('event-name');
    expect(msg.data).to.equal('payload');
    expect(msg.clientId).to.equal('client-1');
  });

  /**
   * TM4 - name and data are nullable
   */
  // UTS: rest/unit/TM4/message-constructors-0.2
  it('TM4 - name and data are nullable', function () {
    const msg = Message.fromValues({});
    expect(msg.name).to.be.undefined;
    expect(msg.data).to.be.undefined;
  });
});
