import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface PostgresClientInputValue {
  query: string;
  parameters: any[];
  options?: Record<string, any>;
  [key: string]: unknown;
}

export interface PostgresTransactionInputValue {
  query: "BEGIN" | "COMMIT" | "ROLLBACK";
  parameters: any[];
  options?: {
    transactionOptions?: string;
  };
}

export interface PostgresConnectionInputValue {
  connectionString?: string;
  options?: Record<string, any>;
}

export interface PostgresModuleExports {
  sql?: Function;
  default?: Function;
  _tdPatched?: boolean;
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
export interface PostgresResult<T = any> {
  rows?: T[];
  command: string;
  count: number;
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
  | PostgresResult<PostgresRow>
  | PostgresRow[]
  | null
  | undefined;

/**
 * Transaction result
 */
export interface PostgresTransactionResult {
  status: "committed" | "rolled_back";
  result?: any;
  error?: string;
}
