import { EventEmitter } from "events";
import { MysqlInstrumentation } from "../Instrumentation";
import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { logger } from "../../../../core/utils/logger";
import { MysqlQueryInputValue } from "../types";

/**
 * Mock MySQL connection/pool connection for replay mode
 * Extends EventEmitter to properly handle all connection methods and events
 */
export class TdMysqlConnectionMock extends EventEmitter {
  private mysqlInstrumentation: MysqlInstrumentation;
  private clientType: "connection" | "pool" | "poolConnection";
  private spanInfo?: SpanInfo;
  private _pool: any = null;

  // MySQL connection properties
  public threadId: number | null = null;
  public config: any = {
    host: "localhost",
    port: 3306,
    database: "mock",
    user: "mock",
  };

  constructor(
    mysqlInstrumentation: MysqlInstrumentation,
    clientType: "connection" | "pool" | "poolConnection" = "poolConnection",
    spanInfo?: SpanInfo,
    pool?: any,
  ) {
    super();
    this.mysqlInstrumentation = mysqlInstrumentation;
    this.spanInfo = spanInfo;
    this.clientType = clientType;
    this.threadId = 1;
    this._pool = pool;
  }

  query(...args: any[]) {
    logger.debug(`[TdMysqlConnectionMock] Mock connection query intercepted in REPLAY mode`);

    // Parse query arguments - MySQL supports multiple signatures:
    // query(sql, callback)
    // query(sql, values, callback)
    // query(options, callback)
    // query(options, values, callback)

    let sql: string;
    let values: any[] | undefined;
    let callback: Function | undefined;
    let options: any = {};

    // Determine which signature is being used
    if (typeof args[0] === "string") {
      sql = args[0];
      if (typeof args[1] === "function") {
        callback = args[1];
      } else if (Array.isArray(args[1])) {
        values = args[1];
        callback = args[2] as Function | undefined;
      }
    } else if (typeof args[0] === "object") {
      options = args[0];
      sql = options.sql;
      values = options.values;
      if (typeof args[1] === "function") {
        callback = args[1];
      } else if (Array.isArray(args[1])) {
        values = args[1];
        callback = args[2] as Function | undefined;
      }
    } else {
      // Unknown signature
      logger.debug(
        `[TdMysqlConnectionMock] Could not parse mock connection query, returning empty result`,
      );
      const emptyResult: any = { rows: [], fields: [] };
      if (callback) {
        process.nextTick(() => callback!(null, emptyResult.rows, emptyResult.fields));
        return;
      }
      return new EventEmitter();
    }

    const inputValue: MysqlQueryInputValue = {
      sql: sql,
      values: values,
      options: options.nestTables ? { nestTables: options.nestTables } : undefined,
    };

    if (this.spanInfo) {
      // This is part of a traced operation (e.g., from pool.getConnection)
      // Delegate to the instrumentation's replay handler
      return this.mysqlInstrumentation.handleReplayQueryFromMock(
        this.spanInfo,
        inputValue,
        callback,
      );
    } else {
      // Background query - return empty result
      const emptyResult: any = { rows: [], fields: [] };
      if (callback) {
        process.nextTick(() => callback(null, emptyResult.rows, emptyResult.fields));
        return;
      }
      const emitter = new EventEmitter();
      setImmediate(() => {
        emitter.emit("fields", [], 0);
        emitter.emit("end");
      });
      return emitter;
    }
  }

  release() {
    // Emit 'release' event on the pool if we have a reference
    if (this._pool) {
      this._pool.emit("release", this);
    }
    this.emit("end");
  }

  destroy() {
    // No-op for connection destroy
    this.emit("end");
  }

  end(callback?: Function) {
    this.emit("end");
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return undefined;
  }

  connect(callback?: Function) {
    // Mock connect - already connected
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return undefined;
  }

  ping(callback?: Function) {
    // Mock ping
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return undefined;
  }

  beginTransaction(callback?: Function) {
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return undefined;
  }

  commit(callback?: Function) {
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return undefined;
  }

  rollback(callback?: Function) {
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return undefined;
  }

  changeUser(options: any, callback?: Function) {
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return undefined;
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
