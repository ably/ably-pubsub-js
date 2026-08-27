import IDefaults from '../../../../common/types/IDefaults';
import { TransportNames } from '../../../../common/constants/TransportName';

const Defaults: IDefaults = {
  connectivityCheckUrl: 'https://internet-up.ably-realtime.com/is-the-internet-up.txt',
  wsConnectivityCheckUrl: 'wss://ws-up.ably-realtime.com',
  /* Note: order matters here: the base transport is the leftmost one in the
   * intersection of baseTransportOrder and the transports clientOption that's supported. */
  defaultTransports: [TransportNames.WebSocket],
  restAgentOptions: { maxSockets: 40, keepAlive: true },
};

export default Defaults;
