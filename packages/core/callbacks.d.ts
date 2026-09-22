/**
 * @deprecated `'ably/callbacks'` was the v1 callback API entry point and has been removed in ably-js v2.
 * v2 is promise-only — import from `'@ably/pubsub-core'` directly and switch to `await` / `.then()`.
 *
 * Importing this subpath throws at module load with the migration link.
 *
 * @see https://github.com/ably/ably-js/blob/main/docs/migration-guides/v2/lib.md
 */
declare const ablyCallbacksV1EntryPointRemoved: never;
export = ablyCallbacksV1EntryPointRemoved;
