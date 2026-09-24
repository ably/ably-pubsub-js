import * as Ably from 'ably';
import { search } from 'jmespath';

export class FakeAblySdk {
  public clientId: string;
  public channels: ClientChannelsCollection;
  public connection: Connection;
  // TODO check we can remove this
  //public options = { promises: true };

  constructor() {
    this.clientId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    this.connection = new Connection();
  }

  public connectTo(channels: FakeAblyChannels) {
    this.channels = new ClientChannelsCollection(this, channels);
    return this;
  }

  async request() {
    return;
  }
}

type EventListener = (...args: any[]) => unknown;

class EventEmitter {
  listeners: Map<string | string[], EventListener[]>;
  allEvtListeners: EventListener[];
  constructor() {
    this.listeners = new Map<string | string[], EventListener[]>();
    this.allEvtListeners = [];
  }

  on(eventOrListener: string | string[] | EventListener, listener?: EventListener) {
    if (eventOrListener && listener) {
      if (!Array.isArray(eventOrListener)) {
        eventOrListener = [eventOrListener as string];
      }
      eventOrListener.forEach((eventName) => {
        const listenerArr = this.listeners.get(eventName as string);
        if (listenerArr) {
          listenerArr.push(listener);
          return;
        }
        this.listeners.set(eventName as string | string[], [listener]);
      });
    } else {
      this.allEvtListeners.push(eventOrListener as EventListener);
    }
  }

  off(eventOrListener: string | string[] | EventListener, listener?: EventListener) {
    if (eventOrListener && listener) {
      const listenerArr = this.listeners.get(eventOrListener as string);
      if (listenerArr) {
        this.listeners.set(
          eventOrListener as string,
          listenerArr.filter((x) => x !== listener),
        );
        return;
      }
    } else {
      this.allEvtListeners = this.allEvtListeners.filter((x) => x !== listener);
    }
  }

  emit(event: string, ...args: any[]) {
    const listenerArr = this.listeners.get(event);
    const allListeners: EventListener[] = [];
    if (listenerArr) {
      allListeners.push(...listenerArr);
    }
    allListeners.push(...this.allEvtListeners);
    allListeners.forEach((listener) => {
      listener(...args);
    });
  }
}

class Connection extends EventEmitter {
  state: Ably.ConnectionState;

  constructor() {
    super();
    this.state = 'initialized';
  }
}

export class ClientChannelsCollection {
  private client: FakeAblySdk;
  private channels: FakeAblyChannels;
  private _channelConnections: Map<string, ClientSingleChannelConnection | ClientSingleDerivedChannelConnection>;

  constructor(client: FakeAblySdk, channels: FakeAblyChannels) {
    this.client = client;
    this.channels = channels;
    this._channelConnections = new Map();
  }

  public get(name: string): ClientSingleChannelConnection {
    let channelConnection = this._channelConnections.get(name);
    if (channelConnection) {
      return channelConnection;
    } else {
      channelConnection = new ClientSingleChannelConnection(this.client, this.channels.get(name), name);
      this._channelConnections.set(name, channelConnection);
      return channelConnection;
    }
  }

  public getDerived(name: string, options: Ably.DeriveOptions): ClientSingleDerivedChannelConnection {
    let channelConnection = this._channelConnections.get(name);
    if (channelConnection) return channelConnection as ClientSingleDerivedChannelConnection;

    const channel = this.channels.get(name);
    channelConnection = new ClientSingleDerivedChannelConnection(this.client, channel, options, name);
    this._channelConnections.set(`[derived]${name}`, channelConnection);
    return channelConnection;
  }
}

export class ClientSingleChannelConnection extends EventEmitter {
  private client: FakeAblySdk;
  private channel: Channel;

  public presence: any;
  public push: any;
  public state: string;
  public name: string;

  constructor(client: FakeAblySdk, channel: Channel, name: string) {
    super();
    this.client = client;
    this.channel = channel;
    this.presence = new ClientPresenceConnection(this.client, this.channel.presence);
    this.push = new ClientPushConnection();
    this.state = 'attached';
    this.name = name;
  }

  publish(messages: any, callback?: Ably.errorCallback): void;
  publish(name: string, messages: any, callback?: Ably.errorCallback): void;
  publish(name: string, messages: any, options?: Ably.PublishOptions, callback?: Ably.errorCallback): void;
  public publish(...rest: any[]) {
    this.channel.publish(this.client.clientId, rest);
  }

