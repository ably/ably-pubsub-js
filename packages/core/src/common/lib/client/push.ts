import * as Utils from '../util/utils';
import DeviceDetails from '../types/devicedetails';
import Resource from './resource';
import PaginatedResource, { PaginatedResult } from './paginatedresource';
import ErrorInfo from '../types/errorinfo';
import PushChannelSubscription from '../types/pushchannelsubscription';
import BaseClient from './baseclient';
import Defaults from '../util/defaults';
import type {
  ActivationStateMachine,
  DeregisterCallback,
  LocalDeviceFactory,
  RegisterCallback,
} from 'plugins/push/pushactivation';
import type { ErrCallback } from 'common/types/utils';

// Keep this byte-identical to the copy in src/plugins/push/pushactivation.ts. The plugin only
// type-imports from common client modules, so a value import here is not viable for the build.
const PUSH_ACTIVATION_NOT_AVAILABLE_HINT =
  'Run push.activate() in a browser environment with service worker support, or in React Native using the ably/react-native-push plugin. From a server, use client.push.admin instead. Call client.push.admin.publish(recipient, payload) to send to a device or clientId. Call client.push.admin.deviceRegistrations.save(device) to register a device record.';

const PUSH_DEACTIVATION_NOT_AVAILABLE_HINT =
  'Run push.deactivate() in a browser environment with service worker support, or in React Native using the ably/react-native-push plugin. From a server, call client.push.admin.deviceRegistrations.remove(deviceId) to remove a device registration.';

const PUSH_TOKEN_UPDATE_NOT_AVAILABLE_HINT =
  'Call push.updateToken() in React Native with the ably/react-native-push plugin configured, passing plugins: { Push: ReactNativePush.create({ storage, requestToken }) } in the client options. From a server, use client.push.admin.deviceRegistrations.save(device) to modify a device registration instead.';

interface PushDeviceToken {
  transportType: 'apns' | 'fcm';
  token: string;
}

class Push {
  client: BaseClient;
  admin: Admin;
  stateMachine?: ActivationStateMachine;
  LocalDevice?: LocalDeviceFactory;

  constructor(client: BaseClient) {
    this.client = client;
    this.admin = new Admin(client);
    const pushPlugin = client.options.plugins?.Push;
    // client.pushConfig resolves to the plugin-carried push config (e.g. ReactNativePush, whose
    // storage and token acquisition are supplied per client) or falls back to the platform-level
    // Platform.Config.push (set statically on web), so each client keeps its own configuration
    if (client.pushConfig && pushPlugin) {
      this.stateMachine = new pushPlugin.ActivationStateMachine(client);
      this.LocalDevice = pushPlugin.localDeviceFactory(DeviceDetails);
    }
  }

