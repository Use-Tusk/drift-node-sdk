import { SpanKind } from "@opentelemetry/api";
import { SpanInfo } from "../../../../core/tracing/SpanUtils";
import { TuskDriftCore } from "../../../../core/TuskDrift";
import { findMockResponseAsync } from "../../../core/utils/mockResponseUtils";
import { logger } from "../../../../core/utils/logger";

/**
 * Mock for MySQL2 connection events (connect/error)
 * Handles replay of recorded connection establishment events in REPLAY mode
 * Recording happens through normal SpanUtils flow in RECORD mode
 */
export class TdMysql2ConnectionEventMock {
  private readonly INSTRUMENTATION_NAME = "Mysql2Instrumentation";
  private spanInfo: SpanInfo;
  private tuskDrift: TuskDriftCore;

  constructor(spanInfo: SpanInfo) {
    this.spanInfo = spanInfo;
    this.tuskDrift = TuskDriftCore.getInstance();
  }

  /**
   * Get recorded connection event for replay
   * Returns { output } for success, or throws error if connection failed
   * The connection events are recorded automatically via SpanUtils in record mode
   */
  async getReplayedConnectionEvent(inputValue: any): Promise<{ output?: any }> {
    logger.debug(`[TdMysql2ConnectionEventMock] Retrieving recorded connection event`);

    try {
      const mockData = await findMockResponseAsync({
        mockRequestData: {
          traceId: this.spanInfo.traceId,
          spanId: this.spanInfo.spanId,
          name: "mysql2.connection.create",
          inputValue,
          packageName: "mysql2",
          instrumentationName: this.INSTRUMENTATION_NAME,
          submoduleName: "connectEvent",
          kind: SpanKind.CLIENT,
        },
        tuskDrift: this.tuskDrift,
      });

      if (!mockData) {
        logger.warn(`[TdMysql2ConnectionEventMock] No mock data found, using default success`);
        return { output: {} };
      }

      // Return the recorded connection result
      return {
        output: mockData.result || {},
      };
    } catch (error) {
      logger.error(`[TdMysql2ConnectionEventMock] Error getting replay value:`, error);
      // Return empty success event as fallback
      return { output: {} };
    }
  }
}
