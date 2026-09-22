import TransportName from 'common/constants/TransportName';
import Platform from 'common/platform';
import XhrPollingTransport from './xhrpollingtransport';
import WebSocketTransport from '../../../../common/lib/transport/websockettransport';

// For reasons that I don’t understand, if we use [TransportNames.XhrPolling] for the keys in defaultTransports’s, then defaultTransports does not get tree-shaken. Hence using literals instead. They’re still correctly type-checked.

const order: TransportName[] = ['xhr_polling'];

const defaultTransports: (typeof Platform)['Transports'] = {
  order,
  bundledImplementations: {
    web_socket: WebSocketTransport,
    xhr_polling: XhrPollingTransport,
  },
};

export default defaultTransports;

export const ModularTransports: (typeof Platform)['Transports'] = {
  order,
  bundledImplementations: {},
};
