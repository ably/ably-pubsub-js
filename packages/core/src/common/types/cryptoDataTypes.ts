/**
 Allows us to derive the generic type arguments for a platform’s `ICryptoStatic` implementation, given other properties of the platform.
 */
export namespace CryptoDataTypes {
  /**
   The type of initialization vector that the platform is expected to be able to use when creating a cipher.
   */
  export type IV<BufferUtilsOutput> = BufferUtilsOutput;

  /**
   The type of plaintext that the platform is expected to be able to encrypt.

   - `Bufferlike`: The `Bufferlike` of the platform’s `IBufferUtils` implementation.
   - `BufferUtilsOutput`: The `Output` of the platform’s `IBufferUtils` implementation.
   */
  export type InputPlaintext<Bufferlike, BufferUtilsOutput> = Bufferlike | BufferUtilsOutput;

  /**
   The type of ciphertext that the platform is expected to be able to decrypt.

   - `MessagePackBinaryType`: The type to which this platform’s MessagePack implementation deserializes elements of the `bin` or `ext` type.
   - `BufferUtilsOutput`: The `Output` of the platform’s `IBufferUtils` implementation.
   */
  export type InputCiphertext<MessagePackBinaryType, BufferUtilsOutput> = MessagePackBinaryType | BufferUtilsOutput;
}
