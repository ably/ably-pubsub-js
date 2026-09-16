import BaseClient from './baseclient';
import ClientOptions from '../../types/ClientOptions';
import { Http } from './http';
import Defaults from '../util/defaults';
import Logger from '../util/logger';

/**
 `BaseHttp` is an export of the tree-shakable version of the SDK, and acts as the base class for the `DefaultHttp` class exported by the non tree-shakable version.

 It always includes the `Http` plugin.
 */
export class BaseHttp extends BaseClient {
  /*
   * The public typings declare that this only accepts an object, but since we want to emit a good error message in the case where a non-TypeScript user does one of these things:
   *
   * 1. passes a string (which is quite likely if they’re e.g. migrating from the default variant to the modular variant)
   * 2. passes no argument at all
   *
   * tell the compiler that these cases are possible so that it forces us to handle them.
   */
  constructor(options?: ClientOptions | string) {
    super(Defaults.objectifyOptions(options, false, 'BaseHttp', Logger.defaultLogger, { Http }));
  }
}
