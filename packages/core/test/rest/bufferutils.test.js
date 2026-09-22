'use strict';

define(['ably', 'chai'], function (Ably, chai) {
  var expect = chai.expect;
  var BufferUtils = Ably.Realtime.Platform.BufferUtils;
  var testString = 'test';
  var testBase64 = 'dGVzdA==';
  var testHex = '74657374';

  describe('rest/bufferutils', function () {
    /** @nospec */
    it('Basic encoding and decoding', function () {
      /* base64 */
      expect(BufferUtils.base64Encode(BufferUtils.utf8Encode(testString))).to.equal(testBase64);
      expect(BufferUtils.utf8Decode(BufferUtils.base64Decode(testBase64))).to.equal(testString);

      /* hex */
      expect(BufferUtils.hexEncode(BufferUtils.utf8Encode(testString))).to.equal(testHex);
      expect(BufferUtils.utf8Decode(BufferUtils.hexDecode(testHex))).to.equal(testString);

      /* compare */
      expect(
        BufferUtils.areBuffersEqual(BufferUtils.utf8Encode(testString), BufferUtils.utf8Encode(testString)),
      ).to.equal(true);
      expect(
        BufferUtils.areBuffersEqual(BufferUtils.utf8Encode(testString), BufferUtils.utf8Encode('other')),
      ).to.not.equal(true);
    });

    /**
     * In node it's idiomatic for most methods dealing with binary data to
     * return Buffers. In the browser it's more idiomatic to return ArrayBuffers.
     *
     * @nospec
     */
    it('BufferUtils return correct types', function () {
      if (typeof Buffer !== 'undefined') {
        /* node */
        expect(BufferUtils.utf8Encode(testString).constructor).to.equal(Buffer);
        expect(BufferUtils.hexDecode(testHex).constructor).to.equal(Buffer);
        expect(BufferUtils.base64Decode(testBase64).constructor).to.equal(Buffer);
        expect(BufferUtils.toBuffer(BufferUtils.utf8Encode(testString)).constructor).to.equal(Buffer);
        expect(BufferUtils.toArrayBuffer(BufferUtils.utf8Encode(testString)).constructor).to.equal(ArrayBuffer);
      } else {
        /* modern browsers */
        expect(BufferUtils.utf8Encode(testString).constructor).to.equal(ArrayBuffer);
        expect(BufferUtils.hexDecode(testHex).constructor).to.equal(ArrayBuffer);
        expect(BufferUtils.base64Decode(testBase64).constructor).to.equal(ArrayBuffer);
        expect(BufferUtils.toBuffer(BufferUtils.utf8Encode(testString)).constructor).to.equal(Uint8Array);
        expect(BufferUtils.toArrayBuffer(BufferUtils.utf8Encode(testString)).constructor).to.equal(ArrayBuffer);
      }
    });
  });
});
