import type * as Ably from '@ably/pubsub-device';
import type { LiveCounter, LiveMap, PathObject } from '@ably/pubsub-device/liveobjects';
import { useObject } from '@ably/pubsub-device/liveobjects/react';
import { useChannel } from '@ably/pubsub-device/react';
import { useEffect, useState } from 'react';

export function App() {
  // check that we can refer to the types exported by Ably.
  const [messages, updateMessages] = useState<Ably.Message[]>([]);

  // check that we can use ably/react exported members
  const { channel, ably } = useChannel({ channelName: 'channel' }, (message) => {
    updateMessages((prev) => [...prev, message]);
  });

  const messagePreviews = messages.map((message, idx) => <MessagePreview key={idx} message={message} />);

  useEffect(() => {
    async function publishMessages() {
      try {
        // Check that we can use the TypeScript overload that accepts name and data as separate arguments
        await channel.publish('message', { foo: 'bar' });

        // Check that we can use the TypeScript overload that accepts a Message object
        await channel.publish({ name: 'message', data: { foo: 'baz' } });
        (window as any).onResult();
      } catch (error) {
        (window as any).onResult(error);
      }
    }

    publishMessages();
  }, [channel]);

  return (
    <div>
      <header>Ably NPM package test (react export)</header>
      <div>
        <h2>Messages</h2>
        <ul>{messagePreviews}</ul>
      </div>
      <LiveObjectsTypeChecks />
    </div>
  );
}

type Game = {
  scores: LiveMap<{ alice: LiveCounter; bob: LiveCounter }>;
  title: string;
};

// check that useObject result types flow through the typed navigation selector.
// skip is set so the hook makes no use of the LiveObjects plugin at runtime;
// these checks only need to compile.
function LiveObjectsTypeChecks() {
  // no-selector form: the type parameter is the shape of the channel's object,
  // as for channel.object.get<Game>()
  const whole = useObject<Game>({ skip: true });
  const wholeValue: { scores: { alice: number; bob: number }; title: string } | undefined = whole.value;
  const wholeObject: PathObject<LiveMap<Game>> | undefined = whole.object;

  // selector form: annotating the selector's parameter types the whole navigation chain
  const counter = useObject((obj: PathObject<LiveMap<Game>>) => obj.get('scores').get('alice'), { skip: true });
  const counterValue: number | undefined = counter.value;
  const counterObject: PathObject<LiveCounter> | undefined = counter.object;

  return (
    <ul hidden>
      <li>{wholeValue?.title}</li>
      <li>{wholeObject?.path()}</li>
      <li>{counterValue}</li>
      <li>{counterObject?.path()}</li>
    </ul>
  );
}

function MessagePreview({ message }: { message: Ably.Message }) {
  return (
    <li>
      {message.name}: {message.data.foo}
    </li>
  );
}
