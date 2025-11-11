import { EventEmitter } from "events";
import { SpanKind } from "@opentelemetry/api";
import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { TuskDriftCore } from "../../../../core/TuskDrift";
import { findMockResponseAsync } from "../../../core/utils/mockResponseUtils";
import { logger } from "../../../../core/utils/logger";
import { MysqlQueryInputValue, MysqlOutputValue } from "../types";

/**
 * Configuration for a MySQL query
 */
export interface MysqlQueryConfig {
  sql: string;
  values?: any[];
  callback?: Function;
  options?: {
    nestTables?: boolean | string;
  };
}

/**
 * Handles replay mode for MySQL query operations
 * Returns EventEmitters synchronously to support both callback and streaming modes
 */
export class TdMysqlQueryMock {
  private readonly INSTRUMENTATION_NAME = "MysqlInstrumentation";
  private tuskDrift: TuskDriftCore;

  constructor() {
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  /**
   * Handle replay of a MySQL query
   * Always returns an EventEmitter (like mysql does)
   */
  handleReplayQuery(
    queryConfig: MysqlQueryConfig,
    inputValue: MysqlQueryInputValue,
    spanInfo: SpanInfo,
    stackTrace?: string,
  ): EventEmitter {
    logger.debug(`[MysqlInstrumentation] Replaying MySQL query`);

    return this._handleQuery(queryConfig, inputValue, spanInfo, stackTrace);
  }

  /**
   * Handle background query requests (outside of trace context)
   * Returns an EventEmitter that immediately completes with empty results
   */
  handleNoOpReplayQuery(queryConfig: MysqlQueryConfig): EventEmitter {
    logger.debug(`[MysqlInstrumentation] Background query detected, returning empty result`);

    const emitter = new EventEmitter();

    // Make it thenable for Promise/await support
    (emitter as any).then = function (
      onResolve?: (value: any) => any,
      onReject?: (error: any) => any,
    ) {
      return new Promise((resolve) => {
        emitter.once("end", () => {
          resolve([[], []]); // Empty rows and fields
        });
      }).then(onResolve, onReject);
    };

    // Emit completion asynchronously
    process.nextTick(() => {
      const callback = queryConfig.callback;
      if (callback) {
        callback(null, [], []);
      }
      emitter.emit("fields", [], 0);
      emitter.emit("end");
    });

    return emitter;
  }

  /**
   * Handle query - always returns an EventEmitter (like mysql does)
   * This handles both callback and streaming modes
   * The EventEmitter is also thenable (has a .then() method) to support await/Promise usage
   */
  private _handleQuery(
    queryConfig: MysqlQueryConfig,
    inputValue: MysqlQueryInputValue,
    spanInfo: SpanInfo,
    stackTrace?: string,
  ): EventEmitter {
    const emitter = new EventEmitter();

    // Store rows and fields for Promise resolution
    let storedResults: any = null;
    let storedFields: any = null;

    // Make the emitter thenable so it can be awaited
    // This is how mysql's Query object works - it's an EventEmitter that can also be awaited
    (emitter as any).then = function (
      onResolve?: (value: any) => any,
      onReject?: (error: any) => any,
    ) {
      return new Promise((resolve, reject) => {
        emitter.once("end", () => {
          resolve([storedResults, storedFields]);
        });
        emitter.once("error", (error) => {
          reject(error);
        });
      }).then(onResolve, onReject);
    };

    // Fetch mock data asynchronously and emit events
    (async () => {
      try {
        const mockData = await this._fetchMockData(inputValue, spanInfo, stackTrace);

        if (!mockData) {
          const sql = inputValue.sql || "UNKNOWN_QUERY";
          logger.warn(`[MysqlInstrumentation] No mock data found for MySQL query: ${sql}`);

          throw new Error(`[MysqlInstrumentation] No matching mock found for query: ${sql}`);
        }

        // Extract the result from mock data
        const outputValue = mockData.result as MysqlOutputValue;
        const results = outputValue.results;
        const fields = outputValue.fields;
        const queryCount = outputValue.queryCount || 1;
        const isMultiStatement = queryCount > 1;

        // Store for Promise resolution
        storedResults = results;
        storedFields = fields;

        // Emit events to simulate query execution
        process.nextTick(() => {
          try {
            if (isMultiStatement) {
              // Multi-statement query
              for (let i = 0; i < queryCount; i++) {
                const resultSet = Array.isArray(results) ? results[i] : results;
                const fieldSet = Array.isArray(fields) ? fields[i] : fields;

                if (fieldSet) {
                  emitter.emit("fields", fieldSet, i);
                }

                if (Array.isArray(resultSet)) {
                  resultSet.forEach((row: any) => {
                    emitter.emit("result", row, i);
                  });
                } else {
                  emitter.emit("result", resultSet, i);
                }
              }
            } else {
              // Single statement query
              if (fields) {
                emitter.emit("fields", fields, 0);
              }

              if (Array.isArray(results)) {
                results.forEach((row: any) => {
                  emitter.emit("result", row, 0);
                });
              } else {
                emitter.emit("result", results, 0);
              }
            }

            // If callback is provided, call it with results
            if (queryConfig.callback) {
              queryConfig.callback(null, results, fields);
            }

            // Always emit end event
            emitter.emit("end");
          } catch (emitError) {
            logger.error(`[MysqlInstrumentation] Error emitting events: ${emitError}`);
            emitter.emit("error", emitError);
          }
        });
      } catch (error) {
        process.nextTick(() => {
          // If callback provided, call it with error
          if (queryConfig.callback) {
            queryConfig.callback(error);
          }
          // Always emit error event
          emitter.emit("error", error);
        });
      }
    })();

    return emitter;
  }

  /**
   * Fetch mock data from CLI
   */
  private async _fetchMockData(
    inputValue: MysqlQueryInputValue,
    spanInfo: SpanInfo,
    stackTrace?: string,
  ) {
    return await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: "mysql.query",
        inputValue: inputValue,
        packageName: "mysql",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: "query",
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });
  }
}
