import HttpPresence from './httppresence';
import RealtimePresence from './realtimepresence';
import * as Utils from '../util/utils';
import Defaults from '../util/defaults';
import PaginatedResource, { PaginatedResult } from './paginatedresource';
import PresenceMessage, { WirePresenceMessage, _fromEncodedArray } from '../types/presencemessage';
import { HttpChannelMixin } from './httpchannelmixin';

export class HttpPresenceMixin {
  static basePath(presence: HttpPresence | RealtimePresence) {
    return HttpChannelMixin.basePath(presence.channel) + '/presence';
  }

  static async history(
    presence: HttpPresence | RealtimePresence,
    params: any,
  ): Promise<PaginatedResult<PresenceMessage>> {
    const client = presence.channel.client,
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      envelope = presence.channel.client.httpRequester.supportsLinkHeaders ? undefined : format,
      headers = Defaults.defaultGetHeaders(client.options);

    Utils.mixin(headers, client.options.headers);

    return new PaginatedResource(
      client,
      this.basePath(presence) + '/history',
      headers,
      envelope,
      async (body, headers, unpacked) => {
        const decoded = (
          unpacked ? body : Utils.decodeBody(body, client._MsgPack, format)
        ) as Utils.Properties<WirePresenceMessage>[];

        return _fromEncodedArray(decoded, presence.channel);
      },
    ).get(params);
  }
}
