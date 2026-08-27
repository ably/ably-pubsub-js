import * as API from '../../../ably';
import { IPlatformPushConfig } from 'common/types/IPlatformConfig';
import { ulid } from 'ulid';
import type { ErrCallback, StandardCallback } from 'common/types/utils';
import type ErrorInfo from 'common/lib/types/errorinfo';
import DeviceDetails, { DevicePlatform, DevicePushDetails } from 'common/lib/types/devicedetails';
import type PushChannelSubscription from 'common/lib/types/pushchannelsubscription';
import { getW3CPushDeviceDetails } from './getW3CDeviceDetails';
import type BaseClient from 'common/lib/client/baseclient';
import type { PaginatedResult } from 'common/lib/client/paginatedresource';

// Keep this byte-identical to the copy in src/common/lib/client/push.ts. This plugin only
// type-imports from common client modules, so a value import from there is not viable for the build.
const PUSH_ACTIVATION_NOT_AVAILABLE_HINT =
  'Run push.activate() in a browser environment with service worker support, or in React Native using the ably/react-native-push plugin. From a server, use client.push.admin instead. Call client.push.admin.publish(recipient, payload) to send to a device or clientId. Call client.push.admin.deviceRegistrations.save(device) to register a device record.';

const persistKeys = {
  deviceId: 'ably.push.deviceId',
  deviceSecret: 'ably.push.deviceSecret',
  deviceIdentityToken: 'ably.push.deviceIdentityToken',
  pushRecipient: 'ably.push.pushRecipient',
  activationState: 'ably.push.activationState',
};

type DeviceRegistration = Required<{
  [K in keyof DeviceDetails]: K extends 'deviceIdentityToken' ? API.TokenDetails : DeviceDetails[K];
}>;

export type RegisterCallback = (device: DeviceDetails, callback: StandardCallback<DeviceRegistration>) => void;
export type DeregisterCallback = (device: DeviceDetails, callback: StandardCallback<string>) => void;

export interface LocalDeviceAuthDetails {
  headers: Record<string, string>;
  params: Record<string, unknown>;
}

export type LocalDeviceFactory = ReturnType<typeof localDeviceFactory>;
export type LocalDevice = ReturnType<LocalDeviceFactory['load']>;

/**
 * Push storage writes may be asynchronous (e.g. React Native's AsyncStorage). Several write sites
 * sit inside synchronous state-machine code and cannot await the result, so a logging rejection
 * handler is pre-attached: ignoring the returned promise never causes an unhandled rejection. The
 * returned promise itself still rejects, so asynchronous callers that await persistence observe
 * the failure.
 */
function loggedStorageWrites(client: BaseClient, op: string, writes: (void | Promise<void>)[]): void | Promise<void> {
  const promises = writes.filter((result): result is Promise<void> => !!result && typeof result.then === 'function');
  if (promises.length === 0) {
    return;
  }
  const allWritten = Promise.all(promises).then(() => {});
  allWritten.catch((err) => {
    client.Logger.logAction(
      client.logger,
      client.Logger.LOG_ERROR,
      'Push.' + op,
      'failed to persist push state to storage: ' + client.Utils.inspectError(err),
    );
  });
  return allWritten;
}

/**
 * LocalDevice extends DeviceDetails, but DeviceDetails is part of core ably-js and LocalDevice is part of the Push plugin
 * In order to avoid bundling the DeviceDetails class in both core ably-js and the plugin, the LocalDevice is exported as
 * a factory, and the DeviceDetails constructor is used to create the class declaration for LocalDevice when the plugin is
 * loaded.
 */
