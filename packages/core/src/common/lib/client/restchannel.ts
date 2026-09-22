import * as Utils from '../util/utils';
import Logger from '../util/logger';
import RestPresence from './restpresence';
import Message, {
  serialize as serializeMessage,
  getMessagesSize,
  encodeArray as encodeMessagesArray,
} from '../types/message';
import ErrorInfo from '../types/errorinfo';
import { PaginatedResult } from './paginatedresource';
import Resource from './resource';
import { ChannelOptions } from '../../types/channel';
import BaseRest from './baseclient';
import * as API from '../../../../ably';
import Defaults, { normaliseChannelOptions } from '../util/defaults';
import { RestHistoryParams } from './restchannelmixin';
import { RequestBody } from 'common/types/http';
import type { PushChannel } from 'plugins/push';
import type RestAnnotations from './restannotations';
import type { RestObject } from 'plugins/liveobjects';

const MSG_ID_ENTROPY_BYTES = 9;

type RestPublishResponse = API.PublishResult & { channel?: string; messageId?: string };

function allEmptyIds(messages: Array<Message>) {
  return messages.every(function (message: Message) {
    return !message.id;
  });
}

class RestChannel {
  client: BaseRest;
  name: string;
  presence: RestPresence;
  channelOptions: ChannelOptions;
  _push?: PushChannel;
  private _annotations: RestAnnotations | null = null;
  get annotations(): RestAnnotations {
    if (!this._annotations) {
      Utils.throwMissingPluginError('Annotations');
    }
    return this._annotations;
  }
  private _object?: RestObject;

  constructor(client: BaseRest, name: string, channelOptions?: ChannelOptions) {
    Logger.logAction(client.logger, Logger.LOG_MINOR, 'RestChannel()', 'started; name = ' + name);
    this.name = name;
    this.client = client;
    this.presence = new RestPresence(this);
    this.channelOptions = normaliseChannelOptions(client._Crypto ?? null, this.logger, channelOptions);
    if (client.options.plugins?.Push) {
      this._push = new client.options.plugins.Push.PushChannel(this);
    }
    if (client._Annotations) {
      this._annotations = new client._Annotations.RestAnnotations(this);
    }
    if (client._liveObjectsPlugin) {
      this._object = new client._liveObjectsPlugin.RestObject(this);
    }
  }

  get push() {
    if (!this._push) {
      Utils.throwMissingPluginError('Push');
    }
    return this._push;
  }

  get object(): RestObject {
    if (!this._object) {
      Utils.throwMissingPluginError('LiveObjects');
    }
    return this._object;
  }

  get logger(): Logger {
    return this.client.logger;
  }

  setOptions(options?: ChannelOptions): void {
    this.channelOptions = normaliseChannelOptions(this.client._Crypto ?? null, this.logger, options);
  }

  async history(params?: RestHistoryParams | null): Promise<PaginatedResult<Message>> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RestChannel.history()', 'channel = ' + this.name);
    return this.client.rest.channelMixin.history(this, params ?? null);
  }

  async publish(...args: any[]): Promise<API.PublishResult> {
    const first = args[0],
      second = args[1];
    let messages: Array<Message>;
    let params: any;

    if (typeof first === 'string' || first === null) {
      /* (name, data, ...) */
      messages = [Message.fromValues({ name: first, data: second })];
      params = args[2];
    } else if (Utils.isObject(first)) {
      messages = [Message.fromValues(first)];
      params = args[1];
    } else if (Array.isArray(first)) {
      messages = Message.fromValuesArray(first);
      params = args[1];
    } else {
      throw new ErrorInfo({
        message:
          'publish() expects an event name (string or null), a message object, or an array of message objects as its first argument',
        code: 40013,
        statusCode: 400,
        remediation:
          'Call publish(name, data) for a single event, or publish(message | message[]) with a Message-shaped object.',
      });
    }

    if (!params) {
      /* No params supplied */
      params = {};
    }

    const client = this.client,
      options = client.options,
      format = options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      idempotentRestPublishing = client.options.idempotentRestPublishing,
      headers = Defaults.defaultPostHeaders(client.options);

    Utils.mixin(headers, options.headers);

    if (idempotentRestPublishing && allEmptyIds(messages)) {
      const msgIdBase = await Utils.randomString(MSG_ID_ENTROPY_BYTES);
      messages.forEach(function (message, index) {
        message.id = msgIdBase + ':' + index.toString();
      });
    }

    const wireMessages = await encodeMessagesArray(messages, this.channelOptions);

    /* RSL1i */
    const size = getMessagesSize(wireMessages),
      maxMessageSize = options.maxMessageSize;
    if (size > maxMessageSize) {
      throw new ErrorInfo({
        message: `Maximum size of messages that can be published at once exceeded (was ${size} bytes, against a limit of ${maxMessageSize} bytes)`,
        code: 40009,
        statusCode: 400,
        remediation:
          'Split the publish into multiple calls so each batch is under the limit. If you set ClientOptions.maxMessageSize yourself, raise it. It can only restrict below your account limit, not above it. To lift the account limit, contact Ably support.',
      });
    }

    return this._publish(serializeMessage(wireMessages, client._MsgPack, format), headers, params);
  }

  async _publish(
    requestBody: RequestBody | null,
    headers: Record<string, string>,
    params: any,
  ): Promise<API.PublishResult> {
    const client = this.client;
    const format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json;
    const { body, unpacked } = await Resource.post<RestPublishResponse>(
      client,
      client.rest.channelMixin.basePath(this) + '/messages',
      requestBody,
      headers,
      params,
      null,
      true,
    );
    const decoded =
      (unpacked ? body : Utils.decodeBody<RestPublishResponse>(body, client._MsgPack, format)) ||
      ({} as RestPublishResponse);
    delete decoded['channel'];
    delete decoded['messageId'];
    return decoded;
  }

  async status(): Promise<API.ChannelDetails> {
    return this.client.rest.channelMixin.status(this);
  }

  async getMessage(serialOrMessage: string | Message): Promise<Message> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RestChannel.getMessage()', 'channel = ' + this.name);
    return this.client.rest.channelMixin.getMessage(this, serialOrMessage);
  }

  async updateMessage(
    message: Message,
    operation?: API.MessageOperation,
    params?: Record<string, any>,
  ): Promise<API.UpdateDeleteResult> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RestChannel.updateMessage()', 'channel = ' + this.name);
    return this.client.rest.channelMixin.updateDeleteMessage(this, 'message.update', message, operation, params);
  }

  async deleteMessage(
    message: Message,
    operation?: API.MessageOperation,
    params?: Record<string, any>,
  ): Promise<API.UpdateDeleteResult> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RestChannel.deleteMessage()', 'channel = ' + this.name);
    return this.client.rest.channelMixin.updateDeleteMessage(this, 'message.delete', message, operation, params);
  }

  async appendMessage(
    message: Message,
    operation?: API.MessageOperation,
    params?: Record<string, any>,
  ): Promise<API.UpdateDeleteResult> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RestChannel.appendMessage()', 'channel = ' + this.name);
    return this.client.rest.channelMixin.updateDeleteMessage(this, 'message.append', message, operation, params);
  }

  async getMessageVersions(
    serialOrMessage: string | Message,
    params?: Record<string, any>,
  ): Promise<PaginatedResult<Message>> {
    Logger.logAction(this.logger, Logger.LOG_MICRO, 'RestChannel.getMessageVersions()', 'channel = ' + this.name);
    return this.client.rest.channelMixin.getMessageVersions(this, serialOrMessage, params);
  }
}

export default RestChannel;
