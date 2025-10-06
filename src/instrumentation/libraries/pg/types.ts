// NOTE: these types are from version 8.15.5 of pg
// Older versions of pg may have different types, but this is fine for now
import {
  Client,
  Connection,
  DatabaseError,
  escapeIdentifier,
  escapeLiteral,
  Pool,
  Query,
  Result,
  TypeOverrides,
  types,
} from "pg";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface PgClientInputValue {
  text: string;
  values?: any[];
  clientType: string;
  [key: string]: unknown;
}

export interface PgModuleExports {
  Client: typeof Client;
  Query: typeof Query;
  Pool: typeof Pool;
  Connection: typeof Connection;
  types: typeof types;
  DatabaseError: typeof DatabaseError;
  TypeOverrides: typeof TypeOverrides;
  escapeIdentifier: typeof escapeIdentifier;
  escapeLiteral: typeof escapeLiteral;
  Result: typeof Result;
}

// pg-pool exports a constructor function, so we type it as a constructor that returns Pool
export interface PgPoolModuleExports {
  prototype: Pool;
}

export interface PgInstrumentationConfig extends TdInstrumentationConfig {
  requestHook?: (query: any) => void;
  responseHook?: (result: any) => void;
  mode?: TuskDriftMode;
}

export interface QueryConfig {
  text: string;
  values?: any[];
  callback?: Function;
}

export interface PgResult {
  command: string;
  rowCount: number;
  oid: number;
  rows: any[];
  fields?: Array<{ name: string; dataTypeID: number }>;
}
