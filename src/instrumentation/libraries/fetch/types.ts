import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { TransformConfigs } from "../types";

export interface FetchInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
  transforms?: TransformConfigs;
}

export interface FetchInputValue {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
  [key: string]: unknown;
}

export interface FetchOutputValue {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  bodySize: number;
  [key: string]: unknown;
}
