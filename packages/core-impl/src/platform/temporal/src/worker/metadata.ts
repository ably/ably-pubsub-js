import { Context } from '@temporalio/activity';

/**
 * The keys under which the Ably activities record the Temporal execution that performed an operation.
 *
 * For a publish, they are added to each message's `extras.headers`, where subscribers can read them, or use them
 * in a subscription filter. For an update, delete or append, they are added to the operation's `metadata`.
 */
export const TemporalMetadataKeys = {
  /** The Temporal namespace that the activity ran in. */
  namespace: 'temporalNamespace',
  /** The ID of the workflow that scheduled the activity. */
  workflowId: 'temporalWorkflowId',
  /** The run ID of the workflow that scheduled the activity. */
  runId: 'temporalRunId',
} as const;

/**
 * The Temporal metadata that the Ably activities add to each published message's `extras.headers`.
 *
 * The workflow ID and run ID are absent when the activity was not started by a workflow. None of the values differs
 * between attempts of an activity, so every attempt sends the same metadata.
 */
export interface TemporalMetadata {
  [TemporalMetadataKeys.namespace]: string;
  [TemporalMetadataKeys.workflowId]?: string;
  [TemporalMetadataKeys.runId]?: string;
}

/**
 * Returns the Temporal metadata for the activity that is currently executing. Works for both regular and local
 * activities. Must be called from within an activity.
 */
export function getTemporalMetadata(): TemporalMetadata {
  const info = Context.current().info;
  const metadata: TemporalMetadata = {
    [TemporalMetadataKeys.namespace]: info.namespace,
  };
  if (info.workflowExecution) {
    metadata[TemporalMetadataKeys.workflowId] = info.workflowExecution.workflowId;
    metadata[TemporalMetadataKeys.runId] = info.workflowExecution.runId;
  }
  return metadata;
}

/**
 * Converts Temporal metadata to the string-to-string map that `MessageOperation.metadata` requires.
 */
export function toStringMetadata(metadata: TemporalMetadata): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}
