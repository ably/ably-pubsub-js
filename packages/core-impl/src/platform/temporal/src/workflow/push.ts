import type * as Ably from '@ably/pubsub-core/api';
import { ActivityNames } from '../common/activities.js';
import { deviceIdArgument, requireObject } from './arguments.js';
import type { ActivityInvoker } from './invoker.js';
import { paginate, pageSummary, type TemporalAblyPaginatedResult } from './paginated.js';

/**
 * Push notifications from workflow code. It mirrors the push functionality of the Ably HTTP client that does not
 * need a device, and is obtained from `TemporalAblyRest.push`.
 */
export class TemporalAblyRestPush {
  /** Manages device registrations and channel subscriptions, and publishes push notifications. */
  readonly admin: TemporalAblyRestPushAdmin;

  /** @internal */
  constructor(invoker: ActivityInvoker) {
    this.admin = new TemporalAblyRestPushAdmin(invoker);
  }
}

/**
 * Manages device registrations and channel subscriptions, and publishes push notifications, from workflow code. It
 * mirrors the Ably `PushAdmin`, and is obtained from `TemporalAblyRest.push.admin`.
 *
 * Each method runs as a Temporal activity with the retry policy in `TemporalAblyRestOptions`. Ably does not deduplicate
 * the calls that send a notification or create an APNs broadcast channel, so a retry of `publish()`,
 * `createApnsBroadcast()`, `liveActivity.start()` or `liveActivity.update()` repeats the call. To run them with a
 * single attempt, call them from a separate `TemporalAblyRest` whose retry policy sets `maximumAttempts` to 1. Within an
 * attempt, the worker's Ably client can still send the request again to a fallback host after a timeout, a
 * connection error or a 500 to 504 response.
 */
export class TemporalAblyRestPushAdmin {
  /** Registers, retrieves and removes the devices that receive push notifications. */
  readonly deviceRegistrations: TemporalAblyRestPushDeviceRegistrations;
  /** Subscribes devices and clients to push notifications on channels, and retrieves and removes subscriptions. */
  readonly channelSubscriptions: TemporalAblyRestPushChannelSubscriptions;
  /**
   * Controls the lifecycle of iOS Live Activities over an APNs broadcast channel created with
   * {@link TemporalAblyRestPushAdmin.createApnsBroadcast}.
   *
   * @experimental This is a preview feature of Ably and may change in a future non-major release.
   */
  readonly liveActivity: TemporalAblyRestPushLiveActivity;

  /** @internal */
  constructor(private readonly invoker: ActivityInvoker) {
    this.deviceRegistrations = new TemporalAblyRestPushDeviceRegistrations(invoker);
    this.channelSubscriptions = new TemporalAblyRestPushChannelSubscriptions(invoker);
    this.liveActivity = new TemporalAblyRestPushLiveActivity(invoker);
  }

  /**
   * Sends a push notification directly to a device, or a group of devices sharing the same `clientId`. Runs as a
   * Temporal activity. A retry sends the notification again, so include an ID in the payload's `data` if the app
   * needs to drop a duplicate.
   *
   * @param recipient - The recipient details, using `clientId`, `deviceId` or the underlying notifications service.
   * @param payload - The push notification payload.
   * @returns A promise which is fulfilled when Ably has accepted the notification.
   */
  async publish(recipient: any, payload: any): Promise<void> {
    requireObject('push.admin.publish', 'recipient', recipient, PUBLISH_REMEDIATION);
    requireObject('push.admin.publish', 'payload', payload, PUBLISH_REMEDIATION);
    await this.invoker.invoke(ActivityNames.pushPublish, 'push.admin.publish', { recipient, payload });
  }