export function localDeviceFactory(deviceDetails: typeof DeviceDetails) {
  return class LocalDevice extends deviceDetails {
    // guaranteed to be set in the .loadPersisted() method
    declare id: string;
    declare deviceSecret: string;

    rest: BaseClient;
    push: DevicePushDetails;

    private constructor(rest: BaseClient) {
      super();
      this.push = {};
      this.rest = rest;
    }

    static load(rest: BaseClient) {
      const device = new LocalDevice(rest);
      device.loadPersisted();
      return device;
    }

    static async loadAsync(rest: BaseClient) {
      const device = new LocalDevice(rest);
      await device.loadPersistedAsync();
      return device;
    }

    async listSubscriptions(): Promise<PaginatedResult<PushChannelSubscription>> {
      if (!this.rest.pushConfig) {
        throw new this.rest.ErrorInfo({
          message:
            'Push activation is not available on this platform: it requires a browser environment with service worker support, or a React Native environment with the ably/react-native-push plugin',
          code: 40000,
          statusCode: 400,
          remediation: PUSH_ACTIVATION_NOT_AVAILABLE_HINT,
        });
      }

      if (!this.id) {
        throw new this.rest.ErrorInfo({
          message: 'Device not activated',
          code: 40000,
          statusCode: 400,
          remediation: 'Call client.push.activate() and await its completion before listing subscriptions.',
        });
      }

      if (!this.deviceIdentityToken) {
        throw new this.rest.ErrorInfo('Cannot list device subscriptions without deviceIdentityToken', 50000, 500);
      }

      const client = this.rest,
        format = client.options.useBinaryProtocol ? client.Utils.Format.msgpack : client.Utils.Format.json,
        envelope = client.http.supportsLinkHeaders ? undefined : format,
        headers = client.Defaults.defaultGetHeaders(client.options);

      client.Utils.mixin(headers, client.options.headers, { 'X-Ably-DeviceToken': this.deviceIdentityToken });

      return new client.rest.PaginatedResource(client, '/push/channelSubscriptions', headers, envelope, async function (
        body,
        headers,
        unpacked,
      ) {
        return client.rest.PushChannelSubscription.fromResponseBody(
          body as Record<string, unknown>[],
          client._MsgPack,
          unpacked ? undefined : format,
        );
      }).get({ deviceId: this.id });
    }

    // keep in sync with loadPersistedAsync()
    loadPersisted() {
      const pushConfig = this.rest.pushConfig;
      if (!pushConfig) {
        throw new this.rest.ErrorInfo({
          message:
            'Push activation is not available on this platform: it requires a browser environment with service worker support, or a React Native environment with the ably/react-native-push plugin',
          code: 40000,
          statusCode: 400,
          remediation: PUSH_ACTIVATION_NOT_AVAILABLE_HINT,
        });
      }
      if (pushConfig.storageIsAsync) {
        throw new this.rest.ErrorInfo({
          message: 'The local device cannot be loaded synchronously: push storage on this platform is asynchronous',
          code: 40000,
          statusCode: 400,
          remediation:
            'Use await client.getDevice() instead of client.device(). device() reads storage synchronously and is deprecated.',
        });
      }
      this.platform = pushConfig.platform;
      this.clientId = this.rest.auth.clientId ?? undefined;
      this.formFactor = pushConfig.formFactor;
      // this path is only reachable with synchronous storage (async storage implies storageIsAsync,
      // which routes callers to getDevice() and the async load path), so the reads are cast to string
      this.id = pushConfig.storage.get(persistKeys.deviceId) as string;

      if (this.id) {
        this.deviceSecret = pushConfig.storage.get(persistKeys.deviceSecret) as string;
        this.deviceIdentityToken = JSON.parse(
          (pushConfig.storage.get(persistKeys.deviceIdentityToken) as string) || 'null',
        );
        this.push.recipient = JSON.parse((pushConfig.storage.get(persistKeys.pushRecipient) as string) || 'null');
      } else {
        this.resetId();
      }
    }

    // keep in sync with loadPersisted(); awaiting a non-promise is a no-op, so this single
    // implementation serves both synchronous (web) and asynchronous (React Native) storage
    async loadPersistedAsync() {
      const pushConfig = this.rest.pushConfig;
      if (!pushConfig) {
        throw new this.rest.ErrorInfo({
          message:
            'Push activation is not available on this platform: it requires a browser environment with service worker support, or a React Native environment with the ably/react-native-push plugin',
          code: 40000,
          statusCode: 400,
          remediation: PUSH_ACTIVATION_NOT_AVAILABLE_HINT,
        });
      }
      this.platform = pushConfig.platform;
      this.clientId = this.rest.auth.clientId ?? undefined;
      this.formFactor = pushConfig.formFactor;
      this.id = ((await pushConfig.storage.get(persistKeys.deviceId)) ?? undefined) as string;

      if (this.id) {
        this.deviceSecret = ((await pushConfig.storage.get(persistKeys.deviceSecret)) ?? undefined) as string;
        this.deviceIdentityToken = JSON.parse(
          (await pushConfig.storage.get(persistKeys.deviceIdentityToken)) || 'null',
        );
        this.push.recipient = JSON.parse((await pushConfig.storage.get(persistKeys.pushRecipient)) || 'null');
      } else {
        await this.resetId();
      }
    }

    persist(): void | Promise<void> {
      const pushConfig = this.rest.pushConfig;
      if (!pushConfig) {
        throw new this.rest.ErrorInfo({
          message:
            'Push activation is not available on this platform: it requires a browser environment with service worker support, or a React Native environment with the ably/react-native-push plugin',
          code: 40000,
          statusCode: 400,
          remediation: PUSH_ACTIVATION_NOT_AVAILABLE_HINT,
        });
      }
      const writes: (void | Promise<void>)[] = [];
      if (this.id) {
        writes.push(pushConfig.storage.set(persistKeys.deviceId, this.id));
      }
      if (this.deviceSecret) {
        writes.push(pushConfig.storage.set(persistKeys.deviceSecret, this.deviceSecret));
      }
      if (this.deviceIdentityToken) {
        writes.push(pushConfig.storage.set(persistKeys.deviceIdentityToken, JSON.stringify(this.deviceIdentityToken)));
      }
      if (this.push.recipient) {
        writes.push(pushConfig.storage.set(persistKeys.pushRecipient, JSON.stringify(this.push.recipient)));
      }
      return loggedStorageWrites(this.rest, 'LocalDevice.persist()', writes);
    }

    resetId(): void | Promise<void> {
      this.id = ulid();
      this.deviceSecret = ulid();
      return this.persist();
    }

    getAuthDetails(
      rest: BaseClient,
      headers: Record<string, string>,
      params: Record<string, unknown>,
    ): LocalDeviceAuthDetails {
      if (!this.deviceIdentityToken) {
        throw new this.rest.ErrorInfo('Unable to update device registration; no deviceIdentityToken', 50000, 500);
      }
      if (this.rest.http.supportsAuthHeaders) {
        return {
          headers: rest.Utils.mixin(
            { authorization: 'Bearer ' + rest.Utils.toBase64(this.deviceIdentityToken) },
            headers,
          ) as Record<string, string>,
          params,
        };
      } else {
        return { headers, params: rest.Utils.mixin({ access_token: this.deviceIdentityToken }, params) };
      }
    }
  };
}

