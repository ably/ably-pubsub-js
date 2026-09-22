import Transport from '../../../../common/lib/transport/transport';

declare class NodeCometTransport extends Transport {
  static isAvailable(): boolean;
}

export default NodeCometTransport;
