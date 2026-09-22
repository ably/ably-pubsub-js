import { IPartialErrorInfo } from '../types/errorinfo';

class ConnectionStateChange {
  previous?: string;
  current?: string;
  retryIn?: number;
  reason?: IPartialErrorInfo;

  constructor(previous?: string, current?: string, retryIn?: number | null, reason?: IPartialErrorInfo) {
    this.previous = previous;
    this.current = current;
    if (retryIn) this.retryIn = retryIn;
    if (reason) this.reason = reason;
  }
}

export default ConnectionStateChange;
