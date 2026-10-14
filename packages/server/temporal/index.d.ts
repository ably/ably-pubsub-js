/**
 * The worker side of the Temporal plugin: `AblyHttpPlugin`, which registers the Ably activities on a Temporal worker.
 * Workflow code imports from `@ably/pubsub-server/temporal/workflow` instead.
 *
 * The declarations are emitted from the plugin's source by `tsc` (`npm run build:temporal:types`).
 */
export * from '../dist/temporal-types/index.js';
