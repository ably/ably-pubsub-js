'use strict';

define(['chai', 'ably'], function (chai, Ably) {
  const { expect } = chai;
  const Message = Ably.Message;

  function decode(values) {
    return Message.fromEncoded({ serial: 's1', timestamp: 1, ...values });
  }

  function decodePatch(patches, extra = {}) {
    return decode({ action: 6, version: { serial: 'v2', timestamp: 2 }, patches, ...extra });
  }

  function expectError(fn, message) {
    try {
      fn();
    } catch (err) {
      expect(err.code).to.equal(40000);
      expect(err.message).to.contain(message);
      return;
    }
    expect.fail('expected an error');
  }

  describe('Message.applyPatch', function () {
    it('decodes message.patch and its operations, keeping JSON values as text', async function () {
      const patch = await decodePatch({
        data: [
          { op: 'set', path: '/a', data: '{"b":1}', encoding: 'json' },
          { op: 'set', path: '/c', data: 'AQI=', encoding: 'base64' },
          { op: 'append', path: '/d', data: 'text' },
        ],
        extras: { headers: [{ op: 'set', key: 'status', value: 'complete' }] },
      });

      expect(patch.action).to.equal('message.patch');
      const ops = patch.patches.data;
      expect(ops[0]).to.deep.equal({ op: 'set', path: '/a', data: '{"b":1}', encoding: 'json' });
      expect(Buffer.from(ops[1].data)).to.deep.equal(Buffer.from([1, 2]));
      expect(ops[1].encoding).to.equal(undefined);
      expect(ops[2]).to.deep.equal({ op: 'append', path: '/d', data: 'text' });
    });

    it('encodes message.patch and its operations for the wire', async function () {
      const msg = Message.fromValues({
        serial: 's1',
        action: 'message.patch',
        patches: {
          data: [
            { op: 'set', path: '/a', data: { b: 1 } },
            { op: 'set', path: '/c', data: Buffer.from([1, 2]) },
            { op: 'remove', path: '/d' },
          ],
        },
      });
      const wire = JSON.parse(JSON.stringify(await msg.encode({})));

      expect(wire.action).to.equal(6);
      expect(wire.patches.data).to.deep.equal([
        { op: 'set', path: '/a', data: '{"b":1}', encoding: 'json' },
        { op: 'set', path: '/c', data: 'AQI=', encoding: 'base64' },
        { op: 'remove', path: '/d' },
      ]);
    });

    it('applies operations to decoded JSON data', async function () {
      const message = await decode({
        name: 'reply',
        data: JSON.stringify({ content: [{ type: 'text', text: 'Hel' }], meta: { kept: true } }),
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
      expect(patched.version.serial).to.equal('v2');
      expect(patched.data).to.deep.equal({
        content: [{ type: 'text', text: 'Hello' }, { type: 'tool' }],
        meta: { kept: true },
        done: true,
      });
      expect(patched.extras).to.deep.equal({ headers: { status: 'complete' } });
      expect(patched.patches).to.equal(undefined);
      expect(patched).to.be.an.instanceOf(message.constructor);
    });

    it("keeps the copy's fields other than data, extras and version", async function () {
      const message = await decode({ clientId: 'author', connectionId: 'c1', data: 'Hel' });
      const patch = await decodePatch(
        { data: [{ op: 'append', data: 'lo' }] },
        { clientId: 'patcher', connectionId: 'c2', timestamp: 2 },
      );

      const patched = Message.applyPatch(message, patch);

      expect(patched.clientId).to.equal('author');
      expect(patched.connectionId).to.equal('c1');
      expect(patched.timestamp).to.equal(1);
      expect(patched.version.serial).to.equal('v2');
      expect(patched.data).to.equal('Hello');
    });

    it('does not change the copy it is given, and shares unchanged parts', async function () {
      const message = await decode({
        data: JSON.stringify({ a: { text: 'x' }, b: { unchanged: true } }),
        encoding: 'json',
        extras: { headers: { h: 'v' } },
      });
      const before = JSON.parse(JSON.stringify(message));
      const patch = await decodePatch({
        data: [{ op: 'append', path: '/a/text', data: 'y' }],
        extras: { headers: [{ op: 'set', key: 'h', value: 'w' }] },
      });

      const patched = Message.applyPatch(message, patch);

      expect(JSON.parse(JSON.stringify(message))).to.deep.equal(before);
      expect(patched.data.a).to.not.equal(message.data.a);
      expect(patched.data.b).to.equal(message.data.b);
    });

    it('splices operations into JSON text, keeping its formatting', async function () {
      const text = '{ "content" : [ {"text":"Hel"} ], "n": 1.0 }';
      const patch = await decodePatch({
        data: [
          { op: 'append', path: '/content/0/text', data: 'lo "world"' },
          { op: 'set', path: '/obj', data: '{ "spaced" : 1 }', encoding: 'json' },
          { op: 'set', path: '/content/-', data: 'end' },
        ],
      });

      const fromString = Message.applyPatch(await decode({ data: text }), patch);
      expect(fromString.data).to.equal(
        '{ "content" : [ {"text":"Hello \\"world\\""},"end" ], "n": 1.0,"obj":{ "spaced" : 1 } }',
      );

      const fromBinary = Message.applyPatch(
        await decode({ data: Buffer.from(text).toString('base64'), encoding: 'base64' }),
        patch,
      );
      expect(Buffer.from(fromBinary.data).toString()).to.equal(fromString.data);
    });

    it('patches JSON kept outside a message, removing members and elements', async function () {
      const patch = await decodePatch({
        data: [
          { op: 'remove', path: '/a/1' },
          { op: 'remove', path: '/b' },
          { op: 'remove', path: '/c' },
        ],
      });
      const json = '{"a":[1,2,3],"b":2,"c":3}';
      expect(Message.applyPatch({ serial: patch.serial, data: json }, patch).data).to.equal('{"a":[1,3]}');
    });

    it('applies operations to the whole of data', async function () {
      const append = await decodePatch({ data: [{ op: 'append', data: ' world' }] });
      expect(Message.applyPatch(await decode({ data: 'hello' }), append).data).to.equal('hello world');

      const appendBinary = await decodePatch({ data: [{ op: 'append', data: 'Aw==', encoding: 'base64' }] });
      const binary = await decode({ data: 'AQI=', encoding: 'base64' });
      expect(Buffer.from(Message.applyPatch(binary, appendBinary).data)).to.deep.equal(Buffer.from([1, 2, 3]));

      expect(Message.applyPatch(await decode({}), append).data).to.equal(
        ' world',
        'appending to no data gives the value',
      );

      const set = await decodePatch({ data: [{ op: 'set', data: '{"a":1}', encoding: 'json' }] });
      expect(Message.applyPatch(await decode({ data: 'hello' }), set).data).to.deep.equal({ a: 1 });
    });

    it('rejects the whole patch if any operation is rejected', async function () {
      const message = await decode({ data: '{"a":"x"}', encoding: 'json', extras: { headers: { h: 'v' } } });
      const patch = await decodePatch({
        data: [
          { op: 'append', path: '/a', data: 'y' },
          { op: 'append', path: '/missing', data: 'y' },
        ],
      });

      expectError(
        () => Message.applyPatch(message, patch),
        'unable to apply data patch operation 1 (append at "/missing"): path "/missing" does not exist',
      );
      expect(message.data).to.deep.equal({ a: 'x' });
    });

    it('rejects invalid operations', async function () {
      const cases = [
        [{ a: 1 }, { op: 'append', path: '/a', data: 'x' }, 'the value there is not a string'],
        [{ a: [] }, { op: 'append', path: '/a/-', data: 'x' }, '"-" can only be used to set'],
        [{ a: [] }, { op: 'set', path: '/a/0', data: 'x' }, 'does not exist'],
        [{ a: 1 }, { op: 'set', path: '/a/b', data: 'x' }, 'its parent is not an object or array'],
        [{ a: 1 }, { op: 'set', path: 'a', data: 'x' }, 'must be a JSON Pointer'],
        [{ a: 1 }, { op: 'remove', path: '/b' }, 'does not exist'],
        [{ a: 1 }, { op: 'remove' }, 'requires a path'],
        [{ a: 1 }, { op: 'move', path: '/a' }, 'unknown message patch operation "move"'],
      ];
      for (const [data, op, error] of cases) {
        for (const message of [
          await decode({ data: JSON.stringify(data), encoding: 'json' }),
          await decode({ data: JSON.stringify(data) }),
        ]) {
          const patch = await decodePatch({ data: [op] });
          expectError(() => Message.applyPatch(message, patch), error);
        }
      }
    });

    it('rejects appending to the whole of data that is not a string or binary', async function () {
      const message = await decode({ data: '{"a":1}', encoding: 'json' });
      const patch = await decodePatch({ data: [{ op: 'append', data: 'x' }] });
      expectError(() => Message.applyPatch(message, patch), 'both be strings or both be binary');
    });

    it("sets or removes the claim, takes the patch's version, and ignores the patch's own extras", async function () {
      const message = await decode({ data: 'x', extras: { headers: { h: 'v' }, userClaim: 'moderator' } });

      const set = await decodePatch(
        { data: [{ op: 'append', data: 'y' }], extras: { userClaim: { op: 'set', value: 'guest' } } },
        { extras: { push: { notification: { title: 't' } }, userClaim: 'guest' } },
      );
      const patched = Message.applyPatch(message, set);
      expect(patched.extras).to.deep.equal({ headers: { h: 'v' }, userClaim: 'guest' });
      expect(patched.version.serial).to.equal('v2');

      const remove = await decodePatch({
        data: [{ op: 'append', data: 'y' }],
        extras: { userClaim: { op: 'remove' } },
      });
      expect(Message.applyPatch(message, remove).extras).to.deep.equal({ headers: { h: 'v' } });

      // removing a missing claim succeeds
      const unclaimed = await decode({ data: 'x' });
      expect(Message.applyPatch(unclaimed, remove).extras).to.equal(undefined);
    });

    it('removes privileged extras', async function () {
      const message = await decode({ data: 'x', extras: { headers: { h: 'v' }, privileged: { skipRule: '*' } } });
      const patch = await decodePatch({
        extras: { headers: [{ op: 'set', key: 'h', value: 'w' }], privileged: { op: 'remove' } },
      });
      expect(Message.applyPatch(message, patch).extras).to.deep.equal({ headers: { h: 'w' } });
    });

    it('rejects removing a header that does not exist', async function () {
      const message = await decode({ data: 'x' });
      const patch = await decodePatch({ extras: { headers: [{ op: 'remove', key: 'h' }] } });
      expectError(() => Message.applyPatch(message, patch), 'the header does not exist');
    });

    it('rejects a patch for another message, or a message that is not a patch', async function () {
      const message = await decode({ data: 'x' });
      const other = await decodePatch({ data: [{ op: 'append', data: 'y' }] }, { serial: 's2' });
      expectError(() => Message.applyPatch(message, other), 'the patch is for message s2');
      expectError(() => Message.applyPatch(message, message), 'only a message.patch can be applied');
    });

    it('sets __proto__ as an ordinary field', async function () {
      const message = await decode({ data: '{}', encoding: 'json' });
      const patch = await decodePatch({
        data: [{ op: 'set', path: '/__proto__', data: '{"polluted":true}', encoding: 'json' }],
      });

      const patched = Message.applyPatch(message, patch);

      expect(Object.getPrototypeOf(patched.data)).to.equal(Object.prototype);
      expect(Object.keys(patched.data)).to.deep.equal(['__proto__']);
      expect({}.polluted).to.equal(undefined);
    });
  });
});
