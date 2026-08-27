import type * as Ably from '@ably/pubsub-core';
import type { LiveMap, PathObject, Value } from '@ably/pubsub-core/liveobjects';
import { dequal } from 'dequal';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ChannelNameAndOptions } from '../AblyReactHooks.js';
import { INACTIVE_CONNECTION_STATES } from '../hooks/constants.js';
import { useChannelAttach } from '../hooks/useChannelAttach.js';
import { useChannelInstance } from '../hooks/useChannelInstance.js';
import { useStateErrors } from '../hooks/useStateErrors.js';

/**
 * Options for {@link useObject}. The standard channel-hook options: the channel
 * is resolved from the nearest `ChannelProvider` unless `channelName` is
 * provided, `ablyId` selects the client from a surrounding `AblyProvider`, and
 * `skip` short-circuits the hook.
 */
export type UseObjectOptions = ChannelNameAndOptions;

/**
 * The surface common to every {@link PathObject} variant that {@link useObject}
 * relies on. Every node a selector can return satisfies this type.
 *
 * The node a selector returns can be any `PathObject` variant, so the hook's
 * result-side type parameter constrains and infers over this structural type
 * rather than over `PathObject<V>`: `PathObject<V>` is a conditional type that
 * TypeScript cannot infer `V` through for an arbitrary `V`, and the resolved
 * variants are not assignable to a common `PathObject<Value>` (two
 * `LiveMapPathObject`s with different shapes have incompatible `get`
 * signatures). Constraining and inferring the concrete variant directly is
 * what lets the selector's navigation chain determine the result type. The
 * selector's parameter needs no such treatment: it is always a map, and
 * `PathObject<LiveMap<T>>` reduces eagerly for every `T`, so TypeScript can
 * infer `T` through it.
 */
export interface ObjectNode {
  /** The fully-qualified path string for this node. */
  path(): string;
  /** A plain-data snapshot of the node, or `undefined` if the node does not exist. */
  compact(): unknown;
  /** Registers a listener called on each change to the node or its subtree. */
  subscribe(listener: () => void): Ably.Subscription;
}

/**
 * The plain-data snapshot type produced by a node's `compact()` method — the
 * type of {@link UseObjectResult.value} for the node type `N`.
 */
export type ObjectNodeValue<N extends ObjectNode> = N extends { compact(): infer C } ? Exclude<C, undefined> : never;

/**
 * Navigates from the channel's object to the node to subscribe to. Receives
 * the channel's live object as a PathObject and returns a descendant via
 * `get`/`at`; the chain's types flow through, so the hook result is typed
 * without manual annotation. The function must only navigate — the node it
 * returns is the one the hook subscribes to. To subscribe to the channel's
 * whole object, omit the selector.
 */
export type ObjectSelector<Obj extends ObjectNode, N extends ObjectNode> = (object: Obj) => N;

/**
 * Result of {@link useObject} for a subscribed node of type `N`.
 */
export interface UseObjectResult<N extends ObjectNode> {
  /**
   * Reactive snapshot of the subscribed node (`PathObject.compact()`), cached
   * so its identity is stable between renders. `undefined` before the object
   * has synced, or if the node does not exist.
   */
  value: ObjectNodeValue<N> | undefined;
  /**
   * The live PathObject for the subscribed node. Use it to navigate (`get`/`at`)
   * and to write (`set`/`remove`/`increment`/`decrement`/`batch`). `undefined`
   * until the channel's object has resolved and synced — this is the
   * readiness signal: `object === undefined && error === null` is loading,
   * `error !== null` is failed, and a defined `object` is ready (with `value`
   * carrying the data once the node exists).
   */
  object: N | undefined;
  /**
   * The error that prevented the object from resolving — e.g. the `LiveObjects`
   * plugin is missing, the channel lacks object modes, or the initial sync
   * failed. ably-js's own `ErrorInfo`, surfaced unmodified. `null` otherwise.
   */
  error: Ably.ErrorInfo | null;
  /** Connection-level error, per the standard channel-hook convention. */
  connectionError: Ably.ErrorInfo | null;
  /** Channel-level error, per the standard channel-hook convention. */
  channelError: Ably.ErrorInfo | null;
}

interface RootState {
  /** The channel the root was resolved (or failed to resolve) for. */
  channel?: Ably.RealtimeChannel;
  root?: PathObject<LiveMap<Record<string, Value>>>;
  error: Ably.ErrorInfo | null;
}

interface SelectedNode {
  /** The root the node was selected from; a new root invalidates the selection. */
  root: PathObject<LiveMap<Record<string, Value>>>;
  /** The node's fully-qualified path, used to detect a change of selection. */
  path: string;
  node: ObjectNode;
}

interface ObjectStore {
  subscribe: (onStoreChange: () => void) => () => void;
  getSnapshot: () => unknown;
}

const noop = () => undefined;

const emptyStore: ObjectStore = {
  subscribe: () => noop,
  getSnapshot: () => undefined,
};

// The root object only resolves in an effect, so on the server (and during
// hydration) the snapshot is always undefined.
const getServerSnapshot = () => undefined;

/**
 * Subscribe to the channel's object and re-render on change.
 *
 * The channel is taken from the nearest `ChannelProvider` unless `channelName`
 * is given. `T` describes the shape of the channel's object — the same type
 * parameter `RealtimeObject.get<T>()` takes — and defaults to an untyped map.
 *
 * Requires the `LiveObjects` plugin on the Realtime client and the
 * `OBJECT_SUBSCRIBE` channel mode (plus `OBJECT_PUBLISH` to write); otherwise
 * `error` carries ably-js's reason. Readiness is derived from the result (see
 * {@link UseObjectResult.object}), not a status enum.
 */
