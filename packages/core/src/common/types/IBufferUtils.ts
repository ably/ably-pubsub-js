export default interface IBufferUtils<Bufferlike, Output, ToBufferOutput> {
  base64CharSet: string;
  hexCharSet: string;
  isBuffer: (buffer: unknown) => buffer is Bufferlike;
  /**
   * On browser this returns a Uint8Array, on node a Buffer
   */
  toBuffer: (buffer: Bufferlike) => ToBufferOutput;
  toArrayBuffer: (buffer: Bufferlike) => ArrayBuffer;
  base64Encode: (buffer: Bufferlike) => string;
  base64UrlEncode: (buffer: Bufferlike) => string;
  base64Decode: (string: string) => Output;
  hexEncode: (buffer: Bufferlike) => string;
  hexDecode: (string: string) => Output;
  utf8Encode: (string: string) => Output;
  utf8Decode: (buffer: Bufferlike) => string;
  areBuffersEqual: (buffer1: Bufferlike, buffer2: Bufferlike) => boolean;
  byteLength: (buffer: Bufferlike) => number;
  /**
   * Returns ArrayBuffer on browser and Buffer on Node.js
   */
  arrayBufferViewToBuffer: (arrayBufferView: ArrayBufferView) => Bufferlike;
  concat(buffers: Bufferlike[]): Output;
  sha256(message: Bufferlike): Output;
  hmacSha256(message: Bufferlike, key: Bufferlike): Output;
}
