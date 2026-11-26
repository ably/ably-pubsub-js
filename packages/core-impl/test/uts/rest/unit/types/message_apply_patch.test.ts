/**
 * UTS: Message.applyPatch Tests
 *
 * Spec points: TM9, TM9a, TM9b, TM9c, TM9d, TM9d1-TM9d4, TM9e, TM9f, TM9f1-TM9f5, TM9g, TM9g1-TM9g4
 * Source: uts/rest/unit/types/message_apply_patch.md
 *
 * The message and the patch are built with Message.fromEncoded, as the SDK
 * decodes them on receipt. A message whose data is decoded JSON is built with
 * encoding json; a message whose data is JSON text has no encoding.
 */

import { expect } from 'chai';
import { Ably } from '../../../helpers';

const Message = Ably.Http.Message;

function decode(values: any = {}): Promise<any> {
  return Message.fromEncoded({ serial: 's1', timestamp: 1, ...values });
}

function decodePatch(patches: any, values: any = {}): Promise<any> {
  return decode({
    action: 6, // MESSAGE_PATCH
    version: { serial: 'v2', timestamp: 2 },
    patches,
    ...values,
  });
}

/** Every failure of applyPatch is an ErrorInfo with code 40000 and statusCode 400 */
function expectRejected(message: any, patch: any, label?: string) {
  let error: any;
  try {
    Message.applyPatch(message, patch);
  } catch (e) {
    error = e;
  }
  expect(error, label ? `expected ${label} to be rejected` : 'expected applyPatch to fail').to.be.instanceOf(
    Ably.ErrorInfo,
  );
  expect(error.code, label).to.equal(40000);
  expect(error.statusCode, label).to.equal(400);
}

