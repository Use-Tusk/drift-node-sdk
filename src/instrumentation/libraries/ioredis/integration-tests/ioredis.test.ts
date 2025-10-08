process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../../core/TuskDrift";

TuskDrift.initialize({
  apiKey: "test-api-key",
  env: "test",
  logLevel: "debug",
});
TuskDrift.markAppAsReady();

import test from "ava";
import { SpanKind } from "@opentelemetry/api";
import { SpanUtils } from "../../../../core/tracing/SpanUtils";
import { TuskDriftMode } from "../../../../core/TuskDrift";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
  clearRegisteredInMemoryAdapters,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";
import { CleanSpanData } from "../../../../core/types";
import { IORedisInputValue } from "../types";

// Use require() instead of import to ensure the modules under test is loaded AFTER TuskDrift initialization.
// ESM imports are hoisted and executed before any other code, but we need the instrumentation
// to be set up first before the modules under test is loaded and patched.
const Redis = require("ioredis");

// Check with docker-compose.test.yml!
const TEST_REDIS_CONFIG = {
  host: "127.0.0.1",
  port: 6379,
  lazyConnect: true,
};

async function waitForSpans(timeoutMs: number = 2500): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

/** These tests don't have a root span because there's no server or anything.
 * TODO: create a proper server like http */
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

let spanAdapter: InMemorySpanAdapter;
let redis: any;

test.before(async (t) => {
  spanAdapter = new InMemorySpanAdapter();
  registerInMemoryAdapter(spanAdapter);

  redis = new Redis(TEST_REDIS_CONFIG);
  await redis.connect();

  // Clear any existing test data
  await withRootSpan(() => redis.flushdb());

  // Clear spans from setup
  await waitForSpans();
  spanAdapter.clear();
});

test.after.always(async () => {
  if (redis) {
    await redis.quit();
  }
  clearRegisteredInMemoryAdapters();
});

test.beforeEach(async () => {
  spanAdapter.clear();

  // Clean Redis between tests - wrap in try/catch to avoid unhandled rejections
  try {
    await redis.flushdb();
  } catch (error) {
    // Ignore errors during cleanup
  }
});

test.serial("should capture spans for SET command", async (t) => {
  const result = await withRootSpan(() => redis.set("test-key", "test-value"));

  t.is(result, "OK");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const ioredisSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "IORedisInstrumentation",
  );
  t.true(ioredisSpans.length > 0);

  const span = ioredisSpans[0];
  t.is(span.name, "ioredis.set");
  t.is((span.inputValue as IORedisInputValue).command, "set");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["test-key", "test-value"]);
  t.is((span.outputValue as any).value, "OK");
});

test.serial("should capture spans for GET command", async (t) => {
  await redis.set("test-key", "test-value");

  const result = await withRootSpan(() => redis.get("test-key"));

  t.is(result, "test-value");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const ioredisSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "get",
  );
  t.true(ioredisSpans.length > 0);

  const span = ioredisSpans[0];
  t.is(span.name, "ioredis.get");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["test-key"]);
  t.is((span.outputValue as any).value, "test-value");
});

test.serial("should capture spans for DEL command", async (t) => {
  await redis.set("test-key", "test-value");

  const result = await withRootSpan(() => redis.del("test-key"));

  t.is(result, 1);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const ioredisSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "del",
  );
  t.true(ioredisSpans.length > 0);

  const span = ioredisSpans[0];
  t.is(span.name, "ioredis.del");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["test-key"]);
  t.is((span.outputValue as any).value, 1);
});

test.serial("should capture spans for HSET and HGET commands", async (t) => {
  await withRootSpan(() => redis.hset("test-hash", "field1", "value1"));

  const result = await withRootSpan(() => redis.hget("test-hash", "field1"));

  t.is(result, "value1");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const hgetSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "hget",
  );
  t.true(hgetSpans.length > 0);

  const span = hgetSpans[0];
  t.is(span.name, "ioredis.hget");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["test-hash", "field1"]);
  t.is((span.outputValue as any).value, "value1");
});

test.serial("should capture spans for HGETALL command", async (t) => {
  await redis.hset("test-hash", "field1", "value1");
  await redis.hset("test-hash", "field2", "value2");

  const result = await withRootSpan(() => redis.hgetall("test-hash"));

  t.deepEqual(result, { field1: "value1", field2: "value2" });

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const ioredisSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "hgetall",
  );
  t.true(ioredisSpans.length > 0);

  const span = ioredisSpans[0];
  t.is(span.name, "ioredis.hgetall");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["test-hash"]);
  t.deepEqual((span.outputValue as any).value, { field1: "value1", field2: "value2" });
});

