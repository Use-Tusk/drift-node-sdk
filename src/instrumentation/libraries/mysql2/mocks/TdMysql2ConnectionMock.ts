import { EventEmitter } from "events";
import { Mysql2Instrumentation } from "../Instrumentation";
import { createMockInputValue } from "../../../../core/utils";
import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { logger } from "../../../../core/utils/logger";
import { QueryCallback } from "../types";
import { captureStackTrace } from "src/instrumentation/core/utils";

/**
 * Mock MySQL2 connection/pool connection for replay mode
 * Extends EventEmitter to properly handle all connection methods and events
 */
export class TdMysql2ConnectionMock extends EventEmitter {
  private mysql2Instrumentation: Mysql2Instrumentation;
  private clientType: "connection" | "pool" | "poolConnection"; // Add this property
  private spanInfo?: SpanInfo;

  // MySQL2 connection properties
  public threadId: number | null = null;
  public config: any = {
    host: "localhost",
    port: 3306,
    database: "mock",
    user: "mock",
  };

  constructor(
    mysql2Instrumentation: Mysql2Instrumentation,
    clientType: "connection" | "pool" | "poolConnection" = "poolConnection", // Add parameter with default
    spanInfo?: SpanInfo,
  ) {
    super();
    this.mysql2Instrumentation = mysql2Instrumentation;
    this.spanInfo = spanInfo;
    this.clientType = clientType; // Store the clientType
    this.threadId = 1;
  }

  query(...args: any[]) {
    logger.debug(`[TdMysql2ConnectionMock] Mock connection query intercepted in REPLAY mode`);

    const stackTrace = captureStackTrace(["TdMysql2ConnectionMock"]);

    // Parse query arguments similar to the main query patch
    const queryConfig = this.mysql2Instrumentation.parseQueryArgs(args);

    if (!queryConfig || !queryConfig.sql) {
      logger.debug(
        `[TdMysql2ConnectionMock] Could not parse mock connection query, returning empty result`,
      );
      const emptyResult = { rows: [], fields: [] };
      if (queryConfig?.callback) {
        process.nextTick(() => queryConfig.callback!(null, emptyResult.rows, emptyResult.fields));
        return;
      }
      return Promise.resolve([emptyResult.rows, emptyResult.fields]);
    }

    const rawInputValue = {
      sql: queryConfig.sql,
      values: queryConfig.values || [],
      clientType: this.clientType, // Use the stored clientType instead of hardcoded value
    };

    const inputValue = createMockInputValue(rawInputValue);

    if (this.spanInfo) {
      return this.mysql2Instrumentation.handleReplayQuery(
        queryConfig,
        inputValue,
        this.spanInfo,
        stackTrace,
      );
    } else {
      // Background query
      // Return an EventEmitter that immediately completes with empty results
      return this.mysql2Instrumentation.handleNoOpReplayQuery(queryConfig);
    }
  }

  execute(...args: any[]) {
    logger.debug(`[TdMysql2ConnectionMock] Mock connection execute intercepted in REPLAY mode`);

    const stackTrace = captureStackTrace(["TdMysql2ConnectionMock"]);

    // Parse execute arguments similar to the main execute patch
    const queryConfig = this.mysql2Instrumentation.parseQueryArgs(args);

    if (!queryConfig || !queryConfig.sql) {
      logger.debug(
        `[TdMysql2ConnectionMock] Could not parse mock connection execute, returning empty result`,
      );
      const emptyResult = { rows: [], fields: [] };
      if (queryConfig?.callback) {
        process.nextTick(() => queryConfig.callback!(null, emptyResult.rows, emptyResult.fields));
        return;
      }
      return Promise.resolve([emptyResult.rows, emptyResult.fields]);
    }

    const rawInputValue = {
      sql: queryConfig.sql,
      values: queryConfig.values || [],
      clientType: this.clientType, // Use the stored clientType instead of hardcoded value
    };

    const inputValue = createMockInputValue(rawInputValue);

    if (this.spanInfo) {
      return this.mysql2Instrumentation.handleReplayQuery(
        queryConfig,
        inputValue,
        this.spanInfo,
        stackTrace,
      );
    } else {
      // Background query
      // Return an EventEmitter that immediately completes with empty results
      return this.mysql2Instrumentation.handleNoOpReplayQuery(queryConfig);
    }
  }

  release() {
    // No-op for pool connection release - just emit end event to simulate normal behavior
    this.emit("end");
  }

  destroy() {
    // No-op for connection destroy
    this.emit("end");
  }

  end(callback?: QueryCallback) {
    this.emit("end");
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return Promise.resolve();
  }

  connect(callback?: QueryCallback) {
    // Mock connect - already connected
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return Promise.resolve();
  }

  ping(callback?: QueryCallback) {
    // Mock ping
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return Promise.resolve();
  }

  beginTransaction(callback?: QueryCallback) {
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return Promise.resolve();
  }

  commit(callback?: QueryCallback) {
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return Promise.resolve();
  }

  rollback(callback?: QueryCallback) {
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return Promise.resolve();
  }

  changeUser(options: any, callback?: QueryCallback) {
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return Promise.resolve();
  }

  pause() {
    // No-op
  }

  resume() {
    // No-op
  }

  escape(value: any): string {
    if (value === null || value === undefined) {
      return "NULL";
    }
    if (typeof value === "string") {
      return `'${value.replace(/'/g, "''")}'`;
    }
    if (typeof value === "number") {
      return value.toString();
    }
    if (typeof value === "boolean") {
      return value ? "1" : "0";
    }
    if (value instanceof Date) {
      return `'${value.toISOString()}'`;
    }
    return `'${String(value)}'`;
  }

  escapeId(identifier: string): string {
    return `\`${identifier.replace(/`/g, "``")}\``;
  }

  format(sql: string, values?: any[]): string {
    if (!values || values.length === 0) {
      return sql;
    }
    let index = 0;
    return sql.replace(/\?/g, () => {
      if (index >= values.length) {
        return "?";
      }
      return this.escape(values[index++]);
    });
  }
}
