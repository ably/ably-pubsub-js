import BaseClient from './baseclient';
import ClientOptions from '../../types/ClientOptions';
import { Rest } from './rest';
import Defaults from '../util/defaults';
import Logger from '../util/logger';

/**
 `BaseRest` is an export of the tree-shakable version of the SDK, and acts as the base class for the `DefaultRest` class exported by the non tree-shakable version.

 It always includes the `Rest` plugin.
 */
export class BaseRest extends BaseClient {
  /*
   * The public typings declare that this only accepts an object, but since we want to emit a good error message in the case where a non-TypeScript user does one of these things:
   *
   * 1. passes a string (which is quite likely if they’re e.g. migrating from the default variant to the modular variant)
   * 2. passes no argument at all
   *
   * tell the compiler that these cases are possible so that it forces us to handle them.
   */
  constructor(options?: ClientOptions | string) {
    super(Defaults.objectifyOptions(options, false, 'BaseRest', Logger.defaultLogger, { Rest }));
  }
}
