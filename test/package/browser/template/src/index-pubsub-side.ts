// Checks that the per-side Pub/Sub packages resolve, type-check and bundle the way a real
// consumer's toolchain sees them: installed from their own tarballs, with the core satisfying
// their exact peer dependency. That is worth exercising separately from the core because each
// package is a wrapper whose declarations re-export the core's by bare specifier, so its types
// only resolve if the core resolves from inside it too.
//
// Runtime behaviour of the side stamp is covered by test/unit/pubsub_side_packages.test.js.
// Nothing here connects to Ably, so this file needs no sandbox key.
import * as PubSubDevice from '@ably/pubsub-device';
import * as PubSubServer from '@ably/pubsub-server';

declare module globalThis {
  var testAblyPubSubSidePackages: () => Promise<void>;
}

// Both packages re-export the core's type surface, so a consumer can annotate with the types
// without also depending on `ably` directly.
async function attachChannel(channel: PubSubDevice.RealtimeChannel) {
  await channel.attach();
}

function inspectStats(page: PubSubServer.PaginatedResult<PubSubServer.Stats>) {
  return page.items.length;
}

globalThis.testAblyPubSubSidePackages = async function () {
  const device = PubSubDevice.createClient({ key: 'app.key:secret', autoConnect: false, clientId: 'someone' });
  const serverRealtime = PubSubServer.createRealtimeClient({ key: 'app.key:secret', autoConnect: false });
  const serverHttp = PubSubServer.createHttpClient({ key: 'app.key:secret' });

  // Check the factories return the client kinds their declarations promise.
  const deviceChannel: PubSubDevice.RealtimeChannel = device.channels.get('channel');
  const serverChannel: PubSubServer.RealtimeChannel = serverRealtime.channels.get('channel');
  void attachChannel;
  void inspectStats;
  void deviceChannel;
  void serverChannel;
  void serverHttp.request;

  // Check the re-exported error type is the core's, so instanceof works across the boundary.
  const error: PubSubDevice.ErrorInfo = new PubSubDevice.ErrorInfo('message', 40000, 400);
  if (!(error instanceof PubSubServer.ErrorInfo)) {
    throw new Error('the two packages disagree about ErrorInfo, so more than one core is installed');
  }

  device.close();
  serverRealtime.close();
};
