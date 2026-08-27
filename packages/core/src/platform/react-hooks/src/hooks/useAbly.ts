import React from 'react';
import { AblyContext } from '../AblyContext.js';
import * as API from '@ably/pubsub-core';

export function useAbly(ablyId = 'default'): API.RealtimeClient {
  const client = React.useContext(AblyContext)[ablyId].client;

  if (!client) {
    throw new Error(
      'Could not find ably client in context. ' + 'Make sure your ably hooks are called inside an <AblyProvider>',
    );
  }

  return client;
}
