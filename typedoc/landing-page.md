# Ably JavaScript Client Library SDK API Reference

The JavaScript Client Library SDK supports a realtime and a REST interface. The JavaScript API references are generated from the [Ably JavaScript Client Library SDK source code](https://github.com/ably/ably-pubsub-js/) using [TypeDoc](https://typedoc.org) and structured by classes.

The realtime interface enables a client to maintain a persistent connection to Ably and publish, subscribe and be present on channels. The REST interface is stateless and typically implemented server-side. It is used to make requests such as retrieving statistics, token authentication and publishing to a channel.

There are two variants of the Ably JavaScript Client Library SDK:

- [Default variant](modules/ably.html): This variant of the SDK always creates a fully-featured Ably client.
- [Modular (tree-shakable) variant](modules/modular.html): Aimed at those who are concerned about their app’s bundle size, this allows you to create a client which has only the functionality that you choose.

View the [Ably docs](https://ably.com/docs/) for conceptual information on using Ably, and for API references featuring all languages. The combined [API references](https://ably.com/docs/api/) are organized by features and split between the [realtime](https://ably.com/docs/api/realtime-sdk) and [REST](https://ably.com/docs/api/rest-sdk) interfaces.
