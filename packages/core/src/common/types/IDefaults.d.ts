import TransportName from '../constants/TransportName';
import { RestAgentOptions } from './ClientOptions';

export default interface IDefaults {
  connectivityCheckUrl: string;
  wsConnectivityCheckUrl: string;
  defaultTransports: TransportName[];
  restAgentOptions?: RestAgentOptions;
}
