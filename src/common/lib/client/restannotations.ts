import * as Utils from '../util/utils';
import Annotation, { WireAnnotation, _fromEncodedArray } from '../types/annotation';
import type Message from '../types/message';
import type RestChannel from './restchannel';
import type RealtimeChannel from './realtimechannel';
import Defaults from '../util/defaults';
import PaginatedResource, { PaginatedResult } from './paginatedresource';
import Resource from './resource';
import type { Properties } from '../util/utils';
import ErrorInfo from '../types/errorinfo';

export interface RestGetAnnotationsParams {
  limit?: number;
}

export function serialFromMsgOrSerial(msgOrSerial: string | Message, methodName: string): string {
  let messageSerial: string | undefined;
  switch (typeof msgOrSerial) {
    case 'string':
      messageSerial = msgOrSerial;
      break;
    case 'object':
      messageSerial = msgOrSerial.serial;
      break;
  }
  if (!messageSerial || typeof messageSerial !== 'string') {
    throw new ErrorInfo({
      message:
        'The message argument of annotations.' +
        methodName +
        '() must be either a Message or other object carrying a non-empty string `serial` property, or a message serial as a non-empty string',
      code: 40003,
      statusCode: 400,
      remediation:
        'Pass the Message received from a subscribe callback (which carries .serial), or its serial string. Newly constructed Message objects do not have a serial.',
    });
  }
  return messageSerial;
}

export function constructValidateAnnotation(
  msgOrSerial: string | Message,
  annotationValues: Partial<Properties<Annotation>>,
  methodName: string,
): Annotation {
  const messageSerial = serialFromMsgOrSerial(msgOrSerial, methodName);

  if (!annotationValues || typeof annotationValues !== 'object') {
    throw new ErrorInfo({
      message:
        'Second argument of annotations.' + methodName + '() must be an object (the intended annotation to publish)',
      code: 40003,
      statusCode: 400,
      remediation:
        'Pass an Annotation-shaped object as the second argument, e.g. { type: "reaction:unique.v1", name: "👍" }.',
    });
  }

  const annotation = Annotation.fromValues(annotationValues);
  annotation.messageSerial = messageSerial;
  if (!annotation.action) {
    annotation.action = 'annotation.create';
  }
  return annotation;
}

function basePathForSerial(channel: RestChannel | RealtimeChannel, serial: string) {
  return (
    channel.client.rest.channelMixin.basePath(channel) + '/messages/' + encodeURIComponent(serial) + '/annotations'
  );
}

class RestAnnotations {
  private channel: RestChannel;

  constructor(channel: RestChannel) {
    this.channel = channel;
  }

  async publish(msgOrSerial: string | Message, annotationValues: Partial<Properties<Annotation>>): Promise<void> {
    return this._publish(msgOrSerial, annotationValues, 'publish');
  }

  private async _publish(
    msgOrSerial: string | Message,
    annotationValues: Partial<Properties<Annotation>>,
    methodName: string,
  ): Promise<void> {
    const annotation = constructValidateAnnotation(msgOrSerial, annotationValues, methodName);
    const wireAnnotation = await annotation.encode(this.channel.channelOptions);

    const client = this.channel.client,
      options = client.options,
      format = options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      headers = Defaults.defaultPostHeaders(client.options),
      params = {};

    Utils.mixin(headers, client.options.headers);

    const requestBody = Utils.encodeBody([wireAnnotation], client._MsgPack, format);

    await Resource.post(
      client,
      basePathForSerial(this.channel, annotation.messageSerial!),
      requestBody,
      headers,
      params,
      null,
      true,
    );
  }

  async delete(msgOrSerial: string | Message, annotationValues: Partial<Properties<Annotation>>): Promise<void> {
    annotationValues.action = 'annotation.delete';
    return this._publish(msgOrSerial, annotationValues, 'delete');
  }

  async get(
    msgOrSerial: string | Message,
    params: RestGetAnnotationsParams | null,
  ): Promise<PaginatedResult<Annotation>> {
    const client = this.channel.client,
      messageSerial = serialFromMsgOrSerial(msgOrSerial, 'get'),
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      envelope = client.http.supportsLinkHeaders ? undefined : format,
      headers = Defaults.defaultGetHeaders(client.options);

    Utils.mixin(headers, client.options.headers);

    return new PaginatedResource(
      client,
      basePathForSerial(this.channel, messageSerial),
      headers,
      envelope,
      async (body, _, unpacked) => {
        const decoded = (
          unpacked ? body : Utils.decodeBody(body, client._MsgPack, format)
        ) as Utils.Properties<WireAnnotation>[];

        return _fromEncodedArray(decoded, this.channel);
      },
    ).get(params as Record<string, unknown>);
  }
}

export default RestAnnotations;
