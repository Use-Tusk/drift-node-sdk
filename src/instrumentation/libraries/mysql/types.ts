import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface MysqlQueryInputValue {
  sql: string;
  values?: any[];
  options?: {
    nestTables?: boolean | string;
  };
  [key: string]: unknown;
}

export interface MysqlConnectionInputValue {
  connectionConfig?: {
    host?: string;
    port?: number;
    database?: string;
    user?: string;
    [key: string]: unknown;
  };
}

export interface MysqlTransactionInputValue {
  query: "BEGIN" | "COMMIT" | "ROLLBACK";
  options?: Record<string, any>;
  [key: string]: unknown;
}

export interface MysqlInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

export interface MysqlModuleExports {
  createConnection?: Function;
  createPool?: Function;
  createPoolCluster?: Function;
  [key: string]: any;
}

/**
 * MySQL result format for SELECT queries
 */
export interface MysqlSelectResult {
  rows: MysqlRow[];
  fields?: MysqlFieldInfo[];
}

/**
 * MySQL OkPacket result for INSERT/UPDATE/DELETE queries
 */
export interface MysqlOkPacket {
  fieldCount: number;
  affectedRows: number;
  insertId: number;
  serverStatus: number;
  warningCount: number;
  message: string;
  protocol41: boolean;
  changedRows: number;
}

/**
 * MySQL row data (generic object with any properties)
 */
export type MysqlRow = Record<string, any>;

/**
 * MySQL field information
 */
export interface MysqlFieldInfo {
  catalog: string;
  db: string;
  table: string;
  orgTable: string;
  name: string;
  orgName: string;
  charsetNr: number;
  length: number;
  type: number;
  flags: number;
  decimals: number;
  default?: string;
  zeroFill: boolean;
  protocol41: boolean;
}

/**
 * Result from MySQL query - can be either:
 * - An array of rows (SELECT)
 * - An OkPacket (INSERT/UPDATE/DELETE)
 * - An array of results for multi-statement queries
 */
export type MysqlQueryResult = MysqlRow[] | MysqlOkPacket | MysqlQueryResult[];

/**
 * Output value stored in span for MySQL queries
 */
export interface MysqlOutputValue {
  results: MysqlQueryResult;
  fields?: MysqlFieldInfo | MysqlFieldInfo[];
  queryCount?: number;
  errQueryIndex?: number;
  [key: string]: unknown;
}

/**
 * Transaction result
 */
export interface MysqlTransactionResult {
  status: "committed" | "rolled_back";
  error?: string;
}

/**
 * Helper to check if a result is an OkPacket
 */
export function isMysqlOkPacket(result: any): result is MysqlOkPacket {
  return (
    result &&
    typeof result === "object" &&
    "affectedRows" in result &&
    "insertId" in result &&
    "fieldCount" in result
  );
}