export class ActivationStateMachine {
  client: BaseClient;
  // set in the constructor with synchronous storage, or by ensureInitialized() with asynchronous storage
  current!: ActivationState;
  private _initPromise?: Promise<void>;
  // serializes asynchronous activation-state writes; see persist()
  private _activationStateWrite: Promise<void> = Promise.resolve();
  pendingEvents: ActivationEvent[];
  handling: boolean;
  deactivatedCallback?: ErrCallback;
  activatedCallback?: ErrCallback;
  _pushConfig?: IPlatformPushConfig;
  registerCallback?: RegisterCallback;
  deregisterCallback?: DeregisterCallback;
  updateFailedCallback?: ErrCallback;

  // Used for testing
  _pushManager?: PushManager;

  // exported for testing
  GettingPushDeviceDetailsFailed = GettingPushDeviceDetailsFailed;
  GotPushDeviceDetails = GotPushDeviceDetails;

  constructor(rest: BaseClient) {
    this.client = rest;
    this._pushConfig = rest.pushConfig;
    if (!this._pushConfig?.storageIsAsync) {
      // synchronous storage: resolve the persisted activation state immediately. With
      // asynchronous storage the state is resolved by ensureInitialized() instead.
      this.current = new ActivationStates[
        (this.pushConfig.storage.get(persistKeys.activationState) as string as ActivationStateName) || 'NotActivated'
      ](null);
    }
    this.pendingEvents = [];
    this.handling = false;
  }

