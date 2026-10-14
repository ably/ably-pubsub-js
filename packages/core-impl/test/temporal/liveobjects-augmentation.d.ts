// The LiveObjects declarations add `object` to `HttpChannel` by augmenting `@ably/pubsub-core`, which tsconfig.json
// maps onto the core's runtime source for the UTS helpers, so that augmentation does not reach the API's
// `HttpChannel` here. This repeats it on `@ably/pubsub-core/api`, for type checking only.
import type { HttpObject } from '@ably/pubsub-core/liveobjects';

declare module '@ably/pubsub-core/api' {
  interface HttpChannel {
    object: HttpObject;
  }
}
