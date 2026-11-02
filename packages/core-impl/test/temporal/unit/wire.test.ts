import { expect } from 'chai';
import {
  base64ToBytes,
  bytesToBase64,
  decodeBinaryData,
  decodePageData,
  encodeBinaryData,
  mapFullObjectBytes,
  mapOperationBytes,
  toWireValue,
} from '../../../src/platform/temporal/src/common/wire';

/** Copies `value` as the worker does for a result, with binary values as base64, and serialises it to JSON. */
function roundTrip(value: unknown): unknown {
  return JSON.parse(JSON.stringify(toWireValue(value, bytesToBase64)));
}

/** The binary values that `toWireValue` finds in `value`, by path. */
function binaryPaths(value: unknown): Record<string, number[]> {
  const found: Record<string, number[]> = {};
  toWireValue(value, (bytes, path) => {
    found[path] = Array.from(bytes);
    return null;
  });
  return found;
}

function bytes(length: number, start = 0): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (start + i * 37) & 0xff);
}

function expectBytes(actual: unknown, expected: ArrayLike<number>): void {
  expect(actual).to.be.an.instanceof(Uint8Array);
  expect(Buffer.isBuffer(actual)).to.equal(false);
  expect(Array.from(actual as Uint8Array)).to.deep.equal(Array.from(expected));
}

