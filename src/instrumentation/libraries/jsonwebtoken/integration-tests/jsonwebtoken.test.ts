process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";

TuskDrift.initialize({
  apiKey: "test-api-key-jsonwebtoken",
  env: "test",
  logLevel: "silent",
});
TuskDrift.markAppAsReady();

import test from "ava";
import jwt from "jsonwebtoken";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { CleanSpanData } from "../../../../core/types";
import { JwtSignInputValue, JwtVerifyInputValue } from "../types";

const TEST_SECRET = "test-secret-key-for-jwt-testing-12345";

async function waitForSpans(timeoutMs: number = 2500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

let spanAdapter: InMemorySpanAdapter;
let validToken: string;

test.before(async () => {
  spanAdapter = new InMemorySpanAdapter();
  registerInMemoryAdapter(spanAdapter);

  // Create a valid token for testing
  validToken = jwt.sign({ userId: 123, username: "testuser" }, TEST_SECRET, {
    expiresIn: "1h",
    issuer: "test-issuer",
  });
});

test.after.always(async () => {
  clearRegisteredInMemoryAdapters();
});

test.beforeEach(() => {
  spanAdapter.clear();
});

test("should capture spans for synchronous sign operation", async (t) => {
  const payload = { userId: 123, username: "testuser" };
  const token = jwt.sign(payload, TEST_SECRET);

  t.truthy(token);
  t.is(typeof token, "string");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const signSpan = jwtSpans[0];
  t.deepEqual((signSpan.inputValue as JwtSignInputValue).payload, payload);
  t.truthy(signSpan.outputValue);
});

test("should capture spans for asynchronous sign operation with callback", async (t) => {
  const payload = { userId: 456, username: "asyncuser" };

  await new Promise<void>((resolve, reject) => {
    jwt.sign(payload, TEST_SECRET, {}, async (err, token) => {
      try {
        t.is(err, null);
        t.truthy(token);
        t.is(typeof token, "string");

        await waitForSpans();

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

test("should capture spans for sign operation with options", async (t) => {
  const payload = { userId: 789, role: "admin" };
  const options = { expiresIn: "2h", issuer: "test-issuer" };

  const token = jwt.sign(payload, TEST_SECRET, options);

  t.truthy(token);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const signSpan = jwtSpans[0];
  t.deepEqual((signSpan.inputValue as JwtSignInputValue).payload, payload);
  t.deepEqual((signSpan.inputValue as JwtSignInputValue).options, options);
});

test("should capture spans for synchronous verify operation", async (t) => {
  const decoded = jwt.verify(validToken, TEST_SECRET) as any;

  t.truthy(decoded);
  t.is(decoded.userId, 123);
  t.is(decoded.username, "testuser");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const verifySpan = jwtSpans[0];
  t.is((verifySpan.inputValue as JwtVerifyInputValue).token, validToken);
  t.truthy(verifySpan.outputValue);
});

test("should capture spans for asynchronous verify operation with callback", async (t) => {
  await new Promise<void>((resolve, reject) => {
    jwt.verify(validToken, TEST_SECRET, {}, async (err, decoded: any) => {
      try {
        t.is(err, null);
        t.truthy(decoded);
        t.is(decoded.userId, 123);

        await waitForSpans();

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

test("should capture spans for verify operation with options", async (t) => {
  const options = { issuer: "test-issuer" };
  const decoded = jwt.verify(validToken, TEST_SECRET, options) as any;

  t.truthy(decoded);
  t.is(decoded.userId, 123);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const verifySpan = jwtSpans[0];
  t.is((verifySpan.inputValue as JwtVerifyInputValue).token, validToken);
  t.deepEqual((verifySpan.inputValue as JwtVerifyInputValue).options, options);
});

test("should capture spans for verify operation with complete option", async (t) => {
  const decoded = jwt.verify(validToken, TEST_SECRET, { complete: true }) as any;

  t.truthy(decoded);
  t.truthy(decoded.header);
  t.truthy(decoded.payload);
  t.is(decoded.payload.userId, 123);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const verifySpan = jwtSpans[0];
  t.is((verifySpan.inputValue as JwtVerifyInputValue).token, validToken);
});

test("should capture spans even for failed verify operations", async (t) => {
  const invalidToken = "invalid.token.here";

  await t.throwsAsync(
    async () => {
      jwt.verify(invalidToken, TEST_SECRET);
    },
    undefined,
    "Verify should have failed",
  );

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const verifySpan = jwtSpans[0];
  t.is((verifySpan.inputValue as JwtVerifyInputValue).token, invalidToken);
});

test("should capture spans for decode operation", async (t) => {
  const decoded = jwt.decode(validToken) as any;

  t.truthy(decoded);
  t.is(decoded.userId, 123);
  t.is(decoded.username, "testuser");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);

  const decodeSpan = jwtSpans[0];
  t.truthy(decodeSpan.inputValue);
  t.truthy(decodeSpan.outputValue);
});

test("should capture spans for decode operation with complete option", async (t) => {
  const decoded = jwt.decode(validToken, { complete: true }) as any;

  t.truthy(decoded);
  t.truthy(decoded.header);
  t.truthy(decoded.payload);
  t.is(decoded.payload.userId, 123);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length > 0);
});

test("should handle concurrent sign operations", async (t) => {
  const operations = Array.from({ length: 5 }, (_, i) =>
    jwt.sign({ userId: i, operation: "concurrent" }, TEST_SECRET),
  );

  t.is(operations.length, 5);
  operations.forEach((token) => {
    t.truthy(token);
    t.is(typeof token, "string");
  });

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length >= 5);
});

test("should handle concurrent verify operations", async (t) => {
  const operations = Array.from({ length: 5 }, () => jwt.verify(validToken, TEST_SECRET));

  t.is(operations.length, 5);
  operations.forEach((decoded: any) => {
    t.truthy(decoded);
    t.is(decoded.userId, 123);
  });

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const jwtSpans = spans.filter(
    (span: CleanSpanData) => span.instrumentationName === "JsonwebtokenInstrumentation",
  );
  t.true(jwtSpans.length >= 5);
});
