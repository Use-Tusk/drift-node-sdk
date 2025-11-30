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
export type PostgresConvertedResult = PostgresResult | PostgresRow[];

export type PostgresOutputValueType = {
  rows?: PostgresRow[];
  command?: string;
  count?: number;
  columns?: Array<{
    name: string; // Column name
    parser: Function; // Type parser function (not serializable!)
    table: number; // OID of the table
    number: number; // Column number within table
    type: number; // OID of the column type
  }>;
  state?: {
    pid: number | null; // PostgreSQL backend process ID
    secret: number | null; // Secret key for cancel requests
  };
  statement?: {
    string: string; // The SQL query string
    types: any[]; // Parameter types
    name: string; // Prepared statement name
    columns: Array<{
      // Column metadata (same structure as columns above)
      name: string;
      parser: Function;
      table: number;
      number: number;
      type: number;
    }>;
  };
};

export function isPostgresOutputValueType(value: any): value is PostgresOutputValueType {
  // Accept any object or array - postgres results can be either
  return value !== null && value !== undefined && typeof value === "object";
}
