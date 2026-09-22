'use strict';

const err = new Error("'ably/promises' was the v1 entry point and is no longer available.");
err.remediation =
  "ably-js v2 is promise-only — import from '@ably/pubsub-core' directly. See https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md";
throw err;
