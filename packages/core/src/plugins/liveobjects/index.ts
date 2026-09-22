import { LiveCounterValueType } from './livecountervaluetype';
import { LiveMapValueType } from './livemapvaluetype';
import { ObjectId } from './objectid';
import { ObjectMessage, WireObjectMessage } from './objectmessage';
import { RealtimeObject } from './realtimeobject';
import { RestObject } from './restobject';

export {
  LiveCounterValueType as LiveCounter,
  LiveMapValueType as LiveMap,
  ObjectId,
  ObjectMessage,
  RealtimeObject,
  RestObject,
  WireObjectMessage,
};

/**
 * The named LiveObjects plugin object export to be passed to the Ably client.
 */
export const LiveObjects = {
  LiveCounter: LiveCounterValueType,
  LiveMap: LiveMapValueType,
  ObjectId,
  ObjectMessage,
  RealtimeObject,
  RestObject,
  WireObjectMessage,
};
