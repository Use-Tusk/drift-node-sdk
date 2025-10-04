import test from "ava";
import { SpanUtilsErrorTesting, ErrorType } from "../../../core/tracing/SpanUtils.test.helpers";
import { EnvInstrumentation } from "./Instrumentation";
import { TuskDriftMode } from "../../../core/TuskDrift";
import { TuskDriftCore } from "../../../core/TuskDrift";

let envInstrumentation: EnvInstrumentation;
let originalProcessEnv: typeof process.env;
let mockTuskDriftInstance: any;

test.before(() => {
  // Store original process.env before any patches
  originalProcessEnv = { ...process.env };
});

test.beforeEach(() => {
  // Restore original process.env
  process.env = { ...originalProcessEnv };

  // Mock TuskDrift instance to control isAppReady
  mockTuskDriftInstance = {
    isAppReady: () => true,
  } as any;

  // Note: Ava doesn't have jest.spyOn - using manual stub
  const originalGetInstance = TuskDriftCore.getInstance;
  (TuskDriftCore as any).getInstance = () => mockTuskDriftInstance;

  envInstrumentation = new EnvInstrumentation({
    mode: TuskDriftMode.RECORD,
  });

  // Initialize instrumentation which patches process.env
  envInstrumentation.init();

  // Set a test environment variable
  process.env.TEST_VAR = "test_value";
});

test.afterEach(() => {
  SpanUtilsErrorTesting.teardownErrorResilienceTest();
  // Restore original process.env
  process.env = originalProcessEnv;
});

test("Env Instrumentation - should return env vars when SpanUtils.getCurrentSpanInfo throws", (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
  });

  // Should still return the environment variable value despite the error
  const result = process.env.TEST_VAR;
  t.is(result, "test_value");
});

test("Env Instrumentation - should return env vars when SpanUtils.addSpanAttributes throws", (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span add span attributes network error",
  });

  const result = process.env.TEST_VAR;
  t.is(result, "test_value");
});

test("Env Instrumentation - should return env vars when SpanUtils.setStatus throws", (t) => {
  SpanUtilsErrorTesting.mockSetStatusWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set status network error",
  });

  // Should still return the environment variable value despite the error
  const result = process.env.TEST_VAR;
  t.is(result, "test_value");
});

test("Env Instrumentation - should return env vars when SpanUtils.endSpan throws", (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  // Should still return the environment variable value despite the error
  const result = process.env.TEST_VAR;
  t.is(result, "test_value");
});

test("Env Instrumentation - should return env vars when SpanUtils.getCurrentTraceId throws", (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  // Should still return the environment variable value despite the error
  const result = process.env.TEST_VAR;
  t.is(result, "test_value");
});

test("Env Instrumentation - should return env vars when SpanUtils.setCurrentReplayTraceId throws", (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  // Should still return the environment variable value despite the error
  const result = process.env.TEST_VAR;
  t.is(result, "test_value");
});
