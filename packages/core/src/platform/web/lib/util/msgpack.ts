function inspect(buffer: undefined | ArrayBuffer | DataView) {
  if (buffer === undefined) return 'undefined';
  let view;
  let type;
  if (buffer instanceof ArrayBuffer) {
    type = 'ArrayBuffer';
    view = new DataView(buffer);
  } else if (buffer instanceof DataView) {
    type = 'DataView';
    view = buffer;
  }
  if (!view) return JSON.stringify(buffer);
  const bytes = [];
  for (let i = 0; i < buffer.byteLength; i++) {
    if (i > 20) {
      bytes.push('...');
      break;
    }
    let byte_ = view.getUint8(i).toString(16);
    if (byte_.length === 1) byte_ = '0' + byte_;
    bytes.push(byte_);
  }
  return '<' + type + ' ' + bytes.join(' ') + '>';
}

// Encode string as utf8 into dataview at offset
function utf8Write(view: DataView, offset: number, string: string) {
  const encoder = new TextEncoder();
  const encoded = encoder.encode(string);

  for (let i = 0; i < encoded.length; i++) {
    view.setUint8(offset + i, encoded[i]);
  }
}

function utf8Read(view: DataView, offset: number, length: number) {
  const decoder = new TextDecoder();
  return decoder.decode(view.buffer.slice(offset, offset + length));
}

function utf8ByteCount(string: string): number {
  const encoder = new TextEncoder();
  return encoder.encode(string).length;
}

function encode(value: unknown, sparse?: boolean) {
  const size = sizeof(value, sparse);
  if (size === 0) return undefined;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  _encode(value, view, 0, sparse);
  return buffer;
}

const SH_L_32 = (1 << 16) * (1 << 16),
  SH_R_32 = 1 / SH_L_32;
function getInt64(view: DataView, offset: number) {
  offset = offset || 0;
  return view.getInt32(offset) * SH_L_32 + view.getUint32(offset + 4);
}

function getUint64(view: DataView, offset: number) {
  offset = offset || 0;
  return view.getUint32(offset) * SH_L_32 + view.getUint32(offset + 4);
}

function setInt64(view: DataView, offset: number, val: number) {
  if (val < 0x8000000000000000) {
    view.setInt32(offset, Math.floor(val * SH_R_32));
    view.setInt32(offset + 4, val & -1);
  } else {
    view.setUint32(offset, 0x7fffffff);
    view.setUint32(offset + 4, 0x7fffffff);
  }
}

function setUint64(view: DataView, offset: number, val: number) {
  if (val < 0x10000000000000000) {
    view.setUint32(offset, Math.floor(val * SH_R_32));
    view.setInt32(offset + 4, val & -1);
  } else {
    view.setUint32(offset, 0xffffffff);
    view.setUint32(offset + 4, 0xffffffff);
  }
}

// https://gist.github.com/frsyuki/5432559 - v5 spec
//
// I've used one extension point from `fixext 1` to store `undefined`. On the wire this
// should translate to exactly 0xd40000
//
// +--------+--------+--------+
// |  0xd4  |  0x00  |  0x00  |
// +--------+--------+--------+
//    ^ fixext |        ^ value part unused (fixed to be 0)
//             ^ indicates undefined value
//

class Decoder {
  offset: number;
  view: DataView;

  constructor(view: DataView, offset?: number) {
    this.offset = offset || 0;
    this.view = view;
  }

  map = (length: number) => {
    const value: { [key: string]: ArrayBuffer } = {};
    for (let i = 0; i < length; i++) {
      const key = this.parse();
      value[key as string] = this.parse() as ArrayBuffer;
    }
    return value;
  };

  bin = (length: number) => {
    const value = new ArrayBuffer(length);
    new Uint8Array(value).set(new Uint8Array(this.view.buffer, this.offset, length), 0);
    this.offset += length;
    return value;
  };

  buf = this.bin;

  str = (length: number) => {
    const value = utf8Read(this.view, this.offset, length);
    this.offset += length;
    return value;
  };

  array = (length: number) => {
    const value = new Array(length);
    for (let i = 0; i < length; i++) {
      value[i] = this.parse();
    }
    return value;
  };

  ext = (length: number) => {
    this.offset += length;
    return {
      type: this.view.getInt8(this.offset),
      data: this.buf(length),
    };
  };

