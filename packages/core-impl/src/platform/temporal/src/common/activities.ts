// The contract between the workflow-side proxy and the worker-side activities: the activity names, and the
// shape of each activity's input and result.
//
// Shared between the workflow and worker entry points, so this module must stay workflow-safe. It only
// imports types from '@ably/pubsub-core/api', never values.
//
// Every input and result passes through `encodeForWire`/`decodeFromWire` (see ./wire.ts) at the activity
// boundary, so binary values are carried as tagged base64 strings in transit. The types below describe the
// values before encoding and after decoding.

import type * as Ably from '@ably/pubsub-core/api';
import type {
  HttpObjectGetCompactResult,
  HttpObjectGetFullResult,
  HttpObjectGetParams,
  HttpObjectOperation,
  HttpObjectPublishResult,
} from '@ably/pubsub-core/liveobjects';
import type { WireHttpPaginatedResponse, WirePage } from './wire.js';

/**
 * The names under which the Ably activities are registered on the worker. Every name is prefixed with `ably.`
 * so that it cannot collide with an application's own activities.
 */
export const ActivityNames = {
  publish: 'ably.channel.publish',
  history: 'ably.channel.history',
  status: 'ably.channel.status',
  getMessage: 'ably.channel.getMessage',
  updateMessage: 'ably.channel.updateMessage',
  deleteMessage: 'ably.channel.deleteMessage',
  appendMessage: 'ably.channel.appendMessage',
  getMessageVersions: 'ably.channel.getMessageVersions',
  presenceGet: 'ably.channel.presence.get',
  presenceHistory: 'ably.channel.presence.history',
  annotationsPublish: 'ably.channel.annotations.publish',
  annotationsDelete: 'ably.channel.annotations.delete',
  annotationsGet: 'ably.channel.annotations.get',
  objectGet: 'ably.channel.object.get',
  objectPublish: 'ably.channel.object.publish',
  time: 'ably.time',
  request: 'ably.request',
  batchPublish: 'ably.batchPublish',
  batchPresence: 'ably.batchPresence',
  pushPublish: 'ably.push.admin.publish',
  pushCreateApnsBroadcast: 'ably.push.admin.createApnsBroadcast',
  pushLiveActivityStart: 'ably.push.admin.liveActivity.start',
  pushLiveActivityUpdate: 'ably.push.admin.liveActivity.update',
  pushLiveActivityEnd: 'ably.push.admin.liveActivity.end',
  pushDeviceRegistrationsSave: 'ably.push.admin.deviceRegistrations.save',
  pushDeviceRegistrationsGet: 'ably.push.admin.deviceRegistrations.get',
  pushDeviceRegistrationsList: 'ably.push.admin.deviceRegistrations.list',
  pushDeviceRegistrationsRemove: 'ably.push.admin.deviceRegistrations.remove',
  pushDeviceRegistrationsRemoveWhere: 'ably.push.admin.deviceRegistrations.removeWhere',
  pushChannelSubscriptionsSave: 'ably.push.admin.channelSubscriptions.save',
  pushChannelSubscriptionsList: 'ably.push.admin.channelSubscriptions.list',
  pushChannelSubscriptionsListChannels: 'ably.push.admin.channelSubscriptions.listChannels',
  pushChannelSubscriptionsRemove: 'ably.push.admin.channelSubscriptions.remove',
  pushChannelSubscriptionsRemoveWhere: 'ably.push.admin.channelSubscriptions.removeWhere',
} as const;

export type ActivityName = (typeof ActivityNames)[keyof typeof ActivityNames];

/** Identifies the channel that a channel-scoped activity operates on. */
export interface ChannelInput {
  channel: string;
}

/**
 * Input for {@link ActivityNames.publish}. The workflow normalises every overload of `channel.publish()` to an
 * array of messages, and assigns message IDs when idempotent publishing is enabled.
 */
export interface PublishInput extends ChannelInput {
  messages: Ably.Message[];
  options?: Ably.PublishOptions;
}

/**
 * Input for an activity that returns a paginated result. `params` is either the caller's query parameters for
 * the first page, or the {@link PageParams} from a {@link WirePage}'s links when fetching a related page.
 */
export interface PaginatedInput<P> extends ChannelInput {
  params?: P | Record<string, string>;
}

export interface GetMessageInput extends ChannelInput {
  serialOrMessage: string | Ably.Message;
}

export interface MessageOperationInput extends ChannelInput {
  message: Ably.Message;
  operation?: Ably.MessageOperation;
  options?: Ably.PublishOptions;
}

export interface GetMessageVersionsInput extends ChannelInput {
  serialOrMessage: string | Ably.Message;
  params?: Record<string, any>;
}

export interface AnnotationInput extends ChannelInput {
  messageOrSerial: string | Ably.Message;
  annotation: Ably.OutboundAnnotation;
}

export interface GetAnnotationsInput extends ChannelInput {
  messageOrSerial: string | Ably.Message;
  params: Ably.GetAnnotationsParams | Record<string, string> | null;
}

export interface ObjectGetInput extends ChannelInput {
  params?: HttpObjectGetParams;
}

export interface ObjectPublishInput extends ChannelInput {
  operations: HttpObjectOperation | HttpObjectOperation[];
}

