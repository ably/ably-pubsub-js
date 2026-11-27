/**
 * UTS: Message Patch Type Tests
 *
 * Spec points: TM5, TM2v, MPA1, MPA2, MPD2, MPD4, MPD4a, MPH2, MPU2, MPP2
 * Source: uts/rest/unit/types/message_patch_types.md
 */

import { expect } from 'chai';
import { Ably } from '../../../helpers';

const Message = Ably.Http.Message;

describe('uts/rest/unit/types/message_patch_types', function () {
  /**
   * TM5 - MessageAction includes MESSAGE_PATCH
   *
   * ably-js exposes actions as strings; MESSAGE_PATCH is 'message.patch',
   * with wire value 6.
   */
  // UTS: rest/unit/TM5/message-patch-action-value-0
  it('TM5 - MessageAction includes MESSAGE_PATCH', async function () {
    const decoded = await Message.fromEncoded({ serial: 's1', action: 6 });
    expect(decoded.action).to.equal('message.patch');

    const wire = await Message.fromValues({ serial: 's1', action: 'message.patch' }).encode({} as any);
    expect(JSON.parse(JSON.stringify(wire)).action).to.equal(6);
  });

  /**
   * TM2v, MPA2, MPD2, MPH2, MPU2, MPP2 - received patches are parsed into typed operations
   */
  // UTS: rest/unit/TM2v/patches-parsed-from-wire-0
  it('TM2v - received patches are parsed into typed operations', async function () {
    const msg = await Message.fromEncoded({
      action: 6,
      serial: 'msg-serial-1',
      version: { serial: 'version-serial-2', timestamp: 1700000002000 },
      patches: {
        data: [
          { op: 'append', path: '/content/0/text', data: ' more' },
          { op: 'set', data: 'replaced' },
          { op: 'remove', path: '/old' },
        ],
        extras: {
          headers: [
            { op: 'set', key: 'status', value: 'complete' },
            { op: 'set', key: 'count', value: 3 },
            { op: 'set', key: 'final', value: true },
            { op: 'remove', key: 'draft' },
          ],
          userClaim: { op: 'set', value: 'moderator' },
          privileged: { op: 'remove' },
        },
      },
    });

    expect(msg.patches).to.be.an('object');

    const dataOps = msg.patches!.data!;
    expect(dataOps).to.have.length(3);
    expect(dataOps[0].op).to.equal('append');
    expect(dataOps[0].path).to.equal('/content/0/text');
    expect(dataOps[0].data).to.equal(' more');
    expect(dataOps[1].op).to.equal('set');
    expect(dataOps[1].path === undefined || dataOps[1].path === '').to.equal(true);
    expect(dataOps[1].data).to.equal('replaced');
    expect(dataOps[2].op).to.equal('remove');
    expect(dataOps[2].path).to.equal('/old');
    expect(dataOps[2].data).to.equal(undefined);

    const headers = msg.patches!.extras!.headers!;
    expect(headers).to.have.length(4);
    expect(headers[0].op).to.equal('set');
    expect(headers[0].key).to.equal('status');
    expect(headers[0].value).to.equal('complete');
    expect(headers[1].value).to.equal(3);
    expect(headers[2].value).to.equal(true);
    expect(headers[3].op).to.equal('remove');
    expect(headers[3].key).to.equal('draft');
    expect(headers[3].value).to.equal(undefined);

    expect(msg.patches!.extras!.userClaim!.op).to.equal('set');
    expect(msg.patches!.extras!.userClaim!.value).to.equal('moderator');

    expect(msg.patches!.extras!.privileged!.op).to.equal('remove');
  });

  /**
   * MPD4, MPD4a - operation values are decoded, keeping JSON values as text
   */
  // UTS: rest/unit/MPD4/patch-values-decoded-0
  it('MPD4 - operation values are decoded, keeping JSON values as text', async function () {
    const msg = await Message.fromEncoded({
      action: 6,
      serial: 's1',
      patches: {
        data: [
          { op: 'set', path: '/a', data: '{"b":1}', encoding: 'json' },
          { op: 'set', path: '/n', data: '42', encoding: 'json' },
          { op: 'set', path: '/c', data: 'AQI=', encoding: 'base64' },
          { op: 'set', path: '/u', data: 'aGk=', encoding: 'utf-8/base64' },
          { op: 'set', path: '/j', data: 'eyJ4IjoxfQ==', encoding: 'json/utf-8/base64' },
          { op: 'append', path: '/d', data: 'text' },
        ],
      },
    });
    const ops = msg.patches!.data!;

    // MPD4a - JSON values stay as JSON text, whatever their type
    expect(ops[0].data).to.equal('{"b":1}');
    expect(ops[0].encoding).to.equal('json');
    expect(ops[1].data).to.equal('42');
    expect(ops[1].encoding).to.equal('json');

    // MPD4 - other transforms are inverted, as for a message's data
    expect(Buffer.isBuffer(ops[2].data)).to.equal(true);
    expect([...(ops[2].data as Buffer)]).to.deep.equal([0x01, 0x02]);
    expect(ops[2].encoding || null).to.equal(null);
    expect(ops[3].data).to.equal('hi');
    expect(ops[3].encoding || null).to.equal(null);

    // MPD4a - the transforms after a leading json are inverted, leaving the JSON text
    expect(ops[4].data).to.equal('{"x":1}');
    expect(ops[4].encoding).to.equal('json');

    expect(ops[5].data).to.equal('text');
    expect(ops[5].encoding || null).to.equal(null);
  });

  /**
   * MPA2, MPD2, MPH2 - patches round-trip through toJson
   *
   * ably-js has no public Message.toJson; the message is encoded for the wire
   * and serialized as JSON, as the REST and realtime clients do.
   */
  // UTS: rest/unit/MPA2/patches-serialized-to-wire-0
  it('MPA2 - patches round-trip through toJson', async function () {
    const msg = Message.fromValues({
      serial: 's1',
      action: 'message.patch',
      patches: {
        data: [
          { op: 'append', path: '/text', data: 'lo' },
          { op: 'remove', path: '/old' },
        ],
        extras: {
          headers: [{ op: 'set', key: 'status', value: 'complete' }],
        },
      },
    });
    const json = JSON.parse(JSON.stringify(await msg.encode({} as any)));

    expect(json.action).to.equal(6);
    expect(json.serial).to.equal('s1');
    expect(json.patches.data).to.deep.equal([
      { op: 'append', path: '/text', data: 'lo' },
      { op: 'remove', path: '/old' },
    ]);
    expect(json.patches.extras.headers).to.deep.equal([{ op: 'set', key: 'status', value: 'complete' }]);
  });
});
