// The Temporal plugin's workflow entry point, bundled from the private implementation. Temporal bundles it into its
// deterministic workflow sandbox, so it imports nothing of the Ably runtime, only `@temporalio/workflow` and
// `@temporalio/common`. The plugin's ESLint configuration enforces that on its workflow-side sources.
export * from '../../core-impl/src/platform/temporal/src/workflow';
