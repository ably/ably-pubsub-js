import ClientOptions from '../../src/common/types/ClientOptions';

export type InternalClientOptions = ClientOptions & {
  channelRetryTimeout?: number;
};
