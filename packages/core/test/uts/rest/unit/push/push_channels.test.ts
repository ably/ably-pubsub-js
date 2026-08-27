/**
 * UTS: PushChannel Tests (RSH7)
 *
 * Spec points: RSH7, RSH7a, RSH7a1, RSH7a2, RSH7a3, RSH7b, RSH7b1, RSH7b2,
 *              RSH7c, RSH7c1, RSH7c2, RSH7c3, RSH7d, RSH7d1, RSH7d2, RSH7e
 * Source: uts/rest/unit/push/push_channels.md
 *
 * These tests cover the PushChannel interface (RSH7), which is the `push`
 * field on RestChannel/RealtimeChannel. PushChannel methods operate from
 * the perspective of the local device (the push target), not the admin API.
 *
 * Deviations from UTS spec (ably-js-specific):
 * - subscribeClient/unsubscribeClient use client.auth.clientId, not LocalDevice.clientId
 * - listSubscriptions delegates to push.admin.channelSubscriptions.list with
 *   {channel, concatFilters: true, ...params} — it does NOT automatically
 *   include deviceId or clientId (those must be provided in params by the caller)
 */

import { expect } from 'chai';
import { MockHttpClient } from '../../../mock_http';
import { Ably, installMockHttp, restoreAll } from '../../../helpers';
import * as PushPlugin from '../../../../../src/plugins/push';

/**
 * Configure a Rest client with a fake local device for PushChannel testing.
 *
 * ably-js's PushChannel requires:
 * 1. The Push plugin to be provided via options.plugins.Push (so channel.push exists)
 * 2. client.push.LocalDevice to be truthy (so client.device() guard passes)
 * 3. client._device to be set (the actual device data)
 *
 * On Node.js, Platform.Config.push is undefined, so the Push constructor
 * never sets push.LocalDevice even when the plugin is provided. We need to
 * monkey-patch both push.LocalDevice and _device.
 */
function configureFakeDevice(
  client: any,
  device: { id: string; deviceIdentityToken: string | null; clientId?: string | null },
): void {
  // Set push.LocalDevice to a truthy value so client.device() guard passes
  (client as any).push.LocalDevice = {} as any;
  // Set _device so device() returns our fake without calling LocalDevice.load()
  (client as any)._device = device;
}

