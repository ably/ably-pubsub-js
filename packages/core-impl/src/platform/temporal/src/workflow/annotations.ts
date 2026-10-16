import type * as Ably from '@ably/pubsub-core/api';
import { ActivityNames } from '../common/activities.js';
import { requireObject, serialArgument } from './arguments.js';
import type { ActivityInvoker } from './invoker.js';
import { paginate, pageSummary, type TemporalAblyPaginatedResult } from './paginated.js';

const ANNOTATION_REMEDIATION =
  'Pass an Annotation-shaped object as the second argument, e.g. { type: "reaction:unique.v1", name: "👍" }.';

/**
 * Publishes and retrieves annotations on the messages of a channel from workflow code. It mirrors the Ably
 * `HttpAnnotations`, and is obtained from `TemporalAblyRestChannel.annotations`.
 *
 * Each method runs as a Temporal activity. Message annotations must be enabled for the channel's namespace by a
 * rule, or the activity fails.
 *
 * When idempotent publishing is enabled (see `TemporalAblyRestOptions.idempotentPublishing`), an annotation published
 * or deleted without an `id` is sent with an ID of the form `<base>:0`. The workflow derives the base
 * deterministically, so every attempt of the activity sends the same ID, and Ably deduplicates a retry that arrives
 * within its deduplication window. The object passed in is not modified.
 */
export class TemporalAblyRestAnnotations {
  /** @internal */
  constructor(
    private readonly invoker: ActivityInvoker,
    private readonly channel: string,
  ) {}

  /**
   * Publishes an annotation for a message. If the annotation specifies no `action`, it defaults to
   * `annotation.create`. Runs as a Temporal activity.
   *
   * @param messageOrSerial - The message to annotate, or its `serial`. A message must have a populated `serial`.
   * @param annotation - The annotation to publish. It must include at least the `type`.
   * @returns A promise which is fulfilled when the annotation has been published.
   */
  async publish(messageOrSerial: Ably.Message | string, annotation: Ably.OutboundAnnotation): Promise<void> {
    requireObject('annotations.publish', 'the annotation', annotation, ANNOTATION_REMEDIATION);
    await this.invoker.invoke(ActivityNames.annotationsPublish, `annotations.publish ${this.channel}`, {
      channel: this.channel,
      messageOrSerial: serialArgument('annotations.publish', messageOrSerial),
      annotation: this.invoker.assignMessageIds([annotation])[0],
    });
  }

  /**
   * Publishes a request to remove an annotation from a message's annotation summary. The annotation is sent with
   * its `action` set to `annotation.delete`. Runs as a Temporal activity.
   *
   * @param messageOrSerial - The message to remove the annotation from, or its `serial`. A message must have a
   * populated `serial`.
   * @param annotation - The annotation deletion request. It must include at least the `type`.
   * @returns A promise which is fulfilled when the deletion request has been published.
   */
  async delete(messageOrSerial: Ably.Message | string, annotation: Ably.OutboundAnnotation): Promise<void> {
    requireObject('annotations.delete', 'the annotation', annotation, ANNOTATION_REMEDIATION);
    await this.invoker.invoke(ActivityNames.annotationsDelete, `annotations.delete ${this.channel}`, {
      channel: this.channel,
      messageOrSerial: serialArgument('annotations.delete', messageOrSerial),
      annotation: this.invoker.assignMessageIds([annotation])[0],
    });
  }

  /**
   * Retrieves the annotations for a message. Runs as a Temporal activity.
   *
   * @param messageOrSerial - The message to get annotations for, or its `serial`. A message must have a populated
   * `serial`.
   * @param params - Restrictions on which annotations to get, such as a `limit`.
   * @returns A promise which is fulfilled with the first page of {@link Ably.Annotation} objects.
   */
  async get(
    messageOrSerial: Ably.Message | string,
    params: Ably.GetAnnotationsParams | null,
  ): Promise<TemporalAblyPaginatedResult<Ably.Annotation>> {
    const serial = serialArgument('annotations.get', messageOrSerial);
    return paginate(
      (pageParams, relation) =>
        this.invoker.invoke(ActivityNames.annotationsGet, pageSummary(`annotations.get ${this.channel}`, relation), {
          channel: this.channel,
          messageOrSerial: serial,
          params: pageParams ?? null,
        }),
      params ?? undefined,
    );
  }
}
