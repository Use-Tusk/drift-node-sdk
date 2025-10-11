import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { wrap } from "../../core/utils";
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

const GRPC_MODULE_NAME = "@grpc/grpc-js";

export class GrpcInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "GrpcInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private Metadata: any;
  // Store for version-specific Metadata constructors
  private static metadataStore = new Map<string, any>();

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
   * Handles the following cases:
   * 1. (metadata: Metadata, callback: Function) - no options
   * 2. (metadata: Metadata, options: Object, callback: Function) - with options
   */
  private parseUnaryCallArguments(
    MetadataConstructor: any,
    arg1: any,
    arg2: any,
    arg3: any,
  ): { metadata: any; options: any; callback: Function } {
    // Case 1: metadata + callback (no options)
    if (arg1 instanceof MetadataConstructor && typeof arg2 === "function") {
      return {
        metadata: arg1,
        options: {},
        callback: arg2,
      };
    }

    // Case 2: metadata + options + callback
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
    MetadataConstructor: any,
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
          metadata: any;
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
          return handleReplayMode({
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
    let readableResponseBody: any;
    let responseBufferMap: Record<string, { value: string; encoding: string }> = {};
    let responseJsonableStringMap: Record<string, string> = {};
    let status: {
      code: number;
      details: string;
      metadata: Record<string, any>;
    };
    let responseMetadataInitial: any = {};
    let serviceError: any;

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
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: realOutput,
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
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
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: errorOutput,
          });
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: serviceError.message,
          });
        } else {
          logger.error(`[GrpcInstrumentation] Unexpected condition in patchedCallback`, {
            isStatusEmitted,
            isResponseReceived,
            hasErrorOccurred,
          });
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
        try {
          const realOutput: GrpcOutputValue = {
            body: readableResponseBody,
            metadata: responseMetadataInitial,
            status,
            bufferMap: responseBufferMap,
            jsonableStringMap: responseJsonableStringMap,
          };
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: realOutput,
          });
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        } catch (e) {
          logger.error(`[GrpcInstrumentation] Error adding span attributes in status event:`, e);
        }
      }

      if (hasErrorOccurred) {
        try {
          const errorOutput = {
            error: {
              message: serviceError.message,
              name: serviceError.name,
              stack: serviceError.stack,
            },
            status,
            metadata: responseMetadataInitial,
          };
          SpanUtils.addSpanAttributes(spanInfo.span, {
            outputValue: errorOutput,
          });
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: serviceError.message,
          });
        } catch (e) {
          logger.error(
            `[GrpcInstrumentation] Error adding span attributes in hasErrorOccurred event:`,
            e,
          );
        }
      }
    });

    return result;
  }

  // Add this helper function to check if it's an error response
  private isGrpcErrorOutput(result: GrpcOutputValue | GrpcErrorOutput): result is GrpcErrorOutput {
    return "error" in result;
  }

  private async _handleReplayUnaryRequest(
    spanInfo: SpanInfo,
    inputValue: GrpcClientInputValue,
    callback: Function,
    MetadataConstructor: any,
  ): Promise<any> {
    logger.debug(`[GrpcInstrumentation] Replaying gRPC unary request`);

    // Find mock data
    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "grpc.client.unary",
        inputValue: inputValue,
        packageName: GRPC_MODULE_NAME,
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "client",
        kind: SpanKind.CLIENT,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(
        `[GrpcInstrumentation] No mock data found for gRPC request: ${inputValue.service}/${inputValue.method}`,
      );
      const error = new Error("No mock data found");
      callback(error);
      SpanUtils.endSpan(spanInfo.span, {
        code: SpanStatusCode.ERROR,
        message: "No mock data found",
      });
      return;
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
      // Use the stored bufferMap and jsonableStringMap from the recorded response
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

    // Create event emitter to simulate gRPC call
    const emitter = Object.assign(new EventEmitter(), {
      cancel() {},
      getPeer: () => "0.0.0.0:0000",
      call: undefined,
    });

    // Emit events on next tick to simulate async behavior
    process.nextTick(() => {
      if (mockResult.metadata) {
        emitter.emit("metadata", deserializeGrpcMetadata(MetadataConstructor, mockResult.metadata));
      }
      emitter.emit("status", status);
    });

    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue: mockResult,
    });
    SpanUtils.endSpan(spanInfo.span, {
      code: mockResult.error ? SpanStatusCode.ERROR : SpanStatusCode.OK,
    });

    return emitter;
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
