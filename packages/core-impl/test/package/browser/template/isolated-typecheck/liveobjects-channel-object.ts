/**
 * Checks that importing a package's `liveobjects` entry point declares `object` on that package's
 * channels, in a program that loads nothing else from the packages. The LiveObjects declarations
 * add `object` by module augmentation, which once targeted a module neither per-side package loads,
 * so `channel.object` was undeclared for a typical app.
 */
import * as PubSubServer from '@ably/pubsub-server';
import * as PubSubDevice from '@ably/pubsub-device';
import { LiveObjects as ServerLiveObjects } from '@ably/pubsub-server/liveobjects';
import type { HttpObject, RealtimeObject } from '@ably/pubsub-server/liveobjects';
import { LiveObjects as DeviceLiveObjects } from '@ably/pubsub-device/liveobjects';
import type { RealtimeObject as DeviceRealtimeObject } from '@ably/pubsub-device/liveobjects';

export function serverRealtimeChannel(): RealtimeObject {
  const client = PubSubServer.createRealtimeClient({ key: 'x', plugins: { LiveObjects: ServerLiveObjects } });
  return client.channels.get('channel').object;
}

export function serverHttpChannel(): HttpObject {
  const client = PubSubServer.createHttpClient({ key: 'x', plugins: { LiveObjects: ServerLiveObjects } });
  return client.channels.get('channel').object;
}

export function deviceRealtimeChannel(): DeviceRealtimeObject {
  const client = PubSubDevice.createClient({ key: 'x', plugins: { LiveObjects: DeviceLiveObjects } });
  const channel = client.channels.get('channel');
  // The device channel keeps its own members alongside the augmented one.
  void channel.push;
  return channel.object;
}
