/**
 * UTS: Mutable Message Type Tests
 *
 * Spec points: TM2j, TM2r, TM2s, TM5, TM8, MOP, UDR, TAN
 * Source: uts/test/rest/unit/types/mutable_message_types.md
 */

import { expect } from 'chai';
import { Ably } from '../../../helpers';

describe('uts/rest/unit/types/mutable_message_types', function () {
  /**
   * TM5 - MessageAction string values
   *
   * MessageAction enum has values: MESSAGE_CREATE (0), MESSAGE_UPDATE (1),
   * MESSAGE_DELETE (2), META (3), MESSAGE_SUMMARY (4), MESSAGE_APPEND (5).
   * In ably-js, application code uses string actions.
   */
  // UTS: rest/unit/TM5/message-action-enum-values-0
  it('TM5 - MessageAction string values', function () {
    const actionStrings = [
      'message.create',
      'message.update',
      'message.delete',
      'meta',
      'message.summary',
      'message.append',
    ];

    actionStrings.forEach(function (actionStr: any) {
      const msg = Ably.Rest.Message.fromValues({ action: actionStr });
      expect(msg.action).to.equal(actionStr);
    });
  });

  /**
   * TM5 - MessageAction numeric wire values
   *
   * Wire format uses numeric values (0-5). fromEncoded must decode
   * these to their string equivalents.
   */
  // UTS: rest/unit/TM5/message-action-enum-values-0.1
  it('TM5 - MessageAction numeric wire values', async function () {
    const wireToString = [
      [0, 'message.create'],
      [1, 'message.update'],
      [2, 'message.delete'],
      [3, 'meta'],
      [4, 'message.summary'],
      [5, 'message.append'],
    ];

    for (const [wireValue, expectedString] of wireToString) {
      const msg = await Ably.Rest.Message.fromEncoded({
        action: wireValue,
        serial: 'test-serial',
        name: 'test',
      });
      expect(msg.action).to.equal(expectedString);
    }
  });

  /**
   * TM2j - action attribute
   *
   * Message has an action attribute of type MessageAction.
   */
  // UTS: rest/unit/TM2j/action-and-serial-fields-0
  it('TM2j - action attribute', function () {
    const msg = Ably.Rest.Message.fromValues({ action: 'message.update' });
    expect(msg.action).to.equal('message.update');
  });

  /**
   * TM2r - serial attribute
   *
   * Message has a serial attribute: an opaque string that uniquely identifies the message.
   */
  // UTS: rest/unit/TM2j/action-and-serial-fields-0.1
  it('TM2r - serial attribute', function () {
    const msg = Ably.Rest.Message.fromValues({ serial: 'abc:0' });
    expect(msg.serial).to.equal('abc:0');
  });

  /**
   * TM2s - version object fields
   *
   * Message.version is an object with serial, timestamp, clientId, description, metadata.
   * When decoded from wire via fromEncoded, expandFields populates version defaults.
   */
  // UTS: rest/unit/TM2s/version-populated-from-wire-0
  it('TM2s - version object fields via fromEncoded', async function () {
    const msg = await Ably.Rest.Message.fromEncoded({
      serial: 'msg-serial-1',
      name: 'test',
      data: 'hello',
      version: {
        serial: 'version-serial-1',
        timestamp: 1700000001000,
        clientId: 'editor-1',
        description: 'fixed typo',
        metadata: { reason: 'typo', tool: 'editor' },
      },
    });

    expect(msg.version).to.exist;
    expect(msg.version!.serial).to.equal('version-serial-1');
    expect(msg.version!.timestamp).to.equal(1700000001000);
    expect(msg.version!.clientId).to.equal('editor-1');
    expect(msg.version!.description).to.equal('fixed typo');
    expect(msg.version!.metadata).to.deep.equal({ reason: 'typo', tool: 'editor' });
  });

  /**
   * TM2s1, TM2s2 - version defaults when not on wire
   *
   * If version is absent, SDK initializes it with serial from TM2r and timestamp from TM2f.
   */
  // UTS: rest/unit/TM2s1/version-defaults-from-message-0
  it('TM2s1, TM2s2 - version defaults from serial and timestamp', async function () {
    const msg = await Ably.Rest.Message.fromEncoded({
      serial: 'msg-serial-1',
      timestamp: 1700000000000,
      name: 'test',
      data: 'hello',
    });

    expect(msg.version).to.exist;
    // TM2s1: version.serial defaults to message serial
    expect(msg.version!.serial).to.equal('msg-serial-1');
    // TM2s2: version.timestamp defaults to message timestamp
    expect(msg.version!.timestamp).to.equal(1700000000000);
  });

  /**
   * TM2u, TM8a - annotations defaults to empty
   *
   * If annotations not set on wire, SDK sets it to an empty MessageAnnotations with empty summary.
   */
  // UTS: rest/unit/TM2u/annotations-defaults-empty-0
  it('TM2u, TM8a - annotations defaults to empty', async function () {
    const msg = await Ably.Rest.Message.fromEncoded({
      serial: 'msg-serial-1',
      name: 'test',
    });

    expect(msg.annotations).to.exist;
    expect(msg.annotations!.summary).to.exist;
    expect(Object.keys(msg.annotations!.summary)).to.have.lengthOf(0);
  });

  /**
   * MOP2a-c - MessageOperation fields
   *
   * MessageOperation has clientId, description, metadata fields.
   * In ably-js these are plain objects (no MessageOperation class).
   */
  // UTS: rest/unit/MOP2a/message-operation-fields-0
  it('MOP2a-c - MessageOperation fields', function () {
    const op = {
      clientId: 'user-1',
      description: 'edit description',
      metadata: { reason: 'typo', tool: 'editor' },
    };

    expect(op.clientId).to.equal('user-1');
    expect(op.description).to.equal('edit description');
    expect(op.metadata.reason).to.equal('typo');
    expect(op.metadata.tool).to.equal('editor');

    // Empty operation
    const emptyOp: any = {};
    expect(emptyOp.clientId).to.be.undefined;
    expect(emptyOp.description).to.be.undefined;
    expect(emptyOp.metadata).to.be.undefined;
  });

  /**
   * UDR1, UDR2a - UpdateDeleteResult fields
   *
   * UpdateDeleteResult contains versionSerial field.
   * In ably-js this is a plain object returned from update/delete operations.
   */
  // UTS: rest/unit/UDR2a/update-delete-result-fields-0
  it('UDR1, UDR2a - UpdateDeleteResult versionSerial field', function () {
    // Non-null versionSerial
    const result1 = { versionSerial: 'version-serial-abc' };
    expect(result1.versionSerial).to.equal('version-serial-abc');

    // Null versionSerial (message superseded)
    const result2 = { versionSerial: null };
    expect(result2.versionSerial).to.be.null;

    // Missing versionSerial key
    const result3: any = {};
    expect(result3.versionSerial).to.be.undefined;
  });

  /**
   * TAN1, TAN2a-l - Annotation type and attributes
   *
   * Annotation represents an individual annotation event with id, action, clientId,
   * name, type, data, count, serial, messageSerial, timestamp, extras fields.
   * AnnotationAction: annotation.create (wire 0), annotation.delete (wire 1).
   */
  // UTS: rest/unit/TAN2/annotation-attributes-and-action-0
  it('TAN1, TAN2 - Annotation attributes via fromEncoded', async function () {
    const ann = await Ably.Rest.Annotation.fromEncoded({
      id: 'ann-id-1',
      action: 0,
      clientId: 'user-1',
      name: 'like',
      count: 5,
      data: 'thumbs-up',
      timestamp: 1700000000000,
      serial: 'ann-serial-1',
      messageSerial: 'msg-serial-1',
      type: 'com.example.reaction',
      extras: { custom: 'metadata' },
    });

    expect(ann.id).to.equal('ann-id-1');
    expect(ann.action).to.equal('annotation.create');
    expect(ann.clientId).to.equal('user-1');
    expect(ann.name).to.equal('like');
    expect(ann.count).to.equal(5);
    expect(ann.data).to.equal('thumbs-up');
    expect(ann.timestamp).to.equal(1700000000000);
    expect(ann.serial).to.equal('ann-serial-1');
    expect(ann.messageSerial).to.equal('msg-serial-1');
    expect(ann.type).to.equal('com.example.reaction');
    expect(ann.extras).to.deep.equal({ custom: 'metadata' });
  });

  /**
   * TAN2b - AnnotationAction values
   *
   * Wire 0 = annotation.create, wire 1 = annotation.delete.
   */
  // UTS: rest/unit/TAN2/annotation-attributes-and-action-0.1
  it('TAN2b - AnnotationAction wire values', async function () {
    const create = await Ably.Rest.Annotation.fromEncoded({ action: 0, data: 'a' });
    expect(create.action).to.equal('annotation.create');

    const del = await Ably.Rest.Annotation.fromEncoded({ action: 1, data: 'b' });
    expect(del.action).to.equal('annotation.delete');
  });
});
