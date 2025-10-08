import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface IORedisInputValue {
  command: string;
  args: any[];
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

export interface IORedisInterface {
  options: {
    host?: string;
    port?: number;
    [key: string]: any;
  };
  sendCommand(command: IORedisCommand): Promise<any>;
  connect(): Promise<void>;
}

export interface IORedisOutputValue extends Record<string, unknown> {
  value: any;
  _tdMetadata?: {
    isBuffer?: boolean;
    encoding?: string;
  };
}
