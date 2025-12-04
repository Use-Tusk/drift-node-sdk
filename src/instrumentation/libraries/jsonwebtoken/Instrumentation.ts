import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap } from "../../core/utils";
import { findMockResponseSync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  JsonwebtokenModuleExports,
  JsonwebtokenInstrumentationConfig,
  JwtVerifyInputValue,
  JwtSignInputValue,
  VerifyQueryConfig,
  SignQueryConfig,
} from "./types";
import { createMockInputValue } from "../../../core/utils";
import { logger } from "../../../core/utils/logger";

export class JsonwebtokenInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "JsonwebtokenInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;
  private _JsonWebTokenError?: any;
  private _NotBeforeError?: any;
  private _TokenExpiredError?: any;

  constructor(config: JsonwebtokenInstrumentationConfig = {}) {
    super("jsonwebtoken", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "jsonwebtoken",
        supportedVersions: ["5.*", "6.*", "7.*", "8.*", "9.*"],
        patch: (moduleExports: JsonwebtokenModuleExports) =>
          this._patchJsonwebtokenModule(moduleExports),
      }),
    ];
  }

  private _patchJsonwebtokenModule(
    jwtModule: JsonwebtokenModuleExports,
  ): JsonwebtokenModuleExports {
    if (this.isModulePatched(jwtModule)) {
      logger.debug(`[JsonwebtokenInstrumentation] jsonwebtoken module already patched, skipping`);
      return jwtModule;
    }

    // Store original functions and error classes
    this._JsonWebTokenError = jwtModule.JsonWebTokenError;
    this._NotBeforeError = jwtModule.NotBeforeError;
    this._TokenExpiredError = jwtModule.TokenExpiredError;

    // Wrap jwt.verify
    if (jwtModule.verify) {
      this._wrap(jwtModule, "verify", this._getVerifyPatchFn());
      logger.debug(`[JsonwebtokenInstrumentation] Wrapped jwt.verify`);
    }

    // Wrap jwt.sign
    if (jwtModule.sign) {
      this._wrap(jwtModule, "sign", this._getSignPatchFn());
      logger.debug(`[JsonwebtokenInstrumentation] Wrapped jwt.sign`);
    }

    this.markModuleAsPatched(jwtModule);
    logger.debug(`[JsonwebtokenInstrumentation] jsonwebtoken module patching complete`);

    return jwtModule;
  }

  private _getVerifyPatchFn() {
    const self = this;

    return (originalVerify: Function) => {
      return function verify(this: any, ...args: any[]) {
        // Parse verify arguments - jwt.verify supports multiple signatures
        let verifyConfig: VerifyQueryConfig | null = null;
        try {
          verifyConfig = self.parseVerifyArgs(args);
        } catch (error) {
          logger.error(`[JsonwebtokenInstrumentation] error parsing verify args:`, error);
        }

        if (!verifyConfig || !verifyConfig.token) {
          // If we can't parse the arguments, let it pass through
          logger.debug(
            `[JsonwebtokenInstrumentation] Could not parse jwt.verify args, executing original`,
            args,
          );
          return originalVerify.apply(this, args);
        }

        const rawInputValue: JwtVerifyInputValue = {
          token: verifyConfig.token,
          secretOrPublicKey:
            typeof verifyConfig.secretOrPublicKey === "function"
              ? "[Function:secretProvider]"
              : verifyConfig.secretOrPublicKey,
          options: verifyConfig.options,
        };

        // Normalize the input value for consistent hashing
        let inputValue: JwtVerifyInputValue;

        try {
          inputValue = createMockInputValue(rawInputValue);
        } catch (error) {
          logger.error(`[JsonwebtokenInstrumentation] error creating mock input value:`, error);
          return originalVerify.apply(this, args);
        }

        // Handle replay mode (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["JsonwebtokenInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              const hasCallback = !!verifyConfig.callback;
              if (hasCallback) {
                process.nextTick(() => verifyConfig.callback!(null, undefined));
                return;
              } else {
                return undefined;
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              // Create span in replay mode
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalVerify.apply(this, args),
                {
                  name: "jsonwebtoken.verify",
                  kind: SpanKind.CLIENT,
                  submodule: "verify",
                  packageName: "jsonwebtoken",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self.handleReplayVerify(verifyConfig, inputValue, spanInfo, stackTrace);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalVerify.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalVerify.apply(this, args),
                {
                  name: "jsonwebtoken.verify",
                  kind: SpanKind.CLIENT,
                  submodule: "verify",
                  packageName: "jsonwebtoken",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordVerifyInSpan(
                    spanInfo,
                    originalVerify,
                    verifyConfig,
                    args,
                    this,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Should never happen since we're only patching record and replay modes
          return originalVerify.apply(this, args);
        }
      };
    };
  }

  private _getSignPatchFn() {
    const self = this;

    return (originalSign: Function) => {
      return function sign(this: any, ...args: any[]) {
        // Parse sign arguments - jwt.sign supports multiple signatures
        let signConfig: SignQueryConfig | null = null;
        try {
          signConfig = self.parseSignArgs(args);
        } catch (error) {
          logger.error(`[JsonwebtokenInstrumentation] error parsing sign args:`, error);
        }

        if (!signConfig || !signConfig.payload) {
          // If we can't parse the arguments, let it pass through
          logger.warn(
            `[JsonwebtokenInstrumentation] Could not parse jwt.sign args, executing original`,
            args,
          );
          return originalSign.apply(this, args);
        }

        const inputValue: JwtSignInputValue = {
          payload: signConfig.payload,
          secretOrPrivateKey: signConfig.secretOrPrivateKey,
          options: signConfig.options,
        };

        // Handle replay mode (only if app is ready)
        if (self.mode === TuskDriftMode.REPLAY) {
          const stackTrace = captureStackTrace(["JsonwebtokenInstrumentation"]);

          return handleReplayMode({
            noOpRequestHandler: () => {
              const hasCallback = !!signConfig.callback;
              if (hasCallback) {
                process.nextTick(() => signConfig.callback!(null, undefined));
                return;
              } else {
                return undefined;
              }
            },
            isServerRequest: false,
            replayModeHandler: () => {
              // Create span in replay mode
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalSign.apply(this, args),
                {
                  name: "jsonwebtoken.sign",
                  kind: SpanKind.CLIENT,
                  submodule: "sign",
                  packageName: "jsonwebtoken",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart: false,
                },
                (spanInfo) => {
                  return self.handleReplaySign(signConfig, inputValue, spanInfo, stackTrace);
                },
              );
            },
          });
        } else if (self.mode === TuskDriftMode.RECORD) {
          return handleRecordMode({
            originalFunctionCall: () => originalSign.apply(this, args),
            recordModeHandler: ({ isPreAppStart }) => {
              // Record mode - create span and execute real sign
              return SpanUtils.createAndExecuteSpan(
                self.mode,
                () => originalSign.apply(this, args),
                {
                  name: "jsonwebtoken.sign",
                  kind: SpanKind.CLIENT,
                  submodule: "sign",
                  packageName: "jsonwebtoken",
                  instrumentationName: self.INSTRUMENTATION_NAME,
                  inputValue: inputValue,
                  isPreAppStart,
                },
                (spanInfo) => {
                  return self._handleRecordSignInSpan(
                    spanInfo,
                    originalSign,
                    signConfig,
                    args,
                    this,
                  );
                },
              );
            },
            spanKind: SpanKind.CLIENT,
          });
        } else {
          // Should never happen since we're only patching record and replay modes
          return originalSign.apply(this, args);
        }
      };
    };
  }

  parseVerifyArgs(args: any[]): VerifyQueryConfig | null {
    if (args.length < 2) return null;

    const token = args[0];
    const secretOrPublicKey = args[1];

    if (typeof token !== "string") return null;

    const config: VerifyQueryConfig = {
      token,
      secretOrPublicKey,
      callback: typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined,
    };

    // Check for options parameter
    if (
      args.length >= 3 &&
      typeof args[2] === "object" &&
      typeof args[args.length - 1] !== "function"
    ) {
      config.options = args[2];
    } else if (args.length >= 4 && typeof args[2] === "object") {
      config.options = args[2];
    }

    return config;
  }

  parseSignArgs(args: any[]): SignQueryConfig | null {
    if (args.length < 2) return null;

    const payload = args[0];
    const secretOrPrivateKey = args[1];

    const config: SignQueryConfig = {
      payload,
      secretOrPrivateKey,
      callback: typeof args[args.length - 1] === "function" ? args[args.length - 1] : undefined,
    };

    // Check for options parameter
    if (
      args.length >= 3 &&
      typeof args[2] === "object" &&
      typeof args[args.length - 1] !== "function"
    ) {
      config.options = args[2];
    } else if (args.length >= 4 && typeof args[2] === "object") {
      config.options = args[2];
    }

    return config;
  }

  private _handleRecordVerifyInSpan(
    spanInfo: SpanInfo,
    originalVerify: Function,
    verifyConfig: VerifyQueryConfig,
    args: any[],
    context: any,
  ): any {
    const hasCallback = !!verifyConfig.callback;

    if (hasCallback) {
      // Callback-based verify
      const originalCallback = verifyConfig.callback!;
      const wrappedCallback = (error: Error | null, decoded?: any) => {
        if (error) {
          try {
            logger.debug(
              `[JsonwebtokenInstrumentation] JWT verify error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            this._addErrorOutputAttributesToSpan(spanInfo, error);
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
          }
        } else {
          try {
            logger.debug(
              `[JsonwebtokenInstrumentation] JWT verify completed successfully (${SpanUtils.getTraceInfo()})`,
            );
            this._addOutputAttributesToSpan(spanInfo, decoded);
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
          }
        }
        return originalCallback(error, decoded);
      };

      try {
        // Replace callback in args
        args[args.length - 1] = wrappedCallback;
      } catch (error) {
        logger.error(`[JsonwebtokenInstrumentation] error replacing callback:`, error, args);
      }

      try {
        const retVal = originalVerify.apply(context, args);
        return retVal;
      } catch (error: any) {
        try {
          logger.debug(
            `[JsonwebtokenInstrumentation] JWT verify sync error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          this._addErrorOutputAttributesToSpan(spanInfo, error);
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
        } catch (error) {
          logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
        }
        throw error;
      }
    } else {
      // Synchronous verify
      try {
        const result = originalVerify.apply(context, args);
        try {
          logger.debug(
            `[JsonwebtokenInstrumentation] JWT verify completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          this._addOutputAttributesToSpan(spanInfo, result);
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        } catch (error) {
          logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
        }

        return result;
      } catch (error: any) {
        try {
          logger.debug(
            `[JsonwebtokenInstrumentation] JWT verify error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          this._addErrorOutputAttributesToSpan(spanInfo, error);
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
        } catch (error) {
          logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
        }
        throw error;
      }
    }
  }

  private _handleRecordSignInSpan(
    spanInfo: SpanInfo,
    originalSign: Function,
    signConfig: SignQueryConfig,
    args: any[],
    context: any,
  ): any {
    const hasCallback = !!signConfig.callback;

    if (hasCallback) {
      // Callback-based sign
      const originalCallback = signConfig.callback!;
      const wrappedCallback = (error: Error | null, token?: string) => {
        if (error) {
          try {
            logger.debug(
              `[JsonwebtokenInstrumentation] JWT sign error: ${error.message} (${SpanUtils.getTraceInfo()})`,
            );
            this._addErrorOutputAttributesToSpan(spanInfo, error);
            SpanUtils.endSpan(spanInfo.span, {
              code: SpanStatusCode.ERROR,
              message: error.message,
            });
          } catch (error) {
            logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
          }
        } else {
          try {
            logger.debug(
              `[JsonwebtokenInstrumentation] JWT sign completed successfully (${SpanUtils.getTraceInfo()})`,
            );
            this._addOutputAttributesToSpan(spanInfo, token);
            SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
          } catch (error) {
            logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
          }
        }
        return originalCallback(error, token);
      };

      try {
        // Replace callback in args
        args[args.length - 1] = wrappedCallback;
      } catch (error) {
        logger.error(`[JsonwebtokenInstrumentation] error replacing callback:`, error, args);
      }

      const retVal = originalSign.apply(context, args);
      return retVal;
    } else {
      // Synchronous sign
      try {
        const result = originalSign.apply(context, args);
        try {
          logger.debug(
            `[JsonwebtokenInstrumentation] JWT sign completed successfully (${SpanUtils.getTraceInfo()})`,
          );
          this._addOutputAttributesToSpan(spanInfo, result);
          SpanUtils.endSpan(spanInfo.span, { code: SpanStatusCode.OK });
        } catch (error) {
          logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
        }
        return result;
      } catch (error: any) {
        try {
          logger.debug(
            `[JsonwebtokenInstrumentation] JWT sign error: ${error.message} (${SpanUtils.getTraceInfo()})`,
          );
          this._addErrorOutputAttributesToSpan(spanInfo, error);
          SpanUtils.endSpan(spanInfo.span, {
            code: SpanStatusCode.ERROR,
            message: error.message,
          });
        } catch (error) {
          logger.error(`[JsonwebtokenInstrumentation] error ending span:`, error);
        }
        throw error;
      }
    }
  }

  handleReplayVerify(
    verifyConfig: VerifyQueryConfig,
    inputValue: JwtVerifyInputValue,
    spanInfo: SpanInfo,
    stackTrace?: string,
  ): any {
    logger.debug(`[JsonwebtokenInstrumentation] Replaying JWT verify`);

    // Look for matching recorded response
    const mockData = findMockResponseSync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "jsonwebtoken.verify",
        packageName: "jsonwebtoken",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "verify",
        inputValue: inputValue,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    const hasCallback = !!verifyConfig.callback;

    if (!mockData) {
      logger.warn(
        `[JsonwebtokenInstrumentation] No mock data found for JWT verify: ${verifyConfig.token}`,
      );

      throw new Error(
        `[JsonwebtokenInstrumentation] No matching mock found for JWT verify: ${verifyConfig.token}`,
      );
    }

    // Handle errors from the mock data (errors are embedded in the result)
    if (mockData.result && mockData.result.error) {
      let error = mockData.result.error;

      // Recreate specific JWT error types
      if (this._TokenExpiredError && mockData.result.error.name === "TokenExpiredError") {
        error = new this._TokenExpiredError(
          mockData.result.error.message,
          mockData.result.error.expiredAt,
        );
      } else if (this._JsonWebTokenError && mockData.result.error.name === "JsonWebTokenError") {
        error = new this._JsonWebTokenError(mockData.result.error.message);
      } else if (this._NotBeforeError && mockData.result.error.name === "NotBeforeError") {
        error = new this._NotBeforeError(mockData.result.error.message, mockData.result.error.date);
      } else {
        // Create a generic error if we don't have the specific error class
        error = new Error(mockData.result.error.message);
        error.name = mockData.result.error.name;
      }

      if (hasCallback) {
        process.nextTick(() => verifyConfig.callback!(error));
        return;
      } else {
        throw error;
      }
    }

    // Handle successful verification
    const result = mockData.result.token !== undefined ? mockData.result.token : mockData.result;
    if (hasCallback) {
      process.nextTick(() => {
        verifyConfig.callback!(null, result);
      });
      return;
    } else {
      return result;
    }
  }

  handleReplaySign(
    signConfig: SignQueryConfig,
    inputValue: JwtSignInputValue,
    spanInfo: SpanInfo,
    stackTrace?: string,
  ): any {
    logger.debug(`[JsonwebtokenInstrumentation] Replaying JWT sign`);

    // Look for matching recorded response
    const mockData = findMockResponseSync({
      mockRequestData: {
        traceId: spanInfo?.traceId,
        spanId: spanInfo?.spanId,
        name: "jsonwebtoken.sign",
        packageName: "jsonwebtoken",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "sign",
        inputValue: inputValue,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    const hasCallback = !!signConfig.callback;

    if (!mockData) {
      logger.warn(`[JsonwebtokenInstrumentation] No mock data found for JWT sign`);
      throw new Error(`[JsonwebtokenInstrumentation] No matching mock found for JWT sign`);
    }

    // Handle errors from the mock data (errors are embedded in the result)
    if (mockData.result && mockData.result.error) {
      let error = mockData.result.error;

      // Recreate specific JWT error types
      if (this._JsonWebTokenError && mockData.result.error.name === "JsonWebTokenError") {
        error = new this._JsonWebTokenError(mockData.result.error.message);
      } else {
        // Create a generic error if we don't have the specific error class
        error = new Error(mockData.result.error.message);
        error.name = mockData.result.error.name;
      }

      if (hasCallback) {
        process.nextTick(() => signConfig.callback!(error));
        return;
      } else {
        throw error;
      }
    }

    // Handle successful signing
    const result = mockData.result.token !== undefined ? mockData.result.token : mockData.result;
    if (hasCallback) {
      process.nextTick(() => {
        signConfig.callback!(null, result);
      });
      return;
    } else {
      return result;
    }
  }

  private _addOutputAttributesToSpan(spanInfo: SpanInfo, result?: any): void {
    if (!result) return;

    const outputValue = typeof result === "string" ? { token: result } : result;

    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue,
    });
  }

  private _addErrorOutputAttributesToSpan(spanInfo: SpanInfo, error: Error): void {
    const errorOutput = {
      error: {
        name: error.name,
        message: error.message,
        // Include any additional properties that specific JWT errors might have
        ...((error as any).expiredAt && { expiredAt: (error as any).expiredAt }),
        ...((error as any).date && { date: (error as any).date }),
      },
    };

    SpanUtils.addSpanAttributes(spanInfo.span, {
      outputValue: errorOutput,
    });
  }

  private _wrap(target: any, propertyName: string, wrapper: (original: any) => any): void {
    wrap(target, propertyName, wrapper);
  }
}
