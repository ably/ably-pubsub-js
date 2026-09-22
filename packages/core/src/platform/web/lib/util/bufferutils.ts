import Platform from 'common/platform';
import IBufferUtils from 'common/types/IBufferUtils';
import { hmac as hmacSha256, sha256 } from './hmac-sha256';

/* Most BufferUtils methods that return a binary object return an ArrayBuffer
 * The exception is toBuffer, which returns a Uint8Array */

export type Bufferlike = BufferSource;
export type Output = ArrayBuffer;
export type ToBufferOutput = Uint8Array;

class BufferUtils implements IBufferUtils<Bufferlike, Output, ToBufferOutput> {
  base64CharSet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  hexCharSet = '0123456789abcdef';

  // https://gist.githubusercontent.com/jonleighton/958841/raw/f200e30dfe95212c0165ccf1ae000ca51e9de803/gistfile1.js
  private uint8ViewToBase64(bytes: Uint8Array): string {
    let base64 = '';
    const encodings = this.base64CharSet;

    const byteLength = bytes.byteLength;
    const byteRemainder = byteLength % 3;
    const mainLength = byteLength - byteRemainder;

    let a, b, c, d;
    let chunk;

    // Main loop deals with bytes in chunks of 3
    for (let i = 0; i < mainLength; i = i + 3) {
      // Combine the three bytes into a single integer
      chunk = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];

      // Use bitmasks to extract 6-bit segments from the triplet
      a = (chunk & 16515072) >> 18; // 16515072 = (2^6 - 1) << 18
      b = (chunk & 258048) >> 12; // 258048   = (2^6 - 1) << 12
      c = (chunk & 4032) >> 6; // 4032     = (2^6 - 1) << 6
      d = chunk & 63; // 63       = 2^6 - 1

      // Convert the raw binary segments to the appropriate ASCII encoding
      base64 += encodings[a] + encodings[b] + encodings[c] + encodings[d];
    }

    // Deal with the remaining bytes and padding
    if (byteRemainder == 1) {
      chunk = bytes[mainLength];

      a = (chunk & 252) >> 2; // 252 = (2^6 - 1) << 2

      // Set the 4 least significant bits to zero
      b = (chunk & 3) << 4; // 3   = 2^2 - 1

      base64 += encodings[a] + encodings[b] + '==';
    } else if (byteRemainder == 2) {
      chunk = (bytes[mainLength] << 8) | bytes[mainLength + 1];

      a = (chunk & 64512) >> 10; // 64512 = (2^6 - 1) << 10
      b = (chunk & 1008) >> 4; // 1008  = (2^6 - 1) << 4

      // Set the 2 least significant bits to zero
      c = (chunk & 15) << 2; // 15    = 2^4 - 1

      base64 += encodings[a] + encodings[b] + encodings[c] + '=';
    }

