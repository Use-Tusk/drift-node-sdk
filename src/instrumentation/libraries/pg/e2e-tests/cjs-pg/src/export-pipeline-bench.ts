/**
 * Benchmark: Measures event loop blocking caused by the span export pipeline.
 *
 * Fires a burst of HTTP requests that generate pg spans, then monitors
 * event loop stalls during the BatchSpanProcessor export cycle.
 *
 * Usage (inside Docker):
 *   node dist/export-pipeline-bench.js
 *
 * Output: JSON with stall measurements for each export cycle.
 */
import { TuskDrift } from "./tdInit";
import http from "http";
import { Pool } from "pg";

const CONCURRENT_REQUESTS = 10;
const QUERIES_PER_REQUEST = 20;
const ROWS_PER_QUERY = 200;
const ROW_PAYLOAD_SIZE = 100; // chars per row
const EXPORT_WAIT_MS = 6000; // wait for export batches to fire
const STALL_THRESHOLD_MS = 5; // report stalls above this

const dbConfig = {
  host: process.env.POSTGRES_HOST || "postgres",
  port: parseInt(process.env.POSTGRES_PORT || "5432"),
  database: process.env.POSTGRES_DB || "testdb",
  user: process.env.POSTGRES_USER || "testuser",
  password: process.env.POSTGRES_PASSWORD || "testpass",
  max: 10,
};

async function run() {
  const pool = new Pool(dbConfig);
  await pool.query("CREATE TABLE IF NOT EXISTS bench_t (id serial, val text)");
  TuskDrift.markAppAsReady();

  // --- Event loop stall monitor ---
  const stalls: number[] = [];
  let monitoring = true;
  const monitorLoop = () => {
    if (!monitoring) return;
    const t = Date.now();
    setImmediate(() => {
      const delay = Date.now() - t;
      if (delay > STALL_THRESHOLD_MS) stalls.push(delay);
      if (monitoring) monitorLoop();
    });
  };

  // --- HTTP server that generates pg spans ---
  const query = `SELECT generate_series(1, ${ROWS_PER_QUERY}) as id, repeat(chr(65), ${ROW_PAYLOAD_SIZE}) as data`;

  const server = http.createServer(async (_req, res) => {
    const promises = Array.from({ length: QUERIES_PER_REQUEST }, () =>
      pool.query(query)
    );
    await Promise.all(promises);
    res.end("ok");
  });

  await new Promise<void>((resolve) => server.listen(3000, resolve));

  // --- Run benchmark ---
  // Phase 1: generate spans
  monitorLoop();
  const reqStart = Date.now();
  await Promise.all(
    Array.from({ length: CONCURRENT_REQUESTS }, () =>
      fetch("http://localhost:3000/")
    )
  );
  const reqDuration = Date.now() - reqStart;

  // Phase 2: wait for export batches to fire
  await new Promise((r) => setTimeout(r, EXPORT_WAIT_MS));
  monitoring = false;

  // --- Report ---
  const result = {
    mode: process.env.TUSK_DRIFT_MODE || "DISABLED",
    config: {
      concurrentRequests: CONCURRENT_REQUESTS,
      queriesPerRequest: QUERIES_PER_REQUEST,
      rowsPerQuery: ROWS_PER_QUERY,
      rowPayloadSize: ROW_PAYLOAD_SIZE,
    },
    requestDurationMs: reqDuration,
    stallCount: stalls.length,
    maxStallMs: stalls.length > 0 ? Math.max(...stalls) : 0,
    p99StallMs: stalls.length > 0 ? stalls.sort((a, b) => a - b)[Math.floor(stalls.length * 0.99)] : 0,
    totalStallMs: stalls.reduce((a, b) => a + b, 0),
    stalls,
  };

  console.log(JSON.stringify(result));

  await pool.end();
  server.close();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
