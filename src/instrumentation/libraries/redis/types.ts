import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { BufferEncoding, BufferMetadata } from "../redis-common/types";

export { BufferEncoding };
export type { BufferMetadata };

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

export interface RedisOutputValue extends Record<string, unknown> {
  value: any;
  metadata?: BufferMetadata;
}
