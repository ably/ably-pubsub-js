import LiveObjects from './liveobjects';
import Push from './push';

export interface StandardPlugins {
  LiveObjects?: typeof LiveObjects;
  Push?: typeof Push;
}
