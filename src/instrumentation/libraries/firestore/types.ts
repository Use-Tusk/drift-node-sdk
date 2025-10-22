import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface FirestoreInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

export interface FirestoreInputValue {
  operation:
    | "document.get"
    | "document.create"
    | "document.set"
    | "document.update"
    | "document.delete"
    | "collection.add"
    | "collection.doc"
    | "query.get";
  path: string; // Document or collection path
  data?: any; // For write operations
  options?: any; // For operations with options (e.g., set with merge)
  [key: string]: unknown;
}

export interface FirestoreDocumentData {
  [field: string]: any;
}

export interface FirestoreWriteResult {
  writeTime?: {
    seconds: number;
    nanoseconds: number;
  };
  [key: string]: unknown;
}

export interface FirestoreDocumentResult {
  id: string;
  path: string;
  exists: boolean;
  data?: FirestoreDocumentData;
  createTime?: {
    seconds: number;
    nanoseconds: number;
  };
  updateTime?: {
    seconds: number;
    nanoseconds: number;
  };
  readTime?: {
    seconds: number;
    nanoseconds: number;
  };
  [key: string]: unknown;
}

export interface FirestoreQueryResult {
  docs: FirestoreDocumentResult[];
  size: number;
  empty: boolean;
  readTime?: {
    seconds: number;
    nanoseconds: number;
  };
  [key: string]: unknown;
}

// Re-export types that might be useful
export type DocumentData = FirestoreDocumentData;
export type WriteResult = FirestoreWriteResult;
