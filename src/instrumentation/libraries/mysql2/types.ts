import type {
  Connection,
  Pool,
  PoolConnection,
  Query,
  QueryOptions,
  QueryError,
  FieldPacket,
  RowDataPacket,
  OkPacket,
  ResultSetHeader,
  PoolOptions,
} from "mysql2";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface Mysql2InputValue {
  sql: string;
  values?: any[];
  clientType: "connection" | "pool" | "poolConnection";
  [key: string]: unknown;
}

export interface Mysql2ModuleExports {
  createConnection: (config: any) => Connection;
  createPool: (config: PoolOptions) => Pool;
  Connection: Connection;
  Pool: Pool;
  PoolConnection: PoolConnection;
  Query: Query;
  format: (sql: string, values?: any[]) => string;
}

export interface Mysql2InstrumentationConfig extends TdInstrumentationConfig {
  requestHook?: (query: Query) => void;
  responseHook?: (result: any) => void;
  mode?: TuskDriftMode;
}

export interface Mysql2QueryConfig {
  sql: string;
  values?: any[];
  callback?: Function;
}

export interface Mysql2Result {
  rows?: RowDataPacket[] | RowDataPacket[][] | OkPacket | OkPacket[] | ResultSetHeader;
  fields?: FieldPacket[];
}

export type QueryCallback = (
  err: QueryError | null,
  result?: any,
  fields?: FieldPacket[],
) => void;

export { Connection, Pool, PoolConnection, Query, QueryOptions, QueryError, FieldPacket };
