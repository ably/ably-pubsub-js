/**
 * The workflow side of the Temporal plugin: `TemporalAblyHttpClient`, which runs each Ably operation as an activity
 * on a worker with `AblyHttpPlugin` from `@ably/pubsub-server/temporal`, and `startAblyRelay` with
 * `ablyRelayWorkflow`, which relay a workflow's Workflow Stream to Ably channels through `AblyRelayPlugin`.
 *
 * The declarations are emitted from the plugin's source by `tsc` (`npm run build:temporal:types`).
 */
export * from '../../dist/temporal-types/workflow.js';
