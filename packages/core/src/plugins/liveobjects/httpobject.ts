import type HttpChannel from 'common/lib/client/httpchannel';
import type * as Utils from 'common/lib/util/utils';
import type { FlattenUnion } from 'common/types/utils';
import type {
  ObjectsMapSemantics,
  HttpLiveMap,
  HttpLiveObject,
  HttpObject as PublicHttpObject,
  HttpObjectData,
  HttpObjectGenerateIdResult,
  HttpObjectGetCompactParams,
  HttpObjectGetCompactResult,
  HttpObjectGetFullParams,
  HttpObjectGetFullResult,
  HttpObjectGetParams,
  HttpObjectOperation,
  HttpObjectOperationCounterCreateBody,
  HttpObjectOperationMapCreateBody,
  HttpObjectPublishResult,
} from '../../../liveobjects';
import { ObjectId } from './objectid';
import {
  CounterCreate,
  CounterCreateWithObjectId,
  CounterInc,
  decodeWireObjectData,
  encodeMapSemantics,
  encodePartialObjectOperationForWire,
  MapCreate,
  MapCreateWithObjectId,
  MapRemove,
  MapSet,
  ObjectData,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ObjectOperation,
  WireObjectData,
} from './objectmessage';

enum WireObjectsMapSemantics {
  LWW = 'LWW',
}

const mapSemanticsWireToPublic: Record<WireObjectsMapSemantics, ObjectsMapSemantics> = {
  [WireObjectsMapSemantics.LWW]: 'lww',
};

/** Wire format for a full GET response: either a live object or a typed leaf value. */
type WireHttpObjectGetFullResult = WireHttpLiveObject | WireObjectData;

type WireHttpLiveObject = WireHttpLiveMap | WireHttpLiveCounter | WireAnyHttpLiveObject;

interface WireHttpLiveMap {
  objectId: string;
  map: {
    semantics: WireObjectsMapSemantics;
    entries: Record<string, { data: WireObjectData | WireHttpLiveObject }>;
  };
}

interface WireHttpLiveCounter {
  objectId: string;
  counter: {
    data: {
      number: number;
    };
  };
}

type WireAnyHttpLiveObject = {
  objectId: string;
};

/**
 * Wire format for a REST publish operation, based on {@link ObjectOperation} from the realtime protocol.
 * The `action` field is omitted as the server infers it from the operation-specific field.
 * Includes additional REST-specific fields such as `id` and `path`.
 */
interface WireHttpObjectOperation {
  id?: string;
  path?: string;
  objectId?: string;
  mapCreate?: MapCreate<WireObjectData>;
  mapSet?: MapSet<WireObjectData>;
  mapRemove?: MapRemove;
  counterCreate?: CounterCreate;
  counterInc?: CounterInc;
  mapCreateWithObjectId?: Omit<MapCreateWithObjectId<WireObjectData>, '_derivedFrom'>;
  counterCreateWithObjectId?: Omit<CounterCreateWithObjectId, '_derivedFrom'>;
}

/**
 * Flattened view of {@link HttpObjectOperation} with all possible fields as optional.
 * Derived from the public union type so it stays in sync automatically.
 */
type AnyHttpObjectOperation = FlattenUnion<HttpObjectOperation>;

export class HttpObject implements PublicHttpObject {
  constructor(private _channel: HttpChannel) {}

  async get(params?: HttpObjectGetCompactParams): Promise<HttpObjectGetCompactResult>;
  async get(params: HttpObjectGetFullParams): Promise<HttpObjectGetFullResult>;
  async get(params?: HttpObjectGetParams): Promise<HttpObjectGetCompactResult | HttpObjectGetFullResult> {
    const client = this._channel.client;
    const format = client.options.useBinaryProtocol ? client.Utils.Format.msgpack : client.Utils.Format.json;
    const headers = client.Defaults.defaultGetHeaders(client.options);

    client.Utils.mixin(headers, client.options.headers);

    const { unpacked, body } = await client.http.Resource.get<HttpObjectGetCompactResult | WireHttpObjectGetFullResult>(
      client,
      this._basePath(params?.objectId),
      headers,
      params ?? {},
      null,
      true,
    );

    const decoded = unpacked
      ? body!
      : client.Utils.decodeBody<HttpObjectGetCompactResult | WireHttpObjectGetFullResult>(
          body,
          client._MsgPack,
          format,
        );

    const compact = params?.compact ?? true;
    if (compact) {
      // Compact mode: return as-is. Values are JSON-like; bytes appear as base64 strings
      // (JSON protocol) or Buffer/ArrayBuffer (binary protocol). We cannot deterministically
      // decode values since we can't tell string vs JSON-encoded string.
      return decoded as HttpObjectGetCompactResult;
    }

    // Full mode: response is a live object (map/counter) or a typed leaf ObjectData.
    // Decode wire values using objectmessage decoding.
    return this._decodeFullResponseNode(decoded as WireHttpObjectGetFullResult, format);
  }

