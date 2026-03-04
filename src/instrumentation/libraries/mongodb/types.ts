import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

/**
 * Input value for MongoDB collection/db operations (findOne, insertOne, aggregate, etc.)
 */
export interface MongodbCommandInputValue {
  /** The MongoDB operation name (e.g., "findOne", "insertOne", "aggregate") */
  command: string;
  /** The collection name */
  collection?: string;
  /** The database name */
  database?: string;
  /** Command-specific arguments (filter, document, pipeline, options, etc.) */
  commandArgs?: Record<string, any>;
  [key: string]: unknown;
}

/**
 * Input value for MongoClient.connect operations
 */
export interface MongodbConnectInputValue {
  connectionString?: string;
  options?: Record<string, any>;
  [key: string]: unknown;
}

/**
 * Module exports shape for the mongodb package
 */
export interface MongodbModuleExports {
  MongoClient?: any;
  Collection?: any;
  Db?: any;
  default?: any;
  [key: string]: any;
}

/**
 * Configuration for MongoDB instrumentation
 */
export interface MongodbInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

/**
 * MongoDB document type (generic object)
 */
export type MongodbDocument = Record<string, any>;

/**
 * MongoDB operation result — varies by operation type
 */
export interface MongodbOutputValue {
  /** For find/aggregate: array of returned documents */
  documents?: MongodbDocument[];
  /** For insertOne: the inserted ID */
  insertedId?: any;
  /** For insertMany: map of index to inserted ID */
  insertedIds?: Record<number, any>;
  /** For insertMany: count of inserted documents */
  insertedCount?: number;
  /** For update: count of matched documents */
  matchedCount?: number;
  /** For update: count of modified documents */
  modifiedCount?: number;
  /** For delete: count of deleted documents */
  deletedCount?: number;
  /** For update with upsert: count of upserted documents */
  upsertedCount?: number;
  /** For update with upsert: the upserted ID */
  upsertedId?: any;
  /** Whether the operation was acknowledged by the server */
  acknowledged?: boolean;
  [key: string]: unknown;
}
