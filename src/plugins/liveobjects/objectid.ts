import type BaseClient from 'common/lib/client/baseclient';
import type Platform from 'common/platform';

export type LiveObjectType = 'map' | 'counter';

// 12 bytes of entropy base64-encode to a 16-character string, the RTLCV4d/RTLMV4g minimum
const NONCE_ENTROPY_BYTES = 12;

/**
 * Represents a parsed object id.
 *
 * @internal
 */
export class ObjectId {
  private constructor(
    readonly type: LiveObjectType,
    readonly hash: string,
    readonly msTimestamp: number,
  ) {}

  /**
   * Generates a unique random string nonce with 16+ characters, as required for
   * object id creation (RTLCV4d, RTLMV4g). 12 bytes of entropy base64-encode to
   * exactly 16 characters.
   */
  static async generateNonce(client: BaseClient): Promise<string> {
    return client.Utils.randomString(NONCE_ENTROPY_BYTES);
  }

  static fromInitialValue(
    platform: typeof Platform,
    objectType: LiveObjectType,
    initialValue: string,
    nonce: string,
    msTimestamp: number,
  ): ObjectId {
    const valueForHashBuffer = platform.BufferUtils.concat([
      platform.BufferUtils.utf8Encode(initialValue),
      platform.BufferUtils.utf8Encode(':'),
      platform.BufferUtils.utf8Encode(nonce),
    ]);
    const hashBuffer = platform.BufferUtils.sha256(valueForHashBuffer);
    const hash = platform.BufferUtils.base64UrlEncode(hashBuffer);

    return new ObjectId(objectType, hash, msTimestamp);
  }

  /**
   * Create ObjectId instance from hashed object id string.
   */
  static fromString(client: BaseClient, objectId: string | null | undefined): ObjectId {
    if (client.Utils.isNil(objectId)) {
      throw new client.ErrorInfo('Invalid object id string', 92000, 400);
    }

    // RTO6b1
    const [type, rest] = objectId.split(':');
    if (!type || !rest) {
      throw new client.ErrorInfo('Invalid object id string', 92000, 400);
    }

    if (!['map', 'counter'].includes(type)) {
      throw new client.ErrorInfo(`Invalid object type in object id: ${objectId}`, 92000, 400);
    }

    const [hash, msTimestamp] = rest.split('@');
    if (!hash || !msTimestamp) {
      throw new client.ErrorInfo('Invalid object id string', 92000, 400);
    }

    if (!Number.isInteger(Number.parseInt(msTimestamp))) {
      throw new client.ErrorInfo('Invalid object id string', 92000, 400);
    }

    return new ObjectId(type as LiveObjectType, hash, Number.parseInt(msTimestamp));
  }

  toString(): string {
    return `${this.type}:${this.hash}@${this.msTimestamp}`;
  }
}
