/**
 * All Benchmarks - SDK Active
 *
 */

process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift, TuskDriftCore } from "../../src/core/TuskDrift";
import { FilesystemSpanAdapter } from "../../src/core/tracing/adapters/FilesystemSpanAdapter";
import * as path from "path";
import * as fs from "fs";

const BENCHMARK_TRACE_DIR = path.join(__dirname, "..", ".benchmark-traces");

// Clean up any existing benchmark traces
if (fs.existsSync(BENCHMARK_TRACE_DIR)) {
  fs.rmSync(BENCHMARK_TRACE_DIR, { recursive: true, force: true });
}

const adapter = new FilesystemSpanAdapter({
  baseDirectory: BENCHMARK_TRACE_DIR,
});

TuskDrift.initialize({
  apiKey: "benchmark-test-key",
  env: "benchmark",
  logLevel: "info",
});

TuskDriftCore.getInstance().spanExporter?.clearAdapters();
TuskDriftCore.getInstance().spanExporter?.addAdapter(adapter);

TuskDrift.markAppAsReady();

process.env.BENCHMARK_RESULT_LABEL = "sdk-active";

const common = require("./common.ts");

common.default();
