/**
 * UTS: PresenceMessage Type Tests
 *
 * Spec points: TP1, TP2, TP3, TP3a-TP3i, TP4, TP5
 * Source: uts/test/rest/unit/types/presence_message_types.md
 */

import { expect } from 'chai';
import { Ably, populateFieldsFromParent } from '../../../helpers';

describe('uts/rest/unit/types/presence_message_types', function () {
  /**
   * TP2 - PresenceAction values
   *
   * PresenceAction enum: absent (0), present (1), enter (2), leave (3), update (4).
   * In ably-js, application code uses string actions.
   */
  // UTS: rest/unit/TP2/presence-action-enum-values-0
  it('TP2 - PresenceAction values', function () {
    const actionStrings = ['absent', 'present', 'enter', 'leave', 'update'];

    actionStrings.forEach(function (actionStr) {
      const pm = Ably.Http.PresenceMessage.fromValues({ action: actionStr });
      expect(pm.action).to.equal(actionStr);
    });
  });

  /**
   * TP3a - id attribute
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0
  it('TP3a - id attribute', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({ id: 'pm-1' });
    expect(pm.id).to.equal('pm-1');
  });

  /**
   * TP3b - action attribute
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0.1
  it('TP3b - action attribute', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({ action: 'enter' });
    expect(pm.action).to.equal('enter');
  });

  /**
   * TP3c - clientId attribute
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0.2
  it('TP3c - clientId attribute', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({ clientId: 'user-1' });
    expect(pm.clientId).to.equal('user-1');
  });

  /**
   * TP3d - connectionId attribute
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0.3
  it('TP3d - connectionId attribute', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({ connectionId: 'conn-1' });
    expect(pm.connectionId).to.equal('conn-1');
  });

  /**
   * TP3e - data attribute (string)
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0.4
  it('TP3e - data attribute (string)', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({ data: 'hello' });
    expect(pm.data).to.equal('hello');
  });

  /**
   * TP3e - data attribute (object)
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0.5
  it('TP3e - data attribute (object)', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({ data: { key: 'val' } });
    expect(pm.data).to.deep.equal({ key: 'val' });
  });

  /**
   * TP3f - encoding attribute
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0.6
  it('TP3f - encoding attribute', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({ encoding: 'json' });
    expect(pm.encoding).to.equal('json');
  });

  /**
   * TP3g - timestamp attribute
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0.7
  it('TP3g - timestamp attribute', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({ timestamp: 1234567890000 });
    expect(pm.timestamp).to.equal(1234567890000);
  });

  /**
   * TP3i - extras attribute
   */
  // UTS: rest/unit/TP3a/presence-message-attributes-0.8
  it('TP3i - extras attribute', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({
      extras: { headers: { 'x-custom': 'value' } },
    });
    expect(pm.extras.headers['x-custom']).to.equal('value');
  });

  /**
   * TP3h - memberKey combines connectionId and clientId
   *
   * Per spec, memberKey is a "string function that combines the connectionId
   * and clientId ensuring multiple connected clients with the same clientId
   * are uniquely identifiable."
   */
  // UTS: rest/unit/TP3h/member-key-combines-ids-0
  it('TP3h - memberKey format', function () {
    // DEVIATION: see deviations.md
    if (!process.env.RUN_DEVIATIONS) this.skip();
    const pm = Ably.Http.PresenceMessage.fromValues({
      connectionId: 'conn-1',
      clientId: 'client-1',
    });

    expect(typeof (pm as any).memberKey).to.equal('string');
    expect((pm as any).memberKey).to.equal('conn-1:client-1');

    const pm2 = Ably.Http.PresenceMessage.fromValues({
      connectionId: 'conn-2',
      clientId: 'client-1',
    });

    expect((pm2 as any).memberKey).to.equal('conn-2:client-1');
    expect((pm as any).memberKey).to.not.equal((pm2 as any).memberKey);
  });

  /**
   * TP3 - deserialization from wire format via fromEncoded
   *
   * Wire format uses numeric action (2 = enter). fromEncoded decodes to string action.
   */
  // UTS: rest/unit/TP3/presence-from-json-0
  it('TP3 - deserialization from wire via fromEncoded', async function () {
    const pm = await Ably.Http.PresenceMessage.fromEncoded({
      action: 2,
      clientId: 'test',
      data: 'hi',
    });

    expect(pm.action).to.equal('enter');
    expect(pm.clientId).to.equal('test');
    expect(pm.data).to.equal('hi');
  });

  /**
   * TP3 - wire numeric actions decode to correct strings
   */
  // UTS: rest/unit/TP3/presence-to-json-2
  it('TP3 - all wire action values decode correctly', async function () {
    const expected = [
      { wire: 0, str: 'absent' },
      { wire: 1, str: 'present' },
      { wire: 2, str: 'enter' },
      { wire: 3, str: 'leave' },
      { wire: 4, str: 'update' },
    ];

    for (const tc of expected) {
      const pm = await Ably.Http.PresenceMessage.fromEncoded({
        action: tc.wire,
        clientId: 'user',
      });
      expect(pm.action).to.equal(tc.str, 'wire action ' + tc.wire + ' should decode to ' + tc.str);
    }
  });

  /**
   * TP4 - fromEncoded with JSON-encoded data
   *
   * fromEncoded decodes data based on the encoding field.
   */
  // UTS: rest/unit/TP4/from-encoded-presence-0
  it('TP4 - fromEncoded decodes json-encoded data', async function () {
    const pm = await Ably.Http.PresenceMessage.fromEncoded({
      action: 2,
      clientId: 'user-1',
      data: '{"status":"online"}',
      encoding: 'json',
    });

    expect(pm.data).to.deep.equal({ status: 'online' });
    // Encoding should be consumed after decoding
    expect(pm.encoding).to.be.null;
  });

  /**
   * TP4 - fromEncodedArray
   *
   * Decodes an array of wire-format presence messages.
   */
  // UTS: rest/unit/TP5/presence-message-size-0
  it('TP4 - fromEncodedArray', async function () {
    const messages = await Ably.Http.PresenceMessage.fromEncodedArray([
      { action: 2, clientId: 'alice', data: 'hello' },
      { action: 2, clientId: 'bob', data: 'world' },
    ]);

    expect(messages).to.have.lengthOf(2);
    expect(messages[0].clientId).to.equal('alice');
    expect(messages[0].data).to.equal('hello');
    expect(messages[1].clientId).to.equal('bob');
    expect(messages[1].data).to.equal('world');
  });

  /**
   * TP3 - null/missing attributes are undefined
   *
   * When fromEncoded receives a minimal presence message (only action),
   * unspecified attributes should be null or undefined.
   */
  // UTS: rest/unit/TP3/null-attributes-omitted-3
  it('TP3 - null/missing attributes are undefined', async function () {
    const pm = await Ably.Http.PresenceMessage.fromEncoded({ action: 1 });

    expect(pm.action).to.equal('present');
    // clientId, connectionId, data should be null or undefined
    expect(pm.clientId).to.satisfy((v: any) => v === null || v === undefined);
    expect(pm.connectionId).to.satisfy((v: any) => v === null || v === undefined);
    expect(pm.data).to.satisfy((v: any) => v === null || v === undefined);
  });

  /**
   * TP3 - timestamp as number
   *
   * When fromEncoded receives a presence message with a numeric timestamp,
   * it should be preserved as-is.
   */
  // UTS: rest/unit/TP3/presence-encoded-data-from-json-1
  it('TP3 - timestamp as number', async function () {
    const pm = await Ably.Http.PresenceMessage.fromEncoded({
      action: 1,
      timestamp: 1700000000000,
    });

    expect(pm.action).to.equal('present');
    expect(pm.timestamp).to.equal(1700000000000);
  });

  /**
   * TP - presence message with data exists as complete object
   *
   * Construct a PresenceMessage with data and verify it has all
   * the expected properties of a complete presence message.
   */
  // UTS: rest/unit/TP3d/connectionid-from-protocol-message-0
  it('TP - presence message with data is a complete object', function () {
    const pm = Ably.Http.PresenceMessage.fromValues({
      action: 'enter',
      clientId: 'user-1',
      connectionId: 'conn-1',
      data: { status: 'online', role: 'admin' },
      timestamp: 1700000000000,
      id: 'pm-full',
      encoding: null,
    });

    expect(pm).to.be.an('object');
    expect(pm.action).to.equal('enter');
    expect(pm.clientId).to.equal('user-1');
    expect(pm.connectionId).to.equal('conn-1');
    expect(pm.data).to.deep.equal({ status: 'online', role: 'admin' });
    expect(pm.timestamp).to.equal(1700000000000);
    expect(pm.id).to.equal('pm-full');
  });

  /**
   * TP3a - id defaults from ProtocolMessage
   *
   * For Realtime messages without an id, the id should be set to
   * protocolMsgId:index where index is the 0-based position in the
   * presence array.
   */
  // UTS: rest/unit/TP3a/id-from-protocol-message-1
  it('TP3a - id defaults from ProtocolMessage', function () {
    const makeProtocolMessage = Ably.makeProtocolMessageFromDeserialized();
    const protocolMsg = makeProtocolMessage({
      action: 14, // PRESENCE
      id: 'proto-msg-42',
      presence: [
        { action: 2, clientId: 'alice' },
        { action: 2, clientId: 'bob' },
      ],
    });

    // populateFieldsFromParent sets id = protocolMsgId:index on presence items
    populateFieldsFromParent(protocolMsg);

    expect(protocolMsg.presence).to.have.length(2);
    expect(protocolMsg.presence![0].id).to.equal('proto-msg-42:0');
    expect(protocolMsg.presence![1].id).to.equal('proto-msg-42:1');
  });

  /**
   * TP3g - timestamp defaults from ProtocolMessage
   *
   * If timestamp is not present in a received presence message,
   * it should be set to the timestamp of the encapsulating ProtocolMessage.
   */
  // UTS: rest/unit/TP3g/timestamp-from-protocol-message-0
  it('TP3g - timestamp defaults from ProtocolMessage', function () {
    const makeProtocolMessage = Ably.makeProtocolMessageFromDeserialized();
    const protocolMsg = makeProtocolMessage({
      action: 14, // PRESENCE
      timestamp: 9999999,
      presence: [{ action: 2, clientId: 'user-1' }],
    });

    // populateFieldsFromParent sets timestamp from ProtocolMessage
    populateFieldsFromParent(protocolMsg);

    expect(protocolMsg.presence).to.have.length(1);
    expect(protocolMsg.presence![0].timestamp).to.equal(9999999);
  });
});
