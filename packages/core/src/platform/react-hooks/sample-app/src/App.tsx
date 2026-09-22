import * as Ably from '@ably/pubsub-core';
import React, { useState } from 'react';
import {
  useChannel,
  usePresence,
  usePresenceListener,
  useConnectionStateListener,
  useChannelStateListener,
  useAbly,
} from '../../src/index.js';
import './App.css';

function App() {
  const [messages, updateMessages] = useState<Ably.Message[]>([]);
  const [derivedChannelMessages, updateDerivedChannelMessages] = useState<Ably.Message[]>([]);
  const [frontOficeOnlyMessages, updateFrontOfficeOnlyMessages] = useState<Ably.Message[]>([]);

  const [skip, setSkip] = useState(false);
  const { channel, publish, ably } = useChannel({ channelName: 'your-channel-name', skip }, (message) => {
    updateMessages((prev) => [...prev, message]);
  });

  useChannel(
    {
      channelName: 'your-derived-channel-name',
      ablyId: 'rob',
    },
    (message) => {
      updateDerivedChannelMessages((prev) => [...prev, message]);
    },
  );

  useChannel(
    {
      channelName: 'your-derived-channel-name',
      ablyId: 'frontOffice',
    },
    (message) => {
      updateFrontOfficeOnlyMessages((prev) => [...prev, message]);
    },
  );

  const { publish: anotherChannelPublish } = useChannel({
    channelName: 'your-derived-channel-name',
  });

  const { updateStatus } = usePresence({ channelName: 'your-channel-name', skip }, { foo: 'bar' });
  const { presenceData } = usePresenceListener({ channelName: 'your-channel-name', skip }, (update) => {
    console.log(update);
  });

  const [, setConnectionState] = useState(ably.connection.state);

  useConnectionStateListener((stateChange) => {
    setConnectionState(stateChange.current);
  });

  const [ablyErr, setAblyErr] = useState('');
  const [channelState, setChannelState] = useState(channel.state);
  const [previousChannelState, setPreviousChannelState] = useState<undefined | Ably.ChannelState>();
  const [channelStateReason, setChannelStateReason] = useState<undefined | Ably.ErrorInfo>();

  useChannelStateListener('your-channel-name', (stateChange) => {
    setAblyErr(JSON.stringify(stateChange.reason));
    setChannelState(stateChange.current);
    setPreviousChannelState(stateChange.previous);
    setChannelStateReason(stateChange.reason ?? undefined);
  });

  const messagePreviews = messages.map((message, idx) => <MessagePreview key={idx} message={message} />);
  const derivedChannelMessagePreviews = derivedChannelMessages.map((message, idx) => (
    <MessagePreview key={idx} message={message} />
  ));
  const frontOfficeMessagePreviews = frontOficeOnlyMessages.map((message, idx) => (
    <MessagePreview key={idx} message={message} />
  ));

  const presentClients = presenceData.map((msg, index) => (
    <li key={index}>
      {/* PresenceMessage type is not correctly resolved and is missing 'clientId' property due to fail to load '@ably/pubsub-core' type declarations in this test file */}
      {(msg as any).clientId}: {JSON.stringify(msg.data)}
    </li>
  ));

  return (
    <div className="App">
      <header className="App-header">Ably React Hooks Demo</header>
      <div>
        <button
          onClick={() => {
            publish('test-message', {
              text: 'message text',
            });
          }}
        >
          Send Message
        </button>
        <button
          onClick={() => {
            updateStatus({ foo: 'baz' });
          }}
        >
          Update presence status to baz
        </button>
        <button
          onClick={() => {
            anotherChannelPublish({
              name: 'test-message',
              data: {
                text: 'This is a message for Rob',
              },
              extras: {
                headers: {
                  email: 'rob.pike@domain.com',
                },
              },
            });
          }}
        >
          Send Message to Rob Only
        </button>
        <button
          onClick={() => {
            anotherChannelPublish({
              name: 'test-message',
              data: {
                text: 'This is a company-wide message',
              },
              extras: {
                headers: {
                  company: 'domain',
                },
              },
            });
          }}
        >
          Send Company-wide message
        </button>
        <button
          onClick={() => {
            anotherChannelPublish({
              name: 'test-message',
              data: {
                text: 'This is a message for front office employees only',
              },
              extras: {
                headers: {
                  role: 'front-office',
                },
              },
            });
          }}
        >
          Send message to Front Office
        </button>
      </div>

      <div style={{ position: 'fixed', width: '250px' }}>
        <ConnectionState />
      </div>
      <div style={{ marginLeft: '250px' }}>
        <h2>Skip</h2>
        <button onClick={() => setSkip(!skip)}>Toggle skip param</button>
        <h2>Channel detach</h2>
        <button onClick={() => channel.detach()}>Detach</button>
        <button onClick={() => ably.close()}>Close</button>

        <h2>Channel State</h2>
        <h3>Current</h3>
        <div>{channelState}</div>
        <h3>Previous</h3>
        <div>{previousChannelState}</div>
        <h3>Reason</h3>
        <div>{JSON.stringify(channelStateReason)}</div>

        <h2>Ably error</h2>
        <h3>Reason</h3>
        <div>{ablyErr}</div>

        <h2>Messages</h2>
        {<ul>{messagePreviews}</ul>}

        <h2>Derived Channel Messages</h2>
        <ul>{derivedChannelMessagePreviews}</ul>

        <h2>Front Office Messages</h2>
        <ul>{frontOfficeMessagePreviews}</ul>

        <h2>Present Clients</h2>
        <ul>{presentClients}</ul>
      </div>
    </div>
  );
}

function MessagePreview({ message }: { message: Ably.Message }) {
  return <li>{message.data.text}</li>;
}

function ConnectionState() {
  const ably = useAbly();
  const [connectionState, setConnectionState] = useState(ably.connection.state);
  const [connectionError, setConnectionError] = useState<Ably.ErrorInfo | null>(null);
  useConnectionStateListener((stateChange) => {
    console.log(stateChange);
    setConnectionState(stateChange.current);
    if (stateChange.reason) {
      setConnectionError(stateChange.reason);
    }
  });

  return (
    <>
      <p>Connection State = &apos;{connectionState}&apos;</p>
      {connectionError && (
        <p>
          Connection Error ={' '}
          <a href={(connectionError as any).href}>
            {connectionError.message} ({connectionError.code} {connectionError.statusCode})
          </a>
        </p>
      )}
    </>
  );
}

export default App;
