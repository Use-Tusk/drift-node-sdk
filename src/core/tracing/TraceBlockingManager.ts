import { logger } from "../utils/logger";
import { OriginalGlobalUtils } from "../utils/OriginalGlobalUtils";

/**
 * Manages blocked trace IDs to prevent creation and export of spans
 * that belong to traces exceeding size limits.
 *
 * This class uses an in-memory Set for O(1) lookup performance and
 * automatically cleans up old entries to prevent memory leaks.
 */
export class TraceBlockingManager {
  private static instance: TraceBlockingManager | null = null;
  private blockedTraceIds: Set<string> = new Set();
  private traceTimestamps: Map<string, number> = new Map();
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  // Default TTL: 10 minutes (traces should complete well before this)
  private readonly DEFAULT_TTL_MS = 10 * 60 * 1000;

  // Cleanup interval: 2 minutes
  private readonly CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

  private constructor() {
    this.startCleanupInterval();
  }

  /**
   * Get singleton instance
   */
  static getInstance(): TraceBlockingManager {
    if (!TraceBlockingManager.instance) {
      TraceBlockingManager.instance = new TraceBlockingManager();
    }
    return TraceBlockingManager.instance;
  }

  /**
   * Check if a trace ID is blocked
   */
  isTraceBlocked(traceId: string): boolean {
    return this.blockedTraceIds.has(traceId);
  }

  /**
   * Block a trace ID and all future spans for this trace
   */
  blockTrace(traceId: string): void {
    if (!this.blockedTraceIds.has(traceId)) {
      this.blockedTraceIds.add(traceId);
      const originalDate = OriginalGlobalUtils.getOriginalDate();
      this.traceTimestamps.set(traceId, originalDate.getTime());
      logger.debug(`[TraceBlockingManager] Blocked trace: ${traceId}`);
    }
  }

  /**
   * Start periodic cleanup of old blocked trace IDs
   */
  private startCleanupInterval(): void {
    if (this.cleanupIntervalId) {
      return;
    }

    this.cleanupIntervalId = setInterval(() => {
      this.cleanupOldTraces();
    }, this.CLEANUP_INTERVAL_MS);

    // Don't keep the process alive just for cleanup
    if (this.cleanupIntervalId.unref) {
      this.cleanupIntervalId.unref();
    }
  }

  /**
   * Clean up trace IDs older than TTL
   */
  private cleanupOldTraces(): void {
    const originalDate = OriginalGlobalUtils.getOriginalDate();
    const now = originalDate.getTime();
    const expiredTraces: string[] = [];

    for (const [traceId, timestamp] of this.traceTimestamps.entries()) {
      if (now - timestamp > this.DEFAULT_TTL_MS) {
        expiredTraces.push(traceId);
      }
    }

    for (const traceId of expiredTraces) {
      this.blockedTraceIds.delete(traceId);
      this.traceTimestamps.delete(traceId);
    }

    if (expiredTraces.length > 0) {
      logger.debug(
        `[TraceBlockingManager] Cleaned up ${expiredTraces.length} expired blocked trace(s)`,
      );
    }
  }
}
