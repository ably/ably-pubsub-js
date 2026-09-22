import { Rest } from './rest';
import { IUntypedCryptoStatic } from '../../types/ICryptoStatic';
import { MsgPack } from 'common/types/msgpack';
import RealtimePresence from './realtimepresence';
import RealtimeAnnotations from './realtimeannotations';
import RestAnnotations from './restannotations';
import XHRRequest from 'platform/web/lib/http/request/xhrrequest';
import fetchRequest from 'platform/web/lib/http/request/fetchrequest';
import { FilteredSubscriptions } from './filteredsubscriptions';
import PresenceMessage, { WirePresenceMessage } from '../types/presencemessage';
import Annotation, { WireAnnotation } from '../types/annotation';
import { TransportCtor } from '../transport/transport';
import type * as PushPlugin from 'plugins/push';
import type * as LiveObjectsPlugin from 'plugins/liveobjects';
import type { IPlatformPushConfig } from 'common/types/IPlatformConfig';

export interface PresenceMessagePlugin {
  PresenceMessage: typeof PresenceMessage;
  WirePresenceMessage: typeof WirePresenceMessage;
}

export type RealtimePresencePlugin = PresenceMessagePlugin & {
  RealtimePresence: typeof RealtimePresence;
};

export type AnnotationsPlugin = {
  Annotation: typeof Annotation;
  WireAnnotation: typeof WireAnnotation;
  RealtimeAnnotations: typeof RealtimeAnnotations;
  RestAnnotations: typeof RestAnnotations;
};

export interface ModularPlugins {
  Rest?: typeof Rest;
  Crypto?: IUntypedCryptoStatic;
  MsgPack?: MsgPack;
  RealtimePresence?: RealtimePresencePlugin;
  Annotations?: AnnotationsPlugin;
  WebSocketTransport?: TransportCtor;
  XHRPolling?: TransportCtor;
  XHRRequest?: typeof XHRRequest;
  FetchRequest?: typeof fetchRequest;
  MessageInteractions?: typeof FilteredSubscriptions;
  // the default-export object shape, which is what consumers actually pass (both the web push
  // plugin's and ReactNativePush.create()'s objects). pushConfig is optional and carried by
  // plugins that supply their own platform push config (e.g. ReactNativePush); it is read per
  // client via BaseClient.pushConfig. The web push plugin relies on the statically-set
  // Platform.Config.push fallback.
  Push?: (typeof PushPlugin)['default'] & { pushConfig?: IPlatformPushConfig };
  LiveObjects?: typeof LiveObjectsPlugin; // PC5, PT2b
}

export const allCommonModularPlugins: ModularPlugins = { Rest };
