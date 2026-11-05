// Records the arguments of every activity a workflow schedules, through a sink that is also called during
// replay. Comparing the arguments recorded by a replay with those recorded by the original run shows whether the
// workflow-side proxy computes the same activity inputs, including generated message IDs, on replay.

import { proxySinks, type Sinks, type WorkflowInterceptorsFactory } from '@temporalio/workflow';

export interface RecorderSinks extends Sinks {
  recorder: {
    scheduled(activityType: string, args: unknown[], local: boolean): void;
  };
}

const { recorder } = proxySinks<RecorderSinks>();

export const interceptors: WorkflowInterceptorsFactory = () => ({
  outbound: [
    {
      scheduleActivity(input, next) {
        recorder.scheduled(input.activityType, input.args, false);
        return next(input);
      },
      scheduleLocalActivity(input, next) {
        recorder.scheduled(input.activityType, input.args, true);
        return next(input);
      },
    },
  ],
});
