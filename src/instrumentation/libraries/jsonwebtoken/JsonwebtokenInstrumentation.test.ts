import test from "ava";
import { SpanUtilsErrorTesting, ErrorType } from "../../../core/tracing/SpanUtils.test.helpers";
import { JsonwebtokenInstrumentation } from "./Instrumentation";
import { TuskDriftMode } from "../../../core/TuskDrift";

// Mock jsonwebtoken module
const mockJsonwebtokenModule = {
  sign: (payload: any, secret: string, options?: any, callback?: Function): any => {
    if (callback) {
      // Async version with callback
      process.nextTick(() => {
        callback(null, "mocked.jwt.token");
      });
      return;
    } else {
      // Sync version
      return "mocked.jwt.token";
    }
  },
  verify: (token: string, secret: string, options?: any, callback?: Function): any => {
    if (callback) {
      // Async version with callback
      process.nextTick(() => {
        callback(null, { userId: 123, exp: Date.now() / 1000 + 3600 });
      });
      return;
    } else {
      // Sync version
      return { userId: 123, exp: Date.now() / 1000 + 3600 };
    }
  },
  JsonWebTokenError: class MockJwtError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "JsonWebTokenError";
    }
  },
  TokenExpiredError: class MockTokenExpiredError extends Error {
    expiredAt: Date;
    constructor(message: string, expiredAt: Date) {
      super(message);
      this.name = "TokenExpiredError";
      this.expiredAt = expiredAt;
    }
  },
  NotBeforeError: class MockNotBeforeError extends Error {
    date: Date;
    constructor(message: string, date: Date) {
      super(message);
      this.name = "NotBeforeError";
      this.date = date;
    }
  },
};

// Test payload and secrets
const testPayload = { userId: 123, role: "user" };
const testSecret = "test-secret";
const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token";

// Helper function to execute JWT sign operations
function executeJwtSign(
  signType: "sync" | "async",
  payload: any = testPayload,
  secret: string = testSecret,
  options?: any,
): any {
  if (signType === "sync") {
    return mockJsonwebtokenModule.sign(payload, secret, options);
  } else {
    return new Promise((resolve, reject) => {
      mockJsonwebtokenModule.sign(
        payload,
        secret,
        options,
        (error: Error | null, token?: string) => {
          if (error) reject(error);
          else resolve(token);
        },
      );
    });
  }
}

// Helper function to execute JWT verify operations
function executeJwtVerify(
  verifyType: "sync" | "async",
  token: string = testToken,
  secret: string = testSecret,
  options?: any,
): any {
  if (verifyType === "sync") {
    return mockJsonwebtokenModule.verify(token, secret, options);
  } else {
    return new Promise((resolve, reject) => {
      mockJsonwebtokenModule.verify(
        token,
        secret,
        options,
        (error: Error | null, decoded?: any) => {
          if (error) reject(error);
          else resolve(decoded);
        },
      );
    });
  }
}

let jsonwebtokenInstrumentation: JsonwebtokenInstrumentation;
let originalSign: any;
let originalVerify: any;

test.before(() => {
  // Store original functions once
  originalSign = mockJsonwebtokenModule.sign;
  originalVerify = mockJsonwebtokenModule.verify;

  jsonwebtokenInstrumentation = new JsonwebtokenInstrumentation({
    mode: TuskDriftMode.RECORD,
  });

  // Initialize instrumentation which patches the modules
  const modules = jsonwebtokenInstrumentation.init();

  // Apply patches to our mock modules
  modules.forEach((module) => {
    if (module.name === "jsonwebtoken" && module.patch) {
      module.patch(mockJsonwebtokenModule);
    }
  });
});

test.afterEach(() => {
  SpanUtilsErrorTesting.teardownErrorResilienceTest();
});

test.after(() => {
  // Restore original functions
  mockJsonwebtokenModule.sign = originalSign;
  mockJsonwebtokenModule.verify = originalVerify;
});

