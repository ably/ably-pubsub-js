import type { ActivationStateMachine } from '../push/pushactivation';
import type { ReactNativePushToken } from './index';

/**
 * React Native equivalent of getW3CPushDeviceDetails: obtains a push token via the user-supplied
 * requestToken callback, records it as the device's push recipient and hands control back to the
 * activation state machine. Invoked by the state machine through the push config's
 * getPushDeviceDetails hook.
 */
export async function getReactNativePushDeviceDetails(
  machine: ActivationStateMachine,
  requestToken: () => Promise<ReactNativePushToken>,
): Promise<void> {
  const { ErrorInfo } = machine.client;
  try {
    const result = await requestToken();
    if (
      !result ||
      (result.transportType !== 'fcm' && result.transportType !== 'apns') ||
      typeof result.token !== 'string' ||
      result.token.length === 0
    ) {
      throw new TypeError(
        "requestToken must return { transportType: 'fcm' | 'apns', token } with a non-empty token string",
      );
    }
    const { transportType, token } = result;
    const device = await machine.client.getDevice();
    device.push.recipient =
      transportType === 'apns'
        ? { transportType: 'apns', deviceToken: token }
        : { transportType: 'fcm', registrationToken: token };
    await device.persist();
    machine.handleEvent(new machine.GotPushDeviceDetails());
  } catch (err) {
    machine.handleEvent(
      new machine.GettingPushDeviceDetailsFailed(
        new ErrorInfo('Failed to get react-native push device details: ' + (err as Error).message, 50000, 500),
      ),
    );
  }
}
