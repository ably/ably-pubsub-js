import { beforeMount } from '@playwright/experimental-ct-react/hooks';
import { createClient } from '@ably/pubsub-device';
import { AblyProvider, ChannelProvider } from '@ably/pubsub-device/react';

import { createSandboxAblyAPIKey } from '../src/sandbox';

beforeMount(async ({ App }) => {
  const key = await createSandboxAblyAPIKey();

  const client = createClient({
    key,
    endpoint: 'nonprod:sandbox',
  });

  return (
    <AblyProvider client={client}>
      <ChannelProvider channelName="channel">
        <App />
      </ChannelProvider>
    </AblyProvider>
  );
});