export interface RequestInput {
  method: string;
  path: string;
  version: number;
  params?: Record<string, any>;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface BatchPublishInput {
  specs: Ably.BatchPublishSpec | Ably.BatchPublishSpec[];
}

export interface BatchPresenceInput {
  channels: string[];
}

export interface PushPublishInput {
  recipient: any;
  payload: any;
}

/** Input for a push admin activity that takes a single argument, such as a device or a set of filter parameters. */
export interface PushArgumentInput<T> {
  argument: T;
}

/**
 * Input for a push admin activity that returns a paginated result. `params` is either the caller's filter
 * parameters for the first page, or the {@link PageParams} from a {@link WirePage}'s links when fetching a related
 * page.
 */
export interface PushListInput<P> {
  params?: P | Record<string, string>;
}

/**
 * The Ably activities, keyed by activity name. This is the type the workflow passes to `proxyActivities()`, and
 * the type that the worker's activity implementations satisfy.
 */
export interface AblyActivities {
  [ActivityNames.publish](input: PublishInput): Promise<Ably.PublishResult>;
  [ActivityNames.history](input: PaginatedInput<Ably.HttpHistoryParams>): Promise<WirePage<Ably.InboundMessage>>;
  [ActivityNames.status](input: ChannelInput): Promise<Ably.ChannelDetails>;
  [ActivityNames.getMessage](input: GetMessageInput): Promise<Ably.Message>;
  [ActivityNames.updateMessage](input: MessageOperationInput): Promise<Ably.UpdateDeleteResult>;
  [ActivityNames.deleteMessage](input: MessageOperationInput): Promise<Ably.UpdateDeleteResult>;
  [ActivityNames.appendMessage](input: MessageOperationInput): Promise<Ably.UpdateDeleteResult>;
  [ActivityNames.getMessageVersions](input: GetMessageVersionsInput): Promise<WirePage<Ably.Message>>;
  [ActivityNames.presenceGet](input: PaginatedInput<Ably.HttpPresenceParams>): Promise<WirePage<Ably.PresenceMessage>>;
  [ActivityNames.presenceHistory](
    input: PaginatedInput<Ably.HttpHistoryParams>,
  ): Promise<WirePage<Ably.PresenceMessage>>;
  [ActivityNames.annotationsPublish](input: AnnotationInput): Promise<void>;
  [ActivityNames.annotationsDelete](input: AnnotationInput): Promise<void>;
  [ActivityNames.annotationsGet](input: GetAnnotationsInput): Promise<WirePage<Ably.Annotation>>;
  [ActivityNames.objectGet](input: ObjectGetInput): Promise<HttpObjectGetCompactResult | HttpObjectGetFullResult>;
  [ActivityNames.objectPublish](input: ObjectPublishInput): Promise<HttpObjectPublishResult>;
  [ActivityNames.time](): Promise<number>;
  [ActivityNames.request](input: RequestInput): Promise<WireHttpPaginatedResponse<any>>;
  [ActivityNames.batchPublish](
    input: BatchPublishInput,
  ): Promise<
    | Ably.BatchResult<Ably.BatchPublishSuccessResult | Ably.BatchPublishFailureResult>
    | Ably.BatchResult<Ably.BatchPublishSuccessResult | Ably.BatchPublishFailureResult>[]
  >;
  [ActivityNames.batchPresence](
    input: BatchPresenceInput,
  ): Promise<Ably.BatchResult<Ably.BatchPresenceSuccessResult | Ably.BatchPresenceFailureResult>[]>;
  [ActivityNames.pushPublish](input: PushPublishInput): Promise<void>;
  [ActivityNames.pushCreateApnsBroadcast](
    input: PushArgumentInput<Ably.PushApnsBroadcastOptions>,
  ): Promise<Ably.PushApnsBroadcast>;
  [ActivityNames.pushLiveActivityStart](input: PushArgumentInput<Ably.PushLiveActivityStartParams>): Promise<void>;
  [ActivityNames.pushLiveActivityUpdate](input: PushArgumentInput<Ably.PushLiveActivityUpdateParams>): Promise<void>;
  [ActivityNames.pushLiveActivityEnd](input: PushArgumentInput<Ably.PushLiveActivityEndParams>): Promise<void>;
  [ActivityNames.pushDeviceRegistrationsSave](
    input: PushArgumentInput<Ably.DeviceDetails>,
  ): Promise<Ably.DeviceDetails>;
  [ActivityNames.pushDeviceRegistrationsGet](
    input: PushArgumentInput<string | Ably.DeviceDetails>,
  ): Promise<Ably.DeviceDetails>;
  [ActivityNames.pushDeviceRegistrationsList](
    input: PushListInput<Ably.DeviceRegistrationParams>,
  ): Promise<WirePage<Ably.DeviceDetails>>;
  [ActivityNames.pushDeviceRegistrationsRemove](input: PushArgumentInput<string | Ably.DeviceDetails>): Promise<void>;
  [ActivityNames.pushDeviceRegistrationsRemoveWhere](
    input: PushArgumentInput<Ably.DeviceRegistrationParams>,
  ): Promise<void>;
  [ActivityNames.pushChannelSubscriptionsSave](
    input: PushArgumentInput<Ably.PushChannelSubscription>,
  ): Promise<Ably.PushChannelSubscription>;
  [ActivityNames.pushChannelSubscriptionsList](
    input: PushListInput<Ably.PushChannelSubscriptionParams>,
  ): Promise<WirePage<Ably.PushChannelSubscription>>;
  [ActivityNames.pushChannelSubscriptionsListChannels](
    input: PushListInput<Ably.PushChannelsParams>,
  ): Promise<WirePage<string>>;
  [ActivityNames.pushChannelSubscriptionsRemove](input: PushArgumentInput<Ably.PushChannelSubscription>): Promise<void>;
  [ActivityNames.pushChannelSubscriptionsRemoveWhere](
    input: PushArgumentInput<Ably.PushChannelSubscriptionParams>,
  ): Promise<void>;
}
