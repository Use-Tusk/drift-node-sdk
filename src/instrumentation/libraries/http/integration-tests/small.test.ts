process.env.TUSK_DRIFT_MODE = "RECORD";

import test from "ava";
import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../../types";
import {
  InMemorySpanAdapter,
  registerInMemoryAdapter,
} from "../../../../core/tracing/adapters/InMemorySpanAdapter";

const transforms: TransformConfigs = {
  http: [
    {
      matcher: {
        direction: "outbound",
        pathPattern: "/api/data",
        jsonPath: "$.data",
      },
      action: { type: "replace", replaceWith: "[REDACTED]" },
    },
  ],
};

TuskDrift.initialize({
  apiKey: "test-api-key-replace",
  env: "test",
  logLevel: "debug",
  transforms,
});

const spanAdapter = new InMemorySpanAdapter();
registerInMemoryAdapter(spanAdapter);

const http = require("http");
const express = require("express");

const serviceAApp = express();
serviceAApp.use(express.json());

serviceAApp.post("/api/sensitive", (req: any, res: any) => {
  res.json({
    status: "success",
    sensitiveData: "TOP_SECRET_123",
    userId: req.body.userId,
  });
});

serviceAApp.get("/api/data", (req: any, res: any) => {
  res.json({ data: "public data from service A" });
});

async function sleep(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

const port = 8934;
let server: any;

test.before(() => {
  TuskDrift.markAppAsReady();
  server = serviceAApp.listen(port, "127.0.0.1");
});

test.after.always(() => {
  if (server) {
    server.close();
  }
});

test("should be able to reach the server", async (t) => {
  await new Promise<void>((resolve) => {
    http.get(`http://127.0.0.1:${port}/api/data`, (res: any) => {
      res.on("data", function (chunk: any) {
        console.log("BODY: " + chunk);
      });

      res.on("end", async function () {
        // Wait for span processor to export spans (default batch timeout is 2000ms)
        await sleep(2500);
        const allSpans = spanAdapter.getAllSpans();
        console.log(`Spans captured: ${allSpans.length}`);
        t.true(allSpans.length > 0, "Should have captured at least one span");
        resolve();
      });
    });
  });
});
