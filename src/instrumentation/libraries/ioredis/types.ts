import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { BufferEncoding, BufferMetadata } from "../redis-common/types";

export { BufferEncoding };
export type { BufferMetadata };

export interface IORedisInputValue {
  command: string;
  args: any[];
  argsMetadata?: BufferMetadata[];
  connectionInfo?: {
    host?: string;
    port?: number;
  };
  [key: string]: unknown;
}

export interface IORedisConnectInputValue {
  host?: string;
  port?: number;
  [key: string]: unknown;
}

export interface IORedisModuleExports {
  prototype?: any;
  default?: any;
  [key: string]: any;
}

export interface IORedisInstrumentationConfig extends TdInstrumentationConfig {
  requestHook?: (command: any) => void;
  responseHook?: (result: any) => void;
  mode?: TuskDriftMode;
}

export interface IORedisCommand {
  name: string;
  args: any[];
  resolve?: (result: any) => void;
  reject?: (err: Error) => void;
  callback?: Function;
}

export type IORedisStatus =
  | "wait"
  | "reconnecting"
  | "connecting"
  | "connect"
  | "ready"
  | "close"
  | "end";

export interface IORedisInterface {
  options: {
    host?: string;
    port?: number;
    [key: string]: any;
  };
  status: IORedisStatus;
  sendCommand(command: IORedisCommand): Promise<any>;
  connect(): Promise<void>;
  emit(event: string | symbol, ...args: any[]): boolean;
}

export interface IORedisOutputValue extends Record<string, unknown> {
  value: any;
  metadata?: BufferMetadata;
}