test.serial("should capture spans for LPUSH and LRANGE commands", async (t) => {
  await withRootSpan(() => redis.lpush("test-list", "item1", "item2", "item3"));

  const result = await withRootSpan(() => redis.lrange("test-list", 0, -1));

  t.deepEqual(result, ["item3", "item2", "item1"]);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const lrangeSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "lrange",
  );
  t.true(lrangeSpans.length > 0);

  const span = lrangeSpans[0];
  t.is(span.name, "ioredis.lrange");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["test-list", 0, -1]);
  t.deepEqual((span.outputValue as any).value, ["item3", "item2", "item1"]);
});

test.serial("should capture spans for SADD and SMEMBERS commands", async (t) => {
  await withRootSpan(() => redis.sadd("test-set", "member1", "member2", "member3"));

  const result = await withRootSpan(() => redis.smembers("test-set"));

  t.is(result.length, 3);
  t.true(result.includes("member1"));
  t.true(result.includes("member2"));
  t.true(result.includes("member3"));

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const smembersSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "smembers",
  );
  t.true(smembersSpans.length > 0);

  const span = smembersSpans[0];
  t.is(span.name, "ioredis.smembers");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["test-set"]);
});

test.serial("should capture spans for ZADD and ZRANGE commands", async (t) => {
  await withRootSpan(() => redis.zadd("test-zset", 1, "one", 2, "two", 3, "three"));

  const result = await withRootSpan(() => redis.zrange("test-zset", 0, -1));

  t.deepEqual(result, ["one", "two", "three"]);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const zrangeSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "zrange",
  );
  t.true(zrangeSpans.length > 0);

  const span = zrangeSpans[0];
  t.is(span.name, "ioredis.zrange");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["test-zset", 0, -1]);
  t.deepEqual((span.outputValue as any).value, ["one", "two", "three"]);
});

test.serial("should capture spans for INCR command", async (t) => {
  const result1 = await withRootSpan(() => redis.incr("counter"));
  const result2 = await withRootSpan(() => redis.incr("counter"));

  t.is(result1, 1);
  t.is(result2, 2);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const incrSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "incr",
  );
  t.true(incrSpans.length >= 2);
});

test.serial("should capture spans for SETEX command", async (t) => {
  const result = await withRootSpan(() => redis.setex("temp-key", 10, "temp-value"));

  t.is(result, "OK");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const setexSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "setex",
  );
  t.true(setexSpans.length > 0);

  const span = setexSpans[0];
  t.is(span.name, "ioredis.setex");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["temp-key", 10, "temp-value"]);
});

test.serial("should capture spans for EXISTS command", async (t) => {
  await redis.set("existing-key", "value");

  const result1 = await withRootSpan(() => redis.exists("existing-key"));
  const result2 = await withRootSpan(() => redis.exists("non-existing-key"));

  t.is(result1, 1);
  t.is(result2, 0);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const existsSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "exists",
  );
  t.true(existsSpans.length >= 2);
});

test.serial("should capture spans for pipeline execution", async (t) => {
  const pipeline = redis.pipeline();
  pipeline.set("key1", "value1");
  pipeline.set("key2", "value2");
  pipeline.get("key1");
  pipeline.get("key2");

  const results = await withRootSpan(() => pipeline.exec());

  t.is(results.length, 4);
  t.is(results[0][1], "OK");
  t.is(results[1][1], "OK");
  t.is(results[2][1], "value1");
  t.is(results[3][1], "value2");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const pipelineSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      input.name === "ioredis.pipeline.exec",
  );
  t.true(pipelineSpans.length > 0);

  const span = pipelineSpans[0];
  t.truthy((span.inputValue as any).commands);
  t.is((span.inputValue as any).commands.length, 4);
  t.is((span.inputValue as any).commands[0].command, "set");
  t.deepEqual((span.inputValue as any).commands[0].args, ["key1", "value1"]);
});

test.serial("should capture spans for multi/exec (transactions)", async (t) => {
  const multi = redis.multi();
  multi.set("tx-key1", "tx-value1");
  multi.set("tx-key2", "tx-value2");
  multi.get("tx-key1");

  const results = await withRootSpan(() => multi.exec());

  t.is(results.length, 3);
  t.is(results[0][1], "OK");
  t.is(results[1][1], "OK");
  t.is(results[2][1], "tx-value1");

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const multiSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      input.name === "ioredis.pipeline.exec",
  );
  t.true(multiSpans.length > 0);

  const span = multiSpans[0];
  t.truthy((span.inputValue as any).commands);
  // Multi adds an extra "exec" command which is filtered out, but might include a "multi" command
  t.true((span.inputValue as any).commands.length >= 3);
});

