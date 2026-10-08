# MessageMaterializer — Proof of Concept

## What This Is

A proof of concept demonstrating two convenience features that we believe the SDK should offer natively, motivated by the AI/LLM token streaming use case.

## Problem 1 — Message Materialization

Users streaming data via Ably's `message.append` (e.g., AI/LLM token streaming) must manually:
- Track message serials
- Accumulate appended data chunks
- Handle late-join (fetching current state from history)
- Deal with ordering and version watermarks

The `MessageMaterializer` handles all of this automatically. Subscribing emits the full materialized message (original data + all appends concatenated), similar to how annotations emit the full summary so users don't have to apply incremental updates.

## Problem 2 — Partial JSON Rendering

When streaming JSON (e.g., structured AI responses), the accumulated data is often incomplete JSON at any given point during the stream. For example:

```
{"model": "claude-opus-4-20250514", "choices": [{"message": {"content": "The quick bro
```

`toPartialJSON()` parses this into a valid partial object:

```json
{
  "model": "claude-opus-4-20250514",
  "choices": [
    {
      "message": {
        "content": "The quick bro"
      }
    }
  ]
}
```

This lets users display structured data progressively as it streams in.

## Why Coupled

Both features address the same use case (streaming AI responses over Ably) and the materializer is the natural place to offer partial JSON since it's already managing the accumulated state.

## Status

**POC only. Not intended for production.**

- The `partial-json` parser is vendored inline (~280 lines); dependency decisions would be made if this moves to production
- The API surface may change

## Prerequisites — Channel Namespace Setup

The `message.append` (and `message.update`/`message.delete`) operations require **mutableMessages** to be enabled on the channel namespace. Without this, append operations will fail with error code `93002`.

### Setup Steps

1. Go to the [Ably Dashboard](https://ably.com/accounts)
2. Select your app
3. Go to **Settings** > **Channel Rules**
4. Add a new channel rule (or edit an existing one):
   - **Namespace**: `ai` (or whatever namespace you want to use)
   - Enable **"Message annotations, updates, and deletes"** (this enables `mutableMessages`)
5. Save the rule

Your channels must then use the namespace prefix, e.g., `ai:my-channel`.

## Usage

```typescript
import * as Ably from 'ably';
import { MessageMaterializer } from './src/plugins/materializer';

// Channel must use a namespace with mutableMessages enabled
const client = new Ably.Realtime({ key: 'your-api-key' });
const channel = client.channels.get('ai:my-channel');

const materializer = new MessageMaterializer(channel);

materializer.subscribe((msg) => {
  // msg.data contains the full accumulated string (original + all appends)
  console.log('Accumulated:', msg.data);

  // Parse incomplete JSON for structured rendering
  const parsed = msg.toPartialJSON();
  console.log('Partial JSON:', JSON.stringify(parsed, null, 2));
});
```

## How to Run the Demo

```bash
# Build the SDK first (demo imports from the local build)
npm run build:node

# Set your Ably API key
export ABLY_API_KEY="your-api-key"

# Optionally set the channel namespace (defaults to "ai")
export ABLY_CHANNEL_NAMESPACE="ai"

# Run with tsx
npx tsx examples/materializer-demo.ts
```

The demo creates a publisher and two subscribers (one immediate, one late-joiner) to show:
1. Progressive accumulation of appended data
2. `toPartialJSON()` rendering at each step
3. Late-join catch-up via `getMessage()`
4. The complete final JSON object

## Architecture

```
src/plugins/materializer/
├── index.ts                  # Barrel export
├── messagematerializer.ts    # Core class
├── partial-json.ts           # Vendored partial JSON parser
└── README.md                 # This file
```

The `MessageMaterializer` sits between the Ably channel and the user's listener:

```
Channel → MessageMaterializer → User Listener
              ↕
         Internal Cache
        (Map<serial, msg>)
              ↕
        getMessage() for
         late-join fetch
```
