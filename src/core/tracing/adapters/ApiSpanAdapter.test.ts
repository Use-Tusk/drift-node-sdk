import test from "ava";

import { ApiSpanAdapter } from "./ApiSpanAdapter";

test("counts timeout failures when fetch aborts with the timeout reason", async (t) => {
  const originalFetch = globalThis.fetch;
  t.teardown(() => {
    globalThis.fetch = originalFetch;
  });

  globalThis.fetch = ((_: RequestInfo | URL, init?: RequestInit) => {
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) {
        reject(new Error("missing signal"));
        return;
      }

      signal.addEventListener(
        "abort",
        () => {
          reject(signal.reason);
        },
        { once: true },
      );
    });
  }) as typeof fetch;

  const adapter = new ApiSpanAdapter({
    apiKey: "test-api-key",
    tuskBackendBaseUrl: "http://localhost:1234",
    observableServiceId: "service-id",
    environment: "test",
    sdkVersion: "test-version",
    sdkInstanceId: "sdk-instance",
    exportTimeoutMillis: 1,
  });

  const postExportRequest = (adapter as any).postExportRequest.bind(adapter) as (
    requestBytes: Uint8Array,
  ) => Promise<void>;

  const error = await t.throwsAsync(() => postExportRequest(new Uint8Array([1])));

  t.truthy(error);
  t.is(adapter.getHealthSnapshot().timeoutCount, 1);
});
