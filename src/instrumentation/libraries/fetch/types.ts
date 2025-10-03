import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface FetchInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

export interface FetchInputValue {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: any;
}

export interface FetchOutputValue {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body?: string;
  bodySize: number;
}
