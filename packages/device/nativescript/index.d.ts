/**
 * Everything `@ably/pubsub-device` exports, from its build for NativeScript apps.
 *
 * The package root has no NativeScript build, so in a NativeScript app import from this entry point
 * instead. It needs the `nativescript-websockets` and `@nativescript/core` packages installed in
 * the app.
 *
 * Unlike the package root on the web and React Native, this build keeps every log, and it includes
 * MessagePack, so `useBinaryProtocol: true` works without the `MsgPack` plugin.
 */
export * from '../index.js';
