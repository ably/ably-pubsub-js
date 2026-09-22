# CLAUDE.md

Guidance for coding agents (and humans) working in this repository.

## Repository Overview

ably-js is a monorepo. The published packages live under `packages/`:

- `packages/core` — the Ably realtime and REST client library for JavaScript/TypeScript, published as `@ably/pubsub-core`, targeting browsers, Node.js and React Native. Its public API surface is defined in [ably.d.ts](./packages/core/ably.d.ts), and its source lives in `packages/core/src/` (`common/` for shared client logic, `platform/` for platform-specific code and React hooks).
- `packages/device` and `packages/server` — thin per-side wrappers over the core, published as `@ably/pubsub-device` and `@ably/pubsub-server`. See [Per-side packages](./CONTRIBUTING.md#per-side-packages).
- `packages/shared` — private helpers bundled into the two wrappers rather than published.

All three published packages are npm workspaces, so `node_modules/@ably/pubsub-core` is a symlink to `packages/core`. The build tooling (Gruntfile, `grunt/`, `webpack.config.js`, `scripts/`) and every dev dependency live at the repo root and serve all packages, so run every command below from there.

## Commands

```bash
npm run build          # Full build (webpack; slow). Platform-specific: build:node, build:browser, ...
npm test               # Build + run the Mocha test suite
npm run test:node -- packages/core/test/realtime/auth.test.js   # Run one test file
npm run test:node -- --grep=test_name_here        # Run tests matching a pattern
npm run lint           # ESLint (lint:fix to autofix)
npm run format         # Prettier write (format:check to verify)
npm run docs           # Generate TypeDoc from packages/core/ably.d.ts
npm run check:packages # Typecheck the per-side wrapper packages against the core
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full test-suite, debugging, and release documentation.

## Coding Conventions

### Error codes

`ErrorInfo.code` is typed as `ErrorCode`, a union of every code registered in [ably-common](https://github.com/ably/ably-common/tree/main/errors/codes). It is generated into [errorcodes.ts](./packages/core/src/common/lib/types/errorcodes.ts) from the pinned `ably-common` submodule and committed. CI regenerates it at that pin and fails on a diff, so never hand-edit it.

Pick the registered code whose `identifier` matches the failure, and pair it with the HTTP status that code's registry entry documents. `statusCode` is a plain `number`, so a wrong status still compiles — check it against the registry rather than copying a neighbouring call.

If the code you need is not in the union, `tsc` rejects it:

```text
error TS2345: Argument of type '40199' is not assignable to parameter of type 'ErrorCode'.
```

That means the code is not registered. Do not cast around it. Instead:

1. Add the code under `errors/codes/` in [ably-common](https://github.com/ably/ably-common) and get that merged.
2. Bump the `packages/core/test/common/ably-common` submodule pin here to a commit that contains it.
3. Run `npm run generate:errorcodes-ts` and commit the regenerated `errorcodes.ts`.

Errors decoded from the server are exempt: the server chose the code and may use one this client version does not know about, so build those with `ErrorInfo.fromWireValues` instead of `ErrorInfo.fromValues`.

### Error messages and remediations

Errors constructed by the SDK (`ErrorInfo` / `PartialErrorInfo`) carry a `message` and, in most cases, a `remediation` (see the `ErrorInfo.remediation` docstring in [ably.d.ts](./packages/core/ably.d.ts)). The two fields have distinct jobs:

- `message` says **what went wrong**: the failure and the condition that triggered it, written declaratively.
- `remediation` says **how to fix it**: the first thing the developer (or coding agent) reading the error should do, written imperatively. It must be actionable without further lookup.

For example:

```javascript
message: 'authUrl response is missing a Content-Type header',
remediation: 'Set a Content-Type response header on your authUrl endpoint: application/json for a TokenDetails/TokenRequest object, text/plain for a token string, or application/jwt for a JWT.',
```

#### When to add a remediation

Add a remediation to every SDK-originating throw site that a user of the public API can plausibly reach, provided it adds concrete value beyond the message: it names the exact fix (the API call, `ClientOptions` field, or config change), forecasts a server-side or dashboard-level wall the SDK cannot see from inside the process, or points at a diagnostic.

Do not add a remediation when:

- The site is only reachable internally, not via the public API. Leave a short comment saying so instead.
- The error is relayed from the server rather than authored by the SDK, so the SDK cannot know the remediation.
- All you can write is a rewording of the message. Improve the `message` instead; a remediation that restates the message is noise.

#### Writing rules

- **Accuracy is non-negotiable.** Verify every claim against the code path the error actually fires on, and against the Ably docs. A wrong remediation is worse than none: it sends the reader down a path the SDK has told them is correct.
- Never recommend a call that itself throws or errors in the state the error fires in. If one of the offered remedies errors when misapplied, say so in one line.
- Reference only public API, named exactly as the caller sees it (`presence.enterClient`, `ClientOptions.defaultTokenParams`), never internal identifiers or unshipped features.
- One instruction per sentence, separated by full stops rather than semicolons. Put facts in sentences, not parentheticals. No markdown or links: the string renders raw in consoles and logs.
- Phrase external-tool diagnostics conditionally ("If you have the Ably CLI installed, ..."), never imperatively, since the reader may not have the tool.
- Keep it concise, typically one to four sentences, and keep the wording consistent with sibling errors in the same family.
