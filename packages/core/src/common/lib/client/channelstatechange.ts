import ErrorInfo from '../types/errorinfo';

class ChannelStateChange {
  previous: string;
  current: string;
  resumed?: boolean;
  reason?: string | Error | ErrorInfo;
  hasBacklog?: boolean;

  constructor(
    previous: string,
    current: string,
    resumed?: boolean,
    hasBacklog?: boolean,
    reason?: string | Error | ErrorInfo | null,
  ) {
    this.previous = previous;
    this.current = current;
    if (current === 'attached') {
      this.resumed = resumed;
      this.hasBacklog = hasBacklog;
    }
    if (reason) this.reason = reason;
  }
}

export default ChannelStateChange;
