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

export class PrismaInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "PrismaInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private prismaErrorClasses: PrismaErrorClassInfo[] = [];

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

    // Store Prisma error classes for later use
    this._storePrismaErrorClasses(prismaModule);

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
              packageType: PackageType.UNSPECIFIED,
              packageName: "@prisma/client",
              instrumentationName: this.INSTRUMENTATION_NAME,
              inputValue,
              isPreAppStart,
            },
            (spanInfo) => {
              return this._handleRecordPrismaOperation(spanInfo, query, args);
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
              packageType: PackageType.UNSPECIFIED,
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
  ): Promise<any> {
    try {
      logger.debug(`[PrismaInstrumentation] Recording Prisma operation`);

      // Execute the real Prisma query
      const result = await query(args);

      // Store the result in the span
      const outputValue: PrismaOutputValue = {
        prismaResult: result,
        _tdOriginalFormat: "result",
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

    // Return the successful result
    SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    return outputValue.prismaResult;
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