  parse = (): unknown => {
    const type = this.view.getUint8(this.offset);
    let value, length;

    // Positive FixInt - 0xxxxxxx
    if ((type & 0x80) === 0x00) {
      this.offset++;
      return type;
    }

    // FixMap - 1000xxxx
    if ((type & 0xf0) === 0x80) {
      length = type & 0x0f;
      this.offset++;
      return this.map(length);
    }

    // FixArray - 1001xxxx
    if ((type & 0xf0) === 0x90) {
      length = type & 0x0f;
      this.offset++;
      return this.array(length);
    }

    // FixStr - 101xxxxx
    if ((type & 0xe0) === 0xa0) {
      length = type & 0x1f;
      this.offset++;
      return this.str(length);
    }

    // Negative FixInt - 111xxxxx
    if ((type & 0xe0) === 0xe0) {
      value = this.view.getInt8(this.offset);
      this.offset++;
      return value;
    }

    switch (type) {
      // nil
      case 0xc0:
        this.offset++;
        return null;

      // 0xc1 never used - use for undefined (NON-STANDARD)
      case 0xc1:
        this.offset++;
        return undefined;

      // false
      case 0xc2:
        this.offset++;
        return false;

      // true
      case 0xc3:
        this.offset++;
        return true;

      // bin 8
      case 0xc4:
        length = this.view.getUint8(this.offset + 1);
        this.offset += 2;
        return this.bin(length);

      // bin 16
      case 0xc5:
        length = this.view.getUint16(this.offset + 1);
        this.offset += 3;
        return this.bin(length);

      // bin 32
      case 0xc6:
        length = this.view.getUint32(this.offset + 1);
        this.offset += 5;
        return this.bin(length);

      // ext 8
      case 0xc7:
        length = this.view.getUint8(this.offset + 1);
        this.offset += 2;
        return this.ext(length);

      // ext 16
      case 0xc8:
        length = this.view.getUint16(this.offset + 1);
        this.offset += 3;
        return this.ext(length);

      // ext 32
      case 0xc9:
        length = this.view.getUint32(this.offset + 1);
        this.offset += 5;
        return this.ext(length);

      // float 32
      case 0xca:
        value = this.view.getFloat32(this.offset + 1);
        this.offset += 5;
        return value;

      // float 64
      case 0xcb:
        value = this.view.getFloat64(this.offset + 1);
        this.offset += 9;
        return value;

      // uint8
      case 0xcc:
        value = this.view.getUint8(this.offset + 1);
        this.offset += 2;
        return value;

      // uint 16
      case 0xcd:
        value = this.view.getUint16(this.offset + 1);
        this.offset += 3;
        return value;

      // uint 32
      case 0xce:
        value = this.view.getUint32(this.offset + 1);
        this.offset += 5;
        return value;

      // uint 64
      case 0xcf:
        value = getUint64(this.view, this.offset + 1);
        this.offset += 9;
        return value;

      // int 8
      case 0xd0:
        value = this.view.getInt8(this.offset + 1);
        this.offset += 2;
        return value;

      // int 16
      case 0xd1:
        value = this.view.getInt16(this.offset + 1);
        this.offset += 3;
        return value;

      // int 32
      case 0xd2:
        value = this.view.getInt32(this.offset + 1);
        this.offset += 5;
        return value;

      // int 64
      case 0xd3:
        value = getInt64(this.view, this.offset + 1);
        this.offset += 9;
        return value;

      // fixext 1
      case 0xd4:
        length = 1;
        this.offset++;
        return this.ext(length);

      // fixext 2
      case 0xd5:
        length = 2;
        this.offset++;
        return this.ext(length);

      // fixext 4
      case 0xd6:
        length = 4;
        this.offset++;
        return this.ext(length);

      // fixext 8
      case 0xd7:
        length = 8;
        this.offset++;
        return this.ext(length);

      // fixext 16
      case 0xd8:
        length = 16;
        this.offset++;
        return this.ext(length);

      // str8
      case 0xd9:
        length = this.view.getUint8(this.offset + 1);
        this.offset += 2;
        return this.str(length);

      // str 16
      case 0xda:
        length = this.view.getUint16(this.offset + 1);
        this.offset += 3;
        return this.str(length);

      // str 32
      case 0xdb:
        length = this.view.getUint32(this.offset + 1);
        this.offset += 5;
        return this.str(length);

      // array 16
      case 0xdc:
        length = this.view.getUint16(this.offset + 1);
        this.offset += 3;
        return this.array(length);

      // array 32
      case 0xdd:
        length = this.view.getUint32(this.offset + 1);
        this.offset += 5;
        return this.array(length);

      // map 16
      case 0xde:
        length = this.view.getUint16(this.offset + 1);
        this.offset += 3;
        return this.map(length);

      // map 32
      case 0xdf:
        length = this.view.getUint32(this.offset + 1);
        this.offset += 5;
        return this.map(length);
    }
    throw new Error('Unknown type 0x' + type.toString(16));
  };
}

function decode(buffer: ArrayBuffer) {
  const view = new DataView(buffer);
  const decoder = new Decoder(view);
  const value = decoder.parse();
  if (decoder.offset !== buffer.byteLength) throw new Error(buffer.byteLength - decoder.offset + ' trailing bytes');
  return value;
}