  /**
   * Resolves the persisted activation state when storage is asynchronous. Must be awaited
   * before the first handleEvent() call; a no-op with synchronous storage, where the
   * constructor has already resolved the state.
   */
  async ensureInitialized(): Promise<void> {
    if (this.current) {
      return;
    }
    this._initPromise ??= (async () => {
      try {
        const persistedName = (await this.pushConfig.storage.get(persistKeys.activationState)) as string | null;
        this.current = new ActivationStates[(persistedName as ActivationStateName) || 'NotActivated'](null);
      } catch (err) {
        // drop the failed read so a later activation attempt can retry after a transient storage failure
        this._initPromise = undefined;
        throw err;
      }
    })();
    return this._initPromise;
  }

  get pushConfig() {
    if (!this._pushConfig) {
      throw new this.client.ErrorInfo({
        message:
          'This platform is not supported as a target of push notifications: push activation requires a browser environment with service worker support, or a React Native environment with the ably/react-native-push plugin',
        code: 40000,
        statusCode: 400,
        remediation: PUSH_ACTIVATION_NOT_AVAILABLE_HINT,
      });
    }
    return this._pushConfig;
  }

  persist() {
    if (!(this.current && isPersistentState(this.current))) {
      return;
    }
    const name = this.current.name;
    if (this.pushConfig.storageIsAsync) {
      // chain asynchronous writes so an earlier slow write cannot complete after a later
      // transition and restore stale activation state. Failures are logged by
      // loggedStorageWrites; the queue swallows them so subsequent writes still run.
      this._activationStateWrite = this._activationStateWrite
        .then(() =>
          loggedStorageWrites(this.client, 'ActivationStateMachine.persist()', [
            this.pushConfig.storage.set(persistKeys.activationState, name),
          ]),
        )
        .catch(() => {});
    } else {
      loggedStorageWrites(this.client, 'ActivationStateMachine.persist()', [
        this.pushConfig.storage.set(persistKeys.activationState, name),
      ]);
    }
  }

  callUpdateRegistrationFailedCallback(reason: ErrorInfo) {
    if (this.updateFailedCallback) {
      this.updateFailedCallback(reason);
    } else {
      this.client.Logger.logAction(
        this.client.logger,
        this.client.Logger.LOG_ERROR,
        'UpdateRegistrationFailed',
        'Failed updating device push registration: ' + this.client.Utils.inspectError(reason),
      );
    }
  }

  callCustomRegisterer(device: LocalDevice, isNew: boolean) {
    this.registerCallback?.(device, (error: ErrorInfo, deviceRegistration?: DeviceRegistration) => {
      if (error) {
        if (isNew) {
          this.handleEvent(new GettingDeviceRegistrationFailed(error));
        } else {
          this.handleEvent(new SyncRegistrationFailed(error));
        }
        return;
      }

      if (!deviceRegistration) {
        const err = new this.client.ErrorInfo({
          message: 'registerCallback did not return deviceRegistration',
          code: 40000,
          statusCode: 400,
          remediation: 'Your registerCallback must invoke its callback with (null, deviceRegistration).',
        });
        this.handleEvent(new GettingDeviceRegistrationFailed(err));
        return;
      }

      if (isNew) {
        this.handleEvent(new GotDeviceRegistration(deviceRegistration as any));
      } else {
        this.handleEvent(new RegistrationSynced());
      }
    });
  }

