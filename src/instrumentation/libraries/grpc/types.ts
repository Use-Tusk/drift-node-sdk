import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";
import type { Client, Server, Metadata } from "@grpc/grpc-js";

export interface GrpcInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

export interface GrpcModuleExports {
  Client: typeof Client;
  Server: typeof Server;
  Metadata: typeof Metadata;
  [key: string]: any;
}

export interface GrpcClientInputValue {
  method: string;
  service: string;
  body: any;
  metadata: Record<string, any>;
  inputMeta: BufferMetadata;
  [key: string]: unknown;
}

export interface GrpcServerInputValue {
  method: string;
  service: string;
  body: any;
  metadata: Record<string, any>;
  [key: string]: unknown;
}

export interface GrpcOutputValue {
  body: any;
  metadata: Record<string, any>;
  status: {
    code: number;
    details: string;
    metadata: Record<string, any>;
  };
  bufferMap: Record<string, { value: string; encoding: string }>;
  jsonableStringMap: Record<string, string>;
  [key: string]: unknown;
}

export interface GrpcErrorOutput {
  error: {
    message: string;
    name: string;
    stack?: string;
  };
  status: {
    code: number;
    details: string;
    metadata: Record<string, any>;
  };
  metadata: Record<string, any>;
  [key: string]: unknown;
}

export interface BufferMetadata {
  bufferMap: Record<string, { value: string; encoding: string }>;
  jsonableStringMap: Record<string, string>;
}

export interface ReadableMetadataValue {
  value: string;
  encoding: "utf8" | "base64";
}

export type ReadableMetadata = Record<string, (string | ReadableMetadataValue)[]>;