export function useObject<T extends Record<string, Value> = Record<string, Value>>(
  options?: UseObjectOptions,
): UseObjectResult<PathObject<LiveMap<T>>>;
/**
 * Subscribe to a nested LiveObjects node, selected by navigating from the
 * channel's (untyped) object, and re-render on change. The node the selector
 * returns determines `N`, so `value` and `object` are typed from the
 * navigation chain, e.g. `useObject((obj) => obj.get('scores').get('alice'))`.
 *
 * Channel resolution, readiness, and plugin/modes requirements are as for the
 * no-selector overload.
 */
export function useObject<N extends ObjectNode>(
  selector: ObjectSelector<PathObject<LiveMap<Record<string, Value>>>, N>,
  options?: UseObjectOptions,
): UseObjectResult<N>;
/**
 * Subscribe to a nested LiveObjects node, selected by navigating from the
 * channel's object with a typed shape, and re-render on change. Annotate the
 * selector's parameter with the shape of the channel's object
 * (`(obj: PathObject<LiveMap<MyShape>>) => ...`) — `T` is inferred from the
 * annotation, and is the same type parameter `RealtimeObject.get<T>()` takes —
 * and the whole navigation chain, wrong keys included, is checked at compile
 * time.
 *
 * Channel resolution, readiness, and plugin/modes requirements are as for the
 * no-selector overload.
 */
export function useObject<T extends Record<string, Value>, N extends ObjectNode>(
  selector: ObjectSelector<PathObject<LiveMap<T>>, N>,
  options?: UseObjectOptions,
): UseObjectResult<N>;

export function useObject(
  selectorOrOptions?: ObjectSelector<ObjectNode, ObjectNode> | UseObjectOptions,
  maybeOptions?: UseObjectOptions,
): UseObjectResult<ObjectNode> {
  const selector = typeof selectorOrOptions === 'function' ? selectorOrOptions : undefined;
  const options = (typeof selectorOrOptions === 'function' ? maybeOptions : selectorOrOptions) ?? {};
  const skip = options.skip ?? false;

  const { channel } = useChannelInstance(options.ablyId, options.channelName);
  const { connectionError, channelError } = useStateErrors(options);
  const { connectionState } = useChannelAttach(channel, options.ablyId, skip);

  const [rootState, setRootState] = useState<RootState>({ error: null });
  const rootStateRef = useRef(rootState);
  rootStateRef.current = rootState;

  // object.get() attaches implicitly, so resolution is gated the same way
  // useChannelAttach gates attachment: wait out connection states in which an
  // attach would fail outright. When the connection later becomes usable the
  // effect re-runs, which also retries a resolution that failed in such a state.
  const canResolve = !skip && !INACTIVE_CONNECTION_STATES.includes(connectionState);

  useEffect(() => {
    if (!canResolve) {
      return;
    }
    // An already-resolved root stays valid across detach/re-attach cycles, so
    // there is nothing to re-resolve for the same channel.
    const current = rootStateRef.current;
    if (current.channel === channel && current.root) {
      return;
    }

    let cancelled = false;
    const resolveRoot = async () => {
      try {
        const root = await channel.object.get();
        if (!cancelled) {
          setRootState({ channel, root, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          // object.get() rejects with the ErrorInfo describing why the object
          // could not be resolved (missing plugin, missing modes, failed sync)
          setRootState({ channel, error: error as Ably.ErrorInfo });
        }
      }
    };
    // fire-and-forget: resolveRoot captures failures into state itself
    resolveRoot();
    return () => {
      cancelled = true;
    };
  }, [channel, canResolve]);

  const root = !skip && rootState.channel === channel ? rootState.root : undefined;
  const error = !skip && rootState.channel === channel ? rootState.error : null;

  // Apply the selector on every render (navigation is cheap and pure), but keep
  // a stable node identity for as long as the selection addresses the same path
  // from the same root, so that re-renders do not churn the subscription. This
  // reconciles state during render (rather than in an effect) so the resolved
  // node is available within the same render pass.
  const candidate = root ? (selector ? selector(root) : root) : undefined;
  const candidatePath = candidate?.path();

  const [selected, setSelected] = useState<SelectedNode | undefined>(undefined);
  let reconciled = selected;
  if (root && candidate && candidatePath !== undefined) {
    if (!reconciled || reconciled.root !== root || reconciled.path !== candidatePath) {
      reconciled = { root, path: candidatePath, node: candidate };
      setSelected(reconciled);
    }
  } else if (reconciled) {
    reconciled = undefined;
    setSelected(undefined);
  }
  const node = reconciled?.node;

  const store: ObjectStore = useMemo(() => {
    if (!node) {
      return emptyStore;
    }
    // The snapshot is cached and recomputed only inside the subscription
    // callback: a getSnapshot that called compact() directly would return a
    // fresh object on every call and send useSyncExternalStore into an
    // infinite re-render loop.
    let value = node.compact();
    return {
      subscribe: (onStoreChange: () => void) => {
        const subscription = node.subscribe(() => {
          value = node.compact();
          onStoreChange();
        });
        // The subscription is only established in an effect, after commit, so
        // catch up on a change that landed since the render-time snapshot was
        // taken — such a change fired no notification. compact() returns a
        // fresh object on every call, so a deep-equality check is needed to
        // keep the snapshot identity stable when nothing actually changed.
        const latest = node.compact();
        if (!dequal(latest, value)) {
          value = latest;
          onStoreChange();
        }
        return () => subscription.unsubscribe();
      },
      getSnapshot: () => value,
    };
  }, [node]);

  const value = useSyncExternalStore(store.subscribe, store.getSnapshot, getServerSnapshot);

  return {
    value,
    object: node,
    error,
    connectionError,
    channelError,
  };
}
