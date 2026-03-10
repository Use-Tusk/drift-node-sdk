import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  PrismaModuleExports,
  PrismaInputValue,
  PrismaInstrumentationConfig,
  PrismaErrorClassName,
  PrismaErrorWithClassName,
  PrismaOutputValue,
} from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils";

interface PrismaErrorClassInfo {
  name: PrismaErrorClassName;
  errorClass: any;
}

/**
 * Prisma instrumentation for recording and replaying database operations.
 *
 * ## Type deserialization
 *
 * Prisma returns special JS types (Date, BigInt, Decimal, Buffer) for certain
 * column types. JSON round-trip during record/replay loses this type information.
 * We reconstruct types during replay using two strategies:
 *
 * 1. **Model-based operations** (findFirst, create, update, etc.): The middleware
 *    provides the model name, so we look up field types from `_runtimeDataModel`
 *    at replay time. No extra metadata needed during recording.
 *
 * 2. **Raw queries** ($queryRaw): No model name is available. During recording,
 *    we sniff JS types from the result and store a per-column `_tdTypeMap`
 *    (e.g., `{bigNum: "bigint", data: "bytes"}`). During replay, we use this
 *    map to reconstruct the values.
 *
 * Both strategies share `_reconstructSingleValue` for the actual conversion.
 * See docs/prisma-type-deserialization-bug.md for the full design doc.
 */
