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

    // For streaming queries (no callback), return an EventEmitter
    if (!queryConfig.callback) {
      return this._handleStreamingQuery(
        queryConfig,
        inputValue,
        spanInfo,
        spanName,
        submoduleName,
      );
    }

    // For callback-based queries (no return value, uses callback)
    this._handleCallbackQuery(
      queryConfig,
      inputValue,
      spanInfo,
      spanName,
      submoduleName,
    );
  }

  /**
   * Handle streaming query (EventEmitter-based)
   */
  private _handleStreamingQuery(
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
          process.nextTick(() => {
            emitter.emit("error", new Error("No mock data found"));
          });
          return;
        }

        // Convert mock data to proper MySQL2 format
        const processedResult = this._convertMysql2Types(mockData.result);

        // Emit events to simulate streaming query
        process.nextTick(() => {
          if (processedResult.fields) {
            emitter.emit("fields", processedResult.fields);
          }

          if (Array.isArray(processedResult.rows)) {
            for (const row of processedResult.rows) {
              emitter.emit("result", row);
            }
          } else if (processedResult.rows) {
            emitter.emit("result", processedResult.rows);
          }

          emitter.emit("end");
        });
      } catch (error) {
        process.nextTick(() => {
          emitter.emit("error", error);
        });
      }
    })();

    return emitter;
  }

  /**
   * Handle callback-based query
   */
  private _handleCallbackQuery(
    queryConfig: Mysql2QueryConfig,
    inputValue: Mysql2InputValue,
    spanInfo: SpanInfo,
    spanName: string,
    submoduleName: string,
  ): void {
    (async () => {
      try {
        const mockData = await this._fetchMockData(inputValue, spanInfo, spanName, submoduleName);

        if (!mockData) {
          const sql = queryConfig.sql || inputValue.sql || "UNKNOWN_QUERY";
          logger.warn(`[Mysql2Instrumentation] No mock data found for MySQL2 query: ${sql}`);
          process.nextTick(() =>
            queryConfig.callback!(new Error("No mock data found") as QueryError),
          );
          return;
        }

        // Convert mock data to proper MySQL2 format
        const processedResult = this._convertMysql2Types(mockData.result);

        process.nextTick(() => {
          queryConfig.callback!(null, processedResult.rows, processedResult.fields);
        });
      } catch (error) {
        process.nextTick(() => queryConfig.callback!(error as QueryError));
      }
    })();
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
