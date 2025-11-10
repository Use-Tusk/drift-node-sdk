import { TuskDrift } from "../../dist";
import { Bench, hrtimeNow } from "tinybench";

TuskDrift.initialize({
  apiKey: "benchmark-test-key",
  env: "benchmark",
  logLevel: "info",
});

import { TestServer } from "../server/test-server";

TuskDrift.markAppAsReady();

let server: TestServer;
let serverUrl: string;

async function startup() {
  server = new TestServer();
  const info = await server.start();
  serverUrl = info.url;
  console.log(`\nTest server started at ${serverUrl}`);
}

async function teardown() {
  await server.stop();
  console.log("Test server stopped\n");
}

(async () => {
  await startup();

  const bench = new Bench({
    time: 10000,
    warmupTime: 1000,
    warmupIterations: 100,
    now: hrtimeNow,
  });

  bench.add("High Throughput: GET /api/simple", async () => {
    const response = await fetch(`${serverUrl}/api/simple`);
    await response.json();
  });

  await bench.run();
  console.table(bench.table());

  await teardown();
})().catch(console.error);
