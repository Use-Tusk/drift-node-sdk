import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { TuskDriftMode } from "../../../core/TuskDrift";

export interface PrismaInstrumentationConfig extends TdInstrumentationConfig {
  requestHook?: (operation: any) => void;
  responseHook?: (result: any) => void;
  mode?: TuskDriftMode;
}

export interface PrismaInputValue {
  model: string;
  operation: string;
  args: any;
  [key: string]: unknown;
}

export interface PrismaOutputValue {
  prismaResult: any;
  _tdOriginalFormat?: "result" | "error";
  [key: string]: unknown;
}

export interface PrismaModuleExports {
  PrismaClient?: any;
  default?: any;
  [key: string]: any;
}

/**
 * Prisma error class names for proper error handling
 */
export enum PrismaErrorClassName {
  PrismaClientKnownRequestError = "PrismaClientKnownRequestError",
  PrismaClientUnknownRequestError = "PrismaClientUnknownRequestError",
  PrismaClientInitializationError = "PrismaClientInitializationError",
  PrismaClientValidationError = "PrismaClientValidationError",
  PrismaClientRustPanicError = "PrismaClientRustPanicError",
  NotFoundError = "NotFoundError",
}

export interface PrismaErrorWithClassName extends Error {
  customTdName?: PrismaErrorClassName;
  [key: string]: any;
}
