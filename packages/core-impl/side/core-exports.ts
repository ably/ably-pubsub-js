/**
 * The public value surface of the Pub/Sub packages besides their factories, in one place so that
 * both packages re-export the same list and it only has to grow once: `ErrorInfo`, and the
 * `Crypto`, `Message`, `PresenceMessage` and `Annotation` classes, whose static methods need no
 * client.
 *
 * `ErrorInfo` comes from `@ably/pubsub-core`, which every package bundle leaves external, so that
 * there is one copy of it at runtime, shared with the SDKs layered on Pub/Sub, and an error raised
 * by any of them passes `instanceof ErrorInfo` against the class imported from any other. The
 * implementation's platform entry points re-export that same class.
 *
 * The client classes are deliberately absent. A client built by constructing
 * `DefaultPubSubRealtimeClient` or `DefaultPubSubHttpClient` directly declares no side, so
 * re-exporting either would hand consumers a way to build a client that silently opts out of the
 * very thing each package exists to declare. The factories are the only way in. They reach the
 * classes through ./core-clients.ts.
 *
 * What remains is enumerated rather than spread from the platform entry point, which also exports
 * the client classes, `msgpack`, `makeProtocolMessageFromDeserialized` and `Logger`: those are
 * internal, and exporting them would make them public API of both packages.
 *
 * The type surface is handled separately, in each package's hand-written `index.d.ts`.
 */
import platform from '@ably/pubsub-core-impl/platform';
import type * as API from '@ably/pubsub-core/api';

export { ErrorInfo } from '@ably/pubsub-core';

interface PlatformValues {
  Crypto: typeof API.Crypto;
  Message: typeof API.Message;
  PresenceMessage: typeof API.PresenceMessage;
  Annotation: typeof API.Annotation;
}

const values = platform as PlatformValues;

export const Crypto = values.Crypto;
export const Message = values.Message;
export const PresenceMessage = values.PresenceMessage;
export const Annotation = values.Annotation;
