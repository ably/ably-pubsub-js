// Replays histories of the relay recorded by an earlier version of this package, to catch a change to
// startAblyRelay(), relay.complete() or ablyRelayWorkflow that would break workflows already running when a worker is
// upgraded. Temporal replays a running workflow's history on the new code, and fails the workflow task if the new
// code makes different commands.
//
// The histories in ./histories/relay/ were recorded from ./workflows/relay-replay.ts. Keep every one of them: each
// stands for workflows that may still be running somewhere. When a change makes one fail, guard the change with
// patched() rather than recording the history again. To add a history, add its case to CASES and record the new ones:
//
//   RECORD_RELAY_HISTORIES=1 TSX_TSCONFIG_PATH=packages/core-impl/test/uts/tsconfig.json npx mocha --no-config \
//     --exit --require tsx/cjs --timeout 180000 packages/core-impl/test/temporal/workflow/relay-replay.test.ts
//
// Recording writes only the histories that don't exist yet.

import * as fs from 'fs';
import * as path from 'path';
import { historyFromJSON, historyToJSON } from '@temporalio/common/lib/proto-utils';
import type { WorkflowHandle } from '@temporalio/client';
import { TestWorkflowEnvironment } from '@temporalio/testing';
import { bundleWorkflowCode, DefaultLogger, Worker, type WorkflowBundleWithSourceMap } from '@temporalio/worker';
import type { RealtimeChannelPool, RealtimePublisherChannel } from '@ably/pubsub-server';
import { ApplicationFailure } from '@temporalio/common';
import { expect } from 'chai';
import type { RelayAdaptorFactory } from '../../../src/platform/temporal/src/worker/relay/adaptor';
import { createRelayActivities } from '../../../src/platform/temporal/src/worker/relay/activity';
import { installTestRuntime } from '../temporal-test-helpers';
import type { RelayReplaySourceInput } from './workflows/relay-replay';

const HISTORIES = path.join(__dirname, 'histories', 'relay');
const WORKFLOWS = path.join(__dirname, 'workflows', 'relay-replay.ts');
const TASK_QUEUE = 'ably-temporal-relay-replay';

/** The run of a case whose history is kept: the source's runs, in order, then the relay. */
type Run = 'source' | 'source-continued' | 'relay';

interface Case {
  name: string;
  input: RelayReplaySourceInput;
  runs: Run[];
}

const CASES: Case[] = [
  {
    // complete() resolves as succeeded once the relay signals.
    name: 'succeeded',
    input: {
      routes: [{ topics: ['agent'], adaptor: 'recording', channel: 'chat' }],
      events: [
        ['agent', 'a'],
        ['status', 'ignored'],
        ['agent', 'b'],
      ],
    },
    runs: ['source', 'relay'],
  },
  {
    // The source continues as new part way, and its second run starts no relay.
    name: 'continued-as-new',
    input: {
      routes: [{ topics: ['agent'], adaptor: 'recording', channel: 'chat' }],
      events: ['a', 'b', 'c', 'd'].map((data) => ['agent', data]),
      continueAsNewAfter: 2,
    },
    runs: ['source', 'source-continued', 'relay'],
  },
  {
    // One route fails: the relay signals the outcomes and then fails, and complete() resolves as failed.
    name: 'route-failed',
    input: {
      routes: [
        { topics: ['bad'], adaptor: 'poison', channel: 'broken' },
        { topics: ['agent'], adaptor: 'recording', channel: 'healthy' },
      ],
      events: [
        ['agent', 'a'],
        ['bad', 'x'],
      ],
    },
    runs: ['source', 'relay'],
  },
  {
    // The relay never reports, so complete()'s timer fires and it resolves as timed-out.
    name: 'timed-out',
    input: {
      routes: [{ topics: ['agent'], adaptor: 'stalled', channel: 'chat' }],
      events: [['agent', 'a']],
      completeTimeoutMs: 1000,
    },
    runs: ['source'],
  },
];

/**
 * A recorded history, with the workflow ID it ran under. The relay's ID and its source's both appear in the commands
 * that the replay compares, so the replay must run under the same ID.
 */
