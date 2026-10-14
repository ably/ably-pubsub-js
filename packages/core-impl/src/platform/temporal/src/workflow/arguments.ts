import type { ApplicationFailure } from '@temporalio/common';
import { ablyFailure } from './failure.js';

// Arguments are checked in workflow code when passing them to the activity would make the Ably SDK throw a
// `TypeError`. The activity would rethrow that error as it is, and Temporal would retry it indefinitely.

function invalidArgument(message: string, remediation: string): ApplicationFailure {
  return ablyFailure({ message, code: 40003, statusCode: 400, remediation });
}

function isObject(value: unknown): value is object {
  return value !== null && typeof value === 'object';
}

/**
 * Returns the value to send for an argument that is either a message serial or a message carrying a `serial`. A
 * message with a serial is reduced to its serial, so that only the serial is recorded in the workflow history. A
 * message without one is sent as it is, so that the activity fails with the Ably SDK's own error.
 *
 * @param method - The name of the method, for the error message, such as `getMessage`.
 * @param serialOrMessage - The argument passed to the method.
 */
export function serialArgument<M extends object>(method: string, serialOrMessage: string | M): string | M {
  if (typeof serialOrMessage === 'string') {
    return serialOrMessage;
  }
  if (isObject(serialOrMessage)) {
    const serial = (serialOrMessage as { serial?: unknown }).serial;
    return typeof serial === 'string' && serial.length > 0 ? serial : serialOrMessage;
  }
  throw invalidArgument(
    `${method}() expects a message serial or a message object, but was called with ${describeValue(serialOrMessage)}`,
    `Pass the Message received from history() or a subscribe callback, which carries a serial, or its serial string.`,
  );
}

/**
 * Returns the value to send for an argument that is either a push device ID or a device carrying an `id`. A device
 * with an ID is reduced to its ID, so that only the ID is recorded in the workflow history. A device without one is
 * sent as it is, so that the activity fails with the Ably SDK's own error.
 *
 * @param method - The name of the method, for the error message, such as `push.admin.deviceRegistrations.get`.
 * @param deviceIdOrDetails - The argument passed to the method.
 */
export function deviceIdArgument<D extends object>(method: string, deviceIdOrDetails: string | D): string | D {
  if (typeof deviceIdOrDetails === 'string') {
    return deviceIdOrDetails;
  }
  if (isObject(deviceIdOrDetails)) {
    const id = (deviceIdOrDetails as { id?: unknown }).id;
    return typeof id === 'string' && id.length > 0 ? id : deviceIdOrDetails;
  }
  throw invalidArgument(
    `${method}() expects a device ID or a DeviceDetails object, but was called with ${describeValue(deviceIdOrDetails)}`,
    'Pass the device ID string, or the DeviceDetails object returned by push.admin.deviceRegistrations.save() or get().',
  );
}

/**
 * Checks that an argument is an object.
 *
 * @param method - The name of the method, for the error message, such as `updateMessage`.
 * @param name - The name of the argument, for the error message.
 * @param value - The argument passed to the method.
 * @param remediation - How to fix a call that passes something else.
 */
export function requireObject(method: string, name: string, value: unknown, remediation: string): void {
  if (!isObject(value) || Array.isArray(value)) {
    throw invalidArgument(
      `${method}() expects ${name} to be an object, but was called with ${describeValue(value)}`,
      remediation,
    );
  }
}

/**
 * Checks that an argument is a string.
 *
 * @param method - The name of the method, for the error message, such as `request`.
 * @param name - The name of the argument, for the error message.
 * @param value - The argument passed to the method.
 */
export function requireString(method: string, name: string, value: unknown): void {
  if (typeof value !== 'string') {
    throw invalidArgument(
      `${method}() expects ${name} to be a string, but was called with ${describeValue(value)}`,
      `Pass ${name} as a string.`,
    );
  }
}

/**
 * Checks that an argument is an array of strings.
 *
 * @param method - The name of the method, for the error message, such as `batchPresence`.
 * @param name - The name of the argument, for the error message.
 * @param value - The argument passed to the method.
 */
export function requireStringArray(method: string, name: string, value: unknown): void {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw invalidArgument(
      `${method}() expects ${name} to be an array of strings, but was called with ${describeValue(value)}`,
      `Pass ${name} as an array of strings.`,
    );
  }
}

function describeValue(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  return typeof value === 'object' ? 'an object' : `a value of type ${typeof value}`;
}