  /**
   * Creates an APNs broadcast channel for use with an iOS Live Activity. Runs as a Temporal activity. A retry creates
   * another broadcast channel, and Ably has no call to list or delete a channel that an earlier attempt created.
   *
   * @experimental This is a preview feature of Ably and may change in a future non-major release.
   *
   * @param options - Options for the broadcast, including the `messageStoragePolicy`.
   * @returns A promise which is fulfilled with the broadcast `{ id, apnsChannelId }`.
   */
  async createApnsBroadcast(options: Ably.PushApnsBroadcastOptions): Promise<Ably.PushApnsBroadcast> {
    requireObject(
      'push.admin.createApnsBroadcast',
      'options',
      options,
      'Pass an options object with a messageStoragePolicy of 0 or 1, e.g. { messageStoragePolicy: 1 }.',
    );
    return this.invoker.invoke(ActivityNames.pushCreateApnsBroadcast, 'push.admin.createApnsBroadcast', {
      argument: options,
    });
  }
}

const PUBLISH_REMEDIATION =
  'Pass the recipient and the payload as objects, e.g. publish({ clientId: "user-1" }, { notification: { title: "Hello" } }).';

const LIVE_ACTIVITY_REMEDIATION =
  'Pass a params object with the apnsBroadcast id returned by createApnsBroadcast() and an apns payload.';

/**
 * Controls the lifecycle of iOS Live Activities from workflow code. It mirrors the Ably `PushLiveActivity`, and is
 * obtained from `TemporalAblyRest.push.admin.liveActivity`.
 *
 * Each method runs as a Temporal activity with the retry policy in `TemporalAblyRestOptions`.
 *
 * @experimental This is a preview feature of Ably and may change in a future non-major release.
 */
export class TemporalAblyRestPushLiveActivity {
  /** @internal */
  constructor(private readonly invoker: ActivityInvoker) {}

  /**
   * Sends a push-to-start notification to the devices subscribed to the given channels, or to a single device. A
   * retry sends the notification again, and each device shows a second Live Activity.
   *
   * @param params - The recipient, the broadcast `id`, and an APNs Live Activity start payload.
   * @returns A promise which is fulfilled when Ably has accepted the notification.
   */
  async start(params: Ably.PushLiveActivityStartParams): Promise<void> {
    requireObject('push.admin.liveActivity.start', 'params', params, LIVE_ACTIVITY_REMEDIATION);
    requireObject(
      'push.admin.liveActivity.start',
      'params.recipient',
      params.recipient,
      'Set params.recipient to { channels: [...] } or { deviceId: "..." }.',
    );
    await this.invoker.invoke(ActivityNames.pushLiveActivityStart, 'push.admin.liveActivity.start', {
      argument: params,
    });
  }

  /**
   * Sends a `content-state` update to all devices with an active Live Activity on the broadcast channel. Neither
   * Ably nor APNs deduplicates the update, so a retry sends it again. If the workflow sets `aps.timestamp` in
   * workflow code and the payload has no `alert`, the device shows the same state after a repeated update. A payload
   * with an `alert` alerts again, and a repeated update counts against Apple's budget for priority 10 updates.
   *
   * @param params - The broadcast `id` and an APNs Live Activity update payload.
   * @returns A promise which is fulfilled when Ably has accepted the notification.
   */
  async update(params: Ably.PushLiveActivityUpdateParams): Promise<void> {
    requireObject('push.admin.liveActivity.update', 'params', params, LIVE_ACTIVITY_REMEDIATION);
    await this.invoker.invoke(ActivityNames.pushLiveActivityUpdate, 'push.admin.liveActivity.update', {
      argument: params,
    });
  }

  /**
   * Ends the Live Activity on all subscribed devices and cleans up the APNs channel. After this call, the broadcast
   * `id` is no longer valid. A retry is safe, because Ably accepts a repeated end for a broadcast channel that it has
   * already deleted.
   *
   * @param params - The broadcast `id` and an APNs Live Activity end payload.
   * @returns A promise which is fulfilled when Ably has accepted the notification.
   */
  async end(params: Ably.PushLiveActivityEndParams): Promise<void> {
    requireObject('push.admin.liveActivity.end', 'params', params, LIVE_ACTIVITY_REMEDIATION);
    await this.invoker.invoke(ActivityNames.pushLiveActivityEnd, 'push.admin.liveActivity.end', {
      argument: params,
    });
  }
}

