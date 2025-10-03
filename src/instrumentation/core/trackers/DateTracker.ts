import { SpanUtils } from "../../../core/tracing/SpanUtils";
import { logger } from "../../../core/utils/logger";

/**
 * Global date tracker that maintains the latest mock response timestamp per trace.
 * This is used to provide consistent dates in replay mode.
 */
export class DateTracker {
  private static traceToLatestTimestamp = new Map<string, Date>();

  /**
   * Updates the latest timestamp for a given trace ID
   */
  static updateLatestTimestamp(traceId: string, timestamp: string | number): void {
    const date = new Date(timestamp);
    this.traceToLatestTimestamp.set(traceId, date);
    logger.debug(`Updated latest timestamp for trace ${traceId}: ${date.toISOString()}`);
  }

  /**
   * Gets the latest timestamp for the current trace
   */
  static getCurrentTraceLatestDate(): Date | null {
    const replayTraceId = SpanUtils.getCurrentReplayTraceId();
    if (!replayTraceId) {
      return null;
    }

    return this.traceToLatestTimestamp.get(replayTraceId) || null;
  }

  /**
   * Clears the timestamp for a given trace ID (useful for cleanup)
   */
  static clearTrace(traceId: string): void {
    this.traceToLatestTimestamp.delete(traceId);
  }

  /**
   * Clears all tracked timestamps (useful for testing)
   */
  static clearAll(): void {
    this.traceToLatestTimestamp.clear();
  }
}
