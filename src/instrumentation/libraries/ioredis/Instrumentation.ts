import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { TdInstrumentationNodeModuleFile } from "../../core/baseClasses/TdInstrumentationNodeModuleFile";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { wrap, isWrapped } from "../../core/utils/shimmerUtils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  IORedisModuleExports,
  IORedisInputValue,
  IORedisConnectInputValue,
  IORedisInstrumentationConfig,
  IORedisCommand,
  IORedisInterface,
  IORedisOutputValue,
  BufferMetadata,
} from "./types";
import { convertValueToJsonable } from "./utils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger, isEsm } from "../../../core/utils";
import { captureStackTrace } from "src/instrumentation/core/utils";

const SUPPORTED_VERSIONS = [">=4.11.0 <5", "5.*"];

export class IORedisInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "IORedisInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;

  constructor(config: IORedisInstrumentationConfig = {}) {
    super("ioredis", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "ioredis",
        supportedVersions: SUPPORTED_VERSIONS,
        patch: (moduleExports: IORedisModuleExports) => this._patchIORedisModule(moduleExports),
        files: [
          new TdInstrumentationNodeModuleFile({
            name: "ioredis/built/Pipeline.js",
            supportedVersions: ["5.*"],
            patch: (moduleExports: any) => this._patchPipelineModule(moduleExports),
          }),
          new TdInstrumentationNodeModuleFile({
            name: "ioredis/built/pipeline.js",
            supportedVersions: [">=4.11.0 <5"],
            patch: (moduleExports: any) => this._patchPipelineModule(moduleExports),
          }),
        ],
      }),
    ];
  }

  private _patchIORedisModule(moduleExports: IORedisModuleExports): IORedisModuleExports {
    logger.debug(`[IORedisInstrumentation] Patching IORedis module in ${this.mode} mode`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[IORedisInstrumentation] IORedis module already patched, skipping`);
      return moduleExports;
    }

    const actualExports = isEsm(moduleExports) ? moduleExports.default : moduleExports;

    if (!actualExports || !actualExports.prototype) {
      logger.error(`[IORedisInstrumentation] Invalid module exports, cannot patch`);
      return moduleExports;
    }

    // Wrap sendCommand method
    if (actualExports.prototype.sendCommand) {
      if (!isWrapped(actualExports.prototype.sendCommand)) {
        this._wrap(actualExports.prototype, "sendCommand", this._getSendCommandPatchFn());
        logger.debug(`[IORedisInstrumentation] Wrapped sendCommand method`);
      }
    }

    // Wrap connect method
    if (actualExports.prototype.connect) {
      if (!isWrapped(actualExports.prototype.connect)) {
        this._wrap(actualExports.prototype, "connect", this._getConnectPatchFn());
        logger.debug(`[IORedisInstrumentation] Wrapped connect method`);
      }
    }

    // Wrap pipeline() and multi() methods to intercept pipeline/transaction creation
    if (actualExports.prototype.pipeline) {
      if (!isWrapped(actualExports.prototype.pipeline)) {
        this._wrap(actualExports.prototype, "pipeline", this._getPipelineCreationPatchFn());
        logger.debug(`[IORedisInstrumentation] Wrapped pipeline method`);
      }
    }

    if (actualExports.prototype.multi) {
      if (!isWrapped(actualExports.prototype.multi)) {
        this._wrap(actualExports.prototype, "multi", this._getMultiCreationPatchFn());
        logger.debug(`[IORedisInstrumentation] Wrapped multi method`);
      }
    }

    this.markModuleAsPatched(moduleExports);
    logger.debug(`[IORedisInstrumentation] IORedis module patching complete`);

    return moduleExports;
  }

  private _patchPipelineModule(moduleExports: any): any {
    logger.debug(`[IORedisInstrumentation] Patching Pipeline module in ${this.mode} mode`);

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[IORedisInstrumentation] Pipeline module already patched, skipping`);
      return moduleExports;
    }

    const actualExports = isEsm(moduleExports) ? moduleExports.default : moduleExports;

    if (!actualExports || !actualExports.prototype) {
      logger.debug(`[IORedisInstrumentation] Invalid Pipeline module exports, cannot patch`);
      return moduleExports;
    }

    // Wrap exec method for pipelines
    if (actualExports.prototype.exec) {
      if (!isWrapped(actualExports.prototype.exec)) {
        this._wrap(actualExports.prototype, "exec", this._getPipelineExecPatchFn());
        logger.debug(`[IORedisInstrumentation] Wrapped Pipeline.exec method`);
      }
    }

    this.markModuleAsPatched(moduleExports);
    logger.debug(`[IORedisInstrumentation] Pipeline module patching complete`);

    return moduleExports;
  }

  private _getSendCommandPatchFn() {
    const self = this;

    return (originalSendCommand: Function) => {
      return function sendCommand(this: IORedisInterface, cmd?: IORedisCommand) {
        if (!cmd || typeof cmd !== "object" || !cmd.name) {
          return originalSendCommand.apply(this, arguments);
        }

        const commandName = cmd.name;
        const commandArgs = cmd.args || [];

        let sanitizedArgs: any[] = [];
        let argsMetadata: BufferMetadata[] = [];
        try {
          const sanitized = self._sanitizeArgs(commandArgs);
          sanitizedArgs = sanitized.values;
          argsMetadata = sanitized.metadata;
        } catch (error) {
          logger.error(`[IORedisInstrumentation] error sanitizing args:`, error);
        }

        const inputValue: IORedisInputValue = {
          command: commandName,
          args: sanitizedArgs,
          argsMetadata,
          connectionInfo: {
            host: this.options?.host,
            port: this.options?.port,
          },
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["IORedisInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              return undefined;
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalSendCommand.apply(this, arguments),
                {
                  name: `ioredis.${commandName}`,
                  kind: SpanKind.CLIENT,
                  submodule: commandName,
                  packageType: PackageType.REDIS,
                  packageName: "ioredis",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplaySendCommand(spanInfo, cmd, inputValue, stackTrace);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalSendCommand.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalSendCommand.apply(this, arguments),
                {
                  name: `ioredis.${commandName}`,
                  kind: SpanKind.CLIENT,
                  submodule: commandName,
                  packageType: PackageType.REDIS,
                  packageName: "ioredis",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordSendCommand(spanInfo, originalSendCommand, cmd, this);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalSendCommand.apply(this, arguments);
        }
      };
    };
  }

  private _getConnectPatchFn() {
    const self = this;
    return (originalConnect: Function) => {
      return function connect(this: IORedisInterface) {
        const inputValue: IORedisConnectInputValue = {
          host: this.options?.host,
          port: this.options?.port,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              process.nextTick(() => {
                (this as any).emit("ready");
              });

              return Promise.resolve();
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.apply(this, arguments),
                {
                  name: "ioredis.connect",
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageType: PackageType.REDIS,
                  packageName: "ioredis",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayConnect(this);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalConnect.apply(this, arguments),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.apply(this, arguments),
                {
                  name: "ioredis.connect",
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageType: PackageType.REDIS,
                  packageName: "ioredis",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordConnect(spanInfo, originalConnect, this);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalConnect.apply(this, arguments);
        }
      };
    };
  }

  private _getPipelineCreationPatchFn() {
    const self = this;

    return (originalPipeline: Function) => {
      return function pipeline(this: any, ...args: any[]) {
        const pipelineInstance = originalPipeline.apply(this, args);

        // Dynamically wrap the exec method on this pipeline instance
        if (pipelineInstance && pipelineInstance.exec && !isWrapped(pipelineInstance.exec)) {
          self._wrap(pipelineInstance, "exec", self._getPipelineExecPatchFn());
          logger.debug(`[IORedisInstrumentation] Wrapped exec on pipeline instance`);
        }

        return pipelineInstance;
      };
    };
  }

  private _getMultiCreationPatchFn() {
    const self = this;

    return (originalMulti: Function) => {
      return function multi(this: any, ...args: any[]) {
        const multiInstance = originalMulti.apply(this, args);

        // Dynamically wrap the exec method on this multi instance
        if (multiInstance && multiInstance.exec && !isWrapped(multiInstance.exec)) {
          self._wrap(multiInstance, "exec", self._getPipelineExecPatchFn());
          logger.debug(`[IORedisInstrumentation] Wrapped exec on multi instance`);
        }

        return multiInstance;
      };
    };
  }

  private _getPipelineExecPatchFn() {
    const self = this;

    return (originalExec: Function) => {
      return function exec(this: any, ...args: any[]) {
        // Extract queued commands from pipeline
        const queue = (this as any)._queue || [];
        const commands = queue
          .filter((q: any) => q.name !== "exec")
          .map((q: any) => ({
            command: q.name,
            args: q.args || [],
          }));

        const inputValue = {
          commands,
        };

        // Handle replay mode
        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              return [];
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalExec.apply(this, args),
                {
                  name: "ioredis.pipeline.exec",
                  kind: SpanKind.CLIENT,
                  submodule: "pipeline-exec",
                  packageType: PackageType.REDIS,
                  packageName: "ioredis",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayPipelineExec(spanInfo, inputValue, args);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalExec.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalExec.apply(this, args),
                {
                  name: "ioredis.pipeline.exec",
                  kind: SpanKind.CLIENT,
                  submodule: "pipeline-exec",
                  packageType: PackageType.REDIS,
                  packageName: "ioredis",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordPipelineExec(spanInfo, originalExec, this, args);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalExec.apply(this, args);
        }
      };
    };
  }

  private _handleRecordSendCommand(
    spanInfo: SpanInfo,
    originalSendCommand: Function,
    cmd: IORedisCommand,
    thisContext: IORedisInterface,
  ): Promise<any> {
    // Execute the command and capture the final resolved value
    // (after ioredis transformations)
    const promise = originalSendCommand.apply(thisContext, [cmd]);

    if (promise && typeof promise.then === "function") {
      return promise
        .then((result: any) => {
          try {
            logger.debug(
              `[IORedisInstrumentation] IORedis command ${cmd.name} completed successfully (${SpanUtils.getTraceInfo()})`,
            );

            // Serialize the FINAL transformed result (what the application receives)
            const outputValue = this._serializeOutput(result);
            SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[IORedisInstrumentation] error processing command response:`, error);
          }
          return result;
        })
        .catch((error: any) => {
          try {
            logger.debug(
              `[IORedisInstrumentation] IORedis command ${cmd.name} error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (spanError) {
            logger.error(`[IORedisInstrumentation] error ending span:`, spanError);
          }
          throw error;
        });
    }

    return promise;
  }

  private async _handleReplaySendCommand(
    spanInfo: SpanInfo,
    cmd: IORedisCommand,
    inputValue: IORedisInputValue,
    stackTrace?: string,
  ): Promise<any> {
    logger.debug(`[IORedisInstrumentation] Replaying IORedis command ${cmd.name}`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: `ioredis.${cmd.name}`,
        inputValue: inputValue,
        packageName: "ioredis",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: cmd.name,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(`[IORedisInstrumentation] No mock data found for command: ${cmd.name}`);
      throw new Error(`[IORedisInstrumentation] No matching mock found for command: ${cmd.name}`);
    }

    logger.debug(
      `[IORedisInstrumentation] Found mock data for command ${cmd.name}: ${JSON.stringify(mockData)}`,
    );

    const result = this._deserializeOutput(mockData.result);

    // Handle callback if present
    if (cmd.callback && typeof cmd.callback === "function") {
      process.nextTick(() => {
        cmd.callback!(null, result);
      });
    }

    // Return the already-transformed result directly
    // We recorded the final transformed value, so no additional transformation needed
    return Promise.resolve(result);
  }

  private _handleRecordConnect(
    spanInfo: SpanInfo,
    originalConnect: Function,
    thisContext: IORedisInterface,
  ): Promise<any> {
    const promise = originalConnect.apply(thisContext, []);

    if (promise && typeof promise.then === "function") {
      return promise
        .then((result: any) => {
          try {
            logger.debug(
              `[IORedisInstrumentation] IORedis connect completed successfully (${SpanUtils.getTraceInfo()})`,
            );
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: { connected: true },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch {
            logger.error(`[IORedisInstrumentation] error adding span attributes`);
          }
          return result;
        })
        .catch((error: any) => {
          try {
            logger.debug(
              `[IORedisInstrumentation] IORedis connect error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch {
            logger.error(`[IORedisInstrumentation] error adding span attributes`);
          }
          throw error;
        });
    }

    try {
      // Non-promise result
      logger.debug(
        `[IORedisInstrumentation] IORedis connect completed (synchronous) (${SpanUtils.getTraceInfo()})`,
      );
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: { connected: true },
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[IORedisInstrumentation] error adding span attributes`);
    }
    return promise;
  }

  private async _handleReplayConnect(thisContext: IORedisInterface): Promise<any> {
    logger.debug(`[IORedisInstrumentation] Replaying IORedis connect`);

    process.nextTick(() => {
      (thisContext as any).emit("ready");
    });

    return Promise.resolve();
  }

  private _handleRecordPipelineExec(
    spanInfo: SpanInfo,
    originalExec: Function,
    thisContext: any,
    args: any[],
  ): Promise<any> {
    const promise = originalExec.apply(thisContext, args);

    if (promise && typeof promise.then === "function") {
      return promise
        .then((results: any) => {
          try {
            logger.debug(
              `[IORedisInstrumentation] Pipeline exec completed successfully (${SpanUtils.getTraceInfo()})`,
            );

            // Serialize the results with metadata
            const outputValue = this._serializePipelineOutput(results);
            SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch {
            logger.error(`[IORedisInstrumentation] error adding span attributes`);
          }
          return results;
        })
        .catch((error: any) => {
          try {
            logger.debug(
              `[IORedisInstrumentation] Pipeline exec error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch {
            logger.error(`[IORedisInstrumentation] error adding span attributes`);
          }
          throw error;
        });
    }

    return promise;
  }

  private async _handleReplayPipelineExec(
    spanInfo: SpanInfo,
    inputValue: any,
    args: any[],
  ): Promise<any> {
    logger.debug(`[IORedisInstrumentation] Replaying Pipeline exec`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "ioredis.pipeline.exec",
        inputValue: inputValue,
        packageName: "ioredis",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "pipeline-exec",
        kind: SpanKind.CLIENT,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(`[IORedisInstrumentation] No mock data found for pipeline exec`);
      throw new Error(`[IORedisInstrumentation] No matching mock found for pipeline exec`);
    }

    logger.debug(
      `[IORedisInstrumentation] Found mock data for pipeline exec: ${JSON.stringify(mockData)}`,
    );

    // Deserialize the pipeline results with metadata
    const result = this._deserializePipelineOutput(mockData.result);

    // Handle callback if present
    const callback = args[args.length - 1];
    if (typeof callback === "function") {
      process.nextTick(() => {
        callback(null, result);
      });
    }

    return Promise.resolve(result);
  }

  private _sanitizeArgs(args: any[]): { values: any[]; metadata: BufferMetadata[] } {
    const values: any[] = [];
    const metadata: BufferMetadata[] = [];

    args.forEach((arg) => {
      const converted = convertValueToJsonable(arg);
      values.push(converted.value);
      metadata.push({
        bufferMeta: converted.bufferMeta,
        encoding: converted.encoding,
      });
    });

    return { values, metadata };
  }

  private _serializeOutput(value: any): IORedisOutputValue {
    // We record the FINAL transformed value from ioredis (after Promise resolution)
    // This value is already in its final form (strings, numbers, objects, arrays, etc.)
    // No need for Buffer metadata since ioredis has already transformed Buffers to their final types
    return { value };
  }

  private _serializePipelineOutput(results: any): any {
    // Store the final transformed pipeline results as-is
    return { value: results };
  }

  private _deserializePipelineOutput(outputValue: any): any {
    if (!outputValue) {
      return [];
    }

    // Return the stored value as-is (already in final form)
    return outputValue.value || outputValue;
  }

  private _deserializeOutput(outputValue: any): any {
    if (!outputValue) {
      return undefined;
    }

    // If outputValue is not an IORedisOutputValue object (doesn't have 'value' property),
    // it might be the raw value itself
    if (typeof outputValue !== "object" || !("value" in outputValue)) {
      return outputValue;
    }

    // Return the stored value as-is (it's already in final form from ioredis transformations)
    return outputValue.value;
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