function encodeableKeys(value: { [key: string]: unknown }, sparse?: boolean) {
  return Object.keys(value).filter(function (e) {
    const val = value[e],
      type = typeof val;
    return (!sparse || (val !== undefined && val !== null)) && ('function' !== type || !!(val as Date).toJSON);
  });
}

function _encode(value: unknown, view: DataView, offset: number, sparse?: boolean): number {
  const type = typeof value;

  // Strings Bytes
  // There are four string types: fixstr/str8/str16/str32
  if (typeof value === 'string') {
    const length = utf8ByteCount(value);

    // fixstr
    if (length < 0x20) {
      view.setUint8(offset, length | 0xa0);
      utf8Write(view, offset + 1, value);
      return 1 + length;
    }

    // str8
    if (length < 0x100) {
      view.setUint8(offset, 0xd9);
      view.setUint8(offset + 1, length);
      utf8Write(view, offset + 2, value);
      return 2 + length;
    }

    // str16
    if (length < 0x10000) {
      view.setUint8(offset, 0xda);
      view.setUint16(offset + 1, length);
      utf8Write(view, offset + 3, value);
      return 3 + length;
    }
    // str32
    if (length < 0x100000000) {
      view.setUint8(offset, 0xdb);
      view.setUint32(offset + 1, length);
      utf8Write(view, offset + 5, value);
      return 5 + length;
    }
  }

  if (ArrayBuffer.isView && ArrayBuffer.isView(value)) {
    // extract the arraybuffer and fallthrough
    value = value.buffer;
  }

  // There are three bin types: bin8/bin16/bin32
  if (value instanceof ArrayBuffer) {
    const length = value.byteLength;

    // bin8
    if (length < 0x100) {
      view.setUint8(offset, 0xc4);
      view.setUint8(offset + 1, length);
      new Uint8Array(view.buffer).set(new Uint8Array(value), offset + 2);
      return 2 + length;
    }

    // bin16
    if (length < 0x10000) {
      view.setUint8(offset, 0xc5);
      view.setUint16(offset + 1, length);
      new Uint8Array(view.buffer).set(new Uint8Array(value), offset + 3);
      return 3 + length;
    }

    // bin 32
    if (length < 0x100000000) {
      view.setUint8(offset, 0xc6);
      view.setUint32(offset + 1, length);
      new Uint8Array(view.buffer).set(new Uint8Array(value), offset + 5);
      return 5 + length;
    }
  }

  if (typeof value === 'number') {
    // Floating Point
    // NOTE: We're always using float64
    if (Math.floor(value) !== value) {
      view.setUint8(offset, 0xcb);
      view.setFloat64(offset + 1, value);
      return 9;
    }

    // Integers
    if (value >= 0) {
      // positive fixnum
      if (value < 0x80) {
        view.setUint8(offset, value);
        return 1;
      }
      // uint 8
      if (value < 0x100) {
        view.setUint8(offset, 0xcc);
        view.setUint8(offset + 1, value);
        return 2;
      }
      // uint 16
      if (value < 0x10000) {
        view.setUint8(offset, 0xcd);
        view.setUint16(offset + 1, value);
        return 3;
      }
      // uint 32
      if (value < 0x100000000) {
        view.setUint8(offset, 0xce);
        view.setUint32(offset + 1, value);
        return 5;
      }
      // uint 64
      if (value < 0x10000000000000000) {
        view.setUint8(offset, 0xcf);
        setUint64(view, offset + 1, value);
        return 9;
      }
      throw new Error('Number too big 0x' + value.toString(16));
    }

    // negative fixnum
    if (value >= -0x20) {
      view.setInt8(offset, value);
      return 1;
    }
    // int 8
    if (value >= -0x80) {
      view.setUint8(offset, 0xd0);
      view.setInt8(offset + 1, value);
      return 2;
    }
    // int 16
    if (value >= -0x8000) {
      view.setUint8(offset, 0xd1);
      view.setInt16(offset + 1, value);
      return 3;
    }
    // int 32
    if (value >= -0x80000000) {
      view.setUint8(offset, 0xd2);
      view.setInt32(offset + 1, value);
      return 5;
    }
    // int 64
    if (value >= -0x8000000000000000) {
      view.setUint8(offset, 0xd3);
      setInt64(view, offset + 1, value);
      return 9;
    }
    throw new Error('Number too small -0x' + (-value).toString(16).substr(1));
  }

  // undefined - use d4 (NON-STANDARD)
  if (type === 'undefined') {
    if (sparse) return 0;
    view.setUint8(offset, 0xd4);
    view.setUint8(offset + 1, 0x00);
    view.setUint8(offset + 2, 0x00);
    return 3;
  }

  // null
  if (value === null) {
    if (sparse) return 0;
    view.setUint8(offset, 0xc0);
    return 1;
  }

  // Boolean
  if (type === 'boolean') {
    view.setUint8(offset, value ? 0xc3 : 0xc2);
    return 1;
  }

  if ('function' === typeof (value as Date).toJSON) return _encode((value as Date).toJSON(), view, offset, sparse);

  // Container Types
  if (type === 'object') {
    let length: number,
      size = 0;
    let keys: string[] | undefined;
    const isArray = Array.isArray(value);

    if (isArray) {
      length = (value as unknown[]).length;
    } else {
      keys = encodeableKeys(value as { [key: string]: unknown }, sparse);
      length = keys.length;
    }

    if (length < 0x10) {
      view.setUint8(offset, length | (isArray ? 0x90 : 0x80));
      size = 1;
    } else if (length < 0x10000) {
      view.setUint8(offset, isArray ? 0xdc : 0xde);
      view.setUint16(offset + 1, length);
      size = 3;
    } else if (length < 0x100000000) {
      view.setUint8(offset, isArray ? 0xdd : 0xdf);
      view.setUint32(offset + 1, length);
      size = 5;
    }

    if (isArray) {
      for (let i = 0; i < length; i++) {
        size += _encode((value as unknown[])[i], view, offset + size, sparse);
      }
    } else if (keys) {
      for (let i = 0; i < length; i++) {
        const key = keys[i];
        size += _encode(key, view, offset + size);
        size += _encode((value as { [key: string]: unknown })[key], view, offset + size, sparse);
      }
    }

    return size;
  }
  if (type === 'function') return 0;

  throw new Error('Unknown type ' + type);
}

