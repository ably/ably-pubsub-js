/**
 * In rare cases when we need to access core logger to log error messages
 *
 * @param ablyClient ably core SDK client, it has any type because we access internal Logger class
 * @param message message to log
 */
export const logError = (ablyClient: any, message: string) => {
  try {
    ablyClient.Logger.logAction(ablyClient.logger, ablyClient.Logger.LOG_ERROR, `[react-hooks] ${message}`);
  } catch (error) {
    // we don't want to fail on logger if something change
    console.error(`Unable to access ably-js logger, while sending ${message}`);
  }
};
