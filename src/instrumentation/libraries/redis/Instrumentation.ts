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
  RedisInstrumentationConfig,
  RedisInputValue,
  RedisConnectInputValue,
  RedisMultiExecInputValue,
  RedisOutputValue,
  BufferMetadata,
} from "./types";
import { convertValueToJsonable, deserializeBufferValue } from "./utils";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils";
import { captureStackTrace } from "src/instrumentation/core/utils";

const SUPPORTED_VERSIONS = ["1.*"];

const FILTERED_COMMANDS = ["TS.INFO_DEBUG", "FT.ALIASDEL", "FT.PROFILE"];

export class RedisInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "RedisInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;

  constructor(config: RedisInstrumentationConfig = {}) {
    super("@redis/client", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "@redis/client",
        supportedVersions: SUPPORTED_VERSIONS,
        files: this._createModuleFiles("@redis/client"),
      }),
      new TdInstrumentationNodeModule({
        name: "@node-redis/client",
        supportedVersions: SUPPORTED_VERSIONS,
        files: this._createModuleFiles("@node-redis/client"),
      }),
    ];
  }

  private _createModuleFiles(packageName: string): TdInstrumentationNodeModuleFile[] {
    return [
      new TdInstrumentationNodeModuleFile({
        name: `${packageName}/dist/lib/client/index.js`,
        supportedVersions: SUPPORTED_VERSIONS,
        patch: (moduleExports: any) => this._patchClientIndex(moduleExports, packageName),
      }),
      new TdInstrumentationNodeModuleFile({
        name: `${packageName}/dist/lib/client/multi-command.js`,
        supportedVersions: SUPPORTED_VERSIONS,
        patch: (moduleExports: any) => this._patchMultiCommand(moduleExports, packageName),
      }),
    ];
  }

  private _patchClientIndex(moduleExports: any, packageName: string): any {
    logger.debug(`[RedisInstrumentation] Patching ${packageName} index in ${this.mode} mode`);

    if (this.isModulePatched(moduleExports)) {
      return moduleExports;
    }

    const clientPrototype = moduleExports?.default?.prototype;
    if (!clientPrototype) {
      logger.error(`[RedisInstrumentation] Cannot find RedisClient prototype`);
      return moduleExports;
    }

    if (clientPrototype.sendCommand && !isWrapped(clientPrototype.sendCommand)) {
      this._wrap(clientPrototype, "sendCommand", this._getSendCommandPatchFn(packageName));
    }

    if (clientPrototype.connect && !isWrapped(clientPrototype.connect)) {
      this._wrap(clientPrototype, "connect", this._getConnectPatchFn(packageName));
    }

    if (clientPrototype.SELECT && !isWrapped(clientPrototype.SELECT)) {
      this._wrap(clientPrototype, "SELECT", this._getSelectPatchFn());
    }

    if (clientPrototype.commandsExecutor && !isWrapped(clientPrototype.commandsExecutor)) {
      this._wrap(
        clientPrototype,
        "commandsExecutor",
        this._getCommandsExecutorPatchFn(packageName),
      );

      // Re-attach commands to use the wrapped commandsExecutor.
      // This is necessary because attachCommands (called at module load time) captures
      // a direct reference to the original commandsExecutor. After wrapping, the generated
      // command methods (SET, GET, etc.) still call the old reference, bypassing our patch.
      // We search require.cache since the modules are already loaded but can't be resolved
      // via require() from the SDK's context.
      try {
        let commandsDefault: any = null;
        let attachCommandsFn: any = null;
        const cache = require.cache || {};
        for (const key of Object.keys(cache)) {
          if (
            commandsDefault === null &&
            key.includes("/client/commands.js") &&
            (key.includes("@redis/client") || key.includes("@node-redis/client"))
          ) {
            commandsDefault = cache[key]?.exports?.default;
          }
          if (
            attachCommandsFn === null &&
            key.includes("/commander.js") &&
            (key.includes("@redis/client") || key.includes("@node-redis/client"))
          ) {
            attachCommandsFn = cache[key]?.exports?.attachCommands;
          }
        }
        if (attachCommandsFn && commandsDefault) {
          attachCommandsFn({
            BaseClass: moduleExports.default,
            commands: commandsDefault,
            executor: clientPrototype.commandsExecutor,
          });
        }
      } catch (error) {
        logger.error(`[RedisInstrumentation] Error re-attaching commands after patching:`, error);
      }
    }

    // In replay mode, patch quit/disconnect to be no-ops since there's no real connection.
    // We must also patch QUIT (uppercase) because the constructor assigns instance properties
    // like `this.quit = this.QUIT`, which shadow the lowercase prototype patches.
    if (this.mode === TuskDriftMode.REPLAY) {
      const noOpQuit = () => {
        return function quit() {
          return Promise.resolve();
        };
      };
      const noOpDisconnect = () => {
        return function disconnect() {
          return Promise.resolve();
        };
      };
      if (clientPrototype.QUIT && !isWrapped(clientPrototype.QUIT)) {
        this._wrap(clientPrototype, "QUIT", noOpQuit);
      }
      if (clientPrototype.quit && !isWrapped(clientPrototype.quit)) {
        this._wrap(clientPrototype, "quit", noOpQuit);
      }
      if (clientPrototype.disconnect && !isWrapped(clientPrototype.disconnect)) {
        this._wrap(clientPrototype, "disconnect", noOpDisconnect);
      }
    }

    this.markModuleAsPatched(moduleExports);
    return moduleExports;
  }

  private _getSendCommandPatchFn(packageName: string) {
    const self = this;

    return (originalSendCommand: Function) => {
      return function sendCommand(this: any, args: ReadonlyArray<any>, options?: any) {
        if (!args || !Array.isArray(args) || args.length === 0) {
          return originalSendCommand.call(this, args, options);
        }

        const commandName = String(args[0]);
        const commandArgs = args.slice(1);

        let sanitizedArgs: any[] = [];
        let argsMetadata: BufferMetadata[] = [];
        try {
          const sanitized = self._sanitizeArgs(commandArgs);
          sanitizedArgs = sanitized.values;
          argsMetadata = sanitized.metadata;
        } catch (error) {
          logger.error(`[RedisInstrumentation] error sanitizing args:`, error);
        }

        const inputValue: RedisInputValue = {
          command: commandName,
          args: sanitizedArgs,
          argsMetadata,
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["RedisInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              return undefined;
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalSendCommand.call(this, args, options),
                {
                  name: `redis.${commandName}`,
                  kind: SpanKind.CLIENT,
                  submodule: commandName,
                  packageType: PackageType.REDIS,
                  packageName,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplaySendCommand(
                    spanInfo,
                    commandName,
                    inputValue,
                    packageName,
                    stackTrace,
                  );
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalSendCommand.call(this, args, options),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalSendCommand.call(this, args, options),
                {
                  name: `redis.${commandName}`,
                  kind: SpanKind.CLIENT,
                  submodule: commandName,
                  packageType: PackageType.REDIS,
                  packageName,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordSendCommand(
                    spanInfo,
                    originalSendCommand,
                    args,
                    options,
                    this,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalSendCommand.call(this, args, options);
        }
      };
    };
  }

  private _handleRecordSendCommand(
    spanInfo: SpanInfo,
    originalSendCommand: Function,
    args: ReadonlyArray<any>,
    options: any,
    thisContext: any,
  ): Promise<any> {
    const promise = originalSendCommand.call(thisContext, args, options);

    if (promise && typeof promise.then === "function") {
      return promise
        .then((result: any) => {
          try {
            logger.debug(
              `[RedisInstrumentation] Redis command ${args[0]} completed successfully (${SpanUtils.getTraceInfo()})`,
            );

            const outputValue = this._serializeOutput(result);
            SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[RedisInstrumentation] error processing command response:`, error);
          }
          return result;
        })
        .catch((error: any) => {
          try {
            logger.debug(
              `[RedisInstrumentation] Redis command ${args[0]} error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (spanError) {
            logger.error(`[RedisInstrumentation] error ending span:`, spanError);
          }
          throw error;
        });
    }

    // Synchronous fallback (defensive — sendCommand should always return a promise)
    try {
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[RedisInstrumentation] error ending span for synchronous sendCommand`);
    }
    return promise;
  }

  private async _handleReplaySendCommand(
    spanInfo: SpanInfo,
    commandName: string,
    inputValue: RedisInputValue,
    packageName: string,
    stackTrace?: string,
  ): Promise<any> {
    logger.debug(`[RedisInstrumentation] Replaying Redis command ${commandName}`);

    try {
      const mockData = await findMockResponseAsync({
        mockRequestData: {
          traceId: spanInfo.traceId,
          spanId: spanInfo.spanId,
          name: `redis.${commandName}`,
          inputValue: inputValue,
          packageName,
          instrumentationName: this.INSTRUMENTATION_NAME,
          submoduleName: commandName,
          kind: SpanKind.CLIENT,
          stackTrace,
        },
        tuskDrift: this.tuskDrift,
      });

      if (!mockData) {
        logger.warn(`[RedisInstrumentation] No mock data found for command: ${commandName}`);
        throw new Error(
          `[RedisInstrumentation] No matching mock found for command: ${commandName}`,
        );
      }

      logger.debug(`[RedisInstrumentation] Found mock data for command ${commandName}`);

      return this._deserializeOutput(mockData.result);
    } catch (error) {
      logger.error(`[RedisInstrumentation] error replaying command ${commandName}:`, error);
      throw error;
    }
  }

  private _getCommandsExecutorPatchFn(packageName: string) {
    const self = this;

    return (originalCommandsExecutor: Function) => {
      return function commandsExecutor(this: any, command: any, args: any[]) {
        if (self.mode === TuskDriftMode.DISABLED) {
          return originalCommandsExecutor.call(this, command, args);
        }

        // Transform args to get command name
        let commandName = "";
        let inputArgs: any[] = [];
        try {
          const redisCommandArguments = command.transformArguments(...args);
          if (Array.isArray(redisCommandArguments)) {
            commandName = String(redisCommandArguments[0]);
            inputArgs = redisCommandArguments.slice(1);
          }
        } catch {
          return originalCommandsExecutor.call(this, command, args);
        }

        if (FILTERED_COMMANDS.includes(commandName)) {
          return originalCommandsExecutor.call(this, command, args);
        }

        let sanitizedArgs: any[] = [];
        let argsMetadata: BufferMetadata[] = [];
        try {
          const sanitized = self._sanitizeArgs(inputArgs);
          sanitizedArgs = sanitized.values;
          argsMetadata = sanitized.metadata;
        } catch (error) {
          logger.error(`[RedisInstrumentation] error sanitizing args:`, error);
        }

        const inputValue: RedisInputValue = {
          command: commandName,
          args: sanitizedArgs,
          argsMetadata,
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["RedisInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => undefined,
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalCommandsExecutor.call(this, command, args),
                {
                  name: `redis.${commandName}`,
                  kind: SpanKind.CLIENT,
                  submodule: commandName,
                  packageType: PackageType.REDIS,
                  packageName,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayCommandsExecutor(
                    spanInfo,
                    commandName,
                    inputValue,
                    packageName,
                    stackTrace,
                  );
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalCommandsExecutor.call(this, command, args),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalCommandsExecutor.call(this, command, args),
                {
                  name: `redis.${commandName}`,
                  kind: SpanKind.CLIENT,
                  submodule: commandName,
                  packageType: PackageType.REDIS,
                  packageName,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordCommandsExecutor(
                    spanInfo,
                    originalCommandsExecutor,
                    command,
                    args,
                    this,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalCommandsExecutor.call(this, command, args);
        }
      };
    };
  }

  private async _handleReplayCommandsExecutor(
    spanInfo: SpanInfo,
    commandName: string,
    inputValue: RedisInputValue,
    packageName: string,
    stackTrace?: string,
  ): Promise<any> {
    logger.debug(`[RedisInstrumentation] Replaying Redis commandsExecutor ${commandName}`);

    try {
      const mockData = await findMockResponseAsync({
        mockRequestData: {
          traceId: spanInfo.traceId,
          spanId: spanInfo.spanId,
          name: `redis.${commandName}`,
          inputValue: inputValue,
          packageName,
          instrumentationName: this.INSTRUMENTATION_NAME,
          submoduleName: commandName,
          kind: SpanKind.CLIENT,
          stackTrace,
        },
        tuskDrift: this.tuskDrift,
      });

      if (!mockData) {
        logger.warn(
          `[RedisInstrumentation] No mock data found for commandsExecutor: ${commandName}`,
        );
        throw new Error(
          `[RedisInstrumentation] No matching mock found for command: ${commandName}`,
        );
      }

      logger.debug(`[RedisInstrumentation] Found mock data for commandsExecutor ${commandName}`);

      return this._deserializeOutput(mockData.result);
    } catch (error) {
      logger.error(
        `[RedisInstrumentation] error replaying commandsExecutor ${commandName}:`,
        error,
      );
      throw error;
    }
  }

  private _handleRecordCommandsExecutor(
    spanInfo: SpanInfo,
    originalCommandsExecutor: Function,
    command: any,
    args: any[],
    thisContext: any,
  ): Promise<any> {
    const promise = originalCommandsExecutor.call(thisContext, command, args);

    if (promise && typeof promise.then === "function") {
      return promise
        .then((result: any) => {
          try {
            logger.debug(
              `[RedisInstrumentation] Redis commandsExecutor completed successfully (${SpanUtils.getTraceInfo()})`,
            );
            const outputValue = this._serializeOutput(result);
            SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(
              `[RedisInstrumentation] error processing commandsExecutor response:`,
              error,
            );
          }
          return result;
        })
        .catch((error: any) => {
          try {
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (spanError) {
            logger.error(`[RedisInstrumentation] error ending span:`, spanError);
          }
          throw error;
        });
    }

    try {
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[RedisInstrumentation] error ending span for synchronous commandsExecutor`);
    }
    return promise;
  }

  private _getConnectPatchFn(packageName: string) {
    const self = this;
    return (originalConnect: Function) => {
      return function connect(this: any) {
        const inputValue: RedisConnectInputValue = {};

        if (self.mode === TuskDriftMode.REPLAY) {
          return handleReplayMode({
            noOpRequestHandler: () => {
              try {
                process.nextTick(() => {
                  try {
                    (this as any).emit("connect");
                    (this as any).emit("ready");
                  } catch (emitError) {
                    logger.error(
                      `[RedisInstrumentation] error emitting connect/ready events:`,
                      emitError,
                    );
                  }
                });
              } catch (error) {
                logger.error(`[RedisInstrumentation] error in noOp connect handler:`, error);
              }
              return Promise.resolve(this);
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.call(this),
                {
                  name: "redis.connect",
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageType: PackageType.REDIS,
                  packageName,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (_spanInfo) => {
                  return self._handleReplayConnect(this);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalConnect.call(this),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalConnect.call(this),
                {
                  name: "redis.connect",
                  kind: SpanKind.CLIENT,
                  submodule: "connect",
                  packageType: PackageType.REDIS,
                  packageName,
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
          return originalConnect.call(this);
        }
      };
    };
  }

  private _handleRecordConnect(
    spanInfo: SpanInfo,
    originalConnect: Function,
    thisContext: any,
  ): Promise<any> {
    const promise = originalConnect.call(thisContext);

    if (promise && typeof promise.then === "function") {
      return promise
        .then((result: any) => {
          try {
            logger.debug(
              `[RedisInstrumentation] Redis connect completed successfully (${SpanUtils.getTraceInfo()})`,
            );
            SpanUtils.addSpanAttributes(spanInfo.span, {
              outputValue: { connected: true },
            });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch {
            logger.error(`[RedisInstrumentation] error adding span attributes`);
          }
          return result;
        })
        .catch((error: any) => {
          try {
            logger.debug(
              `[RedisInstrumentation] Redis connect error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch {
            logger.error(`[RedisInstrumentation] error adding span attributes`);
          }
          throw error;
        });
    }

    try {
      logger.debug(
        `[RedisInstrumentation] Redis connect completed (synchronous) (${SpanUtils.getTraceInfo()})`,
      );
      SpanUtils.addSpanAttributes(spanInfo.span, {
        outputValue: { connected: true },
      });
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[RedisInstrumentation] error adding span attributes`);
    }
    return promise;
  }

  private async _handleReplayConnect(thisContext: any): Promise<any> {
    logger.debug(`[RedisInstrumentation] Replaying Redis connect`);

    try {
      process.nextTick(() => {
        try {
          (thisContext as any).emit("connect");
          (thisContext as any).emit("ready");
        } catch (emitError) {
          logger.error(`[RedisInstrumentation] error emitting connect/ready events:`, emitError);
        }
      });
    } catch (error) {
      logger.error(`[RedisInstrumentation] error in replay connect:`, error);
    }

    return Promise.resolve(thisContext);
  }

  private _getSelectPatchFn() {
    const self = this;
    return (originalSelect: Function) => {
      return function SELECT(this: any, ...args: any[]) {
        if (self.mode === TuskDriftMode.RECORD) {
          return originalSelect.apply(this, args);
        }
        if (self.mode === TuskDriftMode.REPLAY) {
          return Promise.resolve();
        }
        return originalSelect.apply(this, args);
      };
    };
  }

  private _patchMultiCommand(moduleExports: any, packageName: string): any {
    logger.debug(
      `[RedisInstrumentation] Patching multi-command module for ${packageName} in ${this.mode} mode`,
    );

    if (this.isModulePatched(moduleExports)) {
      return moduleExports;
    }

    const multiCommandPrototype = moduleExports?.default?.prototype;
    if (!multiCommandPrototype) {
      logger.error(`[RedisInstrumentation] Cannot find MultiCommand prototype`);
      return moduleExports;
    }

    if (multiCommandPrototype.exec && !isWrapped(multiCommandPrototype.exec)) {
      this._wrap(multiCommandPrototype, "exec", this._getExecPatchFn(packageName));
    }

    this.markModuleAsPatched(moduleExports);
    return moduleExports;
  }

  private _getExecPatchFn(packageName: string) {
    const self = this;

    return (originalExec: Function) => {
      return function exec(this: any, execAsPipeline?: boolean) {
        const inputValue: RedisMultiExecInputValue = {
          commands: [],
          execAsPipeline: !!execAsPipeline,
        };

        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["RedisInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              return [];
            },
            isServerRequest: false,
            replayModeHandler: () => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalExec.call(this, execAsPipeline),
                {
                  name: "redis.multi.exec",
                  kind: SpanKind.CLIENT,
                  submodule: "exec",
                  packageType: PackageType.REDIS,
                  packageName,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self._handleReplayExec(spanInfo, inputValue, packageName, stackTrace);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalExec.call(this, execAsPipeline),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalExec.call(this, execAsPipeline),
                {
                  name: "redis.multi.exec",
                  kind: SpanKind.CLIENT,
                  submodule: "exec",
                  packageType: PackageType.REDIS,
                  packageName,
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordExec(spanInfo, originalExec, this, execAsPipeline);
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          return originalExec.call(this, execAsPipeline);
        }
      };
    };
  }

  private _handleRecordExec(
    spanInfo: SpanInfo,
    originalExec: Function,
    thisContext: any,
    execAsPipeline?: boolean,
  ): Promise<any> {
    const promise = originalExec.call(thisContext, execAsPipeline);

    if (promise && typeof promise.then === "function") {
      return promise
        .then((results: any) => {
          try {
            logger.debug(
              `[RedisInstrumentation] Redis multi/exec completed successfully (${SpanUtils.getTraceInfo()})`,
            );
            const outputValue = { value: results };
            SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch {
            logger.error(`[RedisInstrumentation] error adding span attributes`);
          }
          return results;
        })
        .catch((error: any) => {
          try {
            logger.debug(
              `[RedisInstrumentation] Redis multi/exec error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch {
            logger.error(`[RedisInstrumentation] error ending span`);
          }
          throw error;
        });
    }

    // Synchronous fallback (defensive — exec should always return a promise)
    try {
      SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
    } catch {
      logger.error(`[RedisInstrumentation] error ending span for synchronous exec`);
    }
    return promise;
  }

  private async _handleReplayExec(
    spanInfo: SpanInfo,
    inputValue: RedisMultiExecInputValue,
    packageName: string,
    stackTrace?: string,
  ): Promise<any> {
    logger.debug(`[RedisInstrumentation] Replaying Redis multi/exec`);

    try {
      const mockData = await findMockResponseAsync({
        mockRequestData: {
          traceId: spanInfo.traceId,
          spanId: spanInfo.spanId,
          name: "redis.multi.exec",
          inputValue: inputValue,
          packageName,
          instrumentationName: this.INSTRUMENTATION_NAME,
          submoduleName: "exec",
          kind: SpanKind.CLIENT,
          stackTrace,
        },
        tuskDrift: this.tuskDrift,
      });

      if (!mockData) {
        logger.warn(`[RedisInstrumentation] No mock data found for multi/exec`);
        throw new Error(`[RedisInstrumentation] No matching mock found for multi/exec`);
      }

      logger.debug(`[RedisInstrumentation] Found mock data for multi/exec`);

      return deserializeBufferValue(mockData.result?.value || mockData.result);
    } catch (error) {
      logger.error(`[RedisInstrumentation] error replaying multi/exec:`, error);
      throw error;
    }
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

  private _serializeOutput(value: any): RedisOutputValue {
    return { value };
  }

  private _deserializeOutput(outputValue: any): any {
    if (!outputValue) {
      return undefined;
    }

    if (typeof outputValue !== "object" || !("value" in outputValue)) {
      return deserializeBufferValue(outputValue);
    }

    return deserializeBufferValue(outputValue.value);
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