describe('temporal/common/wire', function () {
  describe('bytesToBase64 and base64ToBytes', function () {
    for (let length = 0; length <= 10; length++) {
      it(`match Buffer for ${length} bytes`, function () {
        const input = bytes(length, length);
        const expected = Buffer.from(input).toString('base64');
        expect(bytesToBase64(input)).to.equal(expected);
        expectBytes(base64ToBytes(expected), input);
      });
    }

    it('match Buffer for every byte value', function () {
      const input = Uint8Array.from({ length: 256 }, (_, i) => i);
      const expected = Buffer.from(input).toString('base64');
      expect(bytesToBase64(input)).to.equal(expected);
      expectBytes(base64ToBytes(expected), input);
    });

    it('match Buffer for a large input', function () {
      const input = bytes(100_003, 11);
      const expected = Buffer.from(input).toString('base64');
      expect(bytesToBase64(input)).to.equal(expected);
      expectBytes(base64ToBytes(expected), input);
    });
  });

  describe('toWireValue', function () {
    it('replaces each binary value with the result of the handler, which is given its path', function () {
      const buffer = bytes(16).buffer;
      const input = {
        data: Buffer.from([0xde, 0xad]),
        list: [Uint8Array.from([1]), 'text', { inner: new Uint8Array(0) }],
        view: new Uint8Array(buffer, 2, 3),
        wide: new Uint16Array(buffer, 4, 1),
        dataView: new DataView(buffer, 5, 2),
        arrayBuffer: Uint8Array.from([7, 8]).buffer,
      };
      expect(binaryPaths(input)).to.deep.equal({
        data: [0xde, 0xad],
        'list[0]': [1],
        'list[2].inner': [],
        view: Array.from(new Uint8Array(buffer).slice(2, 5)),
        wide: Array.from(new Uint8Array(buffer).slice(4, 6)),
        dataView: Array.from(new Uint8Array(buffer).slice(5, 7)),
        arrayBuffer: [7, 8],
      });
      expect(binaryPaths(Uint8Array.from([1]))).to.deep.equal({ '': [1] });
      expect(roundTrip({ data: Uint8Array.from([1, 2, 3]), text: 'kept' })).to.deep.equal({
        data: 'AQID',
        text: 'kept',
      });
    });

    it('leaves values without binary data unchanged', function () {
      const input = { a: 1, b: 'two', c: [true, false, null], d: { e: { f: 1.5 } }, g: '' };
      expect(roundTrip(input)).to.deep.equal(input);
      expect(roundTrip('text')).to.equal('text');
      expect(roundTrip(42)).to.equal(42);
      expect(roundTrip(null)).to.equal(null);
    });

    it('leaves a Date for the payload converter to serialise as an ISO string', function () {
      const date = new Date('2026-01-02T03:04:05.678Z');
      expect(toWireValue(date, bytesToBase64)).to.equal(date);
      expect(roundTrip({ at: date })).to.deep.equal({ at: '2026-01-02T03:04:05.678Z' });
    });

    it("keeps an Error's message, cause and enumerable properties", function () {
      const error = Object.assign(new Error('Something failed'), { code: 40000, statusCode: 400 });
      expect(roundTrip(error)).to.deep.equal({ message: 'Something failed', code: 40000, statusCode: 400 });
      const outer = Object.defineProperty(new Error('Outer'), 'cause', {
        value: new Error('Inner'),
        enumerable: false,
      });
      expect(roundTrip(outer)).to.deep.equal({ message: 'Outer', cause: { message: 'Inner' } });
    });

    it('drops undefined and function properties', function () {
      const input = { kept: 1, missing: undefined, method: () => 1, nested: { missing: undefined, kept: 'x' } };
      const copied = toWireValue(input, bytesToBase64) as Record<string, unknown>;
      expect(Object.keys(copied)).to.deep.equal(['kept', 'nested']);
      expect(Object.keys(copied.nested as object)).to.deep.equal(['kept']);
    });

    it('copies class instances to plain objects of their own enumerable properties', function () {
      class Message {
        name = 'event';
        data = Uint8Array.from([9]);
        toString() {
          return 'Message';
        }
      }
      const copied = toWireValue(new Message(), bytesToBase64);
      expect(Object.getPrototypeOf(copied)).to.equal(Object.prototype);
      expect(copied).to.deep.equal({ name: 'event', data: 'CQ==' });
    });

    it('does not modify the value passed in', function () {
      const data = Uint8Array.from([1, 2]);
      const input = { data, list: [data] };
      toWireValue(input, bytesToBase64);
      expect(input.data).to.equal(data);
      expect(input.list[0]).to.equal(data);
    });

    it('replaces an object that has a toJSON method with its result, as JSON.stringify does', function () {
      class Money {
        constructor(readonly cents: number) {}
        toJSON() {
          return { amount: `$${this.cents / 100}`, toJSON: () => 'not called again' };
        }
      }
      const url = new URL('https://example.com/a?b=1');
      expect(roundTrip({ price: new Money(150), url })).to.deep.equal({
        price: { amount: '$1.5' },
        url: 'https://example.com/a?b=1',
      });
    });

    it('keeps an own __proto__ key', function () {
      const input = JSON.parse('{"__proto__": {"polluted": true}, "y": 2}');
      const copied = toWireValue(input, bytesToBase64) as Record<string, unknown>;
      expect(Object.keys(copied)).to.deep.equal(['__proto__', 'y']);
      expect(Object.getPrototypeOf(copied)).to.equal(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).to.equal(undefined);
    });
  });

  describe('encodeBinaryData and decodeBinaryData', function () {
    it('encode binary data as base64 and append base64 to the encoding, as RSL4d1 does', function () {
      expect(encodeBinaryData({ name: 'e', data: Uint8Array.from([1, 2, 3]) })).to.deep.equal({
        name: 'e',
        data: 'AQID',
        encoding: 'base64',
      });
      expect(encodeBinaryData({ data: Buffer.from([1, 2, 3]), encoding: null })).to.deep.equal({
        data: 'AQID',
        encoding: 'base64',
      });
      expect(encodeBinaryData({ data: Uint8Array.from([1, 2, 3]).buffer, encoding: 'utf-8' })).to.deep.equal({
        data: 'AQID',
        encoding: 'utf-8/base64',
      });
    });

    it('leave a message without binary data as it is', function () {
      for (const message of [
        { data: 'text' },
        { data: { a: 1 } },
        { name: 'e' },
        { data: 'AQID', encoding: 'base64' },
      ]) {
        expect(encodeBinaryData(message)).to.equal(message);
      }
      expect(encodeBinaryData(null)).to.equal(null);
    });

    it('decode only a last encoding of base64', function () {
      const decoded = decodeBinaryData({ id: 'm', data: 'AQID' as unknown, encoding: 'base64' as string | null });
      expectBytes(decoded.data, [1, 2, 3]);
      expect(decoded).to.include({ id: 'm', encoding: null });
      expect(decodeBinaryData({ data: 'AQID', encoding: 'utf-8/base64' }).encoding).to.equal('utf-8');
      for (const message of [
        { data: 'AQID' },
        { data: '{"a":1}', encoding: 'json' },
        { data: 'AQID', encoding: 'base64/json' },
        { data: { a: 1 }, encoding: 'base64' },
      ]) {
        expect(decodeBinaryData(message)).to.equal(message);
      }
    });

    it('round-trip binary data without modifying the messages passed in', function () {
      const input = { data: bytes(100), encoding: 'cipher+aes-128-cbc' };
      const encoded = encodeBinaryData(input);
      const decoded = decodeBinaryData(JSON.parse(JSON.stringify(encoded)));
      expect(input.encoding).to.equal('cipher+aes-128-cbc');
      expect(decoded.encoding).to.equal('cipher+aes-128-cbc');
      expectBytes(decoded.data, input.data);
    });

    it('decodePageData decodes each item of a page', function () {
      const page = {
        items: [{ data: 'AQID' as unknown, encoding: 'base64' }, { data: 'text' as unknown }],
        links: { next: { p: '2' } },
      };
      const decoded = decodePageData(page);
      expectBytes(decoded.items[0].data, [1, 2, 3]);
      expect(decoded.items[1]).to.deep.equal({ data: 'text' });
      expect(decoded.links).to.deep.equal({ next: { p: '2' } });
      expect(page.items[0].data).to.equal('AQID');
    });
  });

  describe('LiveObjects bytes', function () {
    const toBase64 = (value: unknown) => (value instanceof Uint8Array ? bytesToBase64(value) : value);
    const fromBase64 = (value: unknown) => (typeof value === 'string' ? base64ToBytes(value) : value);

    it('mapOperationBytes maps the bytes of a mapSet value and of each mapCreate entry', function () {
      const mapSet = { objectId: 'root', mapSet: { key: 'k', value: { bytes: Uint8Array.from([1, 2, 3]) } } };
      expect(mapOperationBytes(mapSet, toBase64)).to.deep.equal({
        objectId: 'root',
        mapSet: { key: 'k', value: { bytes: 'AQID' } },
      });

      const entries = JSON.parse('{"__proto__": {"data": {"string": "s"}}}');
      entries.blob = { data: { bytes: Uint8Array.from([4, 5]) } };
      const mapCreate = { path: 'm', mapCreate: { semantics: 'lww', entries } };
      const mapped = mapOperationBytes(mapCreate, toBase64);
      expect(Object.keys(mapped.mapCreate.entries)).to.deep.equal(['__proto__', 'blob']);
      expect(mapped.mapCreate.entries.blob).to.deep.equal({ data: { bytes: 'BAU=' } });
      expect(mapCreate.mapCreate.entries.blob.data.bytes).to.be.an.instanceof(Uint8Array);

      const counterInc = { objectId: 'counter:1', counterInc: { number: 1 } };
      expect(mapOperationBytes(counterInc, toBase64)).to.equal(counterInc);
    });

    it('mapFullObjectBytes maps the bytes of leaf values and nested map entries', function () {
      const full = {
        objectId: 'root',
        map: {
          semantics: 'lww',
          entries: {
            blob: { data: { bytes: 'AQID' } },
            text: { data: { string: 'AQID' } },
            nested: {
              data: { objectId: 'map:1', map: { semantics: 'lww', entries: { b: { data: { bytes: 'BAU=' } } } } },
            },
            counter: { data: { objectId: 'counter:1', counter: { data: { number: 1 } } } },
          },
        },
      };
      const mapped = mapFullObjectBytes(full, fromBase64) as any;
      expectBytes(mapped.map.entries.blob.data.bytes, [1, 2, 3]);
      expect(mapped.map.entries.text).to.deep.equal({ data: { string: 'AQID' } });
      expectBytes(mapped.map.entries.nested.data.map.entries.b.data.bytes, [4, 5]);
      expect(mapped.map.entries.counter).to.deep.equal(full.map.entries.counter);
      expect(full.map.entries.blob.data.bytes).to.equal('AQID');
      expectBytes((mapFullObjectBytes({ bytes: 'AQID' }, fromBase64) as { bytes: unknown }).bytes, [1, 2, 3]);
    });
  });
});
