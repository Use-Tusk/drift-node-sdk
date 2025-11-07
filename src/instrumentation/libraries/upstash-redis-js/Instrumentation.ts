import { TdInstrumentationBase } from "../../core/baseClasses/TdInstrumentationBase";
import { TdInstrumentationNodeModule } from "../../core/baseClasses/TdInstrumentationNodeModule";
import { SpanUtils, SpanInfo } from "../../../core/tracing/SpanUtils";
import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import { TuskDriftCore, TuskDriftMode } from "../../../core/TuskDrift";
import { captureStackTrace, wrap } from "../../core/utils";
import { findMockResponseAsync } from "../../core/utils/mockResponseUtils";
import { handleRecordMode, handleReplayMode } from "../../core/utils/modeUtils";
import {
  UpstashRedisModuleExports,
  UpstashRedisInputValue,
  UpstashRedisInstrumentationConfig,
  UpstashRedisOutputValue,
} from "./types";
import { PackageType } from "@use-tusk/drift-schemas/core/span";
import { logger } from "../../../core/utils";
import { isEsm } from "../../../core/utils/runtimeDetectionUtils";

const SUPPORTED_VERSIONS = [">=1.0.0"];

// List of Redis commands to instrument at the method level
const REDIS_COMMANDS = [
  // String operations
  "get",
  "set",
  "getdel",
  "getset",
  "setex",
  "setnx",
  "mget",
  "mset",
  "msetnx",
  "append",
  "getrange",
  "setrange",
  "strlen",
  "incr",
  "incrby",
  "incrbyfloat",
  "decr",
  "decrby",

  // Hash operations
  "hget",
  "hset",
  "hsetnx",
  "hmget",
  "hmset",
  "hgetall",
  "hdel",
  "hexists",
  "hincrby",
  "hincrbyfloat",
  "hkeys",
  "hlen",
  "hvals",
  "hscan",

  // List operations
  "lpush",
  "rpush",
  "lpop",
  "rpop",
  "llen",
  "lrange",
  "lindex",
  "lset",
  "linsert",
  "lrem",
  "ltrim",
  "blpop",
  "brpop",
  "brpoplpush",
  "rpoplpush",
  "lpos",
  "lmove",
  "blmove",

  // Set operations
  "sadd",
  "srem",
  "smembers",
  "sismember",
  "scard",
  "sdiff",
  "sdiffstore",
  "sinter",
  "sinterstore",
  "sunion",
  "sunionstore",
  "spop",
  "srandmember",
  "smove",
  "sscan",

  // Sorted set operations
  "zadd",
  "zrem",
  "zscore",
  "zincrby",
  "zcard",
  "zcount",
  "zrange",
  "zrevrange",
  "zrangebyscore",
  "zrevrangebyscore",
  "zrank",
  "zrevrank",
  "zremrangebyrank",
  "zremrangebyscore",
  "zpopmin",
  "zpopmax",
  "bzpopmin",
  "bzpopmax",
  "zdiff",
  "zdiffstore",
  "zinter",
  "zinterstore",
  "zunion",
  "zunionstore",
  "zscan",
  "zrangebylex",
  "zrevrangebylex",
  "zremrangebylex",

  // Key operations
  "del",
  "exists",
  "expire",
  "expireat",
  "ttl",
  "pttl",
  "persist",
  "keys",
  "scan",
  "randomkey",
  "rename",
  "renamenx",
  "type",
  "dump",
  "restore",
  "touch",
  "unlink",

  // Pub/Sub operations
  "publish",
  "subscribe",
  "unsubscribe",
  "psubscribe",
  "punsubscribe",

  // Geo operations
  "geoadd",
  "geodist",
  "geohash",
  "geopos",
  "georadius",
  "georadiusbymember",
  "geosearch",
  "geosearchstore",

  // HyperLogLog operations
  "pfadd",
  "pfcount",
  "pfmerge",

  // Bitmap operations
  "getbit",
  "setbit",
  "bitcount",
  "bitpos",
  "bitop",
  "bitfield",

  // Script operations
  "eval",
  "evalsha",
  "script",

  // Transaction operations
  "multi",
  "exec",
  "discard",
  "watch",
  "unwatch",

  // Server operations
  "flushdb",
  "flushall",
  "dbsize",
  "ping",
  "echo",
  "select",
  "quit",
  "info",
  "config",
  "time",

  // Stream operations
  "xadd",
  "xlen",
  "xrange",
  "xrevrange",
  "xread",
  "xreadgroup",
  "xack",
  "xpending",
  "xclaim",
  "xautoclaim",
  "xdel",
  "xtrim",
  "xgroup",
  "xinfo",
];

export class UpstashRedisInstrumentation extends TdInstrumentationBase {
  private readonly INSTRUMENTATION_NAME = "UpstashRedisInstrumentation";
  private mode: TuskDriftMode;
  private tuskDrift: TuskDriftCore;

