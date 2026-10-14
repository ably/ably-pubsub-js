# Builds

Every artifact the ably-pubsub-js build publishes, by package. `npm run build` (from the repo root) produces all of them. The bundler configuration lives in [grunt/esbuild/build.js](../grunt/esbuild/build.js), [webpack.config.js](../webpack.config.js) and the [Gruntfile](../Gruntfile.js).

| Package               | Built into     | What it is                                                               |
| --------------------- | -------------- | ------------------------------------------------------------------------ |
| `@ably/pubsub-core`   | `core/build/`  | The API declarations and the runtime shared with SDKs layered on Pub/Sub |
| `@ably/pubsub-device` | `device/dist/` | The client for end users' devices, on npm and on the CDN                 |
| `@ably/pubsub-server` | `server/dist/` | The client for infrastructure you operate                                |

Unless stated otherwise, every bundle:

- targets ES2020 and ships a sourcemap (`.map`) next to it, except the React Native pair, which webpack builds without one,
- comes as a CommonJS `.js` and an ESM `.mjs` pair,
- imports its npm dependencies rather than inlining them: `@ably/pubsub-core`, so the app has one copy of `ErrorInfo` and the rest of the shared runtime, and `ws` and `got` on Node.js, `dequal` for LiveObjects and `ulid` for push. npm installs these with the package, so the app never declares them. `react` and `react-dom` are imported the same way, but they are optional peer dependencies, which the app provides when it uses the React hooks.

Two build-time choices tell the bundles apart:

- **Logs.** A stripped bundle removes every log below error level, except the few marked to be kept. The `@ably/pubsub-device` root on the web and React Native, its modular variant and its CDN bundle strip, and the `debug` bundles are their full-logging counterparts. The root's Node.js bundle and every `@ably/pubsub-server` bundle keep every log.
- **MessagePack.** A bundle either includes the codec, or leaves it to the `MsgPack` plugin, in which case `useBinaryProtocol: true` without the plugin throws 40019. `useBinaryProtocol` defaults to `true` on Node.js and `false` everywhere else.

## `@ably/pubsub-core`

Built by `grunt build:core`, with esbuild and `tsc`.

| File                    | Export                                       | Contents                                                              |
| ----------------------- | -------------------------------------------- | --------------------------------------------------------------------- |
| `build/index.js`/`.mjs` | `.`                                          | `ErrorInfo`, `PartialErrorInfo` and `EventEmitter`, for every runtime |
| `build/*.d.ts`          | —                                            | Declarations of that runtime, emitted by `tsc`                        |
| `index.d.mts`           | `.` (ESM)                                    | Generated from `index.d.ts`                                           |
| `liveobjects*.d.mts`    | `./liveobjects`, `./liveobjects-types` (ESM) | Generated from their `.d.ts` counterparts                             |

The rest of the package is hand-written declarations (`ably.d.ts`, `types.d.ts`, `http.d.ts`, …), which are not built.

## `@ably/pubsub-device`

### npm bundles

Built by `grunt build:packages`. All are esbuild bundles, except the React Native pair (webpack) and the React hooks (`tsc`).

| File                                    | Export                           | Condition                | Logs     | MessagePack |
| --------------------------------------- | -------------------------------- | ------------------------ | -------- | ----------- |
| `dist/index.js`/`.mjs`                  | `.`                              | web (`require`/`import`) | Stripped | Plugin      |
| `dist/node.js`/`.mjs`                   | `.`, `./debug`                   | `node`                   | Full     | Included    |
| `dist/react-native.js` (CJS only)       | `.`                              | `react-native`           | Stripped | Plugin      |
| `dist/debug.js`/`.mjs`                  | `./debug`                        | web (`require`/`import`) | Full     | Plugin      |
| `dist/debug-react-native.js` (CJS only) | `./debug`                        | `react-native`           | Full     | Plugin      |
| `dist/modular.mjs` (ESM only)           | `./modular`                      | `import`                 | Stripped | Plugin      |
| `dist/msgpack.js`/`.mjs`                | `./msgpack`                      | web (`require`/`import`) | —        | The plugin  |
| `dist/msgpack-node.js`/`.mjs`           | `./msgpack`                      | `node`                   | —        | The plugin  |
| `dist/liveobjects.js`/`.mjs`            | `./liveobjects`                  | `require`/`import`       | Full     | —           |
| `dist/push.js`/`.mjs`                   | `./push`                         | `require`/`import`       | Full     | —           |
| `dist/react-native-push.js`/`.mjs`      | `./react-native-push`            | `require`/`import`       | Full     | —           |
| `dist/react/cjs/`, `dist/react/mjs/`    | `./react`, `./liveobjects/react` | `require`/`import`       | —        | —           |

On Node.js, `./debug` resolves to the root's bundle, since that bundle already keeps every log.

The React hooks are compiled with `tsc` into one module per source file rather than bundled, so that `./react` and `./liveobjects/react` share the module holding the React context.

The `.d.mts` files next to each subpath's `index.d.ts` are generated from it by `grunt build:packages:types`.

### CDN bundles

Built by `grunt build:packages:cdn` into `dist/cdn/`, as UMD bundles. Unlike the npm bundles, they inline everything, `@ably/pubsub-core` included, since a script tag has no module resolution to share it through. Each comes unminified and minified (`.min.js`).

| File                 | Global                  | Logs     | MessagePack |
| -------------------- | ----------------------- | -------- | ----------- |
| `ably.js`            | `AblyPubSub`            | Stripped | Plugin      |
| `ably.debug.js`      | `AblyPubSub`            | Full     | Plugin      |
| `msgpack.umd.js`     | `AblyMsgPackPlugin`     | —        | The plugin  |
| `liveobjects.umd.js` | `AblyLiveObjectsPlugin` | Full     | —           |
| `push.umd.js`        | `AblyPushPlugin`        | Full     | —           |

[scripts/cdn_deploy.js](../scripts/cdn_deploy.js) uploads each `.js` once per version prefix, so release 3.1.0 serves `ably.min.js` as `ably.min-3.js`, `ably.min-3.1.js` and `ably.min-3.1.0.js` under `https://cdn.ably.com/lib/`. The sourcemaps are not uploaded, and the minified files have their `sourceMappingURL` comment removed.

## `@ably/pubsub-server`

Built by `grunt build:packages`, with esbuild. Every log is kept, and MessagePack is always included.

| File                               | Export                | Condition          | Runtime                                      |
| ---------------------------------- | --------------------- | ------------------ | -------------------------------------------- |
| `dist/node.js`/`.mjs`              | `.`                   | `node`             | Node.js                                      |
| `dist/index.js`/`.mjs`             | `.`                   | `require`/`import` | Any other runtime, on the web implementation |
| `dist/liveobjects.js`/`.mjs`       | `./liveobjects`       | `require`/`import` | Every runtime                                |
| `dist/temporal.js`/`.mjs`          | `./temporal`          | `require`/`import` | Node.js, in a Temporal worker                |
| `dist/temporal-workflow.js`/`.mjs` | `./temporal/workflow` | `require`/`import` | Temporal's workflow sandbox                  |

The two Temporal bundles leave the `@temporalio/*` packages external, as optional peer dependencies, and contain nothing of the Pub/Sub implementation: the plugin's worker side imports `createHttpClient` from the package's root, and its workflow side runs each operation as an activity on the worker. Their declarations are emitted from the plugin's source by `tsc` into `dist/temporal-types/`, which `temporal/index.d.ts` and `temporal/workflow/index.d.ts` re-export.
