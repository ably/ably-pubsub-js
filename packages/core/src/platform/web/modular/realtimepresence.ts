import { RealtimePresencePlugin } from 'common/lib/client/modularplugins';
import { default as realtimePresenceClass } from '../../../common/lib/client/realtimepresence';
import PresenceMessage, { WirePresenceMessage } from '../../../common/lib/types/presencemessage';

const RealtimePresence: RealtimePresencePlugin = {
  RealtimePresence: realtimePresenceClass,
  PresenceMessage,
  WirePresenceMessage,
};

export { RealtimePresence };