  callCustomDeregisterer(device: LocalDevice) {
    this.deregisterCallback?.(device, (err: ErrorInfo) => {
      if (err) {
        this.handleEvent(new DeregistrationFailed(err));
        return;
      }
      this.handleEvent(new Deregistered());
    });
  }

  async updateRegistration() {
    const localDevice = await this.client.getDevice();
    if (this.registerCallback) {
      this.callCustomRegisterer(localDevice, false);
    } else {
      const client = this.client;
      const format = client.options.useBinaryProtocol
          ? this.client.Utils.Format.msgpack
          : this.client.Utils.Format.json,
        body = { push: { recipient: localDevice.push.recipient } },
        headers = this.client.Defaults.defaultPostHeaders(this.client.options, { format }),
        params = {};

      if (client.options.headers) {
        this.client.Utils.mixin(headers, client.options.headers);
      }

      if (client.options.pushFullWait) {
        this.client.Utils.mixin(params, { fullWait: 'true' });
      }

      const requestBody = this.client.Utils.encodeBody(body, client._MsgPack, format);
      const authDetails = localDevice.getAuthDetails(client, headers, params);
      try {
        await this.client.rest.Resource.patch(
          client,
          '/push/deviceRegistrations/' + encodeURIComponent(localDevice.id),
          requestBody,
          authDetails.headers,
          authDetails.params,
          format,
          true,
        );
        this.handleEvent(new RegistrationSynced());
      } catch (err) {
        this.handleEvent(new SyncRegistrationFailed(err as ErrorInfo));
      }
    }
  }

  async deregister() {
    const device = await this.client.getDevice();
    if (this.deregisterCallback) {
      this.callCustomDeregisterer(device);
    } else {
      const rest = this.client;
      const format = rest.options.useBinaryProtocol ? this.client.Utils.Format.msgpack : this.client.Utils.Format.json,
        headers = this.client.Defaults.defaultPostHeaders(rest.options),
        params = { deviceId: device.id };

      if (rest.options.headers) this.client.Utils.mixin(headers, rest.options.headers);

      const authDetails = device.getAuthDetails(this.client, headers, params);

      if (rest.options.pushFullWait) this.client.Utils.mixin(params, { fullWait: 'true' });

      try {
        await this.client.rest.Resource.delete(
          rest,
          '/push/deviceRegistrations',
          authDetails.headers,
          authDetails.params,
          format,
          true,
        );
        this.handleEvent(new Deregistered());
      } catch (err) {
        this.handleEvent(new DeregistrationFailed(err as ErrorInfo));
      }
    }
  }

  callActivatedCallback(err: ErrorInfo | null) {
    this.activatedCallback?.(err);
    delete this.activatedCallback;
  }

  callDeactivatedCallback(err: ErrorInfo | null) {
    this.deactivatedCallback?.(err);
    delete this.deactivatedCallback;
  }

  handleEvent(event: ActivationEvent) {
    if (this.handling) {
      this.client.Platform.Config.nextTick(() => {
        this.handleEvent(event);
      });
      return;
    }

    this.handling = true;
    this.client.Logger.logAction(
      this.client.logger,
      this.client.Logger.LOG_MAJOR,
      'Push.ActivationStateMachine.handleEvent()',
      'handling event ' + event.name + ' from ' + this.current.name,
    );

    let maybeNext = this.current.processEvent(this, event);
    if (!maybeNext) {
      this.client.Logger.logAction(
        this.client.logger,
        this.client.Logger.LOG_MAJOR,
        'Push.ActivationStateMachine.handleEvent()',
        'enqueing event: ' + event.name,
      );
      this.pendingEvents.push(event);
      this.handling = false;
      return;
    }

    this.client.Logger.logAction(
      this.client.logger,
      this.client.Logger.LOG_MAJOR,
      'Push.ActivationStateMachine.handleEvent()',
      'transition: ' + this.current.name + ' -(' + event.name + ')-> ' + maybeNext.name,
    );
    this.current = maybeNext;

    while (this.pendingEvents.length > 0) {
      const pending = this.pendingEvents[0];

      this.client.Logger.logAction(
        this.client.logger,
        this.client.Logger.LOG_MAJOR,
        'Push.ActivationStateMachine.handleEvent()',
        'attempting to consume pending event: ' + pending.name,
      );

      maybeNext = this.current.processEvent(this, pending);
      if (!maybeNext) {
        break;
      }
      this.pendingEvents.splice(0, 1);

      this.client.Logger.logAction(
        this.client.logger,
        this.client.Logger.LOG_MAJOR,
        'Push.ActivationStateMachine.handleEvent()',
        'transition: ' + this.current.name + ' -(' + pending.name + ')-> ' + maybeNext.name,
      );
      this.current = maybeNext;
    }

    this.persist();
    this.handling = false;
  }
}

