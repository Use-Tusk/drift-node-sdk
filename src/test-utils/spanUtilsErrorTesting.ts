import { SpanUtils } from "../core/tracing/SpanUtils";

/**
 * Types of errors to simulate in SpanUtils methods
 */
export enum ErrorType {
  SYNC_ERROR = "SYNC_ERROR",
  ASYNC_ERROR = "ASYNC_ERROR",
  TIMEOUT_ERROR = "TIMEOUT_ERROR",
  MEMORY_ERROR = "MEMORY_ERROR",
  NETWORK_ERROR = "NETWORK_ERROR",
  VALIDATION_ERROR = "VALIDATION_ERROR",
}

/**
 * Configuration for SpanUtils error simulation
 */
export interface ErrorTestConfig {
  errorType: ErrorType;
  errorMessage?: string;
  shouldReturnNull?: boolean;
  delayMs?: number;
}

/**
 * Mock implementation registry for SpanUtils methods
 */
interface SpanUtilsMocks {
  createSpan?: { original: any };
  getCurrentSpanInfo?: { original: any };
  addSpanAttributes?: { original: any };
  setStatus?: { original: any };
  endSpan?: { original: any };
  getCurrentTraceId?: { original: any };
  getCurrentSpanId?: { original: any };
  getTraceInfo?: { original: any };
  setCurrentReplayTraceId?: { original: any };
}

/**
 * Shared utility class for testing SpanUtils error resilience
 */
export class SpanUtilsErrorTesting {
  private static mocks: SpanUtilsMocks = {};

  /**
   * Creates an error based on the specified type
   */
  static createError(config: ErrorTestConfig): Error {
    const message = config.errorMessage || `Simulated ${config.errorType}`;

    switch (config.errorType) {
      case ErrorType.NETWORK_ERROR:
        const networkError = new Error(message);
        (networkError as any).code = "ECONNREFUSED";
        return networkError;

      case ErrorType.TIMEOUT_ERROR:
        const timeoutError = new Error(message);
        (timeoutError as any).code = "ETIMEDOUT";
        return timeoutError;

      case ErrorType.MEMORY_ERROR:
        const memoryError = new Error(message);
        (memoryError as any).code = "ENOMEM";
        return memoryError;

      case ErrorType.VALIDATION_ERROR:
        const validationError = new Error(message);
        (validationError as any).name = "ValidationError";
        return validationError;

      case ErrorType.ASYNC_ERROR:
      case ErrorType.SYNC_ERROR:
      default:
        return new Error(message);
    }
  }

  /**
   * Sets up error simulation for SpanUtils.createSpan
   */
  static mockCreateSpanWithError(config: ErrorTestConfig): void {
    const original = SpanUtils.createSpan;

    (SpanUtils as any).createSpan = () => {
      if (config.shouldReturnNull) {
        return null;
      }

      if (config.errorType === ErrorType.ASYNC_ERROR && config.delayMs) {
        // For async errors with delay, we still throw synchronously
        // but can simulate the delay in a different way if needed
        setTimeout(() => {
          console.error("Delayed error simulation:", SpanUtilsErrorTesting.createError(config));
        }, config.delayMs);
      }

      throw SpanUtilsErrorTesting.createError(config);
    };

    SpanUtilsErrorTesting.mocks.createSpan = { original };
  }

  /**
   * Sets up error simulation for SpanUtils.addSpanAttributes
   */
  static mockAddSpanAttributesWithError(config: ErrorTestConfig): void {
    const original = SpanUtils.addSpanAttributes;

    (SpanUtils as any).addSpanAttributes = () => {
      throw SpanUtilsErrorTesting.createError(config);
    };

    SpanUtilsErrorTesting.mocks.addSpanAttributes = { original };
  }

  /**
   * Sets up error simulation for SpanUtils.setStatus
   */
  static mockSetStatusWithError(config: ErrorTestConfig): void {
    const original = SpanUtils.setStatus;

    (SpanUtils as any).setStatus = () => {
      throw SpanUtilsErrorTesting.createError(config);
    };

    SpanUtilsErrorTesting.mocks.setStatus = { original };
  }