  public async subscribe(
    eventOrCallback: Ably.messageCallback<Ably.Message> | string | Array<string>,
    listener?: Ably.messageCallback<Ably.Message>,
  ) {
    this.channel.subscribe(this.client.clientId, eventOrCallback, listener);
  }

  public unsubscribe() {
    this.channel.subscriptionsPerClient.delete(this.client.clientId);
  }

  public detach() {
    this.channel.subscriptionsPerClient.delete(this.client.clientId);
  }

  public async setOptions() {
    // do nothing
  }

  public async history(_params?: any) {
    return {
      items: this.channel.publishedMessages.map((m: any) => m.messageEnvelope),
      hasNext: () => false,
      isLast: () => true,
      first: () => Promise.resolve(this.history()),
      current: () => Promise.resolve(this.history()),
      next: () => Promise.resolve(null),
    };
  }

  public async attach() {
    // do nothing
  }
}

export class ClientSingleDerivedChannelConnection extends EventEmitter {
  private client: FakeAblySdk;
  private channel: Channel;
  private deriveOpts: Ably.DeriveOptions;
  public name?: string;

  constructor(client: FakeAblySdk, channel: Channel, deriveOptions?: Ably.DeriveOptions, name?: string) {
    super();
    this.client = client;
    this.channel = channel;
    this.deriveOpts = deriveOptions;
    this.name = name;
  }

  public async subscribe(
    eventOrCallback: Ably.messageCallback<Ably.Message> | string | Array<string>,
    listener?: Ably.messageCallback<Ably.Message>,
  ) {
    if (typeof eventOrCallback === 'function') eventOrCallback.deriveOptions = this.deriveOpts;
    if (typeof listener === 'function') listener.deriveOpts = this.deriveOpts;
    this.channel.subscribe(this.client.clientId, eventOrCallback, listener);
  }

  public unsubscribe() {
    this.channel.subscriptionsPerClient.delete(this.client.clientId);
  }

  public async setOptions() {
    // do nothing
  }

  public async publish() {
    throw Error('no publish for derived channel');
  }

  public async history(_params?: any) {
    return {
      items: this.channel.publishedMessages.map((m: any) => m.messageEnvelope),
      hasNext: () => false,
      isLast: () => true,
      first: () => Promise.resolve(this.history()),
      current: () => Promise.resolve(this.history()),
      next: () => Promise.resolve(null),
    };
  }

  public async attach() {
    // do nothing
  }
}

export class ClientPresenceConnection {
  private client: FakeAblySdk;
  private presence: ChannelPresence;

  constructor(client: FakeAblySdk, presence: ChannelPresence) {
    this.client = client;
    this.presence = presence;
  }

  public get() {
    return this.presence.get();
  }

  public update(data?: any) {
    const message = this.toPressenceMessage(data);
    this.presence.update(this.client.clientId, message);
  }

  public subscribe(key: string | string[], callback: CallableFunction) {
    (Array.isArray(key) ? key : [key]).forEach((x) => this.presence.subscribe(this.client.clientId, x, callback));
  }

  public leave(data?: any) {
    const message = this.toPressenceMessage(data);
    this.presence.leave(this.client.clientId, message);
  }

  public enter(data?: any) {
    const message = this.toPressenceMessage(data);
    this.presence.enter(this.client.clientId, message);
  }

  public unsubscribe(key: string | string[], listener?: any) {
    (Array.isArray(key) ? key : [key]).forEach((x) => this.presence.unsubscribe(this.client.clientId, x, listener));
  }

  private toPressenceMessage(data: any) {
    return {
      clientId: this.client.clientId,
      data: data,
    };
  }
}

// "Fake Ably Server"

export class FakeAblyChannels {
  private _channels = new Map<string, Channel>();

  constructor(channels: string[] = []) {
    channels.forEach((channel) => this.get(channel));
  }

  public get(name: string): Channel {
    if (!this._channels.has(name)) {
      this._channels.set(name, new Channel(name));
    }

    return this._channels.get(name);
  }
}

export class Channel {
  name: string;
  presence: any;

  public subscriptionsPerClient = new Map<string, Map<string, CallableFunction[]>>();
  public publishedMessages: any[] = [];

  constructor(name: string) {
    this.name = name;
    this.presence = new ChannelPresence(this);
  }