// JWT Sign Error Resilience
test("should complete JWT sign (sync) when SpanUtils.createSpan throws", (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = executeJwtSign("sync");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (async) when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executeJwtSign("async");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (sync) when SpanUtils.addSpanAttributes throws", (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = executeJwtSign("sync");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (async) when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = await executeJwtSign("async");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (sync) when SpanUtils.setStatus throws", (t) => {
  SpanUtilsErrorTesting.mockSetStatusWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set status network error",
  });

  const result = executeJwtSign("sync");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (async) when SpanUtils.setStatus throws", async (t) => {
  SpanUtilsErrorTesting.mockSetStatusWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set status network error",
  });

  const result = await executeJwtSign("async");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (sync) when SpanUtils.endSpan throws", (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const result = executeJwtSign("sync");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (async) when SpanUtils.endSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const result = await executeJwtSign("async");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (sync) when SpanUtils.getCurrentSpanInfo throws", (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
  });

  const result = executeJwtSign("sync");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (async) when SpanUtils.getCurrentSpanInfo throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
  });

  const result = await executeJwtSign("async");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (sync) when SpanUtils.getCurrentTraceId throws", (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const result = executeJwtSign("sync");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (async) when SpanUtils.getCurrentTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const result = await executeJwtSign("async");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (sync) when SpanUtils.setCurrentReplayTraceId throws", (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const result = executeJwtSign("sync");
  t.is(result, "mocked.jwt.token");
});

test("should complete JWT sign (async) when SpanUtils.setCurrentReplayTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const result = await executeJwtSign("async");
  t.is(result, "mocked.jwt.token");
});

// JWT Verify Error Resilience
test("should complete JWT verify (sync) when SpanUtils.createSpan throws", (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = executeJwtVerify("sync");
  t.is(result.userId, 123);
});

test("should complete JWT verify (async) when SpanUtils.createSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockCreateSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span create span network error",
  });

  const result = await executeJwtVerify("async");
  t.is(result.userId, 123);
});

test("should complete JWT verify (sync) when SpanUtils.addSpanAttributes throws", (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = executeJwtVerify("sync");
  t.is(result.userId, 123);
});

test("should complete JWT verify (async) when SpanUtils.addSpanAttributes throws", async (t) => {
  SpanUtilsErrorTesting.mockAddSpanAttributesWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span attributes network error",
  });

  const result = await executeJwtVerify("async");
  t.is(result.userId, 123);
});

test("should complete JWT verify (sync) when SpanUtils.setStatus throws", (t) => {
  SpanUtilsErrorTesting.mockSetStatusWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set status network error",
  });

  const result = executeJwtVerify("sync");
  t.is(result.userId, 123);
});

test("should complete JWT verify (async) when SpanUtils.setStatus throws", async (t) => {
  SpanUtilsErrorTesting.mockSetStatusWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set status network error",
  });

  const result = await executeJwtVerify("async");
  t.is(result.userId, 123);
});

test("should complete JWT verify (sync) when SpanUtils.endSpan throws", (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const result = executeJwtVerify("sync");
  t.is(result.userId, 123);
});

test("should complete JWT verify (async) when SpanUtils.endSpan throws", async (t) => {
  SpanUtilsErrorTesting.mockEndSpanWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span end span network error",
  });

  const result = await executeJwtVerify("async");
  t.is(result.userId, 123);
});

test("should complete JWT verify (sync) when SpanUtils.getCurrentSpanInfo throws", (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
  });

  const result = executeJwtVerify("sync");
  t.is(result.userId, 123);
});

test("should complete JWT verify (async) when SpanUtils.getCurrentSpanInfo throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentSpanInfoWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current span info network error",
  });

  const result = await executeJwtVerify("async");
  t.is(result.userId, 123);
});

test("should complete JWT verify (sync) when SpanUtils.getCurrentTraceId throws", (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const result = executeJwtVerify("sync");
  t.is(result.userId, 123);
});

test("should complete JWT verify (async) when SpanUtils.getCurrentTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockGetCurrentTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span get current trace id network error",
  });

  const result = await executeJwtVerify("async");
  t.is(result.userId, 123);
});

test("should complete JWT verify (sync) when SpanUtils.setCurrentReplayTraceId throws", (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const result = executeJwtVerify("sync");
  t.is(result.userId, 123);
});

test("should complete JWT verify (async) when SpanUtils.setCurrentReplayTraceId throws", async (t) => {
  SpanUtilsErrorTesting.mockSetCurrentReplayTraceIdWithError({
    errorType: ErrorType.NETWORK_ERROR,
    errorMessage: "Span set current replay trace id network error",
  });

  const result = await executeJwtVerify("async");
  t.is(result.userId, 123);
});
