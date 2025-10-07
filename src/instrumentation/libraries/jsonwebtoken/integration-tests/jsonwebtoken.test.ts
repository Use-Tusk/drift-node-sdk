process.env.TUSK_DRIFT_MODE = "RECORD";

import test from "ava";
import { TuskDrift } from "../../../../core/TuskDrift";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";

TuskDrift.initialize({
  apiKey: "test-api-key-jsonwebtoken",
  env: "test",
  logLevel: "debug",
});

const spanAdapter = new InMemorySpanAdapter();
registerInMemoryAdapter(spanAdapter);

TuskDrift.markAppAsReady();

import { CleanSpanData } from "../../../../core/types";
import { JwtSignInputValue, JwtVerifyInputValue } from "../types";
import { SpanKind } from "@opentelemetry/api";
import { SpanUtils } from "../../../../core/tracing/SpanUtils";
import { TuskDriftMode } from "../../../../core/TuskDrift";

// TODO: This does not work with import.
const jwt = require("jsonwebtoken");

const TEST_SECRET = "test-secret-key-for-jwt-testing-12345";

async function sleep(timeoutMs: number = 2500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

/** These tests don't have a server to create a root span. Create one manually.
 * TODO: implement a server like thing, refer to
 * src/instrumentation/libraries/http/integration-tests/small.test.ts
 * */
function withRootSpan<T>(fn: () => T): T {
  return SpanUtils.createAndExecuteSpan(
    TuskDriftMode.RECORD,
    fn,
    {
      name: "test-root-span",
      kind: SpanKind.SERVER,
      packageName: "test",
      instrumentationName: "TestInstrumentation",
      submodule: "test",
      inputValue: {},
      isPreAppStart: false,
    },
    (_spanInfo) => fn(),
  );
}

let validToken: string;

test.before(async () => {
  // Create a valid token for testing
  validToken = withRootSpan(() => {
    return jwt.sign({ userId: 123, username: "testuser" }, TEST_SECRET, {
      expiresIn: "1h",
      issuer: "test-issuer",
    });
  });
});

test.after.always(async () => {
  clearRegisteredInMemoryAdapters();
});

test.beforeEach(() => {
  spanAdapter.clear();
});

test.serial("should capture spans for synchronous sign operation", async (t) => {
  const payload = { userId: 123, username: "testuser" };

  withRootSpan(() => {
    const token = jwt.sign(payload, TEST_SECRET);
    t.truthy(token);
    t.is(typeof token, "string");
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const signSpan = jwtSpans[0];
  t.deepEqual((signSpan.inputValue as JwtSignInputValue).payload, payload);
  t.truthy(signSpan.outputValue);
});

test.serial("should capture spans for asynchronous sign operation with callback", async (t) => {
  const payload = { userId: 456, username: "asyncuser" };

  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      jwt.sign(payload, TEST_SECRET, {}, async (err, token) => {
        try {
          t.is(err, null);
          t.truthy(token);
          t.is(typeof token, "string");

          await sleep();

          const spans = spanAdapter.getAllSpans();
          const jwtSpans = spans.filter(
            (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
          );
          t.true(jwtSpans.length > 0);

          const signSpan = jwtSpans[0];
          t.deepEqual((signSpan.inputValue as JwtSignInputValue).payload, payload);
          t.truthy(signSpan.outputValue);

          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});

test.serial("should capture spans for sign operation with options", async (t) => {
  const payload = { userId: 789, role: "admin" };
  const options = { expiresIn: "2h", issuer: "test-issuer" };

  withRootSpan(() => {
    const token = jwt.sign(payload, TEST_SECRET, options);
    t.truthy(token);
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const signSpan = jwtSpans[0];
  t.deepEqual((signSpan.inputValue as JwtSignInputValue).payload, payload);
  t.deepEqual((signSpan.inputValue as JwtSignInputValue).options, options);
});

test.serial("should capture spans for synchronous verify operation", async (t) => {
  withRootSpan(() => {
    const decoded = jwt.verify(validToken, TEST_SECRET) as any;
    t.truthy(decoded);
    t.is(decoded.userId, 123);
    t.is(decoded.username, "testuser");
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const verifySpan = jwtSpans[0];
  t.is((verifySpan.inputValue as JwtVerifyInputValue).token, validToken);
  t.truthy(verifySpan.outputValue);
});

test.serial("should capture spans for asynchronous verify operation with callback", async (t) => {
  await new Promise<void>((resolve, reject) => {
    withRootSpan(() => {
      jwt.verify(validToken, TEST_SECRET, {}, async (err, decoded: any) => {
        try {
          t.is(err, null);
          t.truthy(decoded);
          t.is(decoded.userId, 123);

          await sleep();

          const spans = spanAdapter.getAllSpans();
          const jwtSpans = spans.filter(
            (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
          );
          t.true(jwtSpans.length > 0);

          const verifySpan = jwtSpans[0];
          t.is((verifySpan.inputValue as JwtVerifyInputValue).token, validToken);

          resolve();
        } catch (error) {
          reject(error);
        }
      });
    });
  });
});

test.serial("should capture spans for verify operation with options", async (t) => {
  const options = { issuer: "test-issuer" };

  withRootSpan(() => {
    const decoded = jwt.verify(validToken, TEST_SECRET, options) as any;
    t.truthy(decoded);
    t.is(decoded.userId, 123);
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const verifySpan = jwtSpans[0];
  t.is((verifySpan.inputValue as JwtVerifyInputValue).token, validToken);
  t.deepEqual((verifySpan.inputValue as JwtVerifyInputValue).options, options);
});

test.serial("should capture spans for verify operation with complete option", async (t) => {
  withRootSpan(() => {
    const decoded = jwt.verify(validToken, TEST_SECRET, { complete: true }) as any;
    t.truthy(decoded);
    t.truthy(decoded.header);
    t.truthy(decoded.payload);
    t.is(decoded.payload.userId, 123);
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const verifySpan = jwtSpans[0];
  t.is((verifySpan.inputValue as JwtVerifyInputValue).token, validToken);
});

test.serial("should capture spans even for failed verify operations", async (t) => {
  const invalidToken = "invalid.token.here";

  try {
    withRootSpan(() => {
      jwt.verify(invalidToken, TEST_SECRET);
    });
    t.fail("Verify should have thrown an error");
  } catch (error: any) {
    t.truthy(error);
    t.is(error.name, "JsonWebTokenError");
  }

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const verifySpan = jwtSpans[0];
  t.is((verifySpan.inputValue as JwtVerifyInputValue).token, invalidToken);
});

// Note: jwt.decode is not instrumented, so this test is skipped
test.serial.skip("should capture spans for decode operation", async (t) => {
  withRootSpan(() => {
    const decoded = jwt.decode(validToken) as any;
    t.truthy(decoded);
    t.is(decoded.userId, 123);
    t.is(decoded.username, "testuser");
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const decodeSpan = jwtSpans[0];
  t.truthy(decodeSpan.inputValue);
  t.truthy(decodeSpan.outputValue);
});

// Note: jwt.decode is not instrumented, so this test is skipped
test.serial.skip("should capture spans for decode operation with complete option", async (t) => {
  withRootSpan(() => {
    const decoded = jwt.decode(validToken, { complete: true }) as any;
    t.truthy(decoded);
    t.truthy(decoded.header);
    t.truthy(decoded.payload);
    t.is(decoded.payload.userId, 123);
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);
});

test.serial("should handle concurrent sign operations", async (t) => {
  withRootSpan(() => {
    const operations = Array.from({ length: 5 }, (_, i) =>
      jwt.sign({ userId: i, operation: "concurrent" }, TEST_SECRET),
    );

    t.is(operations.length, 5);
    operations.forEach((token) => {
      t.truthy(token);
      t.is(typeof token, "string");
    });
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length >= 5);
});

test.serial("should handle concurrent verify operations", async (t) => {
  withRootSpan(() => {
    const operations = Array.from({ length: 5 }, () => jwt.verify(validToken, TEST_SECRET));

    t.is(operations.length, 5);
    operations.forEach((decoded: any) => {
      t.truthy(decoded);
      t.is(decoded.userId, 123);
    });
  });

  await sleep();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length >= 5);
});
