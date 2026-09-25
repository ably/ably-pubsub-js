/**
 * MessageMaterializer POC Demo
 *
 * Demonstrates:
 * 1. Streaming JSON via message.append (simulating AI/LLM token streaming)
 * 2. MessageMaterializer accumulating appends automatically
 * 3. toPartialJSON() rendering incomplete JSON at each step
 * 4. Late-joiner catching up via getMessage()
 *
 * Prerequisites:
 *   - An Ably app with a channel namespace (e.g., "ai") that has
 *     "Message annotations, updates, and deletes" (mutableMessages) enabled.
 *     See README.md for setup instructions.
 *
 * Usage:
 *   export ABLY_API_KEY="your-api-key"
 *   npm run build:node
 *   npx tsx examples/materializer-demo.ts
 */

import * as Ably from 'ably';
import { MessageMaterializer, MaterializedMessage } from '../src/plugins/materializer';

const API_KEY = process.env.ABLY_API_KEY;
if (!API_KEY) {
  console.error('Error: Set ABLY_API_KEY environment variable');
  process.exit(1);
}

// Channel namespace must have mutableMessages enabled in the Ably dashboard
const CHANNEL_NAMESPACE = process.env.ABLY_CHANNEL_NAMESPACE || 'ai';
const CHANNEL_NAME = `${CHANNEL_NAMESPACE}:materializer-demo-${Date.now()}`;

// Simulated AI response tokens — these build up a JSON object piece by piece
const JSON_START =
  '{"model": "claude-opus-4-20250514", "usage": {"input_tokens": 150, "output_tokens": 0}, "choices": [{"finish_reason": null, "message": {"role": "assistant", "content": "';

const TOKENS = [
  'The ',
  'quick ',
  'brown ',
  'fox ',
  'jumps ',
  'over ',
  'the ',
  'lazy ',
  'dog. ',
  'This ',
  'is ',
  'a ',
  'demonstration ',
  'of ',
  'streaming ',
  'AI ',
  'responses ',
  'over ',
  'Ably ',
  'using ',
  'message.append.',
];

const JSON_END = '"}}]}';

function showMessage(label: string, msg: MaterializedMessage): void {
  const parsed = msg.toPartialJSON<Record<string, unknown>>();
  console.log(`  [${label}] Partial JSON:`);
  if (parsed) {
    console.log(
      JSON.stringify(parsed, null, 2)
        .split('\n')
        .map((line) => '    ' + line)
        .join('\n'),
    );
  } else {
    console.log('    (not parseable as JSON)');
  }
  console.log();
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  console.log('=== MessageMaterializer POC Demo ===\n');
  console.log(`Channel: ${CHANNEL_NAME}\n`);

  // Create publisher client
  const publisher = new Ably.Realtime({ key: API_KEY, clientId: 'publisher' });
  await publisher.connection.once('connected');
  console.log('Publisher connected.');

  // Create subscriber client
  const subscriber = new Ably.Realtime({ key: API_KEY, clientId: 'subscriber-a' });
  await subscriber.connection.once('connected');
  console.log('Subscriber A connected.\n');

  const pubChannel = publisher.channels.get(CHANNEL_NAME);
  const subChannel = subscriber.channels.get(CHANNEL_NAME);

  // Set up Subscriber A with MessageMaterializer
  const materializerA = new MessageMaterializer(subChannel);

  // We need the serial from the first published message to send appends.
  // Get it from the subscriber's received create message.
  let appendCount = 0;
  const totalTokens = TOKENS.length + 1; // +1 for final JSON_END append

  const serialReady = new Promise<string>((resolve) => {
    const allAppendsDoneResolve = { resolve: () => {} };
    (globalThis as any).__allAppendsDone = new Promise<void>((r) => {
      allAppendsDoneResolve.resolve = r;
    });

    materializerA.subscribe((msg) => {
      if (msg.action === 'message.create') {
        console.log('--- Subscriber A: initial create ---');
        showMessage('A', msg);
        resolve(msg.serial);
      } else if (msg.action === 'message.append') {
        appendCount++;
        // Show every 7th append + the last token append + the final JSON_END append
        if (appendCount % 7 === 0 || appendCount === TOKENS.length || appendCount === totalTokens) {
          console.log(`--- Subscriber A: after ${appendCount}/${totalTokens} appends ---`);
          showMessage('A', msg);
        }
        if (appendCount === totalTokens) {
          allAppendsDoneResolve.resolve();
        }
      }
    });
  });

  // Publish initial message with start of JSON
  console.log('Publishing initial message...\n');
  await pubChannel.publish({ name: 'ai-response', data: JSON_START });

  // Wait for subscriber to receive it and give us the serial
  const messageSerial = await serialReady;

  // Stream tokens via message.append
  console.log('Streaming tokens via message.append...\n');
  for (let i = 0; i < TOKENS.length; i++) {
    try {
      await pubChannel.appendMessage({ serial: messageSerial, data: TOKENS[i] } as Ably.Message);
    } catch (err: any) {
      if (err.code === 93002) {
        console.error(
          '\nError: mutableMessages is not enabled for this channel namespace.\n' +
            'Go to your Ably dashboard > App Settings > Channel Rules and add a rule\n' +
            `for the "${CHANNEL_NAMESPACE}" namespace with "Message annotations, updates,\n` +
            'and deletes" enabled.\n',
        );
        process.exit(1);
      }
      throw err;
    }
    await sleep(100); // Simulate streaming delay
  }

  // Wait a bit before late-joiner
  await sleep(500);

  // === Late-joiner: Subscriber B connects mid-stream ===
  console.log('--- Late-joiner (Subscriber B) connecting... ---\n');

  const lateJoiner = new Ably.Realtime({ key: API_KEY, clientId: 'subscriber-b' });
  await lateJoiner.connection.once('connected');
  console.log('Subscriber B connected (with rewind — gets full materialized state).\n');

  // Late-joiner uses rewind to get history
  const lateChannel = lateJoiner.channels.get(CHANNEL_NAME, {
    params: { rewind: '100' },
  });

  const materializerB = new MessageMaterializer(lateChannel);

  const lateJoinerDone = new Promise<void>((resolve) => {
    materializerB.subscribe((msg) => {
      console.log(`--- Subscriber B (late-joiner): received ${msg.action} ---`);
      showMessage('B', msg);
      resolve();
    });
  });

  // Wait for late-joiner to get the rewind message
  await Promise.race([lateJoinerDone, sleep(5000)]);

  // Publish the closing JSON to complete the object
  console.log('Publishing final append (closing JSON structure)...\n');
  await pubChannel.appendMessage({ serial: messageSerial, data: JSON_END } as Ably.Message);

  // Wait for all appends to be received
  await Promise.race([(globalThis as any).__allAppendsDone, sleep(5000)]);
  await sleep(500);

  // Show final state from Subscriber A
  console.log('=== Final Materialized State (Subscriber A) ===\n');
  const messages = materializerA.getMessages();
  for (const msg of messages) {
    const parsed = msg.toPartialJSON<Record<string, unknown>>();
    if (parsed) {
      console.log(JSON.stringify(parsed, null, 2));
    }
  }

  // Cleanup
  console.log('\nDone.');
  materializerA.unsubscribe();
  materializerB.unsubscribe();
  publisher.close();
  subscriber.close();
  lateJoiner.close();
}

main().catch((err) => {
  console.error('Demo failed:', err);
  process.exit(1);
});
