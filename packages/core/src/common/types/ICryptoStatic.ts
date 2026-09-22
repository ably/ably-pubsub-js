import * as API from '../../../ably';
import ICipher from './ICipher';
import Logger from '../../common/lib/util/logger';

export type IGetCipherParams<IV> = (API.CipherParams | API.CipherParamOptions) & { iv?: IV };
export interface IGetCipherReturnValue<Cipher> {
  cipher: Cipher;
  cipherParams: API.CipherParams;
}

export default interface ICryptoStatic<IV, InputPlaintext, OutputCiphertext, InputCiphertext, OutputPlaintext>
  extends API.Crypto {
  getCipher(
    params: IGetCipherParams<IV>,
    logger: Logger,
  ): IGetCipherReturnValue<ICipher<InputPlaintext, OutputCiphertext, InputCiphertext, OutputPlaintext>>;
}

/*
 A less strongly typed version of ICryptoStatic to use until we
 can make Platform a generic type (see comment there).
 */
export interface IUntypedCryptoStatic extends API.Crypto {
  getCipher(params: any, logger: Logger): any;
}