describe('uts/rest/unit/push/push_channels', function () {
  afterEach(restoreAll);

  // ---------------------------------------------------------------------------
  // RSH7a — subscribeDevice
  // ---------------------------------------------------------------------------

  /**
   * RSH7a2, RSH7a3 - subscribeDevice sends POST with deviceId, channel name, and device auth
   *
   * subscribeDevice() sends a POST to /push/channelSubscriptions with the
   * device's id and the channel name in the request body, and includes the
   * X-Ably-DeviceToken header for push device authentication (RSH6a).
   */
  // UTS: rest/unit/RSH7a2/subscribe-device-post-0
  it('RSH7a2, RSH7a3 - subscribeDevice sends POST with deviceId, channel, and device auth header', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          channel: 'my-channel',
          deviceId: 'test-device-001',
        });
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { Push: PushPlugin },
    } as any);

    configureFakeDevice(client, {
      id: 'test-device-001',
      deviceIdentityToken: 'test-device-identity-token',
      clientId: 'test-client',
    });

    const channel = client.channels.get('my-channel');
    await channel.push.subscribeDevice();

    expect(captured).to.have.length(1);

    const request = captured[0];
    expect(request.method).to.equal('post');
    expect(request.path).to.equal('/push/channelSubscriptions');

    const body = JSON.parse(request.body);
    expect(body.channel).to.equal('my-channel');
    expect(body.deviceId).to.equal('test-device-001');

    // RSH7a3 + RSH6a - push device authentication via deviceIdentityToken
    expect(request.headers['X-Ably-DeviceToken']).to.equal('test-device-identity-token');
  });

  /**
   * RSH7a1 - subscribeDevice fails if no deviceIdentityToken
   *
   * subscribeDevice() fails when the local device has no deviceIdentityToken
   * (i.e. the device isn't registered yet).
   */
  // UTS: rest/unit/RSH7a1/subscribe-device-no-token-fails-0
  it('RSH7a1 - subscribeDevice fails if no deviceIdentityToken', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, {});
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { Push: PushPlugin },
    } as any);

    configureFakeDevice(client, {
      id: 'test-device-001',
      deviceIdentityToken: null,
      clientId: 'test-client',
    });

    const channel = client.channels.get('my-channel');

    try {
      await channel.push.subscribeDevice();
      expect.fail('Expected subscribeDevice to throw');
    } catch (err: any) {
      expect(err.code).to.not.be.null;
      expect(err.message).to.contain('deviceIdentityToken');
    }
  });

  // ---------------------------------------------------------------------------
  // RSH7b — subscribeClient
  // ---------------------------------------------------------------------------

  /**
   * RSH7b2 - subscribeClient sends POST with clientId and channel name
   *
   * subscribeClient() sends a POST to /push/channelSubscriptions with the
   * client's clientId and the channel name in the request body.
   *
   * Deviation: ably-js uses client.auth.clientId (from ClientOptions.clientId),
   * not LocalDevice.clientId as the UTS spec describes.
   */
  // UTS: rest/unit/RSH7b2/subscribe-client-post-0
  it('RSH7b2 - subscribeClient sends POST with clientId and channel name', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, {
          channel: 'my-channel',
          clientId: 'test-client',
        });
      },
    });
    installMockHttp(mock);

    // clientId is set on the client options (which sets client.auth.clientId)
    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      clientId: 'test-client',
      plugins: { Push: PushPlugin },
    } as any);

    const channel = client.channels.get('my-channel');
    await channel.push.subscribeClient();

    expect(captured).to.have.length(1);

    const request = captured[0];
    expect(request.method).to.equal('post');
    expect(request.path).to.equal('/push/channelSubscriptions');

    const body = JSON.parse(request.body);
    expect(body.channel).to.equal('my-channel');
    expect(body.clientId).to.equal('test-client');
  });

  /**
   * RSH7b1 - subscribeClient fails if no clientId
   *
   * subscribeClient() fails when the client has no clientId.
   *
   * Deviation: ably-js checks client.auth.clientId, not LocalDevice.clientId.
   */
  // UTS: rest/unit/RSH7b1/subscribe-client-no-clientid-fails-0
  it('RSH7b1 - subscribeClient fails if no clientId', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(200, {});
      },
    });
    installMockHttp(mock);

    // No clientId on client options
    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { Push: PushPlugin },
    } as any);

    const channel = client.channels.get('my-channel');

    try {
      await channel.push.subscribeClient();
      expect.fail('Expected subscribeClient to throw');
    } catch (err: any) {
      expect(err.code).to.not.be.null;
      // ably-js error message says "client ID" rather than "clientId"
      expect(err.message.toLowerCase()).to.contain('client');
    }
  });

  // ---------------------------------------------------------------------------
  // RSH7c — unsubscribeDevice
  // ---------------------------------------------------------------------------

  /**
   * RSH7c2, RSH7c3 - unsubscribeDevice sends DELETE with deviceId, channel, and device auth
   *
   * unsubscribeDevice() sends a DELETE to /push/channelSubscriptions with the
   * device's id and the channel name as query parameters, and includes the
   * X-Ably-DeviceToken header for push device authentication (RSH6a).
   */
  // UTS: rest/unit/RSH7c2/unsubscribe-device-delete-0
  it('RSH7c2, RSH7c3 - unsubscribeDevice sends DELETE with deviceId, channel, and device auth header', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(204, null);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { Push: PushPlugin },
    } as any);

    configureFakeDevice(client, {
      id: 'test-device-001',
      deviceIdentityToken: 'test-device-identity-token',
      clientId: 'test-client',
    });

    const channel = client.channels.get('my-channel');
    await channel.push.unsubscribeDevice();

    expect(captured).to.have.length(1);

    const request = captured[0];
    expect(request.method).to.equal('delete');
    expect(request.path).to.equal('/push/channelSubscriptions');
    expect(request.url.searchParams.get('channel')).to.equal('my-channel');
    expect(request.url.searchParams.get('deviceId')).to.equal('test-device-001');

    // RSH7c3 + RSH6a - push device authentication via deviceIdentityToken
    expect(request.headers['X-Ably-DeviceToken']).to.equal('test-device-identity-token');
  });

  /**
   * RSH7c1 - unsubscribeDevice fails if no deviceIdentityToken
   *
   * unsubscribeDevice() fails when the local device has no deviceIdentityToken.
   */
  // UTS: rest/unit/RSH7c1/unsubscribe-device-no-token-fails-0
  it('RSH7c1 - unsubscribeDevice fails if no deviceIdentityToken', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(204, null);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { Push: PushPlugin },
    } as any);

    configureFakeDevice(client, {
      id: 'test-device-001',
      deviceIdentityToken: null,
      clientId: 'test-client',
    });

    const channel = client.channels.get('my-channel');

    try {
      await channel.push.unsubscribeDevice();
      expect.fail('Expected unsubscribeDevice to throw');
    } catch (err: any) {
      expect(err.code).to.not.be.null;
      expect(err.message).to.contain('deviceIdentityToken');
    }
  });

  // ---------------------------------------------------------------------------
  // RSH7d — unsubscribeClient
  // ---------------------------------------------------------------------------

  /**
   * RSH7d2 - unsubscribeClient sends DELETE with clientId and channel name
   *
   * unsubscribeClient() sends a DELETE to /push/channelSubscriptions with the
   * client's clientId and the channel name as query parameters.
   *
   * Deviation: ably-js uses client.auth.clientId, not LocalDevice.clientId.
   */
  // UTS: rest/unit/RSH7d2/unsubscribe-client-delete-0
  it('RSH7d2 - unsubscribeClient sends DELETE with clientId and channel name', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(204, null);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      clientId: 'test-client',
      plugins: { Push: PushPlugin },
    } as any);

    const channel = client.channels.get('my-channel');
    await channel.push.unsubscribeClient();

    expect(captured).to.have.length(1);

    const request = captured[0];
    expect(request.method).to.equal('delete');
    expect(request.path).to.equal('/push/channelSubscriptions');
    expect(request.url.searchParams.get('channel')).to.equal('my-channel');
    expect(request.url.searchParams.get('clientId')).to.equal('test-client');
  });

  /**
   * RSH7d1 - unsubscribeClient fails if no clientId
   *
   * unsubscribeClient() fails when the client has no clientId.
   *
   * Deviation: ably-js checks client.auth.clientId, not LocalDevice.clientId.
   */
  // UTS: rest/unit/RSH7d1/unsubscribe-client-no-clientid-fails-0
  it('RSH7d1 - unsubscribeClient fails if no clientId', async function () {
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        req.respond_with(204, null);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { Push: PushPlugin },
    } as any);

    const channel = client.channels.get('my-channel');

    try {
      await channel.push.unsubscribeClient();
      expect.fail('Expected unsubscribeClient to throw');
    } catch (err: any) {
      expect(err.code).to.not.be.null;
      expect(err.message.toLowerCase()).to.contain('client');
    }
  });

  // ---------------------------------------------------------------------------
  // RSH7e — listSubscriptions
  // ---------------------------------------------------------------------------

  /**
   * RSH7e - listSubscriptions sends GET with channel, concatFilters, and user params
   *
   * listSubscriptions() sends a GET to /push/channelSubscriptions with the
   * channel name, concatFilters=true, and any user-provided params.
   *
   * Deviation: ably-js does NOT automatically include deviceId or clientId in
   * the query params. The UTS spec expects these to be included from the
   * LocalDevice, but ably-js's implementation delegates to
   * push.admin.channelSubscriptions.list() with only {channel, concatFilters, ...params}.
   */
  // UTS: rest/unit/RSH7e/list-subscriptions-with-filters-0
  it('RSH7e - listSubscriptions sends GET with channel, concatFilters, and user params', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          {
            channel: 'my-channel',
            deviceId: 'test-device-001',
          },
          {
            channel: 'my-channel',
            clientId: 'test-client',
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      clientId: 'test-client',
      plugins: { Push: PushPlugin },
    } as any);

    const channel = client.channels.get('my-channel');
    const result = await channel.push.listSubscriptions({ limit: '10' });

    expect(captured).to.have.length(1);

    const request = captured[0];
    expect(request.method).to.equal('get');
    expect(request.path).to.equal('/push/channelSubscriptions');

    // Channel name is automatically included
    expect(request.url.searchParams.get('channel')).to.equal('my-channel');

    // concatFilters must be set to true
    expect(request.url.searchParams.get('concatFilters')).to.equal('true');

    // User-provided params are forwarded
    expect(request.url.searchParams.get('limit')).to.equal('10');

    // Verify result is a PaginatedResult
    expect(result.items).to.have.length(2);
    expect((result.items[0] as any).channel).to.equal('my-channel');
    expect((result.items[0] as any).deviceId).to.equal('test-device-001');
    expect((result.items[1] as any).clientId).to.equal('test-client');
  });

  /**
   * RSH7e - listSubscriptions without additional params
   *
   * listSubscriptions() works with no extra params, still sending channel
   * and concatFilters.
   */
  // UTS: rest/unit/RSH7e/list-subscriptions-omits-clientid-1
  it('RSH7e - listSubscriptions without additional params', async function () {
    const captured: any[] = [];
    const mock = new MockHttpClient({
      onConnectionAttempt: (conn) => conn.respond_with_success(),
      onRequest: (req) => {
        captured.push(req);
        req.respond_with(200, [
          {
            channel: 'my-channel',
            deviceId: 'test-device-001',
          },
        ]);
      },
    });
    installMockHttp(mock);

    const client = new Ably.Rest({
      key: 'appId.keyId:keySecret',
      useBinaryProtocol: false,
      plugins: { Push: PushPlugin },
    } as any);

    const channel = client.channels.get('my-channel');
    const result = await channel.push.listSubscriptions();

    expect(captured).to.have.length(1);

    const request = captured[0];
    expect(request.url.searchParams.get('channel')).to.equal('my-channel');
    expect(request.url.searchParams.get('concatFilters')).to.equal('true');

    expect(result.items).to.have.length(1);
  });
});