  async activate(registerCallback?: RegisterCallback, updateFailedCallback?: ErrCallback) {
    const pushPlugin = this.client.options.plugins?.Push;
    if (!pushPlugin) {
      throw Utils.createMissingPluginError('Push');
    }
    const machine = this.stateMachine;
    if (!machine) {
      throw new ErrorInfo({
        message:
          'This platform is not supported as a target of push notifications: push activation requires a browser environment with service worker support, or a React Native environment with the ably/react-native-push plugin',
        code: 40000,
        statusCode: 400,
        remediation: PUSH_ACTIVATION_NOT_AVAILABLE_HINT,
      });
    }
    if (machine.activatedCallback) {
      throw new ErrorInfo({
        message: 'Activation already in progress',
        code: 40000,
        statusCode: 400,
        remediation: 'Await the in-flight push.activate() before calling it again.',
      });
    }
    // register the callback synchronously with the in-progress check above, so a concurrent
    // activate() call is rejected rather than silently replacing this one's callback
    const activated = new Promise<void>((resolve, reject) => {
      machine.activatedCallback = (err: ErrorInfo) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };
      machine.updateFailedCallback = updateFailedCallback;
    });
    // the state machine's processEvent handlers read the local device synchronously, so the
    // device and the persisted machine state must be hydrated before any event is dispatched
    try {
      await this.client.getDevice();
      await machine.ensureInitialized();
    } catch (err) {
      delete machine.activatedCallback;
      delete machine.updateFailedCallback;
      throw err;
    }
    machine.handleEvent(new pushPlugin.CalledActivate(machine, registerCallback));
    await activated;
  }

  async deactivate(deregisterCallback: DeregisterCallback) {
    const pushPlugin = this.client.options.plugins?.Push;
    if (!pushPlugin) {
      throw Utils.createMissingPluginError('Push');
    }
    const machine = this.stateMachine;
    if (!machine) {
      throw new ErrorInfo({
        message:
          'This platform is not supported as a target of push notifications: push activation requires a browser environment with service worker support, or a React Native environment with the ably/react-native-push plugin',
        code: 40000,
        statusCode: 400,
        remediation: PUSH_DEACTIVATION_NOT_AVAILABLE_HINT,
      });
    }
    if (machine.deactivatedCallback) {
      throw new ErrorInfo({
        message: 'Deactivation already in progress',
        code: 40000,
        statusCode: 400,
        remediation: 'Await the in-flight push.deactivate() before calling it again.',
      });
    }
    // register the callback synchronously with the in-progress check above, so a concurrent
    // deactivate() call is rejected rather than silently replacing this one's callback
    const deactivated = new Promise<void>((resolve, reject) => {
      machine.deactivatedCallback = (err: ErrorInfo) => {
        if (err) {
          reject(err);
          return;
        }
        resolve();
      };
    });
    // the state machine's processEvent handlers read the local device synchronously, so the
    // device and the persisted machine state must be hydrated before any event is dispatched
    try {
      await this.client.getDevice();
      await machine.ensureInitialized();
    } catch (err) {
      delete machine.deactivatedCallback;
      throw err;
    }
    machine.handleEvent(new pushPlugin.CalledDeactivate(machine, deregisterCallback));
    await deactivated;
  }

  async updateToken(token: PushDeviceToken): Promise<void> {
    const pushPlugin = this.client.options.plugins?.Push;
    if (!pushPlugin) {
      throw Utils.createMissingPluginError('Push');
    }
    const machine = this.stateMachine;
    if (!machine) {
      throw new ErrorInfo({
        message:
          'This platform is not supported as a target of push notifications: push token updates require a React Native environment with the ably/react-native-push plugin',
        code: 40000,
        statusCode: 400,
        remediation: PUSH_TOKEN_UPDATE_NOT_AVAILABLE_HINT,
      });
    }
    if (
      !token ||
      (token.transportType !== 'fcm' && token.transportType !== 'apns') ||
      typeof token.token !== 'string' ||
      token.token.length === 0
    ) {
      throw new ErrorInfo({
        message:
          "push.updateToken() requires a { transportType, token } object with transportType 'fcm' or 'apns' and a non-empty token string",
        code: 40000,
        statusCode: 400,
        remediation:
          "Pass the refreshed token in the shape your requestToken callback returns, for example { transportType: 'fcm', token } with the token value delivered by messaging().onTokenRefresh.",
      });
    }

    // the state machine's processEvent handlers read the local device synchronously, so the
    // device and the persisted machine state must be hydrated before any event is dispatched
    const device = await this.client.getDevice();
    await machine.ensureInitialized();

    if (!device.deviceIdentityToken) {
      throw new ErrorInfo({
        message: 'Push token cannot be updated because the device is not activated for push notifications',
        code: 40000,
        statusCode: 400,
        remediation:
          'Call client.push.activate() and await its completion before calling push.updateToken(). Wire updateToken() to your platform token refresh listener only after activation has completed.',
      });
    }

    device.push.recipient =
      token.transportType === 'apns'
        ? { transportType: 'apns', deviceToken: token.token }
        : { transportType: 'fcm', registrationToken: token.token };
    await device.persist();

    machine.handleEvent(new machine.GotPushDeviceDetails());
  }
}

class Admin {
  client: BaseClient;
  deviceRegistrations: DeviceRegistrations;
  channelSubscriptions: ChannelSubscriptions;
  liveActivity: LiveActivity;

  constructor(client: BaseClient) {
    this.client = client;
    this.deviceRegistrations = new DeviceRegistrations(client);
    this.channelSubscriptions = new ChannelSubscriptions(client);
    this.liveActivity = new LiveActivity(client);
  }

  async publish(recipient: any, payload: any): Promise<void> {
    const client = this.client;
    const format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultPostHeaders(client.options),
      params = {};
    const body = Utils.mixin({ recipient: recipient }, payload);

    Utils.mixin(headers, client.options.headers);

    if (client.options.pushFullWait) Utils.mixin(params, { fullWait: 'true' });

    const requestBody = Utils.encodeBody(body, client._MsgPack, format);
    await Resource.post(client, '/push/publish', requestBody, headers, params, null, true);
  }

  async createApnsBroadcast(options: { messageStoragePolicy: 0 | 1 }): Promise<{ id: string; apnsChannelId: string }> {
    const client = this.client;
    const format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultPostHeaders(client.options),
      params = {};

    Utils.mixin(headers, client.options.headers);

    const requestBody = Utils.encodeBody(
      { messageStoragePolicy: options.messageStoragePolicy },
      client._MsgPack,
      format,
    );
    const response = await Resource.post(
      client,
      '/push/apnsBroadcastChannels',
      requestBody,
      headers,
      params,
      null,
      true,
    );

    return (response.unpacked ? response.body : Utils.decodeBody(response.body, client._MsgPack, format)) as {
      id: string;
      apnsChannelId: string;
    };
  }
}

