import { StandardCallback } from 'common/types/utils';
import ErrorInfo from 'common/lib/types/errorinfo';
import Logger from './logger';

export interface MulticasterInstance<T> extends Function {
  (err?: ErrorInfo | null, result?: T): void;
  push: (fn: StandardCallback<T>) => void;
  /**
   * Creates a promise that will be resolved or rejected when this instance is called.
   */
  createPromise: () => Promise<T>;
  /**
   * Syntatic sugar for when working in a context that uses promises; equivalent to calling as a function with arguments (null, result).
   */
  resolveAll(result: T): void;
  /**
   * Syntatic sugar for when working in a context that uses promises; equivalent to calling as a function with arguments (err).
   */
  rejectAll(err: ErrorInfo): void;
}

class Multicaster<T> {
  members: Array<StandardCallback<T>>;

  // Private constructor; use static Multicaster.create instead
  private constructor(
    private readonly logger: Logger,
    members?: Array<StandardCallback<T> | undefined>,
  ) {
    this.members = (members as Array<StandardCallback<T>>) || [];
  }

  private call(err?: ErrorInfo | null, result?: T): void {
    for (const member of this.members) {
      if (member) {
        try {
          member(err, result);
        } catch (e) {
          Logger.logAction(
            this.logger,
            Logger.LOG_ERROR,
            'Multicaster multiple callback handler',
            'Unexpected exception: ' + e + '; stack = ' + (e as Error).stack,
          );
        }
      }
    }
  }

  push(...args: Array<StandardCallback<T>>): void {
    this.members.push(...args);
  }

  createPromise(): Promise<T> {
    return new Promise((resolve, reject) => {
      this.push((err, result) => {
        err ? reject(err) : resolve(result!);
      });
    });
  }

  resolveAll(result: T) {
    this.call(null, result);
  }

  rejectAll(err: ErrorInfo) {
    this.call(err);
  }

  static create<T>(logger: Logger, members?: Array<StandardCallback<T> | undefined>): MulticasterInstance<T> {
    const instance = new Multicaster(logger, members);
    return Object.assign((err?: ErrorInfo | null, result?: T) => instance.call(err, result), {
      push: (fn: StandardCallback<T>) => instance.push(fn),
      createPromise: () => instance.createPromise(),
      resolveAll: (result: T) => instance.resolveAll(result),
      rejectAll: (err: ErrorInfo) => instance.rejectAll(err),
    });
  }
}

export default Multicaster;
