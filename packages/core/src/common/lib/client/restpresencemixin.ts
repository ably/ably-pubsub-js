import RestPresence from './restpresence';
import RealtimePresence from './realtimepresence';
import * as Utils from '../util/utils';
import Defaults from '../util/defaults';
import PaginatedResource, { PaginatedResult } from './paginatedresource';
import PresenceMessage, { WirePresenceMessage, _fromEncodedArray } from '../types/presencemessage';
import { RestChannelMixin } from './restchannelmixin';

export class RestPresenceMixin {
  static basePath(presence: RestPresence | RealtimePresence) {
    return RestChannelMixin.basePath(presence.channel) + '/presence';
  }

  static async history(
    presence: RestPresence | RealtimePresence,
    params: any,
  ): Promise<PaginatedResult<PresenceMessage>> {
    const client = presence.channel.client,
      format = client.options.useBinaryProtocol ? Utils.Format.msgpack : Utils.Format.json,
      envelope = presence.channel.client.http.supportsLinkHeaders ? undefined : format,
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
