import { EventEmitter } from "events";
import { PgInstrumentation } from "../Instrumentation";
import { createMockInputValue } from "../../../../core/utils";
import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { logger } from "../../../../core/utils/logger";

/**
 * Mock PostgreSQL client for replay mode
 * Extends EventEmitter to properly handle all client methods and events
 */
export class TdPgClientMock extends EventEmitter {
  private pgInstrumentation: PgInstrumentation;
  private spanInfo: SpanInfo;

  constructor(pgInstrumentation: PgInstrumentation, spanInfo: SpanInfo) {
    super();
    this.pgInstrumentation = pgInstrumentation;
    this.spanInfo = spanInfo;
  }

  query(...args: any[]) {
    logger.debug(`[TdPgClientMock] Mock pool client query intercepted in REPLAY mode`);

    // Parse query arguments similar to the main query patch
    const queryConfig = this.pgInstrumentation.parseQueryArgs(args);

    if (!queryConfig || !queryConfig.text) {
      logger.debug(`[TdPgClientMock] Could not parse mock client query, returning empty result`);
      return Promise.resolve({ rows: [], rowCount: 0 });
    }

    const rawInputValue = {
      text: queryConfig.text,
      values: queryConfig.values || [],
      clientType: "client",
    };

    const inputValue = createMockInputValue(rawInputValue);

    return this.pgInstrumentation.handleReplayQuery(queryConfig, inputValue, this.spanInfo);
  }

  release() {
    // No-op for pool client release - just emit end event to simulate normal behavior
    this.emit("end");
  }

  end() {
    this.emit("end");
    return Promise.resolve();
  }

  connect(callback?: Function) {
    // Mock connect - already connected
    if (callback) {
      process.nextTick(() => callback(null));
      return;
    }
    return Promise.resolve();
  }

  // Additional pg Client properties and methods that might be expected by ORMs
  get connectionParameters() {
    return {
      host: "localhost",
      port: 5432,
      database: "mock",
      user: "mock",
    };
  }

  get readyForQuery() {
    return true;
  }

  get processID() {
    return 12345;
  }

  get secretKey() {
    return 67890;
  }

  get activeQuery() {
    return false;
  }

  pauseDrain() {
    // No-op
  }

  resumeDrain() {
    // No-op
  }

  escapeIdentifier(str: string) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  escapeLiteral(str: string) {
    return `'${str.replace(/'/g, "''")}'`;
  }
}
