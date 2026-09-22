export interface MsgPack {
  encode(value: any, sparse?: boolean): Buffer | ArrayBuffer | undefined;
  decode(buffer: Buffer): any;
}
