import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface RedisInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

export interface RedisInputValue {
  command: string;
  args: any[];
  argsMetadata?: BufferMetadata[];
  [key: string]: unknown;
}

export interface RedisConnectInputValue {
  [key: string]: unknown;
}

export interface RedisMultiExecInputValue {
  commands: Array<{ command: string; args: any[] }>;
  execAsPipeline?: boolean;
  [key: string]: unknown;
}

export interface RedisModuleExports {
  prototype?: any;
  default?: any;
  [key: string]: any;
}

export enum BufferEncoding {
  UTF8 = "UTF8",
  BASE64 = "BASE64",
  NONE = "NONE",
}

export interface BufferMetadata {
  bufferMeta?: string;
  encoding?: BufferEncoding;
}

export interface RedisOutputValue extends Record<string, unknown> {
  value: any;
  metadata?: BufferMetadata;
}