export class PrismaInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "PrismaInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private prismaErrorClasses: PrismaErrorClassInfo[] = [];
  private prismaClient: any = null;
  private prismaNamespace: any = null;

  constructor(config: PrismaInstrumentationConfig = {}) {
    super("@prisma/client", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "@prisma/client",
        supportedVersions: ["5.*", "6.*"],
        patch: (moduleExports: PrismaModuleExports) => this._patchPrismaModule(moduleExports),
      }),
    ];
  }

  private _patchPrismaModule(prismaModule: PrismaModuleExports): PrismaModuleExports {
    if (this.isModulePatched(prismaModule)) {
      logger.debug(`[PrismaInstrumentation] Prisma module already patched, skipping`);
      return prismaModule;
    }

    // Store Prisma error classes and namespace for later use
    this._storePrismaErrorClasses(prismaModule);
    this.prismaNamespace = prismaModule.Prisma || prismaModule;

    // Wrap the PrismaClient constructor
    logger.debug(`[PrismaInstrumentation] Wrapping PrismaClient constructor`);
    this._wrap(prismaModule, "PrismaClient", (OriginalPrismaClient: any) => {
      const self = this;
      logger.debug(`[PrismaInstrumentation] PrismaClient wrapper called`);

      return class TdPrismaClient {
        constructor(...args: any[]) {
          logger.debug(`[PrismaInstrumentation] Creating patched PrismaClient instance`);

          // Create the original Prisma client
          const prismaClient = new OriginalPrismaClient(...args);

          // Store reference for runtime data model access during replay
          self.prismaClient = prismaClient;

          // Extend the client with our instrumentation
          const extendedClient = prismaClient.$extends({
            query: {
              async $allOperations({ model, operation, args: operationArgs, query }: any) {
                logger.debug(
                  `[PrismaInstrumentation] $allOperations intercepted: ${model}.${operation}`,
                );
                return self._handlePrismaOperation({
                  model,
                  operation,
                  args: operationArgs,
                  query,
                });
              },
            },
          });

          // In replay mode, override $transaction to avoid connecting to the real DB.
          // Interactive transactions (callback-based) normally open a DB connection
          // before any operations inside the callback run. Since all operations will
          // be mocked by $allOperations, we just execute the callback directly with
          // the extended client as the transaction proxy.
          if (self.mode === TuskDriftMode.REPLAY) {
            const originalTransaction = extendedClient.$transaction.bind(extendedClient);
            extendedClient.$transaction = async function (...txArgs: any[]) {
              const firstArg = txArgs[0];

              if (typeof firstArg === "function") {
                // Interactive transaction: execute callback with the client itself
                logger.debug(
                  `[PrismaInstrumentation] Replay: bypassing interactive $transaction DB connection`,
                );
                return firstArg(extendedClient);
              }

              if (Array.isArray(firstArg)) {
                // Sequential transaction: resolve each PrismaPromise
                logger.debug(
                  `[PrismaInstrumentation] Replay: bypassing sequential $transaction DB connection`,
                );
                return Promise.all(firstArg);
              }

              // Unknown pattern — fall through to original
              return originalTransaction(...txArgs);
            };
          }

          return extendedClient;
        }
      };
    });

    this.markModuleAsPatched(prismaModule);
    logger.debug(`[PrismaInstrumentation] Prisma module patching complete`);

    return prismaModule;
  }

  private _storePrismaErrorClasses(moduleExports: PrismaModuleExports): void {
    // In ESM, error classes are in moduleExports.Prisma.*
    // In CJS, error classes are directly on moduleExports.*
    const prismaNamespace = moduleExports.Prisma || {};

    this.prismaErrorClasses = [
      {
        name: PrismaErrorClassName.PrismaClientKnownRequestError,
        errorClass:
          moduleExports.PrismaClientKnownRequestError ||
          prismaNamespace.PrismaClientKnownRequestError,
      },
      {
        name: PrismaErrorClassName.PrismaClientUnknownRequestError,
        errorClass:
          moduleExports.PrismaClientUnknownRequestError ||
          prismaNamespace.PrismaClientUnknownRequestError,
      },
      {
        name: PrismaErrorClassName.PrismaClientInitializationError,
        errorClass:
          moduleExports.PrismaClientInitializationError ||
          prismaNamespace.PrismaClientInitializationError,
      },
      {
        name: PrismaErrorClassName.PrismaClientValidationError,
        errorClass:
          moduleExports.PrismaClientValidationError || prismaNamespace.PrismaClientValidationError,
      },
      {
        name: PrismaErrorClassName.PrismaClientRustPanicError,
        errorClass:
          moduleExports.PrismaClientRustPanicError || prismaNamespace.PrismaClientRustPanicError,
      },
      {
        name: PrismaErrorClassName.NotFoundError,
        errorClass: moduleExports.NotFoundError || prismaNamespace.NotFoundError,
      },
    ];
  }

  private _handlePrismaOperation({
    model,
    operation,
    args,
    query,
  }: {
    model: string;
    operation: string;
    args: any;
    query: (args: any) => Promise<any>;
  }): Promise<any> {
    const inputValue: PrismaInputValue = {
      model,
      operation,
      args,
    };

    logger.debug(
      `[PrismaInstrumentation] Intercepted Prisma operation: ${model}.${operation} in ${this.mode} mode`,
    );

    if (this.mode === TuskDriftMode.RECORD) {
      return handleRecordMode({
        originalFunctionCall: () => query(args),
        recordModeHandler: ({ isPreAppStart }) => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => query(args),
            {
              name: `prisma.${operation}`,
              kind: SpanKind.CLIENT,
              submodule: model,
              packageType: PackageType.PRISMA,
              packageName: "@prisma/client",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue,
              isPreAppStart,
            },
            (spanInfo) => {
              return this._handleRecordPrismaOperation(spanInfo, query, args, model);
            },
          );
        },
        spanKind: SpanKind.CLIENT,
      });
    } else if (this.mode === TuskDriftMode.REPLAY) {
      const stackTrace = captureStackTrace(["PrismaInstrumentation"]);

      return handleReplayMode({
        noOpRequestHandler: () => query(args),
        isServerRequest: false,
        replayModeHandler: () => {
          return SpanUtils.createAndExecuteSpan(
            this.mode,
            () => query(args),
            {
              name: `prisma.${operation}`,
              kind: SpanKind.CLIENT,
              submodule: model,
              packageType: PackageType.PRISMA,
              packageName: "@prisma/client",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue,
              isPreAppStart: false,
            },
            (spanInfo) => {
              return this._handleReplayPrismaOperation(spanInfo, inputValue, stackTrace);
            },
          );
        },
      });
    } else {
      // DISABLED mode - just pass through
      return query(args);
    }
  }

  private async _handleRecordPrismaOperation(
    spanInfo: SpanInfo,
    query: (args: any) => Promise<any>,
    args: any,
    model?: string,
  ): Promise<any> {
    try {
      logger.debug(`[PrismaInstrumentation] Recording Prisma operation`);

      // Execute the real Prisma query
      const result = await query(args);

      // For operations without a model (e.g., $queryRaw), sniff JS types from
      // the result so we can reconstruct them during replay. Model-based operations
      // use _runtimeDataModel schema metadata instead.
      const typeMap = model ? null : this._buildTypeMap(result);

      // Store the result in the span
      const outputValue: PrismaOutputValue = {
        prismaResult: result,
        _tdOriginalFormat: "result",
        ...(typeMap && { _tdTypeMap: typeMap }),
      };

      try {
        SpanUtils.addSpanAttributes(spanInfo.span, {
          outputValue,
        });
        SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
      } catch (spanError) {
        logger.error(`[PrismaInstrumentation] error adding span attributes:`, spanError);
      }

      return result;
    } catch (error: any) {
      logger.debug(`[PrismaInstrumentation] Prisma operation error: ${error.message}`);

      try {
        // Identify the Prisma error class
        const errorClassName = this._getPrismaErrorClassName(error);

        // Create a serializable error object
        const errorWithClassName: PrismaErrorWithClassName = this._cloneError(error);
        if (errorClassName) {
          errorWithClassName.customTdName = errorClassName;
        }

        // Store the error in the span
        const outputValue: PrismaOutputValue = {
          prismaResult: errorWithClassName,
          _tdOriginalFormat: "error",
        };

        SpanUtils.addSpanAttributes(spanInfo.span, {
          outputValue,
        });
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
          message: error.message,
        });
      } catch (spanError) {
        logger.error(
          `[PrismaInstrumentation] error extracting error and adding span attributes:`,
          spanError,
        );
      }

      // Re-throw the original error
      throw error;
    }
  }

  private async _handleReplayPrismaOperation(
    spanInfo: SpanInfo,
    inputValue: PrismaInputValue,
    stackTrace?: string,
  ): Promise<any> {
    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: `prisma.${inputValue.operation}`,
        inputValue,
        packageName: "@prisma/client",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: inputValue.model,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(
        `[PrismaInstrumentation] No mock data found for Prisma operation: ${inputValue.model}.${inputValue.operation}`,
      );
      throw new Error(
        `[PrismaInstrumentation] No matching mock found for Prisma operation: ${inputValue.model}.${inputValue.operation}`,
      );
    }

    logger.debug(
      `[PrismaInstrumentation] Found mock data for Prisma operation: ${inputValue.model}.${inputValue.operation}`,
    );

    const outputValue = mockData.result as PrismaOutputValue;

    // Check if this is an error replay
    if (outputValue._tdOriginalFormat === "error") {
      const errorObj = outputValue.prismaResult as PrismaErrorWithClassName;

      // Restore the correct Prisma error class prototype
      if (errorObj.customTdName) {
        const errorClass = this._getPrismaErrorClassFromName(errorObj.customTdName);
        if (errorClass) {
          Object.setPrototypeOf(errorObj, errorClass.prototype);
        }
      }

      SpanUtils.endSpan(spanInfo.span, {
        code: SpanStatusCode.ERROR,
        message: errorObj.message || "Prisma error",
      });

      throw errorObj;
    }

    // Reconstruct Prisma types that were lost during JSON serialization
    let result = outputValue.prismaResult;
    try {
      if (inputValue.model) {
        // Model-based operations: use _runtimeDataModel schema metadata
        result = this._reconstructPrismaTypes(result, inputValue.model);
      } else if (outputValue._tdTypeMap) {
        // Raw queries ($queryRaw): use sniffed type map from recording
        result = this._reconstructFromTypeMap(result, outputValue._tdTypeMap as Record<string, string>);
      }
    } catch (reconstructError) {
      logger.debug(
        `[PrismaInstrumentation] Failed to reconstruct types: ${reconstructError}`,
      );
    }

    // Return the successful result
    SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    return result;
  }

  /**
   * Sniff the JS type of a value returned by Prisma.
   *
   * Returns type names that mirror Prisma's internal `QueryIntrospectionBuiltinType`
   * enum from `@prisma/client/runtime` (used in `deserializeRawResults.ts`):
   *   "bigint" | "bytes" | "decimal" | "datetime"
   *
   * We don't import these types directly — we use our own string literals that
   * match Prisma's naming convention so the type map is self-documenting and
   * consistent with what Prisma would produce internally.
   */
  private _sniffType(value: any): string | null {
    if (typeof value === "bigint") return "bigint";
    if (value instanceof Date) return "datetime";
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return "bytes";
    // Prisma uses decimal.js internally but minifies the class name in production builds
    // (constructor.name may be "i" instead of "Decimal"), so we detect by checking for
    // decimal.js-specific methods rather than constructor name.
    if (
      typeof value === "object" &&
      value !== null &&
      typeof value.toFixed === "function" &&
      typeof value.toExponential === "function" &&
      typeof value.toSignificantDigits === "function"
    )
      return "decimal";
    return null;
  }

  /**
   * Build a per-column type map by sniffing values in the result.
   * For arrays of objects (e.g., $queryRaw results), scans all rows to handle
   * cases where the first row has null values but later rows don't.
   * Returns null if no special types are detected.
   */
  private _buildTypeMap(result: any): Record<string, string> | null {
    if (result === null || result === undefined) return null;

    const rows = Array.isArray(result) ? result : typeof result === "object" ? [result] : null;
    if (!rows || rows.length === 0) return null;

    const typeMap: Record<string, string> = {};
    let hasTypes = false;

    for (const row of rows) {
      if (!row || typeof row !== "object") continue;

      for (const [key, value] of Object.entries(row)) {
        if (typeMap[key] || value === null || value === undefined) continue;

        // Check for arrays of special types
        if (Array.isArray(value) && value.length > 0) {
          const elemType = this._sniffType(value[0]);
          if (elemType) {
            typeMap[key] = `${elemType}-array`;
            hasTypes = true;
            continue;
          }
        }

        const type = this._sniffType(value);
        if (type) {
          typeMap[key] = type;
          hasTypes = true;
        }
      }

      // Once all keys have been typed, no need to scan more rows
      if (hasTypes && Object.keys(typeMap).length >= Object.keys(rows[0]).length) break;
    }

    return hasTypes ? typeMap : null;
  }

  /**
   * Reconstruct types from a _tdTypeMap (used for $queryRaw and other model-less operations).
   */
  private _reconstructFromTypeMap(
    result: any,
    typeMap: Record<string, string>,
  ): any {
    if (result === null || result === undefined) return result;

    const reconstructRow = (row: any): any => {
      if (typeof row !== "object" || row === null) return row;

      for (const [key, type] of Object.entries(typeMap)) {
        const value = row[key];
        if (value === null || value === undefined) continue;

        // Handle array types
        if (typeof type === "string" && type.endsWith("-array") && Array.isArray(value)) {
          const baseType = type.replace("-array", "");
          row[key] = value.map((v: any) => this._reconstructSingleValue(v, baseType));
          continue;
        }

        row[key] = this._reconstructSingleValue(value, type);
      }

      return row;
    };

    if (Array.isArray(result)) {
      return result.map(reconstructRow);
    }
    return reconstructRow(result);
  }

  /**
   * Reconstruct a single value from its JSON-deserialized form back to the
   * original JS type that Prisma would have returned.
   *
   * The `type` parameter uses the same names as Prisma's query engine types
   * (see _sniffType and PRISMA_SCHEMA_TO_ENGINE_TYPE). Both the model-based
   * and raw-query replay paths converge here.
   */
  private _reconstructSingleValue(value: any, type: string): any {
    if (value === null || value === undefined) return value;

    switch (type) {
      case "bigint":
        // JSON round-trip turns BigInt into a string (via safeJsonStringify)
        if (typeof value === "string" || typeof value === "number") {
          return BigInt(value);
        }
        return value;
      case "datetime":
        // JSON round-trip turns Date into an ISO string
        if (typeof value === "string") {
          return new Date(value);
        }
        return value;
      case "decimal":
        if (typeof value === "string" || typeof value === "number") {
          // Prefer Prisma's own Decimal class (from decimal.js) for full API compatibility
          if (this.prismaNamespace?.Decimal) {
            return new this.prismaNamespace.Decimal(value);
          }
          // Fallback: create a minimal Decimal-like object when Prisma namespace isn't available
          const decimalValue = String(value);
          return {
            toString: () => decimalValue,
            toFixed: (dp?: number) => Number(decimalValue).toFixed(dp),
            valueOf: () => Number(decimalValue),
            [Symbol.toPrimitive]: (hint: string) =>
              hint === "string" ? decimalValue : Number(decimalValue),
          };
        }
        return value;
      case "bytes":
        // JSON round-trip turns Buffer into either a base64 string or a plain object
        // with numeric keys ({0: 222, 1: 173, ...}) or a {type: "Buffer", data: [...]} shape
        if (typeof value === "string") {
          return Buffer.from(value, "base64");
        }
        if (typeof value === "object" && !Buffer.isBuffer(value)) {
          const bufferData = (value as any).data || Object.values(value);
          return Buffer.from(bufferData);
        }
        return value;
      default:
        return value;
    }
  }

  /**
   * Map from Prisma schema type names (as found in `_runtimeDataModel.models[model].fields[].type`)
   * to the query engine type names used by `_reconstructSingleValue`.
   *
   * Schema types use PascalCase ("DateTime", "BigInt"), while the engine types
   * use lowercase ("datetime", "bigint") — matching Prisma's internal
   * `QueryIntrospectionBuiltinType` naming convention.
   */
  private static readonly PRISMA_SCHEMA_TO_ENGINE_TYPE: Record<string, string> = {
    DateTime: "datetime",
    BigInt: "bigint",
    Decimal: "decimal",
    Bytes: "bytes",
  };

  /**
   * Reconstruct Prisma types for model-based operations (findFirst, create, update, etc.).
   *
   * Uses `prismaClient._runtimeDataModel` — Prisma's internal schema representation
   * available at runtime — to determine field types. This avoids needing to store
   * type metadata during recording; the schema itself is the source of truth.
   *
   * Handles scalar fields, array fields (e.g., BigInt[]), and nested relations recursively.
   */
  private _reconstructPrismaTypes(result: any, modelName: string): any {
    if (result === null || result === undefined) return result;

    const runtimeDataModel = this.prismaClient?._runtimeDataModel;
    if (!runtimeDataModel) return result;

    if (Array.isArray(result)) {
      return result.map((item) => this._reconstructPrismaTypes(item, modelName));
    }

    const model = runtimeDataModel.models[modelName];
    if (!model) return result;

    if (typeof result !== "object") return result;

    const fieldTypeMap = new Map<string, any>(model.fields.map((f: any) => [f.name, f]));

    for (const [key, value] of Object.entries(result)) {
      const field = fieldTypeMap.get(key);
      if (!field || value === null || value === undefined) continue;

      if (field.kind === "scalar") {
        const engineType = PrismaInstrumentation.PRISMA_SCHEMA_TO_ENGINE_TYPE[field.type];
        if (engineType) {
          if (Array.isArray(value)) {
            result[key] = value.map((v: any) => this._reconstructSingleValue(v, engineType));
          } else {
            result[key] = this._reconstructSingleValue(value, engineType);
          }
        }
      }

      // Handle relations (nested objects)
      if (field.kind === "object" && field.type && typeof value === "object") {
        result[key] = this._reconstructPrismaTypes(value, field.type);
      }
    }

    return result;
  }

  private _getPrismaErrorClassName(error: any): PrismaErrorClassName | undefined {
    for (const errorInfo of this.prismaErrorClasses) {
      if (error instanceof errorInfo.errorClass) {
        return errorInfo.name;
      }
    }
    return undefined;
  }

  private _getPrismaErrorClassFromName(className: PrismaErrorClassName): any {
    for (const errorInfo of this.prismaErrorClasses) {
      if (errorInfo.name === className) {
        return errorInfo.errorClass;
      }
    }
    return null;
  }

  /**
   * Deep clone an error object to make it serializable
   */
  private _cloneError(error: any): PrismaErrorWithClassName {
    const cloned: PrismaErrorWithClassName = new Error(error.message) as PrismaErrorWithClassName;
    cloned.name = error.name;
    cloned.stack = error.stack;

    // Copy all enumerable properties
    for (const key in error) {
      if (error.hasOwnProperty(key)) {
        try {
          cloned[key] = error[key];
        } catch (e) {
          // Skip properties that can't be copied
        }
      }
    }

    return cloned;
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
