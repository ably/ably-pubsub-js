// constant definitions that can be imported by anyone without worrying about circular
// deps

// TR2
export const actions = {
  HEARTBEAT: 0,
  ACK: 1,
  NACK: 2,
  CONNECT: 3,
  CONNECTED: 4,
  DISCONNECT: 5,
  DISCONNECTED: 6,
  CLOSE: 7,
  CLOSED: 8,
  ERROR: 9,
  ATTACH: 10,
  ATTACHED: 11,
  DETACH: 12,
  DETACHED: 13,
  PRESENCE: 14,
  MESSAGE: 15,
  SYNC: 16,
  AUTH: 17,
  ACTIVATE: 18,
  OBJECT: 19,
  OBJECT_SYNC: 20,
  ANNOTATION: 21,
};

export const ActionName: string[] = [];
Object.keys(actions).forEach(function (name) {
  ActionName[(actions as { [key: string]: number })[name]] = name;
});

// TR3
export const flags: { [key: string]: number } = {
  /* Channel attach state flags */
  HAS_PRESENCE: 1 << 0,
  HAS_BACKLOG: 1 << 1,
  RESUMED: 1 << 2,
  TRANSIENT: 1 << 4,
  ATTACH_RESUME: 1 << 5,
  HAS_OBJECTS: 1 << 7,
  /* Channel mode flags */
  PRESENCE: 1 << 16,
  PUBLISH: 1 << 17,
  SUBSCRIBE: 1 << 18,
  PRESENCE_SUBSCRIBE: 1 << 19,
  ANNOTATION_PUBLISH: 1 << 21,
  ANNOTATION_SUBSCRIBE: 1 << 22,
  OBJECT_SUBSCRIBE: 1 << 24,
  OBJECT_PUBLISH: 1 << 25,
};

export const flagNames = Object.keys(flags);

flags.MODE_ALL =
  flags.PRESENCE |
  flags.PUBLISH |
  flags.SUBSCRIBE |
  flags.PRESENCE_SUBSCRIBE |
  flags.ANNOTATION_PUBLISH |
  flags.ANNOTATION_SUBSCRIBE |
  flags.OBJECT_SUBSCRIBE |
  flags.OBJECT_PUBLISH;

export const channelModes = [
  'PRESENCE',
  'PUBLISH',
  'SUBSCRIBE',
  'PRESENCE_SUBSCRIBE',
  'ANNOTATION_PUBLISH',
  'ANNOTATION_SUBSCRIBE',
  'OBJECT_SUBSCRIBE',
  'OBJECT_PUBLISH',
];
