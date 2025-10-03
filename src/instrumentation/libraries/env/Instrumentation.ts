import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { EnvVarTracker } from "../../core/trackers";
import { TdInstrumentationConfig } from "../../core/baseClasses/TdInstrumentationAbstract";
import { logger } from "../../../core/utils/logger";

export interface EnvInstrumentationConfig extends TdInstrumentationConfig {
  mode?: TuskDriftMode;
}

/**
 * Environment variable instrumentation that records and replays process.env access.
 * In record mode, captures environment variable values.
 * In replay mode, returns previously recorded values for deterministic behavior.
 */
export class EnvInstrumentation extends TdInstrumentationBase {
  private mode: TuskDriftMode;
  private originalProcessEnv?: typeof process.env;
  private isInPatchedCall = false;

  constructor(config: EnvInstrumentationConfig = {}) {
    super("env", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
  }

  init(): TdInstrumentationNodeModule[] {
    // Environment variables are global, not a module, so we patch process.env directly
    this.patchProcessEnv();
    return [];
  }

  private patchProcessEnv(): void {
    // Unlike other instrumentations that patch modules when they're required (lazy patching),
    // env var instrumentation patches process.env immediately during init() since process.env
    // is a global object, not a module. This means we need to explicitly check if the
    // instrumentation is enabled before patching, otherwise we'd always patch process.env
    // even when the user has disabled env var recording via enable_env_var_recording config.
    if (this.mode === TuskDriftMode.DISABLED || !this._config.enabled) {
      return;
    }

    this.originalProcessEnv = process.env;

    // Create a proxy around process.env
    const envProxy = new Proxy(this.originalProcessEnv, {
      get: (target, property, receiver) => {
        return this._handleEnvAccess(target, property as string);
      },
      set: (target, property, value, receiver) => {
        // Allow setting env vars normally
        target[property as string] = value;
        return true;
      },
      deleteProperty: (target, property) => {
        delete target[property as string];
        return true;
      },
      ownKeys: (target) => {
        return Reflect.ownKeys(target);
      },
      getOwnPropertyDescriptor: (target, property) => {
        return Reflect.getOwnPropertyDescriptor(target, property);
      },
      has: (target, property) => {
        return Reflect.has(target, property);
      },
    });

    // Replace global process.env with our proxy
    process.env = envProxy;
  }

  private _handleEnvAccess(target: typeof process.env, key: string): string | undefined {
    // Prevent recursion
    if (this.isInPatchedCall) {
      return target[key];
    }

    if (!TuskDriftCore.getInstance().isAppReady()) {
      // Want to use the original process.env when app is in process of starting up
      return target[key];
    }

    this.isInPatchedCall = true;
    try {
      return this._handleEnvAccessInMode(target, key);
    } finally {
      this.isInPatchedCall = false;
    }
  }

  private _handleEnvAccessInMode(target: typeof process.env, key: string): string | undefined {
    let currentSpanInfo: SpanInfo | null = null;
    try {
      currentSpanInfo = SpanUtils.getCurrentSpanInfo();
    } catch (error) {
      logger.error(`EnvInstrumentation error getting current span info:`, error);
    }

    if (!currentSpanInfo) {
      return target[key];
    }

    if (this.mode === TuskDriftMode.REPLAY) {
      return this._handleReplayMode(target, key);
    } else if (this.mode === TuskDriftMode.RECORD) {
      return this._handleRecordMode(currentSpanInfo, target, key);
    } else {
      return target[key];
    }
  }

  private _handleReplayMode(target: typeof process.env, key: string): string | undefined {
    const replayTraceId = SpanUtils.getCurrentReplayTraceId();
    if (!replayTraceId) {
      return target[key];
    }

    const envVar = EnvVarTracker.getEnvVar(replayTraceId, key);
    if (envVar) {
      logger.debug(`Returning env var ${key} for trace ${replayTraceId}: ${envVar}`);
      return envVar;
    }

    return target[key];
  }

  private _handleRecordMode(
    spanInfo: SpanInfo,
    target: typeof process.env,
    key: string,
  ): string | undefined {
    try {
      EnvVarTracker.setEnvVar({
        traceId: spanInfo.traceId,
        key,
        value: target[key] || undefined,
      });
    } catch (error) {
      logger.error(`EnvInstrumentation error storing env var:`, error);
    }
    return target[key];
  }
}
