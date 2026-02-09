/**
 * Shared test utilities for Node SDK E2E tests.
 * Mirrors Python SDK's e2e_common/test_utils.py pattern.
 *
 * Usage in test_requests.mjs:
 *   import { makeRequest, printRequestSummary } from '/app/test-utils.mjs';
 *   await makeRequest('GET', '/health');
 *   await makeRequest('POST', '/users/create', { body: { name: 'Test' } });
 *   printRequestSummary();
 */

const PORT = process.env.PORT || '3000';
const BASE_URL = `http://localhost:${PORT}`;
const BENCHMARK_MODE = !!process.env.BENCHMARKS;
const BENCHMARK_DURATION = parseInt(process.env.BENCHMARK_DURATION || '5', 10);
const BENCHMARK_WARMUP = parseInt(process.env.BENCHMARK_WARMUP || '3', 10);

let totalRequestsSent = 0;

/**
 * Sleep for the given number of milliseconds.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run a benchmark loop for a single endpoint.
 * Outputs Go-style stats: name count ns/op ops/s
 */
async function _benchmarkRequest(method, endpoint, options) {
  const benchName = `Benchmark_${method}${endpoint.replace(/\//g, '_')}`;
  const url = `${BASE_URL}${endpoint}`;

  const fetchOptions = { method };
  if (options?.body) {
    fetchOptions.headers = { 'Content-Type': 'application/json' };
    fetchOptions.body = JSON.stringify(options.body);
  }
  if (options?.headers) {
    fetchOptions.headers = { ...fetchOptions.headers, ...options.headers };
  }

  // Warmup phase
  const warmupEnd = Date.now() + BENCHMARK_WARMUP * 1000;
  while (Date.now() < warmupEnd) {
    try {
      const resp = await fetch(url, fetchOptions);
      await resp.text();
    } catch {
      // ignore warmup errors
    }
  }

  // Timed phase
  let count = 0;
  const startNs = process.hrtime.bigint();
  const durationNs = BigInt(BENCHMARK_DURATION) * 1_000_000_000n;
  const endNs = startNs + durationNs;

  while (process.hrtime.bigint() < endNs) {
    try {
      const resp = await fetch(url, fetchOptions);
      await resp.text();
      count++;
    } catch {
      // count failures too to keep timing accurate
      count++;
    }
  }

  const elapsedNs = Number(process.hrtime.bigint() - startNs);
  totalRequestsSent += count;

  if (count > 0) {
    const nsPerOp = Math.round(elapsedNs / count);
    const opsPerSec = ((count * 1_000_000_000) / elapsedNs).toFixed(2);
    const nameCol = benchName.padEnd(45);
    const countCol = String(count).padStart(5);
    const nsCol = String(nsPerOp).padStart(12);
    const opsCol = String(opsPerSec).padStart(10);
    console.log(`${nameCol} ${countCol} ${nsCol} ns/op ${opsCol} ops/s`);
  }
}

/**
 * Make a request to the test server.
 * In normal mode: single request with 0.5s delay.
 * In benchmark mode: timed loop with warmup.
 */
export async function makeRequest(method, endpoint, options) {
  if (BENCHMARK_MODE) {
    await _benchmarkRequest(method, endpoint, options);
    return;
  }

  // Normal mode - single request
  const url = `${BASE_URL}${endpoint}`;
  const fetchOptions = { method };
  if (options?.body) {
    fetchOptions.headers = { 'Content-Type': 'application/json' };
    fetchOptions.body = JSON.stringify(options.body);
  }
  if (options?.headers) {
    fetchOptions.headers = { ...fetchOptions.headers, ...options.headers };
  }

  const resp = await fetch(url, fetchOptions);
  if (!resp.ok) {
    throw new Error(`${method} ${endpoint} failed with status ${resp.status}`);
  }
  await resp.text();
  totalRequestsSent++;

  // Small delay between requests to avoid overwhelming the server
  await sleep(500);
}

/**
 * Print summary of total requests sent.
 * Parseable by base-entrypoint.sh.
 */
export function printRequestSummary() {
  console.log(`TOTAL_REQUESTS_SENT:${totalRequestsSent}`);
}