function sizeof(value: unknown, sparse?: boolean): number {
  const type = typeof value;

  // fixstr or str8 or str16 or str32
  if (type === 'string') {
    const length = utf8ByteCount(value as string);
    if (length < 0x20) {
      return 1 + length;
    }
    if (length < 0x100) {
      return 2 + length;
    }
    if (length < 0x10000) {
      return 3 + length;
    }
    if (length < 0x100000000) {
      return 5 + length;
    }
  }

  if (ArrayBuffer.isView && ArrayBuffer.isView(value)) {
    // extract the arraybuffer and fallthrough
    value = value.buffer;
  }

  // bin8 or bin16 or bin32
  if (value instanceof ArrayBuffer) {
    const length = value.byteLength;
    if (length < 0x100) {
      return 2 + length;
    }
    if (length < 0x10000) {
      return 3 + length;
    }
    if (length < 0x100000000) {
      return 5 + length;
    }
  }

  if (typeof value === 'number') {
    // Floating Point (32 bits)
    // double
    if (Math.floor(value) !== value) return 9;

    // Integers
    if (value >= 0) {
      // positive fixint
      if (value < 0x80) return 1;
      // uint 8
      if (value < 0x100) return 2;
      // uint 16
      if (value < 0x10000) return 3;
      // uint 32
      if (value < 0x100000000) return 5;
      // uint 64
      if (value < 0x10000000000000000) return 9;
      // Too big
      throw new Error('Number too big 0x' + value.toString(16));
    }
    // negative fixint
    if (value >= -0x20) return 1;
    // int 8
    if (value >= -0x80) return 2;
    // int 16
    if (value >= -0x8000) return 3;
    // int 32
    if (value >= -0x80000000) return 5;
    // int 64
    if (value >= -0x8000000000000000) return 9;
    // Too small
    throw new Error('Number too small -0x' + value.toString(16).substr(1));
  }

  // Boolean
  if (type === 'boolean') return 1;

  // undefined, null
  if (value === null) return sparse ? 0 : 1;
  if (value === undefined) return sparse ? 0 : 3;

  if ('function' === typeof (value as Date).toJSON) return sizeof((value as Date).toJSON(), sparse);

  // Container Types
  if (type === 'object') {
    let length: number,
      size = 0;
    if (Array.isArray(value)) {
      length = value.length;
      for (let i = 0; i < length; i++) {
        size += sizeof(value[i], sparse);
      }
    } else {
      const keys = encodeableKeys(value as { [key: string]: unknown }, sparse);
      length = keys.length;
      for (let i = 0; i < length; i++) {
        const key = keys[i];
        size += sizeof(key) + sizeof((value as { [key: string]: unknown })[key], sparse);
      }
    }
    if (length < 0x10) {
      return 1 + size;
    }
    if (length < 0x10000) {
      return 3 + size;
    }
    if (length < 0x100000000) {
      return 5 + size;
    }
    throw new Error('Array or object too long 0x' + length.toString(16));
  }
  if (type === 'function') return 0;

  throw new Error('Unknown type ' + type);
}

export default {
  encode,
  decode,
  inspect,
  utf8Write,
  utf8Read,
  utf8ByteCount,
};
