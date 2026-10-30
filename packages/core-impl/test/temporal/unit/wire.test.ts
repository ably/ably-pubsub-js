import { expect } from 'chai';
import {
  base64ToBytes,
  bytesToBase64,
  decodeFromWire,
  encodeForWire,
} from '../../../src/platform/temporal/src/common/wire';

// Mirrors what crosses the activity boundary: Temporal's default payload converter serialises to JSON.
function roundTrip(value: unknown): unknown {
  return decodeFromWire(JSON.parse(JSON.stringify(encodeForWire(value))));
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

  describe('encodeForWire and decodeFromWire', function () {
    it('encode a Uint8Array as a tagged base64 string', function () {
      expect(encodeForWire(Uint8Array.from([1, 2, 3]))).to.deep.equal({ __ablyTemporalBinary: 'AQID' });
    });

    for (let length = 0; length <= 10; length++) {
      it(`round-trip a ${length}-byte Uint8Array`, function () {
        const input = bytes(length);
        expect(encodeForWire(input)).to.deep.equal({ __ablyTemporalBinary: Buffer.from(input).toString('base64') });
        expectBytes(roundTrip(input), input);
      });
    }

    it('round-trip a Buffer as a Uint8Array', function () {
      const input = Buffer.from('hello, world');
      expect(encodeForWire(input)).to.deep.equal({ __ablyTemporalBinary: input.toString('base64') });
      expectBytes(roundTrip(input), input);
    });

    it('round-trip a Buffer that is a slice of a larger pooled buffer', function () {
      const pooled = Buffer.from('abcdefghij');
      const slice = pooled.subarray(3, 6);
      expectBytes(roundTrip(slice), Buffer.from('def'));
    });

    it('round-trip an ArrayBuffer as a Uint8Array', function () {
      const input = bytes(7);
      expectBytes(roundTrip(input.buffer.slice(0)), input);
    });

    it('encode only the bytes in the range of a Uint8Array view with an offset', function () {
      const buffer = bytes(10).buffer;
      const view = new Uint8Array(buffer, 2, 5);
      expect(encodeForWire(view)).to.deep.equal({ __ablyTemporalBinary: Buffer.from(view).toString('base64') });
      expectBytes(roundTrip(view), new Uint8Array(buffer).slice(2, 7));
    });

    it('encode the bytes of a wider typed array view with an offset', function () {
      const buffer = bytes(16).buffer;
      const view = new Uint16Array(buffer, 4, 3);
      expectBytes(roundTrip(view), new Uint8Array(buffer).slice(4, 10));
    });

    it('encode the bytes of a DataView with an offset', function () {
      const buffer = bytes(16).buffer;
      const view = new DataView(buffer, 5, 4);
      expectBytes(roundTrip(view), new Uint8Array(buffer).slice(5, 9));
    });

    it('round-trip binary values nested in objects and arrays', function () {
      const input = {
        name: 'event',
        data: Buffer.from([0xde, 0xad, 0xbe, 0xef]),
        extras: { headers: { key: 'value' } },
        list: [Uint8Array.from([1]), 'text', 2, null, { inner: new Uint8Array(0) }],
      };
      const result = roundTrip(input) as typeof input;
      expect(result.name).to.equal('event');
      expectBytes(result.data, [0xde, 0xad, 0xbe, 0xef]);
      expect(result.extras).to.deep.equal({ headers: { key: 'value' } });
      expectBytes(result.list[0], [1]);
      expect(result.list.slice(1, 4)).to.deep.equal(['text', 2, null]);
      expectBytes((result.list[4] as { inner: unknown }).inner, []);
    });

    it('leave values without binary data unchanged', function () {
      const input = { a: 1, b: 'two', c: [true, false, null], d: { e: { f: 1.5 } }, g: '' };
      expect(roundTrip(input)).to.deep.equal(input);
      expect(roundTrip('text')).to.equal('text');
      expect(roundTrip(42)).to.equal(42);
      expect(roundTrip(null)).to.equal(null);
    });

    it('leave a Date for the payload converter to serialise as an ISO string', function () {
      const date = new Date('2026-01-02T03:04:05.678Z');
      expect(encodeForWire(date)).to.equal(date);
      expect(roundTrip({ at: date })).to.deep.equal({ at: '2026-01-02T03:04:05.678Z' });
    });

    it("keep an Error's message and enumerable properties", function () {
      const error = Object.assign(new Error('Something failed'), { code: 40000, statusCode: 400 });
      expect(roundTrip(error)).to.deep.equal({ message: 'Something failed', code: 40000, statusCode: 400 });
    });

    it("keep an Error's cause", function () {
      const error = Object.defineProperty(new Error('Outer'), 'cause', {
        value: new Error('Inner'),
        enumerable: false,
      });
      expect(roundTrip(error)).to.deep.equal({ message: 'Outer', cause: { message: 'Inner' } });
    });

    it('return binary values and Dates passed to decodeFromWire as they are', function () {
      const bytes = Uint8Array.from([1, 2]);
      const date = new Date('2026-01-02T03:04:05.678Z');
      const decoded = decodeFromWire({ bytes, date }) as { bytes: unknown; date: unknown };
      expect(decoded.bytes).to.equal(bytes);
      expect(decoded.date).to.equal(date);
    });

    it('drop undefined and function properties', function () {
      const input = { kept: 1, missing: undefined, method: () => 1, nested: { missing: undefined, kept: 'x' } };
      const encoded = encodeForWire(input) as Record<string, unknown>;
      expect(Object.keys(encoded)).to.deep.equal(['kept', 'nested']);
      expect(Object.keys(encoded.nested as object)).to.deep.equal(['kept']);
      expect(roundTrip(input)).to.deep.equal({ kept: 1, nested: { kept: 'x' } });
    });

    it('copy class instances to plain objects of their own enumerable properties', function () {
      class Message {
        name = 'event';
        data = Uint8Array.from([9]);
        toString() {
          return 'Message';
        }
      }
      const encoded = encodeForWire(new Message());
      expect(Object.getPrototypeOf(encoded)).to.equal(Object.prototype);
      expect(encoded).to.deep.equal({ name: 'event', data: { __ablyTemporalBinary: 'CQ==' } });
    });

    it('not modify the value passed in', function () {
      const data = Uint8Array.from([1, 2]);
      const input = { data, list: [data] };
      encodeForWire(input);
      expect(input.data).to.equal(data);
      expect(input.list[0]).to.equal(data);
    });

    it('replace an object that has a toJSON method with its result, as JSON.stringify does', function () {
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

    it('round-trip objects whose only key is one of the codec tags', function () {
      for (const value of [
        { __ablyTemporalBinary: 'AQID' },
        { __ablyTemporalBinary: 1 },
        { __ablyTemporalEscaped: { x: 1 } },
        { __ablyTemporalEscaped: 'text' },
        { nested: { __ablyTemporalBinary: 'hello' } },
      ]) {
        expect(roundTrip(value)).to.deep.equal(value);
      }
    });

    it('keep an own __proto__ key', function () {
      const input = JSON.parse('{"__proto__": {"polluted": true}, "y": 2}');
      const decoded = roundTrip(input) as Record<string, unknown>;
      expect(Object.keys(decoded)).to.deep.equal(['__proto__', 'y']);
      expect(Object.getPrototypeOf(decoded)).to.equal(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).to.equal(undefined);
    });

    it('not decode an object that has other keys beside the binary tag', function () {
      const input = { __ablyTemporalBinary: 'AQID', other: 1 };
      expect(decodeFromWire(input)).to.deep.equal(input);
    });

    it('not decode a binary tag whose value is not a string', function () {
      const input = { __ablyTemporalBinary: 1 };
      expect(decodeFromWire(input)).to.deep.equal(input);
    });
  });
});
