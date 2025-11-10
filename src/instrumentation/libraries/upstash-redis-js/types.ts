import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface UpstashRedisInputValue {
  command?: string | string[];
  commands?: string[][];
  path?: string[];
  connectionInfo?: {
    baseUrl?: string;
  };
  [key: string]: unknown;
}

export interface UpstashRedisModuleExports {
  Redis?: any;
  HttpClient?: any;
  default?: any;
  [key: string]: any;
}

export interface UpstashRedisInstrumentationConfig extends TdInstrumentationConfig {
  requestHook?: (request: any) => void;
  responseHook?: (response: any) => void;
  mode?: TuskDriftMode;
}

export interface UpstashRedisOutputValue extends Record<string, unknown> {
  result?: any;
  error?: string;
}
