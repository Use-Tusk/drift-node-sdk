process.env.TUSK_DRIFT_MODE = "RECORD";

import test from 'ava';
import { TuskDrift } from "../../../../core/TuskDrift";
import { TransformConfigs } from "../HttpTransformEngine";
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

serviceAApp.post("/api/sensitive", (req, res) => {
  res.json({
    status: "success",
    sensitiveData: "TOP_SECRET_123",
    userId: req.body.userId,
  });
});

serviceAApp.get("/api/data", (req, res) => {
  res.json({ data: "public data from service A" });
});

TuskDrift.markAppAsReady();

async function sleep(ms: number) {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

const port = 8934;
const server = serviceAApp.listen(port, "127.0.0.1");

test.after.always(() => {
  server.close();
});

test("should be able to reach the server", async (t) => {
  await new Promise<void>((resolve) => {
    http.get(`http://127.0.0.1:${port}/api/data`, (res) => {
      res.on("data", function (chunk) {
        console.log("BODY: " + chunk);
      });

      res.on("end", async function () {
        await sleep(3000);
        const allSpans = spanAdapter.getAllSpans();
        console.log(`Spans captured: ${allSpans.length}`);
        t.true(allSpans.length > 0, "Should have captured at least one span");
        resolve();
      });
    });
  });
});
