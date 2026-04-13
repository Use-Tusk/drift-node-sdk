import test from "ava";

import { TuskDriftMode } from "../TuskDrift";
import { ApiSpanAdapter, type ApiSpanAdapterHealthSnapshot } from "./adapters/ApiSpanAdapter";
import { TdSpanExporter } from "./TdSpanExporter";

function createMockApiAdapter(snapshot: ApiSpanAdapterHealthSnapshot): ApiSpanAdapter {
  const adapter = Object.create(ApiSpanAdapter.prototype) as ApiSpanAdapter;
  (adapter as any).getHealthSnapshot = () => snapshot;
  return adapter;
}

test("preserves null export latency when no adapter has observed one", (t) => {
  const exporter = new TdSpanExporter({
    baseDirectory: "/tmp/drift-node-sdk-td-exporter-test",
    mode: TuskDriftMode.RECORD,
    useRemoteExport: false,
    tuskBackendBaseUrl: "http://localhost:1234",
    sdkVersion: "test-version",
    sdkInstanceId: "sdk-instance",
    exportTimeoutMillis: 1000,
  });

  (exporter as any).adapters = [
    createMockApiAdapter({
      failureCount: 1,
      timeoutCount: 2,
      circuitState: "closed",
      lastExportLatencyMs: null,
    }),
    createMockApiAdapter({
      failureCount: 3,
      timeoutCount: 4,
      circuitState: "open",
      lastExportLatencyMs: null,
    }),
  ];

  const snapshot = exporter.getHealthSnapshot();

  t.is(snapshot.failureCount, 4);
  t.is(snapshot.timeoutCount, 6);
  t.true(snapshot.circuitOpen);
  t.is(snapshot.lastExportLatencyMs, null);
});