describe('uts/rest/unit/types/message_apply_patch', function () {
  /**
   * TM9d, TM9f3, TM9g1 - applies operations to decoded JSON data
   */
  // UTS: rest/unit/TM9f3/apply-to-decoded-data-0
  it('TM9f3 - applies operations to decoded JSON data', async function () {
    const message = await decode({
      name: 'reply',
      data: '{"content":[{"type":"text","text":"Hel"}],"meta":{"kept":true}}',
      encoding: 'json',
      extras: { headers: { status: 'streaming', model: 'm1' } },
    });
    const patch = await decodePatch({
      data: [
        { op: 'append', path: '/content/0/text', data: 'lo' },
        { op: 'set', path: '/content/-', data: '{"type":"tool"}', encoding: 'json' },
        { op: 'set', path: '/done', data: 'true', encoding: 'json' },
      ],
      extras: {
        headers: [
          { op: 'set', key: 'status', value: 'complete' },
          { op: 'remove', key: 'model' },
        ],
      },
    });

    const patched = Message.applyPatch(message, patch);

    expect(patched.action).to.equal('message.update');
    expect(patched.serial).to.equal('s1');
    expect(patched.name).to.equal('reply');
    expect(patched.version!.serial).to.equal('v2');
    expect(patched.data).to.deep.equal({
      content: [{ type: 'text', text: 'Hello' }, { type: 'tool' }],
      meta: { kept: true },
      done: true,
    });
    expect(patched.encoding || null).to.equal(null);
    expect(patched.extras).to.deep.equal({ headers: { status: 'complete' } });
    expect(patched.patches).to.equal(undefined);
    // a Message of the same class as the copy, not a plain object
    expect(Object.getPrototypeOf(patched)).to.equal(Object.getPrototypeOf(message));
  });

  /**
   * TM9d - keeps the message's fields other than data, extras and version
   */
  // UTS: rest/unit/TM9d/keeps-message-fields-0
  it('TM9d - keeps the message fields other than data, extras and version', async function () {
    const message = await decode({ clientId: 'author', connectionId: 'c1', data: 'Hel' });
    const patch = await decodePatch(
      { data: [{ op: 'append', data: 'lo' }] },
      { clientId: 'patcher', connectionId: 'c2', timestamp: 2 },
    );

    const patched = Message.applyPatch(message, patch);

    expect(patched.clientId).to.equal('author');
    expect(patched.connectionId).to.equal('c1');
    expect(patched.timestamp).to.equal(1);
    expect(patched.version!.serial).to.equal('v2');
    expect(patched.data).to.equal('Hello');
  });

  /**
   * TM9c - does not mutate the message
   *
   * ably-js has no public Message.toJson; a deep copy of the message stands in
   * for its serialized form.
   */
  // UTS: rest/unit/TM9c/message-not-mutated-0
  it('TM9c - does not mutate the message', async function () {
    const message = await decode({
      action: 0, // MESSAGE_CREATE
      data: '{"a":{"text":"x"},"b":{"unchanged":true},"list":[1]}',
      encoding: 'json',
      extras: { headers: { h: 'v' } },
    });
    const before = structuredClone({ ...message });
    const patch = await decodePatch({
      data: [
        { op: 'append', path: '/a/text', data: 'y' },
        { op: 'set', path: '/list/-', data: '2', encoding: 'json' },
      ],
      extras: { headers: [{ op: 'set', key: 'h', value: 'w' }] },
    });

    const patched = Message.applyPatch(message, patch);

    expect({ ...message }).to.deep.equal(before);
    expect(message.action).to.equal('message.create');
    expect(message.data).to.deep.equal({ a: { text: 'x' }, b: { unchanged: true }, list: [1] });
    expect(message.extras).to.deep.equal({ headers: { h: 'v' } });

    expect(patched.data).to.deep.equal({ a: { text: 'xy' }, b: { unchanged: true }, list: [1, 2] });
    expect(patched.extras).to.deep.equal({ headers: { h: 'w' } });
  });

  /**
   * TM9f5 - splices operations into JSON text, keeping its formatting
   */
  // UTS: rest/unit/TM9f5/splice-into-json-text-0
  it('TM9f5 - splices operations into JSON text, keeping its formatting', async function () {
    const message = await decode({ data: '{ "content" : [ {"text":"Hel"} ], "n": 1.0 }' });
    const patch = await decodePatch({
      data: [
        { op: 'append', path: '/content/0/text', data: 'lo "world"' },
        { op: 'set', path: '/obj', data: '{ "spaced" : 1 }', encoding: 'json' },
        { op: 'set', path: '/content/-', data: 'end' },
      ],
    });

    const patched = Message.applyPatch(message, patch);

    expect(patched.data).to.be.a('string');
    expect(patched.data).to.equal(
      '{ "content" : [ {"text":"Hello \\"world\\""},"end" ], "n": 1.0,"obj":{ "spaced" : 1 } }',
    );
    expect(patched.encoding || null).to.equal(null);
  });

  /**
   * TM9f5 - binary JSON text is patched as its UTF-8 text is
   */
  // UTS: rest/unit/TM9f5/splice-into-binary-json-1
  it('TM9f5 - binary JSON text is patched as its UTF-8 text is', async function () {
    const text = '{ "content" : [ {"text":"Hel"} ] }';
    const message = await decode({ data: Buffer.from(text, 'utf8').toString('base64'), encoding: 'base64' });
    const patch = await decodePatch({ data: [{ op: 'append', path: '/content/0/text', data: 'lo' }] });

    const patched = Message.applyPatch(message, patch);

    expect(Buffer.isBuffer(patched.data)).to.equal(true);
    expect((patched.data as Buffer).toString('utf8')).to.equal('{ "content" : [ {"text":"Hello"} ] }');
  });

  /**
   * TM9f5f, TM9f5g, TM9f5h - removes members and elements from JSON text
   */
  // UTS: rest/unit/TM9f5f/remove-from-json-text-0
  it('TM9f5f - removes members and elements from JSON text', async function () {
    const patch = await decodePatch({
      data: [
        { op: 'remove', path: '/a/1' },
        { op: 'remove', path: '/b' },
        { op: 'remove', path: '/c' },
        { op: 'remove', path: '/d/only' },
      ],
    });
    const message = Message.fromValues({ serial: 's1', data: '{"a":[1,2,3],"b":2,"c":3,"d":{"only":true}}' });

    // /a/1, /b and /c are each followed by another, so deleted up to it (TM9f5f);
    // /d/only is the only member of "d", so its text is deleted (TM9f5h)
    expect(Message.applyPatch(message, patch).data).to.equal('{"a":[1,3],"d":{}}');

    // TM9f5g: the last of several is deleted from the end of the previous value
    const message2 = Message.fromValues({ serial: 's1', data: '{"a":1, "b":2}' });
    const patch2 = await decodePatch({ data: [{ op: 'remove', path: '/b' }] });
    expect(Message.applyPatch(message2, patch2).data).to.equal('{"a":1}');
  });

  /**
   * TM9f5i - escaped member names are matched after unescaping
   */
  // UTS: rest/unit/TM9f5i/escaped-member-name-0
  it('TM9f5i - escaped member names are matched after unescaping', async function () {
    const message = await decode({ data: '{"a\\u0062":"x","c/d":"y"}' });
    const patch = await decodePatch({
      data: [
        { op: 'append', path: '/ab', data: '1' },
        { op: 'append', path: '/c~1d', data: '2' },
      ],
    });

    expect(Message.applyPatch(message, patch).data).to.equal('{"a\\u0062":"x1","c/d":"y2"}');
  });

  /**
   * TM9f5c, TM9f5e - spliced text is escaped as a JSON string
   */
  // UTS: rest/unit/TM9f5e/json-string-escaping-0
  it('TM9f5e - spliced text is escaped as a JSON string', async function () {
    const message = await decode({ data: '{"t":""}' });
    const patch = await decodePatch({
      data: [
        { op: 'append', path: '/t', data: 'q"b\\n\nt\tc\u0001é<>&' },
        { op: 'set', path: '/new\nkey', data: 'v' },
      ],
    });

    const patched = Message.applyPatch(message, patch);

    expect(patched.data).to.be.a('string');
    expect(JSON.parse(patched.data)).to.deep.equal({ t: 'q"b\\n\nt\tc\u0001é<>&', 'new\nkey': 'v' });
    expect(patched.data.startsWith('{"t":"q')).to.equal(true);
    expect(patched.data.endsWith('"}')).to.equal(true);
  });

  /**
   * TM9f2 - applies operations to the whole of data
   */
  // UTS: rest/unit/TM9f2/apply-to-whole-data-0
  it('TM9f2 - applies operations to the whole of data', async function () {
    const append = await decodePatch({ data: [{ op: 'append', data: ' world' }] });

    // TM9f2c - string
    expect(Message.applyPatch(await decode({ data: 'hello' }), append).data).to.equal('hello world');

    // TM9f2b - absent data
    const appended = Message.applyPatch(await decode({}), append);
    expect(appended.data).to.equal(' world');
    expect(appended.encoding || null).to.equal(null);

    // TM9f2c - binary
    const appendBinary = await decodePatch({ data: [{ op: 'append', data: 'Aw==', encoding: 'base64' }] });
    const binary = await decode({ data: 'AQI=', encoding: 'base64' });
    expect([...(Message.applyPatch(binary, appendBinary).data as Buffer)]).to.deep.equal([0x01, 0x02, 0x03]);

    // TM9f2a - set to a JSON value
    const set = await decodePatch({ data: [{ op: 'set', data: '{"a":1}', encoding: 'json' }] });
    const patched = Message.applyPatch(await decode({ data: 'hello' }), set);
    expect(patched.data).to.deep.equal({ a: 1 });
    expect(patched.encoding || null).to.equal(null);

    // TM9f2a - set to a string
    const setString = await decodePatch({ data: [{ op: 'set', data: 'replaced' }] });
    expect(Message.applyPatch(await decode({ data: '{"a":1}', encoding: 'json' }), setString).data).to.equal(
      'replaced',
    );
  });

  /**
   * TM9f2a, TM9f2d - rejects whole-data operations that cannot be applied
   */
  // UTS: rest/unit/TM9f2d/append-whole-non-string-0
  it('TM9f2d - rejects whole-data operations that cannot be applied', async function () {
    const message = await decode({ data: '{"a":1}', encoding: 'json' });

    expectRejected(message, await decodePatch({ data: [{ op: 'append', data: 'x' }] }), 'append to JSON data');
    expectRejected(message, await decodePatch({ data: [{ op: 'remove' }] }), 'remove without a path');

    // TM9f2b, TM9f2c - the operation's encoding must be empty
    const appendJson = await decodePatch({ data: [{ op: 'append', data: '"x"', encoding: 'json' }] });
    expectRejected(await decode({}), appendJson, 'append JSON to absent data');
    expectRejected(await decode({ data: 'text' }), appendJson, 'append JSON to a string');

    // TM9f2a - a JSON scalar cannot replace the whole of data
    for (const value of ['null', '1', 'true', '"s"']) {
      const setScalar = await decodePatch({ data: [{ op: 'set', data: value, encoding: 'json' }] });
      expectRejected(await decode({ data: 'hello' }), setScalar, `set whole data to ${value}`);
    }
  });

  /**
   * TM9e - rejects the whole patch if any operation is rejected
   */
  // UTS: rest/unit/TM9e/atomic-rejection-0
  it('TM9e - rejects the whole patch if any operation is rejected', async function () {
    const message = await decode({ data: '{"a":"x"}', encoding: 'json', extras: { headers: { h: 'v' } } });
    const patch = await decodePatch({
      data: [
        { op: 'append', path: '/a', data: 'y' },
        { op: 'append', path: '/missing', data: 'y' },
      ],
      extras: { headers: [{ op: 'set', key: 'h', value: 'w' }] },
    });

    expectRejected(message, patch);

    expect(message.data).to.deep.equal({ a: 'x' });
    expect(message.extras).to.deep.equal({ headers: { h: 'v' } });
  });

  /**
   * TM9f1, TM9f3 - rejects operations that cannot be applied
   *
   * Each case runs against both decoded JSON data and JSON text, since the
   * SDK applies operations to each form separately (TM9f4, TM9f5).
   */
  // UTS: rest/unit/TM9f3/invalid-operations-rejected-0
  it('TM9f3 - rejects operations that cannot be applied', async function () {
    const cases: [any, any][] = [
      [{ a: 1 }, { op: 'append', path: '/a', data: 'x' }], // TM9f3f: not a string
      [{ a: [] }, { op: 'append', path: '/a/-', data: 'x' }], // TM9f3f: "-"
      [{ a: 'x' }, { op: 'append', path: '/a', data: '"y"', encoding: 'json' }], // TM9f3f: encoding not empty
      [{ a: [] }, { op: 'remove', path: '/a/-' }], // TM9f3g: "-"
      [{ a: [] }, { op: 'set', path: '/a/0', data: 'x' }], // TM9f3e: no element 0
      [{ a: [1] }, { op: 'set', path: '/a/01', data: 'x' }], // TM9f3e: leading zero is not an index
      [{ a: 1 }, { op: 'set', path: '/a/b', data: 'x' }], // TM9f3c: parent is a number
      [{ a: 1 }, { op: 'set', path: '/x/y', data: 'x' }], // TM9f3b: /x does not exist
      [{ a: 1 }, { op: 'set', path: 'a', data: 'x' }], // TM9f3a: no leading "/"
      [{ a: 1 }, { op: 'set', path: '/~2', data: 'x' }], // TM9f3a: invalid "~" escape
      [{ a: 1 }, { op: 'remove', path: '/b' }], // TM9f3g: /b does not exist
      [{ a: 1 }, { op: 'move', path: '/a' }], // TM9f1: unknown op
    ];

    for (const [data, op] of cases) {
      const patch = await decodePatch({ data: [op] });
      const text = JSON.stringify(data);
      expectRejected(await decode({ data: text, encoding: 'json' }), patch, `${JSON.stringify(op)} on decoded ${text}`);
      expectRejected(await decode({ data: text }), patch, `${JSON.stringify(op)} on JSON text ${text}`);
    }

    // TM9f3 - a path operation on data that is not a JSON object or array
    const notContainer = await decode({ data: 'plain text' });
    expectRejected(notContainer, await decodePatch({ data: [{ op: 'set', path: '/a', data: 'x' }] }));
  });

  /**
   * TM9g1 - rejects removing a header that does not exist
   */
  // UTS: rest/unit/TM9g1/remove-missing-header-0
  it('TM9g1 - rejects removing a header that does not exist', async function () {
    const message = await decode({ data: 'x' });
    const patch = await decodePatch({ extras: { headers: [{ op: 'remove', key: 'h' }] } });

    expectRejected(message, patch);
  });

  /**
   * TM9g1 - set header adds extras and headers when absent
   */
  // UTS: rest/unit/TM9g1/set-header-adds-extras-1
  it('TM9g1 - set header adds extras and headers when absent', async function () {
    const message = await decode({ data: 'x' });
    const patch = await decodePatch({ extras: { headers: [{ op: 'set', key: 'status', value: 'done' }] } });

    expect(Message.applyPatch(message, patch).extras).to.deep.equal({ headers: { status: 'done' } });
  });

  /**
   * TM9d, TM9g2, TM9g4 - sets or removes the user claim, ignoring the patch's own extras
   */
  // UTS: rest/unit/TM9g2/user-claim-operations-0
  it('TM9g2 - sets or removes the user claim, ignoring the patch extras', async function () {
    const message = await decode({ data: 'x', extras: { headers: { h: 'v' }, userClaim: 'moderator' } });

    const set = await decodePatch(
      { data: [{ op: 'append', data: 'y' }], extras: { userClaim: { op: 'set', value: 'guest' } } },
      { extras: { push: { notification: { title: 't' } }, userClaim: 'guest' } },
    );
    const patched = Message.applyPatch(message, set);
    expect(patched.extras).to.deep.equal({ headers: { h: 'v' }, userClaim: 'guest' });
    expect(patched.version!.serial).to.equal('v2');

    const remove = await decodePatch({
      data: [{ op: 'append', data: 'y' }],
      extras: { userClaim: { op: 'remove' } },
    });
    expect(Message.applyPatch(message, remove).extras).to.deep.equal({ headers: { h: 'v' } });

    // Removing a missing claim succeeds, and leaves no extras (TM9g4)
    const unclaimed = await decode({ data: 'x' });
    expect(Message.applyPatch(unclaimed, remove).extras).to.equal(undefined);
  });

  /**
   * TM9g3 - removes privileged extras
   */
  // UTS: rest/unit/TM9g3/privileged-remove-0
  it('TM9g3 - removes privileged extras', async function () {
    const message = await decode({ data: 'x', extras: { headers: { h: 'v' }, privileged: { skipRule: '*' } } });
    const patch = await decodePatch({
      extras: {
        headers: [{ op: 'set', key: 'h', value: 'w' }],
        privileged: { op: 'remove' },
      },
    });

    expect(Message.applyPatch(message, patch).extras).to.deep.equal({ headers: { h: 'w' } });
  });

  /**
   * TM9a, TM9b - rejects a patch for another message, or a message that is not a patch
   */
  // UTS: rest/unit/TM9a/reject-non-patch-or-serial-0
  it('TM9a - rejects a patch for another message, or a message that is not a patch', async function () {
    const message = await decode({ data: 'x' });

    // TM9b
    const other = await decodePatch({ data: [{ op: 'append', data: 'y' }] }, { serial: 's2' });
    expectRejected(message, other, 'patch for another serial');

    // TM9a
    expectRejected(message, message, 'message that is not a patch');
  });

  /**
   * TM9f4 - sets a member named like a language-reserved key as an ordinary member
   */
  // UTS: rest/unit/TM9f4/reserved-member-name-0
  it('TM9f4 - sets a member named __proto__ as an ordinary member', async function () {
    const message = await decode({ data: '{}', encoding: 'json' });
    const patch = await decodePatch({
      data: [{ op: 'set', path: '/__proto__', data: '{"polluted":true}', encoding: 'json' }],
    });

    const patched = Message.applyPatch(message, patch);

    expect(Object.keys(patched.data)).to.deep.equal(['__proto__']);
    expect(Object.getOwnPropertyDescriptor(patched.data, '__proto__')!.value).to.deep.equal({ polluted: true });
    expect(({} as any).polluted).to.equal(undefined);
  });
});
