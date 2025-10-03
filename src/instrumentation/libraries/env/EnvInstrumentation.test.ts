import { SpanUtilsErrorTesting, ErrorType } from "../../../core/tracing/SpanUtils.test.helpers";
import { EnvInstrumentation } from "./Instrumentation";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { TuskDriftCore } from "../../../core/TuskDrift";

describe("Env Instrumentation Error Resilience", () => {
  let envInstrumentation: EnvInstrumentation;
  let originalProcessEnv: typeof process.env;
  let mockTuskDriftInstance: jest.Mocked<TuskDriftCore>;

  beforeAll(() => {
    // Store original process.env before any patches
    originalProcessEnv = { ...process.env };
  });

  beforeEach(() => {
    // Restore original process.env
    process.env = { ...originalProcessEnv };

    // Mock TuskDrift instance to control isAppReady
    mockTuskDriftInstance = {
      isAppReady: jest.fn().mockReturnValue(true),
    } as any;

    jest.spyOn(TuskDriftCore, "getInstance").mockReturnValue(mockTuskDriftInstance);

    envInstrumentation = new EnvInstrumentation({
      mode: TuskDriftMode.RECORD,
    });

    // Initialize instrumentation which patches process.env
    envInstrumentation.init();

    // Set a test environment variable
    process.env.TEST_VAR = "test_value";
  });

  afterEach(() => {
    SpanUtilsErrorTesting.teardownErrorResilienceTest();
    // Restore original process.env
    process.env = originalProcessEnv;
    jest.restoreAllMocks();
  });

  describe("Environment Variable Access Error Resilience", () => {
    it("should return env vars when SpanUtils.getCurrentSpanInfo throws", () => {
      SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span get current span info network error",
      });

      // Should still return the environment variable value despite the error
      const result = process.env.TEST_VAR;
      expect(result).toBe("test_value");
    });

    it("should return env vars when SpanUtils.addSpanAttributes throws", () => {
      SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span add span attributes network error",
      });
    });

    it("should return env vars when SpanUtils.setStatus throws", () => {
      SpanUtilsErrorTesting.mockSetStatusWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span set status network error",
      });

      // Should still return the environment variable value despite the error
      const result = process.env.TEST_VAR;
      expect(result).toBe("test_value");
    });

    it("should return env vars when SpanUtils.endSpan throws", () => {
      SpanUtilsErrorTesting.mockEndSpanWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span end span network error",
      });

      // Should still return the environment variable value despite the error
      const result = process.env.TEST_VAR;
      expect(result).toBe("test_value");
    });

    it("should return env vars when SpanUtils.getCurrentTraceId throws", () => {
      SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span get current trace id network error",
      });

      // Should still return the environment variable value despite the error
      const result = process.env.TEST_VAR;
      expect(result).toBe("test_value");
    });
    it("should return env vars when SpanUtils.setCurrentReplayTraceId throws", () => {
      SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
        errorType: ErrorType.NETWORK_ERROR,
        errorMessage: "Span set current replay trace id network error",
      });

      // Should still return the environment variable value despite the error
      const result = process.env.TEST_VAR;
      expect(result).toBe("test_value");
    });
  });
});
