import IWebStorage from 'common/types/IWebStorage';

const test = 'ablyjs-storage-test';

let globalObject = typeof global !== 'undefined' ? global : typeof window !== 'undefined' ? window : self;

class Webstorage implements IWebStorage {
  sessionSupported: boolean;
  localSupported: boolean;

  constructor() {
    /* Even just accessing the session/localStorage object can throw a
     * security exception in some circumstances with some browsers. In
     * others, calling setItem will throw. So have to check in this
     * somewhat roundabout way. (If unsupported or no global object,
     * will throw on accessing a property of undefined) */
    try {
      globalObject.sessionStorage.setItem(test, test);
      globalObject.sessionStorage.removeItem(test);
      this.sessionSupported = true;
    } catch (e) {
      this.sessionSupported = false;
    }

    try {
      globalObject.localStorage.setItem(test, test);
      globalObject.localStorage.removeItem(test);
      this.localSupported = true;
    } catch (e) {
      this.localSupported = false;
    }
  }

  get(name: string): any {
    return this._get(name, false);
  }

  getSession(name: string): any {
    return this._get(name, true);
  }

  remove(name: string): void {
    return this._remove(name, false);
  }

  removeSession(name: string): void {
    return this._remove(name, true);
  }

  set(name: string, value: string, ttl?: number): void {
    return this._set(name, value, ttl, false);
  }

  setSession(name: string, value: string, ttl?: number): void {
    return this._set(name, value, ttl, true);
  }

  private _set(name: string, value: string, ttl: number | undefined, session: any) {
    const wrappedValue: Record<string, any> = { value: value };
    if (ttl) {
      wrappedValue.expires = Date.now() + ttl;
    }
    return this.storageInterface(session).setItem(name, JSON.stringify(wrappedValue));
  }

  private _get(name: string, session?: boolean) {
    if (session && !this.sessionSupported) throw new Error('Session Storage not supported');
    if (!session && !this.localSupported) throw new Error('Local Storage not supported');
    const rawItem = this.storageInterface(session).getItem(name);
    if (!rawItem) return null;
    const wrappedValue = JSON.parse(rawItem);
    if (wrappedValue.expires && wrappedValue.expires < Date.now()) {
      this.storageInterface(session).removeItem(name);
      return null;
    }
    return wrappedValue.value;
  }

  private _remove(name: string, session?: boolean) {
    return this.storageInterface(session).removeItem(name);
  }

  private storageInterface(session?: boolean) {
    return session ? globalObject.sessionStorage : globalObject.localStorage;
  }
}

export default new Webstorage();
