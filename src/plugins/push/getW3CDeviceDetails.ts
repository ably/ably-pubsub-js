import { ActivationStateMachine } from 'plugins/push/pushactivation';

function toBase64Url(arrayBuffer: ArrayBuffer) {
  const buffer = new Uint8Array(arrayBuffer.slice(0, arrayBuffer.byteLength));
  return btoa(String.fromCharCode.apply(null, Array.from(buffer)));
}

function urlBase64ToBase64(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  return base64;
}

function base64ToUint8Array(base64String: string) {
  const rawData = window.atob(base64String);
  const rawDataChars = [];
  for (let i = 0; i < rawData.length; i++) {
    rawDataChars.push(rawData[i].charCodeAt(0));
  }
  return Uint8Array.from(rawDataChars);
}

export async function getW3CPushDeviceDetails(machine: ActivationStateMachine) {
  const GettingPushDeviceDetailsFailed = machine.GettingPushDeviceDetailsFailed;
  const GotPushDeviceDetails = machine.GotPushDeviceDetails;
  const { ErrorInfo, Defaults } = machine.client;

  let permission: NotificationPermission = Notification.permission;

  if (permission === 'default') {
    try {
      // throws exception in iOS
      permission = await Notification.requestPermission();
    } catch (err) {
      machine.handleEvent(
        new GettingPushDeviceDetailsFailed(
          new ErrorInfo('Failed to request permission to send notifications', 400, 40000),
        ),
      );
      return;
    }
  }

  if (permission !== 'granted') {
    const err =
      permission === 'denied'
        ? new ErrorInfo({
            message: 'User denied permission to send notifications: browser notification permission is "denied"',
            code: 40000,
            statusCode: 400,
            remediation:
              'Tell the user to re-enable notifications for this site in their browser settings, then call push.activate() again to retry registration. A re-request will not prompt while the permission stays "denied".',
          })
        : new ErrorInfo({
            message:
              'Notification permission prompt was dismissed without a choice: browser notification permission is "default"',
            code: 40000,
            statusCode: 400,
            remediation:
              'Surface UI explaining the value of notifications, then call push.activate() again to retry registration. The browser will show the permission prompt again.',
          });
    machine.handleEvent(new GettingPushDeviceDetailsFailed(err));
    return;
  }

  const swUrl = machine.client.options.pushServiceWorkerUrl;
  if (!swUrl) {
    const err = new ErrorInfo({
      message: 'Missing ClientOptions.pushServiceWorkerUrl',
      code: 40000,
      statusCode: 400,
      remediation:
        'Set ClientOptions.pushServiceWorkerUrl to the path of your service worker (e.g. "/ably-push-sw.js") so the SDK can register it for web push.',
    });
    machine.handleEvent(new GettingPushDeviceDetailsFailed(err));
    return;
  }

  try {
    const worker = await navigator.serviceWorker.register(swUrl);

    machine._pushManager = worker.pushManager;

    const headers = Defaults.defaultGetHeaders(machine.client.options, { format: 'text' });
    const appServerKey = (
      await machine.client.rest.Resource.get(machine.client, '/push/publicVapidKey', headers, {}, null, true)
    ).body as string;

    if (!worker.active) {
      await navigator.serviceWorker.ready;
    }

    const subscription = await worker.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(urlBase64ToBase64(appServerKey)),
    });

    const endpoint = subscription.endpoint;

    const [p256dh, auth] = [subscription.getKey('p256dh'), subscription.getKey('auth')];

    if (!p256dh || !auth) {
      throw new ErrorInfo('Public key not found', 50000, 500);
    }

    const device = await machine.client.getDevice();
    device.push.recipient = {
      transportType: 'web',
      targetUrl: btoa(endpoint),
      publicVapidKey: appServerKey,
      encryptionKey: {
        p256dh: toBase64Url(p256dh),
        auth: toBase64Url(auth),
      },
    };
    device.persist();

    machine.handleEvent(new GotPushDeviceDetails());
  } catch (err) {
    machine.handleEvent(
      new GettingPushDeviceDetailsFailed(
        new ErrorInfo('Failed to register service worker: ' + (err as Error).message, 50000, 500),
      ),
    );
  }
}