const PARAMS_REMEDIATION = 'Pass the filter parameters as an object, e.g. { clientId: "user-1" }.';

/**
 * Registers, retrieves and removes push devices from workflow code. It mirrors the Ably `PushDeviceRegistrations`,
 * and is obtained from `TemporalAblyRest.push.admin.deviceRegistrations`.
 *
 * Each method runs as a Temporal activity with the retry policy in `TemporalAblyRestOptions`. A save is an upsert keyed
 * by the device ID, so a retried save has the same effect as one attempt.
 */
export class TemporalAblyRestPushDeviceRegistrations {
  /** @internal */
  constructor(private readonly invoker: ActivityInvoker) {}

  /**
   * Registers or updates a device.
   *
   * @param deviceDetails - The device to register, with its `id`.
   * @returns A promise which is fulfilled with the registered device.
   */
  async save(deviceDetails: Ably.DeviceDetails): Promise<Ably.DeviceDetails> {
    requireObject(
      'push.admin.deviceRegistrations.save',
      'deviceDetails',
      deviceDetails,
      'Pass a DeviceDetails object with an id, platform, formFactor and push recipient.',
    );
    return this.invoker.invoke(ActivityNames.pushDeviceRegistrationsSave, 'push.admin.deviceRegistrations.save', {
      argument: deviceDetails,
    });
  }

  /**
   * Retrieves a registered device.
   *
   * @param deviceIdOrDetails - The ID of the device, or a device with its `id`.
   * @returns A promise which is fulfilled with the device.
   */
  async get(deviceIdOrDetails: string | Ably.DeviceDetails): Promise<Ably.DeviceDetails> {
    return this.invoker.invoke(ActivityNames.pushDeviceRegistrationsGet, 'push.admin.deviceRegistrations.get', {
      argument: deviceIdArgument('push.admin.deviceRegistrations.get', deviceIdOrDetails),
    });
  }

  /**
   * Retrieves the registered devices that match the filter parameters.
   *
   * @param params - Restricts which devices are retrieved, such as by `clientId`.
   * @returns A promise which is fulfilled with the first page of devices.
   */
  async list(params: Ably.DeviceRegistrationParams): Promise<TemporalAblyPaginatedResult<Ably.DeviceDetails>> {
    return paginate(
      (pageParams, relation) =>
        this.invoker.invoke(
          ActivityNames.pushDeviceRegistrationsList,
          pageSummary('push.admin.deviceRegistrations.list', relation),
          { params: pageParams },
        ),
      params,
    );
  }

  /**
   * Removes a registered device, and its channel subscriptions.
   *
   * @param deviceIdOrDetails - The ID of the device, or a device with its `id`.
   * @returns A promise which is fulfilled when the device has been removed.
   */
  async remove(deviceIdOrDetails: string | Ably.DeviceDetails): Promise<void> {
    await this.invoker.invoke(ActivityNames.pushDeviceRegistrationsRemove, 'push.admin.deviceRegistrations.remove', {
      argument: deviceIdArgument('push.admin.deviceRegistrations.remove', deviceIdOrDetails),
    });
  }

  /**
   * Removes the registered devices that match the filter parameters.
   *
   * @param params - Restricts which devices are removed, such as by `clientId`.
   * @returns A promise which is fulfilled when the devices have been removed.
   */
  async removeWhere(params: Ably.DeviceRegistrationParams): Promise<void> {
    requireObject('push.admin.deviceRegistrations.removeWhere', 'params', params, PARAMS_REMEDIATION);
    await this.invoker.invoke(
      ActivityNames.pushDeviceRegistrationsRemoveWhere,
      'push.admin.deviceRegistrations.removeWhere',
      { argument: params },
    );
  }
}

