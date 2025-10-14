import type { IncomingMessage, ServerResponse } from "http";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface NextjsInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

export interface NextjsServerInputValue {
  method: string;
  url: string;
  headers: Record<string, string | string[] | undefined>;
  target: string;
  body?: string;
  bodySize?: number;
  bodyProcessingError?: string;
  [key: string]: unknown;
}

export interface NextjsServerOutputValue {
  statusCode?: number;
  statusMessage?: string;
  headers: Record<string, string>;
  body?: string;
  bodySize?: number;
  bodyProcessingError?: string;
  [key: string]: unknown;
}

// Type for Next.js BaseServer module exports
export interface NextjsBaseServerModule {
  default?: any;
  [key: string]: any;
}

// Type for Next.js request/response (extends Node.js HTTP types)
export type NextRequest = IncomingMessage & {
  [key: string]: any;
};

export type NextResponse = ServerResponse & {
  [key: string]: any;
};
