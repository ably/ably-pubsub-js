import type BaseClient from 'common/lib/client/baseclient';
import type RealtimeChannel from 'common/lib/client/realtimechannel';
import type RestChannel from 'common/lib/client/restchannel';

class PushChannel {
  client: BaseClient;
  channel: RestChannel | RealtimeChannel;

  constructor(channel: RestChannel | RealtimeChannel) {
    this.channel = channel;
    this.client = channel.client;
  }

  async subscribeDevice() {
    const client = this.client;
    const device = await client.getDevice();
    const format = client.options.useBinaryProtocol ? client.Utils.Format.msgpack : client.Utils.Format.json,
      body = { deviceId: device.id, channel: this.channel.name },
      headers = client.Defaults.defaultPostHeaders(client.options);

    if (client.options.headers) client.Utils.mixin(headers, client.options.headers);

    client.Utils.mixin(headers, this._getPushAuthHeaders(device));

    const requestBody = client.Utils.encodeBody(body, client._MsgPack, format);
    await client.rest.Resource.post(client, '/push/channelSubscriptions', requestBody, headers, {}, format, true);
  }

  async unsubscribeDevice() {
    const client = this.client;
    const device = await client.getDevice();
    const format = client.options.useBinaryProtocol ? client.Utils.Format.msgpack : client.Utils.Format.json,
      headers = client.Defaults.defaultPostHeaders(client.options);

    if (client.options.headers) client.Utils.mixin(headers, client.options.headers);

    client.Utils.mixin(headers, this._getPushAuthHeaders(device));

    await client.rest.Resource.delete(
      client,
      '/push/channelSubscriptions',
      headers,
      { deviceId: device.id, channel: this.channel.name },
      format,
      true,
    );
  }

  async subscribeClient() {
    const client = this.client;
    const clientId = this.client.auth.clientId;
    if (!clientId) {
      throw new this.client.ErrorInfo({
        message: 'Cannot subscribe from client without client ID',
        code: 50000,
        statusCode: 500,
        remediation:
          'Set ClientOptions.clientId before calling pushChannel.subscribeClient(). On a realtime client, a clientId carried in the token also satisfies this once the connection has connected. On a REST client, only ClientOptions.clientId works.',
      });
    }
    const format = client.options.useBinaryProtocol ? client.Utils.Format.msgpack : client.Utils.Format.json,
      body = { clientId: clientId, channel: this.channel.name },
      headers = client.Defaults.defaultPostHeaders(client.options);

    if (client.options.headers) client.Utils.mixin(headers, client.options.headers);

    const requestBody = client.Utils.encodeBody(body, client._MsgPack, format);
    await client.rest.Resource.post(client, '/push/channelSubscriptions', requestBody, headers, {}, format, true);
  }

  async unsubscribeClient() {
    const client = this.client;

    const clientId = this.client.auth.clientId;
    if (!clientId) {
      throw new this.client.ErrorInfo({
        message: 'Cannot unsubscribe from client without client ID',
        code: 50000,
        statusCode: 500,
        remediation:
          'Set ClientOptions.clientId before calling pushChannel.unsubscribeClient(). On a realtime client, a clientId carried in the token also satisfies this once the connection has connected. On a REST client, only ClientOptions.clientId works.',
      });
    }
    const format = client.options.useBinaryProtocol ? client.Utils.Format.msgpack : client.Utils.Format.json,
      headers = client.Defaults.defaultPostHeaders(client.options);

    if (client.options.headers) client.Utils.mixin(headers, client.options.headers);

    await client.rest.Resource.delete(
      client,
      '/push/channelSubscriptions',
      headers,
      { clientId: clientId, channel: this.channel.name },
      format,
      true,
    );
  }

  async listSubscriptions(params?: Record<string, string>) {
    this.client.Logger.logAction(
      this.client.logger,
      this.client.Logger.LOG_MICRO,
      'PushChannel.listSubscriptions()',
      'channel = ' + this.channel.name,
    );

    return this.client.push.admin.channelSubscriptions.list({
      ...params,
      channel: this.channel.name,
      concatFilters: true,
    });
  }

  private _getDeviceIdentityToken(device: Awaited<ReturnType<BaseClient['getDevice']>>) {
    const deviceIdentityToken = device.deviceIdentityToken;
    if (deviceIdentityToken) {
      return deviceIdentityToken;
    } else {
      throw new this.client.ErrorInfo({
        message: 'Cannot subscribe or unsubscribe this device without a deviceIdentityToken',
        code: 50000,
        statusCode: 500,
        remediation: 'Activate this device first by awaiting client.push.activate().',
      });
    }
  }

  private _getPushAuthHeaders(device: Awaited<ReturnType<BaseClient['getDevice']>>) {
    const deviceIdentityToken = this._getDeviceIdentityToken(device);
    return { 'X-Ably-DeviceToken': deviceIdentityToken };
  }
}

export default PushChannel;
