import { SpanUtils } from "./SpanUtils";
import { logger } from "../utils/logger";
import type { LogLevel } from "../utils/logger";

// This file contains a bunch of SpanUtils mocking and general utility method
// for testing.

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
  createSpan?: jest.SpyInstance;
  getCurrentSpanInfo?: jest.SpyInstance;
  addSpanAttributes?: jest.SpyInstance;
  setStatus?: jest.SpyInstance;
  endSpan?: jest.SpyInstance;
  getCurrentTraceId?: jest.SpyInstance;
  getCurrentSpanId?: jest.SpyInstance;
  getTraceInfo?: jest.SpyInstance;
  setCurrentReplayTraceId?: jest.SpyInstance;
}

/**
 * Shared utility class for testing SpanUtils error resilience
 */
export class SpanUtilsErrorTesting {
  private static mocks: SpanUtilsMocks = {};
  private static originalLogLevel: LogLevel | null = null;
  private static loggerSilenced = false;

  private static ensureLoggerSilenced(): void {
    if (!SpanUtilsErrorTesting.loggerSilenced) {
      SpanUtilsErrorTesting.originalLogLevel = logger.getLogLevel();
      logger.setLogLevel("silent");
      SpanUtilsErrorTesting.loggerSilenced = true;
    }
  }

  private static restoreLogger(): void {
    if (SpanUtilsErrorTesting.loggerSilenced) {
      const previousLevel = SpanUtilsErrorTesting.originalLogLevel || "warn";
      logger.setLogLevel(previousLevel);
      SpanUtilsErrorTesting.originalLogLevel = null;
      SpanUtilsErrorTesting.loggerSilenced = false;
    }
  }

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
  static mockCreateSpanWithError(config: ErrorTestConfig): jest.SpyInstance {
    SpanUtilsErrorTesting.ensureLoggerSilenced();
    const spy = jest.spyOn(SpanUtils, "createSpan");

    spy.mockImplementation(() => {
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
    });

    SpanUtilsErrorTesting.mocks.createSpan = spy;
    return spy;
  }
  /**
   * Sets up error simulation for SpanUtils.addSpanAttributes
   */
  static mockAddSpanAttributesWithError(config: ErrorTestConfig): jest.SpyInstance {
    SpanUtilsErrorTesting.ensureLoggerSilenced();
    const spy = jest.spyOn(SpanUtils, "addSpanAttributes");

    spy.mockImplementation(() => {
      throw SpanUtilsErrorTesting.createError(config);
    });

    SpanUtilsErrorTesting.mocks.addSpanAttributes = spy;
    return spy;
  }

  /**
   * Sets up error simulation for SpanUtils.setStatus
   */
  static mockSetStatusWithError(config: ErrorTestConfig): jest.SpyInstance {
    SpanUtilsErrorTesting.ensureLoggerSilenced();
    const spy = jest.spyOn(SpanUtils, "setStatus");

    spy.mockImplementation(() => {
      throw SpanUtilsErrorTesting.createError(config);
    });

    SpanUtilsErrorTesting.mocks.setStatus = spy;
    return spy;
  }

  /**
   * Sets up error simulation for SpanUtils.endSpan
   */
  static mockEndSpanWithError(config: ErrorTestConfig): jest.SpyInstance {
    SpanUtilsErrorTesting.ensureLoggerSilenced();
    const spy = jest.spyOn(SpanUtils, "endSpan");

    spy.mockImplementation(() => {
      throw SpanUtilsErrorTesting.createError(config);
    });

    SpanUtilsErrorTesting.mocks.endSpan = spy;
    return spy;
  }

  /**
   * Sets up error simulation for SpanUtils.getCurrentSpanInfo
   */
  static mockGetCurrentSpanInfoWithError(config: ErrorTestConfig): jest.SpyInstance {
    SpanUtilsErrorTesting.ensureLoggerSilenced();
    const spy = jest.spyOn(SpanUtils, "getCurrentSpanInfo");

    spy.mockImplementation(() => {
      if (config.shouldReturnNull) {
        return null;
      }
      throw SpanUtilsErrorTesting.createError(config);
    });

    SpanUtilsErrorTesting.mocks.getCurrentSpanInfo = spy;
    return spy;
  }

  /**
   * Sets up error simulation for SpanUtils.getCurrentTraceId
   */
  static mockGetCurrentTraceIdWithError(config: ErrorTestConfig): jest.SpyInstance {
    SpanUtilsErrorTesting.ensureLoggerSilenced();
    const spy = jest.spyOn(SpanUtils, "getCurrentTraceId");

    spy.mockImplementation(() => {
      if (config.shouldReturnNull) {
        return null;
      }
      throw SpanUtilsErrorTesting.createError(config);
    });

    SpanUtilsErrorTesting.mocks.getCurrentTraceId = spy;
    return spy;
  }

  /**
   * Sets up error simulation for SpanUtils.setCurrentReplayTraceId
   */
  static mockSetCurrentReplayTraceIdWithError(config: ErrorTestConfig): jest.SpyInstance {
    SpanUtilsErrorTesting.ensureLoggerSilenced();
    const spy = jest.spyOn(SpanUtils, "setCurrentReplayTraceId");
    spy.mockImplementation(() => {
      throw SpanUtilsErrorTesting.createError(config);
    });

    SpanUtilsErrorTesting.mocks.setCurrentReplayTraceId = spy;
    return spy;
  }

  /**
   * Restores all mocked SpanUtils methods
   */
  static restoreAllMocks(): void {
    Object.values(SpanUtilsErrorTesting.mocks).forEach((mock) => {
      if (mock && typeof mock.mockRestore === "function") {
        mock.mockRestore();
      }
    });

    SpanUtilsErrorTesting.mocks = {};
    jest.restoreAllMocks();
    SpanUtilsErrorTesting.restoreLogger();
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
