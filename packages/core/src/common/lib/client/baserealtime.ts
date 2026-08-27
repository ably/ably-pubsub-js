import * as Utils from '../util/utils';
import BaseClient from './baseclient';
import EventEmitter from '../util/eventemitter';
import Logger from '../util/logger';
import Connection from './connection';
import RealtimeChannel from './realtimechannel';
import ErrorInfo from '../types/errorinfo';
import ProtocolMessage from '../types/protocolmessage';
import { ChannelOptions } from '../../types/channel';
import ClientOptions from '../../types/ClientOptions';
import * as API from '../../../../ably';
import { ModularPlugins, RealtimePresencePlugin } from './modularplugins';
import { TransportNames } from 'common/constants/TransportName';
import { TransportImplementations } from 'common/platform';
import Defaults from '../util/defaults';

/**
 `BaseRealtime` is an export of the tree-shakable version of the SDK, and acts as the base class for the `DefaultRealtime` class exported by the non tree-shakable version.
 */
class BaseRealtime extends BaseClient {
  readonly _RealtimePresence: RealtimePresencePlugin | null;
  // Extra transport implementations available to this client, in addition to those in Platform.Transports.bundledImplementations
  readonly _additionalTransportImplementations: TransportImplementations;
  _channels: any;
  connection: Connection;

  // internal API to make EventEmitter usable in other SDKs
  static readonly EventEmitter = EventEmitter;

  /*
   * The public typings declare that this only accepts an object, but since we want to emit a good error message in the case where a non-TypeScript user does one of these things:
   *
   * 1. passes a string (which is quite likely if they’re e.g. migrating from the default variant to the modular variant)
   * 2. passes no argument at all
   *
   * tell the compiler that these cases are possible so that it forces us to handle them.
   */
  constructor(options?: ClientOptions | string) {
    super(Defaults.objectifyOptions(options, false, 'BaseRealtime', Logger.defaultLogger));
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'Realtime()', '');

    // currently we cannot support using Ably.Realtime instances in Vercel Edge runtime.
    // this error can be removed after fixing https://github.com/ably/ably-js/issues/1731,
    // and https://github.com/ably/ably-js/issues/1732
    // @ts-ignore
    if (typeof EdgeRuntime === 'string') {
      throw new ErrorInfo(
        `Ably.Realtime instance cannot be used in Vercel Edge runtime.` +
          ` If you are running Vercel Edge functions, please replace your` +
          ` "new Ably.Realtime()" with "new Ably.Rest()" and use Ably Rest API` +
          ` instead of the Realtime API. If you are server-rendering your application` +
          ` in the Vercel Edge runtime, please use the condition "if (typeof EdgeRuntime === 'string')"` +
          ` to prevent instantiating Ably.Realtime instance during SSR in the Vercel Edge runtime.`,
        40000,
        400,
      );
    }

    this._additionalTransportImplementations = BaseRealtime.transportImplementationsFromPlugins(this.options.plugins);
    this._RealtimePresence = this.options.plugins?.RealtimePresence ?? null;
    this.connection = new Connection(this, this.options);
    this._channels = new Channels(this);
    if (this.options.autoConnect !== false) this.connect();
  }

  private static transportImplementationsFromPlugins(plugins?: ModularPlugins) {
    const transports: TransportImplementations = {};

    if (plugins?.WebSocketTransport) {
      transports[TransportNames.WebSocket] = plugins.WebSocketTransport;
    }
    if (plugins?.XHRPolling) {
      transports[TransportNames.XhrPolling] = plugins.XHRPolling;
    }

    return transports;
  }

  get channels() {
    return this._channels;
  }

  get clientId() {
    //RTC17
    return this.auth.clientId;
  }

  connect(): void {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'Realtime.connect()', '');
    this.connection.connect();
  }

  close(): void {
    Logger.logAction(this.logger, Logger.LOG_MINOR, 'Realtime.close()', '');
    this.connection.close();
  }
}

class Channels extends EventEmitter {
  realtime: BaseRealtime;
  // RSN2
  all: Record<string, RealtimeChannel>;

  constructor(realtime: BaseRealtime) {
    super(realtime.logger);
    this.realtime = realtime;
    this.all = Object.create(null);
    realtime.connection.connectionManager.on('transport.active', () => {
      this.onTransportActive();
    });
  }

  channelSerials(): { [name: string]: string } {
    let serials: { [name: string]: string } = {};
    for (const name of Utils.keysArray(this.all, true)) {
      const channel = this.all[name];
      if (channel.properties.channelSerial) {
        serials[name] = channel.properties.channelSerial;
      }
    }
    return serials;
  }