  constructor(config: UpstashRedisInstrumentationConfig = {}) {
    super("@upstash/redis", config);
    this.mode = config.mode || TuskDriftMode.DISABLED;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  init(): TdInstrumentationNodeModule[] {
    return [
      new TdInstrumentationNodeModule({
        name: "@upstash/redis",
        supportedVersions: SUPPORTED_VERSIONS,
        patch: (moduleExports: UpstashRedisModuleExports) => {
          return this._patchUpstashRedisModule(moduleExports);
        },
      }),
    ];
  }

  private _patchUpstashRedisModule(
    moduleExports: UpstashRedisModuleExports,
  ): UpstashRedisModuleExports {
    logger.debug(
      `[UpstashRedisInstrumentation] Patching @upstash/redis module in ${this.mode} mode`,
    );

    if (this.mode === TuskDriftMode.DISABLED) {
      logger.debug(`[UpstashRedisInstrumentation] Skipping patching in ${this.mode} mode`);
      return moduleExports;
    }

    if (this.isModulePatched(moduleExports)) {
      logger.debug(`[UpstashRedisInstrumentation] Module already patched, skipping`);
      return moduleExports;
    }

    // Detect module type
    const isEsmModule = isEsm(moduleExports);
    logger.debug(
      `[UpstashRedisInstrumentation] Module type detected: ${isEsmModule ? "ESM" : "CJS"}`,
    );

    // Get the Redis class from module exports
    const OriginalRedis = moduleExports.Redis;

    if (!OriginalRedis || typeof OriginalRedis !== "function") {
      logger.debug(
        `[UpstashRedisInstrumentation] Redis class not found in module exports. Available keys: ${Object.keys(moduleExports).join(", ")}`,
      );
      return moduleExports;
    }

    const self = this;

    // Create wrapped Redis constructor
    // Note: We cannot modify moduleExports.Redis directly because it's non-configurable
    // Instead, we return a new moduleExports object with our wrapped Redis class
    const WrappedRedis = function Redis(this: any, ...args: any[]) {
      logger.debug(`[UpstashRedisInstrumentation] Redis constructor called`);

      // Call original constructor with proper context
      const instance = Reflect.construct(OriginalRedis, args, new.target || WrappedRedis);

      // Since Upstash Redis uses dynamic property access for commands (not prototype methods),
      // we need to wrap the instance with a Proxy to intercept command calls
      return self._wrapInstanceWithProxy(instance);
    } as any;

    // Copy static properties and prototype from original Redis class
    Object.setPrototypeOf(WrappedRedis, OriginalRedis);
    WrappedRedis.prototype = OriginalRedis.prototype;

    // IMPORTANT: Handle ESM vs CJS differently due to how module interception works
    //
    // ESM uses import-in-the-middle (IITM):
    //   - IITM wraps module exports with getter/setter pairs for tracking imports
    //   - The setters are configurable and writable, allowing direct assignment
    //   - Direct assignment works: moduleExports.Redis = WrappedRedis
    //   - Spread operator BREAKS it: {...moduleExports} copies values but loses IITM's setters
    //   - Result: We MUST mutate the original object to preserve IITM's tracking
    //
    // CJS uses require-in-the-middle (RITM):
    //   - RITM does NOT add setters like IITM does
    //   - Module authors often use Object.defineProperty with configurable: false and only a getter
    //   - This means: property has only a getter (no setter) and cannot be redefined
    //   - Direct assignment fails: moduleExports.Redis = WrappedRedis (Cannot set property which has only a getter)
    //   - Object.defineProperty fails: Cannot redefine non-configurable property
    //   - Spread operator works: {...moduleExports} copies values into a new object
    //   - Result: We MUST return a new object when properties are non-configurable
    if (isEsmModule) {
      // For ESM: Mutate the original moduleExports object to preserve IITM's setter tracking
      try {
        // Try to set Redis property directly (should work in most ESM cases)
        (moduleExports as any).Redis = WrappedRedis;
      } catch (error) {
        // Fallback: If direct assignment somehow fails, try Object.defineProperty
        // This is a safety net but should rarely be needed for ESM with IITM
        Object.defineProperty(moduleExports, "Redis", {
          value: WrappedRedis,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }

      this.markModuleAsPatched(moduleExports);
      logger.debug(`[UpstashRedisInstrumentation] @upstash/redis module patching complete`);
      return moduleExports;
    } else {
      // For CJS: Return a new object because the original has non-configurable properties
      // The spread operator copies all property values (invoking getters) into a new plain object,
      // then we override the Redis property with our wrapped version
      const newModuleExports: UpstashRedisModuleExports = {
        ...moduleExports,
        Redis: WrappedRedis,
      };

      this.markModuleAsPatched(newModuleExports);
      logger.debug(`[UpstashRedisInstrumentation] @upstash/redis module patching complete`);
      return newModuleExports;
    }
  }

  private _wrapInstanceWithProxy(instance: any): any {
    const self = this;
    const redisCommandsSet = new Set(REDIS_COMMANDS);

    logger.debug(`[UpstashRedisInstrumentation] Creating Proxy wrapper for Redis instance`);

    return new Proxy(instance, {
      get(target: any, prop: string | symbol, receiver: any) {
        const originalValue = Reflect.get(target, prop, receiver);

        // Only intercept if:
        // 1. It's a string property (not a symbol)
        // 2. It's a known Redis command
        // 3. The original value is a function
        if (
          typeof prop === "string" &&
          redisCommandsSet.has(prop.toLowerCase()) &&
          typeof originalValue === "function"
        ) {
          logger.debug(`[UpstashRedisInstrumentation] Proxy intercepted command: ${prop}`);

          // Return a wrapped version of the function
          return function (this: any, ...args: any[]) {
            const commandName = prop;
            const operationName = `upstash-redis.${commandName.toLowerCase()}`;
            const submoduleName = "command";

            // Create input value with command arguments
            const inputValue: UpstashRedisInputValue = {
              command: [
                commandName.toUpperCase(),
                ...args.filter((arg) => typeof arg !== "function"),
              ],
              connectionInfo: {
                baseUrl: target.client?.baseUrl,
              },
            };

            // Handle replay mode
            if (self.mode === TuskDriftMode.REPLAY) {
              const stackTrace = captureStackTrace(["UpstashRedisInstrumentation"]);

              return handleReplayMode({
                noOpRequestHandler: () => {
                  return undefined;
                },
                isServerRequest: false,
                replayModeHandler: () => {
                  return SpanUtils.createAndExecuteSpan(
                    self.mode,
                    () => originalValue.apply(this === receiver ? target : this, args),
                    {
                      name: operationName,
                      kind: SpanKind.CLIENT,
                      submodule: submoduleName,
                      packageType: PackageType.REDIS,
                      packageName: "@upstash/redis",
                      instrumentationName: self.INSTRUMENTATION_NAME,
                      inputValue: inputValue,
                      isPreAppStart: false,
                    },
                    (spanInfo) => {
                      return self._handleReplayCommand(
                        spanInfo,
                        inputValue,
                        operationName,
                        submoduleName,
                        stackTrace,
                      );
                    },
                  );
                },
              });
            } else if (self.mode === TuskDriftMode.RECORD) {
              return handleRecordMode({
                originalFunctionCall: () =>
                  originalValue.apply(this === receiver ? target : this, args),
                recordModeHandler: ({ isPreAppStart }) => {
                  return SpanUtils.createAndExecuteSpan(
                    self.mode,
                    () => originalValue.apply(this === receiver ? target : this, args),
                    {
                      name: operationName,
                      kind: SpanKind.CLIENT,
                      submodule: submoduleName,
                      packageType: PackageType.REDIS,
                      packageName: "@upstash/redis",
                      instrumentationName: self.INSTRUMENTATION_NAME,
                      inputValue: inputValue,
                      isPreAppStart,
                      stopRecordingChildSpans: true,
                    },
                    (spanInfo) => {
                      return self._handleRecordCommand(
                        spanInfo,
                        originalValue,
                        this === receiver ? target : this,
                        args,
                      );
                    },
                  );
                },
                spanKind: SpanKind.CLIENT,
              });
            } else {
              return originalValue.apply(this === receiver ? target : this, args);
            }
          };
        }

        // For all other properties, return as-is
        return originalValue;
      },
    });
  }

  private async _handleRecordCommand(
    spanInfo: SpanInfo,
    originalMethod: Function,
    thisContext: any,
    args: any[],
  ): Promise<any> {
    try {
      const result = await originalMethod.apply(thisContext, args);

      logger.debug(`[UpstashRedisInstrumentation] Command completed successfully`);

      const outputValue: UpstashRedisOutputValue = {
        result: result,
      };

      try {
        SpanUtils.addSpanAttributes(spanInfo.span, { outputValue });
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.OK,
        });
      } catch (error) {
        logger.error(`[UpstashRedisInstrumentation] Error adding span attributes: ${error}`);
      }

      return result;
    } catch (error) {
      logger.debug(`[UpstashRedisInstrumentation] Command error: ${error}`);
      try {
        SpanUtils.endSpan(spanInfo.span, {
          code: SpanStatusCode.ERROR,
        });
      } catch (error) {
        logger.error(`[UpstashRedisInstrumentation] Error ending span: ${error}`);
      }
      throw error;
    }
  }

  private async _handleReplayCommand(
    spanInfo: SpanInfo,
    inputValue: UpstashRedisInputValue,
    operationName: string,
    submoduleName: string,
    stackTrace?: string,
  ): Promise<any> {
    logger.debug(`[UpstashRedisInstrumentation] Replaying command: ${operationName}`);

    const mockData = await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: operationName,
        inputValue: inputValue,
        packageName: "@upstash/redis",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: submoduleName,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });

    if (!mockData) {
      logger.warn(`[UpstashRedisInstrumentation] No mock data found for command: ${operationName}`);
      throw new Error(
        `[UpstashRedisInstrumentation] No matching mock found for command: ${operationName}`,
      );
    }

    logger.debug(
      `[UpstashRedisInstrumentation] Found mock data for command ${operationName}: ${JSON.stringify(mockData)}`,
    );

    // Return the mocked result directly (not wrapped in UpstashResponse)
    return mockData.result?.result;
  }
}
