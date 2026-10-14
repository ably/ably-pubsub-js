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
  /** The workflow type of the workflow that scheduled the activity. */
  workflowType: 'temporalWorkflowType',
  /** The ID of the activity that performed the operation. */
  activityId: 'temporalActivityId',
  /** The attempt number of the activity, starting at 1. */
  attempt: 'temporalAttempt',
} as const;

/**
 * The Temporal metadata that the Ably activities add to each published message's `extras.headers`.
 *
 * The workflow fields are absent when the activity was not started by a workflow.
 */
export interface TemporalMetadata {
  [TemporalMetadataKeys.namespace]: string;
  [TemporalMetadataKeys.workflowId]?: string;
  [TemporalMetadataKeys.runId]?: string;
  [TemporalMetadataKeys.workflowType]?: string;
  [TemporalMetadataKeys.activityId]: string;
  [TemporalMetadataKeys.attempt]: number;
}

/**
 * Returns the Temporal metadata for the activity that is currently executing. Works for both regular and local
 * activities. Must be called from within an activity.
 */
export function getTemporalMetadata(): TemporalMetadata {
  const info = Context.current().info;
  const metadata: TemporalMetadata = {
    [TemporalMetadataKeys.namespace]: info.namespace,
    [TemporalMetadataKeys.activityId]: info.activityId,
    [TemporalMetadataKeys.attempt]: info.attempt,
  };
  if (info.workflowExecution) {
    metadata[TemporalMetadataKeys.workflowId] = info.workflowExecution.workflowId;
    metadata[TemporalMetadataKeys.runId] = info.workflowExecution.runId;
  }
  if (info.workflowType !== undefined) {
    metadata[TemporalMetadataKeys.workflowType] = info.workflowType;
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
      result[key] = String(value);
    }
  }
  return result;
}
