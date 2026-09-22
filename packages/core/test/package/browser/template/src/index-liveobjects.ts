import { Realtime, Rest } from '@ably/pubsub-core';
import {
  AnyPathObject,
  CompactedJsonValue,
  CompactedValue,
  LiveCounter,
  LiveCounterPathObject,
  LiveMap,
  LiveMapPathObject,
  LiveObjects,
  ObjectMessage,
  PathObject,
  RestObjectGetCompactResult,
  RestObjectGetFullResult,
  RestObject,
  RestObjectPublishResult,
} from '@ably/pubsub-core/liveobjects';
import { createSandboxAblyAPIKey } from './sandbox';

// Fix for "type 'typeof globalThis' has no index signature" error:
// https://stackoverflow.com/questions/68481686/type-typeof-globalthis-has-no-index-signature
declare module globalThis {
  var testAblyPackage: () => Promise<void>;
}

type MyCustomObject = {
  numberKey: number;
  stringKey: string;
  booleanKey: boolean;
  couldBeUndefined?: string;
  mapKey: LiveMap<{
    foo: 'bar';
    nestedMap?: LiveMap<{
      baz: 'qux';
    }>;
  }>;
  counterKey: LiveCounter;
  arrayBufferKey: ArrayBuffer;
  bufferKey: Buffer;
};

globalThis.testAblyPackage = async function () {
  const key = await createSandboxAblyAPIKey();

  const realtime = new Realtime({ key, endpoint: 'nonprod:sandbox', plugins: { LiveObjects } });

  const channel = realtime.channels.get('channel', { modes: ['OBJECT_SUBSCRIBE', 'OBJECT_PUBLISH'] });
  await channel.attach();
  // check LiveObjects can be accessed on a channel with a custom type parameter.
  // check that we can refer to the LiveObjects types exported from '@ably/pubsub-core/liveobjects' by referencing a LiveMap interface.
  const myObject: PathObject<LiveMap<MyCustomObject>> = await channel.object.get<MyCustomObject>();

  // check entrypoint has expected LiveMap TypeScript type methods
  const size: number | undefined = myObject.size();

  // check custom user provided typings work:
  // primitives:
  const aNumber: number | undefined = myObject.get('numberKey').value();
  const aString: string | undefined = myObject.get('stringKey').value();
  const aBoolean: boolean | undefined = myObject.get('booleanKey').value();
  const userProvidedUndefined: string | undefined = myObject.get('couldBeUndefined').value();
  // objects:
  const counter: LiveCounterPathObject = myObject.get('counterKey');
  const map: LiveMapPathObject<MyCustomObject['mapKey'] extends LiveMap<infer T> ? T : never> = myObject.get('mapKey');
  // check string literal types works
  // need to use nullish coalescing as we didn't actually create any data on the entrypoint object,
  // so the next calls would fail. we only need to check that TypeScript types work
  const foo: 'bar' = map?.get('foo')?.value()!;
  const baz: 'qux' = map?.get('nestedMap')?.get('baz')?.value()!;
  // check LiveCounter type also behaves as expected
  const value: number = counter?.value()!;

  // check subscription callback has correct TypeScript types
  const { unsubscribe } = myObject.subscribe(({ object, message }) => {
    const typedObject: AnyPathObject = object;
    const typedMessage: ObjectMessage | undefined = message;
  });
  unsubscribe();

  // compact values
  const compact: CompactedValue<LiveMap<MyCustomObject>> | undefined = myObject.compact();
  const compactType:
    | {
        numberKey: number;
        stringKey: string;
        booleanKey: boolean;
        couldBeUndefined?: string | undefined;
        mapKey: {
          foo: 'bar';
          nestedMap?:
            | {
                baz: 'qux';
              }
            | undefined;
        };
        counterKey: number;
        arrayBufferKey: ArrayBuffer;
        bufferKey: Buffer;
      }
    | undefined = compact;

  const compactJson: CompactedJsonValue<LiveMap<MyCustomObject>> | undefined = myObject.compactJson();
  const compactJsonType:
    | {
        numberKey: number;
        stringKey: string;
        booleanKey: boolean;
        couldBeUndefined?: string | undefined;
        mapKey:
          | {
              foo: 'bar';
              nestedMap?:
                | {
                    baz: 'qux';
                  }
                | { objectId: string }
                | undefined;
            }
          | { objectId: string };
        counterKey: number;
        arrayBufferKey: string;
        bufferKey: string;
      }
    | { objectId: string }
    | undefined = compactJson;

  // REST client LiveObjects type checks
  const rest = new Rest({ key, endpoint: 'nonprod:sandbox', plugins: { LiveObjects } });
  const restChannel = rest.channels.get('channel');

  // check RestObject is accessible on a REST channel
  const restObject: RestObject = restChannel.object;

  // check get() returns correct types for compact and full responses
  const compactResult: RestObjectGetCompactResult = await restObject.get();
  const compactWithParam: RestObjectGetCompactResult = await restObject.get({ compact: true });
  const fullResult: RestObjectGetFullResult = await restObject.get({ compact: false });

  // check publish() returns correct type
  const publishResult: RestObjectPublishResult = await restObject.publish({
    path: '',
    mapSet: { key: 'test', value: { string: 'value' } },
  });
};
