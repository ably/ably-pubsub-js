/**
 * UTS: MessagePack Interoperability Tests
 *
 * Spec points: RSL6a3
 * Source: uts/rest/unit/encoding/msgpack_interop.md
 *
 * Verifies that the client library can decode and round-trip binary-encoded
 * protocol messages using the ably-common interop fixtures.
 */

import { expect } from 'chai';
import * as fs from 'fs';
import * as path from 'path';

// Side-effect import wires up Platform with Node-specific config
import '../../../../../src/platform/nodejs';
import { WireMessage } from '../../../../../src/common/lib/types/message';
import Logger from '../../../../../src/common/lib/util/logger';

const msgpack = require('@ably/msgpack-js');

interface Fixture {
  name: string;
  data: any;
  encoding: string;
  numRepeat: number;
  type: 'string' | 'binary' | 'jsonArray' | 'jsonObject';
  msgpack: string;
}

const fixturesPath = path.resolve(
  __dirname,
  '../../../../common/ably-common/test-resources/msgpack_test_fixtures.json',
);
const fixtures: Fixture[] = JSON.parse(fs.readFileSync(fixturesPath, 'utf-8'));

function buildExpected(fixture: Fixture): any {
  if (fixture.type === 'string') {
    return fixture.numRepeat > 0 ? fixture.data.repeat(fixture.numRepeat) : fixture.data;
  } else if (fixture.type === 'binary') {
    const repeated = fixture.data.repeat(fixture.numRepeat);
    return Buffer.from(repeated, 'utf-8');
  } else {
    return fixture.data;
  }
}

describe('uts/rest/unit/encoding/msgpack_interop', function () {
  it('fixtures file is loaded with expected entries', function () {
    expect(fixtures).to.have.length(8);
  });

  for (const fixture of fixtures) {
    // UTS: rest/unit/RSL6a3/msgpack-interop-decode
    it(`RSL6a3 - decodes "${fixture.name}" fixture correctly`, async function () {
      const msgpackBytes = Buffer.from(fixture.msgpack, 'base64');
      const protocolMessage = msgpack.decode(msgpackBytes);

      const messages = protocolMessage.messages;
      expect(messages).to.have.length(1);

      const wireMessage = WireMessage.fromValues(messages[0]);
      const decoded = await wireMessage.decode({}, Logger.defaultLogger);

      expect(decoded.encoding).to.not.be.ok;

      const expected = buildExpected(fixture);

      if (fixture.type === 'binary') {
        expect(Buffer.isBuffer(decoded.data)).to.be.true;
        expect(Buffer.compare(decoded.data as Buffer, expected)).to.equal(0);
      } else if (fixture.type === 'jsonArray') {
        expect(decoded.data).to.be.an('array');
        expect(decoded.data).to.deep.equal(expected);
      } else if (fixture.type === 'jsonObject') {
        expect(decoded.data).to.be.an('object');
        expect(decoded.data).to.deep.equal(expected);
      } else {
        expect(decoded.data).to.be.a('string');
        expect(decoded.data).to.equal(expected);
      }
    });
  }

  for (const fixture of fixtures) {
    // UTS: rest/unit/RSL6a3/msgpack-interop-roundtrip
    it(`RSL6a3 - round-trips "${fixture.name}" fixture through encode/decode`, async function () {
      const msgpackBytes = Buffer.from(fixture.msgpack, 'base64');
      const protocolMessage = msgpack.decode(msgpackBytes);

      const wireMessage = WireMessage.fromValues(protocolMessage.messages[0]);
      const decoded = await wireMessage.decode({}, Logger.defaultLogger);

      // Re-encode for msgpack wire format
      const reEncoded = await decoded.encode({} as any);
      const reProtocolMessage = { messages: [reEncoded], msgSerial: 0 };
      const reBytes = msgpack.encode(reProtocolMessage, true);

      // Deserialize and decode again
      const reParsed = msgpack.decode(reBytes);
      const reWireMessage = WireMessage.fromValues(reParsed.messages[0]);
      const reDecoded = await reWireMessage.decode({}, Logger.defaultLogger);

      expect(reDecoded.encoding).to.not.be.ok;

      if (fixture.type === 'binary') {
        expect(Buffer.isBuffer(reDecoded.data)).to.be.true;
        expect(Buffer.compare(reDecoded.data as Buffer, decoded.data as Buffer)).to.equal(0);
      } else {
        expect(reDecoded.data).to.deep.equal(decoded.data);
      }
    });
  }
});
