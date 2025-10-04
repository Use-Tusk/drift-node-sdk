process.env.TUSK_DRIFT_MODE = "RECORD";

import { TuskDrift } from "../../../core/TuskDrift";
TuskDrift.initialize({
  apiKey: "test-api-key",
  env: "test",
  logLevel: "silent",
});

import request from "supertest";
import express, { Application } from "express";
import type { Server } from "http";

describe("HTTP Functionality Tests", () => {
  let app: Application;
  let server: Server;
  TuskDrift.markAppAsReady();

  beforeAll(async () => {
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

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });

  describe("HTTP Request/Response Handling", () => {
    it("should handle GET requests", async () => {
      const response = await request(server).get("/test/simple-get?param=value").expect(200);

      expect(response.body.message).toBe("GET success");
      expect(response.body.query.param).toBe("value");
    });

    it("should handle POST requests with body", async () => {
      const testData = { username: "testuser", data: "test data" };
      const response = await request(server).post("/test/simple-post").send(testData).expect(200);

      expect(response.body.message).toBe("POST success");
      expect(response.body.received).toEqual(testData);
    });

    it("should handle requests with headers", async () => {
      const response = await request(server)
        .get("/test/headers")
        .set("X-Custom-Header", "test-value")
        .expect(200);

      expect(response.body.message).toBe("Headers received");
      expect(response.body.customHeader).toBe("test-value");
    });
  });

  describe("HTTP Method Variations", () => {
    it("should handle PUT requests", async () => {
      const response = await request(server)
        .put("/test/put-endpoint")
        .send({ update: "data" })
        .expect(200);

      expect(response.body.method).toBe("PUT");
      expect(response.body.body.update).toBe("data");
    });

    it("should handle DELETE requests", async () => {
      const response = await request(server).delete("/test/delete-endpoint").expect(200);

      expect(response.body.method).toBe("DELETE");
      expect(response.body.deleted).toBe(true);
    });
  });

  describe("HTTP Response Handling", () => {
    it("should handle different status codes", async () => {
      const response = await request(server).get("/test/not-found").expect(404);

      expect(response.body.error).toBe("Not found");
    });

    it("should handle server errors", async () => {
      const response = await request(server).get("/test/server-error").expect(500);

      expect(response.body.error).toBe("Internal server error");
    });
  });

  describe("HTTP Data Handling", () => {
    it("should handle JSON data correctly", async () => {
      const testData = {
        string: "test",
        number: 123,
        boolean: true,
        nested: { key: "value" },
      };

      const response = await request(server).post("/test/json-data").send(testData).expect(200);

      expect(response.body.received).toEqual(testData);
      expect(response.body.type).toBe("object");
      expect(response.body.keys).toContain("string");
      expect(response.body.keys).toContain("nested");
    });

    it("should handle query parameters", async () => {
      const response = await request(server)
        .get("/test/query-params?name=test&value=123&flag=true")
        .expect(200);

      expect(response.body.query.name).toBe("test");
      expect(response.body.query.value).toBe("123");
      expect(response.body.query.flag).toBe("true");
    });

    it("should handle moderate size payloads", async () => {
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

      expect(response.body.itemCount).toBe(50);
      expect(response.body.size).toBeGreaterThan(1000);
    });

    it("should handle malformed JSON gracefully", async () => {
      // Send malformed JSON by manipulating the request manually
      const response = await request(server)
        .post("/test/malformed")
        .set("Content-Type", "application/json")
        .send('{"invalid": json}')
        .expect(400); // Express should return 400 for malformed JSON

      // This tests that the server handles malformed JSON appropriately
    });
  });

  describe("HTTP Edge Cases", () => {
    it("should handle requests with special characters in URLs", async () => {
      const response = await request(server)
        .get("/test/special-chars/hello%20world?param=test%26value")
        .expect(200);

      expect(response.body.path).toContain("special-chars");
      expect(response.body.originalUrl).toContain("hello%20world");
      expect(response.body.params.param).toBe("hello world");
    });

    it("should handle concurrent requests", async () => {
      // Send 10 concurrent requests
      const promises = Array.from({ length: 10 }, (_, i) =>
        request(server).get(`/test/concurrent/${i}`).expect(200),
      );

      const responses = await Promise.all(promises);

      // All requests should complete successfully
      expect(responses).toHaveLength(10);
      responses.forEach((response, index) => {
        expect(response.body.id).toBe(index.toString());
        expect(response.body.timestamp).toBeGreaterThan(0);
      });
    });
  });
});