  /**
   * Sets up error simulation for SpanUtils.endSpan
   */
  static mockEndSpanWithError(config: ErrorTestConfig): void {
    const original = SpanUtils.endSpan;

    (SpanUtils as any).endSpan = () => {
      throw SpanUtilsErrorTesting.createError(config);
    };

    SpanUtilsErrorTesting.mocks.endSpan = { original };
  }

  /**
   * Sets up error simulation for SpanUtils.getCurrentSpanInfo
   */
  static mockGetCurrentSpanInfoWithError(config: ErrorTestConfig): void {
    const original = SpanUtils.getCurrentSpanInfo;

    (SpanUtils as any).getCurrentSpanInfo = () => {
      if (config.shouldReturnNull) {
        return null;
      }
      throw SpanUtilsErrorTesting.createError(config);
    };

    SpanUtilsErrorTesting.mocks.getCurrentSpanInfo = { original };
  }

  /**
   * Sets up error simulation for SpanUtils.getCurrentTraceId
   */
  static mockGetCurrentTraceIdWithError(config: ErrorTestConfig): void {
    const original = SpanUtils.getCurrentTraceId;

    (SpanUtils as any).getCurrentTraceId = () => {
      if (config.shouldReturnNull) {
        return null;
      }
      throw SpanUtilsErrorTesting.createError(config);
    };

    SpanUtilsErrorTesting.mocks.getCurrentTraceId = { original };
  }

  /**
   * Sets up error simulation for SpanUtils.setCurrentReplayTraceId
   */
  static mockSetCurrentReplayTraceIdWithError(config: ErrorTestConfig): void {
    const original = SpanUtils.setCurrentReplayTraceId;

    (SpanUtils as any).setCurrentReplayTraceId = () => {
      throw SpanUtilsErrorTesting.createError(config);
    };

    SpanUtilsErrorTesting.mocks.setCurrentReplayTraceId = { original };
  }

  /**
   * Restores all mocked SpanUtils methods
   */
  static restoreAllMocks(): void {
    // Restore all mocked methods
    if (SpanUtilsErrorTesting.mocks.createSpan) {
      (SpanUtils as any).createSpan = SpanUtilsErrorTesting.mocks.createSpan.original;
    }
    if (SpanUtilsErrorTesting.mocks.addSpanAttributes) {
      (SpanUtils as any).addSpanAttributes = SpanUtilsErrorTesting.mocks.addSpanAttributes.original;
    }
    if (SpanUtilsErrorTesting.mocks.setStatus) {
      (SpanUtils as any).setStatus = SpanUtilsErrorTesting.mocks.setStatus.original;
    }
    if (SpanUtilsErrorTesting.mocks.endSpan) {
      (SpanUtils as any).endSpan = SpanUtilsErrorTesting.mocks.endSpan.original;
    }
    if (SpanUtilsErrorTesting.mocks.getCurrentSpanInfo) {
      (SpanUtils as any).getCurrentSpanInfo = SpanUtilsErrorTesting.mocks.getCurrentSpanInfo.original;
    }
    if (SpanUtilsErrorTesting.mocks.getCurrentTraceId) {
      (SpanUtils as any).getCurrentTraceId = SpanUtilsErrorTesting.mocks.getCurrentTraceId.original;
    }
    if (SpanUtilsErrorTesting.mocks.setCurrentReplayTraceId) {
      (SpanUtils as any).setCurrentReplayTraceId = SpanUtilsErrorTesting.mocks.setCurrentReplayTraceId.original;
    }

    SpanUtilsErrorTesting.mocks = {};
  }

  /**
   * Common test teardown for instrumentation error resilience tests
   */
  static teardownErrorResilienceTest(): void {
    SpanUtilsErrorTesting.restoreAllMocks();

    // Restore original environment variable
    const originalEnv = (SpanUtilsErrorTesting as any).originalTuskDriftMode;
    if (originalEnv !== undefined) {
      process.env.TUSK_DRIFT_MODE = originalEnv;
    } else {
      delete process.env.TUSK_DRIFT_MODE;
    }
  }
}