    return base64;
  }

  private base64ToArrayBuffer(base64: string): Output {
    const binary_string = atob?.(base64) as string; // this will always be defined in browser so it's safe to cast
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      const ascii = binary_string.charCodeAt(i);
      bytes[i] = ascii;
    }
    return this.toArrayBuffer(bytes);
  }

  isBuffer(buffer: unknown): buffer is Bufferlike {
    return buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer);
  }

  toBuffer(buffer: Bufferlike): ToBufferOutput {
    if (!ArrayBuffer) {
      throw new Error("Can't convert to Buffer: browser does not support the necessary types");
    }

    if (buffer instanceof ArrayBuffer) {
      return new Uint8Array(buffer);
    }

    if (ArrayBuffer.isView(buffer)) {
      return new Uint8Array(this.toArrayBuffer(buffer));
    }

    throw new Error('BufferUtils.toBuffer expected an ArrayBuffer or a view onto one');
  }

  toArrayBuffer(buffer: Bufferlike): ArrayBuffer {
    if (!ArrayBuffer) {
      throw new Error("Can't convert to ArrayBuffer: browser does not support the necessary types");
    }

    if (buffer instanceof ArrayBuffer) {
      return buffer;
    }

    if (ArrayBuffer.isView(buffer)) {
      return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    }

    throw new Error('BufferUtils.toArrayBuffer expected an ArrayBuffer or a view onto one');
  }

  base64Encode(buffer: Bufferlike): string {
    return this.uint8ViewToBase64(this.toBuffer(buffer));
  }

  base64UrlEncode(buffer: Bufferlike): string {
    // base64url encoding is based on regular base64 with following changes: https://base64.guru/standards/base64url
    return this.base64Encode(buffer).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  base64Decode(str: string): Output {
    if (ArrayBuffer && Platform.Config.atob) {
      return this.base64ToArrayBuffer(str);
    } else {
      throw new Error('Expected ArrayBuffer to exist and Platform.Config.atob to be configured');
    }
  }

  hexEncode(buffer: Bufferlike): string {
    const uint8Array = this.toBuffer(buffer);
    return uint8Array.reduce((accum, byte) => accum + byte.toString(16).padStart(2, '0'), '');
  }

  hexDecode(hexEncodedBytes: string): Output {
    if (hexEncodedBytes.length % 2 !== 0) {
      throw new Error("Can't create a byte array from a hex string of odd length");
    }

    const uint8Array = new Uint8Array(hexEncodedBytes.length / 2);

    for (let i = 0; i < uint8Array.length; i++) {
      uint8Array[i] = parseInt(hexEncodedBytes.slice(2 * i, 2 * (i + 1)), 16);
    }

    return this.toArrayBuffer(uint8Array);
  }

  utf8Encode(string: string): Output {
    if (Platform.Config.TextEncoder) {
      const encodedByteArray = new Platform.Config.TextEncoder().encode(string);
      return this.toArrayBuffer(encodedByteArray);
    } else {
      throw new Error('Expected TextEncoder to be configured');
    }
  }

  /* For utf8 decoding we apply slightly stricter input validation than to
   * hexEncode/base64Encode/etc: in those we accept anything that Buffer.from
   * can take (in particular allowing strings, which are just interpreted as
   * binary); here we ensure that the input is actually a buffer since trying
   * to utf8-decode a string to another string is almost certainly a mistake */
  utf8Decode(buffer: Bufferlike): string {
    if (!this.isBuffer(buffer)) {
      throw new Error('Expected input of utf8decode to be an arraybuffer or typed array');
    }
    if (TextDecoder) {
      return new TextDecoder().decode(buffer);
    } else {
      throw new Error('Expected TextDecoder to be configured');
    }
  }

  areBuffersEqual(buffer1: Bufferlike, buffer2: Bufferlike): boolean {
    if (!buffer1 || !buffer2) return false;
    const arrayBuffer1 = this.toArrayBuffer(buffer1);
    const arrayBuffer2 = this.toArrayBuffer(buffer2);

    if (arrayBuffer1.byteLength != arrayBuffer2.byteLength) return false;

    const bytes1 = new Uint8Array(arrayBuffer1);
    const bytes2 = new Uint8Array(arrayBuffer2);

    for (var i = 0; i < bytes1.length; i++) {
      if (bytes1[i] != bytes2[i]) return false;
    }
    return true;
  }

  byteLength(buffer: Bufferlike): number {
    if (buffer instanceof ArrayBuffer || ArrayBuffer.isView(buffer)) {
      return buffer.byteLength;
    }
    return -1;
  }

  arrayBufferViewToBuffer(arrayBufferView: ArrayBufferView): ArrayBuffer {
    return this.toArrayBuffer(arrayBufferView);
  }

  concat(buffers: Bufferlike[]): Output {
    const sumLength = buffers.reduce((acc, v) => acc + v.byteLength, 0);
    const result = new Uint8Array(sumLength);
    let offset = 0;

    for (const buffer of buffers) {
      const uint8Array = this.toBuffer(buffer);
      // see TypedArray.set for TypedArray argument https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/TypedArray/set#typedarray
      result.set(uint8Array, offset);
      offset += uint8Array.byteLength;
    }

    return result.buffer;
  }

  sha256(message: Bufferlike): Output {
    const hash = sha256(this.toBuffer(message));
    return this.toArrayBuffer(hash);
  }

  hmacSha256(message: Bufferlike, key: Bufferlike): Output {
    const hash = hmacSha256(this.toBuffer(key), this.toBuffer(message));
    return this.toArrayBuffer(hash);
  }
}

export default new BufferUtils();