const SUBSCRIPTION_REMEDIATION =
  'Pass a subscription object with a channel and either a deviceId or a clientId, e.g. { channel: "news", clientId: "user-1" }.';

/**
 * Subscribes devices and clients to push notifications on channels from workflow code. It mirrors the Ably
 * `PushChannelSubscriptions`, and is obtained from `TemporalAblyRest.push.admin.channelSubscriptions`.
 *
 * Each method runs as a Temporal activity with the retry policy in `TemporalAblyRestOptions`. A subscription is keyed by
 * its channel and its device or client, so a retried save has the same effect as one attempt.
 */
export class TemporalAblyRestPushChannelSubscriptions {
  /** @internal */
  constructor(private readonly invoker: ActivityInvoker) {}

  /**
   * Subscribes a device, or every device of a client, to push notifications on a channel.
   *
   * @param subscription - The channel, and the `deviceId` or `clientId` to subscribe.
   * @returns A promise which is fulfilled with the saved subscription.
   */
  async save(subscription: Ably.PushChannelSubscription): Promise<Ably.PushChannelSubscription> {
    requireObject('push.admin.channelSubscriptions.save', 'subscription', subscription, SUBSCRIPTION_REMEDIATION);
    return this.invoker.invoke(ActivityNames.pushChannelSubscriptionsSave, 'push.admin.channelSubscriptions.save', {
      argument: subscription,
    });
  }

  /**
   * Retrieves the channel subscriptions that match the filter parameters.
   *
   * @param params - Restricts which subscriptions are retrieved, such as by `channel` or `clientId`.
   * @returns A promise which is fulfilled with the first page of subscriptions.
   */
  async list(
    params: Ably.PushChannelSubscriptionParams,
  ): Promise<TemporalAblyPaginatedResult<Ably.PushChannelSubscription>> {
    return paginate(
      (pageParams, relation) =>
        this.invoker.invoke(
          ActivityNames.pushChannelSubscriptionsList,
          pageSummary('push.admin.channelSubscriptions.list', relation),
          { params: pageParams },
        ),
      params,
    );
  }

  /**
   * Retrieves the names of the channels that have at least one push subscription.
   *
   * @param params - Restrictions on the channels retrieved, such as a `limit`.
   * @returns A promise which is fulfilled with the first page of channel names.
   */
  async listChannels(params: Ably.PushChannelsParams): Promise<TemporalAblyPaginatedResult<string>> {
    return paginate(
      (pageParams, relation) =>
        this.invoker.invoke(
          ActivityNames.pushChannelSubscriptionsListChannels,
          pageSummary('push.admin.channelSubscriptions.listChannels', relation),
          { params: pageParams },
        ),
      params,
    );
  }

  /**
   * Unsubscribes a device, or every device of a client, from push notifications on a channel.
   *
   * @param subscription - The channel, and the `deviceId` or `clientId` to unsubscribe.
   * @returns A promise which is fulfilled when the subscription has been removed.
   */
  async remove(subscription: Ably.PushChannelSubscription): Promise<void> {
    requireObject('push.admin.channelSubscriptions.remove', 'subscription', subscription, SUBSCRIPTION_REMEDIATION);
    await this.invoker.invoke(ActivityNames.pushChannelSubscriptionsRemove, 'push.admin.channelSubscriptions.remove', {
      argument: subscription,
    });
  }

  /**
   * Removes the channel subscriptions that match the filter parameters.
   *
   * @param params - Restricts which subscriptions are removed, such as by `channel` or `clientId`.
   * @returns A promise which is fulfilled when the subscriptions have been removed.
   */
  async removeWhere(params: Ably.PushChannelSubscriptionParams): Promise<void> {
    requireObject('push.admin.channelSubscriptions.removeWhere', 'params', params, PARAMS_REMEDIATION);
    await this.invoker.invoke(
      ActivityNames.pushChannelSubscriptionsRemoveWhere,
      'push.admin.channelSubscriptions.removeWhere',
      { argument: params },
    );
  }
}