// Events
export class CalledActivate {
  name = 'CalledActivate';

  constructor(machine: ActivationStateMachine, registerCallback?: RegisterCallback) {
    if (registerCallback) {
      machine.registerCallback = registerCallback;
    }
    machine.persist();
  }
}

export class CalledDeactivate {
  name = 'CalledDeactivate';

  constructor(machine: ActivationStateMachine, deregisterCallback?: DeregisterCallback) {
    machine.deregisterCallback = deregisterCallback;
    machine.persist();
  }
}

export class GotPushDeviceDetails {
  name = 'GotPushDeviceDetails';
}

export class GettingPushDeviceDetailsFailed {
  name = 'GettingPushDeviceDetailsFailed';
  reason: ErrorInfo;

  constructor(reason: ErrorInfo) {
    this.reason = reason;
  }
}

class GotDeviceRegistration {
  name = 'GotDeviceRegistration';
  tokenDetails: API.TokenDetails;

  constructor(deviceRegistration: DeviceRegistration) {
    this.tokenDetails = deviceRegistration.deviceIdentityToken;
  }
}

class GettingDeviceRegistrationFailed {
  name = 'GettingDeviceRegistrationFailed';
  reason: ErrorInfo;
  constructor(reason: ErrorInfo) {
    this.reason = reason;
  }
}

class RegistrationSynced {
  name = 'RegistrationSynced';
}

class SyncRegistrationFailed {
  name = 'SyncRegistrationFailed';
  reason: ErrorInfo;

  constructor(reason: ErrorInfo) {
    this.reason = reason;
  }
}

class Deregistered {
  name = 'Deregistered';
}

class DeregistrationFailed {
  name = 'DeregistrationFailed';
  reason: ErrorInfo;
  constructor(reason: ErrorInfo) {
    this.reason = reason;
  }
}

type ActivationEvent =
  | CalledActivate
  | CalledDeactivate
  | GotPushDeviceDetails
  | GettingPushDeviceDetailsFailed
  | GotDeviceRegistration
  | GettingDeviceRegistrationFailed
  | RegistrationSynced
  | SyncRegistrationFailed
  | Deregistered
  | DeregistrationFailed;

// States
//
// Invariant: processEvent() implementations are synchronous and read the local device via the
// synchronous machine.client.device(). This relies on Push.activate()/deactivate() pre-hydrating
// the device (await client.getDevice()) and the machine state (await ensureInitialized()) before
// dispatching any event. Never add a device() call reachable before that hydration has happened.
abstract class ActivationState {
  name: ActivationStateName;

  constructor(name: ActivationStateName) {
    this.name = name;
  }

  abstract processEvent(machine: ActivationStateMachine, event: ActivationEvent): ActivationState | null;
}

class NotActivated extends ActivationState {
  constructor() {
    super('NotActivated');
  }

