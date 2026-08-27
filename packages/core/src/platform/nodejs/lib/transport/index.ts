import { TransportNames } from 'common/constants/TransportName';
import NodeCometTransport from './nodecomettransport';
import { default as WebSocketTransport } from '../../../../common/lib/transport/websockettransport';
import { TransportCtor } from 'common/lib/transport/transport';

export default {
  order: [TransportNames.Comet],
  bundledImplementations: {
    [TransportNames.WebSocket]: WebSocketTransport as TransportCtor,
    [TransportNames.Comet]: NodeCometTransport as unknown as TransportCtor,
  },
};
