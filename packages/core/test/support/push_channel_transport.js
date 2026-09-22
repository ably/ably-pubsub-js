define(['ably'], function (Ably) {
  var Defaults = Ably.Realtime.Platform.Defaults;
  var ErrorInfo = Ably.ErrorInfo;
  return (module.exports = {
    getPushDeviceDetails: function (machine) {
      var channel = machine.client.options.pushRecipientChannel;
      if (!channel) {
        machine.handleEvent(
          new machine.GettingPushDeviceDetailsFailed(
            new ErrorInfo('Missing ClientOptions.pushRecipientChannel', 40000, 400),
          ),
        );
        return;
      }

      var ablyKey = machine.client.options.pushAblyKey || machine.client.options.key;
      if (!ablyKey) {
        machine.handleEvent(
          new machine.GettingPushDeviceDetailsFailed(new ErrorInfo('Missing options.pushAblyKey', 40000, 400)),
        );
        return;
      }

      var ablyUrl = machine.client.baseUri(Defaults.getHosts(machine.client.options)[0]);

      var device = machine.client.device();
      device.push.recipient = {
        transportType: 'ablyChannel',
        channel: channel,
        ablyKey: ablyKey,
        ablyUrl: ablyUrl,
      };
      device.persist();

      machine.handleEvent(new machine.GotPushDeviceDetails());
    },
    storage: (function () {
      var values = {};
      return {
        set: function (name, value) {
          values[name] = value;
        },
        get: function (name) {
          return values[name];
        },
        remove: function (name) {
          delete values[name];
        },
        clear: function () {
          values = {};
        },
      };
    })(),
    platform: 'browser',
    formFactor: 'desktop',
  });
});