class LiveActivity {
  client: BaseClient;

  constructor(client: BaseClient) {
    this.client = client;
  }

  async start(params: {
    recipient: { channels?: string[]; deviceId?: string };
    apnsBroadcast: string;
    apns: any;
    headers?: Record<string, string>;
  }): Promise<void> {
    const { recipient, apnsBroadcast, apns, headers } = params;

    const hasChannels = Array.isArray(recipient.channels) && recipient.channels.length > 0;
    const hasDeviceId = !!recipient.deviceId;
    if (hasChannels === hasDeviceId) {
      throw new ErrorInfo(
        'LiveActivity.start() requires exactly one of recipient.channels or recipient.deviceId',
        40000,
        400,
      );
    }

    const body: Record<string, any> = { apns };
    if (hasChannels) {
      body.channels = recipient.channels;
    }
    if (hasDeviceId) {
      body.deviceId = recipient.deviceId;
    }
    if (headers) {
      body.headers = headers;
    }
    await this._post(apnsBroadcast, 'start', body);
  }

  async update(params: { apnsBroadcast: string; apns: any; headers?: Record<string, string> }): Promise<void> {
    const { apnsBroadcast, apns, headers } = params;
    const body: Record<string, any> = { apns };
    if (headers) {
      body.headers = headers;
    }
    await this._post(apnsBroadcast, 'broadcast', body);
  }

  async end(params: { apnsBroadcast: string; apns: any; headers?: Record<string, string> }): Promise<void> {
    const { apnsBroadcast, apns, headers } = params;
    const body: Record<string, any> = { apns };
    if (headers) {
      body.headers = headers;
    }
    await this._post(apnsBroadcast, 'end', body);
  }

  private async _post(apnsBroadcast: string, action: string, body: Record<string, any>): Promise<void> {
    const client = this.client;
    const format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json;
    const requestHeaders = Defaults.defaultPostHeaders(client.options);
    const params = {};

    Utils.mixin(requestHeaders, client.options.headers);

    const requestBody = Utils.encodeBody(body, client._MsgPack, format);
    await Resource.post(
      client,
      '/push/apnsBroadcastChannels/' + encodeURIComponent(apnsBroadcast) + '/' + action,
      requestBody,
      requestHeaders,
      params,
      null,
      true,
    );
  }
}

class DeviceRegistrations {
  client: BaseClient;

  constructor(client: BaseClient) {
    this.client = client;
  }

  async save(device: any): Promise<DeviceDetails> {
    const client = this.client;
    const body = DeviceDetails.fromValues(device);
    const format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultPostHeaders(client.options),
      params = {};

    Utils.mixin(headers, client.options.headers);

    if (client.options.pushFullWait) Utils.mixin(params, { fullWait: 'true' });

    const requestBody = Utils.encodeBody(body, client._MsgPack, format);
    const response = await Resource.put(
      client,
      '/push/deviceRegistrations/' + encodeURIComponent(device.id),
      requestBody,
      headers,
      params,
      null,
      true,
    );

    return DeviceDetails.fromResponseBody(
      response.body as Record<string, unknown>,
      client._MsgPack,
      response.unpacked ? undefined : format,
    ) as DeviceDetails;
  }

  async get(deviceIdOrDetails: any): Promise<DeviceDetails> {
    const client = this.client,
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultGetHeaders(client.options),
      deviceId = deviceIdOrDetails.id || deviceIdOrDetails;

    if (typeof deviceId !== 'string' || !deviceId.length) {
      throw new ErrorInfo({
        message: 'First argument to DeviceRegistrations#get must be a deviceId string or DeviceDetails',
        code: 40000,
        statusCode: 400,
        remediation:
          'Pass either the device id string or a DeviceDetails object with a non-empty .id field. The local device id is available from client.device().id after push.activate() completes. Alternatively pass the .id of a DeviceDetails returned by push.admin.deviceRegistrations.save().',
      });
    }

    Utils.mixin(headers, client.options.headers);

    const response = await Resource.get(
      client,
      '/push/deviceRegistrations/' + encodeURIComponent(deviceId),
      headers,
      {},
      null,
      true,
    );

    return DeviceDetails.fromResponseBody(
      response.body as Record<string, unknown>,
      client._MsgPack,
      response.unpacked ? undefined : format,
    ) as DeviceDetails;
  }

