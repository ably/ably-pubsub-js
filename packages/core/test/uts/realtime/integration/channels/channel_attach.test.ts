/**
 * UTS Integration: Channel Attach/Detach Tests
 *
 * Spec points: RTL4, RTL4c, RTL5, RTL5d, RTL14
 * Source: uts/realtime/integration/channels/channel_attach_test.md
 */

import { expect } from 'chai';
import {
  Ably,
  SANDBOX_ENDPOINT,
  setupSandbox,
  teardownSandbox,
  getApiKey,
  trackClient,
  connectAndWait,
  closeAndWait,
  uniqueChannelName,
} from '../sandbox';

describe('uts/realtime/integration/channels/channel_attach', function () {
  this.timeout(30000);

  before(async function () {
    await setupSandbox();
  });

  after(async function () {
    await teardownSandbox();
  });

  /**
   * RTL4c - Attach succeeds
   */
  // UTS: realtime/integration/RTL4c/attach-succeeds-0
  it('RTL4c - attach succeeds', async function () {
    const channelName = uniqueChannelName('attach-RTL4c');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName);
    expect(channel.state).to.equal('initialized');

    await channel.attach();

    expect(channel.state).to.equal('attached');
    expect(channel.errorReason).to.be.null;

    await closeAndWait(client);
  });

  /**
   * RTL5d - Detach succeeds
   */
  // UTS: realtime/integration/RTL5d/detach-succeeds-0
  it('RTL5d - detach succeeds', async function () {
    const channelName = uniqueChannelName('detach-RTL5d');

    const client = new Ably.Realtime({
      key: getApiKey(),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName);
    await channel.attach();
    expect(channel.state).to.equal('attached');

    await channel.detach();

    expect(channel.state).to.equal('detached');

    await closeAndWait(client);
  });

  /**
   * RTL14 - Insufficient capability causes publish failure
   */
  // UTS: realtime/integration/RTL14/insufficient-capability-failed-0
  it('RTL14 - publish with subscribe-only key fails with 40160', async function () {
    const channelName = uniqueChannelName('publish-not-allowed');

    const client = new Ably.Realtime({
      key: getApiKey(3),
      endpoint: SANDBOX_ENDPOINT,
      autoConnect: false,
      useBinaryProtocol: false,
    });
    trackClient(client);

    await connectAndWait(client);

    const channel = client.channels.get(channelName);
    await channel.attach();
    expect(channel.state).to.equal('attached');

    let error: any = null;
    try {
      await channel.publish('test', 'data');
    } catch (err: any) {
      error = err;
    }

    expect(error).to.not.be.null;
    expect(error.code).to.equal(40160);
    expect(error.statusCode).to.equal(401);

    expect(client.connection.state).to.equal('connected');

    await closeAndWait(client);
  });
});
