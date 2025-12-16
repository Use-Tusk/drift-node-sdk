import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils/logger";
import {
  GrpcInstrumentationConfig,
  GrpcModuleExports,
  GrpcClientInputValue,
  GrpcServerInputValue,
  ReadableMetadata,
  GrpcOutputValue,
  BufferMetadata,
  GrpcErrorOutput,
} from "./types";
import {
  serializeGrpcMetadata,
  deserializeGrpcMetadata,
  parseGrpcPath,
  serializeGrpcPayload,
  deserializeGrpcPayload,
} from "./utils";
import { EventEmitter } from "events";
import { Readable } from "stream";
import { Metadata } from "@grpc/grpc-js";

const GRPC_MODULE_NAME = "@grpc/grpc-js";

export class GrpcInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "GrpcInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private Metadata: typeof Metadata;
  // Store for version-specific Metadata constructors
  private static metadataStore = new Map<string, typeof Metadata>();

  constructor(config: GrpcInstrumentationConfig = {}) {
    super("grpc", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
    logger.debug(`[GrpcInstrumentation] Constructor called with mode: ${this.mode}`);
  }

  init(): TdInstrumentationNodeModule[] {
    // Client file instrumentation - patch the internal client module
    const grpcClientFileInstrumentation = new TdInstrumentationNodeModuleFile({
      name: `${GRPC_MODULE_NAME}/build/src/client.js`,
      supportedVersions: ["1.*"],
      patch: (moduleExports: any, version?: string) => {
        logger.debug(`[GrpcInstrumentation] Patching gRPC client file v${version}`);

        if (moduleExports.Client && moduleExports.Client.prototype) {
          this._patchGrpcClient(moduleExports.Client.prototype, version || "");
          logger.debug(`[GrpcInstrumentation] Wrapped Client methods in client file`);
        } else {
          logger.warn(`[GrpcInstrumentation] Client class not found in client file exports`);
        }

        return moduleExports;
      },
    });

    // NOTE: Not using this yet. This is somewhat working, haven't full tested it yet
    // Adding this would require more changes to replay grpc server calls. Holding off until a customer asks for it
    // const grpcServerFileInstrumentation = new TdInstrumentationNodeModuleFile({
    //   name: `${GRPC_MODULE_NAME}/build/src/server.js`,
    //   supportedVersions: ["1.*"],
    //   patch: (moduleExports: any, version?: string) => {
    //     logger.debug(`[GrpcInstrumentation] Patching gRPC server file v${version}`);

    //     if (moduleExports.Server && moduleExports.Server.prototype) {
    //       this._patchGrpcServer(moduleExports.Server.prototype, version || "");
    //       logger.debug(`[GrpcInstrumentation] Wrapped Server methods in server file`);
    //     } else {
    //       logger.warn(`[GrpcInstrumentation] Server class not found in server file exports`);
    //     }

    //     return moduleExports;
    //   },
    // });

    // Main module instrumentation - patch the main @grpc/grpc-js package
    const grpcInstrumentation = new TdInstrumentationNodeModule({
      name: GRPC_MODULE_NAME,
      supportedVersions: ["1.*"],
      patch: (moduleExports: GrpcModuleExports, version?: string) => {
        logger.debug(`[GrpcInstrumentation] Patching main gRPC module v${version}`);
        return this._patchGrpcModule(moduleExports, version || "");
      },
      files: [grpcClientFileInstrumentation],
    });

    return [grpcInstrumentation];
  }

  private _patchGrpcModule(moduleExports: GrpcModuleExports, version: string): GrpcModuleExports {
    logger.debug(`[GrpcInstrumentation] Patching gRPC main module in ${this.mode} mode`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[GrpcInstrumentation] gRPC module already patched, skipping`);
      return moduleExports;
    }

    // Store Metadata constructor for this version
    if (moduleExports.Metadata) {
      GrpcInstrumentation.metadataStore.set(version, moduleExports.Metadata);
      this.Metadata = moduleExports.Metadata;
      logger.debug(`[GrpcInstrumentation] Stored Metadata constructor for version ${version}`);
    }

    // Note: Client and Server are patched via TdInstrumentationNodeModuleFile for the internal modules
    // This ensures the patches are applied before any service clients are created
    // The Client.prototype.makeUnaryRequest patch will handle all unary gRPC calls

    this.markModuleAsPatched(moduleExports);
    logger.debug(`[GrpcInstrumentation] gRPC main module patching complete`);

    return moduleExports;
  }

  private _patchGrpcClient(clientPrototype: any, version: string): void {
    if (!clientPrototype) {
      logger.warn(`[GrpcInstrumentation] Client prototype not found`);
      return;
    }

    // Wrap makeUnaryRequest
    this._wrap(clientPrototype, "makeUnaryRequest", this._getMakeUnaryRequestPatchFn(version));

    // Wrap server streaming requests (used by Firestore queries)
    this._wrap(
      clientPrototype,
      "makeServerStreamRequest",
      this._getMakeServerStreamRequestPatchFn(version),
    );

    // Wrap waitForReady (for replay mode, we skip the actual wait)
    this._wrap(clientPrototype, "waitForReady", this._getWaitForReadyPatchFn());

    // Wrap close (for replay mode, we don't actually close)
    this._wrap(clientPrototype, "close", this._getClosePatchFn());

    // Wrap getChannel (for replay mode, we return a mock)
    this._wrap(clientPrototype, "getChannel", this._getGetChannelPatchFn());

    logger.debug(`[GrpcInstrumentation] Client methods patched successfully`);
  }

  // NOTE: Not using this yet. This is somewhat working, haven't full tested it yet
  // Adding this would require more changes to replay grpc server calls. Holding off until a customer asks for it
  // private _patchGrpcServer(serverPrototype: any, version: string): void {
  //   if (!serverPrototype) {
  //     logger.warn(`[GrpcInstrumentation] Server prototype not found`);
  //     return;
  //   }

  //   // Wrap register method to intercept handler registration
  //   this._wrap(serverPrototype, "register", this._getRegisterPatchFn(version));

  //   logger.debug(`[GrpcInstrumentation] Server methods patched successfully`);
  // }

  /**
   * Helper method to parse optional unary response arguments
   *
   * Handles the following cases (matching grpc-node's checkOptionalUnaryResponseArguments):
   * 1. (callback: Function) - callback only, no metadata or options
   * 2. (metadata: Metadata, callback: Function) - metadata + callback, no options
   * 3. (options: Object, callback: Function) - options + callback, no metadata
   * 4. (metadata: Metadata, options: Object, callback: Function) - full signature
   */
  private parseUnaryCallArguments(
    MetadataConstructor: typeof Metadata,
    arg1: any,
    arg2: any,
    arg3: any,
  ): { metadata: any; options: any; callback: Function } {
    // Case 1: callback only (no metadata, no options)
    if (typeof arg1 === "function") {
      return {
        metadata: new MetadataConstructor(),
        options: {},
        callback: arg1,
      };
    }

    // Case 2: metadata + callback (no options)
    if (arg1 instanceof MetadataConstructor && typeof arg2 === "function") {
      return {
        metadata: arg1,
        options: {},
        callback: arg2,
      };
    }

    // Case 3: options + callback (no metadata)
    // arg1 is an object but NOT Metadata, arg2 is the callback
    if (
      !(arg1 instanceof MetadataConstructor) &&
      typeof arg1 === "object" &&
      arg1 !== null &&
      typeof arg2 === "function"
    ) {
      return {
        metadata: new MetadataConstructor(),
        options: arg1,
        callback: arg2,
      };
    }

    // Case 4: metadata + options + callback (full signature)
    if (
      arg1 instanceof MetadataConstructor &&
      arg2 instanceof Object &&
      typeof arg3 === "function"
    ) {
      return {
        metadata: arg1,
        options: arg2,
        callback: arg3,
      };
    }

    // We try/catch this function so throwing an error is okay
    throw new Error(
      `[GrpcInstrumentation] Incorrect arguments passed to makeUnaryRequest. Expected (metadata, [options], callback) but got types: (${typeof arg1}, ${typeof arg2}, ${typeof arg3})`,
    );
  }

  /**
   * Helper method to extract and validate all input parameters for makeUnaryRequest
   */
  private extractRequestParameters(
    args: any[],
    MetadataConstructor: typeof Metadata,
  ): {
    method: string;
    serialize: Function;
    deserialize: Function;
    argument: any;
    metadata: any;
    options: any;
    callback: Function;
  } {
    const method = args[0];
    const serialize = args[1];
    const deserialize = args[2];
    const argument = args[3];

    const { metadata, options, callback } = this.parseUnaryCallArguments(
      MetadataConstructor,
      args[4],
      args[5],
      args[6],
    );

    return { method, serialize, deserialize, argument, metadata, options, callback };
  }

  private _getMakeUnaryRequestPatchFn(version: string) {
    const self = this;
    logger.debug(
      `[GrpcInstrumentation] _getMakeUnaryRequestPatchFn called for version: ${version}`,
    );
    return (original: Function) => {
      return function makeUnaryRequest(this: any, ...args: any[]) {
        logger.debug(`[GrpcInstrumentation] makeUnaryRequest called! args length: ${args.length}`);
        const MetadataConstructor = GrpcInstrumentation.metadataStore.get(version) || self.Metadata;

        if (!MetadataConstructor) {
          logger.warn(
            `[GrpcInstrumentation] Metadata constructor not found for version ${version}`,
          );
          return original.apply(this, args);
        }

        // Use defensive parsing to extract and validate all parameters
        let parsedParams: {
          method: string;
          serialize: Function;
          deserialize: Function;
          argument: any;
          metadata: typeof Metadata;
          options: any;
          callback: Function;
        };

        try {
          parsedParams = self.extractRequestParameters(args, MetadataConstructor);
        } catch (error) {
          logger.error(`[GrpcInstrumentation] Error parsing makeUnaryRequest arguments:`, error);
          // Fall back to original function if we can't parse the arguments
          return original.apply(this, args);
        }

        const { method: path, argument, metadata, options, callback } = parsedParams;

        let method: string;
        let service: string;
        let readableBody: any;
        let bufferMap: Record<
          string,
          {
            value: string;
            encoding: string;
          }
        >;
        let jsonableStringMap: Record<string, string>;
        let readableMetadata: ReadableMetadata;

        try {
          ({ method, service } = parseGrpcPath(path));
          ({ readableBody, bufferMap, jsonableStringMap } = serializeGrpcPayload(argument));
          readableMetadata = serializeGrpcMetadata(metadata);
        } catch (error) {
          logger.error(`[GrpcInstrumentation] Error parsing makeUnaryRequest arguments:`, error);
          // Fall back to original function if we can't parse the arguments
          return original.apply(this, args);
        }

        const inputMeta: BufferMetadata = {
          bufferMap,
          jsonableStringMap,
        };

        const inputValue: GrpcClientInputValue = {
          method,
          service,
          body: readableBody,
          metadata: readableMetadata,
          inputMeta,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["GrpcInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              callback(null, undefined);
              return;
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => original.apply(this, args),
                {
                  name: "grpc.client.unary",
                  kind: SpanKind.CLIENT,
                  submodule: "client",
                  packageType: PackageType.GRPC,
                  packageName: GRPC_MODULE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayUnaryRequest(
                    spanInfo,
                    inputValue,
                    callback,
                    MetadataConstructor,
                    stackTrace,
                  );
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => original.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => original.apply(this, args),
                {
                  name: "grpc.client.unary",
                  kind: SpanKind.CLIENT,
                  submodule: "client",
                  packageType: PackageType.GRPC,
                  packageName: GRPC_MODULE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordUnaryRequest(
                    spanInfo,
                    original,
                    this,
                    parsedParams,
                    callback,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return original.apply(this, args);
        }
      };
    };
  }

  private _getMakeServerStreamRequestPatchFn(version: string) {
    const self = this;
    logger.debug(
      `[GrpcInstrumentation] _getMakeServerStreamRequestPatchFn called for version: ${version}`,
    );
    return (original: Function) => {
      return function makeServerStreamRequest(this: any, ...args: any[]) {
        logger.debug(
          `[GrpcInstrumentation] makeServerStreamRequest called! args length: ${args.length}`,
        );
        const MetadataConstructor = GrpcInstrumentation.metadataStore.get(version) || self.Metadata;

        if (!MetadataConstructor) {
          logger.warn(
            `[GrpcInstrumentation] Metadata constructor not found for version ${version}`,
          );
          return original.apply(this, args);
        }

        // Parse arguments for server stream request
        // Signature: (method, serialize, deserialize, argument, metadata?, options?)
        let parsedParams: {
          method: string;
          serialize: Function;
          deserialize: Function;
          argument: any;
          metadata: any;
          options: any;
        };

        try {
          parsedParams = self.extractServerStreamRequestParameters(args, MetadataConstructor);
        } catch (error) {
          logger.error(
            `[GrpcInstrumentation] Error parsing makeServerStreamRequest arguments:`,
            error,
          );
          // Fall back to original function if we can't parse the arguments
          return original.apply(this, args);
        }

        const { method: path, argument, metadata, options } = parsedParams;

        let method: string;
        let service: string;
        let readableBody: any;
        let bufferMap: Record<
          string,
          {
            value: string;
            encoding: string;
          }
        >;
        let jsonableStringMap: Record<string, string>;
        let readableMetadata: ReadableMetadata;

        try {
          ({ method, service } = parseGrpcPath(path));
          ({ readableBody, bufferMap, jsonableStringMap } = serializeGrpcPayload(argument));
          readableMetadata = serializeGrpcMetadata(metadata);
        } catch (error) {
          logger.error(
            `[GrpcInstrumentation] Error parsing makeServerStreamRequest arguments:`,
            error,
          );
          // Fall back to original function if we can't parse the arguments
          return original.apply(this, args);
        }

        const inputMeta: BufferMetadata = {
          bufferMap,
          jsonableStringMap,
        };

        const inputValue: GrpcClientInputValue = {
          method,
          service,
          body: readableBody,
          metadata: readableMetadata,
          inputMeta,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              // Create a Readable stream instead of EventEmitter
              const stream = new Readable({
                objectMode: true, // Important for gRPC which streams objects
                read() {
                  // No-op: data will be pushed asynchronously when mock data arrives
                },
              });

              // Add gRPC-specific methods
              Object.assign(stream, {
                cancel() {},
                getPeer: () => "0.0.0.0:0000",
                call: undefined,
              });

              return stream;
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => original.apply(this, args),
                {
                  name: "grpc.client.server_stream",
                  kind: SpanKind.CLIENT,
                  submodule: "client",
                  packageType: PackageType.GRPC,
                  packageName: GRPC_MODULE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayServerStreamRequest(
                    spanInfo,
                    inputValue,
                    MetadataConstructor,
                  );
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => original.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => original.apply(this, args),
                {
                  name: "grpc.client.server_stream",
                  kind: SpanKind.CLIENT,
                  submodule: "client",
                  packageType: PackageType.GRPC,
                  packageName: GRPC_MODULE_NAME,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordServerStreamRequest(
                    spanInfo,
                    original,
                    this,
                    parsedParams,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return original.apply(this, args);
        }
      };
    };
  }

  private extractServerStreamRequestParameters(
    args: any[],
    MetadataConstructor: any,
  ): {
    method: string;
    serialize: Function;
    deserialize: Function;
    argument: any;
    metadata: any;
    options: any;
  } {
    // Server stream request signature:
    // (method, serialize, deserialize, argument, metadata?, options?)
    const method = args[0];
    const serialize = args[1];
    const deserialize = args[2];
    const argument = args[3];

    // args[4] can be metadata or options
    // args[5] can be options
    let metadata: any;
    let options: any;

    if (args.length === 6) {
      // Both metadata and options provided
      metadata = args[4];
      options = args[5];
    } else if (args.length === 5) {
      // Either metadata or options provided
      // Check if it's a Metadata instance
      if (args[4] instanceof MetadataConstructor) {
        metadata = args[4];
        options = {};
      } else {
        metadata = new MetadataConstructor();
        options = args[4] || {};
      }
    } else {
      metadata = new MetadataConstructor();
      options = {};
    }

    return { method, serialize, deserialize, argument, metadata, options };
  }

  private _handleRecordUnaryRequest(
    spanInfo: SpanInfo,
    original: Function,
    context: any,
    parsedParams: {
      method: string;
      serialize: Function;
      deserialize: Function;
      argument: any;
      metadata: any;
      options: any;
      callback: Function;
    },
    callback: Function,
  ): any {
    let isResponseReceived = false;
    let isStatusEmitted = false;
    let hasErrorOccurred = false;
    let isSpanCompleted = false;
    let readableResponseBody: any;
    let responseBufferMap: Record<string, { value: string; encoding: string }> = {};
    let responseJsonableStringMap: Record<string, any> = {};
    let status: {
      code: number;
      details: string;
      metadata: Record<string, any>;
    };
    let responseMetadataInitial: any = {};
    let serviceError: any;

    /**
     * Completes the span exactly once, regardless of which event fires first.
     * gRPC's asynchronous nature means the callback and status event can fire in any order,
     * so we need to guard against double span completion.
     */
    const completeSpan = (output: any, statusCode: SpanStatusCode, errorMessage?: string) => {
      if (isSpanCompleted) {
        return; // Span already completed, prevent double-ending
      }
      isSpanCompleted = true;

      try {
        SpanUtils.addSpanAttributes(spanInfo.span, {
          outputValue: output,
        });
        SpanUtils.endSpan(spanInfo.span, {
          code: statusCode,
          message: errorMessage,
        });
      } catch (e) {
        logger.error(`[GrpcInstrumentation] Error completing span:`, e);
      }
    };

    // Wrap the callback to capture response
    const patchedCallback = (err: any, value: any) => {
      try {
        if (err) {
          serviceError = err;
          hasErrorOccurred = true;
        } else {
          const { readableBody, bufferMap, jsonableStringMap } = serializeGrpcPayload(value);
          readableResponseBody = readableBody;
          responseBufferMap = bufferMap;
          responseJsonableStringMap = jsonableStringMap;
          isResponseReceived = true;
        }

        if (isStatusEmitted && isResponseReceived) {
          const realOutput: GrpcOutputValue = {
            body: readableResponseBody,
            metadata: responseMetadataInitial,
            status,
            bufferMap: responseBufferMap,
            jsonableStringMap: responseJsonableStringMap,
          };
          completeSpan(realOutput, SpanStatusCode.OK);
        } else if (isStatusEmitted && hasErrorOccurred) {
          const errorOutput: GrpcErrorOutput = {
            error: {
              message: serviceError.message,
              name: serviceError.name,
              stack: serviceError.stack,
            },
            status,
            metadata: responseMetadataInitial,
          };
          completeSpan(errorOutput, SpanStatusCode.ERROR, serviceError.message);
        }
      } catch (e) {
        logger.error(`[GrpcInstrumentation] Error in patchedCallback:`, e);
      }

      return callback(err, value);
    };

    // Reconstruct the makeUnaryRequest call with all validated parameters
    // This ensures we always pass the full 7 arguments in the correct format
    const inputArgs = [
      parsedParams.method,
      parsedParams.serialize,
      parsedParams.deserialize,
      parsedParams.argument,
      parsedParams.metadata,
      parsedParams.options,
      patchedCallback,
    ];

    const result = original.apply(context, inputArgs);

    // Listen to metadata and status events
    result.on("metadata", (initialMetadata: any) => {
      responseMetadataInitial = serializeGrpcMetadata(initialMetadata);
    });

    result.on("status", (responseStatus: any) => {
      status = {
        code: responseStatus.code,
        details: responseStatus.details,
        metadata: serializeGrpcMetadata(responseStatus.metadata),
      };
      isStatusEmitted = true;

      if (isResponseReceived) {
        const realOutput: GrpcOutputValue = {
          body: readableResponseBody,
          metadata: responseMetadataInitial,
          status,
          bufferMap: responseBufferMap,
          jsonableStringMap: responseJsonableStringMap,
        };
        completeSpan(realOutput, SpanStatusCode.OK);
      } else if (hasErrorOccurred) {
        const errorOutput: GrpcErrorOutput = {
          error: {
            message: serviceError.message,
            name: serviceError.name,
            stack: serviceError.stack,
          },
          status,
          metadata: responseMetadataInitial,
        };
        completeSpan(errorOutput, SpanStatusCode.ERROR, serviceError.message);
      }
    });

    return result;
  }

  // Add this helper function to check if it's an error response
  private isGrpcErrorOutput(result: GrpcOutputValue | GrpcErrorOutput): result is GrpcErrorOutput {
    return "error" in result;
  }

  private _handleReplayUnaryRequest(
    spanInfo: SpanInfo,
    inputValue: GrpcClientInputValue,
    callback: Function,
    MetadataConstructor: any,
    stackTrace?: string,
  ): any {
    logger.debug(`[GrpcInstrumentation] Replaying gRPC unary request`);

    // Create emitter immediately
    const emitter = Object.assign(new EventEmitter(), {
      cancel() {},
      getPeer: () => "0.0.0.0:0000",
      call: undefined,
    });

    // Fetch mock data in background
    findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "grpc.client.unary",
        inputValue: inputValue,
        packageName: GRPC_MODULE_NAME,
        packageType: PackageType.GRPC,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "client",
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    })
      .then((mockData) => {
        if (!mockData) {
          logger.warn(
            `[GrpcInstrumentation] No mock data found for gRPC request: ${inputValue.service}/${inputValue.method}`,
            inputValue,
          );
          throw new Error(`[GrpcInstrumentation] No matching mock found for gRPC unary request`);
        }

        const mockResult: GrpcOutputValue | GrpcErrorOutput = mockData.result;
        let status: any;

        // Check if it's an error response
        if (this.isGrpcErrorOutput(mockResult)) {
          const { error, status: errorStatus } = mockResult;
          status = {
            code: errorStatus.code,
            details: errorStatus.details,
            metadata: deserializeGrpcMetadata(MetadataConstructor, errorStatus.metadata),
          };

          const errorObj = Object.assign(new Error(error.message), {
            name: error.name,
            stack: error.stack,
            ...status,
          });

          callback(errorObj);
        } else {
          // Success response
          const { body, status: successStatus, bufferMap, jsonableStringMap } = mockResult;
          const bufferMapToUse = bufferMap || {};
          const jsonableStringMapToUse = jsonableStringMap || {};

          status = {
            code: successStatus.code,
            details: successStatus.details,
            metadata: deserializeGrpcMetadata(MetadataConstructor, successStatus.metadata),
          };

          const realResponse = deserializeGrpcPayload(body, bufferMapToUse, jsonableStringMapToUse);
          callback(null, realResponse);
        }

        // Emit events
        process.nextTick(() => {
          if (mockResult.metadata) {
            emitter.emit(
              "metadata",
              deserializeGrpcMetadata(MetadataConstructor, mockResult.metadata),
            );
          }
          emitter.emit("status", status);
        });
      })
      .catch((error) => {
        logger.error(`[GrpcInstrumentation] Error fetching mock data:`, error);
        callback(error);
      });

    // Return emitter immediately (synchronously)
    return emitter;
  }

  private _handleRecordServerStreamRequest(
    spanInfo: SpanInfo,
    original: Function,
    context: any,
    parsedParams: {
      method: string;
      serialize: Function;
      deserialize: Function;
      argument: any;
      metadata: any;
      options: any;
    },
  ): any {
    let isStatusEmitted = false;
    let hasErrorOccurred = false;
    let isSpanCompleted = false;
    let streamResponses: any[] = [];
    let status: {
      code: number;
      details: string;
      metadata: Record<string, any>;
    };
    let responseMetadataInitial: any = {};
    let serviceError: any;

    /**
     * Completes the span exactly once
     */
    const completeSpan = (output: any, statusCode: SpanStatusCode, errorMessage?: string) => {
      if (isSpanCompleted) {
        return;
      }
      isSpanCompleted = true;

      try {
        SpanUtils.addSpanAttributes(spanInfo.span, {
          outputValue: output,
        });
        SpanUtils.endSpan(spanInfo.span, {
          code: statusCode,
        });
      } catch (e) {
        logger.error(`[GrpcInstrumentation] Error completing span:`, e);
      }
    };

    // Construct the makeServerStreamRequest call
    const inputArgs = [
      parsedParams.method,
      parsedParams.serialize,
      parsedParams.deserialize,
      parsedParams.argument,
      parsedParams.metadata,
      parsedParams.options,
    ];

    const stream = original.apply(context, inputArgs);

    // Listen to data events to collect all streamed responses
    stream.on("data", (data: any) => {
      try {
        const { readableBody, bufferMap, jsonableStringMap } = serializeGrpcPayload(data);
        streamResponses.push({
          body: readableBody,
          bufferMap,
          jsonableStringMap,
        });
      } catch (e) {
        logger.error(`[GrpcInstrumentation] Error serializing stream data:`, e);
      }
    });

    // Listen to metadata event
    stream.on("metadata", (initialMetadata: any) => {
      responseMetadataInitial = serializeGrpcMetadata(initialMetadata);
    });

    // Listen to error event
    stream.on("error", (err: any) => {
      serviceError = err;
      hasErrorOccurred = true;
    });

    // Listen to status event (emitted when stream completes)
    stream.on("status", (responseStatus: any) => {
      status = {
        code: responseStatus.code,
        details: responseStatus.details,
        metadata: serializeGrpcMetadata(responseStatus.metadata),
      };
      isStatusEmitted = true;

      // Complete span when status is received
      if (!hasErrorOccurred && streamResponses.length > 0) {
        const output: GrpcOutputValue = {
          body: streamResponses,
          metadata: responseMetadataInitial,
          status,
          bufferMap: {},
          jsonableStringMap: {},
        };
        completeSpan(output, SpanStatusCode.OK);
      } else if (!hasErrorOccurred && streamResponses.length === 0) {
        // Empty stream is still successful
        const output: GrpcOutputValue = {
          body: [],
          metadata: responseMetadataInitial,
          status,
          bufferMap: {},
          jsonableStringMap: {},
        };
        completeSpan(output, SpanStatusCode.OK);
      } else if (hasErrorOccurred) {
        const errorOutput: GrpcErrorOutput = {
          error: {
            message: serviceError.message,
            name: serviceError.name,
            stack: serviceError.stack,
          },
          status,
          metadata: responseMetadataInitial,
        };
        completeSpan(errorOutput, SpanStatusCode.ERROR, serviceError.message);
      }
    });

    return stream;
  }

  private _handleReplayServerStreamRequest(
    spanInfo: SpanInfo,
    inputValue: GrpcClientInputValue,
    MetadataConstructor: any,
  ): any {
    logger.debug(`[GrpcInstrumentation] Replaying gRPC server stream request`);

    // Create a Readable stream instead of EventEmitter
    const stream = new Readable({
      objectMode: true, // Important for gRPC which streams objects
      read() {
        // No-op: data will be pushed asynchronously when mock data arrives
      },
    });

    // Add gRPC-specific methods
    Object.assign(stream, {
      cancel() {},
      getPeer: () => "0.0.0.0:0000",
      call: undefined,
    });

    // Fetch mock data in background
    findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "grpc.client.server_stream",
        inputValue: inputValue,
        packageName: GRPC_MODULE_NAME,
        packageType: PackageType.GRPC,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "client",
        kind: SpanKind.CLIENT,
      },
      tuskDrift: this.tuskDrift,
    })
      .then((mockData) => {
        if (!mockData) {
          logger.warn(
            `[GrpcInstrumentation] No mock data found for gRPC server stream request: ${inputValue.service}/${inputValue.method}`,
            inputValue,
          );

          throw new Error(
            `[GrpcInstrumentation] No matching mock found for gRPC server stream request`,
          );
        }

        const mockResult: GrpcOutputValue | GrpcErrorOutput = mockData.result;

        // Emit events on next tick to simulate async behavior
        process.nextTick(() => {
          if (this.isGrpcErrorOutput(mockResult)) {
            // Handle error case
            const { error, status: errorStatus } = mockResult;
            const status = {
              code: errorStatus.code,
              details: errorStatus.details,
              metadata: deserializeGrpcMetadata(MetadataConstructor, errorStatus.metadata),
            };

            if (mockResult.metadata) {
              stream.emit(
                "metadata",
                deserializeGrpcMetadata(MetadataConstructor, mockResult.metadata),
              );
            }

            const errorObj = Object.assign(new Error(error.message), {
              name: error.name,
              stack: error.stack,
              ...status,
            });

            stream.emit("error", errorObj);
            stream.emit("status", status);
            stream.push(null); // Signal end of stream
          } else {
            // Handle success case - emit data events for each item in the stream
            const { body, status: successStatus } = mockResult;
            const status = {
              code: successStatus.code,
              details: successStatus.details,
              metadata: deserializeGrpcMetadata(MetadataConstructor, successStatus.metadata),
            };

            if (mockResult.metadata) {
              stream.emit(
                "metadata",
                deserializeGrpcMetadata(MetadataConstructor, mockResult.metadata),
              );
            }

            // Push data to the readable stream
            if (Array.isArray(body)) {
              body.forEach((item: any) => {
                const bufferMapToUse = item.bufferMap || {};
                const jsonableStringMapToUse = item.jsonableStringMap || {};
                const realResponse = deserializeGrpcPayload(
                  item.body,
                  bufferMapToUse,
                  jsonableStringMapToUse,
                );
                stream.push(realResponse); // Push to stream instead of emit
              });
            }

            stream.push(null); // Signal end of stream (important!)
            stream.emit("status", status);
          }
        });
      })
      .catch((error) => {
        logger.error(`[GrpcInstrumentation] Error fetching mock data for server stream:`, error);
        process.nextTick(() => {
          stream.emit("error", error);
          stream.emit("status", {
            code: 2, // UNKNOWN
            details: error.message,
            metadata: new MetadataConstructor(),
          });
          stream.push(null); // Signal end of stream
        });
      });

    // Return stream immediately (synchronously)
    return stream;
  }

  // NOTE: Not using this yet. This is somewhat working, haven't full tested it yet
  // Adding this would require more changes to replay grpc server calls. Holding off until a customer asks for it
  // private _getRegisterPatchFn(version: string) {
  //   const self = this;

  //   return (originalRegister: Function) => {
  //     return function register(this: any, ...args: any[]) {
  //       const path = args[0];
  //       const handler = args[1];
  //       const type = args[4]; // 'unary', 'clientStream', 'serverStream', 'bidi'

  //       // Only instrument unary calls for now
  //       if (type !== "unary") {
  //         return originalRegister.apply(this, args);
  //       }

  //       // Patch the handler
  //       const patchedHandler = self._getHandlerPatchFn(path, version)(handler);
  //       const newArgs = [path, patchedHandler, ...args.slice(2)];

  //       if (self.mode === TuskDriftMode.RECORD) {
  //         return originalRegister.apply(this, newArgs);
  //       } else if (self.mode === TuskDriftMode.REPLAY) {
  //         // In replay mode, we still register the handler but it will use mocked data
  //         return originalRegister.apply(this, newArgs);
  //       } else {
  //         return originalRegister.apply(this, args);
  //       }
  //     };
  //   };
  // }

  // NOTE: Not using this yet. This is somewhat working, haven't full tested it yet
  // Adding this would require more changes to replay grpc server calls. Holding off until a customer asks for it
  // private _getHandlerPatchFn(path: string, version: string) {
  //   const self = this;

  //   return (originalHandler: Function) => {
  //     return function handler(this: any, call: any, callback: Function) {
  //       const { method, service } = extractServiceAndMethodFromPath(path);
  //       const { request: requestBody, metadata: requestMetadata } = call;

  //       const { readableBody, bufferMap, jsonableStringMap } =
  //         getReadableBodyAndBufferMap(requestBody);
  //       const readableMetadata = getReadableMetadata(requestMetadata);

  //       const inputValue: GrpcServerInputValue = {
  //         method,
  //         service,
  //         body: readableBody,
  //         metadata: readableMetadata,
  //       };

  //       const inputMeta: BufferMetadata = {
  //         bufferMap,
  //         jsonableStringMap,
  //       };

  //       if (self.mode === TuskDriftMode.RECORD) {
  //         return handleRecordMode({
  //           originalFunctionCall: () => originalHandler.call(this, call, callback),
  //           recordModeHandler: ({ isPreAppStart }) => {
  //             return SpanUtils.createAndExecuteSpan(
  //               self.mode,
  //               () => originalHandler.call(this, call, callback),
  //               {
  //                 name: "grpc.server.unary",
  //                 kind: SpanKind.SERVER,
  //                 submodule: "server",
  //                 packageType: PackageType.GRPC,
  //                 packageName: GRPC_MODULE_NAME,
  //                 instrumentationName: self.INSTRUMENTATION_NAME,
  //                 inputValue: inputValue,
  //                 isPreAppStart,
  //               },
  //               (spanInfo) => {
  //                 return self._handleRecordServerHandler(
  //                   spanInfo,
  //                   originalHandler,
  //                   this,
  //                   call,
  //                   callback,
  //                   version,
  //                 );
  //               },
  //             );
  //           },
  //           spanKind: SpanKind.SERVER,
  //         });
  //       } else if (self.mode === TuskDriftMode.REPLAY) {
  //         return handleReplayMode({
  //           replayModeHandler: () => {
  //             return SpanUtils.createAndExecuteSpan(
  //               self.mode,
  //               () => originalHandler.call(this, call, callback),
  //               {
  //                 name: "grpc.server.unary",
  //                 kind: SpanKind.SERVER,
  //                 submodule: "server",
  //                 packageType: PackageType.GRPC,
  //                 packageName: GRPC_MODULE_NAME,
  //                 instrumentationName: self.INSTRUMENTATION_NAME,
  //                 inputValue: inputValue,
  //                 isPreAppStart: false,
  //               },
  //               (spanInfo) => {
  //                 return self._handleReplayServerHandler(
  //                   spanInfo,
  //                   originalHandler,
  //                   this,
  //                   call,
  //                   callback,
  //                 );
  //               },
  //             );
  //           },
  //         });
  //       } else {
  //         return originalHandler.call(this, call, callback);
  //       }
  //     };
  //   };
  // }

  // NOTE: Not using this yet. This is somewhat working, haven't full tested it yet
  // Adding this would require more changes to replay grpc server calls. Holding off until a customer asks for it
  // private _handleRecordServerHandler(
  //   spanInfo: SpanInfo,
  //   originalHandler: Function,
  //   context: any,
  //   call: any,
  //   originalCallback: Function,
  //   version: string,
  // ): void {
  //   const MetadataConstructor = GrpcInstrumentation.metadataStore.get(version) || this.Metadata;
  //   let initialMetadata: any = {};

  //   // Wrap sendMetadata to capture initial metadata
  //   const originalSendMetadata = call.sendMetadata;
  //   call.sendMetadata = function (metadata: any) {
  //     initialMetadata = getReadableMetadata(metadata);
  //     if (originalSendMetadata) {
  //       originalSendMetadata.call(call, metadata);
  //     }
  //   };

  //   // Wrap the callback to capture response
  //   const patchedCallback = (err: any, response: any, trailingMetadata?: any) => {
  //     const metadata = trailingMetadata || new MetadataConstructor();

  //     if (err) {
  //       const status = {
  //         code: err.code || 2, // 2 = UNKNOWN
  //         details: err.details || err.message,
  //         metadata: getReadableMetadata(metadata),
  //       };

  //       const errorOutput = {
  //         error: {
  //           message: err.message,
  //           name: err.name,
  //           stack: err.stack,
  //         },
  //         status,
  //         metadata: initialMetadata,
  //       };

  //       SpanUtils.addSpanAttributes(spanInfo.span, {
  //         outputValue: errorOutput,
  //       });
  //       SpanUtils.endSpan(spanInfo.span, {
  //         code: SpanStatusCode.ERROR,
  //         message: err.message,
  //       });
  //     } else {
  //       const { readableBody, bufferMap, jsonableStringMap } =
  //         getReadableBodyAndBufferMap(response);

  //       const status = {
  //         code: 0, // OK
  //         details: "OK",
  //         metadata: getReadableMetadata(metadata),
  //       };

  //       const successOutput: GrpcOutputValue = {
  //         body: readableBody,
  //         status,
  //         metadata: initialMetadata,
  //       };

  //       SpanUtils.addSpanAttributes(spanInfo.span, {
  //         outputValue: successOutput,
  //       });
  //       SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
  //     }

  //     return originalCallback(err, response, metadata);
  //   };

  //   try {
  //     originalHandler.call(context, call, patchedCallback);
  //   } catch (e: any) {
  //     logger.error(`[GrpcInstrumentation] Error in server handler:`, e);
  //     const status = {
  //       code: 2, // UNKNOWN
  //       details: `Server method handler threw error ${e.message}`,
  //       metadata: {},
  //     };

  //     const errorOutput = {
  //       error: {
  //         message: e.message,
  //         name: e.name,
  //         stack: e.stack,
  //       },
  //       status,
  //       metadata: initialMetadata,
  //     };

  //     SpanUtils.addSpanAttributes(spanInfo.span, {
  //       outputValue: errorOutput,
  //     });
  //     SpanUtils.endSpan(spanInfo.span, {
  //       code: SpanStatusCode.ERROR,
  //       message: e.message,
  //     });

  //     throw e;
  //   }
  // }

  // NOTE: Not using this yet. This is somewhat working, haven't full tested it yet
  // Adding this would require more changes to replay grpc server calls. Holding off until a customer asks for it
  // private _handleReplayServerHandler(
  //   spanInfo: SpanInfo,
  //   originalHandler: Function,
  //   context: any,
  //   call: any,
  //   originalCallback: Function,
  // ): void {
  //   // In replay mode, we still execute the handler to maintain server behavior
  //   // but the downstream calls will be mocked
  //   try {
  //     originalHandler.call(context, call, originalCallback);
  //   } catch (e: any) {
  //     logger.error(`[GrpcInstrumentation] Error in replay server handler:`, e);
  //     SpanUtils.endSpan(spanInfo.span, {
  //       code: SpanStatusCode.ERROR,
  //       message: e.message,
  //     });
  //     throw e;
  //   }
  // }

  private _getWaitForReadyPatchFn() {
    const self = this;

    return (original: Function) => {
      return function waitForReady(this: any, deadline: any, callback: Function) {
        if (self.mode === TuskDriftMode.REPLAY) {
          // In replay mode, immediately call the callback to skip waiting
          process.nextTick(() => callback());
          return;
        } else {
          return original.apply(this, [deadline, callback]);
        }
      };
    };
  }

  private _getClosePatchFn() {
    const self = this;

    return (original: Function) => {
      return function close(this: any) {
        if (self.mode === TuskDriftMode.REPLAY) {
          // In replay mode, don't actually close the client
          return;
        } else {
          return original.apply(this, arguments);
        }
      };
    };
  }

  private _getGetChannelPatchFn() {
    const self = this;

    return (original: Function) => {
      return function getChannel(this: any) {
        if (self.mode === TuskDriftMode.REPLAY) {
          // In replay mode, return a mock channel object
          return {};
        } else {
          return original.apply(this, arguments);
        }
      };
    };
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