  async list(params: any): Promise<PaginatedResult<unknown>> {
    const client = this.client,
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      envelope = this.client.http.supportsLinkHeaders ? undefined : format,
      headers = Defaults.defaultGetHeaders(client.options);

    Utils.mixin(headers, client.options.headers);

    return new PaginatedResource(client, '/push/deviceRegistrations', headers, envelope, async function (
      body,
      headers,
      unpacked,
    ) {
      return DeviceDetails.fromResponseBody(
        body as Record<string, unknown>[],
        client._MsgPack,
        unpacked ? undefined : format,
      );
    }).get(params);
  }

  async remove(deviceIdOrDetails: any): Promise<void> {
    const client = this.client,
      headers = Defaults.defaultGetHeaders(client.options),
      params = {},
      deviceId = deviceIdOrDetails.id || deviceIdOrDetails;

    if (typeof deviceId !== 'string' || !deviceId.length) {
      throw new ErrorInfo({
        message: 'First argument to DeviceRegistrations#remove must be a deviceId string or DeviceDetails',
        code: 40000,
        statusCode: 400,
        remediation:
          'Pass either the device id string or the DeviceDetails object (with a non-empty .id field). To deactivate the local device, call client.push.deactivate() instead.',
      });
    }

    Utils.mixin(headers, client.options.headers);

    if (client.options.pushFullWait) Utils.mixin(params, { fullWait: 'true' });

    await Resource['delete'](
      client,
      '/push/deviceRegistrations/' + encodeURIComponent(deviceId),
      headers,
      params,
      null,
      true,
    );
  }

  async removeWhere(params: any): Promise<void> {
    const client = this.client,
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultGetHeaders(client.options, { format });

    Utils.mixin(headers, client.options.headers);

    if (client.options.pushFullWait) Utils.mixin(params, { fullWait: 'true' });

    await Resource['delete'](client, '/push/deviceRegistrations', headers, params, null, true);
  }
}

class ChannelSubscriptions {
  client: BaseClient;

  constructor(client: BaseClient) {
    this.client = client;
  }

  async save(subscription: Record<string, unknown>): Promise<PushChannelSubscription> {
    const client = this.client;
    const body = PushChannelSubscription.fromValues(subscription);
    const format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultPostHeaders(client.options),
      params = {};

    Utils.mixin(headers, client.options.headers);

    if (client.options.pushFullWait) Utils.mixin(params, { fullWait: 'true' });

    const requestBody = Utils.encodeBody(body, client._MsgPack, format);
    const response = await Resource.post(
      client,
      '/push/channelSubscriptions',
      requestBody,
      headers,
      params,
      null,
      true,
    );

    return PushChannelSubscription.fromResponseBody(
      response.body as Record<string, any>,
      client._MsgPack,
      response.unpacked ? undefined : format,
    ) as PushChannelSubscription;
  }

  async list(params: any): Promise<PaginatedResult<unknown>> {
    const client = this.client,
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      envelope = this.client.http.supportsLinkHeaders ? undefined : format,
      headers = Defaults.defaultGetHeaders(client.options);

    Utils.mixin(headers, client.options.headers);

    return new PaginatedResource(client, '/push/channelSubscriptions', headers, envelope, async function (
      body,
      headers,
      unpacked,
    ) {
      return PushChannelSubscription.fromResponseBody(
        body as Record<string, unknown>[],
        client._MsgPack,
        unpacked ? undefined : format,
      );
    }).get(params);
  }

  async removeWhere(params: any): Promise<void> {
    const client = this.client,
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultGetHeaders(client.options, { format });

    Utils.mixin(headers, client.options.headers);

    if (client.options.pushFullWait) Utils.mixin(params, { fullWait: 'true' });

    await Resource['delete'](client, '/push/channelSubscriptions', headers, params, null, true);
  }

  /* ChannelSubscriptions have no unique id; removing one is equivalent to removeWhere by its properties */
  remove = ChannelSubscriptions.prototype.removeWhere;

  async listChannels(params: any): Promise<PaginatedResult<unknown>> {
    const client = this.client,
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      envelope = this.client.http.supportsLinkHeaders ? undefined : format,
      headers = Defaults.defaultGetHeaders(client.options);

    Utils.mixin(headers, client.options.headers);

    if (client.options.pushFullWait) Utils.mixin(params, { fullWait: 'true' });

    return new PaginatedResource(client, '/push/channels', headers, envelope, async function (body, headers, unpacked) {
      const parsedBody = (
        !unpacked && format ? Utils.decodeBody(body, client._MsgPack, format) : body
      ) as Array<string>;

      for (let i = 0; i < parsedBody.length; i++) {
        parsedBody[i] = String(parsedBody[i]);
      }
      return parsedBody;
    }).get(params);
  }
}

export default Push;
