/**
 * UTS: REST Channel PatchMessage Tests
 *
 * Spec points: RSL15a, RSL15b, RSL15b1, RSL15c, RSL15e, RSL15g, MPD3a, MPD3b, MPD3c, MPD3d
 * Source: uts/rest/unit/channel/patch_message.md
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';

const msgpack = require('@ably/msgpack-js');

function msg(fields: any) {
  return Ably.Http.Message.fromValues(fields);
}

function setupMock(status = 200, body: any = { versionSerial: 'vs1' }) {
  const captured: any[] = [];
  const mock = new MockHttpClient({
    onConnectionAttempt: (conn) => conn.respond_with_success(),
    onRequest: (req) => {
      captured.push(req);
      req.respond_with(status, body);
    },
  });
  installMockHttp(mock);
  return captured;
}

describe('uts/rest/unit/channel/patch_message', function () {
  afterEach(function () {
    restoreAll();
  });

  /**
   * RSL15b, RSL15b1, RSL15e - patchMessage sends PATCH with action MESSAGE_PATCH
   */
  // UTS: rest/unit/RSL15b1/patch-sends-patch-action-0
  it('RSL15b1 - patchMessage sends PATCH with action MESSAGE_PATCH', async function () {
    const captured = setupMock();
    const client = new Ably.Http({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const channelName = 'test-RSL15-patch';
    const ch = client.channels.get(channelName);

    const result = await ch.patchMessage(
      msg({
        serial: 'msg-serial-1',
        patches: {
          data: [{ op: 'append', path: '/content/0/text', data: ' more text' }],
          extras: {
            headers: [
              { op: 'set', key: 'status', value: 'complete' },
              { op: 'remove', key: 'draft' },
            ],
          },
        },
      }),
    );

    expect(captured).to.have.length(1);
    expect(captured[0].method).to.equal('patch');
    expect(captured[0].path).to.equal(
      '/channels/' + encodeURIComponent(channelName) + '/messages/' + encodeURIComponent('msg-serial-1'),
    );

    const body = JSON.parse(captured[0].body);
    expect(body.action).to.equal(6);
    expect(body.serial).to.equal('msg-serial-1');
    expect(body.patches.data).to.deep.equal([{ op: 'append', path: '/content/0/text', data: ' more text' }]);
    expect(body.patches.extras.headers).to.deep.equal([
      { op: 'set', key: 'status', value: 'complete' },
      { op: 'remove', key: 'draft' },
    ]);

    expect(result.versionSerial).to.equal('vs1');
  });

  /**
   * RSL15g, MPD3 - patch operation values encoded with the JSON protocol
   */
  // UTS: rest/unit/RSL15g/patch-values-encoded-json-0
  it('RSL15g - patch operation values encoded with the JSON protocol', async function () {
    const captured = setupMock();
    const client = new Ably.Http({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-RSL15g-json');

    await ch.patchMessage(
      msg({
        serial: 's1',
        patches: {
          data: [
            { op: 'append', path: '/text', data: 'lo' },
            { op: 'set', path: '/bin', data: Buffer.from([0x01, 0x02]) },
            { op: 'set', path: '/obj', data: { b: 1 } },
            { op: 'set', path: '/list/-', data: [1, 2] },
            { op: 'set', path: '/count', data: 42 },
            { op: 'set', path: '/done', data: true },
            { op: 'set', path: '/cleared', data: null },
            { op: 'remove', path: '/old' },
          ],
        },
      }),
    );

    const ops = JSON.parse(captured[0].body).patches.data;
    expect(ops).to.have.length(8);

    // MPD3a - string unchanged
    expect(ops[0]).to.deep.equal({ op: 'append', path: '/text', data: 'lo' });

    // MPD3b - binary as Base64
    expect(ops[1].data).to.equal('AQI=');
    expect(ops[1].encoding).to.equal('base64');

    // MPD3c - every other JSON value as JSON text
    expect(ops[2].data).to.be.a('string');
    expect(JSON.parse(ops[2].data)).to.deep.equal({ b: 1 });
    expect(ops[2].encoding).to.equal('json');
    expect(JSON.parse(ops[3].data)).to.deep.equal([1, 2]);
    expect(ops[3].encoding).to.equal('json');
    expect(ops[4].data).to.equal('42');
    expect(ops[4].encoding).to.equal('json');
    expect(ops[5].data).to.equal('true');
    expect(ops[5].encoding).to.equal('json');
    expect(ops[6].data).to.equal('null');
    expect(ops[6].encoding).to.equal('json');

    // MPD3d - no data, no encoding
    expect(ops[7]).to.deep.equal({ op: 'remove', path: '/old' });
  });

  /**
   * RSL15g, MPD3 - patch operation values encoded with the MessagePack protocol
   *
   * The request body is decoded, and the response encoded, with @ably/msgpack-js.
   */
  // UTS: rest/unit/RSL15g/patch-values-encoded-msgpack-1
  it('RSL15g - patch operation values encoded with the MessagePack protocol', async function () {
    const captured = setupMock(200, msgpack.encode({ versionSerial: 'vs1' }));
    const client = new Ably.Http({ key: 'appId.keyId:keySecret', useBinaryProtocol: true });
    const ch = client.channels.get('test-RSL15g-msgpack');

    const result = await ch.patchMessage(
      msg({
        serial: 's1',
        patches: {
          data: [
            { op: 'append', path: '/text', data: 'lo' },
            { op: 'set', path: '/bin', data: Buffer.from([0x01, 0x02]) },
            { op: 'set', path: '/count', data: 42 },
          ],
        },
      }),
    );

    const body = msgpack.decode(captured[0].body);
    expect(body.action).to.equal(6);
    const ops = body.patches.data;

    expect(ops[0].data).to.equal('lo');
    expect(ops[0].encoding).to.equal(undefined);

    // Binary transmitted directly, no Base64
    expect(Buffer.isBuffer(ops[1].data)).to.equal(true);
    expect([...ops[1].data]).to.deep.equal([0x01, 0x02]);
    expect(ops[1].encoding).to.equal(undefined);

    // JSON value as a MessagePack string
    expect(ops[2].data).to.equal('42');
    expect(ops[2].encoding).to.equal('json');

    expect(result.versionSerial).to.equal('vs1');
  });

  /**
   * RSL15c, MPD3 - patchMessage does not mutate the user-supplied Message or its patches
   */
  // UTS: rest/unit/RSL15c/patch-no-mutate-message-0
  it('RSL15c - patchMessage does not mutate the user-supplied Message or its patches', async function () {
    setupMock();
    const client = new Ably.Http({ key: 'appId.keyId:keySecret', useBinaryProtocol: false });
    const ch = client.channels.get('test-RSL15c-patch');

    const message = msg({
      serial: 's1',
      patches: {
        data: [
          { op: 'set', path: '/obj', data: { b: 1 } },
          { op: 'set', path: '/bin', data: Buffer.from([0x01, 0x02]) },
        ],
      },
    });

    await ch.patchMessage(message);

    expect(message.action).to.be.undefined;
    const ops = message.patches!.data!;
    expect(ops).to.have.length(2);
    expect(ops[0].data).to.deep.equal({ b: 1 });
    expect(ops[0].encoding).to.be.undefined;
    expect(Buffer.isBuffer(ops[1].data)).to.equal(true);
    expect([...(ops[1].data as Buffer)]).to.deep.equal([0x01, 0x02]);
    expect(ops[1].encoding).to.be.undefined;
  });

  /**
   * RSL15a - patchMessage requires a serial
   */
  // UTS: rest/unit/RSL15a/patch-serial-required-0
  it('RSL15a - patchMessage requires a serial', async function () {
    const captured = setupMock();
    const client = new Ably.Http({ key: 'appId.keyId:keySecret' });
    const ch = client.channels.get('test-RSL15a-patch');

    try {
      await ch.patchMessage(msg({ patches: { data: [{ op: 'append', path: '/text', data: 'x' }] } }));
      expect.fail('Expected patchMessage to throw');
    } catch (error: any) {
      expect(error.code).to.equal(40003);
    }

    expect(captured).to.have.length(0);
  });
});