interface RecordedHistory {
  workflowId: string;
  history: unknown;
}

function historyPath(name: string, run: Run): string {
  return path.join(HISTORIES, `${name}.${run}.json`);
}

describe('temporal relay replay of recorded histories', function () {
  this.timeout(180_000);

  let workflowBundle: WorkflowBundleWithSourceMap;

  before(async function () {
    installTestRuntime();
    workflowBundle = await bundleWorkflowCode({ workflowsPath: WORKFLOWS, logger: new DefaultLogger('WARN') });
    if (process.env.RECORD_RELAY_HISTORIES) {
      await recordMissingHistories(workflowBundle);
    }
  });

  for (const { name, runs } of CASES) {
    for (const run of runs) {
      it(`replays the ${run} history of the ${name} case`, async function () {
        const file = historyPath(name, run);
        expect(fs.existsSync(file), `${file} is missing: record it as this file's header says`).to.equal(true);
        const recorded: RecordedHistory = JSON.parse(fs.readFileSync(file, 'utf8'));
        await Worker.runReplayHistory({ workflowBundle }, historyFromJSON(recorded.history), recorded.workflowId);
      });
    }
  }
});

/** Runs each case whose histories aren't all recorded on a local Temporal server, and writes its histories. */
async function recordMissingHistories(workflowBundle: WorkflowBundleWithSourceMap): Promise<void> {
  const missing = CASES.filter(({ name, runs }) => runs.some((run) => !fs.existsSync(historyPath(name, run))));
  if (missing.length === 0) {
    return;
  }
  const adaptors: Record<string, RelayAdaptorFactory> = {
    recording: () => ({
      write: () => {},
      flush: async () => ({ handoff: null }),
      close: async () => ({ handoff: null }),
    }),
    poison: () => ({
      write: () => {
        throw ApplicationFailure.nonRetryable('this adaptor always fails', 'PoisonedAdaptor');
      },
      flush: async () => ({ handoff: null }),
      close: async () => ({ handoff: null }),
    }),
    stalled: () => ({
      write: () => {},
      flush: async () => {
        throw new Error('stalled');
      },
      close: async () => {
        throw new Error('stalled');
      },
    }),
  };
  const pool = {
    get: (name: string) => ({ name, release: () => {} }) as unknown as RealtimePublisherChannel,
  } as unknown as RealtimeChannelPool;

  const env = await TestWorkflowEnvironment.createLocal();
  const worker = await Worker.create({
    connection: env.nativeConnection,
    namespace: env.namespace ?? 'default',
    taskQueue: TASK_QUEUE,
    workflowBundle,
    activities: createRelayActivities(pool, adaptors),
  });
  const workerRun = worker.run();
  try {
    fs.mkdirSync(HISTORIES, { recursive: true });
    for (const { name, input, runs } of missing) {
      const source = await env.client.workflow.start('relayReplaySource', {
        taskQueue: TASK_QUEUE,
        workflowId: `relay-replay-${name}`,
        args: [input],
      });
      await source.result();
      const relay = env.client.workflow.getHandle(`${source.workflowId}:ably:${source.firstExecutionRunId}`);
      if (runs.includes('relay')) {
        await relay.result().catch(() => {});
      } else {
        await relay.terminate().catch(() => {});
      }
      const latestRunId = (await env.client.workflow.getHandle(source.workflowId).describe()).runId;
      const handles: Record<Run, WorkflowHandle> = {
        source: env.client.workflow.getHandle(source.workflowId, source.firstExecutionRunId),
        'source-continued': env.client.workflow.getHandle(source.workflowId, latestRunId),
        relay,
      };
      for (const run of runs) {
        const handle = handles[run];
        const recorded: RecordedHistory = {
          workflowId: handle.workflowId,
          history: JSON.parse(historyToJSON(await handle.fetchHistory())),
        };
        fs.writeFileSync(historyPath(name, run), JSON.stringify(recorded, null, 2) + '\n');
      }
    }
  } finally {
    worker.shutdown();
    await workerRun;
    await env.teardown();
  }
}