  processEvent(machine: ActivationStateMachine, event: ActivationEvent): ActivationState | null {
    if (event instanceof CalledDeactivate) {
      machine.callDeactivatedCallback(null);
      return new NotActivated();
    } else if (event instanceof CalledActivate) {
      const device = machine.client.device();

      if (device.deviceIdentityToken != null) {
        if (device.clientId && device.clientId !== machine.client.auth.clientId) {
          machine.handleEvent(
            new SyncRegistrationFailed(
              new machine.client.ErrorInfo('clientId not compatible with local device clientId', 61002, 400),
            ),
          );
          return null;
        }
        // Already registered.
        machine.pendingEvents.push(event);
        return new WaitingForNewPushDeviceDetails();
      }

      if (device.push.recipient) {
        machine.pendingEvents.push(new GotPushDeviceDetails());
      } else if (machine.pushConfig.getPushDeviceDetails) {
        machine.pushConfig.getPushDeviceDetails?.(machine);
      } else if (machine.pushConfig.platform === DevicePlatform.Browser) {
        getW3CPushDeviceDetails(machine);
      } else {
        machine.handleEvent(
          new GettingPushDeviceDetailsFailed(
            new machine.client.ErrorInfo('No available implementation to get push device details', 50000, 500),
          ),
        );
      }

      return new WaitingForPushDeviceDetails();
    } else if (event instanceof GotPushDeviceDetails) {
      return new NotActivated();
    }
    return null;
  }
}

class WaitingForPushDeviceDetails extends ActivationState {
  constructor() {
    super('WaitingForPushDeviceDetails');
  }

  processEvent(machine: ActivationStateMachine, event: ActivationEvent) {
    if (event instanceof CalledActivate) {
      return new WaitingForPushDeviceDetails();
    } else if (event instanceof CalledDeactivate) {
      machine.callDeactivatedCallback(null);
      return new NotActivated();
    } else if (event instanceof GotPushDeviceDetails) {
      const client = machine.client;
      const device = client.device();

      if (machine.registerCallback) {
        machine.callCustomRegisterer(device, true);
      } else {
        const format = client.options.useBinaryProtocol
            ? machine.client.Utils.Format.msgpack
            : machine.client.Utils.Format.json,
          body = client.rest.DeviceDetails.fromLocalDevice(device),
          headers = machine.client.Defaults.defaultPostHeaders(client.options, { format }),
          params = {};

        if (client.options.headers) machine.client.Utils.mixin(headers, client.options.headers);

        if (client.options.pushFullWait) machine.client.Utils.mixin(params, { fullWait: 'true' });

        const requestBody = machine.client.Utils.encodeBody(body, client._MsgPack, format);

        machine.client.rest.Resource.post(client, '/push/deviceRegistrations', requestBody, headers, params, null, true)
          .then((response) => {
            const deviceDetails = response.unpacked
              ? response.body
              : client.rest.DeviceDetails.fromResponseBody(response.body as any, client._MsgPack, format);
            machine.handleEvent(new GotDeviceRegistration(deviceDetails as DeviceRegistration));
          })
          .catch((err) => {
            machine.handleEvent(new GettingDeviceRegistrationFailed(err as ErrorInfo));
          });
      }

      return new WaitingForDeviceRegistration();
    } else if (event instanceof GettingPushDeviceDetailsFailed) {
      machine.callActivatedCallback(event.reason);
      return new NotActivated();
    }
    return null;
  }
}

class WaitingForDeviceRegistration extends ActivationState {
  constructor() {
    super('WaitingForDeviceRegistration');
  }

  processEvent(machine: ActivationStateMachine, event: ActivationEvent) {
    if (event instanceof CalledActivate) {
      return new WaitingForDeviceRegistration();
    } else if (event instanceof GotDeviceRegistration) {
      const device = machine.client.device();
      device.deviceIdentityToken = event.tokenDetails.token;
      device.persist();
      machine.callActivatedCallback(null);
      return new WaitingForNewPushDeviceDetails();
    } else if (event instanceof GettingDeviceRegistrationFailed) {
      machine.callActivatedCallback(event.reason);
      return new NotActivated();
    }
    return null;
  }
}

