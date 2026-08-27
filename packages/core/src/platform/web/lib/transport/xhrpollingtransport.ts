import Platform from '../../../../common/platform';
import CometTransport from '../../../../common/lib/transport/comettransport';
import XHRRequest from '../http/request/xhrrequest';
import ConnectionManager, { TransportParams } from 'common/lib/transport/connectionmanager';
import Auth from 'common/lib/client/auth';
import { RequestBody, RequestParams } from 'common/types/http';
import { TransportNames } from 'common/constants/TransportName';

var shortName = TransportNames.XhrPolling;
class XHRPollingTransport extends CometTransport {
  shortName = shortName;
  constructor(connectionManager: ConnectionManager, auth: Auth, params: TransportParams) {
    super(connectionManager, auth, params);
    params.stream = false;
    this.shortName = shortName;
  }

  static isAvailable() {
    return !!(Platform.Config.xhrSupported && Platform.Config.allowComet);
  }

  toString() {
    return 'XHRPollingTransport; uri=' + this.baseUri + '; isConnected=' + this.isConnected;
  }

  createRequest(
    uri: string,
    headers: Record<string, string>,
    params: RequestParams,
    body: RequestBody | null,
    requestMode: number,
  ) {
    return XHRRequest.createRequest(uri, headers, params, body, requestMode, this.timeouts, this.logger);
  }
}

export default XHRPollingTransport;
