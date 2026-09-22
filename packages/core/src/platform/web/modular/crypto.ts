import BufferUtils from '../lib/util/bufferutils';
import { createCryptoClass } from '../lib/util/crypto';
import Config from '../config';
import * as API from '../../../../ably';

export const Crypto = /* @__PURE__@ */ createCryptoClass(Config, BufferUtils);

export const generateRandomKey: API.Crypto['generateRandomKey'] = (keyLength) => {
  return Crypto.generateRandomKey(keyLength);
};

export const getDefaultCryptoParams: API.Crypto['getDefaultParams'] = (params) => {
  return Crypto.getDefaultParams(params);
};
