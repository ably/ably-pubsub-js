'use strict';

const err = new Error("'ably/callbacks' was the v1 callback API entry point and is no longer available.");
err.remediation =
  "ably-js v2 is promise-only — import from '@ably/pubsub-core' directly and switch to await / .then(). See https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md";
throw err;
