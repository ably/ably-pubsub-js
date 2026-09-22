export default interface ICipher<InputPlaintext, OutputCiphertext, InputCiphertext, OutputPlaintext> {
  algorithm: string;
  encrypt: (plaintext: InputPlaintext) => Promise<OutputCiphertext>;
  decrypt: (ciphertext: InputCiphertext) => Promise<OutputPlaintext>;
}