class WaitingForNewPushDeviceDetails extends ActivationState {
  constructor() {
    super('WaitingForNewPushDeviceDetails');
  }

  processEvent(machine: ActivationStateMachine, event: ActivationEvent) {
    if (event instanceof CalledActivate) {
      machine.callActivatedCallback(null);
      return new WaitingForNewPushDeviceDetails();
    } else if (event instanceof CalledDeactivate) {
      machine.deregister();
      return new WaitingForDeregistration(this);
    } else if (event instanceof GotPushDeviceDetails) {
      machine.updateRegistration();
      return new WaitingForRegistrationSync();
    }
    return null;
  }
}

class WaitingForRegistrationSync extends ActivationState {
  triggeredByCalledActivate: boolean | null;

  constructor(triggeredByCalledActivate: boolean | null = false) {
    super('WaitingForRegistrationSync');
    this.triggeredByCalledActivate = triggeredByCalledActivate;
  }

  processEvent(machine: ActivationStateMachine, event: ActivationEvent) {
    if (event instanceof CalledActivate && !this.triggeredByCalledActivate) {
      machine.callActivatedCallback(null);
      return new WaitingForRegistrationSync(true);
    } else if (event instanceof RegistrationSynced) {
      return new WaitingForNewPushDeviceDetails();
    } else if (event instanceof SyncRegistrationFailed) {
      machine.callUpdateRegistrationFailedCallback(event.reason);
      return new AfterRegistrationSyncFailed();
    }
    return null;
  }
}

class AfterRegistrationSyncFailed extends ActivationState {
  constructor() {
    super('AfterRegistrationSyncFailed');
  }

  processEvent(machine: ActivationStateMachine, event: ActivationEvent) {
    if (event instanceof CalledActivate || event instanceof GotPushDeviceDetails) {
      machine.updateRegistration();
      return new WaitingForRegistrationSync(event instanceof CalledActivate);
    } else if (event instanceof CalledDeactivate) {
      machine.deregister();
      return new WaitingForDeregistration(this);
    }
    return null;
  }
}

class WaitingForDeregistration extends ActivationState {
  previousState: ActivationState | null;

  constructor(previousState: ActivationState | null) {
    super('WaitingForDeregistration');
    this.previousState = previousState;
  }

  processEvent(machine: ActivationStateMachine, event: ActivationEvent): ActivationState | null {
    if (event instanceof CalledDeactivate) {
      return new WaitingForDeregistration(this.previousState);
    } else if (event instanceof Deregistered) {
      const device = machine.client.device();
      delete device.deviceIdentityToken;
      delete device.push.recipient;
      loggedStorageWrites(machine.client, 'WaitingForDeregistration.processEvent()', [
        machine.pushConfig.storage.remove(persistKeys.deviceIdentityToken),
        machine.pushConfig.storage.remove(persistKeys.pushRecipient),
      ]);
      device.resetId();
      machine.callDeactivatedCallback(null);
      return new NotActivated();
    } else if (event instanceof DeregistrationFailed) {
      machine.callDeactivatedCallback(event.reason);
      return this.previousState;
    }
    return null;
  }
}

type ActivationStateName =
  | 'NotActivated'
  | 'WaitingForPushDeviceDetails'
  | 'WaitingForDeviceRegistration'
  | 'WaitingForNewPushDeviceDetails'
  | 'WaitingForRegistrationSync'
  | 'AfterRegistrationSyncFailed'
  | 'WaitingForDeregistration';

export const ActivationStates = {
  NotActivated,
  WaitingForPushDeviceDetails,
  WaitingForDeviceRegistration,
  WaitingForNewPushDeviceDetails,
  WaitingForRegistrationSync,
  AfterRegistrationSyncFailed,
  WaitingForDeregistration,
};

function isPersistentState(state: ActivationState) {
  return state.name == 'NotActivated' || state.name == 'WaitingForNewPushDeviceDetails';
}