test.serial("should handle empty pipeline", async (t) => {
  const pipeline = redis.pipeline();

  const results = await withRootSpan(() => pipeline.exec());

  t.deepEqual(results, []);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const pipelineSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      input.name === "ioredis.pipeline.exec",
  );
  t.true(pipelineSpans.length > 0);
});

test.serial("should capture spans for connect operation", async (t) => {
  const newRedis = new Redis(TEST_REDIS_CONFIG);

  await withRootSpan(() => newRedis.connect());

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const connectSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      input.name === "ioredis.connect",
  );
  t.true(connectSpans.length > 0);

  const span = connectSpans[0];
  t.is(span.name, "ioredis.connect");
  t.is((span.inputValue as any).host, "127.0.0.1");
  t.is((span.inputValue as any).port, 6379);
  t.truthy((span.outputValue as any).connected);

  // Cleanup
  await newRedis.quit();
});

test.serial("should handle concurrent commands", async (t) => {
  const commands = Array.from({ length: 5 }, (_, i) =>
    withRootSpan(() => redis.set(`concurrent-key-${i}`, `value-${i}`)),
  );

  const results = await Promise.all(commands);
  t.is(results.length, 5);
  results.forEach((result) => t.is(result, "OK"));

  await waitForSpans();

  const spans = spanAdapter.getSpansByInstrumentation("IORedis");
  t.true(spans.length >= 5);

  // Each command should have its own span
  for (let i = 0; i < 5; i++) {
    const commandSpans = spans.filter(
      (input: CleanSpanData) =>
        (input.inputValue as IORedisInputValue)?.command === "set" &&
        (input.inputValue as IORedisInputValue)?.args[0] === `concurrent-key-${i}`,
    );
    t.true(commandSpans.length > 0);
  }
});

test.serial("should capture spans even for failed commands", async (t) => {
  const error = await t.throwsAsync(
    async () => {
      await withRootSpan(() => redis.call("INVALID_COMMAND", "key"));
    },
    undefined,
  );

  t.truthy(error);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const ioredisSpans = spans.filter(
    (input: CleanSpanData) => input.instrumentationName === "IORedisInstrumentation",
  );
  t.true(ioredisSpans.length > 0);
});

test.serial("should handle MGET command", async (t) => {
  await redis.set("mget-key1", "value1");
  await redis.set("mget-key2", "value2");
  await redis.set("mget-key3", "value3");

  const result = await withRootSpan(() => redis.mget("mget-key1", "mget-key2", "mget-key3"));

  t.deepEqual(result, ["value1", "value2", "value3"]);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const mgetSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "mget",
  );
  t.true(mgetSpans.length > 0);

  const span = mgetSpans[0];
  t.is(span.name, "ioredis.mget");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["mget-key1", "mget-key2", "mget-key3"]);
  t.deepEqual((span.outputValue as any).value, ["value1", "value2", "value3"]);
});

test.serial("should handle TTL command", async (t) => {
  await redis.setex("ttl-key", 100, "value");

  const result = await withRootSpan(() => redis.ttl("ttl-key"));

  t.true(result > 0 && result <= 100);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const ttlSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "ttl",
  );
  t.true(ttlSpans.length > 0);
});

test.serial("should handle EXPIRE command", async (t) => {
  await redis.set("expire-key", "value");

  const result = await withRootSpan(() => redis.expire("expire-key", 60));

  t.is(result, 1);

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const expireSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "expire",
  );
  t.true(expireSpans.length > 0);

  const span = expireSpans[0];
  t.is(span.name, "ioredis.expire");
  t.deepEqual((span.inputValue as IORedisInputValue).args, ["expire-key", 60]);
});

test.serial("should handle KEYS command", async (t) => {
  await redis.set("pattern:key1", "value1");
  await redis.set("pattern:key2", "value2");
  await redis.set("other:key", "value");

  const result = await withRootSpan(() => redis.keys("pattern:*"));

  t.is(result.length, 2);
  t.true(result.includes("pattern:key1"));
  t.true(result.includes("pattern:key2"));

  await waitForSpans();

  const spans = spanAdapter.getAllSpans();
  const keysSpans = spans.filter(
    (input: CleanSpanData) =>
      input.instrumentationName === "IORedisInstrumentation" &&
      (input.inputValue as IORedisInputValue)?.command === "keys",
  );
  t.true(keysSpans.length > 0);
});
