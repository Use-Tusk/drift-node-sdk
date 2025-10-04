process.env.TUSK_DRIFT_MODE = "RECORD";

import test from "ava";
import { TuskDrift } from "../../../core/TuskDrift";
TuskDrift.initialize({
  apiKey: "test-api-key",
  env: "test",
  logLevel: "silent",
});

import request from "supertest";
import express, { Application } from "express";
import type { Server } from "http";

let app: Application;
let server: Server;
TuskDrift.markAppAsReady();

test.before(async () => {
  app = express();
  app.use(express.json());

  // Core request/response endpoints used across tests
  app.get("/test/simple-get", (req, res) => {
    res.json({ message: "GET success", query: req.query });
  });

  app.post("/test/simple-post", (req, res) => {
    res.json({ message: "POST success", received: req.body });
  });

  app.get("/test/headers", (req, res) => {
    res.json({
      message: "Headers received",
      userAgent: req.headers["user-agent"],
      customHeader: req.headers["x-custom-header"],
    });
  });

  app.put("/test/put-endpoint", (req, res) => {
    res.json({ method: "PUT", body: req.body });
  });

  app.delete("/test/delete-endpoint", (req, res) => {
    res.json({ method: "DELETE", deleted: true });
  });

  app.get("/test/not-found", (req, res) => {
    res.status(404).json({ error: "Not found" });
  });

  app.get("/test/server-error", (req, res) => {
    res.status(500).json({ error: "Internal server error" });
  });

  app.post("/test/json-data", (req, res) => {
    const data = req.body;
    res.json({
      received: data,
      type: typeof data,
      keys: Object.keys(data),
    });
  });

  app.get("/test/query-params", (req, res) => {
    res.json({ query: req.query });
  });

  app.post("/test/moderate-payload", (req, res) => {
    res.json({
      size: JSON.stringify(req.body).length,
      itemCount: req.body.items?.length || 0,
    });
  });

  app.post("/test/malformed", (req, res) => {
    res.json({ received: "ok" });
  });

  app.get("/test/special-chars/:param", (req, res) => {
    res.json({
      path: req.path,
      params: req.params,
      originalUrl: req.originalUrl,
      query: req.query,
    });
  });

  app.get("/test/concurrent/:id", (req, res) => {
    const delay = Math.random() * 50;
    setTimeout(() => {
      res.json({ id: req.params.id, timestamp: Date.now() });
    }, delay);
  });

  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
});

test.after.always(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
});

test("HTTP - should handle GET requests", async (t) => {
  const response = await request(server).get("/test/simple-get?param=value").expect(200);

  t.is(response.body.message, "GET success");
  t.is(response.body.query.param, "value");
});

test("HTTP - should handle POST requests with body", async (t) => {
  const testData = { username: "testuser", data: "test data" };
  const response = await request(server).post("/test/simple-post").send(testData).expect(200);

  t.is(response.body.message, "POST success");
  t.deepEqual(response.body.received, testData);
});

test("HTTP - should handle requests with headers", async (t) => {
  const response = await request(server)
    .get("/test/headers")
    .set("X-Custom-Header", "test-value")
    .expect(200);

  t.is(response.body.message, "Headers received");
  t.is(response.body.customHeader, "test-value");
});

test("HTTP - should handle PUT requests", async (t) => {
  const response = await request(server)
    .put("/test/put-endpoint")
    .send({ update: "data" })
    .expect(200);

  t.is(response.body.method, "PUT");
  t.is(response.body.body.update, "data");
});

test("HTTP - should handle DELETE requests", async (t) => {
  const response = await request(server).delete("/test/delete-endpoint").expect(200);

  t.is(response.body.method, "DELETE");
  t.is(response.body.deleted, true);
});

test("HTTP - should handle different status codes", async (t) => {
  const response = await request(server).get("/test/not-found").expect(404);

  t.is(response.body.error, "Not found");
});

test("HTTP - should handle server errors", async (t) => {
  const response = await request(server).get("/test/server-error").expect(500);

  t.is(response.body.error, "Internal server error");
});

test("HTTP - should handle JSON data correctly", async (t) => {
  const testData = {
    string: "test",
    number: 123,
    boolean: true,
    nested: { key: "value" },
  };

  const response = await request(server).post("/test/json-data").send(testData).expect(200);

  t.deepEqual(response.body.received, testData);
  t.is(response.body.type, "object");
  t.true(response.body.keys.includes("string"));
  t.true(response.body.keys.includes("nested"));
});

test("HTTP - should handle query parameters", async (t) => {
  const response = await request(server)
    .get("/test/query-params?name=test&value=123&flag=true")
    .expect(200);

  t.is(response.body.query.name, "test");
  t.is(response.body.query.value, "123");
  t.is(response.body.query.flag, "true");
});

test("HTTP - should handle moderate size payloads", async (t) => {
  const moderateData = {
    items: Array.from({ length: 50 }, (_, i) => ({
      id: i,
      name: `Item ${i}`,
      data: `Some data for item ${i}`,
    })),
  };

  const response = await request(server)
    .post("/test/moderate-payload")
    .send(moderateData)
    .expect(200);

  t.is(response.body.itemCount, 50);
  t.true(response.body.size > 1000);
});

test("HTTP - should handle malformed JSON gracefully", async (t) => {
  // Send malformed JSON by manipulating the request manually
  const response = await request(server)
    .post("/test/malformed")
    .set("Content-Type", "application/json")
    .send('{"invalid": json}')
    .expect(400); // Express should return 400 for malformed JSON

  // This tests that the server handles malformed JSON appropriately
  t.pass();
});

test("HTTP - should handle requests with special characters in URLs", async (t) => {
  const response = await request(server)
    .get("/test/special-chars/hello%20world?param=test%26value")
    .expect(200);

  t.true(response.body.path.includes("special-chars"));
  t.true(response.body.originalUrl.includes("hello%20world"));
  t.is(response.body.params.param, "hello world");
});

test("HTTP - should handle concurrent requests", async (t) => {
  // Send 10 concurrent requests
  const promises = Array.from({ length: 10 }, (_, i) =>
    request(server).get(`/test/concurrent/${i}`).expect(200),
  );

  const responses = await Promise.all(promises);

  // All requests should complete successfully
  t.is(responses.length, 10);
  responses.forEach((response, index) => {
    t.is(response.body.id, index.toString());
    t.true(response.body.timestamp > 0);
  });
});