  async publish(op: HttpObjectOperation | HttpObjectOperation[]): Promise<HttpObjectPublishResult> {
    const client = this._channel.client;
    const format = client.options.useBinaryProtocol ? client.Utils.Format.msgpack : client.Utils.Format.json;
    const headers = client.Defaults.defaultPostHeaders(client.options, { format });

    const wireOps = Array.isArray(op)
      ? op.map((o) => this._constructWireOperations(o, format))
      : [this._constructWireOperations(op, format)];

    client.Utils.mixin(headers, client.options.headers);

    const requestBody = client.Utils.encodeBody(wireOps, client._MsgPack, format);

    const { unpacked, body } = await client.http.Resource.post<HttpObjectPublishResult>(
      client,
      this._basePath(),
      requestBody,
      headers,
      {},
      null,
      true,
    );

    return unpacked ? body! : client.Utils.decodeBody(body, client._MsgPack, format);
  }

  async generateObjectId(
    createBody: HttpObjectOperationMapCreateBody | HttpObjectOperationCounterCreateBody,
  ): Promise<HttpObjectGenerateIdResult> {
    const client = this._channel.client;
    // operations for initialValue string are always encoded as JSON format
    const format = client.Utils.Format.json;

    let objectType: 'map' | 'counter';
    let initialValueJSONString: string;

    if ('mapCreate' in createBody && createBody.mapCreate) {
      objectType = 'map';
      const mapCreate: MapCreate<ObjectData> = {
        ...createBody.mapCreate,
        semantics: encodeMapSemantics(createBody.mapCreate.semantics, client),
      };
      const { mapCreate: encodedMapCreate } = encodePartialObjectOperationForWire({ mapCreate }, client, format);
      initialValueJSONString = JSON.stringify(encodedMapCreate);
    } else if ('counterCreate' in createBody && createBody.counterCreate) {
      objectType = 'counter';
      const { counterCreate: encodedCounterCreate } = encodePartialObjectOperationForWire(createBody, client, format);
      initialValueJSONString = JSON.stringify(encodedCounterCreate);
    } else {
      throw new client.ErrorInfo('generateObjectId requires a mapCreate or counterCreate property', 40003, 400);
    }

    const nonce = await ObjectId.generateNonce(client);
    const msTimestamp = await client.getTimestamp(true);

    const objectId = ObjectId.fromInitialValue(
      client.Platform,
      objectType,
      initialValueJSONString,
      nonce,
      msTimestamp,
    ).toString();

    return {
      objectId,
      nonce,
      initialValue: initialValueJSONString,
    };
  }

  private _basePath(objectId?: string): string {
    return (
      this._channel.client.http.channelMixin.basePath(this._channel) +
      '/object' +
      (objectId ? '/' + encodeURIComponent(objectId) : '')
    );
  }

  /**
   * Decodes a node in the full GET response object graph.
   * Called for both the top-level response body and recursively for nested map entry data.
   * The wire node is either a live object (map/counter) or a typed leaf value {@link WireObjectData}.
   *
   * Known object types are decoded based on the current contract (maps have entries decoded,
   * ObjectData has bytes/json decoded). Unrecognized object types or fields are passed through as-is.
   */
  private _decodeFullResponseNode(
    wire: WireHttpLiveObject | WireObjectData,
    format: Utils.Format,
  ): HttpLiveObject | HttpObjectData {
    if ('map' in wire) {
      return this._decodeWireHttpLiveMap(wire, format);
    }

    if ('counter' in wire) {
      // live counter - no decoding needed
      return wire;
    }

    // typed leaf ObjectData (string, number, boolean, bytes, json, objectId) or unknown live object type.
    // decodeWireObjectData handles all ObjectData fields and passes through unrecognized shapes.
    return decodeWireObjectData(wire, this._channel.client, format);
  }

  private _decodeWireHttpLiveMap(wire: WireHttpLiveMap, format: Utils.Format): HttpLiveMap {
    const entries: HttpLiveMap['map']['entries'] = {};

    for (const [key, entry] of Object.entries(wire.map.entries ?? {})) {
      entries[key] = {
        data: this._decodeFullResponseNode(entry.data, format),
      };
    }

    // construct the public HttpLiveMap object, and include any unrecognized fields as-is
    const liveMap: HttpLiveMap = {
      ...wire,
      objectId: wire.objectId,
      map: {
        ...wire.map,
        semantics: mapSemanticsWireToPublic[wire.map.semantics] ?? 'unknown',
        entries: entries,
      },
    };
    return liveMap;
  }

  private _constructWireOperations(op: AnyHttpObjectOperation, format: Utils.Format): WireHttpObjectOperation {
    const { id, path, mapCreate, ...rest } = op;

    // Build the operation fields for encoding. If mapCreate is present, convert semantics
    // from public string to internal enum before passing to the encoding pipeline.
    const operationFields: Partial<ObjectOperation<ObjectData>> = mapCreate
      ? {
          ...rest,
          mapCreate: { ...mapCreate, semantics: encodeMapSemantics(mapCreate.semantics, this._channel.client) },
        }
      : rest;

    // Encode ObjectData values (json stringification, bytes encoding) via ObjectMessage pipeline.
    const encoded = encodePartialObjectOperationForWire(operationFields, this._channel.client, format);

    const result: WireHttpObjectOperation = { ...encoded };
    if (id != null) result.id = id;
    if (path != null) result.path = path;
    return result;
  }
}
