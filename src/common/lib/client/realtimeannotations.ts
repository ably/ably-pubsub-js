import EventEmitter from '../util/eventemitter';
import Logger from '../util/logger';
import Annotation from '../types/annotation';
import { actions, flags } from '../types/protocolmessagecommon';
import { fromValues as protocolMessageFromValues } from '../types/protocolmessage';
import ErrorInfo from '../types/errorinfo';
import RealtimeChannel from './realtimechannel';
import RestAnnotations, { RestGetAnnotationsParams, constructValidateAnnotation } from './restannotations';
import type { PaginatedResult } from './paginatedresource';
import type Message from '../types/message';
import type { Properties } from '../util/utils';

class RealtimeAnnotations {
  private channel: RealtimeChannel;
  private logger: Logger;
  private subscriptions: EventEmitter;

  constructor(channel: RealtimeChannel) {
    this.channel = channel;
    this.logger = channel.logger;
    this.subscriptions = new EventEmitter(this.logger);
  }

  async publish(msgOrSerial: string | Message, annotationValues: Partial<Properties<Annotation>>): Promise<void> {
    const channelName = this.channel.name;
    const annotation = constructValidateAnnotation(msgOrSerial, annotationValues, 'publish');
    const wireAnnotation = await annotation.encode(this.channel.channelOptions);

    this.channel.throwIfUnpublishableState();

    Logger.logAction(
      this.logger,
      Logger.LOG_MICRO,
      'RealtimeAnnotations.publish()',
      'channelName = ' +
        channelName +
        ', sending annotation with messageSerial = ' +
        annotation.messageSerial +
        ', type = ' +
        annotation.type,
    );

    const pm = protocolMessageFromValues({
      action: actions.ANNOTATION,
      channel: channelName,
      annotations: [wireAnnotation],
    });
    await this.channel.sendAndAwaitAck(pm);
  }

  async delete(msgOrSerial: string | Message, annotationValues: Partial<Properties<Annotation>>): Promise<void> {
    annotationValues.action = 'annotation.delete';
    await this.publish(msgOrSerial, annotationValues);
  }

  async subscribe(..._args: unknown[] /* [type], listener */): Promise<void> {
    const args = RealtimeChannel.processListenerArgs(_args);
    const event = args[0];
    const listener = args[1];
    const channel = this.channel;

    if (channel.state === 'failed') {
      throw ErrorInfo.fromValues(channel.invalidStateError());
    }

    this.subscriptions.on(event, listener);

    if (this.channel.channelOptions.attachOnSubscribe !== false) {
      await channel.attach();
    }

    // explicit check for attach state in case attachOnSubscribe=false
    if (this.channel.state === 'attached' && (this.channel._mode & flags.ANNOTATION_SUBSCRIBE) === 0) {
      const err = new ErrorInfo({
        message:
          "You are trying to add an annotation listener, but you haven't requested the annotation_subscribe channel mode in ChannelOptions, so this won't do anything (we only deliver annotations to clients who have explicitly requested them)",
        code: 93001,
        statusCode: 400,
        remediation:
          'Include "annotation_subscribe" in the channel modes: realtime.channels.get(name, { modes: ["annotation_subscribe", ...] }), or call channel.setOptions({ modes: [...] }) on an existing channel to trigger a reattach. Calling channels.get(name, { modes }) on an existing channel throws. The server only grants the mode if your key or token has the annotation-subscribe capability. Without it the attach succeeds but the server silently drops the mode and annotations are never delivered. `ably auth keys list` shows your key\'s capabilities.',
      });
      Logger.logActionNoStrip(
        this.logger,
        Logger.LOG_MAJOR,
        'RealtimeAnnotations.subscribe()',
        err.message + '; remediation=' + err.remediation,
      );
      // The listener stays registered despite the throw, matching subscribe()'s existing
      // semantics: the listener is always added regardless of attach outcome.
      throw err;
    }
  }

  unsubscribe(..._args: unknown[] /* [event], listener */): void {
    const args = RealtimeChannel.processListenerArgs(_args);
    const event = args[0];
    const listener = args[1];
    this.subscriptions.off(event, listener);
  }

  _processIncoming(annotations: Annotation[]): void {
    for (const annotation of annotations) {
      this.subscriptions.emit(annotation.type || '', annotation);
    }
  }

  async get(
    msgOrSerial: string | Message,
    params: RestGetAnnotationsParams | null,
  ): Promise<PaginatedResult<Annotation>> {
    return RestAnnotations.prototype.get.call(this, msgOrSerial, params);
  }
}

export default RealtimeAnnotations;