  publish(clientId: string, messages: any, callback?: Ably.errorCallback): void;
  publish(clientId: string, name: string, messages: any, callback?: Ably.errorCallback): void;
  publish(
    clientId: string,
    name: string,
    messages: any,
    options?: Ably.PublishOptions,
    callback?: Ably.errorCallback,
  ): void;
  public publish(clientId: string, ...rest: any[]) {
    const name = rest.length <= 2 ? '' : rest[0];
    const messages = rest.length <= 2 ? rest[0] : rest[1];

    for (const message of messages) {
      const messageEnvelope = {
        data: message,
      };

      for (const [, subscriptions] of this.subscriptionsPerClient.entries()) {
        let subs = [...subscriptions.values()].flat();
        if (name.length > 0) {
          subs = subs.filter((x) => x.name === name);
        }

        for (const subscription of subs) {
          const filter = subscription.deriveOptions?.filter;
          if (!filter) return subscription(messageEnvelope);
          const headers = messageEnvelope.data?.extras?.headers;
          const found = search({ headers }, filter);
          if (found) subscription(messageEnvelope);
        }
      }

      this.publishedMessages.push({ messageEnvelope });
    }
  }

  public async subscribe(
    clientId: string,
    eventOrCallback: Ably.messageCallback<Ably.Message> | string | Array<string>,
    listener?: Ably.messageCallback<Ably.Message>,
  ) {
    if (!this.subscriptionsPerClient.has(clientId)) {
      this.subscriptionsPerClient.set(clientId, new Map<string, CallableFunction[]>());
    }

    const subsForClient = this.subscriptionsPerClient.get(clientId);

    const keys = [];
    let callback = listener;

    if (typeof eventOrCallback === 'string') {
      keys.push(eventOrCallback);
    } else if (Array.isArray(eventOrCallback)) {
      keys.push(...eventOrCallback);
    } else {
      keys.push('');
      callback = eventOrCallback;
    }

    for (const key of keys) {
      if (!subsForClient.has(key)) {
        subsForClient.set(key, []);
      }

      const subs = subsForClient.get(key);
      subs.push(callback);
    }
  }

  public async setOptions() {
    // do nothing
  }

  public async attach() {
    // do nothing
  }
}

export class ChannelPresence {
  public parent: Channel;
  public subscriptionsPerClient = new Map<string, Map<string, CallableFunction[]>>();
  public presenceObjects = new Map<string, any>();

  constructor(parent: Channel) {
    this.parent = parent;
  }

  public get() {
    return [...this.presenceObjects.entries()].map(([, data]) => {
      return data;
    });
  }

  public update(clientId: string, data?: any) {
    this.presenceObjects.set(clientId, data);
    this.triggerSubs('update', data);
  }

  public subscribe(clientId: string, key: string, callback: CallableFunction) {
    if (!this.subscriptionsPerClient.has(clientId)) {
      this.subscriptionsPerClient.set(clientId, new Map<string, CallableFunction[]>());
    }

    const subsForClient = this.subscriptionsPerClient.get(clientId);

    if (!subsForClient.has(key)) {
      subsForClient.set(key, []);
    }

    subsForClient.get(key).push(callback);
  }

  public leave(clientId: string, data?: any) {
    this.presenceObjects.delete(clientId);
    this.triggerSubs('leave', data);
  }

  public enter(clientId: string, data?: any) {
    this.presenceObjects.set(clientId, data);
    this.triggerSubs('enter', data);
  }

  public unsubscribe(clientId: string, key: string, listener?: any) {
    const subsForClient = this.subscriptionsPerClient.get(clientId);
    if (listener) {
      subsForClient?.set(key, subsForClient?.get(key)?.filter((l) => l !== listener) ?? []);
    } else {
      subsForClient?.set(key, []);
    }
  }

  private triggerSubs(subType: string, data: any) {
    for (const subscriptions of this.subscriptionsPerClient.values()) {
      const subs = subscriptions.get(subType) ?? [];
      for (const callback of subs) {
        callback(data);
      }
    }
  }
}

export class ClientPushConnection {
  public async subscribeDevice() {
    // do nothing
  }

  public async unsubscribeDevice() {
    // do nothing
  }

  public async subscribeClient() {
    // do nothing
  }

  public async unsubscribeClient() {
    // do nothing
  }

  public async listSubscriptions(_params?: Record<string, string>) {
    return { items: [], hasNext: () => false, isLast: () => true } as any;
  }
}
