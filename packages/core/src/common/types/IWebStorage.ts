export default interface IWebStorage {
  sessionSupported: boolean;
  localSupported: boolean;
  set(name: string, value: string, ttl?: number): void;
  get(name: string): any;
  remove(name: string): void;
  setSession(name: string, value: string, ttl?: number): void;
  getSession(name: string): any;
  removeSession(name: string): void;
}
