export enum BufferEncoding {
  UTF8 = "UTF8",
  BASE64 = "BASE64",
  NONE = "NONE",
}

export interface BufferMetadata {
  bufferMeta?: string;
  encoding?: BufferEncoding;
}
