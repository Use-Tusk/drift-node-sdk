import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface PostgresClientInputValue {
  query: string;
  parameters: any[];
  options?: Record<string, any>;
  [key: string]: unknown;
}

export interface PostgresModuleExports {
  sql?: Function;
  default?: Function;
  [key: string]: any;
}

export interface PostgresInstrumentationConfig extends TdInstrumentationConfig {
  requestHook?: (query: any) => void;
  responseHook?: (result: any) => void;
  mode?: TuskDriftMode;
}

/**
 * postgres.js result format with metadata
 */
export interface PostgresResult {
  rows?: PostgresRow[];
  command?: string;
  count?: number;
}

/**
 * postgres.js row data (generic object with any properties)
 */
export type PostgresRow = Record<string, any>;

/**
 * Result from convertPostgresTypes - can be either:
 * - A result object with {rows, command, count}
 * - A plain array of rows
 * - null/undefined
 */
export type PostgresConvertedResult =
  | PostgresResult
  | PostgresRow[];

export type PostgresOutputValueType = {
  rows?: PostgresRow[];
  command?: string;
  count?: number;
}

export function isPostgresOutputValueType(value: any): value is PostgresOutputValueType {
  // Accept any object or array - postgres results can be either
  return value !== null && value !== undefined && typeof value === "object";
}
