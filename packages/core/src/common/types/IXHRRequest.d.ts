import EventEmitter from '../lib/util/eventemitter';

/**
 * A common interface shared by the browser and NodeJS XHRRequest implementations
 */
export default interface IXHRRequest extends EventEmitter {
  exec(): void;
  abort(): void;
}
