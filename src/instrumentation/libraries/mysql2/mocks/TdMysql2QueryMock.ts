import { EventEmitter } from "events";
import { SpanKind } from "@opentelemetry/api";
import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { TuskDriftCore } from "../../../../core/TuskDrift";
import { findMockResponseAsync } from "../../../core/utils/mockResponseUtils";
import { logger } from "../../../../core/utils/logger";
import { Mysql2QueryConfig, Mysql2InputValue, Mysql2Result, QueryError } from "../types";

/**
 * Handles replay mode for MySQL2 query operations
 */
export class TdMysql2QueryMock {
  private readonly INSTRUMENTATION_NAME = "Mysql2Instrumentation";
  private tuskDrift: TuskDriftCore;

  constructor() {
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  /**
   * Handle replay of a MySQL2 query (query or execute)
   */
  handleReplayQuery(
    queryConfig: Mysql2QueryConfig,
    inputValue: Mysql2InputValue,
    spanInfo: SpanInfo,
    submoduleName: string = "query",
    stackTrace?: string,
  ): EventEmitter {
    logger.debug(`[Mysql2Instrumentation] Replaying MySQL2 query`);

    const clientType = inputValue.clientType;
    const spanName = `mysql2.${clientType}.${submoduleName}`;

    // Always return an EventEmitter, even when using callbacks
    // This is because mysql2 always returns a Query object (EventEmitter)
    // that can be used for both streaming and callback modes
    // Sequelize relies on this behavior to call .setMaxListeners() on the return value
    return this._handleQuery(
      queryConfig,
      inputValue,
      spanInfo,
      spanName,
      submoduleName,
      stackTrace,
    );
  }

  /**
   * Handle background query requests (outside of trace context)
   * Returns an EventEmitter that immediately completes with empty results
   */
  handleNoOpReplayQuery(queryConfig: Mysql2QueryConfig): EventEmitter {
    logger.debug(`[Mysql2Instrumentation] Background query detected, returning empty result`);

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
      emitter.emit("end");
    });

    return emitter;
  }

  /**
   * Handle query - always returns an EventEmitter (like mysql2 does)
   * This handles both callback and streaming modes
   * The EventEmitter is also thenable (has a .then() method) to support await/Promise usage
   */
  private _handleQuery(
    queryConfig: Mysql2QueryConfig,
    inputValue: Mysql2InputValue,
    spanInfo: SpanInfo,
    spanName: string,
    submoduleName: string,
    stackTrace?: string,
  ): EventEmitter {
    const emitter = new EventEmitter();

    // Store rows and fields for Promise resolution
    let storedRows: any = null;
    let storedFields: any = null;

    // Make the emitter thenable so it can be awaited
    // This is how mysql2's Query object works - it's an EventEmitter that can also be awaited
    (emitter as any).then = function (
      onResolve?: (value: any) => any,
      onReject?: (error: any) => any,
    ) {
      return new Promise((resolve, reject) => {
        emitter.once("end", () => {
          resolve([storedRows, storedFields]);
        });
        emitter.once("error", (error) => {
          reject(error);
        });
      }).then(onResolve, onReject);
    };

    // Fetch mock data asynchronously and emit events
    (async () => {
      try {
        const mockData = await this._fetchMockData(
          inputValue,
          spanInfo,
          spanName,
          submoduleName,
          stackTrace,
        );

        if (!mockData) {
          const sql = queryConfig.sql || inputValue.sql || "UNKNOWN_QUERY";
          logger.warn(`[Mysql2Instrumentation] No mock data found for MySQL2 query: ${sql}`);

          throw new Error(`[Mysql2Instrumentation] No matching mock found for query: ${sql}`);
        }

        // Convert mock data to proper MySQL2 format
        const processedResult = this._convertMysql2Types(mockData.result);

        // Store for Promise resolution
        storedRows = processedResult.rows;
        storedFields = processedResult.fields;

        // Emit events to simulate query execution
        process.nextTick(() => {
          // Emit fields event if available
          if (processedResult.fields) {
            emitter.emit("fields", processedResult.fields);
          }

          // If callback is provided, call it with results
          if (queryConfig.callback) {
            queryConfig.callback(null, processedResult.rows, processedResult.fields);
          }

          // Emit result events for streaming mode
          if (Array.isArray(processedResult.rows)) {
            for (const row of processedResult.rows) {
              emitter.emit("result", row);
            }
          } else if (processedResult.rows) {
            emitter.emit("result", processedResult.rows);
          }

          // Always emit end event
          emitter.emit("end");
        });
      } catch (error) {
        process.nextTick(() => {
          // If callback provided, call it with error
          if (queryConfig.callback) {
            queryConfig.callback(error as QueryError);
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
    inputValue: Mysql2InputValue,
    spanInfo: SpanInfo,
    spanName: string,
    submoduleName: string,
    stackTrace?: string,
  ) {
    return await findMockResponseAsync({
      mockRequestData: {
        traceId: spanInfo.traceId,
        spanId: spanInfo.spanId,
        name: spanName,
        inputValue: inputValue,
        packageName: "mysql2",
        instrumentationName: this.INSTRUMENTATION_NAME,
        submoduleName: submoduleName,
        kind: SpanKind.CLIENT,
        stackTrace,
      },
      tuskDrift: this.tuskDrift,
    });
  }

  /**
   * Convert stored MySQL2 values back to appropriate JavaScript types
   */
  private _convertMysql2Types(result: any): Mysql2Result {
    if (!result) {
      return { rows: [], fields: [] };
    }

    // If result has rows and fields, use them
    if (result.rows !== undefined && result.fields !== undefined) {
      return {
        rows: result.rows,
        fields: result.fields,
      };
    }

    // Otherwise, assume result is the rows
    return {
      rows: result,
      fields: [],
    };
  }
}
