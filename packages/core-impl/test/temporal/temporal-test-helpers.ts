/**
 * Helpers shared by the end-to-end and sandbox tests, which run workflows on a local Temporal server with the built
 * plugin: installing a quiet Temporal runtime, reading a workflow's history, and deriving from that history the
 * Temporal metadata that the plugin should have recorded.
 */

import type { WorkflowHandle } from '@temporalio/client';
import { defaultPayloadConverter, IllegalStateError } from '@temporalio/common';
import { temporal } from '@temporalio/proto';
import { DefaultLogger, Runtime } from '@temporalio/worker';
import { expect } from 'chai';

export const EventType = temporal.api.enums.v1.EventType;
export const RetryState = temporal.api.enums.v1.RetryState;
export type HistoryEvent = temporal.api.history.v1.IHistoryEvent;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * Installs a Temporal runtime that only logs errors, because several tests fail activities and workflows on
 * purpose. The runtime shuts itself down once the suite's workers and test environment are closed, so a later
 * suite can install its own. If a runtime is still installed, it is used as it is.
 */
export function installTestRuntime(): void {
  try {
    Runtime.install({ logger: new DefaultLogger('ERROR') });
  } catch (err) {
    if (!(err instanceof IllegalStateError)) {
      throw err;
    }
  }
}

/** The messages of an error and its causes, for a test failure message. */
export function causeChain(err: unknown): string {
  const messages: string[] = [];
  for (let current = err; current != null && messages.length < 10; current = (current as { cause?: unknown }).cause) {
    messages.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current));
  }
  return messages.join(' <- ');
}

export async function historyEvents(handle: WorkflowHandle): Promise<HistoryEvent[]> {
  return (await handle.fetchHistory()).events ?? [];
}

export function eventsOfType(events: HistoryEvent[], type: temporal.api.enums.v1.EventType): HistoryEvent[] {
  return events.filter((event) => event.eventType === type);
}

/** An activity task in a workflow history, with the attempt that completed it and the input it was scheduled with. */
export interface HistoryActivity {
  activityId: string;
  activityType: string;
  /** The attempt recorded by the activity's `ActivityTaskStarted` event, which is that of the last attempt. */
  attempt: number;
  input: any;
}

/** The activity tasks in a workflow history, in the order they were scheduled. */
export function historyActivities(events: HistoryEvent[]): HistoryActivity[] {
  return eventsOfType(events, EventType.EVENT_TYPE_ACTIVITY_TASK_SCHEDULED).map((scheduled) => {
    const attributes = scheduled.activityTaskScheduledEventAttributes!;
    const started = eventsOfType(events, EventType.EVENT_TYPE_ACTIVITY_TASK_STARTED).find(
      (event) => String(event.activityTaskStartedEventAttributes!.scheduledEventId) === String(scheduled.eventId),
    );
    const [payload] = attributes.input?.payloads ?? [];
    return {
      activityId: attributes.activityId!,
      activityType: attributes.activityType!.name!,
      attempt: started?.activityTaskStartedEventAttributes?.attempt ?? 0,
      input: payload ? defaultPayloadConverter.fromPayload(payload) : undefined,
    };
  });
}

/** The fields of the `WorkflowExecutionStarted` event that the plugin's metadata is derived from. */
export function workflowStarted(events: HistoryEvent[]): { runId: string } {
  const attributes = events[0].workflowExecutionStartedEventAttributes!;
  return { runId: attributes.originalExecutionRunId! };
}

/**
 * The `extras.headers` that the plugin adds to a message published by an activity of the workflow, as derived from
 * the workflow history. They are the same for every activity and every attempt of the run.
 */
export function expectedHeaders(namespace: string, workflowId: string, events: HistoryEvent[]): Record<string, string> {
  return {
    temporalNamespace: namespace,
    temporalWorkflowId: workflowId,
    temporalRunId: workflowStarted(events).runId,
  };
}

/**
 * The operation `metadata` that the plugin adds to an update, delete or append by an activity of the workflow. It has
 * the same entries as {@link expectedHeaders}.
 */
export function expectedOperationMetadata(
  namespace: string,
  workflowId: string,
  events: HistoryEvent[],
): Record<string, string> {
  return expectedHeaders(namespace, workflowId, events);
}

/**
 * Checks that `ids` are the IDs generated for one publish, `<base>:0`, `<base>:1` and so on, where the base is a
 * UUID, and returns the base.
 */
export function expectGeneratedIds(ids: unknown[]): string {
  expect(ids).to.have.length.greaterThan(0);
  const base = String(ids[0]).replace(/:0$/, '');
  expect(base).to.match(UUID_PATTERN);
  expect(ids).to.deep.equal(ids.map((_, index) => `${base}:${index}`));
  return base;
}
