import { EventEmitter } from "events";
import { SpanKind } from "@opentelemetry/api";
import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { TuskDriftCore } from "../../../../core/TuskDrift";
import { findMockResponseAsync } from "../../../core/utils/mockResponseUtils";
import { logger } from "../../../../core/utils/logger";
import {
  Mysql2QueryConfig,
  Mysql2InputValue,
  Mysql2Result,
  QueryError,
} from "../types";

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
  ): any {
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
    );
  }

  /**
   * Handle query - always returns an EventEmitter (like mysql2 does)
   * This handles both callback and streaming modes
   */
  private _handleQuery(
    queryConfig: Mysql2QueryConfig,
    inputValue: Mysql2InputValue,
    spanInfo: SpanInfo,
    spanName: string,
    submoduleName: string,
  ): EventEmitter {
    const emitter = new EventEmitter();

    // Fetch mock data asynchronously and emit events
    (async () => {
      try {
        const mockData = await this._fetchMockData(inputValue, spanInfo, spanName, submoduleName);

        if (!mockData) {
          const sql = queryConfig.sql || inputValue.sql || "UNKNOWN_QUERY";
          logger.warn(`[Mysql2Instrumentation] No mock data found for MySQL2 query: ${sql}`);
          const error = new Error("No mock data found") as QueryError;
          process.nextTick(() => {
            // If callback provided, call it with error
            if (queryConfig.callback) {
              queryConfig.callback(error);
            }
            // Always emit error event
            emitter.emit("error", error);
          });
          return;
        }

        // Convert mock data to proper MySQL2 format
        const processedResult = this._convertMysql2Types(mockData.result);

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