  // recoverChannels gets the given channels and sets their channel serials.
  recoverChannels(channelSerials: { [name: string]: string }) {
    for (const name of Utils.keysArray(channelSerials, true)) {
      const channel = this.get(name);
      channel.properties.channelSerial = channelSerials[name];
    }
  }

  // Access to this method is synchronised by ConnectionManager#processChannelMessage.
  async processChannelMessage(msg: ProtocolMessage) {
    const channelName = msg.channel;
    if (channelName === undefined) {
      Logger.logAction(
        this.logger,
        Logger.LOG_ERROR,
        'Channels.processChannelMessage()',
        'received event unspecified channel, action = ' + msg.action,
      );
      return;
    }
    const channel = this.all[channelName];
    if (!channel) {
      Logger.logAction(
        this.logger,
        Logger.LOG_ERROR,
        'Channels.processChannelMessage()',
        'received event for non-existent channel: ' + channelName,
      );
      return;
    }
    await channel.processMessage(msg);
  }

  /* called when a transport becomes connected; reattempt attach/detach
   * for channels that are attaching or detaching. */
  onTransportActive() {
    for (const channelName in this.all) {
      const channel = this.all[channelName];
      if (channel.state === 'attaching' || channel.state === 'detaching') {
        channel.checkPendingState();
      } else if (channel.state === 'suspended') {
        channel._attach(false, null);
      } else if (channel.state === 'attached') {
        // Note explicity request the state, channel.attach() would do nothing
        // as its already attached.
        channel.requestState('attaching');
      }
    }
  }

  /* Connection interruptions (ie when the connection will no longer queue
   * events) imply connection state changes for any channel which is either
   * attached, pending, or will attempt to become attached in the future */
  propogateConnectionInterruption(connectionState: string, reason: ErrorInfo) {
    const connectionStateToChannelState: Record<string, API.ChannelState> = {
      closing: 'detached',
      closed: 'detached',
      failed: 'failed',
      suspended: 'suspended',
    };
    const fromChannelStates = ['attaching', 'attached', 'detaching', 'suspended'];
    const toChannelState = connectionStateToChannelState[connectionState];

    for (const channelId in this.all) {
      const channel = this.all[channelId];
      if (fromChannelStates.includes(channel.state)) {
        channel.notifyState(toChannelState, reason);
      }
    }
  }

  get(name: string, channelOptions?: ChannelOptions) {
    name = String(name);
    let channel = this.all[name];
    if (!channel) {
      channel = this.all[name] = new RealtimeChannel(this.realtime, name, channelOptions);
    } else if (channelOptions) {
      if (channel._shouldReattachToSetOptions(channelOptions, channel.channelOptions)) {
        throw new ErrorInfo({
          message:
            'Channels.get() cannot be used to set channel options that would cause the channel to reattach: channels.get() returns the existing channel instance.',
          code: 40000,
          statusCode: 400,
          remediation:
            'To change params or modes on an existing channel, call channel.setOptions(opts) on the channel returned by channels.get(name). setOptions() re-attaches the channel to apply the new options.',
        });
      }
      channel.setOptions(channelOptions);
    }
    return channel;
  }

  getDerived(name: string, deriveOptions: API.DeriveOptions, channelOptions?: ChannelOptions) {
    if (deriveOptions.filter) {
      const filter = Utils.toBase64(deriveOptions.filter);
      const match = Utils.matchDerivedChannel(name);
      name = `[filter=${filter}${match.qualifierParam}]${match.channelName}`;
    }
    return this.get(name, channelOptions);
  }

  /* Included to support certain niche use-cases; most users should ignore this.
   * Please do not use this unless you know what you're doing */
  release(name: string) {
    name = String(name);
    Logger.logAction(this.logger, Logger.LOG_MAJOR, 'Channels.release()', 'Releasing references to channel ' + name);
    const channel = this.all[name];
    if (!channel) {
      return;
    }
    const s = channel.state;
    if (s === 'initialized' || s === 'detached' || s === 'failed') {
      delete this.all[name];
      return;
    }
    channel
      .detach()
      .catch((err) => {
        Logger.logAction(
          this.logger,
          Logger.LOG_ERROR,
          'Channels.release()',
          'Error detaching channel ' + name + ' prior to release: ' + Utils.inspectError(err),
        );
      })
      .then(() => {
        delete this.all[name];
      });
  }
}

export default BaseRealtime;
